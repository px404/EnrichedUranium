'use strict'
/**
 * GET /monitor/agents   — per-agent activity summary (requests, sats, recent tasks)
 * GET /monitor/requests — full request log with input/output payloads
 */

const express = require('express')
const router  = express.Router()
const { prepare } = require('../db/database')

const AGENTS = [
  { pubkey: 'agent-pm-001',         display_name: 'Project Manager',       wallet: 'pm',         port: 4000, role: 'orchestrator' },
  { pubkey: 'agent-researcher-001', display_name: 'Market Researcher',     wallet: 'researcher', port: 4001, role: 'seller' },
  { pubkey: 'agent-copywriter-001', display_name: 'Marketing Copywriter',  wallet: 'copywriter', port: 4002, role: 'seller' },
  { pubkey: 'agent-strategist-001', display_name: 'Social Strategist',     wallet: 'strategist', port: 4003, role: 'seller' },
]

function parseJsonSafe(v) {
  if (!v) return null
  try { return JSON.parse(v) } catch (_) { return null }
}

// GET /monitor/agents
router.get('/agents', (req, res) => {
  const agents = AGENTS.map(agent => {
    const asBuyer = prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(budget_sats), 0) as total
      FROM requests WHERE buyer_pubkey = ? AND status = 'completed'
    `).get(agent.pubkey)

    const asSeller = prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(budget_sats), 0) as total
      FROM requests WHERE selected_seller = ? AND status = 'completed'
    `).get(agent.pubkey)

    const inFlight = prepare(`
      SELECT COUNT(*) as cnt FROM requests
      WHERE (buyer_pubkey = ? OR selected_seller = ?)
        AND status IN ('pending_payment','funded','matched','in_progress')
    `).get(agent.pubkey, agent.pubkey)

    const recent = prepare(`
      SELECT r.id, r.capability_tag, r.status, r.budget_sats,
             r.buyer_pubkey, r.selected_seller,
             r.created_at, r.completed_at,
             r.input_payload, r.chain_depth
      FROM requests r
      WHERE r.buyer_pubkey = ? OR r.selected_seller = ?
      ORDER BY r.created_at DESC LIMIT 8
    `).all(agent.pubkey, agent.pubkey).map(r => ({
      ...r,
      input_payload: r.input_payload ? JSON.parse(r.input_payload) : null,
    }))

    return {
      pubkey:       agent.pubkey,
      display_name: agent.display_name,
      wallet:       agent.wallet,
      port:         agent.port,
      role:         agent.role,
      as_buyer: {
        completed:   asBuyer.cnt,
        sats_spent:  asBuyer.total,
      },
      as_seller: {
        completed:   asSeller.cnt,
        sats_earned: asSeller.total,
      },
      in_flight:    inFlight.cnt,
      recent_tasks: recent,
    }
  })

  return res.json({ agents })
})

// GET /monitor/requests?limit=50&status=<status>&capability=<tag>
router.get('/requests', (req, res) => {
  const limit      = Math.min(parseInt(req.query.limit || '50', 10), 200)
  const status     = req.query.status
  const capability = req.query.capability

  let sql = `
    SELECT r.*,
      res.output_payload, res.validation_status, res.validation_score
    FROM requests r
    LEFT JOIN results res ON res.request_id = r.id
    WHERE 1=1
  `
  const params = []
  if (status)     { sql += ' AND r.status = ?';           params.push(status) }
  if (capability) { sql += ' AND r.capability_tag = ?';   params.push(capability) }
  sql += ' ORDER BY r.created_at DESC LIMIT ?'
  params.push(limit)

  const rows = prepare(sql).all(...params).map(r => ({
    id:               r.id,
    capability_tag:   r.capability_tag,
    status:           r.status,
    budget_sats:      r.budget_sats,
    buyer_pubkey:     r.buyer_pubkey,
    selected_seller:  r.selected_seller,
    chain_depth:      r.chain_depth,
    created_at:       r.created_at,
    completed_at:     r.completed_at,
    input_payload:    r.input_payload  ? JSON.parse(r.input_payload)  : null,
    output_payload:   r.output_payload ? JSON.parse(r.output_payload) : null,
    validation_status: r.validation_status || null,
    validation_score:  r.validation_score  || null,
  }))

  return res.json({ requests: rows, count: rows.length })
})

// GET /monitor/requests/:id/events?include_chain=true
//   — chronological backend event trail for one request,
//     optionally including child (chain_parent_id) requests so the UI can
//     show what each sub-agent is doing during PM orchestration.
router.get('/requests/:id/events', (req, res) => {
  const request = prepare('SELECT id FROM requests WHERE id = ?').get(req.params.id)
  if (!request) return res.status(404).json({ error: 'not_found', message: 'Request not found' })

  const includeChain = req.query.include_chain === 'true' || req.query.include_chain === '1'

  const ids = [req.params.id]
  if (includeChain) {
    const children = prepare('SELECT id FROM requests WHERE chain_parent_id = ?').all(req.params.id)
    children.forEach(c => ids.push(c.id))
  }

  const placeholders = ids.map(() => '?').join(',')
  const events = prepare(`
    SELECT id, event, actor_pubkey, detail, created_at, request_id
    FROM transaction_log
    WHERE request_id IN (${placeholders})
    ORDER BY created_at ASC, id ASC
  `).all(...ids).map(e => ({
    id: e.id,
    event: e.event,
    actor_pubkey: e.actor_pubkey,
    detail: parseJsonSafe(e.detail),
    created_at: e.created_at,
    request_id: e.request_id,
  }))

  return res.json({ request_id: req.params.id, events, count: events.length, include_chain: includeChain })
})

// POST /monitor/agent-events  { request_id, actor_pubkey, event, detail }
//   — agents push their own progress hints (LLM start/finish, errors)
//     into transaction_log so the UI can render them as a live agent log.
router.post('/agent-events', express.json({ limit: '32kb' }), (req, res) => {
  const { request_id, actor_pubkey, event, detail } = req.body || {}
  if (!request_id || !event)
    return res.status(400).json({ error: 'missing_fields', message: 'request_id and event are required' })

  const exists = prepare('SELECT id FROM requests WHERE id = ?').get(request_id)
  if (!exists) return res.status(404).json({ error: 'request_not_found' })

  const id = 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  prepare(`
    INSERT INTO transaction_log (id, request_id, event, actor_pubkey, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, request_id, event, actor_pubkey || null, JSON.stringify(detail || {}), Math.floor(Date.now() / 1000))

  return res.status(201).json({ id })
})

module.exports = router
