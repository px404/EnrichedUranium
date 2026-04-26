/**
 * lib/settlement.js — real Lightning settlement via MDK agent-wallet.
 *
 * settleSuccess  — pays seller, keeps platform fee, marks request completed
 * settleFailure  — retry path (first fail) or full refund (second fail)
 * settleTimeout  — deadline exceeded, refund buyer
 *
 * All sats movements are real Lightning payments.
 * Mock flag removed — swap MDK_WALLET_PORT env if you need a different wallet.
 */

'use strict'

const { prepare } = require('../db/database')
const lightning   = require('./lightning')
const { v4: uuidv4 } = require('uuid')

const PLATFORM_FEE_RATE = 0.05   // 5%

// ── Logging ──────────────────────────────────────────────────────────────────

function logEvent(requestId, event, actorPubkey, detail) {
  prepare(`INSERT INTO transaction_log (id, request_id, event, actor_pubkey, detail, created_at)
    VALUES (?,?,?,?,?,?)`)
    .run(uuidv4(), requestId || null, event, actorPubkey || null,
      detail ? JSON.stringify(detail) : null, Math.floor(Date.now() / 1000))
}

// ── Internal: auto-redispatch on first schema failure ─────────────────────────

/**
 * Re-send the task to the same seller after a first validation failure.
 * This lets the buyer (PM) just poll for 'completed' without needing retry logic.
 */
async function autoRedispatch(requestId, req) {
  const seller = prepare('SELECT endpoint_url FROM actors WHERE pubkey = ?').get(req.selected_seller)
  if (!seller || !seller.endpoint_url) {
    console.warn('[settlement] Auto-redispatch: seller has no endpoint_url, skipping')
    return
  }

  const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:3001'
  const payload = {
    request_id:     requestId,
    capability_tag: req.capability_tag,
    input_payload:  JSON.parse(req.input_payload),
    budget_sats:    req.budget_sats,
    deadline_unix:  req.deadline_unix,
    result_url:     PLATFORM_URL + '/results/' + requestId,
    platform_url:   PLATFORM_URL,
    is_retry:       true,
  }

  const headers = { 'Content-Type': 'application/json' }
  if (process.env.PLATFORM_SECRET) headers['X-Platform-Secret'] = process.env.PLATFORM_SECRET

  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(seller.endpoint_url, {
      method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal
    })
    clearTimeout(timeout)
    if (response.ok) {
      console.log('[settlement] Auto-redispatch delivered to', req.selected_seller)
      logEvent(requestId, 'task_dispatched', req.selected_seller, {
        endpoint_url: seller.endpoint_url, http_status: response.status, is_retry: true
      })
    } else {
      console.warn('[settlement] Auto-redispatch HTTP', response.status, 'from', seller.endpoint_url)
      logEvent(requestId, 'task_dispatch_failed', req.selected_seller, {
        endpoint_url: seller.endpoint_url, http_status: response.status, is_retry: true
      })
    }
  } catch (e) {
    clearTimeout(timeout)
    console.warn('[settlement] Auto-redispatch error:', e.message)
    logEvent(requestId, 'task_dispatch_failed', req.selected_seller, {
      endpoint_url: seller.endpoint_url, error: e.message, is_retry: true
    })
  }
}

// ── Settlement helpers ────────────────────────────────────────────────────────

/**
 * Pay the seller their share and mark the request completed.
 * seller.lightning_address must be set on the seller actor.
 */
async function settleSuccess(requestId) {
  const req    = prepare('SELECT * FROM requests WHERE id = ?').get(requestId)
  const seller = prepare('SELECT * FROM actors   WHERE pubkey = ?').get(req.selected_seller)
  const buyer  = prepare('SELECT * FROM actors   WHERE pubkey = ?').get(req.buyer_pubkey)

  const platformFeeSats  = Math.floor(req.budget_sats * PLATFORM_FEE_RATE)
  const sellerPayoutSats = req.budget_sats - platformFeeSats
  const now              = Math.floor(Date.now() / 1000)

  // Pay seller via Lightning
  let paymentId = null
  let paymentError = null
  if (seller.lightning_address) {
    try {
      const result = await lightning.pay(seller.lightning_address, sellerPayoutSats)
      paymentId = result.payment_id
    } catch (e) {
      paymentError = e.message
      console.error('[settlement] Seller payment failed:', e.message)
    }
  } else {
    paymentError = 'seller has no lightning_address registered'
    console.warn('[settlement] Seller "' + seller.pubkey + '" has no lightning_address — payment skipped')
  }

  prepare(`UPDATE requests
    SET status='completed', completed_at=?, platform_fee_sats=?, seller_payout_sats=?
    WHERE id=?`)
    .run(now, platformFeeSats, sellerPayoutSats, requestId)

  logEvent(requestId, 'payment_released', seller.pubkey, {
    seller_payout_sats: sellerPayoutSats,
    platform_fee_sats:  platformFeeSats,
    lightning_address:  seller.lightning_address || null,
    payment_id:         paymentId,
    payment_error:      paymentError
  })

  return { sellerPayoutSats, platformFeeSats, paymentId, paymentError }
}

