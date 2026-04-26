/**
 * Session lifecycle routes — Phase 4: Chains + Burning Rate Accounting
 *
 * POST   /sessions               -- open a session
 * GET    /sessions/:id           -- get session state
 * POST   /sessions/:id/call      -- execute one call (decrement budget)
 * POST   /sessions/:id/close     -- explicit close + settlement
 * POST   /sessions/:id/topup     -- add budget to an active or exhausted session
 *
 * Phase 4: parent_session_id + expected_calls enables burning-rate budget
 * reservation from parent. On sub-session close, unused budget is returned
 * to the parent session's sats_used.
 */

const express = require('express')
const router  = express.Router()
const { v4: uuidv4 } = require('uuid')

const { prepare }  = require('../db/database')
const { logEvent } = require('../lib/settlement')

const PLATFORM_FEE_RATE          = 0.05
const DEFAULT_SESSION_DURATION_S = 24 * 60 * 60

// ── Helpers ──────────────────────────────────────────────────────────────────

function nextMidnightUTC() {
  const d = new Date()
  return Math.floor(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).getTime() / 1000)
}

/**
 * Phase 4: if the session has a parent_session_id, unused budget is returned
 * to the parent (decrement parent.sats_used). The buyer's daily counter is
 * unwound regardless of chain position.
 */
function settleSession(session, newStatus) {
  const platformFeeSats  = Math.floor(session.sats_used * PLATFORM_FEE_RATE)
  const sellerPayoutSats = session.sats_used - platformFeeSats
  const buyerRefundSats  = session.budget_sats - session.sats_used
  const now              = Math.floor(Date.now() / 1000)

  prepare('UPDATE sessions SET status=?, closed_at=?, seller_payout_sats=?, buyer_refund_sats=?, platform_fee_sats=? WHERE id=?')
    .run(newStatus, now, sellerPayoutSats, buyerRefundSats, platformFeeSats, session.id)

  if (buyerRefundSats > 0) {
    if (session.parent_session_id) {
      // Phase 4: return unused sub-session budget to the parent pool
      prepare('UPDATE sessions SET sats_used = MAX(0, sats_used - ?) WHERE id = ?')
        .run(buyerRefundSats, session.parent_session_id)
    }
    // Always unwind buyer's daily counter
    prepare('UPDATE actors SET daily_spend_used = MAX(0, daily_spend_used - ?) WHERE pubkey = ?')
      .run(buyerRefundSats, session.buyer_pubkey)
  }

  const eventType = newStatus === 'expired' ? 'timeout' : 'session_closed'
  logEvent(null, eventType, session.buyer_pubkey, {
    session_id:         session.id,
    parent_session_id:  session.parent_session_id || null,
    chain_depth:        session.chain_depth,
    calls_made:         session.calls_made,
    sats_used:          session.sats_used,
    seller_payout_sats: sellerPayoutSats,
    buyer_refund_sats:  buyerRefundSats,
    platform_fee_sats:  platformFeeSats,
    reason: newStatus === 'expired' ? 'deadline_exceeded' : 'explicit_close',
    mock: true
  })

  return { sellerPayoutSats, buyerRefundSats, platformFeeSats }
}

function autoExpire(session) {
  if (!['active','exhausted'].includes(session.status)) return
  settleSession(session, 'expired')
}

function formatSession(s) {
  return {
    id:                  s.id,
    buyer_pubkey:        s.buyer_pubkey,
    seller_pubkey:       s.seller_pubkey,
    capability_tag:      s.capability_tag,
    price_per_call_sats: s.price_per_call_sats,
    budget_sats:         s.budget_sats,
    sats_used:           s.sats_used,
    remaining_budget:    s.budget_sats - s.sats_used,
    calls_made:          s.calls_made,
    session_token:       s.session_token,
    parent_session_id:   s.parent_session_id  || null,
    chain_depth:         s.chain_depth,
    expires_unix:        s.expires_unix,
    opened_at:           s.opened_at,
    closed_at:           s.closed_at          || null,
    seller_payout_sats:  s.seller_payout_sats != null ? s.seller_payout_sats : null,
    buyer_refund_sats:   s.buyer_refund_sats  != null ? s.buyer_refund_sats  : null,
    platform_fee_sats:   s.platform_fee_sats  != null ? s.platform_fee_sats  : null,
    status:              s.status
  }
}

