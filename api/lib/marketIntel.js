/**
 * Phase 3 — Market intelligence aggregator.
 *
 * Powers the four /market/* endpoints. Reads from:
 *   - actors                   (live capability roster, prices, certification)
 *   - requests                 (settled transactions for pricing aggregates)
 *   - reliability_score_cache  (per-capability scores written by reliabilityScore.recomputeAll)
 *
 * No raw transaction content is exposed — all responses are aggregated.
 */

const { prepare } = require('../db/database')

const WINDOW_MAP = {
  '24h': 24 * 60 * 60,
  '7d':  7  * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60
}
const DEFAULT_WINDOW = '7d'

// Numeric ranking for the trust_price_index — higher = more trusted
const CERT_TIER_NUMERIC = {
  Unverified: 0,
  Basic:      1,
  Verified:   2,
  Elite:      3
}

// ── Helpers ────────────────────────────────────────────────────────────────

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx    = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

function median(values) {
  return percentile(values, 0.5)
}

function windowSeconds(windowKey) {
  return WINDOW_MAP[windowKey] || WINDOW_MAP[DEFAULT_WINDOW]
}

function getCertTierForCapability(actor, capabilityTag) {
  let tiers = {}
  try { tiers = JSON.parse(actor.certification_tier || '{}') } catch (_) {}
  // Empty map is the default registered state — treat as Unverified
  return tiers[capabilityTag] || 'Unverified'
}

// ── Pricing ────────────────────────────────────────────────────────────────

/**
 * GET /market/pricing/:capability_tag
 * Aggregates settled-request budgets for the capability over the window.
 */
function getPricing(capabilityTag, windowKey = DEFAULT_WINDOW) {
  const now         = Math.floor(Date.now() / 1000)
  const windowStart = now - windowSeconds(windowKey)

  // Settled budgets — completed requests are the cleanest pricing signal
  const rows = prepare(`
    SELECT budget_sats FROM requests
    WHERE capability_tag = ?
      AND status = 'completed'
      AND created_at >= ?
  `).all(capabilityTag, windowStart)

  const prices = rows.map(r => r.budget_sats)

  // 7-day trend: median price in the previous window vs this window
  const prevStart = windowStart - windowSeconds(windowKey)
  const prevRows  = prepare(`
    SELECT budget_sats FROM requests
    WHERE capability_tag = ?
      AND status = 'completed'
      AND created_at >= ?
      AND created_at < ?
  `).all(capabilityTag, prevStart, windowStart)
  const prevPrices = prevRows.map(r => r.budget_sats)

  const currMedian = median(prices)
  const prevMedian = median(prevPrices)
  const trend = (currMedian != null && prevMedian != null && prevMedian !== 0)
    ? Math.round(((currMedian - prevMedian) / prevMedian) * 1000) / 1000
    : null

  return {
    capability_tag:    capabilityTag,
    window:            windowKey,
    price_median:      currMedian,
    price_p25:         percentile(prices, 0.25),
    price_p75:         percentile(prices, 0.75),
    price_min:         prices.length ? Math.min(...prices) : null,
    price_max:         prices.length ? Math.max(...prices) : null,
    price_trend_7d:    trend,
    transaction_count: prices.length,
    computed_at:       now
  }
}

// ── Quality ────────────────────────────────────────────────────────────────

/**
 * GET /market/quality/:capability_tag
 * Median reliability score across active sellers for this capability +
 * cert tier distribution + average per-capability schema pass rate.
 */
function getQuality(capabilityTag) {
  const now = Math.floor(Date.now() / 1000)

  const sellers = prepare(`
    SELECT pubkey, certification_tier
    FROM actors
    WHERE status = 'active'
      AND capabilities LIKE ?
  `).all('%"' + capabilityTag + '"%')

  // Pull cached scores for these sellers at this capability
  const pubkeys      = sellers.map(s => s.pubkey)
  const scoresByKey  = new Map()
  const passRateByKey = new Map()

  if (pubkeys.length > 0) {
    const placeholders = pubkeys.map(() => '?').join(',')
    const cacheRows = prepare(`
      SELECT actor_pubkey, score, schema_pass_rate
      FROM reliability_score_cache
      WHERE capability_tag = ?
        AND actor_pubkey IN (${placeholders})
    `).all(capabilityTag, ...pubkeys)
    for (const r of cacheRows) {
      scoresByKey.set(r.actor_pubkey, r.score)
      passRateByKey.set(r.actor_pubkey, r.schema_pass_rate)
    }
  }

  const tierCounts = { Elite: 0, Verified: 0, Basic: 0, Unverified: 0 }
  for (const s of sellers) {
    const tier = getCertTierForCapability(s, capabilityTag)
    if (tierCounts[tier] === undefined) tierCounts[tier] = 0
    tierCounts[tier]++
  }

  const scoreList    = [...scoresByKey.values()]
  const passRateList = [...passRateByKey.values()].filter(v => v > 0)

  return {
    capability_tag:           capabilityTag,
    median_reliability_score: median(scoreList),
    avg_schema_pass_rate:     passRateList.length
      ? Math.round((passRateList.reduce((a, b) => a + b, 0) / passRateList.length) * 1000) / 1000
      : null,
    cert_tier_distribution:   tierCounts,
    active_seller_count:      sellers.length,
    computed_at:              now
  }
}

