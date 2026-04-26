'use strict'
/**
 * Social Media Strategist Agent — port 4003
 */

const express  = require('express')
const { chat } = require('../shared/deepseek')
const { submitResult } = require('../shared/platform')

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
  console.log('[strategist] Received task:', request_id)
  res.json({ status: 'accepted', request_id })

  try {
    const output = await chat(SYSTEM,
      `Create a social media strategy and return JSON with exactly this structure:
{
  "posts": [
    {
      "platform": "Twitter/X",
      "content": "tweet text under 280 chars",
      "hashtags": ["tag1", "tag2"],
      "best_time": "Tuesday 9am UTC"
    },
    {
      "platform": "LinkedIn",
      "content": "professional post 100-150 words",
      "hashtags": ["tag1", "tag2"],
      "best_time": "Wednesday 8am UTC"
    },
    {
      "platform": "Product Hunt",
      "content": "launch tagline and description",
      "hashtags": ["tag1"],
      "best_time": "Tuesday 12:01am PST"
    }
  ],
  "posting_schedule": "brief week-by-week rollout plan"
}

Product: ${input_payload.product_name}
Target audience: ${input_payload.target_audience || 'developers and AI enthusiasts'}
Copy to work from: ${JSON.stringify(input_payload.copy || {})}`)

    await submitResult(request_id, PUBKEY, output)
    console.log('[strategist] Result submitted for', request_id)
  } catch (e) {
    console.error('[strategist] Error:', e.message)
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

app.listen(PORT, () => console.log('[strategist] Listening on http://localhost:' + PORT))
