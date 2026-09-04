# Razorpay AI Revenue Recovery Agent

Automatically recover failed Razorpay subscription payments using an AI decision loop:

**webhook → raw_event persistence → LangGraph decision → LLM drafting → email delivery → Razorpay action**

Monorepo (pnpm + turbo):

- `apps/api` — Hono + TypeScript backend
- `apps/web` — React + Vite dashboard (shadcn-admin)

## Stack

| Layer      | Tech                                    |
| ---------- | --------------------------------------- |
| Backend    | Hono + TypeScript                        |
| DB         | Postgres + Drizzle ORM                   |
| Queue      | Redis + BullMQ (retry scheduling)        |
| Agent      | LangGraph (StateGraph decision loop)     |
| LLM        | Claude (or Ollama) classification/drafting |
| Delivery   | Resend (email)                           |
| Frontend   | React + Vite + shadcn-admin              |

## Hard requirements

- Every webhook event is persisted to `raw_events` **before** processing.
- Every recovery action writes a row to `audit_ledger` (action, amount, timestamp).
- Retries are capped at **3 attempts / 72h** — enforced in code (`retryPolicy.ts`).
- All Razorpay webhooks are signature-verified — no exceptions.

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
pnpm test        # vitest unit tests (retry cap, signature verification, actions)
```

## Environment variables (`.env`)

| Variable                  | Purpose                                   |
| ------------------------- | ----------------------------------------- |
| `DATABASE_URL`            | Postgres connection string                |
| `REDIS_URL`               | Redis connection string (BullMQ)          |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature secret                  |
| `RAZORPAY_KEY_ID/SECRET`  | Razorpay API credentials (actions)        |
| `LLM_PROVIDER`            | `claude` or `ollama`                      |
| `ANTHROPIC_API_KEY`       | Required when `LLM_PROVIDER=claude`       |
| `OLLAMA_MODEL/BASE_URL`   | Ollama settings                           |
| `RESEND_API_KEY`          | Email delivery; unset = stub mode         |
| `DELIVERY_FROM_EMAIL`     | Sender for Resend                         |
| `VITE_API_URL`            | Frontend API base (default `/api`)        |

## Notes

- The retry cap (3 attempts / 72h) and the halt/cancel terminal fallback are enforced
  in code; the LLM never controls the cap.
- Without `RESEND_API_KEY`, email delivery records a stub row in `message_deliveries`
  instead of sending.
- Without an LLM reachable, the agent falls back to deterministic decisions so the
  pipeline still completes.
