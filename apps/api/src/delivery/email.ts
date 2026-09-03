import { Resend } from "resend";

export type EmailSendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

export type SendEmailInput = {
  to: string;
  message: string;
  subject?: string;
};

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.DELIVERY_FROM_EMAIL;

export async function sendEmail(
  input: SendEmailInput
): Promise<EmailSendResult> {
  if (!apiKey || !from) {
    return {
      ok: false,
      error: apiKey
        ? "DELIVERY_FROM_EMAIL not configured"
        : "no provider configured (RESEND_API_KEY missing)",
    };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [input.to],
      subject: input.subject ?? "Action needed on your subscription",
      text: input.message,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, providerMessageId: data?.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown email error",
    };
  }
}
