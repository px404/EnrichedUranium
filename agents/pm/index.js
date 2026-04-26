'use strict'
/**
 * Project Manager Agent — port 4000
 *
 * Receives a campaign brief, coordinates 3 specialist agents via AgentMarket,
 * pays each one via Lightning, assembles the final campaign.
 *
 * POST /campaign  { product_name, product_description, target_audience_hint }
 *                -> { research, copy, social, assembled_campaign }
 */

const express  = require('express')
const { chat } = require('../shared/deepseek')
const { mdkClient, payAndWait } = require('../shared/mdk')
const { postRequest, pollRequest, selectSeller, getResult, submitResult } = require('../shared/platform')

const app    = express()
const PORT   = 4000
const PUBKEY = 'agent-pm-001'
const WALLET = mdkClient(3457)   // PM's own MDK wallet
const PLATFORM_SECRET = process.env.PLATFORM_SECRET

function requirePlatformSecret(req, res, next) {
  if (!PLATFORM_SECRET) return next()
  if (req.headers['x-platform-secret'] !== PLATFORM_SECRET)
    return res.status(403).json({ error: 'forbidden', message: 'Missing or invalid platform secret' })
  next()
}

const SPECIALIST_PUBKEYS = {
  'market-research': 'agent-researcher-001',
  'copywriting':     'agent-copywriter-001',
  'social-strategy': 'agent-strategist-001'
}

const BUDGETS = {
  'market-research': 60,
  'copywriting':     60,
  'social-strategy': 60
}

app.use(express.json())

const SYSTEM = `You are AgentMarket's Project Manager agent — you coordinate marketing campaigns by hiring specialist agents (market researcher, copywriter, social media strategist) and assembling their work.
Always return ONLY valid JSON with no markdown fences, no explanations.`

// ── POST /task  (platform dispatch — campaign-orchestration capability) ────
app.post('/task', requirePlatformSecret, async (req, res) => {
  const { request_id, input_payload } = req.body
  if (!request_id || !input_payload)
    return res.status(400).json({ error: 'request_id and input_payload are required' })

  const { product_name, product_description, target_audience_hint } = input_payload
  if (!product_name || !product_description)
    return res.status(400).json({ error: 'product_name and product_description are required in input_payload' })

  // Acknowledge immediately so the platform doesn't time out
  res.json({ status: 'accepted', request_id })

  // Run the campaign async, then push the result back to the platform
  runCampaign({ product_name, product_description, target_audience_hint })
    .then(result => submitResult(request_id, PUBKEY, result))
    .then(() => console.log('[PM] Result submitted for request', request_id))
    .catch(e  => console.error('[PM] Task failed for request', request_id, ':', e.message))
})

// ── POST /campaign ─────────────────────────────────────────────────────────
app.post('/campaign', async (req, res) => {
  const { product_name, product_description, target_audience_hint } = req.body

  if (!product_name || !product_description)
    return res.status(400).json({ error: 'product_name and product_description are required' })

  console.log('\n[PM] === New campaign brief received ===')
  console.log('[PM] Product:', product_name)

  try {
    const campaign = await runCampaign({ product_name, product_description, target_audience_hint })
    return res.json(campaign)
  } catch (e) {
    console.error('[PM] Campaign failed:', e.message)
    return res.status(500).json({ error: e.message })
  }
})

