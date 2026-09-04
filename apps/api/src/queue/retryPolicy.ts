import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { recoveryAttempts } from "../db/schema.js";

export type RecoveryDomain = "subscription" | "checkout";

type DomainPolicy = {
  maxAttempts: number;
  windowHours: number;
  spacingMs: number[];
};

const HOUR = 60 * 60 * 1000;

const POLICIES: Record<RecoveryDomain, DomainPolicy> = {
  // Bounded subscription recovery: max 3 attempts / 72h.
  subscription: { maxAttempts: 3, windowHours: 72, spacingMs: [0, HOUR, 24 * HOUR] },
  // Bounded checkout recovery: max 2 reminders / 48h. The first reminder is
  // delayed 30 minutes to give the customer a grace window to pay.
  checkout: { maxAttempts: 2, windowHours: 48, spacingMs: [30 * 60 * 1000, 24 * HOUR] },
};

// Kept for backward compatibility (subscription policy). graph.ts uses
// MAX_ATTEMPTS for its terminal halt check.
export const MAX_ATTEMPTS = POLICIES.subscription.maxAttempts;
export const RETRY_WINDOW_HOURS = POLICIES.subscription.windowHours;
export const RETRY_SPACING_MS = POLICIES.subscription.spacingMs;

export type RetryDecision = {
  allowed: boolean;
  attemptNumber: number;
  scheduledFor: Date | null;
  reason: "scheduled" | "cap_reached";
};

function retrySpacingFor(domain: RecoveryDomain, attemptNumber: number): number {
  const spacing = POLICIES[domain].spacingMs;
  return spacing[attemptNumber - 1] ?? spacing[spacing.length - 1];
}

export async function decideRecovery(
  domain: RecoveryDomain,
  domainId: string
): Promise<RetryDecision> {
  const policy = POLICIES[domain];

  const attempts = await db
    .select({
      id: recoveryAttempts.id,
      attemptNumber: recoveryAttempts.attemptNumber,
      createdAt: recoveryAttempts.createdAt,
    })
    .from(recoveryAttempts)
    .where(
      and(
        eq(recoveryAttempts.domain, domain),
        eq(recoveryAttempts.domainId, domainId),
        eq(recoveryAttempts.status, "completed")
      )
    )
    .orderBy(desc(recoveryAttempts.createdAt));

  if (attempts.length === 0) {
    return {
      allowed: true,
      attemptNumber: 1,
      scheduledFor: new Date(Date.now() + retrySpacingFor(domain, 1)),
      reason: "scheduled",
    };
  }

  const firstAttempt = attempts[attempts.length - 1];
  const firstAttemptTime = firstAttempt.createdAt.getTime();
  const windowEnd = firstAttemptTime + policy.windowHours * 60 * 60 * 1000;

  const lastCompleted = attempts[0];

  if (lastCompleted.attemptNumber >= policy.maxAttempts) {
    return {
      allowed: false,
      attemptNumber: policy.maxAttempts,
      scheduledFor: null,
      reason: "cap_reached",
    };
  }

  const attemptNumber = lastCompleted.attemptNumber + 1;
  const scheduledFor = new Date(
    lastCompleted.createdAt.getTime() + retrySpacingFor(domain, attemptNumber)
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
