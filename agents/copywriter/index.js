'use strict'
/**
 * Copywriter Agent — port 4002
 */

const express  = require('express')
const { chat } = require('../shared/deepseek')
const { submitResult, discoverSchema, logAgentEvent } = require('../shared/platform')

const app             = express()
const PORT            = 4002
const PUBKEY          = 'agent-copywriter-001'
const PLATFORM_SECRET = process.env.PLATFORM_SECRET

app.use(express.json())

function requirePlatformSecret(req, res, next) {
  if (!PLATFORM_SECRET) return next()
  if (req.headers['x-platform-secret'] !== PLATFORM_SECRET)
    return res.status(403).json({ error: 'forbidden', message: 'Missing or invalid platform secret' })
  next()
}

const SYSTEM = `You are a specialized marketing copywriter agent for AgentMarket — a Bitcoin Lightning-powered marketplace where AI agents hire each other.

Your job: write compelling marketing copy based on market research.
Always return ONLY valid JSON with no markdown fences, no explanations.`

app.post('/task', requirePlatformSecret, async (req, res) => {
  const { request_id, input_payload } = req.body
  const received = Object.keys(input_payload || {}).join(', ')
  console.log('[copywriter] Task received:', request_id)
  console.log('[copywriter]   Input fields:', received)
  res.json({ status: 'accepted', request_id })

  logAgentEvent(request_id, PUBKEY, 'agent_task_accepted',
    { agent: 'copywriter', input_fields: received, product: input_payload?.product_name })

  try {
    logAgentEvent(request_id, PUBKEY, 'agent_thinking',
      { agent: 'copywriter', model: 'deepseek-chat', max_tokens: 300,
        prompt_summary: `Drafting tight copy for "${input_payload.product_name}"` })
    const t0 = Date.now()
    const output = await chat(SYSTEM,
      `Write tight marketing copy. Be brief: respect minimums (elevator_pitch ~50 chars, ad_copy ~100 chars) but do NOT exceed them by much.
Return JSON with exactly these fields:
{
  "headline": "<=8 words",
  "tagline": "<=10 words",
  "elevator_pitch": "ONE short sentence (~50-80 chars)",
  "ad_copy": "ONE concise paragraph (~100-140 chars)",
  "call_to_action": "<=4 words"
}

Product: ${input_payload.product_name}
Description: ${input_payload.product_description}
Research context: ${JSON.stringify(input_payload.market_research || {}).slice(0, 600)}`,
      0.5, 300)

    logAgentEvent(request_id, PUBKEY, 'agent_responded',
      { agent: 'copywriter', took_ms: Date.now() - t0,
        preview: JSON.stringify(output).slice(0, 280) })

    await submitResult(request_id, PUBKEY, output)
    console.log('[copywriter] Result submitted for', request_id)
  } catch (e) {
    console.error('[copywriter] Error:', e.message)
    logAgentEvent(request_id, PUBKEY, 'agent_error', { agent: 'copywriter', error: e.message })
    await submitResult(request_id, PUBKEY, {
      headline:       'AgentMarket: The Agent Economy',
      tagline:        'Where AI agents hire AI agents',
      elevator_pitch: 'AgentMarket is a Lightning-powered marketplace for AI agents.',
      ad_copy:        'Failed to generate copy: ' + e.message,
      call_to_action: 'Learn More'
    }).catch(() => {})
  }
})

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: PUBKEY, port: PORT }))

app.listen(PORT, () => {
  console.log('[copywriter] Listening on http://localhost:' + PORT)
  discoverSchema('copywriting').then(s => {
    if (!s) return
    console.log('[copywriter] Schema loaded — accepts:', Object.keys(s.input_schema.properties || {}).join(', '))
    console.log('[copywriter] Schema loaded — returns:', Object.keys(s.output_schema.properties || {}).join(', '))
  }).catch(() => {})
})
