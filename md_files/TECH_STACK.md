# Tech Stack

Every component, every tool, every rationale.

---

## Core platform

### API framework — Next.js (App Router)

MoneyDevKit (MDK) is Next.js-native — one less integration to fight. API routes + server components + human dashboard in one codebase and one deployment. The App Router's server actions work naturally with MDK's payment hooks.

### Database — PostgreSQL via Supabase

Two reasons Postgres wins over alternatives:
1. The `transaction_log` table needs append-only writes AND complex analytical queries (market intelligence aggregations). Postgres handles both. NoSQL databases handle one or the other well.
2. Supabase adds three things for free on top of Postgres: Realtime (row-level change subscriptions — needed for the human task inbox and dashboard), Auth (human actor login), and Row-Level Security (actors can only read their own private fields).

Use Supabase for development and production. Do not run your own Postgres instance during the hackathon.

**Key Supabase Realtime subscriptions:**
- `task_inbox` table: human sellers subscribe to new rows where `human_pubkey = their_pubkey`
- `sessions` table: human buyers subscribe to status changes for their sessions
- `transaction_log` table: dashboard subscribers for live activity feed

### Schema validation — Ajv (Another JSON Schema Validator)

The fastest JSON Schema validator in Node.js. Compile schemas at startup — the compiled validators run in microseconds per invocation. This is critical because every result submission triggers four validation levels synchronously before releasing payment.

```typescript
import Ajv from 'ajv'
const ajv = new Ajv({ strict: true, allErrors: false }) // allErrors: false = stop at first failure

// Compile once at startup
const validateOutput = ajv.compile(schema.output_schema)

// Call synchronously on every result
const valid = validateOutput(resultPayload)
if (!valid) {
  return { level: detectFailedLevel(validateOutput.errors), error: validateOutput.errors[0] }
}
```

### Session tokens — Macaroons (node-macaroons)

L402-compatible. Caveats encode all session parameters — spend limits, expiry, capability scope, chain depth. Aperture on the seller side verifies caveats locally without a platform round trip. The npm package `macaroons.js` handles encoding, decoding, and attenuation.

**Key caveats on a session token:**
```
session_id = uuid
buyer_pubkey = <pubkey>
seller_pubkey = <pubkey>
capability_tag = weather-data
price_per_call_sats = 5
expires_unix = 1735776000
chain_depth = 2
chain_depth_max = 5
```

### Job queue — BullMQ + Redis

Async jobs that must not run in the request cycle:
- Reliability score recomputation (runs every 15 min for every active actor)
- Tier 2 certification test battery execution
- Tier 3 Interviewer Agent probe sessions
- Market intelligence cache refresh (every 5 min)
- Session expiry detection and auto-close (every 60s)
- HTLC timeout monitoring (every 30s)
- Daily spend limit reset (midnight UTC)

BullMQ handles retries, prioritization, delayed jobs, and job deduplication (one reliability recompute per actor per 15-min window, not one per event).

### Caching — Redis (same instance as BullMQ)

Cached items and TTLs:
- Reliability scores: 15-minute TTL (aligned with recompute job)
- Market intelligence aggregates: 5-minute TTL
- Shortlist results for a specific capability + budget: 60-second TTL (reused across similar requests)
- Session remaining balance: 30-second TTL (Aperture reads this on every call-back)

---

## Lightning layer

### Agent wallets + L402 client — MoneyDevKit (MDK)

```bash
npx @moneydevkit/create
```

Every agent gets a Lightning wallet at registration — MDK provisions it. MDK also handles the L402 client side: when a buyer agent's MDK wallet hits a 402, it automatically pays the invoice and retries with the credential. No agent-side Lightning code needed beyond initialising MDK.

The platform escrow wallet also runs on MDK.

### L402 server (seller side) — Aperture

Lightning Labs open-source reverse proxy. Wraps any HTTP endpoint with L402 without touching the backend code. Verifies macaroon caveats locally on every call — no platform round trip.

Deployment: Aperture runs as a sidecar to each seller agent's service. For the hackathon demo, a single Aperture instance in front of mock seller services is sufficient.

Key Aperture capabilities used:
- Invoice generation per request (single-call mode)
- Session token verification (budget window mode)
- Per-call callback to `POST /sessions/:id/call` (in session mode)
- Dynamic pricing (reads `price_per_call_sats` from the actor registry per capability)

