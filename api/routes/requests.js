/**
 * Request lifecycle routes — real Lightning payments via MDK agent-wallet.
 *
 * POST /requests        — validate, build shortlist, generate Lightning invoice
 *                         returns { ...request, invoice, payment_hash } while status='pending_payment'
 *                         background poller advances to 'funded' -> 'matched' on payment
 * GET  /requests        — list (buyer/seller/chain_parent_id filter)
 * GET  /requests/:id    — poll status
 * POST /requests/:id/select — buyer selects seller
 */

'use strict'

const express = require('express')
const router  = express.Router()
const Ajv     = require('ajv')
const { v4: uuidv4 } = require('uuid')

const { prepare }              = require('../db/database')
const { buildShortlist }       = require('../lib/matcher')
const { logEvent, settleTimeout } = require('../lib/settlement')
const lightning                = require('../lib/lightning')

const ajv = new Ajv({ strict: false, allErrors: false })
const DEFAULT_DEADLINE_OFFSET_S = 30 * 60   // 30 minutes

// ── POST /requests ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { buyer_pubkey, capability_tag, input_payload, budget_sats, deadline_unix, chain_parent_id, subtasks } = req.body

  if (!buyer_pubkey || !capability_tag || input_payload === undefined || budget_sats === undefined)
    return res.status(400).json({ error: 'missing_fields', message: 'buyer_pubkey, capability_tag, input_payload, and budget_sats are all required' })
  if (!Number.isInteger(budget_sats) || budget_sats <= 0)
    return res.status(400).json({ error: 'invalid_budget', message: 'budget_sats must be a positive integer' })

  const buyer = prepare('SELECT * FROM actors WHERE pubkey = ?').get(buyer_pubkey)
  if (!buyer) return res.status(400).json({ error: 'buyer_not_found', message: 'Actor "' + buyer_pubkey + '" not found' })
  if (buyer.status !== 'active') return res.status(400).json({ error: 'buyer_inactive', message: 'Buyer "' + buyer_pubkey + '" is not active' })

  const schema = prepare('SELECT * FROM schemas WHERE capability_tag = ?').get(capability_tag)
  if (!schema) return res.status(400).json({ error: 'unknown_capability', message: 'No schema for "' + capability_tag + '"' })

  let inputSchema
  try { inputSchema = JSON.parse(schema.input_schema) } catch (_) { inputSchema = {} }
  const validateInput = ajv.compile(inputSchema)
  if (!validateInput(input_payload))
    return res.status(422).json({ error: 'invalid_input_payload', message: 'Input payload does not match capability input schema', details: ajv.errorsText(validateInput.errors, { separator: '; ' }) })

  const spendCapPerCall = JSON.parse(buyer.spend_cap_per_call || '{}')
  const cap = spendCapPerCall[capability_tag]
  if (cap !== undefined && budget_sats > cap)
    return res.status(422).json({ error: 'spend_cap_exceeded', message: 'budget_sats (' + budget_sats + ') exceeds spend_cap_per_call of ' + cap + ' for "' + capability_tag + '"' })

  // Chain parent validation
  let chainDepth = 0, chainParentId = null
  if (chain_parent_id) {
    const parent = prepare('SELECT * FROM requests WHERE id = ?').get(chain_parent_id)
    if (!parent) return res.status(400).json({ error: 'chain_parent_not_found', message: 'Parent request "' + chain_parent_id + '" not found' })
    if (!['in_progress','matched','funded'].includes(parent.status))
      return res.status(422).json({ error: 'chain_parent_not_active', message: 'Parent request is "' + parent.status + '"' })
    chainDepth = (parent.chain_depth || 0) + 1
    chainParentId = chain_parent_id
    if (chainDepth > buyer.chain_depth_max)
      return res.status(422).json({ error: 'chain_depth_exceeded', message: 'Chain depth ' + chainDepth + ' exceeds buyer chain_depth_max (' + buyer.chain_depth_max + ')' })
  }

  let subtasksJson = null
  if (subtasks !== undefined) {
    if (!Array.isArray(subtasks) || subtasks.length === 0)
      return res.status(400).json({ error: 'invalid_subtasks', message: 'subtasks must be a non-empty array' })
    subtasksJson = JSON.stringify(subtasks)
  }

  const now      = Math.floor(Date.now() / 1000)
  const deadline = deadline_unix || (now + DEFAULT_DEADLINE_OFFSET_S)
  if (!Number.isInteger(deadline) || deadline <= now)
    return res.status(400).json({ error: 'invalid_deadline', message: 'deadline_unix must be in the future' })

  const id = uuidv4()
  const shortlist = buildShortlist(capability_tag, budget_sats)

  // ── Try Lightning invoice; auto-bypass if MDK daemon unreachable ────────
  let invoice = null
  let paymentHash = null

  if (process.env.DEV_BYPASS_PAYMENT !== 'true') {
    try {
      const inv = await lightning.createInvoice(budget_sats,
        'AgentMarket request ' + id + ' (' + capability_tag + ')')
      invoice     = inv.invoice
      paymentHash = inv.payment_hash
    } catch (e) {
      console.log('[requests] Lightning unavailable (' + e.message.slice(0, 80) + ') — auto-advancing without payment')
    }
  } else {
    console.log('[requests] DEV_BYPASS_PAYMENT=true — skipping Lightning invoice for', id)
  }

  // ── Determine initial status based on payment availability ───────────────
  const devBypass     = !invoice
  const initialStatus = devBypass
    ? (shortlist.length > 0 ? 'matched' : 'funded')
    : 'pending_payment'
  const fundedAt  = devBypass ? now  : null
  const matchedAt = devBypass && shortlist.length > 0 ? now : null

  prepare(`INSERT INTO requests
    (id, buyer_pubkey, capability_tag, input_payload, budget_sats, status,
     shortlist, selected_seller, deadline_unix, created_at, funded_at, matched_at,
     completed_at, retry_count, chain_parent_id, chain_depth, subtasks, subtasks_completed,
     payment_hash)
    VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,NULL,0,?,?,?,0,?)`)
    .run(id, buyer_pubkey, capability_tag, JSON.stringify(input_payload), budget_sats,
      initialStatus, JSON.stringify(shortlist), deadline, now,
      fundedAt, matchedAt,
      chainParentId, chainDepth, subtasksJson, paymentHash)

  logEvent(id, 'request_posted', buyer_pubkey, { capability_tag, budget_sats, chain_parent_id: chainParentId })

  if (devBypass) {
    // Log synthetic funding/matching events so audit log stays consistent
    logEvent(id, 'request_funded',  buyer_pubkey, { budget_sats, dev_bypass: true })
    if (shortlist.length > 0)
      logEvent(id, 'request_matched', buyer_pubkey, { shortlist, dev_bypass: true })
  } else {
    // Start background poller — advances to funded -> matched when invoice is paid
    pollForPayment(id, paymentHash, deadline)
  }

  const row = prepare('SELECT * FROM requests WHERE id = ?').get(id)
  const response = formatRequest(row)

  if (invoice) {
    response.invoice              = invoice
    response.payment_hash         = paymentHash
    response.payment_instructions = 'Pay this Lightning invoice to fund the request. Poll GET /requests/' + id + ' to track status.'
  }

  return res.status(201).json(response)
})

