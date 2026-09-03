import { db } from "../db/index.js";
import { messageDeliveries } from "../db/schema.js";
import { sendEmail } from "./email.js";

export type SendRecoveryMessageInput = {
  subscriptionId: string;
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
    subscriptionId: input.subscriptionId,
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

  const result = await sendEmail({
    to: input.toEmail,
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
