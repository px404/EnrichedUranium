/**
 * Phase 3 — Market intelligence routes (public, no auth).
 *
 * GET /market/pricing/:capability_tag   — price aggregates over a window
 * GET /market/quality/:capability_tag   — median score, cert tier mix, avg pass rate
 * GET /market/compare/:capability_tag   — ranked sellers (value_index/price/score/...)
 * GET /market/trust/:capability_tag     — cert tier density across active sellers
 *
 * All four shapes match md_files/API.md. Underlying aggregation logic lives in
 * lib/marketIntel.js so it can also be unit-tested directly.
 */

const express = require('express')
const router  = express.Router()

const { prepare }            = require('../db/database')
const {
  getPricing, getQuality, getCompare, getTrust
} = require('../lib/marketIntel')

// ── Helper: ensure capability schema exists ─────────────────────────────────
function capabilityExists(tag) {
  return !!prepare('SELECT capability_tag FROM schemas WHERE capability_tag = ?').get(tag)
}

// ── GET /market/pricing/:capability_tag ─────────────────────────────────────
router.get('/pricing/:capability_tag', (req, res) => {
  const { capability_tag } = req.params
  if (!capabilityExists(capability_tag)) {
    return res.status(404).json({
      error:   'unknown_capability',
      message: 'No schema registered for capability "' + capability_tag + '"'
    })
  }
  const window = req.query.window || '7d'
  if (!['24h','7d','30d'].includes(window)) {
    return res.status(400).json({
      error:   'invalid_window',
      message: 'window must be one of: 24h, 7d, 30d'
    })
  }
  return res.json(getPricing(capability_tag, window))
})

// ── GET /market/quality/:capability_tag ─────────────────────────────────────
router.get('/quality/:capability_tag', (req, res) => {
  const { capability_tag } = req.params
  if (!capabilityExists(capability_tag)) {
    return res.status(404).json({
      error:   'unknown_capability',
      message: 'No schema registered for capability "' + capability_tag + '"'
    })
  }
  return res.json(getQuality(capability_tag))
})

// ── GET /market/compare/:capability_tag ─────────────────────────────────────
router.get('/compare/:capability_tag', (req, res) => {
  const { capability_tag } = req.params
  if (!capabilityExists(capability_tag)) {
    return res.status(404).json({
      error:   'unknown_capability',
      message: 'No schema registered for capability "' + capability_tag + '"'
    })
  }
  const allowed = ['value_index','price','score','response_time','volume']
  const sortBy  = req.query.sort_by || 'value_index'
  if (!allowed.includes(sortBy)) {
    return res.status(400).json({
      error:   'invalid_sort_by',
      message: 'sort_by must be one of: ' + allowed.join(', ')
    })
  }
  const allowedTiers = ['Unverified','Basic','Verified','Elite']
  if (req.query.min_cert_tier && !allowedTiers.includes(req.query.min_cert_tier)) {
    return res.status(400).json({
      error:   'invalid_min_cert_tier',
      message: 'min_cert_tier must be one of: ' + allowedTiers.join(', ')
    })
  }
  return res.json(getCompare(capability_tag, {
    sort_by:       sortBy,
    limit:         req.query.limit,
    min_cert_tier: req.query.min_cert_tier
  }))
})

// ── GET /market/trust/:capability_tag ───────────────────────────────────────
router.get('/trust/:capability_tag', (req, res) => {
  const { capability_tag } = req.params
  if (!capabilityExists(capability_tag)) {
    return res.status(404).json({
      error:   'unknown_capability',
      message: 'No schema registered for capability "' + capability_tag + '"'
    })
  }
  return res.json(getTrust(capability_tag))
})

module.exports = router