// ── Payment poller ─────────────────────────────────────────────────────────────
/**
 * Background async function — resolves when invoice is paid or deadline passes.
 * Advances request: pending_payment -> funded -> matched
 */
async function pollForPayment(requestId, paymentHash, deadlineUnix) {
  const timeoutMs  = (deadlineUnix - Math.floor(Date.now() / 1000)) * 1000
  const intervalMs = 5000

  try {
    await lightning.waitForPayment(paymentHash, timeoutMs, intervalMs)

    // Invoice paid — advance to funded then matched
    const req = prepare('SELECT * FROM requests WHERE id = ?').get(requestId)
    if (!req || req.status !== 'pending_payment') return  // already handled elsewhere

    const now       = Math.floor(Date.now() / 1000)
    const shortlist = buildShortlist(req.capability_tag, req.budget_sats)
    const newStatus = shortlist.length > 0 ? 'matched' : 'funded'

    prepare('UPDATE requests SET status=?, funded_at=?, matched_at=? WHERE id=?')
      .run(newStatus, now, shortlist.length > 0 ? now : null, requestId)
    prepare('UPDATE requests SET shortlist=? WHERE id=?')
      .run(JSON.stringify(shortlist), requestId)

    logEvent(requestId, 'request_funded', req.buyer_pubkey, { budget_sats: req.budget_sats, payment_hash: paymentHash })
    if (shortlist.length > 0)
      logEvent(requestId, 'request_matched', req.buyer_pubkey, { shortlist })

    console.log('[payment] Request ' + requestId + ' funded and ' + newStatus)
  } catch (e) {
    // Timeout or payment failed — settle as timeout
    console.warn('[payment] Request ' + requestId + ' payment did not arrive:', e.message)
    const req = prepare('SELECT * FROM requests WHERE id = ?').get(requestId)
    if (req && req.status === 'pending_payment') {
      await settleTimeout(requestId).catch(err => console.error('[payment] Timeout settle error:', err))
    }
  }
}

