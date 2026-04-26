# AgentMarket — Architectural Decisions & Corrections

This file records decisions made during the build that deviate from or clarify the original architecture docs, plus any corrections applied to the md_files. Any agent picking this up should read this before touching existing code.

---

## Corrections applied to md_files (2026-04-26)

### 1. Matching — buyer selects, platform never auto-routes
**File changed:** `md_files/ARCHITECTURE.md`, `md_files/TECH_STACK.md`

Original docs said the platform had a "500ms selection window" with a default auto-route to position 2 on the shortlist.

**Corrected to:** The platform returns the shortlist to the buyer. The buyer always selects explicitly via `POST /requests/:id/select`. The platform never auto-routes. Agent buyers call this endpoint directly; human buyers click in the Lovable UI which calls it on their behalf.

### 2. Task delivery — endpoints always active, dashboard is a UI wrapper
**File changed:** `md_files/ARCHITECTURE.md`

Original docs described a fork: "agent seller → platform calls endpoint" vs. "human seller → platform writes to task_inbox table". This implied two separate delivery mechanisms.

**Corrected to:** All sellers have an active endpoint. The human dashboard (Lovable) is a UI layer that wraps the same endpoint interface. There is no separate inbox delivery path at the platform level. The task_inbox is a UI concept in Lovable, not a platform-level table.

> Note: This means Phase 5 does not need a task_inbox table — instead, `GET /inbox` is just a filtered view of requests where `selected_seller = req.actor.pubkey` and status is `in_progress`.

### 3. Chains — burning rate must be accounted for
**File changed:** `md_files/ARCHITECTURE.md`

Original docs described chain budget constraints but did not explicitly mention per-agent burning rates in the orchestration layer.

**Added to docs:** Each agent in a chain has their own `price_per_call_sats[capability]` — their burning rate. When an orchestrator opens a sub-session, the budget must be calculated as `expected_calls × sub_agent.price_per_call_sats[capability]`. The orchestrator's own burning rate (cost to the agent above it) is independent. Budget planning in chains requires knowing every node's rate in advance or over-provisioning with a top-up strategy.

---

## Implementation decisions

### sql.js instead of better-sqlite3
**Reason:** The Linux sandbox used for building cannot compile native Node.js bindings (no Node.js headers available for node-gyp). `sql.js` is a pure WASM SQLite port with no native compilation. The `prepare()` function in `db/database.js` wraps the sql.js API to be API-compatible with `better-sqlite3`, so routes are written once and work with both.

