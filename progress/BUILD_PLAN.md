# AgentMarket — Build Plan

Status markers: ✅ Done | 🔵 Next | ⬜ Not started | ⏭ Skipped (deferred)

---

## Phase 1a — Schema + Actor Registry
**Status: ✅ COMPLETE**
**Tests: 25/25 passing**

### Done
- [x] `schemas` table — capability_tag (PK), input_schema, output_schema, strength_score, is_platform_template
- [x] `actors` table — unified schema for agents and humans, all fields per DATA_MODEL.md
- [x] `POST /schemas` — validates JSON Schema, runs strength gate (min score 40), rejects weak schemas with hints
- [x] `GET /schemas` — list with optional `?platform_only=true`
- [x] `GET /schemas/:tag` — full schema body
- [x] `DELETE /schemas/:tag` — blocks platform templates and in-use schemas
- [x] `POST /actors` — validates owner, capabilities, endpoint requirement for sellers
- [x] `GET /actors` — filter by type, capability, status, owner_pubkey
- [x] `GET /actors/:pubkey`
- [x] `PATCH /actors/:pubkey` — mutable fields only, capability removal triggers 48h notice error
- [x] `PATCH /actors/:pubkey/status` — pause/resume/suspend
- [x] Schema strength scoring (6 criteria, max 100 points, threshold 40)
- [x] Seeds: weather-data, text-summarization, translation (platform templates, score 100)
- [x] Certification tier auto-initialised to `Unverified` on actor registration

---

## Phase 1b — Request Lifecycle + Matching + Settlement (mocked)
**Status: ✅ COMPLETE**
**Completed: 2026-04-26**

### New tables needed
```sql
CREATE TABLE requests (
  id                TEXT PRIMARY KEY,       -- uuid
  buyer_pubkey      TEXT NOT NULL,
  capability_tag    TEXT NOT NULL,
  input_payload     TEXT NOT NULL,          -- JSON
  budget_sats       INTEGER NOT NULL,
  status            TEXT NOT NULL,          -- pending_payment | funded | matched | in_progress | completed | failed | refunded
  shortlist         TEXT,                   -- JSON array of seller pubkeys (set after matching)
  selected_seller   TEXT,                   -- pubkey chosen by buyer
  deadline_unix     INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  funded_at         INTEGER,
  matched_at        INTEGER,
  completed_at      INTEGER,
  retry_count       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE results (
  id                TEXT PRIMARY KEY,       -- uuid
  request_id        TEXT NOT NULL UNIQUE,
  seller_pubkey     TEXT NOT NULL,
  output_payload    TEXT NOT NULL,          -- JSON
  validation_status TEXT NOT NULL,          -- pass | fail
  validation_level  INTEGER,               -- 1–4, which level failed (null if pass)
  validation_error  TEXT,                  -- error detail (null if pass)
  submitted_at      INTEGER NOT NULL
);

CREATE TABLE transaction_log (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL,
  event       TEXT NOT NULL,               -- request_posted | request_funded | request_matched | request_routed
                                           -- result_submitted | schema_validated | schema_failed
                                           -- payment_released | refund_issued | timeout
  actor_pubkey TEXT,                       -- who triggered the event
  detail      TEXT,                        -- JSON with event-specific data
  created_at  INTEGER NOT NULL
);
```

### Endpoints built
- [x] `POST /requests` — validate input against capability schema, check spend caps, create request, mock-fund immediately (no real Lightning)
- [x] `GET /requests/:id` — poll request status
- [x] `GET /requests` — list for a buyer or seller (query param)
- [x] `POST /requests/:id/select` — buyer selects a seller from the shortlist
- [x] `POST /results/:request_id` — seller submits result; triggers 4-level validation + mock settlement

### Matching engine (`lib/matcher.js`)
- [x] Query active sellers with matching capability tag
- [x] Filter: `price_per_call_sats[capability] <= budget_sats`
- [x] Filter: `status == 'active'`
- [x] Rank by `reliability_score` descending
- [x] Apply diversity weighting: if a seller has >35% of recent volume for this capability, demote one position
- [x] Return shortlist of up to 5 candidates
- [x] Configurable via `SHORTLIST_SIZE`, `DIVERSITY_THRESHOLD`, `DIVERSITY_WINDOW_DAYS` env vars

### 4-level schema validator (`validators/resultValidator.js`)
- [x] Level 1: structure (required fields present, correct types) — AJV with constraint-stripped schema
- [x] Level 2: constraints (min/max, minLength/maxLength, enum, pattern) — AJV with full schema
- [x] Level 3: internal consistency (x-consistency-rules — logged as checked, not auto-enforced; returned as `warnings[]`)
- [x] Level 4: completeness (x-min-content-length, x-min-items)
- [x] Return: `{ valid: bool, level: 1|2|3|4|null, error: string|null, warnings: string[] }`

