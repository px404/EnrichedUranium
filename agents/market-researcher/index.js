'use strict'
/**
 * Market Researcher Agent — port 4001
 * Receives tasks from AgentMarket platform (dispatch to endpoint_url)
 * Uses DeepSeek to produce market research
 * POSTs result back to result_url
 */

const express  = require('express')
const { chat } = require('../shared/deepseek')
const { submitResult, discoverSchema, logAgentEvent } = require('../shared/platform')

const app             = express()
const PORT            = 4001
const PUBKEY          = 'agent-researcher-001'
const PLATFORM_SECRET = process.env.PLATFORM_SECRET

app.use(express.json())

function requirePlatformSecret(req, res, next) {
  if (!PLATFORM_SECRET) return next()  // not configured in dev — allow
  if (req.headers['x-platform-secret'] !== PLATFORM_SECRET)
    return res.status(403).json({ error: 'forbidden', message: 'Missing or invalid platform secret' })
  next()
}

const SYSTEM = `You are a specialized market research agent for AgentMarket — a machine-to-machine marketplace where AI agents hire other AI agents and pay with Bitcoin Lightning.

Your job: analyze the market for a given product and return structured JSON research.
Always return ONLY valid JSON with no markdown fences, no explanations.`

app.post('/task', requirePlatformSecret, async (req, res) => {
  const { request_id, input_payload, result_url } = req.body
  const received = Object.keys(input_payload || {}).join(', ')
  console.log('[researcher] Task received:', request_id)
  console.log('[researcher]   Input fields:', received)
  res.json({ status: 'accepted', request_id })

  logAgentEvent(request_id, PUBKEY, 'agent_task_accepted',
    { agent: 'market-researcher', input_fields: received, product: input_payload?.product_name })

  try {
    logAgentEvent(request_id, PUBKEY, 'agent_thinking',
      { agent: 'market-researcher', model: 'deepseek-chat', max_tokens: 350,
        prompt_summary: `Conducting concise market research for "${input_payload.product_name}"` })

    const t0 = Date.now()
    const output = await chat(SYSTEM,
      `Conduct concise market research and return JSON with exactly these fields. Keep every text field to ONE short sentence (40-80 chars). No fluff.
{
  "target_audience": "one short sentence describing who uses this",
  "competitor_landscape": "one short sentence on top 1-2 competitors",
  "key_pain_points": ["pain 1 (short phrase)", "pain 2 (short phrase)"],
  "market_opportunity": "one short sentence on the opening gap"
}

Product: ${input_payload.product_name}
Description: ${input_payload.product_description}
Audience hint: ${input_payload.target_audience_hint || 'not specified'}`,
      0.5, 350)

    logAgentEvent(request_id, PUBKEY, 'agent_responded',
      { agent: 'market-researcher', took_ms: Date.now() - t0,
        preview: JSON.stringify(output).slice(0, 280) })

    await submitResult(request_id, PUBKEY, output)
    console.log('[researcher] Result submitted for', request_id)
  } catch (e) {
    console.error('[researcher] Error processing task:', e.message)
    logAgentEvent(request_id, PUBKEY, 'agent_error', { agent: 'market-researcher', error: e.message })
    await submitResult(request_id, PUBKEY, {
      target_audience:      'Research failed: ' + e.message,
      competitor_landscape: 'N/A',
      key_pain_points:      ['error'],
      market_opportunity:   'N/A'
    }).catch(() => {})
  }
})

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: PUBKEY, port: PORT }))

app.listen(PORT, () => {
  console.log('[researcher] Listening on http://localhost:' + PORT)
  // Announce schema on startup so other agents know what we accept
  discoverSchema('market-research').then(s => {
    if (!s) return
    console.log('[researcher] Schema loaded — accepts:', Object.keys(s.input_schema.properties || {}).join(', '))
    console.log('[researcher] Schema loaded — returns:', Object.keys(s.output_schema.properties || {}).join(', '))
  }).catch(() => {})
})