**When to swap:** When deploying to a proper environment (cloud, Docker, or the user's Windows machine directly), swap `db/database.js` to use `better-sqlite3` or migrate to Supabase. No route code needs to change.

### Mock settlement (no real Lightning)
**Reason:** No funded Lightning wallets available during development.

**Implementation:** `POST /requests` auto-marks requests as `funded` immediately (no invoice generated, no payment required). Settlement is logged in `transaction_log` as `payment_released` or `refund_issued` but no actual sats move. All settlement amounts are computed correctly so the logic is ready when real payments are wired in.

**When to swap:** When Lightning is enabled, replace the mock-fund step in `POST /requests` with MDK invoice generation + webhook listener.

### No macaroon session tokens (Phase 2)
**Reason:** Macaroons are L402 tokens tied to Lightning payments. Since Lightning is mocked, session tokens are plain UUIDs stored in the `sessions` table.

**When to swap:** When Lightning is enabled, issue macaroons via `node-macaroons` with caveats encoding: session_id, buyer_pubkey, seller_pubkey, capability_tag, price_per_call_sats, expires_unix, chain_depth, chain_depth_max.

### No BullMQ (Phases 3–4)
**Reason:** Redis dependency adds infrastructure complexity before core features are proven.

**Implementation:** Reliability score recomputation runs via `setInterval` (every 15 min) within the server process. Session expiry check runs on a 60s interval. This is sufficient for development and small-scale operation.

**When to swap:** When traffic justifies it, move score recomputation and session expiry to BullMQ workers.

### Capability removal — 48h notice enforced as hard error
**Reason:** The architecture requires a notice period to prevent agents from removing capabilities mid-transaction.

**Implementation:** `PATCH /actors/:pubkey` with a capabilities array that removes existing tags returns `422 capability_removal_notice_required`. The notice period mechanism (a scheduled removal with a 48h delay) is not yet built — it is a Phase 5 or later task. For now, capability removal is blocked entirely at the API level.

---

---

## Phase 1b decisions (2026-04-26)

### Diversity demotion — single swap, not full reorder
**Decision:** The BUILD_PLAN says "demote one position". Implemented as a single adjacent swap in a forward pass through the ranked list. A seller over the threshold is swapped with the next seller and that position is then skipped to avoid double-swapping. This keeps the demotion minimal and predictable.

### Level 3 consistency rules — warnings not errors
**Decision:** Per the BUILD_PLAN, x-consistency-rules are "human-readable declarations" th

---

## Phase 2 decisions (2026-04-26)

### remaining_budget — computed on read, not stored
**Decision:** The sessions table stores `budget_sats` and `sats_used`. `remaining_budget` is computed as `budget_sats - sats_used` in `formatSession()` on every read. This avoids a second column that could drift out of sync and matches the approach used for daily_spend_used.

### 'exhausted' status — separate from 'active' and 'closed'
**Decision:** When `sats_used + price_per_call_sats > budget_sats` after a call, session transitions to `exhausted` (not `closed`). This preserves the session for top-up without triggering settlement. Calling `POST /sessions/:id/call` on an exhausted session returns 402 (not 409 — budget is the reason, not lifecycle state). `close` and `topup` both accept `active` or `exhausted`.

### chain_depth — body param accepted without parent_session_id
**Decision:** Phase 4 will enforce full parent-session budget reservation. For Phase 2, `chain_depth` can be passed directly in the `POST /sessions` body to allow agent self-reporting of chain position. Checked against `seller.chain_depth_max`. When `parent_session_id` is provided, depth is derived from the parent record.

### spend_cap_per_call — buyer's per-call ceiling, not seller's
**Decision:** `spend_cap_per_call[capability]` on the buyer actor is the maximum the buyer will pay per single call. At session open, if seller's `price_per_call_sats[capability] > buyer.spend_cap_per_call[capability]`, the open is rejected (422 spend_cap_per_call_exceeded). This prevents sellers from charging more than buyers' declared per-call ceilings.

### settlement — platform fee rounds down (floor)
**Decision:** `platform_fee_sats = Math.floor(sats_used * 0.05)`. The rounding remainder goes to the seller (seller_payout = sats_used - platform_fee). This is consistent with Phase 1b settlement logic.

### daily_spend_used — reset at midnight UTC, not rolling 24h
**Decision:** The reset trigger checks `buyer.daily_spend_reset_at <= now`. If so, the counter zeroes and `daily_spend_reset_at` is advanced to the next midnight UTC. This means the cap is a calendar-day budget, not a sliding 24-hour window.

### checkExpiredSessions — inline + interval
**Decision:** `autoExpire` is called inline on `/call` and `/topup` when a session is found to be past its deadline. The background `checkExpiredSessions` sweep (every 60s in server.js) catches sessions that haven't been accessed. This dual approach ensures timely settlement without requiring a dedicated job queue.

---

## Phase 3 decisions (2026-04-26)

### Reliability inputs: derive from `requests` + `results`, not from `transaction_log`
**Decision:** RELIABILITY.md describes inputs as transaction_log events (`schema_validated`, `schema_failed`, etc.). In practice, every request has at most one terminal status and at most one result row, so reading `requests.status` + `results.validation_status` is faster, simpler, and equally accurate. The transaction_log remains the audit trail; the score derives from the authoritative `requests`/`results` tables.

### Per-capability scores live in the cache; overall score is mirrored to `actors.reliability_score`
**Decision:** Each `recomputeAll()` writes one `*` row per actor (the cross-capability overall score the matcher uses) plus one row per capability the actor declares. The `*` row's score is also UPDATEd into `actors.reliability_score` so existing matcher code (which reads from `actors`) keeps working unchanged. Per-capability rows are read by `/market/quality` and `/market/compare`, where ranking by capability is the whole point.

### Volume regression toward 50 — task count is `requests` count, not `transaction_log` event count
**Decision:** "Tasks in window" = the count of distinct requests handled by the seller, post bad-faith filter. We consider any non-pending status (completed/failed/refunded). In-flight (`matched`, `in_progress`, `funded`) requests don't yet count toward volume because they haven't produced a signal.

### Missing-signal default = neutral 0.5
**Decision:** A seller with one perfect schema_pass but no completed-request data could otherwise score artificially low because `delivery_rate`, `acceptance_rate`, and `response_time_score` would all be 0. Treat missing signals as a neutral 0.5 fraction so the formula produces a defensible mid-range score until real data accrues.

### Bad-faith threshold — strict greater-than, plus minimum interactions
**Decision:** RELIABILITY.md says "exceeds 30%" and "exceeds 80%". Implemented as strict `>` (not `>=`) on both. Also requires `BAD_FAITH_MIN_INTERACTIONS = 3` between the buyer and seller before a flag can fire — one fluke failure shouldn't trigger detection. The seller's "everyone else" pass rate is computed from peer rows only (not the buyer-vs-seller pair) so the filter doesn't see itself.

### `evaluateBadFaith` runs both inline (after a final schema_failed) and in `recomputeAll()`
**Decision:** Inline evaluation in `routes/results.js` keeps detection latency low (a flag is in place before the next 15-min recompute). Running it again in `recomputeAll()` re-validates flags as the corpus grows. Flags are inserted with `INSERT OR IGNORE`, so repeated evaluation is idempotent.

### Suspended actors are still scored
**Decision:** A suspended seller might be reinstated, and operators want to see their historical score on the dashboard. `recomputeAll()` runs over `status IN ('active','paused','suspended')`, but the matcher already filters by `status = 'active'` so suspended actors never appear in shortlists regardless of what their cached score says.

### Pricing aggregates use `budget_sats` of completed requests, not seller `price_per_call_sats`
**Decision:** A seller's posted price is what they advertise; the actual settled budget is what the market paid. Pricing aggregates therefore key off `requests.budget_sats WHERE status='completed'` so the median/p25/p75 reflect cleared transactions, not list prices.

### `value_index` and `trust_price_index` rounded to 2 decimals
**Decision:** Two decimals are sufficient for human-readable comparison and avoid float jitter when sorting. `score`/`response_time_score` are already rounded by the score writer.

### Per-call `evaluateBadFaith` cost — acceptable for now
**Decision:** Inline `evaluateBadFaith` after every terminal failure does an O(N) sweep over results in the 90-day window. At current scale this is fine (sub-millisecond on the test fixtures). When write traffic grows, this should move behind the same BullMQ queue earmarked for reliability scoring (see deferred section in BUILD_PLAN).

---

## Phase 3 decisions (2026-04-26)

### Reliability inputs derive from `requests` + `results`, not from `transaction_log`
**Decision:** RELIABILITY.md describes inputs as transaction_log events (`schema_validated`, `schema_failed`, etc.). In practice every request has at most one terminal status and at most one result row, so reading `requests.status` + `results.validation_status` is faster, simpler, and equally accurate. The transaction_log remains the audit trail; the score derives from the authoritative `requests`/`results` tables.

### Per-capability scores live in the cache; overall score is mirrored to `actors.reliability_score`
**Decision:** Each `recomputeAll()` writes one `*` row per actor (the cross-capability overall score the matcher uses) plus one row per capability the actor declares. The `*` row's score is also UPDATEd into `actors.reliability_score` so existing matcher code (which reads from `actors`) keeps working unchanged. Per-capability rows are read by `/market/quality` and `/market/compare`, where ranking by capability is the whole point.

### Volume regression toward 50: task count is `requests` count, not `transaction_log` event count
**Decision:** "Tasks in window" = the count of distinct requests handled by the seller, post bad-faith filter. We consider any non-pending status (completed/failed/refunded). In-flight (`matched`, `in_progress`, `funded`) requests don't count toward volume because they haven't produced a signal yet.

### Missing-signal default = neutral 0.5
**Decision:** A seller with one perfect schema_pass but no completed-request data could otherwise score artificially low because `delivery_rate`, `acceptance_rate`, and `response_time_score` would all be 0. Treat missing signals as a neutral 0.5 fraction so the formula produces a defensible mid-range score until real data accrues.

### Bad-faith threshold: strict greater-than, plus minimum interactions
**Decision:** RELIABILITY.md says "exceeds 30%" and "exceeds 80%". Implemented as strict `>` (not `>=`) on both. Also requires `BAD_FAITH_MIN_INTERACTIONS = 3` between the buyer and seller before a flag can fire — one fluke failure shouldn't trigger detection. The seller's "everyone else" pass rate is computed from peer rows only (not the buyer-vs-seller pair) so the filter doesn't see itself.

### `evaluateBadFaith` runs both inline (after a final schema_failed) and in `recomputeAll()`
**Decision:** Inline evaluation in `routes/results.js` keeps detection latency low (a flag is in place before the next 15-min recompute). Running it again in `recomputeAll()` re-validates flags as the corpus grows. Flags are inserted with `INSERT OR IGNORE`, so repeated evaluation is idempotent.

### Suspended actors are still scored
**Decision:** A suspended seller might be reinstated, and operators want to see their historical score on the dashboard. `recomputeAll()` runs over `status IN ('active','paused','suspended')`, but the matcher already filters by `status = 'active'` so suspended actors never appear in shortlists regardless of what their cached score says.

### Pricing aggregates use `budget_sats` of completed requests, not seller `price_per_call_sats`
**Decision:** A seller's posted price is what they advertise; the actual settled budget is what the market paid. Pricing aggregates therefore key off `requests.budget_sats WHERE status='completed'` so the median/p25/p75 reflect cleared transactions, not list prices.

### `value_index` and `trust_price_index` rounded to 2 decimals
**Decision:** Two decimals are sufficient for human-readable comparison and avoid float jitter when sorting. `score`/`response_time_score` are already rounded by the score writer.

### Per-call `evaluateBadFaith` cost — acceptable for now
**Decision:** Inline `evaluateBadFaith` after every terminal failure does an O(N) sweep over results in the 90-day window. At current scale this is fine (sub-millisecond on the test fixtures). When write traffic grows, this should move behind the same BullMQ queue earmarked for reliability scoring (see deferred section in BUILD_PLAN).

---

## Phase 4 decisions (2026-04-26)

### expected_calls required for sub-sessions; budget auto-computed
**Decision:** When `parent_session_id` is provided, the caller must supply `expected_calls` (a positive integer). The sub-session's `budget_sats` is computed as `expected_calls × pricePerCall` — the caller cannot override it. This enforces burning-rate accounting: the orchestrator must commit to an expected call volume up front, and the platform can validate affordability atomically. If a caller provides `budget_sats` alongside `expected_calls`, it is ignored; the computed value is used.

### Parent budget reserved via `sats_used` increment, not a separate escrow column
**Decision:** Rather than adding a dedicated `reserved_sats` column to sessions, sub-session budget reservation is implemented by incrementing the parent's `sats_used` at sub-session open time. This reuses the existing `remaining_budget = budget_sats - sats_used` invariant without schema changes to sessions. On sub-session close, unused budget is returned by decrementing `parent.sats_used` by `buyerRefundSats`. This is safe in the sql.js synchronous model because each `prepare().run()` is atomic.

### Buyer daily counter unwound on sub-session close regardless of chain position
**Decision:** When a sub-session is opened, the buyer's `daily_spend_used` is incremented (as with root sessions). On close, the refund decrements `daily_spend_used` at every level. This means both the budget reservation in the parent AND the buyer's daily counter are correctly unwound. Double-decrementing is avoided because only the immediate buyer's counter is touched at each level, not the root buyer's.

### `subtasks[]` stored as JSON in requests; `subtasks_completed` updated at result submission
**Decision:** Subtasks are stored as a JSON array of labels (e.g. `["parse","summarise","translate"]`). The count is what matters for partial payout math, not the labels — but storing labels gives operators a human-readable audit trail. `subtasks_completed` is passed in `POST /results/:id` body and forwarded to `settleFailure()`/`settleSuccess()`. The DB column is updated at settlement time, not before.

### Partial payout formula: `floor(budget × completed/total) − floor(earned × 0.05)`
**Decision:** Fee is computed as `floor(earnedSats × 0.05)` (same rounding as all other settlement). Payout = `earnedSats − platformFeeSats`. This gives a slightly higher payout than `floor(earnedSats × 0.95)` when `earnedSats × 0.05` has a fractional part (e.g. 50 sats × 0.05 = 2.5 → fee=2, payout=48 rather than floor(47.5)=47). Consistent with Phase 1b and Phase 2 rounding policy: fee rounds down, remainder goes to seller.

### Partial payout marks request as `completed`, not `failed`
**Decision:** A request that achieves partial completion and triggers `settlePartial()` is marked `status = 'completed'` (not `failed`). The partial nature is signalled by `settlement_type: 'partial'` in the transaction log and `payout_sats`/`refund_sats` in the API response. This keeps the reliability score computation straightforward: `completed` rows count as deliveries, `failed` rows count as failures.

### `chain_parent_id` on requests references another request (not a session)
**Decision:** Request chains model task decomposition (one task spawns sub-tasks). Session chains model budget delegation (one agent delegates budget to another). These are independent axes. A request's `chain_parent_id` points to another request; a session's `parent_session_id` points to another session. Callers may use both simultaneously (open a sub-session for a sub-request), but they are not coupled at the platform level.
