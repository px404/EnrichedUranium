/**
 * Phase 3 — Reliability score computation.
 *
 * Reads the transaction_log over a 90-day rolling window and computes a
 * 0–100 score for each active actor. The four signals and weights are
 * defined in md_files/RELIABILITY.md:
 *
 *   delivery_rate       — 40 %   completed / (completed + failed + timeout)
 *   schema_pass_rate    — 30 %   schema_validated / (schema_validated + schema_failed)
 *   acceptance_rate     — 20 %   accepted (no dispute) / passed schema validation
 *   response_time_score — 10 %   1 - (median response_time / median deadline span)
 *
 * Volume weighting: actors with fewer than VOLUME_THRESHOLD tasks in the window
 * regress toward the neutral 50.0 starting score:
 *
 *   if tasks < THRESHOLD:
 *     score = score * (tasks / THRESHOLD) + 50 * (1 - tasks / THRESHOLD)
 *
 * Bad-faith filter: failures originating from buyers flagged in bad_faith_flags
 * for this specific seller are excluded from delivery_rate / schema_pass_rate /
 * acceptance_rate. See evaluateBadFaith() for how flags are produced.
 *
 * Scores are written to:
 *   - actors.reliability_score          (overall score, '*' row)
 *   - reliability_score_cache           (per-capability rows for /market/* endpoints)
 *
 * Schedule: server.js runs recomputeAll() once at boot, then every
 * RECOMPUTE_INTERVAL_MS (default 15 min) via setInterval.
 */

const { prepare } = require('../db/database')

const NINETY_DAYS_S    = 90 * 24 * 60 * 60
const VOLUME_THRESHOLD = 10
const NEUTRAL_SCORE    = 50.0

// Weights — must sum to 1.0
const W_DELIVERY      = 0.40
const W_SCHEMA_PASS   = 0.30
const W_ACCEPTANCE    = 0.20
const W_RESPONSE_TIME = 0.10

// Bad-faith detection thresholds (per md_files/RELIABILITY.md)
const BAD_FAITH_BUYER_DISPUTE_RATE   = 0.30  // > 30% of this buyer's interactions with this seller failed
const BAD_FAITH_SELLER_OTHER_PASS    = 0.80  // seller's pass rate with everyone else > 80%
const BAD_FAITH_MIN_INTERACTIONS     = 3     // require at least N interactions before flagging

// ── Helpers ────────────────────────────────────────────────────────────────

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid    = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x))
}

/**
 * Pull every transaction_log row for this seller in [windowStart, now].
 * We then derive the four signals from this list. This is more SQLite-friendly
 * than running four separate aggregate queries.
 */
function fetchSellerEvents(sellerPubkey, windowStart) {
  return prepare(`
    SELECT id, request_id, event, actor_pubkey, detail, created_at
    FROM transaction_log
    WHERE actor_pubkey = ?
      AND created_at >= ?
    ORDER BY created_at ASC
  `).all(sellerPubkey, windowStart)
}

/**
 * Pull all requests where this seller was selected. Needed for delivery_rate
 * (we count completed/failed/refunded/timeout against requests, not log events,
 * because a single request only resolves once).
 */
function fetchSellerRequests(sellerPubkey, windowStart) {
  return prepare(`
    SELECT id, buyer_pubkey, status, created_at, completed_at, deadline_unix, retry_count
    FROM requests
    WHERE selected_seller = ?
      AND created_at >= ?
  `).all(sellerPubkey, windowStart)
}

/**
 * Pull all results submitted by this seller (for schema_pass_rate &
 * acceptance_rate which key off result-level data).
 */
function fetchSellerResults(sellerPubkey, windowStart) {
  return prepare(`
    SELECT r.id, r.request_id, r.seller_pubkey, r.validation_status, r.submitted_at,
           req.buyer_pubkey, req.capability_tag, req.created_at AS request_created_at,
           req.deadline_unix
    FROM results r
    JOIN requests req ON req.id = r.request_id
    WHERE r.seller_pubkey = ?
      AND r.submitted_at >= ?
  `).all(sellerPubkey, windowStart)
}

