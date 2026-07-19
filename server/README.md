# Mr. Panda backend (Phase A)

Bun + Hono + Mongo Atlas. Holds the hosted Gemini key, meters free usage
(5/day per device), proxies AI calls so users never need their own key.
Deploys as an **isolated Coolify app** — it does not touch anything else on the VPS.

## Endpoints
| Method | Route | Purpose |
|---|---|---|
| GET  | `/health` | liveness (returns `db: true/false`) |
| POST | `/v1/register` | first-run: `{ deviceId? }` → `{ deviceId, plan, limit }` |
| GET  | `/v1/me?device=…` | `{ plan, limit, usedToday, remaining, email }` for the status line |
| POST | `/v1/generate` | metered proxy: `{ deviceId, kind, ... }` → AI reply |
| POST | `/v1/account/request-code` | `{ email }` → emails a 6-digit restore code (logs it in dev) |
| POST | `/v1/account/verify-code` | `{ email, code, deviceId }` → links device to account, returns plan |
| GET  | `/v1/admin/stats?token=…` | dashboard counts (devices, accounts, pro, usage today) |
| GET  | `/v1/admin/accounts?token=…` | list accounts (plan, email, status) — your paid/unpaid view |
| POST | `/v1/admin/mark-pro?token=…` | `{ email, months? }` → manually grant Pro (test switch before Razorpay) |
| POST | `/v1/admin/unmark-pro?token=…` | `{ email }` → revert an account to free |

## Accounts (passwordless)

Free tier stays anonymous (device ID, 5/day). An account (keyed by **email**) appears
only when someone goes Pro. A device links to an account via the restore flow, so Pro
survives reinstalls and moves to a second Mac. Data model: `accounts`, `devices`
(with `accountId`), `usage`, `loginCodes` (TTL-expiring codes).

**Restore flow:** app calls `request-code` → user gets a 6-digit code (email, or the
server log if `RESEND_API_KEY` is unset) → app calls `verify-code` with the code + its
device ID → the device is linked and picks up the account's plan.

**Testing Pro before Razorpay:** `curl -X POST "$API/v1/admin/mark-pro?token=$ADMIN_TOKEN" -d '{"email":"you@x.com"}'`,
then restore that email in the app — it should flip to unlimited.

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
