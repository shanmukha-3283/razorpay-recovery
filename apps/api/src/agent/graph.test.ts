import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [],
      }),
    }),
  },
}));

import { decideAction } from "./graph.js";
import { MAX_ATTEMPTS } from "../queue/retryPolicy.js";

function state(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionId: "sub_1",
    attemptNumber: 1,
    amount: 1000,
    currency: "INR",
    status: "active",
    decision: "",
    reason: "",
    details: {},
    errorCode: "",
    errorDescription: "",
    classification: null,
    ...overrides,
  } as any;
}

function classification(hint: string) {
  return {
    failureCategory: "other",
    recoveryHint: hint,
    confidence: 0.9,
    message: "msg",
  } as any;
}

describe("decideAction", () => {
  it("halts at max attempts regardless of hints", async () => {
    const out = await decideAction(
      state({ attemptNumber: MAX_ATTEMPTS, classification: classification("retry") })
    );
    expect(out.decision).toBe("halt");
  });

  it("maps an LLM halt hint to halt", async () => {
    const out = await decideAction(
      state({ classification: classification("halt") })
    );
    expect(out.decision).toBe("halt");
  });

  it("maps an LLM adjust hint to adjust", async () => {
    const out = await decideAction(
      state({ classification: classification("adjust_payment_method") })
    );
    expect(out.decision).toBe("adjust");
  });

  it("maps an LLM contact_support hint to escalate", async () => {
    const out = await decideAction(
      state({ classification: classification("contact_support") })
    );
    expect(out.decision).toBe("escalate");
    expect(out.reason).toMatch(/support/);
  });

  it("retries by default and adjusts after a completed retry", async () => {
    const first = await decideAction(state());
    expect(first.decision).toBe("retry");

    const second = await decideAction(
      state({
        details: { priorAttempts: [{ action: "retry", status: "completed" }] },
      })
    );
    expect(second.decision).toBe("adjust");
  });
});
