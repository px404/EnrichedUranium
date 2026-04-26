'use strict'
/**
 * Market Researcher Agent — port 4001
 * Receives tasks from AgentMarket platform (dispatch to endpoint_url)
 * Uses DeepSeek to produce market research
 * POSTs result back to result_url
 */

const express  = require('express')
const { chat } = require('../shared/deepseek')
const { submitResult } = require('../shared/platform')

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
  console.log('[researcher] Received task:', request_id, '— input:', JSON.stringify(input_payload).slice(0, 80))

  // Acknowledge immediately so platform knows we received it
  res.json({ status: 'accepted', request_id })

  // Process async
  try {
    const output = await chat(SYSTEM,
      `Conduct market research for this product and return JSON with exactly these fields:
{
  "target_audience": "detailed description of who would use this (2-3 sentences)",
  "competitor_landscape": "key competitors and their positioning (2-3 sentences)",
  "key_pain_points": ["pain point 1", "pain point 2", "pain point 3"],
  "market_opportunity": "why now and what gap this fills (2-3 sentences)"
}

Product: ${input_payload.product_name}
Description: ${input_payload.product_description}
Audience hint: ${input_payload.target_audience_hint || 'not specified'}`)

    await submitResult(request_id, PUBKEY, output)
    console.log('[researcher] Result submitted for', request_id)
  } catch (e) {
    console.error('[researcher] Error processing task:', e.message)
    // Submit error result so platform can settle
    await submitResult(request_id, PUBKEY, {
      target_audience:      'Research failed: ' + e.message,
      competitor_landscape: 'N/A',
      key_pain_points:      ['error'],
      market_opportunity:   'N/A'
    }).catch(() => {})
  }
})

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: PUBKEY, port: PORT }))

app.listen(PORT, () => console.log('[researcher] Listening on http://localhost:' + PORT))