// ── POST /sessions ────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const {
    buyer_pubkey, seller_pubkey, capability_tag, budget_sats, expires_unix,
    parent_session_id, chain_depth: chain_depth_param, expected_calls
  } = req.body

  const budgetRequired = !parent_session_id
  if (!buyer_pubkey || !seller_pubkey || !capability_tag || (budgetRequired && budget_sats === undefined)) {
    return res.status(400).json({
      error:   'missing_fields',
      message: parent_session_id
        ? 'buyer_pubkey, seller_pubkey, capability_tag, parent_session_id, and expected_calls are required for sub-sessions'
        : 'buyer_pubkey, seller_pubkey, capability_tag, and budget_sats are required'
    })
  }
  if (budgetRequired && (!Number.isInteger(budget_sats) || budget_sats <= 0)) {
    return res.status(400).json({ error: 'invalid_budget', message: 'budget_sats must be a positive integer' })
  }

  const buyer = prepare('SELECT * FROM actors WHERE pubkey = ?').get(buyer_pubkey)
  if (!buyer) return res.status(400).json({ error: 'buyer_not_found', message: 'Buyer "' + buyer_pubkey + '" not found' })
  if (buyer.status !== 'active') return res.status(400).json({ error: 'buyer_inactive', message: 'Buyer is not active (status: ' + buyer.status + ')' })

  const seller = prepare('SELECT * FROM actors WHERE pubkey = ?').get(seller_pubkey)
  if (!seller) return res.status(400).json({ error: 'seller_not_found', message: 'Seller "' + seller_pubkey + '" not found' })
  if (seller.status !== 'active') return res.status(400).json({ error: 'seller_inactive', message: 'Seller is not active (status: ' + seller.status + ')' })

  const schema = prepare('SELECT capability_tag FROM schemas WHERE capability_tag = ?').get(capability_tag)
  if (!schema) return res.status(400).json({ error: 'unknown_capability', message: 'No schema for "' + capability_tag + '"' })

  const sellerCaps   = JSON.parse(seller.capabilities)
  const sellerPrices = JSON.parse(seller.price_per_call_sats)
  if (!sellerCaps.includes(capability_tag))
    return res.status(400).json({ error: 'seller_lacks_capability', message: 'Seller does not offer "' + capability_tag + '"' })

  const pricePerCall = sellerPrices[capability_tag]
  if (pricePerCall === undefined)
    return res.status(400).json({ error: 'no_price_set', message: 'Seller has no price for "' + capability_tag + '"' })

  // ── Phase 4: chain depth + parent budget reservation ─────────────────────
  let chainDepth     = 0
  let resolvedBudget = budget_sats

  if (parent_session_id) {
    if (!Number.isInteger(expected_calls) || expected_calls <= 0) {
      return res.status(400).json({
        error:   'missing_expected_calls',
        message: 'expected_calls (positive integer) is required when parent_session_id is provided'
      })
    }
    const parent = prepare('SELECT * FROM sessions WHERE id = ?').get(parent_session_id)
    if (!parent) return res.status(400).json({ error: 'parent_not_found', message: 'Parent session "' + parent_session_id + '" not found' })
    if (parent.status !== 'active') return res.status(400).json({ error: 'parent_not_active', message: 'Parent session is "' + parent.status + '"' })

    resolvedBudget = expected_calls * pricePerCall
    const parentRemaining = parent.budget_sats - parent.sats_used
    if (resolvedBudget > parentRemaining) {
      return res.status(422).json({
        error:   'parent_budget_exceeded',
        message: 'Sub-session cost (' + expected_calls + ' calls × ' + pricePerCall + ' sats = ' + resolvedBudget + ') exceeds parent remaining_budget (' + parentRemaining + ')'
      })
    }
    chainDepth = parent.chain_depth + 1
  } else if (chain_depth_param !== undefined && Number.isInteger(chain_depth_param)) {
    chainDepth = chain_depth_param
  }

  if (chainDepth >= seller.chain_depth_max) {
    return res.status(422).json({
      error:   'chain_depth_exceeded',
      message: 'Chain depth ' + chainDepth + ' meets or exceeds seller max (' + seller.chain_depth_max + ')'
    })
  }

  if (resolvedBudget < pricePerCall) {
    return res.status(422).json({
      error:   'budget_too_low',
      message: 'budget_sats (' + resolvedBudget + ') must be >= seller price_per_call_sats (' + pricePerCall + ')'
    })
  }
  if (resolvedBudget > buyer.spend_cap_per_session) {
    return res.status(422).json({
      error:   'spend_cap_per_session_exceeded',
      message: 'budget_sats (' + resolvedBudget + ') exceeds your spend_cap_per_session (' + buyer.spend_cap_per_session + ')'
    })
  }

  const spendCapPerCall = JSON.parse(buyer.spend_cap_per_call)
  if (spendCapPerCall[capability_tag] !== undefined && pricePerCall > spendCapPerCall[capability_tag]) {
    return res.status(422).json({
      error:   'spend_cap_per_call_exceeded',
      message: 'Seller price ' + pricePerCall + ' exceeds your spend_cap_per_call of ' + spendCapPerCall[capability_tag] + ' for "' + capability_tag + '"'
    })
  }

  const now = Math.floor(Date.now() / 1000)
  let dailySpendUsed = buyer.daily_spend_used
  if (buyer.daily_spend_reset_at <= now) {
    prepare('UPDATE actors SET daily_spend_used = 0, daily_spend_reset_at = ? WHERE pubkey = ?').run(nextMidnightUTC(), buyer_pubkey)
    dailySpendUsed = 0
  }
  if (dailySpendUsed + resolvedBudget > buyer.spend_cap_daily_sats) {
    return res.status(422).json({
      error:   'daily_spend_cap_exceeded',
      message: 'Opening this session would exceed your daily cap. Used today: ' + dailySpendUsed + ', cap: ' + buyer.spend_cap_daily_sats
    })
  }

  const deadline = (expires_unix && Number.isInteger(expires_unix)) ? expires_unix : (now + DEFAULT_SESSION_DURATION_S)
  if (deadline <= now) return res.status(400).json({ error: 'invalid_expires', message: 'expires_unix must be in the future' })

  const id           = uuidv4()
  const sessionToken = uuidv4()

  prepare('INSERT INTO sessions (id, buyer_pubkey, seller_pubkey, capability_tag, price_per_call_sats, budget_sats, sats_used, calls_made, session_token, parent_session_id, chain_depth, expires_unix, opened_at, status) VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?,\'active\')')
    .run(id, buyer_pubkey, seller_pubkey, capability_tag, pricePerCall, resolvedBudget, sessionToken, parent_session_id || null, chainDepth, deadline, now)

  // Phase 4: atomically reserve budget in parent
  if (parent_session_id) {
    prepare('UPDATE sessions SET sats_used = sats_used + ? WHERE id = ?').run(resolvedBudget, parent_session_id)
  }

  prepare('UPDATE actors SET daily_spend_used = daily_spend_used + ? WHERE pubkey = ?').run(resolvedBudget, buyer_pubkey)

  logEvent(null, 'session_opened', buyer_pubkey, {
    session_id: id, seller_pubkey, capability_tag,
    budget_sats: resolvedBudget, price_per_call_sats: pricePerCall,
    parent_session_id: parent_session_id || null,
    chain_depth: chainDepth,
    expected_calls: parent_session_id ? expected_calls : undefined,
    mock: true
  })

  return res.status(201).json(formatSession(prepare('SELECT * FROM sessions WHERE id = ?').get(id)))
})

