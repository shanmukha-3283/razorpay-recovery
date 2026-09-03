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
  _input: RecoveryActionInput
): Promise<RecoveryActionResult> {
  return {
    action: "recovery_attempt",
    success: true,
    details: { note: "stub - LangGraph agent will decide actual recovery action" },
  };
}
