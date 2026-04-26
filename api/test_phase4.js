/**
 * Phase 4 integration tests — Chains + Burning Rate Accounting
 *
 * Tests:
 *  1.  Sub-session opened: budget reserved from parent (parent.sats_used increases)
 *  2.  Sub-session missing expected_calls → 400
 *  3.  Over-commit rejected: sub-session cost > parent remaining_budget → 422
 *  4.  Budget returned to parent on sub-session close (parent.remaining_budget restored)
 *  5.  3-level chain: A→B→C all open; chain_depth increments correctly
 *  6.  chain_depth_max enforcement on 3rd level
 *  7.  Sub-session parent must be active (closed parent → 400)
 *  8.  Multiple sub-sessions total over parent budget → second rejected
 *  9.  chain_parent_id on requests: child request linked to parent
 * 10.  chain_depth derived from parent request
 * 11.  chain_parent_id must reference existing request → 400 if not found
 * 12.  Partial payout: subtasks defined, some completed on terminal failure
 * 13.  Partial payout = 0 when subtasks_completed = 0 (full refund)
 * 14.  Full payout on pass even with subtasks defined
 * 15.  GET /requests filter by chain_parent_id
 */

'use strict'
const path = require('path')

// ── Bootstrap DB ─────────────────────────────────────────────────────────────
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

  // ── Fixtures ────────────────────────────────────────────────────────────────
  const TAG   = 'p4-capability'
  const now   = Math.floor(Date.now() / 1000)
  const far   = now + 86400

  // Clean up
  prepare("DELETE FROM sessions         WHERE buyer_pubkey  LIKE 'p4-%' OR seller_pubkey LIKE 'p4-%'").run()
  prepare("DELETE FROM requests         WHERE buyer_pubkey  LIKE 'p4-%'").run()
  prepare("DELETE FROM results          WHERE seller_pubkey LIKE 'p4-%'").run()
  prepare("DELETE FROM transaction_log  WHERE actor_pubkey  LIKE 'p4-%'").run()
  prepare("DELETE FROM actors           WHERE pubkey        LIKE 'p4-%'").run()
  prepare("DELETE FROM schemas          WHERE capability_tag = ?").run(TAG)

  // Schema
  prepare(`INSERT INTO schemas (capability_tag, display_name, description, input_schema, output_schema, strength_score, is_platform_template, created_at)
    VALUES (?,?,?,?,?,70,0,?)`)
    .run(TAG, 'P4 Cap', 'phase4',
      JSON.stringify({ type:'object', properties:{ text:{ type:'string' } }, required:['text'] }),
      JSON.stringify({ type:'object', properties:{ result:{ type:'string' } }, required:['result'] }),
      now)

  function mkActor(pubkey, pricePerCall, daily, sessionCap, chainMax) {
    prepare(`INSERT INTO actors
      (pubkey,type,owner_pubkey,display_name,registered_at,capabilities,price_per_call_sats,
       spend_cap_per_call,spend_cap_per_session,spend_cap_daily_sats,daily_spend_used,daily_spend_reset_at,
       endpoint_url,status,webhook_url,reliability_score,certification_tier,cert_expiry,chain_depth_max)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)`)
      .run(pubkey, 'agent', null, pubkey, now,
        JSON.stringify([TAG]),
        JSON.stringify({ [TAG]: pricePerCall }),
        JSON.stringify({}),
        sessionCap || 9999999,
        daily      || 9999999,
        far,
        'http://' + pubkey + '.local',
        'active', null, 50.0,
        JSON.stringify({ [TAG]: 'Unverified' }), '{}',
        chainMax !== undefined ? chainMax : 5)
  }

  // Agents: agentA is buyer/orchestrator; agentB & agentC are sellers/sub-agents
  mkActor('p4-agentA', 10, 9999999, 9999999, 5)  // A: price 10 (as seller)
  mkActor('p4-agentB', 8,  9999999, 9999999, 5)  // B: price  8 (as seller)
  mkActor('p4-agentC', 5,  9999999, 9999999, 5)  // C: price  5 (as seller)
  mkActor('p4-human',  0,  9999999, 9999999, 5)  // human buyer (root)

  // Helper: inline route simulation (same pattern as test_phase2/3)
  const sessRoute = require('./routes/sessions')
  const reqRoute  = require('./routes/requests')
  const resRoute  = require('./routes/results')

  function fakeReq(params={}, body={}, query={}) { return { params, body, query } }
  function fakeRes() {
    const r = { _status: 200, _body: null }
    r.status = (s) => { r._status = s; return r }
    r.json   = (b) => { r._body = b; return r }
    return r
  }

  function openSession(body) {
    const rq = fakeReq({}, body)
    const rs = fakeRes()
    sessRoute.handle ? sessRoute.handle(rq, rs) : sessRoute(rq, rs, () => {})
    // Use the router directly via internal POST handler
    return callRoute(sessRoute, 'POST', '/', body)
  }
  function closeSession(id) { return callRoute(sessRoute, 'POST', '/' + id + '/close', {}) }
  function postRequest(body) { return callRoute(reqRoute, 'POST', '/', body) }
  function getRequest(id)    { return callRoute(reqRoute, 'GET', '/' + id, {}) }
  function selectSeller(id, seller) { return callRoute(reqRoute, 'POST', '/' + id + '/select', { seller_pubkey: seller }) }
  function submitResult(req_id, seller, payload, extras) {
    return callRoute(resRoute, 'POST', '/' + req_id, { seller_pubkey: seller, output_payload: payload, ...extras })
  }

  // Minimal inline router caller (avoids needing live HTTP server)
  function callRoute(router, method, url, body) {
    return new Promise((resolve) => {
      const req = {
        method,
        url,
        path: url.split('?')[0],
        params: {},
        body: body || {},
        query: {}
      }
      // extract :id style param from url
      const idMatch = url.match(/^\/([^\/]+)/)
      if (idMatch && idMatch[1] !== '') req.params.id = idMatch[1]
      // for results: :request_id
      req.params.request_id = req.params.id

      const res = fakeRes()
      res.json = (b) => { res._body = b; resolve(res); return res }

      // Walk router stack and call matching layer
      let handled = false
      for (const layer of router.stack) {
        const match = layer.match(req.path)
        if (!match) continue
        if (layer.route) {
          if (!layer.route._handles_method(method)) continue
          req.params = { ...req.params, ...match.params }
          handled = true
          const stack = layer.route.stack
          let i = 0
          function next(err) {
            if (err || i >= stack.length) { if (!handled) resolve(res); return }
            const fn = stack[i++]
            try { fn.handle(req, res, next) } catch(e) { console.error(e); resolve(res) }
          }
          next()
          break
        }
      }
      if (!handled) {
        res._status = 404
        res._body = { error: 'route_not_found' }
        resolve(res)
      }
    })
  }

  // ── Direct DB helpers (faster than HTTP for chain tests) ──────────────────
  function dbOpenSession(buyer, seller, budgetOrExpected, parentId) {
    const body = parentId
      ? { buyer_pubkey: buyer, seller_pubkey: seller, capability_tag: TAG,
          expires_unix: far, parent_session_id: parentId, expected_calls: budgetOrExpected }
      : { buyer_pubkey: buyer, seller_pubkey: seller, capability_tag: TAG,
          budget_sats: budgetOrExpected, expires_unix: far }

    const rq = fakeReq({}, body)
    const rs = fakeRes()
    let result = null
    rs.json = (b) => { rs._body = b; result = rs; return rs }

    // Manually invoke the POST handler (first route in stack)
    const postHandler = sessRoute.stack.find(l => l.route && l.route.path === '/' && l.route._handles_method('POST'))
    if (!postHandler) { rs._status = 500; return rs }
    postHandler.route.stack[0].handle(rq, rs, () => {})
    return rs
  }

  function dbGetSession(id) {
    return prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 1: Sub-session budget reserved from parent
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 1] Sub-session reserves budget from parent')
  {
    const root = dbOpenSession('p4-human', 'p4-agentA', 200)
    assert('Root session created', root._status === 201, root._body)
    const rootId = root._body.id

    const rootBefore = dbGetSession(rootId)
    const sub = dbOpenSession('p4-agentA', 'p4-agentB', 5, rootId)  // expected_calls=5, price=8 → budget=40
    assert('Sub-session created (201)', sub._status === 201, sub._body)

    if (sub._status === 201) {
      const rootAfter = dbGetSession(rootId)
      assert('Root sats_used increased by sub-session budget (40)', rootAfter.sats_used === 40, rootAfter.sats_used)
      assert('Sub-session budget_sats = 5×8 = 40', sub._body.budget_sats === 40, sub._body.budget_sats)
      assert('Sub-session chain_depth = 1', sub._body.chain_depth === 1, sub._body.chain_depth)
      assert('Sub-session parent_session_id set', sub._body.parent_session_id === rootId, sub._body.parent_session_id)
    }

    // cleanup
    prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(rootId)
    if (sub._status === 201) prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(sub._body.id)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 2: Missing expected_calls when parent_session_id provided → 400
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 2] Missing expected_calls → 400')
  {
    const root = dbOpenSession('p4-human', 'p4-agentA', 100)
    const rootId = root._body.id

    const body = { buyer_pubkey: 'p4-agentA', seller_pubkey: 'p4-agentB', capability_tag: TAG,
                   budget_sats: 40, expires_unix: far, parent_session_id: rootId }
    const rq = fakeReq({}, body)
    const rs = fakeRes()
    let result = null
    rs.json = (b) => { rs._body = b; result = b; return rs }
    const postH = sessRoute.stack.find(l => l.route && l.route.path === '/' && l.route._handles_method('POST'))
    postH.route.stack[0].handle(rq, rs, () => {})
    assert('Missing expected_calls returns 400', rs._status === 400, rs._body)
    assert('Error is missing_expected_calls', rs._body.error === 'missing_expected_calls', rs._body.error)

    prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(rootId)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 3: Over-commit → 422 (sub-session cost > parent remaining_budget)
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 3] Over-commit rejected (sub cost > parent remaining)')
  {
    const root = dbOpenSession('p4-human', 'p4-agentA', 30)  // budget=30, agentA price=10
    const rootId = root._body.id
    assert('Root session (budget=30) created', root._status === 201, root._body)

    // agentB price=8, expected_calls=10 → cost=80 > 30
    const sub = dbOpenSession('p4-agentA', 'p4-agentB', 10, rootId)
    assert('Over-commit returns 422', sub._status === 422, sub._body)
    assert('Error is parent_budget_exceeded', sub._body && sub._body.error === 'parent_budget_exceeded', sub._body)

    prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(rootId)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 4: Budget returned to parent on sub-session close
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 4] Budget returned to parent on sub-session close')
  {
    const root = dbOpenSession('p4-human', 'p4-agentA', 200)
    const rootId = root._body.id

    // Open sub-session: 5 expected_calls × 8 = 40 reserved from parent
    const sub  = dbOpenSession('p4-agentA', 'p4-agentB', 5, rootId)
    const subId = sub._body.id
    assert('Sub-session opened', sub._status === 201, sub._body)

    // Make 2 calls (2×8 = 16 sats_used)
    for (let i = 0; i < 2; i++) {
      const callBody = { buyer_pubkey: 'p4-agentA' }
      const rq = fakeReq({ id: subId }, callBody)
      const rs = fakeRes()
      rs.json = (b) => { rs._body = b; return rs }
      const postH = sessRoute.stack.find(l => l.route && l.route.path === '/:id/call' && l.route._handles_method('POST'))
      postH.route.stack[0].handle(rq, rs, () => {})
    }

    const subBeforeClose = dbGetSession(subId)
    const rootBeforeClose = dbGetSession(rootId)

    // Close sub-session
    const closeRq = fakeReq({ id: subId }, {})
    const closeRs = fakeRes()
    closeRs.json = (b) => { closeRs._body = b; return closeRs }
    const closeH = sessRoute.stack.find(l => l.route && l.route.path === '/:id/close' && l.route._handles_method('POST'))
    closeH.route.stack[0].handle(closeRq, closeRs, () => {})

    const rootAfterClose = dbGetSession(rootId)
    // 40 was reserved; 16 used; 24 refunded → parent sats_used should be 40-24 = 16
    const expectedParentUsed = rootBeforeClose.sats_used - (sub._body.budget_sats - 16)
    assert('Root sats_used reduced by refunded amount after sub close',
      rootAfterClose.sats_used === expectedParentUsed,
      { root_before: rootBeforeClose.sats_used, root_after: rootAfterClose.sats_used, expected: expectedParentUsed })
    assert('Sub-session closed with buyer_refund_sats = 24',
      closeRs._body && closeRs._body.buyer_refund_sats === 24, closeRs._body)

    prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(rootId)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 5: 3-level chain — A→B→C, chain_depth increments
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 5] 3-level chain: depth increments at each level')
  {
    const rootSess  = dbOpenSession('p4-human', 'p4-agentA', 500)
    const sessAId   = rootSess._body.id
    assert('Level-0 session created (depth 0)', rootSess._status === 201 && rootSess._body.chain_depth === 0, rootSess._body)

    const subB = dbOpenSession('p4-agentA', 'p4-agentB', 5, sessAId)  // 5×8=40
    assert('Level-1 sub-session (depth 1)', subB._status === 201 && subB._body.chain_depth === 1, subB._body)

    const subC = dbOpenSession('p4-agentB', 'p4-agentC', 4, subB._body.id)  // 4×5=20
    assert('Level-2 sub-sub-session (depth 2)', subC._status === 201 && subC._body.chain_depth === 2, subC._body)

    // Verify budget cascade: subB.sats_used was increased by subC's budget (20)
    const subBDb = dbGetSession(subB._body.id)
    assert('subB.sats_used includes subC reservation (20)', subBDb.sats_used === 20, subBDb.sats_used)

    // Close in order C→B→A
    const closeH = sessRoute.stack.find(l => l.route && l.route.path === '/:id/close' && l.route._handles_method('POST'))
    function closeSess(id) {
      const rq = fakeReq({ id }, {})
      const rs = fakeRes()
      rs.json = (b) => { rs._body = b; return rs }
      closeH.route.stack[0].handle(rq, rs, () => {})
      return rs
    }

    closeSess(subC._body.id)
    closeSess(subB._body.id)
    closeSess(sessAId)

    const rootFinal = dbGetSession(sessAId)
    assert('Root session closed after chain unwind', rootFinal.status === 'closed', rootFinal.status)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 6: chain_depth_max enforcement
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 6] chain_depth_max = 2 blocks depth-2 sub-session')
  {
    // agentC has chain_depth_max = 2 as seller, so it can be opened at depth 0 or 1
    // Create a session at depth 1 pointing to agentC as seller
    const root = dbOpenSession('p4-human', 'p4-agentA', 300)
    const sub1 = dbOpenSession('p4-agentA', 'p4-agentB', 5, root._body.id)  // depth 1

    // Try to open at depth 2 — agentC has chain_depth_max 5 by default, so
    // let's use a purpose-made agent with chain_depth_max 2
    prepare(`INSERT INTO actors
      (pubkey,type,owner_pubkey,display_name,registered_at,capabilities,price_per_call_sats,
       spend_cap_per_call,spend_cap_per_session,spend_cap_daily_sats,daily_spend_used,daily_spend_reset_at,
       endpoint_url,status,webhook_url,reliability_score,certification_tier,cert_expiry,chain_depth_max)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)`)
      .run('p4-agentD', 'agent', null, 'Agent D', now,
        JSON.stringify([TAG]), JSON.stringify({ [TAG]: 3 }),
        JSON.stringify({}), 9999999, 9999999, far,
        'http://p4-agentD.local', 'active', null, 50.0,
        JSON.stringify({ [TAG]: 'Unverified' }), '{}',
        2)  // chain_depth_max = 2 → cannot be seller at depth >= 2

    // sub1 is at depth 1; opening with agentD as seller → would be depth 2 ≥ agentD.chain_depth_max(2) → blocked
    const sub2 = dbOpenSession('p4-agentB', 'p4-agentD', 3, sub1._body.id)
    assert('Depth 2 with agentD (max=2) rejected → 422', sub2._status === 422, sub2._body)
    assert('Error is chain_depth_exceeded', sub2._body && sub2._body.error === 'chain_depth_exceeded', sub2._body)

    prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(root._body.id)
    prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(sub1._body.id)
    prepare("DELETE FROM actors WHERE pubkey = 'p4-agentD'").run()
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 7: Parent session must be active (closed parent → 400)
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 7] Closed parent session → 400 parent_not_active')
  {
    const root = dbOpenSession('p4-human', 'p4-agentA', 100)
    prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(root._body.id)

    const sub = dbOpenSession('p4-agentA', 'p4-agentB', 3, root._body.id)
    assert('Closed parent → 400', sub._status === 400, sub._body)
    assert('Error is parent_not_active', sub._body && sub._body.error === 'parent_not_active', sub._body)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 8: Multiple sub-sessions — second rejected when total exceeds parent budget
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 8] Second sub-session rejected when cumulative cost exceeds parent budget')
  {
    const root = dbOpenSession('p4-human', 'p4-agentA', 50)  // budget=50 as root
    // First sub: 5 × 8 = 40 → parent.sats_used = 40, remaining = 10
    const sub1 = dbOpenSession('p4-agentA', 'p4-agentB', 5, root._body.id)
    assert('First sub-session (cost=40) OK', sub1._status === 201, sub1._body)

    // Second sub: 2 × 8 = 16 > remaining(10) → reject
    const sub2 = dbOpenSession('p4-agentA', 'p4-agentB', 2, root._body.id)
    assert('Second sub-session (cost=16 > remaining=10) rejected', sub2._status === 422, sub2._body)
    assert('Error is parent_budget_exceeded', sub2._body && sub2._body.error === 'parent_budget_exceeded', sub2._body)

    prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(root._body.id)
    if (sub1._status === 201) prepare("UPDATE sessions SET status='closed' WHERE id = ?").run(sub1._body.id)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 9: chain_parent_id on requests links child to parent
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 9] chain_parent_id on requests')
  {
    // Create a seller so buildShortlist can find someone
    const sellers = prepare("SELECT pubkey FROM actors WHERE pubkey LIKE 'p4-%' AND status='active' AND json_extract(capabilities,'$') LIKE '%p4-capability%'").all()

    const rootReq = prepare("INSERT INTO requests (id, buyer_pubkey, capability_tag, input_payload, budget_sats, status, shortlist, selected_seller, deadline_unix, created_at, funded_at, matched_at, completed_at, retry_count, chain_parent_id, chain_depth, subtasks, subtasks_completed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,NULL,0,NULL,0)")
    const rootId = require('uuid').v4()
    prepare("INSERT INTO requests (id, buyer_pubkey, capability_tag, input_payload, budget_sats, status, shortlist, selected_seller, deadline_unix, created_at, funded_at, matched_at, completed_at, retry_count, chain_parent_id, chain_depth, subtasks, subtasks_completed) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,NULL,NULL,0,NULL,0,NULL,0)")
      .run(rootId, 'p4-human', TAG, JSON.stringify({ text: 'root task' }), 100, 'in_progress', '[]', far, now, now)

    // Post a child request with chain_parent_id
    const childReqBody = {
      buyer_pubkey:    'p4-human',
      capability_tag:  TAG,
      input_payload:   { text: 'sub task' },
      budget_sats:     20,
      chain_parent_id: rootId
    }
    const rq = fakeReq({}, childReqBody)
    const rs = fakeRes()
    rs.json = (b) => { rs._body = b; return rs }
    const postH = reqRoute.stack.find(l => l.route && l.route.path === '/' && l.route._handles_method('POST'))
    postH.route.stack[0].handle(rq, rs, () => {})

    assert('Child request created (201)', rs._status === 201, rs._body)
    if (rs._status === 201) {
      assert('chain_parent_id set correctly', rs._body.chain_parent_id === rootId, rs._body.chain_parent_id)
      assert('chain_depth = 1 (derived from parent)', rs._body.chain_depth === 1, rs._body.chain_depth)
    }

    prepare("DELETE FROM requests WHERE id = ?").run(rootId)
    if (rs._body && rs._body.id) prepare("DELETE FROM requests WHERE id = ?").run(rs._body.id)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 10: chain_parent_id must reference existing request
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 10] chain_parent_id references non-existent request → 400')
  {
    const body = {
      buyer_pubkey:    'p4-human',
      capability_tag:  TAG,
      input_payload:   { text: 'orphan' },
      budget_sats:     20,
      chain_parent_id: '00000000-0000-0000-0000-000000000000'
    }
    const rq = fakeReq({}, body)
    const rs = fakeRes()
    rs.json = (b) => { rs._body = b; return rs }
    const postH = reqRoute.stack.find(l => l.route && l.route.path === '/' && l.route._handles_method('POST'))
    postH.route.stack[0].handle(rq, rs, () => {})
    assert('Non-existent chain_parent_id → 400', rs._status === 400, rs._body)
    assert('Error is chain_parent_not_found', rs._body.error === 'chain_parent_not_found', rs._body.error)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 11: Partial payout when subtasks defined and some completed
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 11] Partial payout on terminal failure (subtasks_completed=2 of 4)')
  {
    // Insert a seller with capability
    const sellerId = 'p4-agentA'
    const reqId = require('uuid').v4()
    const subtasks = ['task1', 'task2', 'task3', 'task4']

    // Directly insert a request in 'in_progress' with subtasks
    prepare("INSERT INTO requests (id, buyer_pubkey, capability_tag, input_payload, budget_sats, status, shortlist, selected_seller, deadline_unix, created_at, funded_at, matched_at, completed_at, retry_count, chain_parent_id, chain_depth, subtasks, subtasks_completed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,1,NULL,0,?,0)")
      .run(reqId, 'p4-human', TAG, JSON.stringify({ text: 'partial work' }), 100,
           'in_progress', '[]', sellerId, far, now, now, now, JSON.stringify(subtasks))

    const { settleFailure } = require('./lib/settlement')
    const result = settleFailure(reqId, true, 2)  // isRetry=true, completed=2

    assert('Partial payout returned (partial=true)', result.partial === true, result)
    assert('payout_sats = 48 (earned=50, fee=floor(2.5)=2, payout=48)', result.payout_sats === 48, result.payout_sats)
    assert('refund_sats = 100 - 50 = 50', result.refund_sats === 50, result.refund_sats)

    const reqDb = prepare('SELECT * FROM requests WHERE id = ?').get(reqId)
    assert('Request status = completed (partial)', reqDb.status === 'completed', reqDb.status)
    assert('subtasks_completed = 2 persisted', reqDb.subtasks_completed === 2, reqDb.subtasks_completed)

    prepare("DELETE FROM requests WHERE id = ?").run(reqId)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 12: Full refund when subtasks_completed = 0
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 12] Full refund when subtasks_completed = 0')
  {
    const reqId = require('uuid').v4()
    prepare("INSERT INTO requests (id, buyer_pubkey, capability_tag, input_payload, budget_sats, status, shortlist, selected_seller, deadline_unix, created_at, funded_at, matched_at, completed_at, retry_count, chain_parent_id, chain_depth, subtasks, subtasks_completed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,1,NULL,0,?,0)")
      .run(reqId, 'p4-human', TAG, JSON.stringify({ text: 'zero done' }), 100,
           'in_progress', '[]', 'p4-agentA', far, now, now, now,
           JSON.stringify(['t1','t2','t3']))

    const { settleFailure } = require('./lib/settlement')
    const result = settleFailure(reqId, true, 0)
    assert('No partial payout when completed=0 (partial=false)', result.partial === false, result)
    assert('Retry is false', result.retry === false, result)

    const reqDb = prepare('SELECT * FROM requests WHERE id = ?').get(reqId)
    assert('Request status = failed', reqDb.status === 'failed', reqDb.status)
    prepare("DELETE FROM requests WHERE id = ?").run(reqId)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 13: Full payout on schema pass even with subtasks defined
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 13] Full payout on schema pass even with subtasks defined')
  {
    const reqId = require('uuid').v4()
    prepare("INSERT INTO requests (id, buyer_pubkey, capability_tag, input_payload, budget_sats, status, shortlist, selected_seller, deadline_unix, created_at, funded_at, matched_at, completed_at, retry_count, chain_parent_id, chain_depth, subtasks, subtasks_completed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,NULL,0,?,0)")
      .run(reqId, 'p4-human', TAG, JSON.stringify({ text: 'all done' }), 80,
           'in_progress', '[]', 'p4-agentA', far, now, now, now,
           JSON.stringify(['t1','t2']))

    const { settleSuccess } = require('./lib/settlement')
    settleSuccess(reqId, 2)

    const reqDb = prepare('SELECT * FROM requests WHERE id = ?').get(reqId)
    assert('Request status = completed', reqDb.status === 'completed', reqDb.status)
    assert('Full seller_payout = floor(80 × 0.95) = 76', reqDb.seller_payout_sats === 76, reqDb.seller_payout_sats)
    assert('subtasks_completed = 2 persisted', reqDb.subtasks_completed === 2, reqDb.subtasks_completed)
    prepare("DELETE FROM requests WHERE id = ?").run(reqId)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Test 14: GET /requests with chain_parent_id filter
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n[Test 14] GET /requests?chain_parent_id filter')
  {
    const parentId = require('uuid').v4()
    const childId  = require('uuid').v4()
    prepare("INSERT INTO requests (id, buyer_pubkey, capability_tag, input_payload, budget_sats, status, shortlist, selected_seller, deadline_unix, created_at, funded_at, matched_at, completed_at, retry_count, chain_parent_id, chain_depth, subtasks, subtasks_completed) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,NULL,NULL,0,NULL,0,NULL,0)")
      .run(parentId, 'p4-human', TAG, JSON.stringify({ text: 'parent' }), 50, 'in_progress', '[]', far, now, now)
    prepare("INSERT INTO requests (id, buyer_pubkey, capability_tag, input_payload, budget_sats, status, shortlist, selected_seller, deadline_unix, created_at, funded_at, matched_at, completed_at, retry_count, chain_parent_id, chain_depth, subtasks, subtasks_completed) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,NULL,NULL,0,?,1,NULL,0)")
      .run(childId, 'p4-human', TAG, JSON.stringify({ text: 'child' }), 20, 'in_progress', '[]', far, now, now, parentId)

    const rq = fakeReq({}, {}, { buyer_pubkey: 'p4-human', chain_parent_id: parentId })
    const rs = fakeRes()
    rs.json = (b) => { rs._body = b; return rs }
    const getH = reqRoute.stack.find(l => l.route && l.route.path === '/' && l.route._handles_method('GET'))
    getH.route.stack[0].handle(rq, rs, () => {})

    assert('GET /requests?chain_parent_id returns 200', rs._status === 200, rs._body)
    assert('Exactly 1 child request returned', rs._body && rs._body.count === 1, rs._body)
    assert('Returned request has correct chain_parent_id', rs._body && rs._body.requests[0].chain_parent_id === parentId, rs._body)

    prepare("DELETE FROM requests WHERE id IN (?,?)").run(parentId, childId)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Summary
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50))
  console.log('Phase 4 results: ' + passed + '/' + (passed + failed) + ' passed')
  if (failed > 0) {
    console.error(failed + ' test(s) FAILED')
    process.exit(1)
  } else {
    console.log('All tests passed ✓')
  }
}

run().catch(e => { console.error(e); process.exit(1) })
