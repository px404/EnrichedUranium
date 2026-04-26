/**
 * Phase 3 integration tests — Reliability Scoring + Market Intelligence.
 *
 * Tests:
 *   1.  Reliability score: actor with 0 transactions stays at 50.0
 *   2.  Reliability score: high-volume successful seller > 50
 *   3.  Reliability score: low-volume actor regresses toward 50
 *   4.  Reliability score: weighted formula (delivery + schema + acceptance + response)
 *   5.  Reliability cache row written for overall + each capability
 *   6.  Bad-faith detection flags malicious buyer
 *   7.  Bad-faith filter excludes flagged buyer's failures from seller score
 *   8.  GET /market/pricing/:capability_tag returns aggregates
 *   9.  GET /market/pricing rejects unknown capability with 404
 *  10.  GET /market/quality/:capability_tag returns cert tier counts + median
 *  11.  GET /market/compare/:capability_tag — sort by value_index (default)
 *  12.  GET /market/compare — sort by price (ascending)
 *  13.  GET /market/compare — min_cert_tier filter
 *  14.  GET /market/trust/:capability_tag — cert density adds to ~1
 *  15.  Market endpoint validates window param
 *  16.  Reliability suspended actor is still recomputed
 */

'use strict'

const { getDb, prepare } = require('./db/database')
const { v4: uuidv4 }     = require('uuid')

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

  // ── Clean slate (only Phase 3 fixtures) ────────────────────────────────────
  prepare("DELETE FROM bad_faith_flags WHERE buyer_pubkey LIKE 'p3-%' OR seller_pubkey LIKE 'p3-%'").run()
  prepare("DELETE FROM reliability_score_cache WHERE actor_pubkey LIKE 'p3-%'").run()
  prepare("DELETE FROM transaction_log WHERE actor_pubkey LIKE 'p3-%'").run()
  prepare("DELETE FROM results WHERE seller_pubkey LIKE 'p3-%'").run()
  prepare("DELETE FROM requests WHERE buyer_pubkey LIKE 'p3-%' OR selected_seller LIKE 'p3-%'").run()
  prepare("DELETE FROM actors WHERE pubkey LIKE 'p3-%'").run()
  prepare("DELETE FROM schemas WHERE capability_tag IN ('p3-sum','p3-trans')").run()

  const now = Math.floor(Date.now() / 1000)

  // ── Seed: two capability schemas ───────────────────────────────────────────
  for (const tag of ['p3-sum','p3-trans']) {
    prepare(`INSERT INTO schemas
      (capability_tag, display_name, description, input_schema, output_schema, strength_score, is_platform_template, created_at)
      VALUES (?,?,?,?,?,80,0,?)`)
      .run(
        tag, 'P3 ' + tag, 'phase3 fixture',
        JSON.stringify({ type: 'object', properties: { x: { type: 'string' } }, required: ['x'] }),
        JSON.stringify({ type: 'object', properties: { y: { type: 'string' } }, required: ['y'] }),
        now
      )
  }

  // ── Seed: actors ───────────────────────────────────────────────────────────
  function seedActor(pubkey, role, opts = {}) {
    const caps     = opts.capabilities || []
    const prices   = opts.prices       || {}
    const status   = opts.status       || 'active'
    const certTier = opts.certTier     || {}
    const score    = opts.score != null ? opts.score : 50.0
    const ownerPubkey = role === 'agent' ? (opts.owner || 'p3-owner') : null
    prepare(`INSERT INTO actors
      (pubkey,type,owner_pubkey,display_name,registered_at,capabilities,price_per_call_sats,
       spend_cap_per_call,spend_cap_per_session,spend_cap_daily_sats,daily_spend_used,daily_spend_reset_at,
       endpoint_url,status,webhook_url,reliability_score,certification_tier,cert_expiry,chain_depth_max)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        pubkey, role, ownerPubkey, pubkey, now,
        JSON.stringify(caps), JSON.stringify(prices),
        '{}', 100000, 1000000, 0, now,
        role === 'agent' ? 'http://' + pubkey + '.local' : null,
        status, null, score,
        JSON.stringify(certTier), '{}', 5
      )
  }

  seedActor('p3-owner',         'human')
  seedActor('p3-buyer',         'human')
  seedActor('p3-buyer-bad',     'human')   // dispute-prone buyer
  seedActor('p3-seller-zero',   'agent', { capabilities: ['p3-sum'],   prices: { 'p3-sum': 5  } })
  seedActor('p3-seller-pro',    'agent', { capabilities: ['p3-sum'],   prices: { 'p3-sum': 4  }, certTier: { 'p3-sum': 'Verified' } })
  seedActor('p3-seller-mid',    'agent', { capabilities: ['p3-sum'],   prices: { 'p3-sum': 6  }, certTier: { 'p3-sum': 'Basic'    } })
  seedActor('p3-seller-cheap',  'agent', { capabilities: ['p3-sum'],   prices: { 'p3-sum': 2  } })
  seedActor('p3-seller-multi',  'agent', { capabilities: ['p3-sum','p3-trans'], prices: { 'p3-sum': 7, 'p3-trans': 8 }, certTier: { 'p3-sum': 'Elite' } })
  seedActor('p3-seller-suspended','agent', { capabilities: ['p3-sum'], prices: { 'p3-sum': 3 }, status: 'suspended' })

  // ── Seed: transaction history ──────────────────────────────────────────────
  function seedRequest(buyer, seller, capTag, status, retryCount = 0, ageS = 3600) {
    const id = uuidv4()
    const created   = now - ageS
    const completed = status === 'completed' ? created + 60 : null
    prepare(`INSERT INTO requests
      (id, buyer_pubkey, capability_tag, input_payload, budget_sats,
       status, shortlist, selected_seller, deadline_unix,
       created_at, funded_at, matched_at, completed_at, retry_count, platform_fee_sats, seller_payout_sats)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id, buyer, capTag, '{"x":"q"}', 10,
        status, JSON.stringify([seller]), seller,
        created + 1800,                                 // deadline
        created, created, created + 1, completed,
        retryCount,
        status === 'completed' ? 1 : null,
        status === 'completed' ? 9 : null
      )
    return id
  }
  function seedResult(requestId, seller, status) {
    prepare(`INSERT INTO results
      (id, request_id, seller_pubkey, output_payload, validation_status, validation_level, validation_error, submitted_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), requestId, seller, '{"y":"a"}', status, status === 'fail' ? 1 : null,
           status === 'fail' ? 'mock failure' : null, now - 100)
  }

  // p3-seller-pro: 12 completed requests for p3-sum (high volume, perfect)
  for (let i = 0; i < 12; i++) {
    const id = seedRequest('p3-buyer', 'p3-seller-pro', 'p3-sum', 'completed')
    seedResult(id, 'p3-seller-pro', 'pass')
  }

  // p3-seller-mid: 5 completed + 5 failed (mediocre)
  for (let i = 0; i < 5; i++) {
    const id = seedRequest('p3-buyer', 'p3-seller-mid', 'p3-sum', 'completed')
    seedResult(id, 'p3-seller-mid', 'pass')
  }
  for (let i = 0; i < 5; i++) {
    const id = seedRequest('p3-buyer', 'p3-seller-mid', 'p3-sum', 'failed', 2)
    seedResult(id, 'p3-seller-mid', 'fail')
  }

  // p3-seller-cheap: 3 completed (low volume — should regress toward 50)
  for (let i = 0; i < 3; i++) {
    const id = seedRequest('p3-buyer', 'p3-seller-cheap', 'p3-sum', 'completed')
    seedResult(id, 'p3-seller-cheap', 'pass')
  }

  // p3-seller-multi: 4 completed in p3-sum + 6 completed in p3-trans
  for (let i = 0; i < 4; i++) {
    const id = seedRequest('p3-buyer', 'p3-seller-multi', 'p3-sum', 'completed')
    seedResult(id, 'p3-seller-multi', 'pass')
  }
  for (let i = 0; i < 6; i++) {
    const id = seedRequest('p3-buyer', 'p3-seller-multi', 'p3-trans', 'completed')
    seedResult(id, 'p3-seller-multi', 'pass')
  }

  // ── Recompute scores ──────────────────────────────────────────────────────
  const reliability = require('./lib/reliabilityScore')
  reliability.recomputeAll()

  // ── TEST 1: zero-history actor stays at 50 ─────────────────────────────────
  console.log('\nTest 1: zero-history actor remains at 50')
  const zero = prepare('SELECT reliability_score FROM actors WHERE pubkey = ?').get('p3-seller-zero')
  assert('p3-seller-zero score == 50.0', zero.reliability_score === 50.0, zero.reliability_score)

  // ── TEST 2: high-volume successful seller > 50 ─────────────────────────────
  console.log('\nTest 2: high-volume successful seller > 50')
  const pro = prepare('SELECT reliability_score FROM actors WHERE pubkey = ?').get('p3-seller-pro')
  assert('p3-seller-pro score > 50', pro.reliability_score > 50, pro.reliability_score)
  assert('p3-seller-pro score >= 90 (perfect record)', pro.reliability_score >= 90, pro.reliability_score)

  // ── TEST 3: low-volume actor regresses toward 50 ──────────────────────────
  console.log('\nTest 3: low-volume actor regresses toward 50')
  const cheap = prepare('SELECT reliability_score FROM actors WHERE pubkey = ?').get('p3-seller-cheap')
  // 3 perfect tasks: raw score = 100, blend = 3/10 → 100*0.3 + 50*0.7 = 65
  assert('p3-seller-cheap score between 50 and 80 (regressed)', cheap.reliability_score > 50 && cheap.reliability_score < 80, cheap.reliability_score)

  // ── TEST 4: weighted formula — mediocre seller hits the 50–80 band ────────
  console.log('\nTest 4: mid-quality seller falls below pro')
  const mid = prepare('SELECT reliability_score FROM actors WHERE pubkey = ?').get('p3-seller-mid')
  assert('mid score below pro score', mid.reliability_score < pro.reliability_score, { mid: mid.reliability_score, pro: pro.reliability_score })
  assert('mid score below 70 (50% delivery rate)', mid.reliability_score < 70, mid.reliability_score)

  // ── TEST 5: cache row written for overall + per capability ────────────────
  console.log('\nTest 5: cache contains overall + per-capability rows')
  const cacheRows = prepare(
    "SELECT capability_tag, score FROM reliability_score_cache WHERE actor_pubkey = ? ORDER BY capability_tag"
  ).all('p3-seller-multi')
  assert('multi-capability seller has 3 cache rows (* + 2 caps)', cacheRows.length === 3, cacheRows)
  const tags = cacheRows.map(r => r.capability_tag).sort()
  assert('cache covers *, p3-sum, p3-trans',
    tags[0] === '*' && tags.includes('p3-sum') && tags.includes('p3-trans'),
    tags
  )

  // ── TEST 6: bad-faith detection flags malicious buyer ─────────────────────
  console.log('\nTest 6: bad-faith detection flags malicious buyer')
  // bad buyer: 4 disputes against pro, while pro has 12 perfect with everyone else
  for (let i = 0; i < 4; i++) {
    const id = seedRequest('p3-buyer-bad', 'p3-seller-pro', 'p3-sum', 'failed', 2)
    seedResult(id, 'p3-seller-pro', 'fail')
  }
  reliability.evaluateBadFaith()
  const flag = prepare('SELECT * FROM bad_faith_flags WHERE buyer_pubkey = ? AND seller_pubkey = ?')
    .get('p3-buyer-bad', 'p3-seller-pro')
  assert('bad-faith flag exists for (buyer-bad, seller-pro)', !!flag, flag)
  assert('flag has detail JSON', flag && !!flag.detail, flag)

  // ── TEST 7: flagged buyer's failures excluded from seller score ───────────
  console.log('\nTest 7: bad-faith filter preserves seller score')
  reliability.recomputeAll()
  const proAfter = prepare('SELECT reliability_score FROM actors WHERE pubkey = ?').get('p3-seller-pro')
  // pro should still score >= 90 (4 bad-faith failures excluded, 12 honest passes remain)
  assert('p3-seller-pro retains score >= 85 after malicious fails', proAfter.reliability_score >= 85, proAfter.reliability_score)

  // ── Mount routes for HTTP tests ───────────────────────────────────────────
  const express = require('express')
  const app2    = express()
  app2.use(express.json())
  app2.use('/market', require('./routes/market'))

  const http = require('http')
  const server2 = http.createServer(app2)
  await new Promise(r => server2.listen(0, '127.0.0.1', r))
  const port = server2.address().port

  async function api(method, path) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path, method,
        headers: { 'Content-Type': 'application/json' }
      }, res => {
        let buf = ''
        res.on('data', c => buf += c)
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
          catch (_) { resolve({ status: res.statusCode, body: buf }) }
        })
      })
      req.on('error', reject)
      req.end()
    })
  }

  // ── TEST 8: GET /market/pricing/:capability_tag ────────────────────────────
  console.log('\nTest 8: GET /market/pricing aggregates')
  const r8 = await api('GET', '/market/pricing/p3-sum?window=30d')
  assert('pricing returns 200', r8.status === 200, r8)
  assert('pricing has price_median', typeof r8.body.price_median === 'number', r8.body.price_median)
  assert('pricing has transaction_count > 0', r8.body.transaction_count > 0, r8.body.transaction_count)
  assert('pricing.window echoes 30d', r8.body.window === '30d', r8.body.window)

  // ── TEST 9: pricing rejects unknown capability ─────────────────────────────
  console.log('\nTest 9: pricing 404 on unknown capability')
  const r9 = await api('GET', '/market/pricing/not-a-real-tag')
  assert('pricing returns 404 for unknown', r9.status === 404, r9.status)
  assert('error == unknown_capability', r9.body.error === 'unknown_capability', r9.body.error)

  // ── TEST 10: GET /market/quality/:capability_tag ───────────────────────────
  console.log('\nTest 10: GET /market/quality')
  const r10 = await api('GET', '/market/quality/p3-sum')
  assert('quality returns 200', r10.status === 200, r10.status)
  assert('quality has cert_tier_distribution', !!r10.body.cert_tier_distribution, r10.body)
  assert('quality has active_seller_count >= 4', r10.body.active_seller_count >= 4, r10.body.active_seller_count)
  assert('quality has median_reliability_score', typeof r10.body.median_reliability_score === 'number', r10.body.median_reliability_score)

  // ── TEST 11: GET /market/compare default sort ──────────────────────────────
  console.log('\nTest 11: GET /market/compare sorts by value_index')
  const r11 = await api('GET', '/market/compare/p3-sum')
  assert('compare returns 200', r11.status === 200, r11.status)
  assert('compare.sorted_by == value_index', r11.body.sorted_by === 'value_index', r11.body.sorted_by)
  assert('compare.sellers is non-empty', Array.isArray(r11.body.sellers) && r11.body.sellers.length > 0, r11.body.sellers)
  // value_index should be monotonically descending
  let monotone = true
  for (let i = 1; i < r11.body.sellers.length; i++) {
    if (r11.body.sellers[i].value_index > r11.body.sellers[i - 1].value_index) { monotone = false; break }
  }
  assert('compare sorted by value_index descending', monotone, r11.body.sellers.map(s => s.value_index))

  // ── TEST 12: sort by price ascending ───────────────────────────────────────
  console.log('\nTest 12: GET /market/compare?sort_by=price')
  const r12 = await api('GET', '/market/compare/p3-sum?sort_by=price')
  assert('compare?sort_by=price returns 200', r12.status === 200, r12.status)
  let priceMonotone = true
  for (let i = 1; i < r12.body.sellers.length; i++) {
    if (r12.body.sellers[i].price_per_call_sats < r12.body.sellers[i - 1].price_per_call_sats) {
      priceMonotone = false; break
    }
  }
  assert('compare sorted by price ascending', priceMonotone, r12.body.sellers.map(s => s.price_per_call_sats))

  // ── TEST 13: min_cert_tier filter ──────────────────────────────────────────
  console.log('\nTest 13: GET /market/compare?min_cert_tier=Basic')
  const r13 = await api('GET', '/market/compare/p3-sum?min_cert_tier=Basic')
  assert('compare with min_cert_tier returns 200', r13.status === 200, r13.status)
  const allBasicOrBetter = r13.body.sellers.every(s => ['Basic','Verified','Elite'].includes(s.certification_tier))
  assert('all returned sellers are Basic+', allBasicOrBetter, r13.body.sellers.map(s => s.certification_tier))

  // ── TEST 14: GET /market/trust/:capability_tag ─────────────────────────────
  console.log('\nTest 14: GET /market/trust')
  const r14 = await api('GET', '/market/trust/p3-sum')
  assert('trust returns 200', r14.status === 200, r14.status)
  assert('trust has cert_density', !!r14.body.cert_density, r14.body)
  const sumPct = Object.values(r14.body.cert_density).reduce((a, t) => a + t.pct, 0)
  assert('trust cert_density pcts sum ~ 1.0', Math.abs(sumPct - 1.0) < 0.05, sumPct)

  // ── TEST 15: invalid window param ─────────────────────────────────────────
  console.log('\nTest 15: pricing rejects invalid window')
  const r15 = await api('GET', '/market/pricing/p3-sum?window=99d')
  assert('invalid window returns 400', r15.status === 400, r15.status)
  assert('error == invalid_window', r15.body.error === 'invalid_window', r15.body.error)

  // ── TEST 16: suspended actor still recomputed ─────────────────────────────
  console.log('\nTest 16: suspended actors are still scored')
  const susp = prepare('SELECT reliability_score FROM actors WHERE pubkey = ?').get('p3-seller-suspended')
  assert('suspended actor has reliability_score (default 50)', susp.reliability_score === 50.0, susp.reliability_score)
  const suspCache = prepare("SELECT * FROM reliability_score_cache WHERE actor_pubkey = ? AND capability_tag = '*'")
    .get('p3-seller-suspended')
  assert('suspended actor has cache row', !!suspCache, suspCache)

  server2.close()

  console.log('\n-----------------------------------------')
  console.log('Phase 3 results:', passed, 'passed,', failed, 'failed')
  process.exit(failed > 0 ? 1 : 0)
}

run().catch(e => { console.error(e); process.exit(1) })
