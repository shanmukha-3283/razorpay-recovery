import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { recoveryAttempts } from "../db/schema.js";

/**
 * Reset attempts stuck in `in_progress` (e.g. the process died mid-job)
 * back to `failed` so they never linger forever and the retry policy
 * sees a truthful history. Runs once at startup before the worker starts.
 */
export async function resetStaleAttempts(
  maxAgeMinutes = 30
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  const rows = await db
    .update(recoveryAttempts)
    .set({
      status: "failed",
      details: { error: "stale in_progress reset by startup sweep" },
    })
    .where(
      and(
        eq(recoveryAttempts.status, "in_progress"),
        lt(recoveryAttempts.createdAt, cutoff)
      )
    )
    .returning({ id: recoveryAttempts.id });

  if (rows.length > 0) {
    console.log(`Startup sweep reset ${rows.length} stale recovery attempt(s).`);
  }
  return rows.length;
}
