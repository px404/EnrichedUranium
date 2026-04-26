/**
 * Phase 2 integration tests — Sessions + Budget Windows
 *
 * Tests:
 *   1. Open session — happy path
 *   2. Call decrement — budget decrements correctly
 *   3. Multi-call until exhausted
 *   4. Call on exhausted session returns 402
 *   5. Explicit close — settlement correct
 *   6. Topup — re-activates exhausted session
 *   7. Topup on closed session returns 409
 *   8. Expiry — autoExpire settles session
 *   9. Daily cap enforcement
 *  10. Chain depth check
 *  11. spend_cap_per_session enforcement
 *  12. spend_cap_per_call enforcement
 */

'use strict'
const path = require('path')

// ---- bootstrap DB (must match server.js boot sequence) -------------------
const { getDb, prepare } = require('./db/database')

async function run() {
  await getDb()

  let passed = 0
  let failed = 0

  function assert(label, cond, detail) {
    if (cond) {
      console.log('  PASS:', label)
      passed++
    } else {
      console.error('  FAIL:', label, detail !== undefined ? '-- got: ' + JSON.stringify(detail) : '')
      failed++
    }
  }

  // ---- seed a schema -------------------------------------------------------
  const schemaTag = 'test-session-cap'
  prepare('DELETE FROM sessions WHERE buyer_pubkey LIKE "sess-buyer%"').run()
  prepare('DELETE FROM actors WHERE pubkey LIKE "sess-%"').run()
  prepare('DELETE FROM transaction_log WHERE actor_pubkey LIKE "sess-%"').run()
  prepare('DELETE FROM schemas WHERE capability_tag = ?').run(schemaTag)

  const now = Math.floor(Date.now() / 1000)
  prepare(`INSERT INTO schemas (capability_tag, display_name, description, input_schema, output_schema, strength_score, is_platform_template, created_at)
    VALUES (?,?,?,?,?,60,0,?)`)
    .run(schemaTag, 'Test Session Cap', 'desc',
      JSON.stringify({ type:'object', properties:{ x:{ type:'string' } }, required:['x'] }),
      JSON.stringify({ type:'object', properties:{ y:{ type:'string' } }, required:['y'] }),
      now)

  // seller: price 10 sats per call
  prepare(`INSERT INTO actors (pubkey,type,owner_pubkey,display_name,registered_at,capabilities,price_per_call_sats,
    spend_cap_per_call,spend_cap_per_session,spend_cap_daily_sats,daily_spend_used,daily_spend_reset_at,
    endpoint_url,status,webhook_url,reliability_score,certification_tier,cert_expiry,chain_depth_max)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('sess-seller-a','agent','sess-buyer-owner','Seller A',now,
      JSON.stringify([schemaTag]), JSON.stringify({ [schemaTag]: 10 }),
      JSON.stringify({}), 10000, 100000, 0, now,
      'http://seller-a.local', 'active', null, 80.0,
      JSON.stringify({ [schemaTag]: 'Unverified' }), '{}', 5)

  // buyer: human (no owner needed), daily cap 200 sats, session cap 100
  prepare(`INSERT INTO actors (pubkey,type,owner_pubkey,display_name,registered_at,capabilities,price_per_call_sats,
    spend_cap_per_call,spend_cap_per_session,spend_cap_daily_sats,daily_spend_used,daily_spend_reset_at,
    endpoint_url,status,webhook_url,reliability_score,certification_tier,cert_expiry,chain_depth_max)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('sess-buyer-a','human',null,'Buyer A',now,
      JSON.stringify([]), JSON.stringify({}),
      JSON.stringify({}), 100, 200, 0, now,
      null, 'active', null, 50.0, '{}', '{}', 5)

  // agent buyer for chain-depth test
  prepare(`INSERT INTO actors (pubkey,type,owner_pubkey,display_name,registered_at,capabilities,price_per_call_sats,
    spend_cap_per_call,spend_cap_per_session,spend_cap_daily_sats,daily_spend_used,daily_spend_reset_at,
    endpoint_url,status,webhook_url,reliability_score,certification_tier,cert_expiry,chain_depth_max)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('sess-buyer-owner','human',null,'Owner',now,
      JSON.stringify([]), JSON.stringify({}),
      JSON.stringify({}), 10000, 9999999, 0, now,
      null, 'active', null, 50.0, '{}', '{}', 5)

  // ---- inline route helpers (call sessions routes directly on DB) -----------
  // We test the logic directly rather than HTTP to avoid needing a live server
  const sessRoute = require('./routes/sessions')

  // helper: simulate req/res
  function fakeReq(params={}, body={}, query={}) {
    return { params, body, query }
  }
  function fakeRes() {
    const r = { _status: 200, _body: null }
    r.status = (s) => { r._status = s; return r }
    r.json   = (b) => { r._body = b; return r }
    return r
  }

  // ---- TEST 1: open session ------------------------------------------------
  console.log('\nTest 1: Open session (happy path)')
  {
    // Create a mock express-style request that goes through the router
    // Instead of HTTP, we test the DB state directly after calling the handler
    // by inserting directly (mimicking what the route does) and verifying

    // Actually let's just call the internal logic by using a mini express app
    const express = require('express')
    const app2 = express()
    app2.use(express.json())
    app2.use('/sessions', sessRoute)

    const http = require('http')
    const server2 = http.createServer(app2)
    await new Promise(r => server2.listen(0, '127.0.0.1', r))
    const port2 = server2.address().port

    async function api(method, path, body) {
      return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null
        const opts = {
          hostname: '127.0.0.1', port: port2,
          path, method,
          headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
        }
        const req = http.request(opts, res => {
          let buf = ''
          res.on('data', c => buf += c)
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }))
        })
        req.on('error', reject)
        if (data) req.write(data)
        req.end()
      })
    }

    // Test 1
    const r1 = await api('POST', '/sessions', {
      buyer_pubkey: 'sess-buyer-a',
      seller_pubkey: 'sess-seller-a',
      capability_tag: schemaTag,
      budget_sats: 50
    })
    assert('Open session returns 201', r1.status === 201, r1)
    assert('Session has id', !!r1.body.id, r1.body)
    assert('Session status active', r1.body.status === 'active', r1.body.status)
    assert('remaining_budget = budget_sats', r1.body.remaining_budget === 50, r1.body.remaining_budget)
    assert('sats_used = 0', r1.body.sats_used === 0, r1.body.sats_used)
    assert('price_per_call_sats = 10', r1.body.price_per_call_sats === 10, r1.body.price_per_call_sats)
    const sessionId = r1.body.id

    // Check daily_spend_used updated on buyer
    const buyer = prepare('SELECT daily_spend_used FROM actors WHERE pubkey = ?').get('sess-buyer-a')
    assert('Buyer daily_spend_used = 50', buyer.daily_spend_used === 50, buyer.daily_spend_used)

    // Test 2: call decrement
    console.log('\nTest 2: Call decrement')
    const r2 = await api('POST', '/sessions/' + sessionId + '/call', {})
    assert('Call returns 200', r2.status === 200, r2)
    assert('calls_made = 1', r2.body.calls_made === 1, r2.body.calls_made)
    assert('sats_used = 10', r2.body.sats_used === 10, r2.body.sats_used)
    assert('remaining_budget = 40', r2.body.remaining_budget === 40, r2.body.remaining_budget)

    // Test 3: multi-call until exhausted (4 more calls = 40 sats)
    console.log('\nTest 3: Multi-call until exhausted')
    await api('POST', '/sessions/' + sessionId + '/call', {})
    await api('POST', '/sessions/' + sessionId + '/call', {})
    await api('POST', '/sessions/' + sessionId + '/call', {})
    const r3 = await api('POST', '/sessions/' + sessionId + '/call', {})
    assert('5th call returns 200', r3.status === 200, r3)
    assert('sats_used = 50', r3.body.sats_used === 50, r3.body.sats_used)
    assert('Status exhausted', r3.body.status === 'exhausted', r3.body.status)

    // Test 4: call on exhausted session
    console.log('\nTest 4: Call on exhausted session')
    const r4 = await api('POST', '/sessions/' + sessionId + '/call', {})
    assert('Exhausted call returns 402', r4.status === 402, r4.status)
    assert('Error insufficient_budget', r4.body.error === 'insufficient_budget', r4.body.error)

    // Test 5: explicit close
    console.log('\nTest 5: Explicit close + settlement')
    const r5 = await api('POST', '/sessions/' + sessionId + '/close', {})
    assert('Close returns 200', r5.status === 200, r5)
    assert('Status closed', r5.body.status === 'closed', r5.body.status)
    assert('seller_payout_sats = 48 (50 - floor(50*0.05))', r5.body.seller_payout_sats === 48, r5.body.seller_payout_sats)
    assert('platform_fee_sats = 2 (floor of 2.5)', r5.body.platform_fee_sats === 2, r5.body.platform_fee_sats)
    assert('buyer_refund_sats = 0', r5.body.buyer_refund_sats === 0, r5.body.buyer_refund_sats)  // fixed: 0 not null
    // daily_spend_used should have refund (0) deducted — still 50
    const buyerAfterClose = prepare('SELECT daily_spend_used FROM actors WHERE pubkey = ?').get('sess-buyer-a')
    assert('Buyer daily_spend_used after close = 50', buyerAfterClose.daily_spend_used === 50, buyerAfterClose.daily_spend_used)

    // Test 6: topup re-activates exhausted session
    console.log('\nTest 6: Topup re-activates exhausted session')
    // Need a fresh exhausted session
    prepare('UPDATE actors SET daily_spend_used = 0 WHERE pubkey = ?').run('sess-buyer-a')
    const r6open = await api('POST', '/sessions', {
      buyer_pubkey: 'sess-buyer-a',
      seller_pubkey: 'sess-seller-a',
      capability_tag: schemaTag,
      budget_sats: 10
    })
    assert('Open second session', r6open.status === 201, r6open.status)
    const sid2 = r6open.body.id
    await api('POST', '/sessions/' + sid2 + '/call', {})  // exhaust (10 sats used)
    const r6state = prepare('SELECT status FROM sessions WHERE id = ?').get(sid2)
    assert('Session is exhausted before topup', r6state.status === 'exhausted', r6state.status)
    const r6 = await api('POST', '/sessions/' + sid2 + '/topup', { amount_sats: 30 })
    assert('Topup returns 200', r6.status === 200, r6.status)
    assert('Status active after topup', r6.body.status === 'active', r6.body.status)
    assert('budget_sats = 40', r6.body.budget_sats === 40, r6.body.budget_sats)
    assert('remaining_budget = 30', r6.body.remaining_budget === 30, r6.body.remaining_budget)

    // Test 7: topup on closed session returns 409
    console.log('\nTest 7: Topup on closed session')
    await api('POST', '/sessions/' + sid2 + '/close', {})
    const r7 = await api('POST', '/sessions/' + sid2 + '/topup', { amount_sats: 20 })
    assert('Topup on closed returns 409', r7.status === 409, r7.status)

    // Test 8: expiry (set expires_unix in the past)
    console.log('\nTest 8: Auto-expiry')
    prepare('UPDATE actors SET daily_spend_used = 0 WHERE pubkey = ?').run('sess-buyer-a')
    const r8open = await api('POST', '/sessions', {
      buyer_pubkey: 'sess-buyer-a',
      seller_pubkey: 'sess-seller-a',
      capability_tag: schemaTag,
      budget_sats: 50
    })
    const sid3 = r8open.body.id
    await api('POST', '/sessions/' + sid3 + '/call', {})
    // Set expiry in the past
    prepare('UPDATE sessions SET expires_unix = ? WHERE id = ?').run(now - 1, sid3)
    // Calling should trigger autoExpire
    const r8call = await api('POST', '/sessions/' + sid3 + '/call', {})
    assert('Call on expired returns 410', r8call.status === 410, r8call.status)
    assert('Error session_expired', r8call.body.error === 'session_expired', r8call.body.error)
    const expiredSess = prepare('SELECT status FROM sessions WHERE id = ?').get(sid3)
    assert('Session status is expired', expiredSess.status === 'expired', expiredSess.status)

    // Test 9: daily cap
    console.log('\nTest 9: Daily cap enforcement')
    prepare('UPDATE actors SET daily_spend_used = 180 WHERE pubkey = ?').run('sess-buyer-a')
    // buyer daily cap = 200, used = 180, remaining = 20 — budget 50 should fail
    const r9 = await api('POST', '/sessions', {
      buyer_pubkey: 'sess-buyer-a',
      seller_pubkey: 'sess-seller-a',
      capability_tag: schemaTag,
      budget_sats: 50
    })
    assert('Daily cap blocks open (budget > remaining)', r9.status === 422, r9.status)
    assert('Error daily_spend_cap_exceeded', r9.body.error === 'daily_spend_cap_exceeded', r9.body.error)
    // budget 20 should succeed
    const r9b = await api('POST', '/sessions', {
      buyer_pubkey: 'sess-buyer-a',
      seller_pubkey: 'sess-seller-a',
      capability_tag: schemaTag,
      budget_sats: 20
    })
    assert('Budget <= daily remaining: open succeeds', r9b.status === 201, r9b.status)
    await api('POST', '/sessions/' + r9b.body.id + '/close', {})

    // Test 10: chain depth
    console.log('\nTest 10: Chain depth check')
    prepare('UPDATE actors SET daily_spend_used = 0 WHERE pubkey = ?').run('sess-buyer-a')
    // seller chain_depth_max = 5, open with chain_depth 5 should fail
    const r10 = await api('POST', '/sessions', {
      buyer_pubkey: 'sess-buyer-a',
      seller_pubkey: 'sess-seller-a',
      capability_tag: schemaTag,
      budget_sats: 20,
      chain_depth: 5
    })
    assert('chain_depth >= chain_depth_max blocked', r10.status === 422, r10.status)
    assert('Error chain_depth_exceeded', r10.body.error === 'chain_depth_exceeded', r10.body.error)
    // chain_depth 4 should succeed
    const r10b = await api('POST', '/sessions', {
      buyer_pubkey: 'sess-buyer-a',
      seller_pubkey: 'sess-seller-a',
      capability_tag: schemaTag,
      budget_sats: 20,
      chain_depth: 4
    })
    assert('chain_depth < chain_depth_max: open succeeds', r10b.status === 201, r10b.status)
    await api('POST', '/sessions/' + r10b.body.id + '/close', {})

    // Test 11: spend_cap_per_session
    console.log('\nTest 11: spend_cap_per_session enforcement')
    prepare('UPDATE actors SET daily_spend_used = 0 WHERE pubkey = ?').run('sess-buyer-a')
    // buyer spend_cap_per_session = 100, budget 150 > 100 should fail
    const r11 = await api('POST', '/sessions', {
      buyer_pubkey: 'sess-buyer-a',
      seller_pubkey: 'sess-seller-a',
      capability_tag: schemaTag,
      budget_sats: 150
    })
    assert('spend_cap_per_session blocks oversized budget', r11.status === 422, r11.status)
    assert('Error spend_cap_per_session_exceeded', r11.body.error === 'spend_cap_per_session_exceeded', r11.body.error)

    // Test 12: spend_cap_per_call
    console.log('\nTest 12: spend_cap_per_call enforcement')
    // Give BUYER a per-call cap of 5 sats — seller price is 10, so 10 > 5 should block open
    prepare('UPDATE actors SET spend_cap_per_call = ? WHERE pubkey = ?')
      .run(JSON.stringify({ [schemaTag]: 5 }), 'sess-buyer-a')
    const r12 = await api('POST', '/sessions', {
      buyer_pubkey: 'sess-buyer-a',
      seller_pubkey: 'sess-seller-a',
      capability_tag: schemaTag,
      budget_sats: 50
    })
    // The call cap check on seller side: price 10 > cap 5 should block or... actually
    // spend_cap_per_call is a BUYER cap — buyer declares max sats per call they allow seller to charge
    assert('spend_cap_per_call: seller price > buyer per-call cap blocks open', r12.status === 422, r12.status)

    server2.close()
    console.log('\n-----------------------------------------')
    console.log('Results:', passed, 'passed,', failed, 'failed')
    process.exit(failed > 0 ? 1 : 0)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
