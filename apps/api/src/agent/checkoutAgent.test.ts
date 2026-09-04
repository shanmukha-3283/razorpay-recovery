import { describe, expect, it, vi, beforeEach } from "vitest";

const selectQueue = vi.hoisted(() => ({ rows: [] as any[][] }));
const classifyFailure = vi.hoisted(() => vi.fn());
const draftMessage = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectQueue.rows.shift() ?? [];
          const chain: any = {
            limit: async () => rows,
          };
          chain.then = (resolve: any) => Promise.resolve(rows).then(resolve);
          return chain;
        },
      }),
    }),
  },
}));

vi.mock("./llmService.js", () => ({
  classifyFailure,
  draftMessage,
}));

import { checkoutAgent } from "./checkoutAgent.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    checkoutId: "co_1",
    attemptNumber: 1,
    amount: 24900,
    currency: "INR",
    ...overrides,
  } as any;
}

function checkoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "co_1",
    razorpayOrderId: "order_9",
    email: "buyer@example.com",
    status: "abandoned",
    ...overrides,
  };
}

describe("checkoutAgent", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    classifyFailure.mockReset();
    draftMessage.mockReset();
    classifyFailure.mockResolvedValue(null);
    draftMessage.mockResolvedValue(null);
  });

  it("returns no-op when the checkout does not exist", async () => {
    selectQueue.rows = [[]];

    const result = await checkoutAgent.invoke(input());

    expect(result.decision).toBe("no-op");
  });

  it("returns recovered when payment was captured after abandonment", async () => {
    selectQueue.rows = [[checkoutRow()], [{ id: "pay_1" }]];

    const result = await checkoutAgent.invoke(input());

    expect(result.decision).toBe("recovered");
    expect(result.reason).toMatch(/captured/);
  });

  it("reminds on the first attempt with a fallback message", async () => {
    selectQueue.rows = [[checkoutRow()], []];

    const result = await checkoutAgent.invoke(input({ attemptNumber: 1 }));

    expect(result.decision).toBe("remind");
    expect((result.details as any).message).toContain("checkout");
  });

  it("escalates on the second attempt", async () => {
    selectQueue.rows = [[checkoutRow()], []];

    const result = await checkoutAgent.invoke(input({ attemptNumber: 2 }));

    expect(result.decision).toBe("escalate");
  });

  it("expires when there is no customer email", async () => {
    selectQueue.rows = [[checkoutRow({ email: null })], []];

    const result = await checkoutAgent.invoke(input());

    expect(result.decision).toBe("expire");
  });

  it("maps an LLM halt hint onto the checkout flow", async () => {
    selectQueue.rows = [[checkoutRow()], []];
    classifyFailure.mockResolvedValue({
      failureCategory: "other",
      recoveryHint: "halt",
      confidence: 0.9,
      message: "Custom LLM message.",
    });

    const result = await checkoutAgent.invoke(input({ attemptNumber: 1 }));

    expect(result.decision).toBe("remind");
    expect((result.details as any).message).toBe("Custom LLM message.");
  });
});