### Mock settlement (`lib/settlement.js`)
- [x] On schema valid: mark request `completed`, log `payment_released`, deduct 5% platform fee (tracked in log only)
- [x] On schema invalid: log `schema_failed`, allow one retry (retry_count < 1); status resets to `matched`
- [x] On retry fail: mark `failed`, log `refund_issued`
- [x] On timeout (deadline_unix < now): mark `refunded`, log `timeout`

### Transaction log
- [x] Write log entry on every state transition
- [x] `GET /actors/:pubkey/history` — reads from transaction_log, supports limit/before/event_types/capability_tag filters

### Done when
- Buyer posts a request → shortlist returned → buyer selects seller → seller submits result → schema validates → mock payment logged → transaction log has full event chain ✅
- Retry path works: invalid result → schema_failed → retry → pass or fail ✅

---

## Phase 2 — Sessions + Budget Windows
**Status: ✅ COMPLETE**
**Completed: 2026-04-26**
**Tests: 41/41 passing**

### New tables needed
```sql
CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  buyer_pubkey        TEXT NOT NULL,
  seller_pubkey       TEXT NOT NULL,
  capability_tag      TEXT NOT NULL,
  budget_sats         INTEGER NOT NULL,
  remaining_budget    INTEGER NOT NULL,
  calls_made          INTEGER NOT NULL DEFAULT 0,
  price_per_call_sats INTEGER NOT NULL,     -- snapshot of seller's rate at open time
  status              TEXT NOT NULL,        -- active | closed | expired
  expires_unix        INTEGER NOT NULL,
  opened_at           INTEGER NOT NULL,
  closed_at           INTEGER,
  parent_session_id   TEXT,                 -- for sub-sessions (chains)
  chain_depth         INTEGER NOT NULL DEFAULT 0
);
```

### Endpoints to build
- [x] `POST /sessions` — validate spend caps (once at open), create session, mock-fund
- [x] `GET /sessions/:id`
- [x] `POST /sessions/:id/call` — decrement remaining_budget, marks 'exhausted' when budget < price_per_call
- [x] `POST /sessions/:id/close` — explicit close + settlement
- [x] `POST /sessions/:id/topup` — add budget, re-activates exhausted sessions

### Logic
- [x] All limit checks happen at open time only (never per-call)
- [x] `daily_spend_used` incremented at open, decremented by refund at close
- [x] Background check: `checkExpiredSessions()` runs every 60s via `setInterval` in server.js; also triggered inline on /call and /topup
- [x] Session token is a plain UUID for now (no macaroon — Lightning is mocked)

### Done when
- Open session → make N calls via `/sessions/:id/call` → budget decrements → close → one settlement log entry showing `calls_made × price_per_call_sats` ✅
- Top-up works without re-opening the session ✅
- Daily cap enforced at open; unspent budget refunded at close ✅

---

## Phase 3 — Reliability Scoring + Market Intelligence
**Status: ✅ COMPLETE**
**Completed: 2026-04-26**
**Tests: 36/36 passing (test_phase3.js)**

### Reliability score computation (in `lib/reliabilityScore.js`)
- [x] Inputs from transaction history (90-day window):
  - `delivery_rate` = completed / (completed + failed + refunded)
  - `schema_pass_rate` = result.validation_status pass / (pass + fail)
  - `acceptance_rate` = passed-schema results that landed in `completed` / total passed-schema
  - `response_time_score` = mean of `clamp(1 - response_time / deadline_span, 0, 1)` per completed task
- [x] Volume weighting: actors with <10 tasks regress toward 50.0
- [x] Per-capability scores stored alongside the overall (`*`) score
- [x] Write overall score to `actors.reliability_score`; per-capability rows to `reliability_score_cache`
- [x] Schedule: `recomputeAll()` runs once at boot + every 15 min via `setInterval` in `server.js`
- [x] Cache: `reliability_score_cache(actor_pubkey, capability_tag)` with full signal breakdown + `computed_at`

### Market intelligence endpoints (`routes/market.js`)
- [x] `GET /market/pricing/:capability_tag` — median, p25, p75, min, max, 7d trend, transaction_count, window param `24h|7d|30d`
- [x] `GET /market/quality/:capability_tag` — median reliability score, cert tier distribution, avg schema pass rate
- [x] `GET /market/compare/:capability_tag` — ranked sellers; `sort_by=value_index|price|score|response_time|volume`, `min_cert_tier`, `limit`
- [x] `GET /market/trust/:capability_tag` — cert tier density (count + pct) across active sellers
- [x] `value_index = (score/100) / (price/median_price)` and `trust_price_index = (cert_numeric/3) / (price/median_price)` per the API spec
- [x] All four endpoints validate `capability_tag` exists; return 404 `unknown_capability` otherwise

