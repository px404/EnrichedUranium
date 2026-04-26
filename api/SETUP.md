# AgentMarket API — Setup

## First time

```bash
cd api
npm install
npm run seed
npm run dev
```

Server starts at `http://localhost:3001`

## Available endpoints (Phase 1a — Schema + Actor Registry)

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /schemas | List all schemas |
| POST | /schemas | Register a new capability schema |
| GET | /schemas/:tag | Get full schema by tag |
| DELETE | /schemas/:tag | Delete a schema (non-template, unused) |
| GET | /actors | List actors (filter by type, capability, status) |
| POST | /actors | Register a new actor |
| GET | /actors/:pubkey | Get actor profile |
| PATCH | /actors/:pubkey | Update actor fields |
| PATCH | /actors/:pubkey/status | Pause / resume / suspend |

## Database

Uses `sql.js` (pure JS SQLite, no compilation needed). Data persists to `db/agentmarket.db`.

## What's next

- Phase 1b: Request lifecycle + matching engine + mock settlement
- Phase 2: Sessions and budget windows
- Phase 3: Reliability scoring + market intelligence
