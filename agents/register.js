#!/usr/bin/env node
'use strict'
/**
 * One-time setup script — run ONCE before the demo.
 * Registers capability schemas and all 4 actors on the AgentMarket platform,
 * then prints each agent's Lightning address for funding checks.
 *
 * Usage: node register.js
 *
 * Prerequisites:
 *   - Platform API running on localhost:3001
 *   - All 4 MDK wallet daemons running (ports 3457-3460)
 */

const { mdkClient } = require('./shared/mdk')

const PLATFORM = process.env.PLATFORM_URL || 'http://localhost:3001'

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res  = await fetch(PLATFORM + path, opts)
  const json = await res.json()
  if (!res.ok && res.status !== 409)  // 409 = already exists, that's fine
    console.warn('  WARN', method, path, '->', res.status, JSON.stringify(json).slice(0, 120))
  return { status: res.status, body: json }
}

function ok(label, r) {
  const existed = r.status === 409
  console.log('  ' + (existed ? '[already exists]' : '[created]') + ' ' + label)
}

async function main() {
  console.log('\n=== AgentMarket Agent Registration ===\n')
  console.log('Platform:', PLATFORM)

  // ── 1. Get Lightning addresses from each wallet ──────────────────────────
  console.log('\n[1/4] Fetching wallet Lightning addresses...')

  const wallets = {
    pm:         mdkClient(3457),
    researcher: mdkClient(3458),
    copywriter: mdkClient(3459),
    strategist: mdkClient(3460)
  }

  const offers = {}
  for (const [name, wallet] of Object.entries(wallets)) {
    try {
      const b = await wallet.balance()
      const o = await wallet.receiveBolt12()
      offers[name] = o.offer
      console.log('  ' + name + ': ' + b.balance_sats + ' sats | offer: ' + o.offer.slice(0, 40) + '...')
    } catch (e) {
      console.warn('  ' + name + ': wallet unavailable (' + e.message + ') — lightning_address will be null')
      offers[name] = null
    }
  }

  // ── 2. Register capability schemas ──────────────────────────────────────
  console.log('\n[2/4] Registering capability schemas...')

  const schemas = [
    {
      capability_tag: 'campaign-orchestration',
      display_name:   'Marketing Campaign Orchestration',
      description:    'Coordinates a full marketing campaign by hiring market-research, copywriting, and social-strategy specialists and assembling their outputs into a final campaign package.',
      input_schema: {
        type: 'object',
        properties: {
          product_name:         { type: 'string', minLength: 2 },
          product_description:  { type: 'string', minLength: 10 },
          target_audience_hint: { type: 'string' }
        },
        required: ['product_name', 'product_description']
      },
      output_schema: {
        type: 'object',
        properties: {
          product:           { type: 'string' },
          research:          { type: 'object' },
          copy:              { type: 'object' },
          social:            { type: 'object' },
          assembled_campaign:{ type: 'object' },
          payments:          { type: 'object' }
        },
        required: ['product', 'research', 'copy', 'social', 'assembled_campaign'],
        'x-consistency-rules': ['assembled_campaign must summarise the research, copy and social fields'],
        'x-min-content-length': 10
      }
    },
    {
      capability_tag: 'market-research',
      display_name:   'Market Research',
      description:    'Analyzes target audience, competitor landscape, pain points, and market opportunity for a product.',
      input_schema: {
        type: 'object',
        properties: {
          product_name:        { type: 'string', minLength: 2 },
          product_description: { type: 'string', minLength: 10 },
          target_audience_hint:{ type: 'string' }
        },
        required: ['product_name', 'product_description']
      },
      output_schema: {
        type: 'object',
        properties: {
          target_audience:      { type: 'string', minLength: 30 },
          competitor_landscape: { type: 'string', minLength: 30 },
          key_pain_points:      { type: 'array', items: { type: 'string' }, minItems: 2 },
          market_opportunity:   { type: 'string', minLength: 30 }
        },
        required: ['target_audience', 'competitor_landscape', 'key_pain_points', 'market_opportunity'],
        'x-consistency-rules': ['key_pain_points must relate to the target audience described'],
        'x-min-content-length': 30
      }
    },
    {
      capability_tag: 'copywriting',
      display_name:   'Marketing Copywriting',
      description:    'Creates headlines, taglines, elevator pitches, ad copy, and calls-to-action based on market research.',
      input_schema: {
        type: 'object',
        properties: {
          product_name:        { type: 'string', minLength: 2 },
          product_description: { type: 'string', minLength: 10 },
          market_research:     { type: 'object' }
        },
        required: ['product_name', 'product_description', 'market_research']
      },
      output_schema: {
        type: 'object',
        properties: {
          headline:       { type: 'string', minLength: 5 },
          tagline:        { type: 'string', minLength: 5 },
          elevator_pitch: { type: 'string', minLength: 50 },
          ad_copy:        { type: 'string', minLength: 100 },
          call_to_action: { type: 'string', minLength: 3 }
        },
        required: ['headline', 'tagline', 'elevator_pitch', 'ad_copy', 'call_to_action'],
        'x-consistency-rules': ['ad_copy must align with headline and tagline'],
        'x-min-content-length': 5
      }
    },
    {
      capability_tag: 'social-strategy',
      display_name:   'Social Media Strategy',
      description:    'Creates platform-specific posts, hashtags, timing, and a posting schedule based on copy and research.',
      input_schema: {
        type: 'object',
        properties: {
          product_name:    { type: 'string', minLength: 2 },
          target_audience: { type: 'string' },
          copy:            { type: 'object' }
        },
        required: ['product_name', 'copy', 'target_audience']
      },
      output_schema: {
        type: 'object',
        properties: {
          posts: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              properties: {
                platform:  { type: 'string', enum: ['Twitter/X', 'LinkedIn', 'Product Hunt', 'Instagram', 'Reddit'] },
                content:   { type: 'string', minLength: 20 },
                hashtags:  { type: 'array', items: { type: 'string' }, minItems: 1 },
                best_time: { type: 'string', minLength: 5 }
              },
              required: ['platform', 'content', 'hashtags', 'best_time']
            }
          },
          posting_schedule: { type: 'string', minLength: 20 }
        },
        required: ['posts', 'posting_schedule'],
        'x-consistency-rules': ['each post content must match the platform\'s style and character limits'],
        'x-min-items': 2
      }
    }
  ]

  for (const schema of schemas) {
    const r = await api('POST', '/schemas', schema)
    ok(schema.capability_tag + ' (score must be >=40)', r)
    if (r.status === 201) console.log('    strength score:', r.body.strength_score)
  }

  // ── 3. Register human owner ──────────────────────────────────────────────
  console.log('\n[3/4] Registering owner and agents...')

  const owner = await api('POST', '/actors', {
    pubkey:       'owner-demo-001',
    type:         'human',
    display_name: 'AgentMarket Demo Owner'
  })
  ok('owner-demo-001 (human)', owner)

  // ── 4. Register agents ───────────────────────────────────────────────────
  const agents = [
    {
      pubkey:              'agent-pm-001',
      type:                'agent',
      owner_pubkey:        'owner-demo-001',
      display_name:        'Project Manager Agent',
      capabilities:        ['campaign-orchestration'],
      price_per_call_sats: { 'campaign-orchestration': 200 },
      endpoint_url:        'http://localhost:4000/task',
      lightning_address:   offers.pm,
      chain_depth_max:     3,
      spend_cap_per_session: 300
    },
    {
      pubkey:              'agent-researcher-001',
      type:                'agent',
      owner_pubkey:        'owner-demo-001',
      display_name:        'Market Research Specialist',
      capabilities:        ['market-research'],
      price_per_call_sats: { 'market-research': 35 },
      endpoint_url:        'http://localhost:4001/task',
      lightning_address:   offers.researcher
    },
    {
      pubkey:              'agent-copywriter-001',
      type:                'agent',
      owner_pubkey:        'owner-demo-001',
      display_name:        'Marketing Copywriter Specialist',
      capabilities:        ['copywriting'],
      price_per_call_sats: { 'copywriting': 35 },
      endpoint_url:        'http://localhost:4002/task',
      lightning_address:   offers.copywriter
    },
    {
      pubkey:              'agent-strategist-001',
      type:                'agent',
      owner_pubkey:        'owner-demo-001',
      display_name:        'Social Media Strategy Specialist',
      capabilities:        ['social-strategy'],
      price_per_call_sats: { 'social-strategy': 35 },
      endpoint_url:        'http://localhost:4003/task',
      lightning_address:   offers.strategist
    }
  ]

  for (const agent of agents) {
    const r = await api('POST', '/actors', agent)
    ok(agent.pubkey + ' (' + agent.display_name + ')', r)
    // If already registered, patch the mutable fields so re-runs stay in sync
    if (r.status === 409) {
      const patch = await api('PATCH', '/actors/' + agent.pubkey, {
        capabilities:        agent.capabilities,
        price_per_call_sats: agent.price_per_call_sats,
        endpoint_url:        agent.endpoint_url,
        lightning_address:   agent.lightning_address
      })
      if (patch.status >= 200 && patch.status < 300)
        console.log('    patched:', agent.pubkey)
    }
  }

  // ── 5. Summary ───────────────────────────────────────────────────────────
  console.log('\n=== Registration complete ===')
  console.log('\nWallet funding targets:')
  console.log('  Platform wallet (port 3456): 200 sats  — escrow reserve')
  console.log('  PM wallet       (port 3457): 400 sats  — pays 3×60=180 per campaign + fees')
  console.log('  Researcher      (port 3458): 400 sats  — earns 57 per task (35 price - 5% fee)')
  console.log('  Copywriter      (port 3459): 400 sats  — earns 57 per task')
  console.log('  Strategist      (port 3460): 400 sats  — earns 57 per task\n')
  console.log('Start all agents:')
  console.log('  node agents/pm/index.js')
  console.log('  node agents/market-researcher/index.js')
  console.log('  node agents/copywriter/index.js')
  console.log('  node agents/social-strategist/index.js\n')
  console.log('Trigger a campaign via the marketplace (PM is now a hirable agent):')
  console.log('  curl -s -X POST http://localhost:3001/requests \\')
  console.log('    -H "Content-Type: application/json" \\')
  console.log('    -d \'{"buyer_pubkey":"owner-demo-001","capability_tag":"campaign-orchestration","input_payload":{"product_name":"AgentMarket","product_description":"A machine-to-machine marketplace where AI agents hire other AI agents and pay with Bitcoin Lightning","target_audience_hint":"developers building AI agents"},"budget_sats":200}\'\n')
  console.log('Or trigger directly (bypasses marketplace, no payment):')
  console.log('  curl -s -X POST http://localhost:4000/campaign \\')
  console.log('    -H "Content-Type: application/json" \\')
  console.log('    -d \'{"product_name":"AgentMarket","product_description":"A machine-to-machine marketplace where AI agents hire other AI agents and pay with Bitcoin Lightning","target_audience_hint":"developers building AI agents"}\'\n')
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })
