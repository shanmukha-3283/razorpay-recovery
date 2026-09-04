import { Worker } from "bullmq";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLedger, customers, payments, recoveryAttempts, subscriptions } from "../db/schema.js";
import { connection } from "./connection.js";
import { type RecoveryJobData } from "./index.js";
import { executeRecoveryAction } from "./recoveryAction.js";
import { executeRazorpayAction } from "../razorpay/actions.js";
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

    // Resolve the Razorpay subscription id and any stored invoice for retry.
    const [sub] = await db
      .select({ razorpaySubscriptionId: subscriptions.razorpaySubscriptionId })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId));

    const [latestPayment] = await db
      .select({ invoiceId: payments.invoiceId })
      .from(payments)
      .where(eq(payments.subscriptionId, subscriptionId))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    let razorpayResult: Awaited<ReturnType<typeof executeRazorpayAction>> | null =
      null;

    // Only attempt a real Razorpay action for mapped, non-terminal decisions.
    if (sub?.razorpaySubscriptionId && ["retry", "adjust", "halt"].includes(result.action)) {
      try {
        razorpayResult = await executeRazorpayAction({
          decision: result.action,
          razorpaySubscriptionId: sub.razorpaySubscriptionId,
          invoiceId: latestPayment?.invoiceId ?? null,
        });
      } catch (err) {
        razorpayResult = {
          action: `razorpay.${result.action}`,
          success: false,
          providerStatus: null,
          shortUrl: null,
          error: err instanceof Error ? err.message : "unknown razorpay error",
        };
      }

      // Reflect terminal provider states locally so the dashboard stays accurate.
      if (razorpayResult?.providerStatus === "cancelled" || razorpayResult?.action === "razorpay.halt") {
        const status =
          razorpayResult.action === "razorpay.cancel" ||
          razorpayResult.providerStatus === "cancelled"
            ? "cancelled"
            : razorpayResult.providerStatus === "paused"
            ? "halted"
            : undefined;
        if (status) {
          await db
            .update(subscriptions)
            .set({ status, updatedAt: new Date() })
            .where(eq(subscriptions.id, subscriptionId));
        }
      }
    }

    if (razorpayResult?.shortUrl && typeof details.message === "string") {
      details.message = `${details.message}\n\nUpdate your payment method here: ${razorpayResult.shortUrl}`;
    }

    let delivery: Awaited<ReturnType<typeof sendRecoveryMessage>> | null = null;
    if (draftedMessage && !["halt", "no-op"].includes(result.action)) {
      const [subRow] = await db
        .select({ customerId: subscriptions.customerId })
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId));

      let toEmail: string | null | undefined;
      if (subRow?.customerId) {
        const [customer] = await db
          .select({ email: customers.email })
          .from(customers)
          .where(eq(customers.id, subRow.customerId));
        toEmail = customer?.email;
      }

      delivery = await sendRecoveryMessage({
        subscriptionId,
        recoveryAttemptId: attemptId,
        toEmail,
        message: details.message as string,
      });
    }

    const auditMetadata = {
      ...details,
      ...(razorpayResult
        ? {
            razorpay: {
              action: razorpayResult.action,
              success: razorpayResult.success,
              providerStatus: razorpayResult.providerStatus,
              shortUrl: razorpayResult.shortUrl,
              error: razorpayResult.error ?? null,
            },
          }
        : null),
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