### Cloud wallet (escrow) — Lexe

The platform escrow wallet needs to be online 24/7. Lexe provides a cloud-based Lightning wallet with a Python SDK (also has REST API). Supports HTLC creation and resolution — the core escrow primitive.

Lexe Client Credentials allow the platform to control the escrow wallet programmatically. The escrow wallet never holds funds long-term — all HTLCs are designed to resolve (pay seller or timeout-return to buyer) within the task deadline.

### Human wallet (UI) — Alby browser extension

One line of JavaScript to connect. Human actors link Alby to pay Lightning invoices through the dashboard and to receive sats from task settlements.

```typescript
// Connect Alby
const webln = await requestProvider()
// Pay an invoice
await webln.sendPayment(lightningInvoice)
// Show balance
const balance = await webln.getBalance()
```

---

## Interviewer Agent

### Model — Claude API (`claude-sonnet-4-6`)

Probe sequence design, adaptive probing, rubric generation, and output evaluation all require genuine reasoning capability. Sonnet 4.6 balances capability and cost for the volume of probe sessions the platform will run.

The Interviewer is implemented as a standard Claude API call sequence — each probe step is a separate API call with accumulated context (previous probe inputs and outputs) to enable the adaptive behaviour.

### Probe orchestration — BullMQ job pipeline

Each probe session runs as a BullMQ job with sequential steps:

```
Job: probe_session
  Step 1: generate_capability_brief (Claude API call)
  Step 2: design_probe_sequence (Claude API call)
  Step 3..N: send_probe + evaluate_output (for each probe case)
    - Platform sends test task to target agent's endpoint
    - Platform receives result
    - Claude API call evaluates the result against rubric
    - Decision: continue | escalate | stop_early
  Step N+1: generate_probe_report (Claude API call)
  Step N+2: write_certification_result (DB write)
  Step N+3: update_actor_certification_tier (DB write)
  Step N+4: post_webhook (if registered)
```

The job is resumable — if it fails mid-probe, BullMQ retries from the last completed step (using the step index stored in job data).

### Report storage — PostgreSQL JSONB

Probe reports are structured JSON stored in `certification_results.probe_report`. The plain-language summary text is also stored separately in `probe_report_summary` for fast UI retrieval without deserialising the full JSONB.

---

## Human dashboard

### Frontend — Next.js + Tailwind CSS

Same repository as the API. No separate frontend deployment. The dashboard pages are Next.js Server Components for initial load (fast) with Client Components for interactive elements (realtime updates, form submissions, Alby integration).

### Realtime updates — Supabase Realtime

Three realtime subscriptions in the dashboard:
1. `task_inbox` — human sellers see new tasks appear instantly
2. `transaction_log` — activity feed for the agent owner dashboard
3. `sessions` — status updates for active sessions

No polling required. Supabase Realtime uses PostgreSQL's `LISTEN/NOTIFY` under the hood — any row insert or update that matches the subscription filter is pushed to the client over a WebSocket.

---

## Infrastructure

### Deployment — Vercel

Next.js deploys naturally to Vercel. API routes become serverless functions. The human dashboard serves from the edge. Supabase connects as an external database.

**Environment variables needed:**
```
DATABASE_URL=postgresql://...           # Supabase connection string
SUPABASE_ANON_KEY=...                   # For Supabase Realtime client
SUPABASE_SERVICE_ROLE_KEY=...           # For server-side DB operations
MDK_API_KEY=...                         # MoneyDevKit
LEXE_CLIENT_CREDENTIALS=...             # Lexe escrow wallet
ANTHROPIC_API_KEY=...                   # Interviewer Agent (Claude API)
REDIS_URL=redis://...                   # BullMQ + caching
PLATFORM_ESCROW_PUBKEY=...              # Platform's Lightning pubkey
PLATFORM_MACAROON_ROOT_KEY=...          # Root key for issuing session tokens
```

### Background jobs — BullMQ worker

A separate Node.js process runs the BullMQ worker. On Vercel, this runs as a standalone worker deployment. Locally, run with `npm run worker`.

---

# Build Order

Five phases. Each phase produces a working, testable system. Do not start Phase 2 until Phase 1 is end-to-end functional.

---

## Phase 1 — Working agent-to-agent transaction (target: 20 hours)

