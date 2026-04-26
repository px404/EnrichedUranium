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
      capabilities:        [],
      price_per_call_sats: {},
      endpoint_url:        'http://localhost:4000/task',
      lightning_address:   offers.pm,
      chain_depth_max:     3,
      spend_cap_per_session: 500
    },
    {
      pubkey:              'agent-researcher-001',
      type:                'agent',
      owner_pubkey:        'owner-demo-001',
      display_name:        'Market Research Specialist',
      capabilities:        ['market-research'],
      price_per_call_sats: { 'market-research': 80 },
      endpoint_url:        'http://localhost:4001/task',
      lightning_address:   offers.researcher
    },
    {
      pubkey:              'agent-copywriter-001',
      type:                'agent',
      owner_pubkey:        'owner-demo-001',
      display_name:        'Marketing Copywriter Specialist',
      capabilities:        ['copywriting'],
      price_per_call_sats: { 'copywriting': 100 },
      endpoint_url:        'http://localhost:4002/task',
      lightning_address:   offers.copywriter
    },
    {
      pubkey:              'agent-strategist-001',
      type:                'agent',
      owner_pubkey:        'owner-demo-001',
      display_name:        'Social Media Strategy Specialist',
      capabilities:        ['social-strategy'],
      price_per_call_sats: { 'social-strategy': 80 },
      endpoint_url:        'http://localhost:4003/task',
      lightning_address:   offers.strategist
    }
  ]

  for (const agent of agents) {
    const r = await api('POST', '/actors', agent)
    ok(agent.pubkey + ' (' + agent.display_name + ')', r)
  }

  // ── 5. Summary ───────────────────────────────────────────────────────────
  console.log('\n=== Registration complete ===')
  console.log('\nFund PM wallet (port 3457) with at least 300 sats before running the demo.')
  console.log('PM needs: 80 (research) + 100 (copy) + 80 (social) = 260 sats + Lightning fees\n')
  console.log('To fund PM wallet, run in a terminal:')
  console.log('  npx @moneydevkit/agent-wallet@latest receive 500')
  console.log('  (then pay that invoice from your Lexe wallet)\n')
  console.log('Then start all agents and trigger the campaign:')
  console.log('  node agents/pm/index.js')
  console.log('  node agents/market-researcher/index.js')
  console.log('  node agents/copywriter/index.js')
  console.log('  node agents/social-strategist/index.js')
  console.log('\n  curl -s -X POST http://localhost:4000/campaign \\')
  console.log('    -H "Content-Type: application/json" \\')
  console.log('    -d \'{"product_name":"AgentMarket","product_description":"A machine-to-machine marketplace where AI agents hire other AI agents and pay with Bitcoin Lightning","target_audience_hint":"developers building AI agents and companies deploying autonomous workflows"}\' | node -e "process.stdin.resume();let d=\'\';process.stdin.on(\'data\',c=>d+=c);process.stdin.on(\'end\',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"')
  console.log('')
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })
