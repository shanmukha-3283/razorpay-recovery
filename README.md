# Razorpay AI Revenue Recovery Agent

Automatically recover failed Razorpay subscription payments using an AI decision loop:

**webhook → raw_event persistence → LangGraph decision → LLM drafting → email delivery → Razorpay action**

Monorepo (pnpm + turbo):

- `apps/api` — Hono + TypeScript backend
- `apps/web` — React + Vite dashboard (shadcn-admin)

## Architecture

```mermaid
flowchart LR
    subgraph triggers["Revenue-at-risk triggers"]
        WH[Razorpay webhooks]
        CO[Abandoned orders]
        INV[Overdue invoices CSV/API]
    end
    triggers --> INGEST[persist raw record]
    INGEST --> CAP{cap + terminal-guard check}
    CAP -->|refused| CLOSE[close locally: halted/expired/breached-closed]
    CAP -->|allowed| Q[(BullMQ delayed job)]
    Q --> W[claim-guarded worker]
    W --> AG[domain agent: classify → decide → draft]
    AG --> ACT[Razorpay action + compliant email]
    ACT --> AUD[audit_ledger row]
    AG --> ESC[human escalation + SLA]
```

## Problem-statement fit

| Requirement | Where it lives | How it's proven |
|---|---|---|
| Detect + recover payment failures | `handlers/`, subscription agent, worker | live webhook → attempt → audit runs |
| Checkout abandonment recovery | `routes/checkouts.ts`, `agent/checkoutAgent.ts`, Checkouts pages | simulator + 30-min grace + pay-link email |
| Overdue receivables + promises | `routes/receivables.ts`, `agent/receivableAgent.ts`, Receivables pages | CSV import, promise/breach flows, seed bands |
| Right intervention via AI | `agent/*`, `llmService.ts` | `failureCategory` chips + reasons rendered in UI |
| Bounded workflows + stopping rules | `queue/retryPolicy.ts` (3/72h, 2/48h, 4/30d) | 200 tests (140 API + 60 web) incl. cap/boundary tests |
| Measured money per batch | `routes/batches.ts`, Batches pages | recovered-$ counts only post-batch money movement |
| Compliant escalation | `delivery/compliance.ts`, DND, escalations queue | skipped-with-reason rows, SLA tracking |
| Audit trail | `audit_ledger` on every worker path | Audit page with metadata viewer |

## Stack

| Layer      | Tech                                    |
| ---------- | --------------------------------------- |
| Backend    | Hono + TypeScript                        |
| DB         | Postgres + Drizzle ORM                   |
| Queue      | Redis + BullMQ (retry scheduling)        |
| Agent      | LangGraph (StateGraph decision loop)     |
| LLM        | Claude / Ollama / Gemini via `LLM_PROVIDER` (Gemini in production) |
| Delivery   | Resend (email)                           |
| Frontend   | React + Vite + shadcn-admin              |

## Hard requirements

- Every webhook event is persisted to `raw_events` **before** processing.
- Every recovery action writes a row to `audit_ledger` (action, amount, timestamp).
- Retries are capped at **3 attempts / 72h** — enforced in code (`retryPolicy.ts`).
- All Razorpay webhooks are signature-verified — no exceptions.
- Dashboard reads are open; every state-changing API call requires a bearer
  token (`DASHBOARD_API_TOKEN`), enforced fail-closed in
  `middleware/mutationAuth.ts`.

## Prerequisites

- Node 20+ (uses `process.loadEnvFile`), pnpm 9
- Postgres 15/16 and Redis 7 (or use `docker-compose.yml`)

## Setup

```bash
# 1. Install deps
pnpm install

# 2. Create env from the template
cp .env.example .env

# 3. Start dependencies (Docker)
pnpm db:up
#   ...or run Postgres + Redis yourself and point DATABASE_URL / REDIS_URL at them.

# 4. Apply migrations + seed demo data
pnpm db:setup
```

## Run

```bash
# API on :3000 and web dashboard on :5173 (with /api proxied to :3000)
pnpm dev
```

Open `http://localhost:5173` for the dashboard.

## Production (Docker)

```bash
# 1. Create env from the template and set real secrets
cp .env.example .env

# 2. Build + start the full stack (db, redis, api, web)
docker compose up -d --build

# 3. Apply migrations from the host (prod image has no devDeps,
#    so drizzle-kit runs here with DATABASE_URL pointed at the compose db)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/razorpay_recovery \
  pnpm --filter @razorpay-recovery/api db:migrate
```

Open `http://localhost:8080` for the dashboard (nginx serves the app and
proxies `/api/*` to the api service).

Notes:

- Inside compose, `DATABASE_URL`/`REDIS_URL` are overridden to the `db`/`redis`
  service names automatically; your `.env` localhost values only apply to
  host-run processes.
- `VITE_API_URL` and `VITE_DASHBOARD_API_TOKEN` are baked at web **build**
  time (see `apps/web/Dockerfile`). Override with `--build-arg
  VITE_API_URL=...`/`VITE_DASHBOARD_API_TOKEN=...` — most useful for
  split-origin deployments where the dashboard calls the API across origins.
  In the compose setup both default to same-origin (`/api` proxied through
  nginx), which needs no token value at all.
- CI (`.github/workflows/ci.yml`) runs `test` / `typecheck` / `build` plus a
  `docker build` smoke step on every push and PR.

## Simulating a webhook locally

Without real Razorpay, POST a signed `payment.failed` event to the running API:

```bash
# From apps/api (the API must be running with the same RAZORPAY_WEBHOOK_SECRET)
pnpm simulate:failed
```