function fetchBadFaithBuyersFor(sellerPubkey) {
  const rows = prepare('SELECT buyer_pubkey FROM bad_faith_flags WHERE seller_pubkey = ?').all(sellerPubkey)
  return new Set(rows.map(r => r.buyer_pubkey))
}

// ── Per-signal computations ────────────────────────────────────────────────

function deliveryRate(requests, badFaithBuyers) {
  // Completed counts as delivery success. failed / refunded count against.
  // Pending/in_progress/matched are still in flight — not counted.
  let success = 0, failure = 0
  for (const r of requests) {
    if (badFaithBuyers.has(r.buyer_pubkey) && r.status !== 'completed') continue
    if (r.status === 'completed')                     success++
    else if (['failed', 'refunded'].includes(r.status)) failure++
  }
  const denom = success + failure
  if (denom === 0) return null
  return success / denom
}

function schemaPassRate(results, badFaithBuyers) {
  let pass = 0, fail = 0
  for (const r of results) {
    if (badFaithBuyers.has(r.buyer_pubkey) && r.validation_status === 'fail') continue
    if (r.validation_status === 'pass') pass++
    else if (r.validation_status === 'fail') fail++
  }
  const denom = pass + fail
  if (denom === 0) return null
  return pass / denom
}

/**
 * acceptance_rate proxy: of the results that passed schema validation, how
 * many resulted in a completed request (no dispute leading to refund).
 *
 * In Phase 3 we don't have an explicit dispute mechanism, so we approximate:
 * a passed-schema result whose request landed in any non-completed terminal
 * state implicitly counts as not-accepted.
 */
function acceptanceRate(results, requestsById, badFaithBuyers) {
  let accepted = 0, total = 0
  for (const r of results) {
    if (r.validation_status !== 'pass') continue
    if (badFaithBuyers.has(r.buyer_pubkey)) continue
    const req = requestsById[r.request_id]
    if (!req) continue
    total++
    if (req.status === 'completed') accepted++
  }
  if (total === 0) return null
  return accepted / total
}

/**
 * response_time_score:
 *   For each completed request, response_time = (completed_at - created_at)
 *   deadline_span = (deadline_unix - created_at)
 *   Per-task score = clamp(1 - response_time/deadline_span, 0, 1)
 *   Result = mean of per-task scores.
 */
