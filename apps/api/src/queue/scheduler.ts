import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  abandonedCheckouts,
  receivableInvoices,
  recoveryAttempts,
  subscriptions,
} from "../db/schema.js";
import { recoveryQueue, type RecoveryJobData } from "./index.js";
import {
  decideRecovery,
  MAX_ATTEMPTS,
  type RecoveryDomain,
  type RetryDecision,
} from "./retryPolicy.js";

export type ScheduleInput = {
  domain: RecoveryDomain;
  /** Internal owner id: subscription id or abandoned-checkout id. */
  ownerId: string;
  amount: number;
  currency: string;
};

const TERMINAL_CHECKOUT_STATUSES = ["recovered", "expired"];
const TERMINAL_RECEIVABLE_STATUSES = ["paid", "breached-closed"];

export async function scheduleRecovery(
  input: ScheduleInput
): Promise<RetryDecision> {
  const { domain, ownerId, amount, currency } = input;

  if (domain === "subscription") {
    // Terminal guard: a halted/cancelled subscription never re-arms, even
    // if new failure events arrive after the halt. Without this, each new
    // event would schedule a duplicate attempt that halts again forever.
    const [sub] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.id, ownerId));

    if (sub && (sub.status === "halted" || sub.status === "cancelled")) {
      return {
        allowed: false,
        attemptNumber: MAX_ATTEMPTS,
        scheduledFor: null,
        reason: "cap_reached",
      };
    }
  }

  if (domain === "checkout") {
    // Terminal guard: recovered/expired checkouts never re-arm.
    const [checkout] = await db
      .select({ status: abandonedCheckouts.status })
      .from(abandonedCheckouts)
      .where(eq(abandonedCheckouts.id, ownerId));

    if (checkout && TERMINAL_CHECKOUT_STATUSES.includes(checkout.status)) {
      return {
        allowed: false,
        attemptNumber: 2,
        scheduledFor: null,
        reason: "cap_reached",
      };
    }
  }

  if (domain === "receivable") {
    // Terminal guard: paid/closed invoices never re-arm.
    const [invoice] = await db
      .select({ status: receivableInvoices.status })
      .from(receivableInvoices)
      .where(eq(receivableInvoices.id, ownerId));

    if (invoice && TERMINAL_RECEIVABLE_STATUSES.includes(invoice.status)) {
      return {
        allowed: false,
        attemptNumber: 4,
        scheduledFor: null,
        reason: "cap_reached",
      };
    }
  }

  const decision = await decideRecovery(domain, ownerId);

  if (!decision.allowed || !decision.scheduledFor) {
    if (domain === "subscription") {
      await db
        .update(subscriptions)
        .set({ status: "halted", updatedAt: new Date() })
        .where(eq(subscriptions.id, ownerId));
    } else if (domain === "checkout") {
      await db
        .update(abandonedCheckouts)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(abandonedCheckouts.id, ownerId));
    } else {
      await db
        .update(receivableInvoices)
        .set({ status: "breached-closed", updatedAt: new Date() })
        .where(eq(receivableInvoices.id, ownerId));
    }
    return decision;
  }

  const scheduledFor = decision.scheduledFor;

  const [attempt] = await db
    .insert(recoveryAttempts)
    .values({
      domain,
      domainId: ownerId,
      subscriptionId: domain === "subscription" ? ownerId : null,
      attemptNumber: decision.attemptNumber,
      action: "recovery_attempt",
      status: "pending",
      amount,
      nextAttemptAt: scheduledFor,
    })
    .returning({ id: recoveryAttempts.id });

  const jobData: RecoveryJobData = {
    domain,
    ownerId,
    attemptNumber: decision.attemptNumber,
    amount,
    currency,
  };

  await recoveryQueue.add(
    `recovery-${domain}-${ownerId}-${decision.attemptNumber}`,
    jobData,
    {
      // Deliberately no queue-level retries (attempts: 1): the job body
      // has non-idempotent side effects (email send, invoice issue), so
      // a BullMQ retry could double-send/double-charge. Crashes are
      // recorded deterministically as failed attempts + audit rows by
      // the worker, and stale in_progress rows are reset by the sweep.
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
      delay: Math.max(0, scheduledFor.getTime() - Date.now()),
      jobId: attempt.id,
    }
  );

  return decision;
}
