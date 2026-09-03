import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { recoveryAttempts, subscriptions } from "../db/schema.js";
import { recoveryQueue, type RecoveryJobData } from "./index.js";
import { decideRecovery, RetryDecision } from "./retryPolicy.js";

export async function scheduleRecovery(
  internalSubscriptionId: string,
  amount: number,
  currency: string
): Promise<RetryDecision> {
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
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
      delay: Math.max(0, scheduledFor.getTime() - Date.now()),
      jobId: attempt.id,
    }
  );

  return decision;
}