// ── Core orchestration ─────────────────────────────────────────────────────
async function runCampaign({ product_name, product_description, target_audience_hint }) {

  // ── Step 1: Market Research ──────────────────────────────────────────────
  console.log('\n[PM] Step 1/3 — Hiring Market Researcher (60 sats)')
  const researchResult = await hireSpecialist('market-research', {
    product_name,
    product_description,
    target_audience_hint: target_audience_hint || 'developers and AI enthusiasts'
  })
  console.log('[PM] Research complete:', Object.keys(researchResult.output_payload).join(', '))

  // ── Step 2: Copywriting (informed by research) ───────────────────────────
  console.log('\n[PM] Step 2/3 — Hiring Copywriter (60 sats)')
  const copyResult = await hireSpecialist('copywriting', {
    product_name,
    product_description,
    market_research: researchResult.output_payload
  })
  console.log('[PM] Copy complete:', Object.keys(copyResult.output_payload).join(', '))

  // ── Step 3: Social Strategy (informed by research + copy) ────────────────
  console.log('\n[PM] Step 3/3 — Hiring Social Strategist (60 sats)')
  const socialResult = await hireSpecialist('social-strategy', {
    product_name,
    target_audience: researchResult.output_payload.target_audience,
    copy:            copyResult.output_payload
  })
  console.log('[PM] Social strategy complete:', socialResult.output_payload.posts?.length, 'posts')

  // ── Step 4: PM assembles final deliverable ───────────────────────────────
  console.log('\n[PM] Assembling final campaign...')
  const assembled = await chat(SYSTEM,
    `You have received specialist deliverables. Assemble them into a final campaign summary JSON:
{
  "campaign_title": "catchy internal title for this campaign",
  "executive_summary": "2-3 sentence overview of the campaign strategy",
  "key_message": "the single most important message to communicate",
  "launch_recommendation": "concrete first action the team should take this week"
}

Research: ${JSON.stringify(researchResult.output_payload)}
Copy: ${JSON.stringify(copyResult.output_payload)}
Social: ${JSON.stringify(socialResult.output_payload)}`)

  console.log('\n[PM] === Campaign complete ===\n')

  return {
    product:    product_name,
    pm_pubkey:  PUBKEY,
    research:   researchResult.output_payload,
    copy:       copyResult.output_payload,
    social:     socialResult.output_payload,
    assembled_campaign: assembled,
    payments: {
      market_research: BUDGETS['market-research'],
      copywriting:     BUDGETS['copywriting'],
      social_strategy: BUDGETS['social-strategy'],
      total_sats:      Object.values(BUDGETS).reduce((a, b) => a + b, 0)
    }
  }
}

// ── Hire one specialist via AgentMarket ───────────────────────────────────
async function hireSpecialist(capabilityTag, inputPayload) {
  const budget      = BUDGETS[capabilityTag]
  const sellerPubkey = SPECIALIST_PUBKEYS[capabilityTag]

  // 1. Post request to platform — get back an invoice
  const request = await postRequest(PUBKEY, capabilityTag, inputPayload, budget)
  console.log('[PM]   Request posted:', request.id, '| status:', request.status)

  // 2. Pay the escrow invoice from PM wallet (if one was generated)
  if (request.invoice) {
    console.log('[PM]   Paying escrow invoice (' + budget + ' sats) from PM wallet...')
    await payAndWait(WALLET, request.invoice)
    console.log('[PM]   Invoice paid — waiting for platform to confirm...')
    await pollRequest(request.id, 'matched')
  }

  // 3. Select the specialist from the shortlist
  console.log('[PM]   Selecting seller:', sellerPubkey)
  await selectSeller(request.id, sellerPubkey)

  // 4. Platform dispatches to seller's endpoint_url — poll until completed
  console.log('[PM]   Task dispatched — waiting for specialist to deliver...')
  await pollRequest(request.id, 'completed', 180000)

  // 5. Fetch the result
  const result = await getResult(request.id)
  console.log('[PM]   Result received — validation:', result.validation_status)
  return result
}

app.get('/health', (_req, res) => {
  WALLET.balance()
    .then(b => res.json({ status: 'ok', agent: PUBKEY, port: PORT, wallet_sats: b.balance_sats }))
    .catch(() => res.json({ status: 'ok', agent: PUBKEY, port: PORT, wallet_sats: 'unavailable' }))
})

app.listen(PORT, () => {
  console.log('[PM] Project Manager Agent listening on http://localhost:' + PORT)
  console.log('[PM] POST /campaign  { product_name, product_description, target_audience_hint }')
})
