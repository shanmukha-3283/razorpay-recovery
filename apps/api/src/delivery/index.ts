import { db } from "../db/index.js";
import { messageDeliveries } from "../db/schema.js";
import type { RecoveryDomain } from "../queue/retryPolicy.js";
import { checkCompliance } from "./compliance.js";
import { sendEmail } from "./email.js";

export type SendRecoveryMessageInput = {
  domain: RecoveryDomain;
  /** Internal owner id: subscription id or abandoned-checkout id. */
  ownerId: string;
  recoveryAttemptId: string;
  toEmail?: string | null;
  message?: string | null;
};

export type DeliveryOutcome = {
  status: "sent" | "failed" | "skipped";
  channel: string;
  error?: string;
};

function createDelivery(
  input: SendRecoveryMessageInput,
  status: DeliveryOutcome["status"],
  extras: { providerMessageId?: string; error?: string } = {}
) {
  return db.insert(messageDeliveries).values({
    domain: input.domain,
    domainId: input.ownerId,
    subscriptionId: input.domain === "subscription" ? input.ownerId : null,
    recoveryAttemptId: input.recoveryAttemptId,
    channel: "email",
    toEmail: input.toEmail,
    status,
    messageBody: input.message ?? "",
    providerMessageId: extras.providerMessageId,
    error: extras.error,
    sentAt: status === "sent" ? new Date() : null,
  });
}

export async function sendRecoveryMessage(
  input: SendRecoveryMessageInput
): Promise<DeliveryOutcome> {
  if (!input.toEmail || !input.message) {
    await createDelivery(input, "skipped", {
      error: !input.toEmail ? "no recipient email" : "no message to send",
    });
    return { status: "skipped", channel: "email" };
  }

  // Normalize once so DND + frequency counts match stored rows.
  const toEmail = input.toEmail.trim().toLowerCase();

  // Compliance gate: violations skip the send but are recorded + audited
  // by the caller, never silently dropped.
  const verdict = await checkCompliance(toEmail);
  if (!verdict.ok) {
    await createDelivery({ ...input, toEmail }, "skipped", {
      error: verdict.reason,
    });
    return { status: "skipped", channel: "email", error: verdict.reason };
  }

  const result = await sendEmail({
    to: toEmail,
    message: input.message,
  });

  if (!result.ok) {
    await createDelivery(input, "failed", { error: result.error });
    return {
      status: "failed",
      channel: "email",
      error: result.error,
    };
  }

  await createDelivery(input, "sent", {
    providerMessageId: result.providerMessageId,
  });
  return { status: "sent", channel: "email" };
}
