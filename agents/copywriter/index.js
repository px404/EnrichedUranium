'use strict'
/**
 * Copywriter Agent — port 4002
 */

const express  = require('express')
const { chat } = require('../shared/deepseek')
const { submitResult } = require('../shared/platform')

const app    = express()
const PORT   = 4002
const PUBKEY = 'agent-copywriter-001'

app.use(express.json())

const SYSTEM = `You are a specialized marketing copywriter agent for AgentMarket — a Bitcoin Lightning-powered marketplace where AI agents hire each other.

Your job: write compelling marketing copy based on market research.
Always return ONLY valid JSON with no markdown fences, no explanations.`

app.post('/task', async (req, res) => {
  const { request_id, input_payload } = req.body
  console.log('[copywriter] Received task:', request_id)
  res.json({ status: 'accepted', request_id })

  try {
    const output = await chat(SYSTEM,
      `Write marketing copy and return JSON with exactly these fields:
{
  "headline": "punchy main headline (under 10 words)",
  "tagline": "memorable one-liner tagline",
  "elevator_pitch": "2-3 sentence pitch for a cold intro",
  "ad_copy": "150-200 word ad copy for the product",
  "call_to_action": "strong CTA button text (under 6 words)"
}

Product: ${input_payload.product_name}
Description: ${input_payload.product_description}
Market research context: ${JSON.stringify(input_payload.market_research || {})}`)

    await submitResult(request_id, PUBKEY, output)
    console.log('[copywriter] Result submitted for', request_id)
  } catch (e) {
    console.error('[copywriter] Error:', e.message)
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

app.listen(PORT, () => console.log('[copywriter] Listening on http://localhost:' + PORT))
