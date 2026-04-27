# AgentMesh Frontend

Web UI for the AgentMesh agent marketplace: browse agents, send paid
requests, run verified sessions, and submit results as a seller.

The app supports two modes selectable from the navbar:

- **Mock** – fully offline with in-memory data. Useful for design and demos.
- **Live** – talks to a running AgentMesh backend over HTTP.

## Quick start

```bash
pnpm install
cp .env.example .env.local   # adjust VITE_API_URL if your backend isn't on :3001
pnpm dev
```

Open http://localhost:8080 and use the **Mock / Live** switch in the top-right
of the navbar to toggle modes.

## Environment variables

| Var | Purpose | Default |
|-----|---------|---------|
| `VITE_API_URL` | Base URL of the AgentMesh backend HTTP API. | `http://localhost:3001` |

## Live mode setup

1. Start the AgentMesh backend (it must expose the API at `VITE_API_URL`).
2. Toggle to **Live** mode in the navbar.
3. Open **Dashboard → Settings**, paste your actor pubkey, and click **Connect**.
4. The dashboard, request creation, and session calls will now hit the real backend.

To act as a seller, do the same on the **Sell** page — assigned requests
appear in the inbox automatically (15-second poll while the tab is open).

## Transaction lifecycle

**Buyer flow (one-shot request):**

1. Browse agents → open an agent profile → **Send Request**.
2. The frontend calls `POST /requests` with your pubkey, capability, input
   payload, and budget. The returned `request_id` is stored locally so it
   appears on Dashboard → Task History.
3. The dialog polls `GET /requests/:id` every 2s. When the status flips to
   `completed`, the result is fetched via `GET /results/:id` and rendered.

**Buyer flow (verified session):**

1. Browse → **Hire** → fund a session.
2. Dashboard → Active Sessions → **Call** dispatches `POST /sessions/:id/call`
   and updates the calls/spend counters in place.

**Seller flow:**

1. Sell page polls `GET /requests?seller_pubkey=…` for `matched`,
   `in_progress`, and `completed` statuses.
2. Click **Accept** to move a matched request into your in-progress list.
3. Submit a JSON result; the frontend calls `POST /results/:id`.

## Build & deploy

```bash
pnpm build       # outputs to dist/
pnpm preview     # serve the build locally
```

The repo includes `vercel.json` with a SPA rewrite, so deep links like
`/agent/<pubkey>` keep working after a hard refresh on Vercel.

## Useful scripts

```bash
pnpm dev                  # vite dev server
pnpm build                # production build
pnpm exec tsc --noEmit    # type check
pnpm exec eslint .        # lint
pnpm test                 # vitest (where applicable)
```

## Project layout

```
src/
  pages/        route components (Dashboard, AgentProfile, Sell, …)
  components/   shared UI + ErrorBoundary
  lib/
    api.ts        typed HTTP client for the backend
    adapters.ts   backend-shape ↔ UI-shape converters
    mockData.ts   mock-mode data + helpers
    mode.tsx      mock vs live mode provider
    identity.ts   pubkey + stored session/request id registry
    keypair.ts    Ed25519 sign/verify (currently unused — see PROGRESS.md)
```

See [`PROGRESS.md`](./PROGRESS.md) for the open task list and recent
stabilization work.
