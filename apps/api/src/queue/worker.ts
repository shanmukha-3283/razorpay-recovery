import { Worker, type Job } from "bullmq";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { abandonedCheckouts, auditLedger, customers, payments, paymentPromises, receivableInvoices, recoveryAttempts, subscriptions } from "../db/schema.js";
import { connection } from "./connection.js";
import { type RecoveryJobData } from "./index.js";
import { checkoutAgent } from "../agent/checkoutAgent.js";
import { receivableAgent } from "../agent/receivableAgent.js";
import { fileEscalation } from "../escalations.js";
import { executeRecoveryAction } from "./recoveryAction.js";
import { executeRazorpayAction } from "../razorpay/actions.js";
import { sendRecoveryMessage } from "../delivery/index.js";

const TERMINAL_ACTIONS = ["halt", "no-op", "expire", "recovered", "paid", "escalate"];

export async function processRecoveryJob(job: Job<RecoveryJobData>) {
  if (job.data.domain === "checkout") {
    return processCheckoutJob(job);
  }
  if (job.data.domain === "receivable") {
    return processReceivableJob(job);
  }
  return processSubscriptionJob(job);
}

async function markCheckoutStatus(checkoutId: string, status: string) {
  await db
    .update(abandonedCheckouts)
    .set({ status, updatedAt: new Date() })
    .where(eq(abandonedCheckouts.id, checkoutId));
}

async function processCheckoutJob(job: Job<RecoveryJobData>) {
  const { ownerId: checkoutId, attemptNumber, amount } = job.data;

  // Same claim guard as the subscription path: only pending attempts run.
  const [attempt] = await db
    .update(recoveryAttempts)
    .set({ status: "in_progress" })
    .where(
      and(
        eq(recoveryAttempts.id, job.id ?? ""),
        eq(recoveryAttempts.status, "pending")
      )
    )
    .returning({ id: recoveryAttempts.id });

  if (!attempt) {
    console.log(`Recovery job ${job.id} already handled; skipping.`);
    return;
  }

  const attemptId = attempt.id;

  const [checkout] = await db
    .select()
    .from(abandonedCheckouts)
    .where(eq(abandonedCheckouts.id, checkoutId));

  if (!checkout) {
    await db
      .update(recoveryAttempts)
      .set({
        status: "completed",
        action: "no-op",
        details: { reason: "checkout not found" },
      })
      .where(eq(recoveryAttempts.id, attemptId));
    await db.insert(auditLedger).values({
      recoveryAttemptId: attemptId,
      action: "no-op",
      amount,
      metadata: { reason: "checkout not found" },
    });
    return;
  }

  const result = await checkoutAgent.invoke({
    checkoutId,
    attemptNumber,
    amount,
    currency: job.data.currency,
  });

  const decision = result.decision ?? "expire";
  const details = (result.details ?? {}) as Record<string, unknown>;
  const draftedMessage =
    typeof details.message === "string" ? details.message : null;

  // Apply the terminal/progress state locally so the dashboard stays accurate.
  if (decision === "recovered") await markCheckoutStatus(checkoutId, "recovered");
  else if (decision === "expire") await markCheckoutStatus(checkoutId, "expired");
  else if (decision === "escalate") await markCheckoutStatus(checkoutId, "escalated");
  else await markCheckoutStatus(checkoutId, "reminded");

  await db
    .update(recoveryAttempts)
    .set({
      status: "completed",
      action: decision,
      details: { reason: result.reason, ...(result.details ?? {}) },
    })
    .where(eq(recoveryAttempts.id, attemptId));

  let delivery: Awaited<ReturnType<typeof sendRecoveryMessage>> | null = null;
  if (
    draftedMessage &&
    (decision === "remind" || decision === "escalate") &&
    checkout.email
  ) {
    let message = details.message as string;
    if (checkout.shortUrl) {
      message = `${message}\n\nComplete your purchase here: ${checkout.shortUrl}`;
      details.message = message;
    }
    delivery = await sendRecoveryMessage({
      domain: "checkout",
      ownerId: checkoutId,
      recoveryAttemptId: attemptId,
      toEmail: checkout.email,
      message,
    });
  }

  let escalationId: string | null = null;
  if (decision === "escalate") {
    escalationId = await fileDomainEscalation(
      "checkout",
      checkoutId,
      typeof result.reason === "string"
        ? result.reason
        : "checkout final escalation"
    );
  }

  await db.insert(auditLedger).values({
    recoveryAttemptId: attemptId,
    action: decision,
    amount,
    metadata: {
      ...details,
      reason: result.reason,
      checkout: { razorpayOrderId: checkout.razorpayOrderId },
      ...(delivery
        ? {
            delivery: {
              channel: delivery.channel,
              status: delivery.status,
              error: delivery.error ?? null,
            },
          }
        : null),
      ...(escalationId ? { escalation: { id: escalationId } } : null),
    },
  });
}

