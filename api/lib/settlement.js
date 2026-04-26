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
    // First failure — reset to matched so seller can retry
    prepare(`UPDATE requests SET status='matched', retry_count = retry_count + 1 WHERE id=?`)
      .run(requestId)
    logEvent(requestId, 'schema_failed', req.selected_seller, { retry: true })
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