/**
 * Reconcile a pending_payment request against wallet history.
 * This recovers requests that got stuck after process restarts or missed pollers.
 */
async function reconcilePendingPayment(requestId) {
  const req = prepare('SELECT * FROM requests WHERE id = ?').get(requestId)
  if (!req || req.status !== 'pending_payment' || !req.payment_hash) return false

  const rows = await lightning.listPayments().catch(() => [])
  const hit = rows.find(p => {
    const hash = p.paymentHash ?? p.payment_hash
    return hash === req.payment_hash
  })
  if (!hit || hit.status !== 'completed') return false

  const now       = Math.floor(Date.now() / 1000)
  const shortlist = buildShortlist(req.capability_tag, req.budget_sats)
  const newStatus = shortlist.length > 0 ? 'matched' : 'funded'

  prepare('UPDATE requests SET status=?, funded_at=?, matched_at=?, shortlist=? WHERE id=?')
    .run(newStatus, now, shortlist.length > 0 ? now : null, JSON.stringify(shortlist), requestId)
  logEvent(requestId, 'request_funded', req.buyer_pubkey, { budget_sats: req.budget_sats, payment_hash: req.payment_hash, reconciled: true })
  if (shortlist.length > 0) {
    logEvent(requestId, 'request_matched', req.buyer_pubkey, { shortlist, reconciled: true })
  }
  return true
}

// ── Seller dispatch ────────────────────────────────────────────────────────────
/**
 * POST the task to the seller's endpoint_url.
 * Fire-and-forget — called after the DB is updated, response already sent to buyer.
 *
 * Payload delivered to seller:
 *   request_id      — seller uses this to POST /results/:request_id
 *   capability_tag
 *   input_payload
 *   budget_sats
 *   deadline_unix
 *   result_url      — full URL to submit results to
 *   platform_url    — base URL of this platform
 */
async function dispatchToSeller(requestId, sellerPubkey, request) {
  const seller = prepare('SELECT endpoint_url FROM actors WHERE pubkey = ?').get(sellerPubkey)

  if (!seller || !seller.endpoint_url) {
    console.log('[dispatch] Seller "' + sellerPubkey + '" has no endpoint_url — seller must poll GET /requests')
    logEvent(requestId, 'task_dispatch_skipped', sellerPubkey, {
      reason: 'no_endpoint_url',
      note: 'seller must poll for tasks'
    })
    return
  }

  const PLATFORM_URL = process.env.PLATFORM_URL || 'http://localhost:3001'

  const payload = {
    request_id:     requestId,
    capability_tag: request.capability_tag,
    input_payload:  JSON.parse(request.input_payload),
    budget_sats:    request.budget_sats,
    deadline_unix:  request.deadline_unix,
    result_url:     PLATFORM_URL + '/results/' + requestId,
    platform_url:   PLATFORM_URL
  }

  try {
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), 10000)  // 10s timeout

    const headers = { 'Content-Type': 'application/json' }
    if (process.env.PLATFORM_SECRET) headers['X-Platform-Secret'] = process.env.PLATFORM_SECRET

    const response = await fetch(seller.endpoint_url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(payload),
      signal:  controller.signal
    })
    clearTimeout(timeout)

    const body = await response.text().catch(() => '')

    if (response.ok) {
      console.log('[dispatch] Task delivered to seller "' + sellerPubkey + '" at ' + seller.endpoint_url + ' (' + response.status + ')')
      logEvent(requestId, 'task_dispatched', sellerPubkey, {
        endpoint_url:  seller.endpoint_url,
        http_status:   response.status
      })
    } else {
      console.warn('[dispatch] Seller endpoint returned ' + response.status + ' — seller may still poll')
      logEvent(requestId, 'task_dispatch_failed', sellerPubkey, {
        endpoint_url: seller.endpoint_url,
        http_status:  response.status,
        body:         body.slice(0, 200)
      })
    }
  } catch (e) {
    const reason = e.name === 'AbortError' ? 'timeout (10s)' : e.message
    console.warn('[dispatch] Could not reach seller endpoint "' + seller.endpoint_url + '": ' + reason)
    logEvent(requestId, 'task_dispatch_failed', sellerPubkey, {
      endpoint_url: seller.endpoint_url,
      error:        reason
    })
  }
}

