const express = require('express')
const router  = express.Router()
const { prepare } = require('../db/database')

// POST /actors
router.post('/', (req, res) => {
  const {
    pubkey, type, owner_pubkey, display_name, lightning_address,
    capabilities = [], price_per_call_sats = {},
    spend_cap_per_call = {}, spend_cap_per_session = 10000,
    spend_cap_daily_sats = 100000, endpoint_url, webhook_url, chain_depth_max = 5
  } = req.body

  if (!pubkey || !type || !display_name)
    return res.status(400).json({ error: 'missing_fields', message: 'pubkey, type, and display_name are required' })
  if (!['agent','human'].includes(type))
    return res.status(400).json({ error: 'invalid_type', message: 'type must be "agent" or "human"' })
  if (type === 'agent' && capabilities.length > 0 && !endpoint_url)
    return res.status(400).json({ error: 'missing_endpoint', message: 'Agent sellers must provide an endpoint_url' })
  if (type === 'agent' && !owner_pubkey)
    return res.status(400).json({ error: 'missing_owner', message: 'Agents must have an owner_pubkey (human or agent)' })

  const existing = prepare('SELECT pubkey FROM actors WHERE pubkey = ?').get(pubkey)
  if (existing) return res.status(409).json({ error: 'duplicate_pubkey', message: '"' + pubkey + '" is already registered' })

  if (owner_pubkey) {
    const owner = prepare('SELECT pubkey FROM actors WHERE pubkey = ?').get(owner_pubkey)
    if (!owner) return res.status(400).json({ error: 'owner_not_found', message: 'Owner "' + owner_pubkey + '" not found' })
  }

  if (capabilities.length > 0) {
    const placeholders = capabilities.map(() => '?').join(',')
    const known = prepare('SELECT capability_tag FROM schemas WHERE capability_tag IN (' + placeholders + ')').all(...capabilities)
    const knownSet = new Set(known.map(s => s.capability_tag))
    const unknown = capabilities.filter(c => !knownSet.has(c))
    if (unknown.length > 0)
      return res.status(400).json({ error: 'unknown_capabilities', message: 'No schema for: ' + unknown.join(', ') })
  }

  const priceKeys = Object.keys(price_per_call_sats)
  const undeclared = priceKeys.filter(k => !capabilities.includes(k))
  if (undeclared.length > 0)
    return res.status(400).json({ error: 'undeclared_price_capability', message: 'price_per_call_sats has undeclared capabilities: ' + undeclared.join(', ') })

  const now = Math.floor(Date.now() / 1000)
  const midnight = nextMidnightUTC()
  const certTier = {}
  capabilities.forEach(tag => { certTier[tag] = 'Unverified' })

  prepare(`INSERT INTO actors (
    pubkey, type, owner_pubkey, display_name, registered_at,
    capabilities, price_per_call_sats,
    spend_cap_per_call, spend_cap_per_session, spend_cap_daily_sats,
    daily_spend_used, daily_spend_reset_at,
    endpoint_url, status, webhook_url,
    reliability_score, certification_tier, cert_expiry, chain_depth_max, lightning_address
  ) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,'active',?,50.0,?,'{}',?,?)`)
  .run(
    pubkey, type, owner_pubkey || null, display_name, now,
    JSON.stringify(capabilities), JSON.stringify(price_per_call_sats),
    JSON.stringify(spend_cap_per_call), spend_cap_per_session, spend_cap_daily_sats,
    midnight, endpoint_url || null, webhook_url || null,
    JSON.stringify(certTier), chain_depth_max, lightning_address || null
  )

  return res.status(201).json(formatActor(prepare('SELECT * FROM actors WHERE pubkey = ?').get(pubkey)))
})

// GET /actors
router.get('/', (req, res) => {
  const { type, capability, status = 'active', owner_pubkey } = req.query
  let sql = 'SELECT * FROM actors WHERE 1=1'
  const params = []
  if (type)         { sql += ' AND type = ?';            params.push(type) }
  if (status)       { sql += ' AND status = ?';          params.push(status) }
  if (owner_pubkey) { sql += ' AND owner_pubkey = ?';    params.push(owner_pubkey) }
  if (capability)   { sql += ' AND capabilities LIKE ?'; params.push('%"' + capability + '"%') }
  sql += ' ORDER BY reliability_score DESC'
  const rows = prepare(sql).all(...params)
  return res.json({ actors: rows.map(formatActor), count: rows.length })
})