### Bad-faith detection (`lib/reliabilityScore.js → evaluateBadFaith`)
- [x] Triggered inline after a terminal `schema_failed` (in `routes/results.js`) AND in every `recomputeAll()` cycle
- [x] For every (buyer, seller) pair in the 90-day window: if buyer's failure rate against this seller > 30% AND seller's pass rate with all *other* buyers > 80% AND there are ≥3 interactions → insert into `bad_faith_flags`
- [x] Flag detail records `pair_fail_rate`, `other_pass_rate`, sample sizes
- [x] Score recompute filters out flagged buyer's failures from the seller's signals (delivery_rate, schema_pass_rate, acceptance_rate)

### Done when
- ✅ After 10+ transactions, seller score moves from 50.0 based on history (verified: `p3-seller-pro` scores ≥90 with 12 perfect tasks; `p3-seller-mid` <70 with 50% delivery rate)
- ✅ Market endpoints return meaningful aggregated data
- ✅ Value index sorts sellers correctly (compare endpoint sort verified monotonically descending)
- ✅ Bad-faith flag inserts correctly and shielded seller's score stays ≥85 after 4 malicious failures

---

## Phase 4 — Chains + Burning Rate Accounting
**Status: ✅ COMPLETE**
**Completed: 2026-04-26**
**Tests: 45/45 passing (test_phase4.js)**
**Depends on: Phase 2 (sub-sessions are built on sessions)**

### Schema changes
- [x] Add `chain_parent_id TEXT` and `chain_depth INTEGER` to `requests` table (`db/database.js` + ALTER TABLE migrations)
- [x] `sessions` table already had `parent_session_id` and `chain_depth` from Phase 2
- [x] Add `subtasks TEXT` and `subtasks_completed INTEGER` to `requests` table

### Logic
- [x] `POST /sessions` with `parent_session_id`: requires `expected_calls`; resolves budget as `expected_calls × pricePerCall`; atomically increments parent `sats_used` before opening sub-session
- [x] Enforce `chain_depth + 1 <= seller.chain_depth_max`
- [x] Burning rate awareness: `expected_calls × sub_agent.price_per_call_sats[capability] <= parent.remaining_budget` validated at open time
- [x] Sub-session budget cannot exceed parent's `remaining_budget` at open time
- [x] On sub-session close/expire: unused budget (`buyerRefundSats`) returned to parent via `parent.sats_used -= refund`; buyer daily counter also unwound
- [x] Multiple sub-sessions rejected when cumulative cost exceeds parent remaining budget
- [x] `chain_parent_id` + `chain_depth` on `POST /requests`; depth validated against `buyer.chain_depth_max`; `GET /requests?chain_parent_id=` filter added
- [x] Partial failure resolution: `subtasks[]` in `POST /requests` enables proportional payout on terminal failure; `subtasks_completed` passed in `POST /results/:id`; `settlePartial()` computes `floor(budget × completed/total) − 5%` fee; full refund when `subtasks_completed = 0`

### Done when
- Agent A opens session → opens sub-session with Agent B (budget decrements from A) → B opens sub-session with Agent C → C completes → B completes → A completes → all three settlements logged with chain_parent_id links ✅
- Over-commit attempt rejected: B tries to open sub-sessions totalling more than its budget → rejected ✅

---

## Phase 5 — Human-Facing API (Lovable Integration)
**Status: ⬜ NOT STARTED**
**Depends on: all prior phases**
**Estimated effort: ~5 hours (Lovable handles all UI)**

### Auth layer
- [ ] `POST /auth/register` — creates human actor + issues a session token (JWT or simple signed token)
- [ ] `POST /auth/login`
- [ ] Auth middleware: verify token on protected routes, attach `req.actor`

### Human-specific endpoints
- [ ] `GET /inbox` — tasks matched to this human seller (equivalent of the Supabase Realtime task_inbox)
- [ ] `GET /actors/me` — current actor profile
- [ ] `GET /actors/me/agents` — all agents owned by this human

### Lovable-readiness
- [ ] CORS configured for Lovable's domain
- [ ] All list endpoints paginated (`?page=1&limit=20`)
- [ ] Consistent error envelope across all routes: `{ error: string, message: string, details?: any }`
- [ ] `GET /openapi.json` — OpenAPI 3.0 spec (Lovable can auto-generate client from this)

### Done when
- Lovable can call `POST /auth/login`, get a token, call `GET /actors/me`, and `GET /inbox`
- All endpoints respond correctly to CORS preflight from Lovable's origin

---

## Deferred (do not implement until explicitly requested)

- **Interviewer Agent** — Claude API probe pipeline for Tier 3 certification. Full design in `md_files/RELIABILITY.md`. Requires Anthropic API key.
- **Real Lightning / L402** — MDK + Lexe + Aperture integration. Full design in `md_files/TECH_STACK.md`. Requires funded Lightning wallets.
- **Macaroon session tokens** — Currently sessions use plain UUIDs. Swap to macaroons (node-macaroons) when real payment layer is added.
- **BullMQ background jobs** — Currently reliability scoring and session expiry can run inline or via setInterval. Swap to BullMQ + Redis for production scale.
- **Supabase migration** — When ready to deploy and connect Lovable.