The goal: two agents, one request, one result, one sat settlement, one transaction log entry.

```
[ ] 1.1  Supabase project setup
         - Create tables: actors, schemas, requests, transaction_log
         - Enable Row-Level Security on actors (private fields)
         - No Realtime yet
         Estimate: 2 hrs

[ ] 1.2  Schema registry
         - POST /schemas with Ajv strength check
         - GET /schemas/:capability_tag
         - Seed 3 platform templates:
             weather-data (input: location+units, output: temp+humidity+timestamp)
             text-summarization (input: text+max_words, output: summary+word_count)
             translation (input: text+source_lang+target_lang, output: translated_text)
         - Each template must include a 10-case test battery
         Estimate: 3 hrs

[ ] 1.3  Actor registry
         - POST /actors with signature verification
         - GET /actors/:pubkey (public fields only)
         - PATCH /actors/:pubkey (authenticated)
         - Validate: capability tags exist in schema registry
         - Validate: endpoint_url present for agent sellers
         Estimate: 3 hrs

[ ] 1.4  Payment — escrow wallet
         - Initialise platform escrow wallet via MDK + Lexe
         - POST /requests → generate Lightning invoice → return to caller
         - Invoice payment webhook → mark request as 'funded'
         - HTLC timeout monitoring job (BullMQ, every 30s)
         Estimate: 4 hrs

[ ] 1.5  Matching engine
         - On request 'funded': query actors for capability match + price
         - Rank by reliability_score (use default 50.0 for all new actors)
         - Apply diversity weighting: demote actors with >35% of recent capability volume
         - Return shortlist of 3 (or fewer if fewer available) to the buyer
         - POST /requests/:id/select: buyer calls this with chosen seller pubkey
         - Fallback: if only one match, still requires explicit buyer selection
         - Selection is always the buyer's decision — the platform never auto-routes
         Estimate: 3 hrs

[ ] 1.6  Result submission + settlement
         - POST /results/:request_id
         - Run 4-level Ajv validation (compile schemas at startup)
         - On pass: release escrow, deduct 5% platform fee, log payment_released
         - On fail: log schema_failed, allow one retry
         - On retry fail: return budget to buyer, log refund_issued
         Estimate: 3 hrs

[ ] 1.7  Transaction log
         - Write log entry on every state transition
         - Instrument: request_posted, request_funded, request_matched,
           request_routed, result_submitted, schema_validated/failed,
           payment_released, refund_issued, timeout
         - GET /actors/:pubkey/history (reads from log)
         - Verify log completeness: replay a transaction from log entries alone
         Estimate: 2 hrs

[ ] 1.8  Demo agents (mock)
         - Buyer agent: script that calls POST /actors (register), POST /requests,
           polls GET /requests/:id, verifies result received
         - Seller agent: simple HTTP server with an L402-gated endpoint
           that returns a mock weather-data response
         - Wire Aperture in front of the seller mock server
         Estimate: 2 hrs

PHASE 1 DONE WHEN:
  - Run buyer agent script
  - Watch request post, fund, match, route, result submit, validate, settle
  - Transaction log shows all events
  - Sats move from buyer wallet to seller wallet (minus platform fee)
  - Total: 1 Lightning invoice in, 1 Lightning payment out
```

---

## Phase 2 — Sessions and spend limits (target: 12 hours)

The goal: open a session, make 10 calls, close it, see one settlement.

```
[ ] 2.1  Sessions table
         - Create sessions table in Supabase
         - Session token issuance (macaroon with caveats)
         - POST /sessions: validate limits, issue invoice, issue token on payment
         - GET /sessions/:id: status + balance
         Estimate: 4 hrs

[ ] 2.2  Aperture session mode
         - Configure Aperture to verify session tokens on the seller's endpoint
         - POST /sessions/:id/call: platform callback for each verified call
         - Decrement remaining_budget on each call
         - Return 402 budget_exhausted when balance runs out
         - Auto-close session on budget exhaustion
         Estimate: 3 hrs

[ ] 2.3  Session settlement
         - POST /sessions/:id/close: compute payout + refund, settle both
         - Background job: detect expired sessions, auto-close + settle
         Estimate: 2 hrs

[ ] 2.4  Spend limits enforcement
         - Per-call: validated at session open only
         - Per-session: validated at session open
         - Daily: increment at open, decrement refund at close
           warn via webhook at 80%, block new sessions at 100%
         - Daily reset job (midnight UTC, BullMQ)
         Estimate: 2 hrs

[ ] 2.5  Top-up
         - POST /sessions/:id/topup: new invoice, increment balance on payment
         Estimate: 1 hr

PHASE 2 DONE WHEN:
  - Buyer agent opens a session (1 invoice)
  - Makes 20 calls via the session token (0 additional invoices)
  - Calls auto-deduct from ledger
  - Session closes (1 settlement to seller, 1 refund to buyer)
  - Daily spend counter correctly increments and decrements
```

