import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLedger, recoveryAttempts } from "../db/schema.js";
import { connection } from "./connection.js";
import { type RecoveryJobData } from "./index.js";
import { executeRecoveryAction } from "./recoveryAction.js";

const worker = new Worker<RecoveryJobData>(
  "recovery",
  async (job) => {
    const { subscriptionId, attemptNumber, amount } = job.data;

    const [attempt] = await db
      .update(recoveryAttempts)
      .set({ status: "in_progress" })
      .where(eq(recoveryAttempts.id, job.id ?? ""))
      .returning({ id: recoveryAttempts.id });

    const result = await executeRecoveryAction({
      subscriptionId,
      attemptNumber,
      amount,
      currency: job.data.currency,
    });

    const attemptId = attempt?.id ?? job.id;

    await db
      .update(recoveryAttempts)
      .set({
        status: result.success ? "completed" : "failed",
        action: result.action,
        details: result.details ?? null,
      })
      .where(eq(recoveryAttempts.id, attemptId));

    await db.insert(auditLedger).values({
      recoveryAttemptId: attemptId,
      action: result.action,
      amount,
      metadata: result.details ?? null,
    });
  },
  { connection }
);

export function startWorker(): Worker<RecoveryJobData> {
  worker.on("failed", (job, err) => {
    console.error(`Recovery job ${job?.id} failed:`, err);
  });
  return worker;
}