// ── GET /sessions/:id ─────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const session = prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id)
  if (!session) return res.status(404).json({ error: 'not_found', message: 'Session "' + req.params.id + '" not found' })
  return res.json(formatSession(session))
})

// ── POST /sessions/:id/call ───────────────────────────────────────────────────
router.post('/:id/call', (req, res) => {
  const session = prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id)
  if (!session) return res.status(404).json({ error: 'not_found', message: 'Session "' + req.params.id + '" not found' })

  const now = Math.floor(Date.now() / 1000)
  if (session.expires_unix < now && ['active','exhausted'].includes(session.status)) {
    autoExpire(session)
    return res.status(410).json({ error: 'session_expired', message: 'Session deadline passed — session closed' })
  }
  if (session.status === 'exhausted') {
    return res.status(402).json({ error: 'insufficient_budget', message: 'Session is exhausted — remaining budget (' + (session.budget_sats - session.sats_used) + ') < price_per_call_sats (' + session.price_per_call_sats + ')' })
  }
  if (session.status !== 'active') {
    return res.status(409).json({ error: 'session_not_active', message: 'Session is "' + session.status + '" — only active sessions accept calls' })
  }

  const remaining = session.budget_sats - session.sats_used
  if (remaining < session.price_per_call_sats) {
    return res.status(402).json({ error: 'insufficient_budget', message: 'Remaining budget (' + remaining + ') < price_per_call_sats (' + session.price_per_call_sats + ')' })
  }

  const newSatsUsed  = session.sats_used + session.price_per_call_sats
  const newCallsMade = session.calls_made + 1
  const newRemaining = session.budget_sats - newSatsUsed
  const newStatus    = newRemaining < session.price_per_call_sats ? 'exhausted' : 'active'

  prepare('UPDATE sessions SET sats_used = ?, calls_made = ?, status = ? WHERE id = ?').run(newSatsUsed, newCallsMade, newStatus, session.id)

  logEvent(null, 'session_call', session.buyer_pubkey, {
    session_id: session.id, call_number: newCallsMade,
    sats_this_call: session.price_per_call_sats, remaining_budget: newRemaining
  })
  if (newStatus === 'exhausted') {
    logEvent(null, 'session_exhausted', session.buyer_pubkey, { session_id: session.id, calls_made: newCallsMade, sats_used: newSatsUsed })
  }

  return res.json(formatSession(prepare('SELECT * FROM sessions WHERE id = ?').get(session.id)))
})