---

## Phase 3 — Reliability + market intelligence (target: 14 hours)

The goal: scores, certifications, shortlist ranking, market queries.

```
[ ] 3.1  Reliability score computation
         - BullMQ job: recompute score for every active actor every 15 min
         - Query transaction_log for 90-day window
         - Compute: delivery_rate, schema_pass_rate, acceptance_rate, response_time_score
         - Apply volume weighting for actors with <10 tasks
         - Write to reliability_score_cache
         - Update actors.reliability_score from cache
         - Wire score into matching engine ranking
         Estimate: 3 hrs

[ ] 3.2  Tier 2 certification
         - certification_results table
         - POST /certify/:pubkey/:capability_tag
         - BullMQ job: run test battery from schema.test_battery
           against target agent's endpoint_url
         - Score, determine result_tier, write CertificationResult
         - Update actors.certification_tier + cert_expiry
         - POST webhook if registered
         - GET /certify/:cert_id (poll result)
         - GET /actors/:pubkey/certifications
         Estimate: 4 hrs

[ ] 3.3  Market intelligence
         - market_intel_cache table
         - BullMQ job: refresh cache every 5 min from transaction_log
         - GET /market/pricing/:capability_tag
         - GET /market/quality/:capability_tag
         - GET /market/compare/:capability_tag (with value_index computation)
         - GET /market/trust/:capability_tag
         - All responses read from cache, not live queries
         Estimate: 3 hrs

[ ] 3.4  Diversity weighting in matcher
         - Compute each seller's share of recent requests for this capability
         - Demote sellers at >35% share one position in the shortlist
         - Buyer always makes the final selection via POST /requests/:id/select
         - Config: diversity_threshold (default 0.35) in env variable, not hardcoded
         Estimate: 2 hrs

[ ] 3.5  Bad-faith rejection detection
         - After each schema_failed log event, check:
           buyer's dispute rate against this seller vs.
           seller's acceptance rate from all other buyers
         - If buyer rate > 30% AND seller rate from others > 80%:
           flag buyer's actor record, exclude their failures from seller score
         - Log: dispute_flagged event
         Estimate: 2 hrs

PHASE 3 DONE WHEN:
  - New agent registers with score 50.0
  - Makes 20 successful transactions, score rises
  - Certify the agent via test battery, badge appears on profile
  - Market intel endpoint returns pricing and quality data
  - Shortlist ranking reflects scores and diversity weighting
```

---

## Phase 4 — Interviewer Agent + chains (target: 16 hours)

The goal: a probe session that produces a real report; a chain where Agent A hires B who hires C.

```
[ ] 4.1  Interviewer Agent registration
         - Register Interviewer as platform actor (pubkey, wallet, capability tags)
         - Wire billing: probe cost charged to requester, earned by Interviewer's wallet
         - POST /probe/:pubkey/:capability_tag endpoint
         Estimate: 2 hrs

[ ] 4.2  Probe pipeline (BullMQ job with steps)
         Step 1: generate_capability_brief (Claude API)
         Step 2: design_probe_sequence (Claude API — return 10–20 test cases)
         Step 3..N: for each probe case:
           - Send task to target agent's endpoint (as a real request, paid from probe budget)
           - Receive result
           - Claude API: evaluate result against rubric
           - Decide: continue | escalate | stop_early
         Step N+1: generate_probe_report (Claude API)
         Step N+2: write CertificationResult with probe_report
         Step N+3: update actors.certification_tier if Elite threshold met
         Step N+4: post webhook
         - Job is resumable: store step index in BullMQ job data
         Estimate: 7 hrs

[ ] 4.3  Chain support
         - Add chain_parent_id + chain_depth to requests and sessions tables
         - POST /sessions with parent_session_id: atomic budget decrement from parent
         - Enforce chain_depth ≤ chain_depth_max at sub-session open
         - Chain depth propagated via session token caveat (chain_depth)
         Estimate: 3 hrs

[ ] 4.4  Chain partial failure resolution
         - Accept optional subtasks[] array in POST /requests for chain orchestrators
         - On failure: compute partial payout based on which subtasks completed
         - If no subtasks registered: all-or-nothing (simpler, less fair)
         Estimate: 4 hrs

PHASE 4 DONE WHEN:
  - Run a probe on a mock agent, receive a full probe report
  - Agent's certification tier updates to Elite if threshold met
  - Run a chain: Agent A hires B via session, B opens sub-session with C
  - C completes, B completes, A gets final result, all three settle in sats
  - Full chain visible in transaction log with chain_parent_id links
```

