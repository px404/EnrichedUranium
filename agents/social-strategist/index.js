'use strict'
/**
 * Social Media Strategist Agent — port 4003
 */

const express  = require('express')
const { chat } = require('../shared/deepseek')
const { submitResult, discoverSchema, logAgentEvent } = require('../shared/platform')

const app             = express()
const PORT            = 4003
const PUBKEY          = 'agent-strategist-001'
const PLATFORM_SECRET = process.env.PLATFORM_SECRET

app.use(express.json())

function requirePlatformSecret(req, res, next) {
  if (!PLATFORM_SECRET) return next()
  if (req.headers['x-platform-secret'] !== PLATFORM_SECRET)
    return res.status(403).json({ error: 'forbidden', message: 'Missing or invalid platform secret' })
  next()
}

const SYSTEM = `You are a specialized social media strategy agent for AgentMarket — a Bitcoin Lightning-powered marketplace where AI agents hire each other.

Your job: create platform-specific social media campaigns based on copy and research.
Always return ONLY valid JSON with no markdown fences, no explanations.`

app.post('/task', requirePlatformSecret, async (req, res) => {
  const { request_id, input_payload } = req.body
  const received = Object.keys(input_payload || {}).join(', ')
  console.log('[strategist] Task received:', request_id)
  console.log('[strategist]   Input fields:', received)
  res.json({ status: 'accepted', request_id })

  logAgentEvent(request_id, PUBKEY, 'agent_task_accepted',
    { agent: 'social-strategist', input_fields: received, product: input_payload?.product_name })

  try {
    logAgentEvent(request_id, PUBKEY, 'agent_thinking',
      { agent: 'social-strategist', model: 'deepseek-chat', max_tokens: 400,
        prompt_summary: `Planning short social rollout for "${input_payload.product_name}"` })
    const t0 = Date.now()
    const output = await chat(SYSTEM,
      `Create a SHORT social strategy. Each post.content ~25-60 chars (must be >=20). posting_schedule: ONE sentence (~30 chars).
Return JSON with exactly this structure (2 posts is enough):
{
  "posts": [
    {
      "platform": "Twitter/X",
      "content": "short tweet, <=120 chars",
      "hashtags": ["tag1", "tag2"],
      "best_time": "Tue 9am"
    },
    {
      "platform": "LinkedIn",
      "content": "short post, <=120 chars",
      "hashtags": ["tag1", "tag2"],
      "best_time": "Wed 8am"
    }
  ],
  "posting_schedule": "one short sentence rollout"
}

Product: ${input_payload.product_name}
Target audience: ${input_payload.target_audience || 'developers and AI enthusiasts'}
Copy: ${JSON.stringify(input_payload.copy || {}).slice(0, 500)}`,
      0.5, 400)

    logAgentEvent(request_id, PUBKEY, 'agent_responded',
      { agent: 'social-strategist', took_ms: Date.now() - t0,
        preview: JSON.stringify(output).slice(0, 280) })

    await submitResult(request_id, PUBKEY, output)
    console.log('[strategist] Result submitted for', request_id)
  } catch (e) {
    console.error('[strategist] Error:', e.message)
    logAgentEvent(request_id, PUBKEY, 'agent_error', { agent: 'social-strategist', error: e.message })
    await submitResult(request_id, PUBKEY, {
      posts: [
        { platform: 'Twitter/X', content: 'Error: ' + e.message, hashtags: ['AgentMarket'], best_time: 'ASAP' },
        { platform: 'LinkedIn',  content: 'Error: ' + e.message, hashtags: ['AgentMarket'], best_time: 'ASAP' }
      ],
      posting_schedule: 'Error generating schedule'
    }).catch(() => {})
  }
})

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: PUBKEY, port: PORT }))

app.listen(PORT, () => {
  console.log('[strategist] Listening on http://localhost:' + PORT)
  discoverSchema('social-strategy').then(s => {
    if (!s) return
    console.log('[strategist] Schema loaded — accepts:', Object.keys(s.input_schema.properties || {}).join(', '))
    console.log('[strategist] Schema loaded — returns:', Object.keys(s.output_schema.properties || {}).join(', '))
  }).catch(() => {})
})
