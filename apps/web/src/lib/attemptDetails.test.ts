import { describe, expect, it } from "vitest";
import { getAttemptInsight, getAuditSummary } from "./attemptDetails";

describe("getAttemptInsight", () => {
  it("extracts category, reason, and message", () => {
    expect(
      getAttemptInsight({
        failureCategory: "card_declined",
        reason: "default recovery action",
        message: "Please pay.",
      })
    ).toEqual({
      failureCategory: "card_declined",
      reason: "default recovery action",
      message: "Please pay.",
    });
  });

  it("returns nulls for missing, null, or non-object input", () => {
    expect(getAttemptInsight(null)).toEqual({
      failureCategory: null,
      reason: null,
      message: null,
    });
    expect(getAttemptInsight("oops")).toEqual({
      failureCategory: null,
      reason: null,
      message: null,
    });
    expect(getAttemptInsight({})).toEqual({
      failureCategory: null,
      reason: null,
      message: null,
    });
  });

  it("treats blank strings as absent", () => {
    expect(
      getAttemptInsight({ failureCategory: "  ", reason: "", message: 42 })
    ).toEqual({ failureCategory: null, reason: null, message: null });
  });
});

describe("getAuditSummary", () => {
  it("summarizes reason + provider + delivery + escalation", () => {
    expect(
      getAuditSummary({
        reason: "first payment-link reminder",
        razorpay: { action: "razorpay.retry", success: true },
        delivery: { status: "sent" },
        escalation: { id: "esc_1" },
      })
    ).toBe(
      "first payment-link reminder · razorpay.retry succeeded · email sent · escalated for human review"
    );
  });

  it("marks failed provider actions", () => {
    expect(
      getAuditSummary({ razorpay: { action: "razorpay.noop", success: false } })
    ).toBe("razorpay.noop failed");
  });

  it("returns null when there is nothing to summarize", () => {
    expect(getAuditSummary(null)).toBe(null);
    expect(getAuditSummary({})).toBe(null);
  });
});