---

## Phase 5 — Human UI (target: 10 hours)

The goal: a human can post a request and accept a task from the dashboard, paying and earning in sats via Alby.

```
[ ] 5.1  Human registration + Alby connection
         - Web login (Supabase Auth: magic link or OAuth)
         - Registration form: creates human actor via POST /actors
         - Alby connect: WebLN provider integration
         - Wallet balance display (Alby getBalance())
         Estimate: 2 hrs

[ ] 5.2  Agent owner dashboard
         - List all agents where owner_pubkey = current human pubkey
         - Per agent card: wallet balance, daily spend vs cap, status, reliability score
         - Supabase Realtime: transaction_log events feed updates the dashboard live
         - Pause / resume agent (PATCH /actors/:pubkey)
         - Top up agent wallet (Lightning invoice)
         Estimate: 3 hrs

[ ] 5.3  Human buyer — request submission form
         - Browse capability tags (GET /schemas)
         - Select capability → form fields auto-generated from input_schema
         - Set budget (capped at spend_cap_per_session, validated client-side)
         - Submit → POST /requests → render Lightning invoice → Alby payment
         - Poll GET /requests/:id → show result when completed
         Estimate: 2 hrs

[ ] 5.4  Human seller — task inbox
         - Supabase Realtime subscription on task_inbox where human_pubkey = self
         - New task card appears live with: description, capability, offered sats, deadline
         - Accept button → mark task accepted
         - Result submission form: fields auto-generated from output_schema
         - Submit → POST /results/:request_id → Alby shows incoming payment
         Estimate: 3 hrs

PHASE 5 DONE WHEN:
  - Human opens dashboard, sees their agents
  - Human posts a request via form, pays via Alby
  - Task routes to a human seller (task_inbox)
  - Human seller submits result
  - Sats arrive in human seller's Alby wallet instantly
  - Both dashboards update via Realtime
```

---

## Hackathon demo script (3 minutes)

**Setup before demo:**
- Transaction log viewer open on screen
- Buyer agent script ready to run
- Seller agent (Aperture + mock service) running
- Human seller dashboard open in a second browser window

**The demo:**

1. **(30s)** Show the platform: actor registry with two registered agents, one human actor, schema registry with platform templates.

2. **(30s)** Run buyer agent script. Watch the transaction log: `request_posted` → `request_funded` → `request_matched` (show shortlist of 3 returned to the buyer). Highlight the diversity weighting — the top-volume agent is demoted in the shortlist. Buyer agent calls `POST /requests/:id/select` to choose a seller.

3. **(30s)** Watch routing happen. Selected seller's endpoint receives the task. Schema-valid result submitted. Watch `schema_validated` and `payment_released` appear in the log. Show sat amounts.

4. **(30s)** Open a session. Run 10 rapid calls via the session token — watch the budget bar decrement. Close the session. One settlement to the seller, one refund to the buyer. One Lightning payment each way for 10 calls.

5. **(30s)** Switch to the human seller dashboard — a UI that wraps the same endpoint and APIs agents use. Have the buyer agent post a request with a capability the human seller offers. Human sees the task appear in the dashboard, submits result via form. Alby shows incoming payment.

6. **(30s)** Show the transaction log: full chain of events for both transactions. Show market intelligence: pricing and quality for the capability just used. Briefly show the reliability score update (or explain it computes every 15 min from this log).

**Total: 3 minutes. All real. No mocks except the seller agent's data.**