// GET /actors/:pubkey
router.get('/:pubkey', (req, res) => {
  const row = prepare('SELECT * FROM actors WHERE pubkey = ?').get(req.params.pubkey)
  if (!row) return res.status(404).json({ error: 'not_found', message: 'Actor "' + req.params.pubkey + '" not found' })
  return res.json(formatActor(row))
})

// PATCH /actors/:pubkey
router.patch('/:pubkey', (req, res) => {
  const { pubkey } = req.params
  const actor = prepare('SELECT * FROM actors WHERE pubkey = ?').get(pubkey)
  if (!actor) return res.status(404).json({ error: 'not_found', message: 'Actor "' + pubkey + '" not found' })

  const allowed = ['display_name','spend_cap_per_call','spend_cap_per_session',
    'spend_cap_daily_sats','endpoint_url','status','webhook_url','chain_depth_max','price_per_call_sats','lightning_address']

  if (req.body.capabilities !== undefined) {
    const newCaps = req.body.capabilities
    if (newCaps.length > 0) {
      const placeholders = newCaps.map(() => '?').join(',')
      const known = prepare('SELECT capability_tag FROM schemas WHERE capability_tag IN (' + placeholders + ')').all(...newCaps)
      const knownSet = new Set(known.map(s => s.capability_tag))
      const unknown = newCaps.filter(c => !knownSet.has(c))
      if (unknown.length > 0)
        return res.status(400).json({ error: 'unknown_capabilities', message: 'No schema for: ' + unknown.join(', ') })
    }
    const current = JSON.parse(actor.capabilities)
    const removed = current.filter(c => !newCaps.includes(c))
    if (removed.length > 0)
      return res.status(422).json({ error: 'capability_removal_notice_required', message: 'Removing capabilities requires 48h notice. Flagged: ' + removed.join(', ') })

    const currentTiers = JSON.parse(actor.certification_tier)
    newCaps.forEach(tag => { if (!currentTiers[tag]) currentTiers[tag] = 'Unverified' })
    req.body.certification_tier = currentTiers
    allowed.push('certification_tier', 'capabilities')
  }

  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined)
      updates[key] = typeof req.body[key] === 'object' ? JSON.stringify(req.body[key]) : req.body[key]
  }
  if (Object.keys(updates).length === 0)
    return res.status(400).json({ error: 'no_valid_fields', message: 'Allowed fields: ' + allowed.join(', ') })

  const setClauses = Object.keys(updates).map(k => k + ' = ?').join(', ')
  prepare('UPDATE actors SET ' + setClauses + ' WHERE pubkey = ?').run(...Object.values(updates), pubkey)

  return res.json(formatActor(prepare('SELECT * FROM actors WHERE pubkey = ?').get(pubkey)))
})

// PATCH /actors/:pubkey/status
router.patch('/:pubkey/status', (req, res) => {
  const { status } = req.body
  const { pubkey } = req.params
  if (!['active','paused','suspended'].includes(status))
    return res.status(400).json({ error: 'invalid_status', message: 'status must be active, paused, or suspended' })
  const actor = prepare('SELECT pubkey FROM actors WHERE pubkey = ?').get(pubkey)
  if (!actor) return res.status(404).json({ error: 'not_found', message: 'Actor "' + pubkey + '" not found' })
  prepare('UPDATE actors SET status = ? WHERE pubkey = ?').run(status, pubkey)
  return res.json({ pubkey, status })
})

// DELETE /actors/:pubkey  — hard-delete an actor and all their associated data
router.delete('/:pubkey', (req, res) => {
  const { pubkey } = req.params
  const actor = prepare('SELECT pubkey FROM actors WHERE pubkey = ?').get(pubkey)
  if (!actor) return res.status(404).json({ error: 'not_found', message: 'Actor "' + pubkey + '" not found' })

  prepare('DELETE FROM reliability_score_cache WHERE actor_pubkey = ?').run(pubkey)
  prepare('DELETE FROM bad_faith_flags WHERE buyer_pubkey = ? OR seller_pubkey = ?').run(pubkey, pubkey)
  prepare('DELETE FROM results WHERE seller_pubkey = ?').run(pubkey)
  prepare('DELETE FROM transaction_log WHERE actor_pubkey = ?').run(pubkey)
  prepare('DELETE FROM requests WHERE buyer_pubkey = ? OR selected_seller = ?').run(pubkey, pubkey)
  prepare('DELETE FROM sessions WHERE buyer_pubkey = ? OR seller_pubkey = ?').run(pubkey, pubkey)
  prepare('DELETE FROM actors WHERE pubkey = ?').run(pubkey)

  return res.json({ deleted: pubkey })
})

// GET /actors/:pubkey/schemas — all capability schemas for this actor (agent discovery endpoint)
router.get('/:pubkey/schemas', (req, res) => {
  const actor = prepare('SELECT pubkey, capabilities, display_name FROM actors WHERE pubkey = ?').get(req.params.pubkey)
  if (!actor) return res.status(404).json({ error: 'not_found', message: 'Actor "' + req.params.pubkey + '" not found' })

  const caps = JSON.parse(actor.capabilities || '[]')
  const schemas = caps.map(cap => {
    const schema = prepare('SELECT * FROM schemas WHERE capability_tag = ?').get(cap)
    if (!schema) return null
    return {
      capability_tag:   schema.capability_tag,
      display_name:     schema.display_name,
      description:      schema.description,
      input_schema:     JSON.parse(schema.input_schema  || '{}'),
      output_schema:    JSON.parse(schema.output_schema || '{}'),
      strength_score:   schema.strength_score
    }
  }).filter(Boolean)

  return res.json({
    actor_pubkey: req.params.pubkey,
    display_name: actor.display_name,
    capability_count: schemas.length,
    capabilities: schemas
  })
})

// GET /actors/:pubkey/history
router.get('/:pubkey/history', (req, res) => {
  const { pubkey } = req.params
  const actor = prepare('SELECT pubkey FROM actors WHERE pubkey = ?').get(pubkey)
  if (!actor) return res.status(404).json({ error: 'not_found', message: 'Actor "' + pubkey + '" not found' })

  const limit      = Math.min(parseInt(req.query.limit || '50', 10), 200)
  const before     = req.query.before      ? parseInt(req.query.before, 10) : null
  const eventTypes = req.query.event_types ? req.query.event_types.split(',').map(s => s.trim()) : null
  const capTag     = req.query.capability_tag || null

  let sql = `SELECT tl.* FROM transaction_log tl
    WHERE (tl.actor_pubkey = ?
      OR tl.request_id IN (
        SELECT id FROM requests WHERE buyer_pubkey = ? OR selected_seller = ?
      )
    )`
  const params = [pubkey, pubkey, pubkey]

  if (before) {
    sql += ' AND tl.created_at < ?'
    params.push(before)
  }
  if (eventTypes && eventTypes.length > 0) {
    sql += ' AND tl.event IN (' + eventTypes.map(() => '?').join(',') + ')'
    params.push(...eventTypes)
  }
  if (capTag) {
    sql += ' AND tl.request_id IN (SELECT id FROM requests WHERE capability_tag = ?)'
    params.push(capTag)
  }

  sql += ' ORDER BY tl.created_at DESC LIMIT ' + limit

  const rows = prepare(sql).all(...params)
  const events = rows.map(row => ({
    log_id:       row.id,
    event_type:   row.event,
    timestamp:    row.created_at,
    request_id:   row.request_id   || null,
    actor_pubkey: row.actor_pubkey || null,
    detail:       row.detail ? JSON.parse(row.detail) : null
  }))

  return res.json({ events, next_cursor: rows.length === limit ? rows[rows.length - 1].created_at : null })
})

function formatActor(row) {
  return {
    pubkey:                row.pubkey,
    type:                  row.type,
    owner_pubkey:          row.owner_pubkey,
    display_name:          row.display_name,
    registered_at:         row.registered_at,
    capabilities:          JSON.parse(row.capabilities),
    price_per_call_sats:   JSON.parse(row.price_per_call_sats),
    spend_cap_per_call:    JSON.parse(row.spend_cap_per_call),
    spend_cap_per_session: row.spend_cap_per_session,
    spend_cap_daily_sats:  row.spend_cap_daily_sats,
    // endpoint_url and webhook_url are internal — never exposed to API consumers
    status:                row.status,
    reliability_score:     row.reliability_score,
    certification_tier:    JSON.parse(row.certification_tier),
    cert_expiry:           JSON.parse(row.cert_expiry),
    chain_depth_max:       row.chain_depth_max,
    lightning_address:     row.lightning_address || null
  }
}

function nextMidnightUTC() {
  const now = new Date()
  return Math.floor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).getTime() / 1000)
}

module.exports = router
