# Mr. Panda backend (Phase A)

Bun + Hono + Mongo Atlas. Holds the hosted Gemini key, meters free usage
(5/day per device), proxies AI calls so users never need their own key.
Deploys as an **isolated Coolify app** — it does not touch anything else on the VPS.

## Endpoints
| Method | Route | Purpose |
|---|---|---|
| GET  | `/health` | liveness (returns `db: true/false`) |
| POST | `/v1/register` | first-run: `{ deviceId? }` → `{ deviceId, plan, limit }` |
| GET  | `/v1/me?device=…` | `{ plan, limit, usedToday, remaining }` for the status line |
| POST | `/v1/generate` | metered proxy: `{ deviceId, kind, ... }` → AI reply |
| GET  | `/v1/admin/stats?token=…` | your dashboard numbers (devices, pro, usage today) |

`kind` is `chat` (mode/history/attachments/webSearch), `humanize` (text/mode/imperfect/custom),
or `extract` (text). `extract` does not count against the daily limit.

## Guardrails
- **5/day per device** (free) — atomic, no race conditions
- **Global daily cap** — total free uses/day across everyone; over it → `GLOBAL_BUSY` (never a surprise bill)
- **Per-IP rate limit** (40/min)
- Optional **APP_TOKEN** header gate so random people can't hit the endpoint

## Run locally
```
bun install
cp .env.example .env   # fill in MONGO_URI + GEMINI_API_KEY
bun run dev
curl localhost:8080/health
```

## Deploy on Coolify (isolated from SentioAir)
1. Coolify → **New Resource → Application** → point at this repo, **Base Directory: `server`** (Dockerfile build).
2. Add a **domain** (e.g. `api.mrpanda.<yourdomain>`) — Traefik issues HTTPS automatically.
3. Paste the **environment variables** from `.env.example` (real values). They live only on the server.
4. Deploy. Check `https://api.<domain>/health` → `{ ok: true, db: true }`.

Nothing here shares a network, volume, or DB with SentioAir — it's a standalone container
plus an external Mongo Atlas cluster.