This exercises the real pipeline: `raw_events` insert → handler → retry scheduling
(BullMQ) → worker → agent decision → audit ledger. Delivery is graceful on the stub
provider (no `RESEND_API_KEY`, nothing is sent).

## Tests

```bash
pnpm test        # vitest unit tests — 200 total (140 API + 60 web)
                     #   (retry cap, signature verification, actions, agent fallback)
```

## Environment variables (`.env`)

| Variable                  | Purpose                                   |
| ------------------------- | ----------------------------------------- |
| `DATABASE_URL`            | Postgres connection string                |
| `REDIS_URL`               | Redis connection string (BullMQ)          |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature secret                  |
| `RAZORPAY_KEY_ID/SECRET`  | Razorpay API credentials (actions)        |
| `PORT`                    | API listen port (default 3000)            |
| `LLM_PROVIDER`            | `claude`, `ollama`, or `gemini`           |
| `ANTHROPIC_API_KEY`       | Required when `LLM_PROVIDER=claude`       |
| `CLAUDE_MODEL`            | Claude model (default `claude-haiku-4-5`) |
| `OLLAMA_MODEL/BASE_URL`   | Ollama settings                           |
| `GOOGLE_API_KEY`          | Required when `LLM_PROVIDER=gemini`       |
| `GEMINI_MODEL`            | Gemini model (default `gemini-3.6-flash`) |
| `RESEND_API_KEY`          | Email delivery; unset = stub mode         |
| `DELIVERY_PROVIDER`       | Delivery provider (default `resend`)      |
| `DELIVERY_FROM_EMAIL`     | Sender for Resend                         |
| `VITE_API_URL`            | Frontend API base (baked at build)        |
| `VITE_DASHBOARD_API_TOKEN`| Bearer token baked into the web build     |
| `DASHBOARD_API_TOKEN`     | Bearer token enforced by the API (must match `VITE_DASHBOARD_API_TOKEN`) |
| `WEB_ORIGIN`              | Allowed CORS origin for split-origin browser → API calls |
| `API_URL`                 | Base URL the simulator scripts POST to    |
| `SIM_SUBSCRIPTION_ID`     | Subscription the webhook simulator targets |
| `SWEEP_INTERVAL_MIN`      | Recovery sweep interval (default 60)      |
| `QUIET_HOURS_START/END`   | Compliance quiet window (default 21–8)    |
| `COMPLIANCE_TZ`           | Timezone for quiet hours (default Asia/Kolkata) |
| `COMPLIANCE_DAILY_CAP`    | Max touches/recipient/day (default 1)     |
| `COMPLIANCE_WEEKLY_CAP`   | Max touches/recipient/week (default 3)    |
| `ESCALATION_OWNER`        | Default escalation queue (support-queue)  |
| `ESCALATION_SLA_HOURS`    | Escalation SLA horizon (default 48)       |

## Recovery batches, compliance & escalations

- **Batches** (`/batches` page): create one open batch per domain; every
  scheduled attempt is tagged automatically. Reports show *measured* recovery
  — only money movement observed after batch start counts (captured payments,
  paid invoices) — plus touched owners and recovery rate. Close a batch to
  freeze its numbers.
- **Compliance** is enforced on every outbound email: DND list
  (`/deliveries` page manager), quiet hours, and per-recipient frequency caps.
  Violations are recorded as `skipped` deliveries with reasons, never dropped.
- **Escalations** (`/escalations` page): LLM `contact_support` hints and final
  dunning/breach touches file human review items with SLA due dates; ack,
  resolve, or run the SLA check from the dashboard.

## Notes

- The retry cap (3 attempts / 72h) and the halt/cancel terminal fallback are enforced
  in code; the LLM never controls the cap.
- Without `RESEND_API_KEY`, email delivery records a stub row in `message_deliveries`
  instead of sending.
- Without an LLM reachable, the agent falls back to deterministic decisions so the
  pipeline still completes.

## Deploying to Render

`render.yaml` at the repo root defines the full stack: API (Docker, `/health`
checks), web (Docker nginx serving the SPA + same-origin `/api` proxy),
managed Postgres, and managed Key Value (Redis).

1. Dashboard → New → Blueprint → select this repo.
2. Fill every `sync: false` secret: Razorpay keys + webhook secret, `GOOGLE_API_KEY`
   (with `LLM_PROVIDER=gemini` pre-set), `RESEND_API_KEY` + `DELIVERY_FROM_EMAIL`.
3. Deploy. The API image runs pending migrations itself on every boot, so a
   fresh managed DB self-initializes (verify in deploy logs:
   "DB migrations applied successfully"). For an existing DB, migrations are
   a safe no-op — no manual step needed.
4. Register the public API URL (`https://<api-service>.onrender.com/webhooks/razorpay`)
   in the Razorpay dashboard and fire a test event.
5. Open the web service URL.

Deployed topology (what `render.yaml` builds):

- The **web image bakes the public API URL** (`VITE_API_URL=...` in
  `apps/web/Dockerfile`) and the dashboard token at build time, so the
  browser calls the API **cross-origin** — exactly what's running on the
  live demo.
- `WEB_ORIGIN` is set on the API to allow that cross-origin browser → API
  traffic (see the CORS middleware); point it at the public web URL.
- The nginx `/api` reverse proxy still exists in the web image and is used
  for the same-origin path (local/compose). In the split-origin deployment
  the browser bypasses it — CORS + `WEB_ORIGIN` are the tuning knobs.

Caveats for evaluation use: free-tier Postgres sleeps and Key Value is
ephemeral — fine for judging, not for production data. Set `WEB_ORIGIN` only
if you call the API directly from another origin.