// ── Compare ────────────────────────────────────────────────────────────────

/**
 * GET /market/compare/:capability_tag
 * Ranks sellers by value_index (default), price, score, response_time, or volume.
 *
 * value_index      = (score / 100) / (price / median_price)
 * trust_price_index = (cert_numeric / 3) / (price / median_price)
 *
 * Higher value_index = better quality for the price. A trust_price_index of 0
 * means Unverified (cert_numeric = 0); a higher number means better
 * certification tier per sat.
 */
function getCompare(capabilityTag, opts = {}) {
  const sortBy      = opts.sort_by      || 'value_index'
  const limit       = Math.min(parseInt(opts.limit || '20', 10), 100)
  const minCertTier = opts.min_cert_tier || null

  const now = Math.floor(Date.now() / 1000)

  // LIKE pattern matches the JSON-encoded capability tag inside the array.
  // Same approach used by the matcher in lib/matcher.js.
  const sellers = prepare(`
    SELECT pubkey, price_per_call_sats, certification_tier
    FROM actors
    WHERE status = 'active'
      AND capabilities LIKE ?
  `).all('%"' + capabilityTag + '"%')

  // Compute median price for value_index calculation
  const allPrices = []
  const enriched  = []
  for (const s of sellers) {
    let prices = {}
    try { prices = JSON.parse(s.price_per_call_sats || '{}') } catch (_) {}
    const price = prices[capabilityTag]
    if (price === undefined) continue

    const tier = getCertTierForCapability(s, capabilityTag)
    if (minCertTier && CERT_TIER_NUMERIC[tier] < (CERT_TIER_NUMERIC[minCertTier] || 0)) continue

    enriched.push({ pubkey: s.pubkey, price, tier })
    allPrices.push(price)
  }

  const medianPrice = median(allPrices) || 1  // avoid div/0

  // Pull per-capability scores in one shot
  const pubkeys  = enriched.map(e => e.pubkey)
  const cacheRows = pubkeys.length
    ? prepare(`
        SELECT actor_pubkey, score, response_time_score, tasks_in_window
        FROM reliability_score_cache
        WHERE capability_tag = ?
          AND actor_pubkey IN (${pubkeys.map(() => '?').join(',')})
      `).all(capabilityTag, ...pubkeys)
    : []
  const cacheByKey = new Map(cacheRows.map(r => [r.actor_pubkey, r]))

  const enrichedScored = enriched.map(e => {
    const cache = cacheByKey.get(e.pubkey) || { score: 50.0, response_time_score: 0, tasks_in_window: 0 }
    const priceRatio        = e.price / medianPrice
    const valueIndex        = priceRatio > 0 ? (cache.score / 100) / priceRatio : 0
    const trustPriceIndex   = priceRatio > 0 ? (CERT_TIER_NUMERIC[e.tier] / 3) / priceRatio : 0
    return {
      pubkey:              e.pubkey,
      reliability_score:   cache.score,
      certification_tier:  e.tier,
      price_per_call_sats: e.price,
      value_index:         Math.round(valueIndex * 100) / 100,
      trust_price_index:   Math.round(trustPriceIndex * 100) / 100,
      response_time_score: Math.round((cache.response_time_score || 0) * 100) / 100,
      tasks_in_window:     cache.tasks_in_window
    }
  })

  // Sort
  const sortFns = {
    value_index:   (a, b) => b.value_index - a.value_index,
    price:         (a, b) => a.price_per_call_sats - b.price_per_call_sats,
    score:         (a, b) => b.reliability_score - a.reliability_score,
    response_time: (a, b) => b.response_time_score - a.response_time_score,
    volume:        (a, b) => b.tasks_in_window - a.tasks_in_window
  }
  enrichedScored.sort(sortFns[sortBy] || sortFns.value_index)

  return {
    capability_tag: capabilityTag,
    sorted_by:      sortBy,
    median_price:   medianPrice,
    sellers:        enrichedScored.slice(0, limit),
    computed_at:    now
  }
}

// ── Trust ──────────────────────────────────────────────────────────────────

/**
 * GET /market/trust/:capability_tag
 * Cert tier density across active sellers for this capability.
 */
function getTrust(capabilityTag) {
  const now = Math.floor(Date.now() / 1000)

  const sellers = prepare(`
    SELECT certification_tier FROM actors
    WHERE status = 'active'
      AND capabilities LIKE ?
  `).all('%"' + capabilityTag + '"%')

  const counts = { Elite: 0, Verified: 0, Basic: 0, Unverified: 0 }
  for (const s of sellers) {
    const tier = getCertTierForCapability(s, capabilityTag)
    if (counts[tier] === undefined) counts[tier] = 0
    counts[tier]++
  }

  const total = sellers.length || 1
  const density = {}
  for (const tier of Object.keys(counts)) {
    density[tier] = {
      count: counts[tier],
      pct:   Math.round((counts[tier] / total) * 1000) / 1000
    }
  }

  return {
    capability_tag:      capabilityTag,
    cert_density:        density,
    active_seller_count: sellers.length,
    computed_at:         now
  }
}

module.exports = { getPricing, getQuality, getCompare, getTrust }
