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

module.exports = router