// ── POST /sessions/:id/close ──────────────────────────────────────────────────
router.post('/:id/close', (req, res) => {
  const session = prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id)
  if (!session) return res.status(404).json({ error: 'not_found', message: 'Session "' + req.params.id + '" not found' })

  if (!['active','exhausted'].includes(session.status)) {
    return res.status(409).json({ error: 'session_not_closeable', message: 'Session is "' + session.status + '" — only active or exhausted sessions can be closed' })
  }

  const settlement = settleSession(session, 'closed')
  const updated    = prepare('SELECT * FROM sessions WHERE id = ?').get(session.id)
  return res.json({ ...formatSession(updated), settlement })
})

// ── POST /sessions/:id/topup ──────────────────────────────────────────────────
router.post('/:id/topup', (req, res) => {
  const { amount_sats } = req.body
  if (!Number.isInteger(amount_sats) || amount_sats <= 0) {
    return res.status(400).json({ error: 'invalid_amount', message: 'amount_sats must be a positive integer' })
  }

  const session = prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id)
  if (!session) return res.status(404).json({ error: 'not_found', message: 'Session "' + req.params.id + '" not found' })

  if (!['active','exhausted'].includes(session.status)) {
    return res.status(409).json({ error: 'session_not_toppable', message: 'Session is "' + session.status + '" — can only top up active or exhausted sessions' })
  }

  const now = Math.floor(Date.now() / 1000)
  if (session.expires_unix < now) {
    autoExpire(session)
    return res.status(410).json({ error: 'session_expired', message: 'Session deadline passed — session closed' })
  }

  const buyer = prepare('SELECT * FROM actors WHERE pubkey = ?').get(session.buyer_pubkey)
  let dailySpendUsed = buyer.daily_spend_used
  if (buyer.daily_spend_reset_at <= now) {
    prepare('UPDATE actors SET daily_spend_used = 0, daily_spend_reset_at = ? WHERE pubkey = ?').run(nextMidnightUTC(), session.buyer_pubkey)
    dailySpendUsed = 0
  }
  if (dailySpendUsed + amount_sats > buyer.spend_cap_daily_sats) {
    return res.status(422).json({ error: 'daily_spend_cap_exceeded', message: 'Top-up would exceed daily cap. Used today: ' + dailySpendUsed + ', cap: ' + buyer.spend_cap_daily_sats })
  }

  const newBudget    = session.budget_sats + amount_sats
  const newRemaining = newBudget - session.sats_used
  const newStatus    = newRemaining >= session.price_per_call_sats ? 'active' : 'exhausted'

  prepare('UPDATE sessions SET budget_sats = ?, status = ? WHERE id = ?').run(newBudget, newStatus, session.id)
  prepare('UPDATE actors SET daily_spend_used = daily_spend_used + ? WHERE pubkey = ?').run(amount_sats, session.buyer_pubkey)

  logEvent(null, 'session_topup', session.buyer_pubkey, { session_id: session.id, amount_sats, new_budget_sats: newBudget, mock: true })

  return res.json(formatSession(prepare('SELECT * FROM sessions WHERE id = ?').get(session.id)))
})

// ── Background expiry ─────────────────────────────────────────────────────────
function checkExpiredSessions() {
  const now     = Math.floor(Date.now() / 1000)
  const expired = prepare("SELECT * FROM sessions WHERE expires_unix < ? AND status IN ('active','exhausted')").all(now)
  expired.forEach(s => autoExpire(s))
  if (expired.length > 0) console.log('[session-expiry] Auto-closed ' + expired.length + ' expired session(s)')
}

router.checkExpiredSessions = checkExpiredSessions
module.exports = router
