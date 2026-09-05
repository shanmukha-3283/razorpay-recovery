# User Guide — How to Use the Revenue Recovery Platform

## The one idea to understand first

This platform has **two halves** that people mix up:

| Half | What it does | Analogy |
|---|---|---|
| **Recovery engine** (automatic) | Detects at-risk money → asks the AI what to do → sends emails / retries payments, with hard stop limits | The salesperson who chases every overdue payment |
| **Batches** (your scoreboard) | Measures *how much money actually came back* in a period | The sales report at the end of the month |

**Batches never recover a single rupee.** They only *count* money that the
recovery engine brought back. If you only click around Batches, nothing will
ever happen — the engine is driven by webhooks, schedules, and the action
buttons on the detail pages.

## The normal operating loop (all 3 domains)

Every domain follows the same 5 steps:

1. **Open a batch first** — Batches page → type a Name (e.g. `week-36`),
   pick a Domain, click **Create batch**.
   > Got a red `An open batch already exists for this domain` (409)?
   > That just means last period's scoreboard is still open.
   > Click **Close** on the open row, then Create again. One open
   > scoreboard per domain at a time — otherwise results couldn't be
   > attributed to the right period.
2. **Let risk arrive** — a real Razorpay `payment.failed` webhook, an
   abandoned checkout, or an uploaded invoice. (Locally: the `simulate:*`
   scripts.)
3. **Watch the engine work** — Recovery page (attempts + AI insight chips),
   Deliveries page (emails sent/skipped), Audit page (every action logged).
4. **Customer pays** — via the emailed payment link, or record it with
   **Mark paid** for offline/B2B payments.
5. **Close the batch** — Batches page → click the batch name → **Close batch**.
   The numbers freeze: Touched, Recovered, Recovered ₹, Rate.

## Domain 1 — Subscriptions (failed recurring payments)

**Path:** Subscriptions page → click a subscription ID → detail page.

What you see: customer, plan, status badge, Current period, Paid/Total cards,
a Payments table (with error reasons), and a Recovery attempts table (with
the AI's `failureCategory` chip and reason).

**Your two buttons:**
- **Retry recovery now** — manually starts a recovery attempt *right now*
  (same rules as automatic). Success message: `Recovery attempt #N scheduled
  for …`. If the subscription already hit the limit, it refuses with the cap
  reason (409) — that refusal *is* the stopping rule working.
- **Sync from Razorpay** — refreshes status/plan/period from the live
  Razorpay API. Use it when the dashboard looks stale.

**Stopping rule:** max **3 attempts / 72 hours**. After that the subscription
is halted automatically — no infinite chasing.

## Domain 2 — Checkouts (abandoned orders)

**Path:** Checkouts page → click an order ID → detail page.

Statuses flow: `abandoned` → `reminded` → `escalated` → `recovered` (paid!)
or `expired` (gave up after limits).

**There is deliberately no Retry button here.** The recovery *is* the reminder
schedule: first reminder after a 30-minute grace window, second ~24h later,
max **2 reminders / 48h**. Your only action on the detail page is the
**Payment link** button, which just opens the customer's pay URL (no API
call — it's for you to inspect/copy, not to trigger anything).

Money counts as recovered when the customer pays through that link.

## Domain 3 — Receivables (B2B invoices)

**Path:** Receivables page → click an invoice ID → detail page.

**Getting invoices in:** `POST /api/receivables` (one invoice) or
`POST /api/receivables/import` with `Content-Type: text/csv` and header
`external_id,customer_name,customer_email,amount,currency,due_date`.
Re-importing never resurrects an already-`paid` invoice.

**Your two controls** (hidden once the invoice is `paid`):
- **Record promise** — enter the date the customer promised to pay (amount
  optional) and submit. Invoice flips to `promised`; the agent goes quiet
  until that date. If the date passes unpaid, the promise is marked
  `breached` and a human escalation is filed automatically.
- **Mark paid** — click this when money arrived offline (bank transfer, cash,
  etc.). The invoice closes, open promises flip to `kept`, and the amount
  counts toward the open batch.

**Stopping rule:** max **4 touches / 30 days**, one polite→firm ladder email
per week.

## Reading the scoreboard (Batches page)

Each row shows: **Touched** (owners the engine contacted), **Recovered**
(owners who paid, as `recovered/touched`), **Recovered ₹** (only money
movement *observed after the batch was opened* — retries that didn't get
paid contribute touches, never rupees), and **Rate**.

Click a batch name for the member-attempts table, then **Close batch** to
freeze it. Closed batches never change — that's the audit-grade number you
quote.

## The supporting pages

- **Dashboard (`/`)** — stat cards, recovery-amounts chart, recent attempts.
  Read-only overview.
- **Recovery (`/recovery`)** — every attempt across all domains with status
  badges. Read-only.
- **Raw Events (`/events`)** — every ingested webhook with processed
  timestamps. **Start debugging here:** unprocessed rows mean the handler
  errored.
- **Deliveries (`/deliveries`)** — every email: `sent` / `failed` / `skipped`
  with reasons. Filter with the status pills. Also hosts the **DND manager**:
  **Add to DND** suppresses all future sends to an email; per-row
  **Remove** lifts it.
- **Escalations (`/escalations`)** — human review queue. Per-row **Ack** /
  **Resolve**, plus **Run SLA check** (reports `Checked N, breached M`).
- **Audit (`/audit`)** — the immutable log: every recovery action with
  timestamp, action, amount, linked attempt. Expand a row for metadata
  (agent reason, Razorpay result, delivery outcome).

## FAQ

**I clicked Create batch and got 409. Is something broken?**
No. Close the currently-open batch for that domain first, then create.
One open scoreboard per domain.

**I clicked Retry recovery now and got 409 `cap_reached`.**
The subscription already used its 3 attempts / 72h. The engine stopped
itself — by design, not by error.

**An attempt has no AI chip / says fallback.**
The LLM was unreachable when the worker ran, so deterministic rules decided.
The pipeline still completed and the audit row was still written.

**A send shows `skipped`.**
Check the reason: DND list, quiet hours (21:00–08:00 IST), or the 1/day
per-recipient cap. The skip *is* the compliance engine working.

**Nothing appears after I fire a webhook.**
Raw Events page: is there a new row? If yes but unprocessed, the handler
errored — check API logs. If no row, the signature was rejected (wrong
`RAZORPAY_WEBHOOK_SECRET`) or the API is asleep (Render free tier cold
start ~50s).
