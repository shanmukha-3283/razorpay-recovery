import { z } from "zod";
import { getLLM } from "./llm.js";

export const FailureClassificationSchema = z.object({
  failureCategory: z
    .enum([
      "card_declined",
      "insufficient_funds",
      "expired_card",
      "limit_exceeded",
      "technical_error",
      "other",
    ])
    .describe("The category of the payment failure"),
  recoveryHint: z
    .enum(["retry", "adjust_payment_method", "contact_support", "halt"])
    .describe("The suggested recovery action"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence in the classification, 0 to 1"),
  message: z
    .string()
    .describe("Customer-facing recovery message in a warm, helpful tone"),
});

export type FailureClassification = z.infer<typeof FailureClassificationSchema>;

export type ClassifyInput = {
  status: string;
  errorCode?: string | null;
  errorDescription?: string | null;
  amount: number;
  currency: string;
  attemptNumber: number;
};

export async function classifyFailure(
  input: ClassifyInput
): Promise<FailureClassification | null> {
  try {
    const llm = getLLM();
    const structured = llm.withStructuredOutput(FailureClassificationSchema);
    const prompt = `You are a payment-recovery assistant for a subscription business.

Classify the following failed payment and recommend a recovery action.

Subscription status: ${input.status}
Failure error code: ${input.errorCode ?? "none"}
Failure description: ${input.errorDescription ?? "none"}
Amount: ${input.amount} ${input.currency}
Recovery attempt number: ${input.attemptNumber}

Classify the failure and provide a customer-friendly recovery message.`;
    return await structured.invoke(prompt);
  } catch (err) {
    console.error("LLM classify failure error:", err);
    return null;
  }
}

export type DraftInput = {
  decision: string;
  reason?: string;
  amount: number;
  currency: string;
  attemptNumber: number;
};

export async function draftMessage(
  input: DraftInput
): Promise<string | null> {
  try {
    const llm = getLLM();
    const prompt = `You are a payment-recovery assistant for a subscription service.

Draft a short, warm, customer-facing message (2-3 sentences) informing the customer about a failed recurring payment and what will happen next.

Recovery decision: ${input.decision}
Decision reason: ${input.reason ?? "not provided"}
Amount: ${input.amount} ${input.currency}
Attempt number: ${input.attemptNumber}

If the decision is "adjust_payment_method", ask them to update their payment details. If "retry", reassure them we will retry. If "contact_support", invite them to contact support. If "halt", notify them the subscription will pause.`;
    const response = await llm.invoke(prompt);
    if (
      typeof response.content === "string" &&
      response.content.trim().length > 0
    ) {
      return response.content.trim();
    }
    return null;
  } catch (err) {
    console.error("LLM draft message error:", err);
    return null;
  }
}
