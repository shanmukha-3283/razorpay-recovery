import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  paymentPromises,
  receivableInvoices,
} from "../db/schema.js";
import { checkSlaBreaches } from "../escalations.js";
import { resetStaleAttempts } from "./sweep.js";

export type BreachSweepResult = { checked: number; breached: number };

/**
 * Sweep open promises past their date on still-unpaid invoices.
 * Status-only sweep (no audit rows: breaches carry no attempt id);
 * the next agent run records the breach with full context.
 */
export async function checkPromiseBreaches(
  now: Date = new Date()
): Promise<BreachSweepResult> {
  const breached = await db
    .select({
      promiseId: paymentPromises.id,
      invoiceId: paymentPromises.invoiceId,
    })
    .from(paymentPromises)
    .innerJoin(
      receivableInvoices,
      eq(paymentPromises.invoiceId, receivableInvoices.id)
    )
    .where(
      and(
        eq(paymentPromises.status, "open"),
        lt(paymentPromises.promisedDate, now)
      )
    );

  let marked = 0;
  for (const row of breached) {
    const [invoice] = await db
      .select({ status: receivableInvoices.status })
      .from(receivableInvoices)
      .where(eq(receivableInvoices.id, row.invoiceId));
    if (!invoice || invoice.status === "paid") continue;

    await db
      .update(paymentPromises)
      .set({ status: "breached" })
      .where(eq(paymentPromises.id, row.promiseId));
    await db
      .update(receivableInvoices)
      .set({ status: "breached", updatedAt: new Date() })
      .where(eq(receivableInvoices.id, row.invoiceId));
    marked++;
  }

  return { checked: breached.length, breached: marked };
}

function intervalMs(): number {
  return Number(process.env.SWEEP_INTERVAL_MIN ?? 60) * 60 * 1000;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Periodic sweep loop: stale attempts, promise breaches, escalation SLAs.
 * Each sweep is independently guarded so one failure never kills the loop.
 * Single-process scheduling — multi-replica deployments need a leader
 * lock, which is out of scope.
 */
export function startSweeps(): void {
  if (timer) return;
  const tick = async () => {
    try {
      await resetStaleAttempts();
    } catch (err) {
      console.error("Stale-attempt sweep failed:", err);
    }
    try {
      await checkPromiseBreaches();
    } catch (err) {
      console.error("Promise-breach sweep failed:", err);
    }
    try {
      await checkSlaBreaches();
    } catch (err) {
      console.error("SLA sweep failed:", err);
    }
  };
  timer = setInterval(() => void tick(), intervalMs());
  timer.unref?.();
}

export function stopSweeps(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
