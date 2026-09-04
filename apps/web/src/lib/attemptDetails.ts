/**
 * Extracts AI-reasoning display fields from recovery-attempt `details`
 * (or audit-ledger `metadata`) JSON blobs. All fields are optional —
 * pre-LLM rows and non-classified decisions simply yield nulls.
 */
export type AttemptInsight = {
  failureCategory: string | null;
  reason: string | null;
  message: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function getAttemptInsight(details: unknown): AttemptInsight {
  const d = asRecord(details);
  return {
    failureCategory: asString(d.failureCategory),
    reason: asString(d.reason),
    message: asString(d.message),
  };
}

/** One-line human summary for audit metadata (reason + provider outcome). */
export function getAuditSummary(metadata: unknown): string | null {
  const m = asRecord(metadata);
  const parts: string[] = [];
  const reason = asString(m.reason);
  if (reason) parts.push(reason);
  const rz = asRecord(m.razorpay);
  const action = asString(rz.action);
  if (action) {
    parts.push(
      `${action} ${rz.success === true ? "succeeded" : rz.success === false ? "failed" : ""}`.trim()
    );
  }
  const delivery = asRecord(m.delivery);
  const dStatus = asString(delivery.status);
  if (dStatus) parts.push(`email ${dStatus}`);
  const esc = asRecord(m.escalation);
  if (asString(esc.id)) parts.push("escalated for human review");
  return parts.length > 0 ? parts.join(" · ") : null;
}
