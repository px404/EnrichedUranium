/**
 * Result submission — Phase 4: subtasks_completed for partial payouts.
 *
 * POST /results/:request_id
 *   Pass  -> settleSuccess
 *   Fail, attempt 1 -> retry allowed
 *   Fail, attempt 2, subtasks_completed > 0 -> partial payout
 *   Fail, attempt 2, no subtasks -> full refund
 */

const express = require('express')
const router  = express.Router()
const { v4: uuidv4 } = require('uuid')

const { prepare }          = require('../db/database')
const { validateResult }   = require('../validators/resultValidator')
const { logEvent, settleSuccess, settleFailure, settleTimeout } = require('../lib/settlement')
const { evaluateBadFaith } = require('../lib/reliabilityScore')

router.post('/:request_id', async (req, res) => {
  const { request_id }    = req.params
  const { seller_pubkey, output_payload, subtasks_completed } = req.body

  if (!seller_pubkey || output_payload === undefined) {
    return res.status(400).json({ error: 'missing_fields', message: 'seller_pubkey and output_payload are required' })
  }

  const request = prepare('SELECT * FROM requests WHERE id = ?').get(request_id)
  if (!request) return res.status(404).json({ error: 'not_found', message: 'Request "' + request_id + '" not found' })

  const now = Math.floor(Date.now() / 1000)
  if (request.deadline_unix < now) {
    settleTimeout(request_id)
    return res.status(410).json({ error: 'request_expired', message: 'Request deadline has passed - request refunded' })
  }
  if (request.status !== 'in_progress') {
    return res.status(409).json({ error: 'invalid_status', message: 'Request is "' + request.status + '" - must be "in_progress" to submit a result' })
  }
  if (request.selected_seller !== seller_pubkey) {
    return res.status(403).json({ error: 'wrong_seller', message: 'Only the selected seller ("' + request.selected_seller + '") may submit results for this request' })
  }

  const schema = prepare('SELECT output_schema FROM schemas WHERE capability_tag = ?').get(request.capability_tag)
  if (!schema) return res.status(500).json({ error: 'schema_missing', message: 'Output schema for "' + request.capability_tag + '" not found' })

  let outputSchema
  try { outputSchema = JSON.parse(schema.output_schema) } catch (_) { outputSchema = {} }

  const validation = validateResult(output_payload, outputSchema)
  const resultId   = uuidv4()

  prepare('INSERT INTO results (id, request_id, seller_pubkey, output_payload, validation_status, validation_level, validation_error, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(resultId, request_id, seller_pubkey, JSON.stringify(output_payload), validation.valid ? 'pass' : 'fail', validation.level !== null ? validation.level : null, validation.error || null, now)

  logEvent(request_id, 'result_submitted', seller_pubkey, { result_id: resultId, attempt: request.retry_count + 1 })

  if (validation.valid) {
    logEvent(request_id, 'schema_validated', seller_pubkey, { result_id: resultId })
    settleSuccess(request_id, subtasks_completed)
    return res.status(201).json({
      result_id: resultId, request_id,
      validation_status: 'pass', validation_level: null, validation_error: null,
      consistency_warnings: validation.warnings, settlement: 'payment_released'
    })
  }

  logEvent(request_id, 'schema_failed', seller_pubkey, {
    result_id: resultId, validation_level: validation.level,
    validation_error: validation.error, attempt: request.retry_count + 1, subtasks_completed
  })

  const isRetry          = request.retry_count >= 1
  const settlementResult = await settleFailure(request_id, isRetry, subtasks_completed)

  if (!settlementResult.retry) {
    try { evaluateBadFaith() } catch (e) { console.error('[bad-faith eval] failed:', e.message) }
  }

  let settlementLabel
  if (settlementResult.retry)        settlementLabel = 'retry_allowed'
  else if (settlementResult.partial) settlementLabel = 'partial_payment_released'
  else                               settlementLabel = 'refund_issued'

  return res.status(422).json({
    result_id: resultId, request_id,
    validation_status: 'fail', validation_level: validation.level, validation_error: validation.error,
    consistency_warnings: validation.warnings, settlement: settlementLabel, retry_count: request.retry_count + 1,
    ...(settlementResult.partial && { payout_sats: settlementResult.payout_sats, refund_sats: settlementResult.refund_sats })
  })
})


// ── GET /results/:request_id ──────────────────────────────────────────────────
router.get('/:request_id', (req, res) => {
  const result = prepare('SELECT * FROM results WHERE request_id = ?').get(req.params.request_id)
  if (!result) return res.status(404).json({ error: 'not_found', message: 'No result for request "' + req.params.request_id + '"' })
  return res.json({
    id:                result.id,
    request_id:        result.request_id,
    seller_pubkey:     result.seller_pubkey,
    output_payload:    JSON.parse(result.output_payload),
    validation_status: result.validation_status,
    validation_level:  result.validation_level  || null,
    validation_error:  result.validation_error  || null,
    submitted_at:      result.submitted_at
  })
})

module.exports = router