/**
 * File a human escalation without failing the job: escalation filing must
 * never break recovery processing, so errors are logged and swallowed.
 */
async function fileDomainEscalation(
  domain: "subscription" | "checkout" | "receivable",
  ownerId: string,
  reason: string
): Promise<string | null> {
  try {
    return await fileEscalation({ domain, ownerId, reason });
  } catch (err) {
    console.error(`Failed to file escalation for ${domain} ${ownerId}:`, err);
    return null;
  }
}

async function markPromiseStatus(promiseId: string, status: string) {
  await db
    .update(paymentPromises)
    .set({ status })
    .where(eq(paymentPromises.id, promiseId));
}

async function processReceivableJob(job: Job<RecoveryJobData>) {
  const { ownerId: invoiceId, attemptNumber, amount } = job.data;

  // Same claim guard as the other domains: only pending attempts run.
  const [attempt] = await db
    .update(recoveryAttempts)
    .set({ status: "in_progress" })
    .where(
      and(
        eq(recoveryAttempts.id, job.id ?? ""),
        eq(recoveryAttempts.status, "pending")
      )
    )
    .returning({ id: recoveryAttempts.id });

  if (!attempt) {
    console.log(`Recovery job ${job.id} already handled; skipping.`);
    return;
  }

  const attemptId = attempt.id;

  const [invoice] = await db
    .select()
    .from(receivableInvoices)
    .where(eq(receivableInvoices.id, invoiceId));

  if (!invoice) {
    await db
      .update(recoveryAttempts)
      .set({
        status: "completed",
        action: "no-op",
        details: { reason: "invoice not found" },
      })
      .where(eq(recoveryAttempts.id, attemptId));
    await db.insert(auditLedger).values({
      recoveryAttemptId: attemptId,
      action: "no-op",
      amount,
      metadata: { reason: "invoice not found" },
    });
    return;
  }

  const result = await receivableAgent.invoke({
    invoiceId,
    attemptNumber,
    amount,
    currency: job.data.currency,
  });

  const decision = result.decision ?? "no-op";
  const details = (result.details ?? {}) as Record<string, unknown>;
  const draftedMessage =
    typeof details.message === "string" ? details.message : null;

  // Apply local state transitions so the dashboard stays accurate.
  if (decision === "paid") {
    await db
      .update(receivableInvoices)
      .set({ status: "paid", updatedAt: new Date() })
      .where(eq(receivableInvoices.id, invoiceId));
  } else if (decision === "breach") {
    await db
      .update(receivableInvoices)
      .set({ status: "breached", updatedAt: new Date() })
      .where(eq(receivableInvoices.id, invoiceId));
    if (typeof details.promiseId === "string") {
      await markPromiseStatus(details.promiseId, "breached");
    }
  }

  await db
    .update(recoveryAttempts)
    .set({
      status: "completed",
      action: decision,
      details: { reason: result.reason, ...(result.details ?? {}) },
    })
    .where(eq(recoveryAttempts.id, attemptId));

  let delivery: Awaited<ReturnType<typeof sendRecoveryMessage>> | null = null;
  if (
    draftedMessage &&
    (decision === "remind" || decision === "escalate" || decision === "breach") &&
    invoice.customerEmail
  ) {
    delivery = await sendRecoveryMessage({
      domain: "receivable",
      ownerId: invoiceId,
      recoveryAttemptId: attemptId,
      toEmail: invoice.customerEmail,
      message: details.message as string,
    });
  }

  let escalationId: string | null = null;
  if (decision === "breach" || decision === "escalate") {
    escalationId = await fileDomainEscalation(
      "receivable",
      invoiceId,
      typeof result.reason === "string"
        ? result.reason
        : "receivable escalation"
    );
  }

  await db.insert(auditLedger).values({
    recoveryAttemptId: attemptId,
    action: decision,
    amount,
    metadata: {
      ...details,
      reason: result.reason,
      invoice: { externalId: invoice.externalId },
      ...(delivery
        ? {
            delivery: {
              channel: delivery.channel,
              status: delivery.status,
              error: delivery.error ?? null,
            },
          }
        : null),
      ...(escalationId ? { escalation: { id: escalationId } } : null),
    },
  });
}

