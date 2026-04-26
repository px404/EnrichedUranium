/**
 * Matching engine — builds an ordered shortlist of sellers for a request.
 *
 * Algorithm:
 *   1. Query active actors who declare the capability tag
 *   2. Filter: price_per_call_sats[capability] <= budget_sats
 *   3. Sort by reliability_score descending
 *   4. Apply diversity demotion: if a seller holds >DIVERSITY_THRESHOLD of recent
 *      volume for this capability, swap them one position back in the ranked list
 *   5. Return up to SHORTLIST_SIZE pubkeys
 *
 * Configurable via env vars:
 *   SHORTLIST_SIZE         (default 5)
 *   DIVERSITY_THRESHOLD    (default 0.35)
 *   DIVERSITY_WINDOW_DAYS  (default 7)
 */

const { prepare } = require('../db/database')

const SHORTLIST_SIZE        = parseInt(process.env.SHORTLIST_SIZE        || '5',  10)
const DIVERSITY_THRESHOLD   = parseFloat(process.env.DIVERSITY_THRESHOLD || '0.35')
const DIVERSITY_WINDOW_DAYS = parseInt(process.env.DIVERSITY_WINDOW_DAYS || '7',  10)

/**
 * Build a shortlist of up to SHORTLIST_SIZE seller pubkeys.
 * @param {string} capabilityTag
 * @param {number} budgetSats
 * @returns {string[]} ordered array of seller pubkeys
 */
function buildShortlist(capabilityTag, budgetSats) {
  // 1. Get all active actors who declare this capability
  const candidates = prepare(`
    SELECT pubkey, price_per_call_sats, reliability_score
    FROM actors
    WHERE status = 'active'
      AND capabilities LIKE ?
  `).all(`%"${capabilityTag}"%`)

  // 2. Filter by price
  const eligible = candidates.filter(actor => {
    const prices = JSON.parse(actor.price_per_call_sats || '{}')
    const price  = prices[capabilityTag]
    return price !== undefined && price <= budgetSats
  })

  // 3. Sort by reliability_score descending
  eligible.sort((a, b) => b.reliability_score - a.reliability_score)

  // 4. Diversity demotion
  const windowStart = Math.floor(Date.now() / 1000) - DIVERSITY_WINDOW_DAYS * 86400
  const recentRows  = prepare(`
    SELECT selected_seller FROM requests
    WHERE capability_tag  = ?
      AND created_at      > ?
      AND selected_seller IS NOT NULL
  `).all(capabilityTag, windowStart)

  const totalVolume = recentRows.length

  if (totalVolume > 0) {
    const volumeByPubkey = {}
    recentRows.forEach(r => {
      volumeByPubkey[r.selected_seller] = (volumeByPubkey[r.selected_seller] || 0) + 1
    })

    // Single pass: if position i is over-threshold, swap with i+1
    for (let i = 0; i < eligible.length - 1; i++) {
      const share = (volumeByPubkey[eligible[i].pubkey] || 0) / totalVolume
      if (share > DIVERSITY_THRESHOLD) {
        const tmp      = eligible[i]
        eligible[i]    = eligible[i + 1]
        eligible[i + 1] = tmp
        i++ // skip the swapped-in seller so we don't double-swap
      }
    }
  }

  // 5. Return pubkeys only, capped at SHORTLIST_SIZE
  return eligible.slice(0, SHORTLIST_SIZE).map(a => a.pubkey)
}

module.exports = { buildShortlist }
