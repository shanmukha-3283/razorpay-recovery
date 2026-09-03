import { recoveryAgent } from "../agent/graph.js";

export type RecoveryActionInput = {
  subscriptionId: string;
  attemptNumber: number;
  amount: number;
  currency: string;
};

export type RecoveryActionResult = {
  action: string;
  success: boolean;
  details?: Record<string, unknown>;
};

export async function executeRecoveryAction(
  input: RecoveryActionInput
): Promise<RecoveryActionResult> {
  if (!input.subscriptionId) {
    return {
      action: "no-op",
      success: true,
      details: { note: "no subscription id provided" },
    };
  }

  const result = await recoveryAgent.invoke({
    subscriptionId: input.subscriptionId,
    attemptNumber: input.attemptNumber,
    amount: input.amount,
    currency: input.currency,
  });

  const decision = result.decision ?? "no-op";
  const isTerminal = decision === "halt" || decision === "no-op";

  return {
    action: decision,
    success: !isTerminal,
    details: {
      reason: result.reason,
      status: result.status,
      ...(result.details ?? {}),
    },
  };
}
