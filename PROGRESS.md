# AgentMesh Frontend — Stabilization Progress

Sorted by **importance** (transaction-blocking → polish). Updated at every
checkpoint.

Legend: `[x]` done · `[~]` in progress · `[ ]` pending · `[!]` blocked /
deferred (needs backend coordination)

Verification at each checkpoint: `pnpm exec tsc --noEmit` (type check) +
`pnpm exec vite build` (production build) must pass cleanly. ESLint errors
remaining are in pre-existing shadcn/ui scaffolding (`command.tsx`,
`textarea.tsx`, `tailwind.config.ts`) and are not introduced by this work.

---

## Phase 1 — Transaction lifecycle (CRITICAL)

The dominant bug: the buyer-side request lifecycle (`createRequest`,
`callSession`, `getResult`) was never invoked from the UI. Only
`submitResult` (seller-side) was wired. The "Send Test Request" button on
AgentProfile was a client-side `setTimeout` that fabricated a result —
no backend row was ever created.

| ID | Description | Status |
|----|-------------|--------|
| M2 | `priceForCap` lookup mismatches in mock mode (skills vs pricing tiers). | [x] |
| M5 | `backendSessionToFrontend` hard-coded `certTier='Unverified'` for every live session. | [x] |
| C5 | `Sell.tsx` captured `sellerPubkey` once, never refreshed when identity changed. | [x] |
| C4 | `Sell.tsx` `submit()` allowed empty result text. | [x] |
| identity | Stored-request-id registry in `identity.ts` (mirrors session ids); reactive `useIdentityPubkey` hook. | [x] |
| C3 | `Sell.tsx` only polled `in_progress`+`completed`. Now also polls `matched`. | [x] |
| C1 | Wired `api.createRequest` from the buyer side; replaces the simulated `runTest`. | [x] |
| C2 | Wired `api.callSession` button into Dashboard active sessions list. | [x] |
| C6 | Result viewing dialog — click a task row → fetch `getRequest` + `getResult`. | [x] |
| M9 | Dashboard "Total Spent" no longer double-counts request budgets and session spend. | [x] |
| L4 | `displayName` persisted across mode toggles (localStorage). | [x] |
| L7 | Pause toggle hidden in live mode (no backend pause endpoint). | [x] |
| M8 | Removed dead `__backendArgs` path in `mockData.createSession`. | [x] |

## Phase 2 — Deploy & configuration (HIGH)

| ID | Description | Status |
|----|-------------|--------|
| H4 | `Wallets.tsx` + `Monitor.tsx` now use exported `API_BASE` instead of hard-coded `localhost:3001`. | [x] |
| H5 | Added `vercel.json` with SPA rewrite — deep links survive hard refresh. | [x] |
| env | Added `.env.example` documenting `VITE_API_URL`. | [x] |
| docs | Replaced placeholder README with real setup, env, and lifecycle docs. | [x] |

## Phase 3 — Robustness & polish

| ID | Description | Status |
|----|-------------|--------|
| L1 | Added top-level `ErrorBoundary` in `App.tsx`. One thrown error no longer blanks the app. | [x] |
| M1 | Removed dead `visiblePayments` filter in `Wallets.tsx`. | [x] |
| M7 | `Wallets.tsx` auto-refresh now pauses while the tab is hidden. | [x] |
| M6 | `AgentProfile.tsx` page-load adds `.catch` so a network failure no longer hangs `loading=true`. | [x] |
| L5 | (Original review noted a step indicator; verified there is none in `SessionNew`.) | n/a |
| M10 | (Original review noted dead Next.js scaffolding; verified none exists at the root.) | n/a |

## Deferred (need backend coordination — `[!]`)

These were documented in the original review and intentionally deferred to
avoid premature implementation that may not match what the backend actually
ships:

- **Auth (H1, H2)** — `keypair.ts` is dead code. Need backend confirmation
  that `/auth/challenge` + `/auth/verify` are implemented before signing
  every write call.
- **Lightning UX (C7)** — `createRequest` already returns
  `payment_instructions` / `invoice` in the live response, and the UI
  surfaces them via a toast. A QR-code component is deferred until the
  backend confirms Lightning is enabled.
- **Seller-side accept/decline endpoint** — there's no way to query
  "shortlisted but not matched". Currently the seller inbox shows
  `matched` requests directly, which is the closest available proxy.
- **TanStack Query migration** — large refactor; deferred until the
  transaction wiring stabilizes. `QueryClientProvider` is already mounted,
  so it's a drop-in conversion when ready.
- **Schema integration (H3)** — `api.getSchemas()` exists but actor schemas
  are typically empty. Low value until backend populates them.

---

## Changelog

Most recent first.

### Checkpoint 5 — Polish & docs
- Added top-level `ErrorBoundary` (`src/components/ErrorBoundary.tsx`).
- Replaced placeholder README with real docs (setup, env, lifecycle).
- Removed unused `eslint-disable` directives in `Sell.tsx`.
- Verified type check, production build, and lint all green for new code.

### Checkpoint 4 — Deploy config
- Exported `API_BASE` from `src/lib/api.ts`; `Wallets` and `Monitor` use it.
- Added `vercel.json` SPA rewrite for deep links.
- Added `.env.example` documenting `VITE_API_URL`.
- Removed dead `visiblePayments` filter; auto-refresh skips hidden tab.

### Checkpoint 3 — Buyer transaction loop
- Replaced simulated `runTest` in `AgentProfile.tsx` with a real
  `api.createRequest` flow including capability picker, budget input,
  identity guard, status polling, and result rendering.
- Surfaces `payment_instructions` / `invoice` in a toast when present.
- Added `addStoredRequestId()` so submitted requests show up in Dashboard.

### Checkpoint 2 — Dashboard call & detail
- New "Call" button on each active session that dispatches
  `api.callSession` and updates calls/spend in place.
- New result-detail dialog: clicking any task row fetches the request and
  (when complete) the result payload.
- Fixed M9 (totalSpent double-count), L4 (displayName stomp), L7 (live
  mode hides Pause).

### Checkpoint 1 — Seller inbox + small bugs
- Sell page now polls `matched | in_progress | completed`; light 15s poll
  while tab is visible.
- Reactive `useIdentityPubkey` hook so signing in mid-session refreshes the
  inbox.
- Validates non-empty result text before `submitResult`.
- Fixed M2 (capability/pricing lookup) and M5 (cert tier on live sessions).
- Removed dead `__backendArgs` path in `mockData.createSession`.
- Identity registry extended with `addStoredRequestId` /
  `getStoredRequestIds` / `removeStoredRequestId`.
