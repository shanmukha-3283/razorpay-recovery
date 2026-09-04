import { and, eq, lt } from "drizzle-orm";
import { db } from "./db/index.js";
import { escalations } from "./db/schema.js";
import type { RecoveryDomain } from "./queue/retryPolicy.js";

function slaHours(): number {
  return Number(process.env.ESCALATION_SLA_HOURS ?? 48);
}

function owner(): string {
  return process.env.ESCALATION_OWNER ?? "support-queue";
}

export type FileEscalationInput = {
  domain: RecoveryDomain;
  ownerId: string;
  reason: string;
};

/**
 * File a human escalation: owner queue + SLA due timestamp. Returns the
 * escalation id for audit metadata. Safe to call repeatedly — an already
 * open escalation for the same owner is returned instead of duplicated.
 */
export async function fileEscalation(
  input: FileEscalationInput
): Promise<string> {
  const [existing] = await db
    .select({ id: escalations.id })
    .from(escalations)
    .where(
      and(
        eq(escalations.domain, input.domain),
        eq(escalations.ownerId, input.ownerId),
        eq(escalations.status, "open")
      )
    )
    .limit(1);

  if (existing) return existing.id;

  const [row] = await db
    .insert(escalations)
    .values({
      domain: input.domain,
      ownerId: input.ownerId,
      reason: input.reason,
      owner: owner(),
      status: "open",
      slaDue: new Date(Date.now() + slaHours() * 60 * 60 * 1000),
    })
    .returning({ id: escalations.id });

  return row.id;
}

export type SlaSweepResult = {
  checked: number;
  breached: Array<{
    id: string;
    domain: string;
    owner: string;
    reason: string | null;
    slaDue: Date | null;
  }>;
};

/**
 * Review pass over open escalations past their SLA. Breach is a computed
 * property (status open + slaDue passed — see isSlaBreached); the sweep
 * returns the breached rows for ops tooling and bumps updatedAt as a
 * "last reviewed" marker. Callers with an attempt id record audit context.
 */
export async function checkSlaBreaches(now: Date = new Date()): Promise<SlaSweepResult> {
  const overdue = await db
    .select({
      id: escalations.id,
      domain: escalations.domain,
      owner: escalations.owner,
      reason: escalations.reason,
      slaDue: escalations.slaDue,
    })
    .from(escalations)
    .where(
      and(
        eq(escalations.status, "open"),
        lt(escalations.slaDue, now)
      )
    );

  for (const row of overdue) {
    await db
      .update(escalations)
      .set({ updatedAt: now })
      .where(eq(escalations.id, row.id));
  }

  return { checked: overdue.length, breached: overdue };
}

export function isSlaBreached(
  escalation: { status: string; slaDue: Date | null },
  now: Date = new Date()
): boolean {
  return (
    escalation.status === "open" &&
    escalation.slaDue !== null &&
    escalation.slaDue.getTime() < now.getTime()
  );
}
