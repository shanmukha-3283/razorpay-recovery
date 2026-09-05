# Project: Razorpay AI Revenue Recovery Agent

## Stack (do not deviate)
- Backend: Hono + TypeScript, in apps/api
- DB: Postgres + Drizzle ORM
- Queue: Redis + BullMQ for retry scheduling
- Agent: LangGraph (StateGraph) for the decision loop
- LLM: Claude / Ollama / Gemini via LLM_PROVIDER (classification fallback + message drafting); Gemini in production
- Frontend: React + Vite, based on shadcn-admin, in apps/web

## Hard requirements (non-negotiable)
- Every webhook event is persisted to raw_events BEFORE processing
- Every recovery action writes a row to audit_ledger (action, amount, timestamp)
- Retries are capped (max 3 attempts / 72h) — this stopping rule must be enforced in code, not just documented
- Signature verification on all Razorpay webhooks, no exceptions

## Conventions
- One Drizzle migration per schema change, never edit applied migrations
- Commit after each completed step with a clear message