function responseTimeScore(requests) {
  const perTask = []
  for (const r of requests) {
    if (r.status !== 'completed' || !r.completed_at) continue
    const span = r.deadline_unix - r.created_at
    if (span <= 0) continue
    const took = r.completed_at - r.created_at
    perTask.push(clamp(1 - took / span, 0, 1))
  }
  if (perTask.length === 0) return null
  const mean = perTask.reduce((a, b) => a + b, 0) / perTask.length
  return mean
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute the score for a single seller. Returns the row that should be
 * written to reliability_score_cache + actors.reliability_score.
 *
 * Pass capability_tag === '*' for an overall (cross-capability) score.
 * Pass a specific tag to score only requests/results with that capability.
 */
function computeForSeller(sellerPubkey, capabilityTag = '*', now = null) {
  const windowStart = (now || Math.floor(Date.now() / 1000)) - NINETY_DAYS_S

  let requests = fetchSellerRequests(sellerPubkey, windowStart)
  let results  = fetchSellerResults(sellerPubkey, windowStart)

  if (capabilityTag !== '*') {
    requests = requests.filter(r => fetchCapabilityForRequest(r.id) === capabilityTag)
    results  = results.filter(r => r.capability_tag === capabilityTag)
  }

  const badFaithBuyers = fetchBadFaithBuyersFor(sellerPubkey)
  const requestsById   = Object.fromEntries(requests.map(r => [r.id, r]))

  const dRate  = deliveryRate(requests, badFaithBuyers)
  const sRate  = schemaPassRate(results, badFaithBuyers)
  const aRate  = acceptanceRate(results, requestsById, badFaithBuyers)
  const rtRate = responseTimeScore(requests)

  // Tasks in window = unique requests this seller handled (post-filter).
  const tasks = requests.length

  // Compute weighted raw score — fall back to neutral 0.5 for missing signals
  // so a seller with one perfect schema pass doesn't get a 30/100 just because
  // delivery_rate has no data yet.
  const raw =
      W_DELIVERY      * (dRate  != null ? dRate  : 0.5)
    + W_SCHEMA_PASS   * (sRate  != null ? sRate  : 0.5)
    + W_ACCEPTANCE    * (aRate  != null ? aRate  : 0.5)
    + W_RESPONSE_TIME * (rtRate != null ? rtRate : 0.5)

  let score = raw * 100

  // Volume regression toward 50 for low-volume sellers
  if (tasks < VOLUME_THRESHOLD) {
    const blend = tasks / VOLUME_THRESHOLD
    score = score * blend + NEUTRAL_SCORE * (1 - blend)
  }

  return {
    actor_pubkey:        sellerPubkey,
    capability_tag:      capabilityTag,
    score:               Math.round(score * 10) / 10,
    delivery_rate:       dRate  != null ? dRate  : 0,
    schema_pass_rate:    sRate  != null ? sRate  : 0,
    acceptance_rate:     aRate  != null ? aRate  : 0,
    response_time_score: rtRate != null ? rtRate : 0,
    tasks_in_window:     tasks,
    computed_at:         Math.floor(Date.now() / 1000)
  }
}

// fetchCapabilityForRequest: requests already include capability_tag through
// the schema, but our SELECT in fetchSellerRequests doesn't pull it. We add a
// thin lookup here rather than widening every call site.
const _capCache = new Map()
function fetchCapabilityForRequest(requestId) {
  if (_capCache.has(requestId)) return _capCache.get(requestId)
  const row = prepare('SELECT capability_tag FROM requests WHERE id = ?').get(requestId)
  const tag = row ? row.capability_tag : null
  _capCache.set(requestId, tag)
  return tag
}
function clearCapabilityCache() { _capCache.clear() }

/** Persist a single computed row to the cache and (for '*') to actors.reliability_score. */
function writeScore(row) {
  prepare(`
    INSERT INTO reliability_score_cache
      (actor_pubkey, capability_tag, score, delivery_rate, schema_pass_rate,
       acceptance_rate, response_time_score, tasks_in_window, computed_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(actor_pubkey, capability_tag) DO UPDATE SET
      score               = excluded.score,
      delivery_rate       = excluded.delivery_rate,
      schema_pass_rate    = excluded.schema_pass_rate,
      acceptance_rate     = excluded.acceptance_rate,
      response_time_score = excluded.response_time_score,
      tasks_in_window     = excluded.tasks_in_window,
      computed_at         = excluded.computed_at
  `).run(
    row.actor_pubkey,
    row.capability_tag,
    row.score,
    row.delivery_rate,
    row.schema_pass_rate,
    row.acceptance_rate,
    row.response_time_score,
    row.tasks_in_window,
    row.computed_at
  )

  if (row.capability_tag === '*') {
    prepare('UPDATE actors SET reliability_score = ? WHERE pubkey = ?')
      .run(row.score, row.actor_pubkey)
  }
}

/**
 * Recompute every active seller's score: one '*' row plus one row per
 * capability the seller declares. Also runs evaluateBadFaith() first so the
 * exclusion list is up-to-date before scores are written.
 */
function recomputeAll() {
  clearCapabilityCache()

  evaluateBadFaith()

  const sellers = prepare(`
    SELECT pubkey, capabilities FROM actors
    WHERE status IN ('active','paused','suspended')
  `).all()

  let updated = 0
  for (const s of sellers) {
    // Overall score
    writeScore(computeForSeller(s.pubkey, '*'))

    // Per-capability scores (used by /market/compare to rank sellers per tag)
    let caps = []
    try { caps = JSON.parse(s.capabilities || '[]') } catch (_) { caps = [] }
    for (const tag of caps) {
      writeScore(computeForSeller(s.pubkey, tag))
    }
    updated++
  }

  return { sellers_updated: updated, computed_at: Math.floor(Date.now() / 1000) }
}

// ── Bad-faith detection ────────────────────────────────────────────────────

/**
 * For every (buyer, seller) pair that has interacted in the window, check:
 *   - this buyer's failure rate against this seller > BAD_FAITH_BUYER_DISPUTE_RATE
 *   - the seller's pass rate with all other buyers > BAD_FAITH_SELLER_OTHER_PASS
 * If both are true, insert a row into bad_faith_flags.
 *
 * Existing flags are kept — this is an append-only ledger of suspicions.
 */
function evaluateBadFaith() {
  const windowStart = Math.floor(Date.now() / 1000) - NINETY_DAYS_S

  // Pull every result with its buyer/seller — denormalised through requests.
  const rows = prepare(`
    SELECT r.seller_pubkey, req.buyer_pubkey, r.validation_status
    FROM results r
    JOIN requests req ON req.id = r.request_id
    WHERE r.submitted_at >= ?
  `).all(windowStart)

  // Aggregate counts per (buyer, seller) and per seller-other-buyers
  const pairCounts = {}   // key buyer|seller -> {pass, fail}
  const sellerTotals = {} // key seller -> {pass, fail}

  for (const row of rows) {
    const pairKey   = row.buyer_pubkey + '|' + row.seller_pubkey
    pairCounts[pairKey]    = pairCounts[pairKey]    || { pass: 0, fail: 0 }
    sellerTotals[row.seller_pubkey] = sellerTotals[row.seller_pubkey] || { pass: 0, fail: 0 }
    if (row.validation_status === 'pass') {
      pairCounts[pairKey].pass++
      sellerTotals[row.seller_pubkey].pass++
    } else if (row.validation_status === 'fail') {
      pairCounts[pairKey].fail++
      sellerTotals[row.seller_pubkey].fail++
    }
  }

  let flaggedCount = 0
  for (const pairKey of Object.keys(pairCounts)) {
    const [buyer, seller] = pairKey.split('|')
    const pair    = pairCounts[pairKey]
    const total   = pair.pass + pair.fail
    if (total < BAD_FAITH_MIN_INTERACTIONS) continue
    const pairFailRate = pair.fail / total
    if (pairFailRate <= BAD_FAITH_BUYER_DISPUTE_RATE) continue

    // Seller's pass rate with everyone *except* this buyer
    const sellerAll = sellerTotals[seller] || { pass: 0, fail: 0 }
    const otherPass = sellerAll.pass - pair.pass
    const otherFail = sellerAll.fail - pair.fail
    const otherTotal = otherPass + otherFail
    if (otherTotal === 0) continue
    const otherPassRate = otherPass / otherTotal
    if (otherPassRate <= BAD_FAITH_SELLER_OTHER_PASS) continue

    // Both conditions met — record the flag (idempotent).
    prepare(`
      INSERT OR IGNORE INTO bad_faith_flags
        (buyer_pubkey, seller_pubkey, flagged_at, detail)
      VALUES (?, ?, ?, ?)
    `).run(
      buyer,
      seller,
      Math.floor(Date.now() / 1000),
      JSON.stringify({
        pair_fail_rate:     Math.round(pairFailRate * 1000) / 1000,
        other_pass_rate:    Math.round(otherPassRate * 1000) / 1000,
        pair_interactions:  total,
        other_interactions: otherTotal
      })
    )
    flaggedCount++
  }

  return { flagged: flaggedCount }
}

module.exports = {
  computeForSeller,
  recomputeAll,
  evaluateBadFaith,
  // exposed for testing
  _internal: {
    deliveryRate, schemaPassRate, acceptanceRate, responseTimeScore,
    NINETY_DAYS_S, VOLUME_THRESHOLD,
    W_DELIVERY, W_SCHEMA_PASS, W_ACCEPTANCE, W_RESPONSE_TIME
  }
}