async function processSubscriptionJob(job: Job<RecoveryJobData>) {
  const { ownerId: subscriptionId, attemptNumber, amount } = job.data;

  // Claim guard: only a pending attempt may be claimed. If a prior run
  // (or the startup sweep) already completed/failed it, exit without
  // side effects so crash-restart redelivery is safe.
  const [attempt] = await db
    .update(recoveryAttempts)
    .set({ status: "in_progress" })
    .where(
      and(
        eq(recoveryAttempts.id, job.id ?? ""),
        eq(recoveryAttempts.status, "pending")
      )
    )
    .returning({ id: recoveryAttempts.id });

  if (!attempt) {
    console.log(`Recovery job ${job.id} already handled; skipping.`);
    return;
  }

  const attemptId = attempt.id;

  const result = await executeRecoveryAction({
    subscriptionId,
    attemptNumber,
    amount,
    currency: job.data.currency,
  });

  await db
    .update(recoveryAttempts)
    .set({
      // Terminal decisions ran as decided — record them as completed so
      // they count toward the retry cap and don't render as failures.
      // Only genuine errors are "failed".
      status:
        result.success || TERMINAL_ACTIONS.includes(result.action)
          ? "completed"
          : "failed",
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
      domain: "subscription",
      ownerId: subscriptionId,
      recoveryAttemptId: attemptId,
      toEmail,
      message: details.message as string,
    });
  }

  let escalationId: string | null = null;
  if (result.action === "escalate") {
    escalationId = await fileDomainEscalation(
      "subscription",
      subscriptionId,
      typeof details.reason === "string"
        ? details.reason
        : "subscription escalation"
    );
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
    ...(escalationId ? { escalation: { id: escalationId } } : null),
  };

  await db.insert(auditLedger).values({
    recoveryAttemptId: attemptId,
    action: result.action,
    amount,
    metadata: auditMetadata,
  });
}

const worker = new Worker<RecoveryJobData>(
  "recovery",
  async (job) => {
    try {
      await processRecoveryJob(job);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "unknown worker error";
      console.error(`Recovery job ${job.id} crashed:`, err);
      // Best-effort deterministic failure record so the attempt never
      // sticks at in_progress and the audit trail stays complete
      // even when the job body throws.
      try {
        await db
          .update(recoveryAttempts)
          .set({ status: "failed", details: { error: message } })
          .where(eq(recoveryAttempts.id, job.id ?? ""));
        await db.insert(auditLedger).values({
          recoveryAttemptId: job.id ?? "",
          action: "error",
          amount: job.data.amount,
          metadata: { error: message },
        });
      } catch (recordErr) {
        console.error(
          `Failed to record crash for job ${job.id}:`,
          recordErr
        );
      }
      throw err;
    }
  },
  { connection }
);

export function startWorker(): Worker<RecoveryJobData> {
  worker.on("failed", (job, err) => {
    console.error(`Recovery job ${job?.id} failed:`, err);
  });
  return worker;
}

export async function closeWorker(): Promise<void> {
  await worker.close();
}
