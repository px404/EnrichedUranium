# AgentMarket — Project Progress

This folder is the single source of truth for build state. Any agent or developer picking this up should start here, then read BUILD_PLAN.md for the detailed phase breakdown.

---

## What this project is

AgentMarket is a machine-to-machine commerce platform where AI agents (and humans) buy and sell services from each other. All payments settle in Bitcoin via the Lightning Network. The platform handles matching, escrow, schema-based dispute resolution, reliability scoring, and chain orchestration.

Full architecture: `/md_files/ARCHITECTURE.md`
Full API design: `/md_files/API.md`
Data model: `/md_files/DATA_MODEL.md`

---

## Current state

**Last updated:** Phase 3 complete (2026-04-26).

### What is built and tested

| Module | File(s) | Status | Tests |
|--------|---------|--------|-------|
| Schema registry | `api/routes/schemas.js` | Complete | 10/10 pass |
| Actor registry | `api/routes/actors.js` | Complete | 15/15 pass |
| Actor history | `api/routes/actors.js` GET /:pubkey/history | Complete | covered |
| DB layer | `api/db/database.js` | Complete | covered |
| Schema strength validator | `api/validators/schemaStrength.js` | Complete | covered |
| Platform template seeds | `api/seeds/index.js` | Complete | covered |
| Express server | `api/server.js` | Complete | covered |
| Matching engine | `api/lib/matcher.js` | Complete | covered |
| Result validator (4-level) | `api/validators/resultValidator.js` | Complete | covered |
| Settlement (mock) | `api/lib/settlement.js` | Complete | covered |
| Request lifecycle routes | `api/routes/requests.js` | Complete | covered |
| Result submission route | `api/routes/results.js` | Complete | covered |
| Session lifecycle routes | `api/routes/sessions.js` | Complete | 41/41 pass |
| Reliability scoring | `api/lib/reliabilityScore.js` | Complete | covered |
| Bad-faith detection | `api/lib/reliabilityScore.js -> evaluateBadFaith` | Complete | covered |
| Market intel aggregator | `api/lib/marketIntel.js` | Complete | covered |
| Market intel routes | `api/routes/market.js` | Complete | 36/36 pass |

### What is NOT yet built

Everything from Phase 4 onward. See `BUILD_PLAN.md`.

---

## Project structure

```
EnrichedUranium/
|- api/                        Backend API (Node.js + Express + sql.js)
|   |- server.js               Entry: boots DB, mounts routes, runs session-expiry + reliability timers
|   |- package.json            Dependencies: express, cors, ajv, sql.js, uuid
|   |- db/
|   |   |- database.js         sql.js wrapper. Exposes: getDb(), prepare(), save()
|   |   |- agentmarket.db      SQLite file (auto-created on first run, gitignored)
|   |- lib/
|   |   |- matcher.js          Shortlist builder: filter -> rank -> diversity-demote -> top 5
|   |   |- settlement.js       Mock settlement: settleSuccess/Failure/Timeout + logEvent
|   |   |- reliabilityScore.js Phase 3: 0-100 score from 90-day history + bad-faith filter + recomputeAll()
|   |   |- marketIntel.js      Phase 3: pricing/quality/compare/trust aggregators
|   |- routes/
|   |   |- schemas.js          CRUD for capability schemas + strength gate
|   |   |- actors.js           CRUD for actors + history endpoint
|   |   |- requests.js         POST/GET requests, POST /:id/select
|   |   |- results.js          POST /results/:request_id (4-level validation + settlement + bad-faith eval)
|   |   |- sessions.js         Phase 2: session lifecycle (open/call/close/topup) + auto-expiry
|   |   |- market.js           Phase 3: GET /market/{pricing|quality|compare|trust}/:capability_tag (public)
|   |- validators/
|   |   |- schemaStrength.js   Scores a schema 0-100. Minimum 40 to register.
|   |   |- resultValidator.js  4-level output validator
|   |- seeds/
|   |   |- index.js            Seeds 3 platform templates
|   |- test_phase2.js          Phase 2 integration tests (41 assertions, all passing)
|   |- test_phase3.js          Phase 3 integration tests (36 assertions, all passing)
|   |- SETUP.md                How to run locally
|- md_files/                   Architecture documentation
|   |- README.md               System overview + high-level diagram
|   |- ARCHITECTURE.md         Actor model, request lifecycle, chains
|   |- DATA_MODEL.md           All DB tables and fields
|   |- API.md                  Full API surface
|   |- FEATURES.md             Feature system designs
|   |- RELIABILITY.md          Scoring + certification design
|   |- TECH_STACK.md           Tech choices + full build order with hour estimates
|- progress/                   This folder
    |- README.md               You are here
    |- BUILD_PLAN.md           Phase-by-phase build plan with status
    |- DECISIONS.md            Architectural decisions and corrections made during build
```

---

## How to run

```bash
cd api
npm install        # first time only
npm run seed       # first time only - seeds the 3 platform templates
npm run dev        # starts on http://localhost:3001

# Run tests
node test_phase2.js
node test_phase3.js
```

---

## Key constraints for agents picking this up

1. **Database**: Uses `sql.js` (pure WASM SQLite) so the build can run on environments
   without native Node.js bindings. Routes use a `prepare()` wrapper that mimics the
   `better-sqlite3` synchronous API. To swap to `better-sqlite3` or Supabase later,
   only `db/database.js` needs to change.

2. **Mock Lightning**: Payments are not real. `POST /requests` auto-funds; settlement
   only writes to `transaction_log`. All sat amounts are computed correctly so the
   logic is ready for real payments.

3. **Reliability scores** are recomputed in-process every 15 min via `setInterval`.
   When traffic justifies it, this should move to BullMQ + Redis.

4. **Bad-faith detection** runs inline after every terminal `schema_failed` AND in
   each `recomputeAll()`. Inline detection keeps flagging latency low.

5. **Read DECISIONS.md before changing existing code** - it records every place the
   implementation deviates from or clarifies the architecture docs.
