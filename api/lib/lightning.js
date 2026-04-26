/**
 * lib/lightning.js
 *
 * Thin wrapper around the MDK agent-wallet daemon REST API (localhost:3456).
 * All methods return plain JS objects or throw on error.
 *
 * Daemon endpoints used:
 *   GET  /health
 *   GET  /balance
 *   POST /receive          { amount_sats, description }  -> { invoice, payment_hash, expires_at }
 *   POST /receive-bolt12   { description }               -> { offer }
 *   POST /send             { destination, amount_sats }  -> { payment_id }
 *   GET  /payment/:id                                    -> { status, ... }
 *   GET  /payments
 *
 * To swap to a different wallet backend, replace this file only.
 * All callers (settlement.js, requests.js, sessions.js) use this interface.
 */

'use strict'

const MDK_PORT = process.env.MDK_WALLET_PORT || 3456
const BASE_URL = `http://127.0.0.1:${MDK_PORT}`

// ── Low-level HTTP ────────────────────────────────────────────────────────────

async function mdkRequest(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  }
  if (body !== undefined) opts.body = JSON.stringify(body)

  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, opts)
  } catch (e) {
    throw new Error('MDK daemon unreachable at ' + BASE_URL + ' — is it running? (' + e.message + ')')
  }

  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) {
    const msg = json.error ? (json.error.message || JSON.stringify(json.error)) : text
    throw new Error('MDK error ' + res.status + ': ' + msg)
  }
  // MDK daemon wraps responses: { success: true, data: { ... } }
  return json.data ?? json
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Check the daemon is reachable. Returns true or throws. */
async function health() {
  await mdkRequest('GET', '/health')
  return true
}

/** Get current wallet balance in sats. */
async function getBalance() {
  const data = await mdkRequest('GET', '/balance')
  return data.balanceSats ?? data.balance_sats ?? 0
}

/**
 * Create a BOLT11 invoice.
 * Returns { invoice, payment_hash, expires_at }
 */
async function createInvoice(amountSats, description = 'AgentMarket payment') {
  const data = await mdkRequest('POST', '/receive', { amount_sats: amountSats, description })
  return {
    invoice:      data.invoice,
    payment_hash: data.paymentHash ?? data.payment_hash,
    expires_at:   data.expiresAt   ?? data.expires_at,
  }
}

/**
 * Get a reusable BOLT12 offer (the platform's "Lightning address" equivalent).
 * Returns { offer }
 */
async function createOffer(description = 'AgentMarket platform') {
  return mdkRequest('POST', '/receive-bolt12', { description })
}

/**
 * Pay a destination (BOLT11 invoice, BOLT12 offer, LNURL, or Lightning address).
 * Returns { payment_id }
 */
async function pay(destination, amountSats) {
  const body = { destination }
  if (amountSats !== undefined) body.amount_sats = amountSats
  const data = await mdkRequest('POST', '/send', body)
  return { payment_id: data.paymentId ?? data.payment_id, ...data }
}

/**
 * Get payment status by payment_id.
 * Returns { status: 'pending'|'completed'|'failed', ... }
 */
async function getPayment(paymentId) {
  return mdkRequest('GET', `/payment/${paymentId}`)
}

/**
 * List all payments. Returns array.
 */
async function listPayments() {
  const data = await mdkRequest('GET', '/payments')
  return data.payments ?? (Array.isArray(data) ? data : [])
}

/**
 * Poll until an inbound invoice (identified by payment_hash) is paid or times out.
 *
 * MDK's /payment/:id endpoint is oriented around outgoing payments, while
 * received invoice settlements are exposed through /payments as inbound entries
 * with paymentHash/payment_hash. We therefore poll the payments list.
 *
 * @param {string} paymentHash   - from createInvoice()
 * @param {number} timeoutMs     - how long to wait (default: 30 min)
 * @param {number} intervalMs    - poll interval (default: 5s)
 * @returns {Promise<object>}    - final inbound payment record
 * @throws if timed out or payment failed
 */
async function waitForPayment(paymentHash, timeoutMs = 30 * 60 * 1000, intervalMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const payments = await listPayments().catch(() => [])
    const payment = payments.find(p => {
      const hash = p.paymentHash ?? p.payment_hash
      return hash === paymentHash
    })
    if (payment) {
      if (payment.status === 'completed') return payment
      if (payment.status === 'failed')
        throw new Error('Payment failed: ' + JSON.stringify(payment))
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('Payment timed out after ' + (timeoutMs / 1000) + 's (hash: ' + paymentHash + ')')
}

module.exports = { health, getBalance, createInvoice, createOffer, pay, getPayment, listPayments, waitForPayment }
