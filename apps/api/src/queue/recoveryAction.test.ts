import { describe, expect, it, vi, beforeEach } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("../agent/graph.js", () => ({
  recoveryAgent: { invoke },
}));

import { executeRecoveryAction } from "./recoveryAction.js";

describe("executeRecoveryAction", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("returns no-op without invoking the agent when subscriptionId is empty", async () => {
    const result = await executeRecoveryAction({
      subscriptionId: "",
      attemptNumber: 1,
      amount: 1000,
      currency: "INR",
    });

    expect(result.action).toBe("no-op");
    expect(result.success).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("propagates a retry decision as a successful non-terminal action", async () => {
    invoke.mockResolvedValue({
      decision: "retry",
      reason: "failed payment",
      status: "active",
      details: { note: "hello" },
    });

    const result = await executeRecoveryAction({
      subscriptionId: "sub_1",
      attemptNumber: 1,
      amount: 1000,
      currency: "INR",
    });

    expect(result.action).toBe("retry");
    expect(result.success).toBe(true);
    expect(result.details?.reason).toBe("failed payment");
    expect(result.details?.note).toBe("hello");
    expect(invoke).toHaveBeenCalledWith({
      subscriptionId: "sub_1",
      attemptNumber: 1,
      amount: 1000,
      currency: "INR",
    });
  });

  it("treats halt and no-op as terminal (non-successful) actions", async () => {
    for (const decision of ["halt", "no-op"]) {
      invoke.mockResolvedValue({
        decision,
        reason: "terminal",
        status: "active",
      });

      const result = await executeRecoveryAction({
        subscriptionId: "sub_1",
        attemptNumber: 2,
        amount: 1000,
        currency: "INR",
      });

      expect(result.action).toBe(decision);
      expect(result.success).toBe(false);
    }
  });
});
