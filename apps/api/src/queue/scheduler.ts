import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { recoveryAttempts, subscriptions } from "../db/schema.js";
import { recoveryQueue, type RecoveryJobData } from "./index.js";
import { decideRecovery, MAX_ATTEMPTS, RetryDecision } from "./retryPolicy.js";

export async function scheduleRecovery(
  internalSubscriptionId: string,
  amount: number,
  currency: string
): Promise<RetryDecision> {
  // Terminal guard: a halted/cancelled subscription never re-arms, even
  // if new failure events arrive after the halt. Without this, each new
  // event would schedule a duplicate attempt that halts again forever.
  const [sub] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.id, internalSubscriptionId));

  if (sub && (sub.status === "halted" || sub.status === "cancelled")) {
    return {
      allowed: false,
      attemptNumber: MAX_ATTEMPTS,
      scheduledFor: null,
      reason: "cap_reached",
    };
  }

  const decision = await decideRecovery(internalSubscriptionId);

  if (!decision.allowed || !decision.scheduledFor) {
    await db
      .update(subscriptions)
      .set({ status: "halted", updatedAt: new Date() })
      .where(eq(subscriptions.id, internalSubscriptionId));
    return decision;
  }

  const scheduledFor = decision.scheduledFor;

  const [attempt] = await db
    .insert(recoveryAttempts)
    .values({
      subscriptionId: internalSubscriptionId,
      attemptNumber: decision.attemptNumber,
      action: "recovery_attempt",
      status: "pending",
      amount,
      nextAttemptAt: scheduledFor,
    })
    .returning({ id: recoveryAttempts.id });

  const jobData: RecoveryJobData = {
    subscriptionId: internalSubscriptionId,
    attemptNumber: decision.attemptNumber,
    amount,
    currency,
  };

  await recoveryQueue.add(
    `recovery-${internalSubscriptionId}-${decision.attemptNumber}`,
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