/**
 * First failure — allow one retry.
 * Second failure — refund buyer and mark failed.
 */
async function settleFailure(requestId, isRetry) {
  const req   = prepare('SELECT * FROM requests WHERE id = ?').get(requestId)
  const buyer = prepare('SELECT * FROM actors   WHERE pubkey = ?').get(req.buyer_pubkey)
  const now   = Math.floor(Date.now() / 1000)

  if (!isRetry) {
    // First failure — keep the same seller, increment retry counter, and re-dispatch.
    // Leaving status as in_progress (re-dispatch handles it) so the buyer (PM) can
    // keep polling for 'completed' without needing to know about the retry.
    prepare('UPDATE requests SET retry_count = retry_count + 1 WHERE id=?').run(requestId)
    logEvent(requestId, 'schema_failed', req.selected_seller, { retry: true })

    // Re-dispatch to the same seller — do it asynchronously so we don't block the
    // result POST response.
    setImmediate(() => autoRedispatch(requestId, req).catch(e =>
      console.error('[settlement] Auto-redispatch failed for', requestId, ':', e.message)
    ))

    return { retried: true }
  }

  // Second failure — refund buyer
  let paymentId = null
  let paymentError = null
  if (buyer.lightning_address) {
    try {
      const result = await lightning.pay(buyer.lightning_address, req.budget_sats)
      paymentId = result.payment_id
    } catch (e) {
      paymentError = e.message
      console.error('[settlement] Buyer refund failed:', e.message)
    }
  } else {
    paymentError = 'buyer has no lightning_address registered'
    console.warn('[settlement] Buyer "' + buyer.pubkey + '" has no lightning_address — refund skipped')
  }

  prepare(`UPDATE requests SET status='failed', completed_at=? WHERE id=?`).run(now, requestId)
  logEvent(requestId, 'refund_issued', buyer.pubkey, {
    refund_sats:       req.budget_sats,
    lightning_address: buyer.lightning_address || null,
    payment_id:        paymentId,
    payment_error:     paymentError,
    reason:            'seller_validation_failed_twice'
  })

  return { retried: false, refundSats: req.budget_sats, paymentId, paymentError }
}

/**
 * Deadline exceeded — refund buyer.
 * Idempotent: no-op if request is already in a terminal state.
 */
async function settleTimeout(requestId) {
  const req = prepare('SELECT * FROM requests WHERE id = ?').get(requestId)
  if (!req) return
  if (['completed','failed','refunded'].includes(req.status)) return

  const buyer = prepare('SELECT * FROM actors WHERE pubkey = ?').get(req.buyer_pubkey)
  const now   = Math.floor(Date.now() / 1000)

  let paymentId = null
  let paymentError = null
  if (buyer.lightning_address) {
    try {
      const result = await lightning.pay(buyer.lightning_address, req.budget_sats)
      paymentId = result.payment_id
    } catch (e) {
      paymentError = e.message
      console.error('[settlement] Timeout refund failed:', e.message)
    }
  }

  prepare(`UPDATE requests SET status='refunded', completed_at=? WHERE id=?`).run(now, requestId)
  logEvent(requestId, 'timeout', buyer.pubkey, {
    refund_sats:       req.budget_sats,
    lightning_address: buyer.lightning_address || null,
    payment_id:        paymentId,
    payment_error:     paymentError
  })

  return { refundSats: req.budget_sats, paymentId, paymentError }
}

module.exports = { logEvent, settleSuccess, settleFailure, settleTimeout }