// ── GET /requests ──────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { buyer_pubkey, seller_pubkey, status, chain_parent_id } = req.query
  if (!buyer_pubkey && !seller_pubkey && !chain_parent_id)
    return res.status(400).json({ error: 'missing_filter', message: 'Provide at least one of: buyer_pubkey, seller_pubkey, chain_parent_id' })

  let sql = 'SELECT * FROM requests WHERE 1=1'
  const params = []
  if (buyer_pubkey)    { sql += ' AND buyer_pubkey = ?';    params.push(buyer_pubkey) }
  if (seller_pubkey)   { sql += ' AND selected_seller = ?'; params.push(seller_pubkey) }
  if (status)          { sql += ' AND status = ?';          params.push(status) }
  if (chain_parent_id) { sql += ' AND chain_parent_id = ?'; params.push(chain_parent_id) }
  sql += ' ORDER BY created_at DESC'

  return res.json({ requests: prepare(sql).all(...params).map(formatRequest), count: prepare(sql).all(...params).length })
})

// ── GET /requests/:id ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  let request = prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id)
  if (!request) return res.status(404).json({ error: 'not_found', message: 'Request "' + req.params.id + '" not found' })

  if (request.status === 'pending_payment' && request.payment_hash) {
    await reconcilePendingPayment(request.id).catch(() => {})
    request = prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id)
  }

  return res.json(formatRequest(request))
})

// ── POST /requests/:id/select ──────────────────────────────────────────────────
router.post('/:id/select', async (req, res) => {
  const { seller_pubkey } = req.body
  if (!seller_pubkey) return res.status(400).json({ error: 'missing_fields', message: 'seller_pubkey is required' })

  const request = prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id)
  if (!request) return res.status(404).json({ error: 'not_found', message: 'Request "' + req.params.id + '" not found' })

  const seller = prepare('SELECT * FROM actors WHERE pubkey = ?').get(seller_pubkey)
  if (!seller) return res.status(400).json({ error: 'seller_not_found', message: 'Actor "' + seller_pubkey + '" not found' })
  if (seller.status !== 'active') return res.status(400).json({ error: 'seller_inactive', message: 'Seller "' + seller_pubkey + '" is not active' })

  const shortlist = JSON.parse(request.shortlist || '[]')
  if (!shortlist.includes(seller_pubkey))
    return res.status(422).json({ error: 'seller_not_shortlisted', message: 'Seller "' + seller_pubkey + '" is not in the shortlist' })

  if (request.status !== 'matched' && request.status !== 'funded')
    return res.status(422).json({ error: 'invalid_status', message: 'Request is "' + request.status + '", expected matched or funded' })

  const now = Math.floor(Date.now() / 1000)
  prepare('UPDATE requests SET selected_seller=?, status=?, matched_at=? WHERE id=?')
    .run(seller_pubkey, 'in_progress', request.matched_at || now, request.id)

  logEvent(request.id, 'seller_selected', request.buyer_pubkey, { seller_pubkey })

  // Fire-and-forget dispatch to seller's endpoint
  dispatchToSeller(request.id, seller_pubkey, request)

  const updated = prepare('SELECT * FROM requests WHERE id = ?').get(request.id)
  return res.json(formatRequest(updated))
})

// ── Helper: format a request row ───────────────────────────────────────────────
function formatRequest(row) {
  return {
    id:               row.id,
    buyer_pubkey:     row.buyer_pubkey,
    capability_tag:   row.capability_tag,
    input_payload:    JSON.parse(row.input_payload || 'null'),
    budget_sats:      row.budget_sats,
    status:           row.status,
    shortlist:        JSON.parse(row.shortlist || '[]'),
    selected_seller:  row.selected_seller,
    deadline_unix:    row.deadline_unix,
    created_at:       row.created_at,
    funded_at:        row.funded_at,
    matched_at:       row.matched_at,
    completed_at:     row.completed_at,
    retry_count:      row.retry_count,
    chain_parent_id:  row.chain_parent_id,
    chain_depth:      row.chain_depth,
    subtasks:         row.subtasks ? JSON.parse(row.subtasks) : null,
    subtasks_completed: row.subtasks_completed,
    payment_hash:     row.payment_hash
  }
}

module.exports = router
