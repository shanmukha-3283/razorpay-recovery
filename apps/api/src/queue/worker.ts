import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLedger, customers, recoveryAttempts, subscriptions } from "../db/schema.js";
import { connection } from "./connection.js";
import { type RecoveryJobData } from "./index.js";
import { executeRecoveryAction } from "./recoveryAction.js";
import { sendRecoveryMessage } from "../delivery/index.js";

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

    const details = (result.details ?? {}) as Record<string, unknown>;
    const draftedMessage =
      typeof details.message === "string" ? details.message : null;

    let delivery: Awaited<ReturnType<typeof sendRecoveryMessage>> | null = null;
    if (draftedMessage && !["halt", "no-op"].includes(result.action)) {
      const [sub] = await db
        .select({ customerId: subscriptions.customerId })
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId));

      let toEmail: string | null | undefined;
      if (sub?.customerId) {
        const [customer] = await db
          .select({ email: customers.email })
          .from(customers)
          .where(eq(customers.id, sub.customerId));
        toEmail = customer?.email;
      }

      delivery = await sendRecoveryMessage({
        subscriptionId,
        recoveryAttemptId: attemptId,
        toEmail,
        message: draftedMessage,
      });
    }

    const auditMetadata = {
      ...details,
      ...(delivery
        ? {
            delivery: {
              channel: delivery.channel,
              status: delivery.status,
              error: delivery.error ?? null,
            },
          }
        : null),
    };

    await db.insert(auditLedger).values({
      recoveryAttemptId: attemptId,
      action: result.action,
      amount,
      metadata: auditMetadata,
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
