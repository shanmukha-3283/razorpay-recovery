import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { recoveryAttempts } from "../db/schema.js";

export const MAX_ATTEMPTS = 3;
export const RETRY_WINDOW_HOURS = 72;
export const RETRY_SPACING_MS = [0, 60 * 60 * 1000, 24 * 60 * 60 * 1000];

export type RetryDecision = {
  allowed: boolean;
  attemptNumber: number;
  scheduledFor: Date | null;
  reason: "scheduled" | "cap_reached";
};

function retrySpacingFor(attemptNumber: number): number {
  return (
    RETRY_SPACING_MS[attemptNumber - 1] ??
    RETRY_SPACING_MS[RETRY_SPACING_MS.length - 1]
  );
}

export async function decideRecovery(
  internalSubscriptionId: string
): Promise<RetryDecision> {
  const attempts = await db
    .select({
      id: recoveryAttempts.id,
      attemptNumber: recoveryAttempts.attemptNumber,
      createdAt: recoveryAttempts.createdAt,
    })
    .from(recoveryAttempts)
    .where(
      and(
        eq(recoveryAttempts.subscriptionId, internalSubscriptionId),
        eq(recoveryAttempts.status, "completed")
      )
    )
    .orderBy(desc(recoveryAttempts.createdAt));

  if (attempts.length === 0) {
    return {
      allowed: true,
      attemptNumber: 1,
      scheduledFor: new Date(Date.now() + retrySpacingFor(1)),
      reason: "scheduled",
    };
  }

  const firstAttempt = attempts[attempts.length - 1];
  const firstAttemptTime = firstAttempt.createdAt.getTime();
  const windowEnd = firstAttemptTime + RETRY_WINDOW_HOURS * 60 * 60 * 1000;

  const lastCompleted = attempts[0];

  if (lastCompleted.attemptNumber >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      attemptNumber: MAX_ATTEMPTS,
      scheduledFor: null,
      reason: "cap_reached",
    };
  }

  const attemptNumber = lastCompleted.attemptNumber + 1;
  const scheduledFor = new Date(
    lastCompleted.createdAt.getTime() + retrySpacingFor(attemptNumber)
  );

  if (scheduledFor.getTime() > windowEnd) {
    return {
      allowed: false,
      attemptNumber,
      scheduledFor: null,
      reason: "cap_reached",
    };
  }

  return { allowed: true, attemptNumber, scheduledFor, reason: "scheduled" };
}
