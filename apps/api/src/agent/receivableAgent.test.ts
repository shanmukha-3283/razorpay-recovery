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
            orderBy: () => ({
              limit: async () => rows,
            }),
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

import { receivableAgent } from "./receivableAgent.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: "inv_1",
    attemptNumber: 1,
    amount: 50000,
    currency: "INR",
    ...overrides,
  } as any;
}

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_1",
    externalId: "INV-001",
    customerEmail: "ap@example.com",
    status: "overdue",
    dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe("receivableAgent", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    classifyFailure.mockReset();
    draftMessage.mockReset();
    classifyFailure.mockResolvedValue(null);
    draftMessage.mockResolvedValue(null);
  });

  it("returns no-op when the invoice does not exist", async () => {
    selectQueue.rows = [[]];

    const result = await receivableAgent.invoke(input());

    expect(result.decision).toBe("no-op");
  });

  it("returns paid when already paid", async () => {
    selectQueue.rows = [[invoiceRow({ status: "paid" })]];

    const result = await receivableAgent.invoke(input());

    expect(result.decision).toBe("paid");
  });

  it("awaits an active future promise quietly", async () => {
    selectQueue.rows = [
      [invoiceRow({ status: "promised" })],
      [
        {
          id: "prom_1",
          promisedDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          status: "open",
        },
      ],
    ];

    const result = await receivableAgent.invoke(input());

    expect(result.decision).toBe("await");
  });

  it("breaches a past-due open promise", async () => {
    selectQueue.rows = [
      [invoiceRow({ status: "promised" })],
      [
        {
          id: "prom_1",
          promisedDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          status: "open",
        },
      ],
    ];

    const result = await receivableAgent.invoke(input());

    expect(result.decision).toBe("breach");
    expect((result.details as any).promiseId).toBe("prom_1");
  });

  it("climbs the ladder: remind first, escalate on attempt 4", async () => {
    selectQueue.rows = [[invoiceRow()], []];
    const first = await receivableAgent.invoke(input({ attemptNumber: 1 }));
    expect(first.decision).toBe("remind");
    expect(first.reason).toMatch(/polite/);

    selectQueue.rows = [[invoiceRow()], []];
    const last = await receivableAgent.invoke(input({ attemptNumber: 4 }));
    expect(last.decision).toBe("escalate");
  });

  it("maps an LLM halt hint to final escalation", async () => {
    selectQueue.rows = [[invoiceRow()], []];
    classifyFailure.mockResolvedValue({
      failureCategory: "other",
      recoveryHint: "halt",
      confidence: 0.85,
      message: "Escalate now.",
    });

    const result = await receivableAgent.invoke(input({ attemptNumber: 1 }));

    expect(result.decision).toBe("escalate");
    expect((result.details as any).message).toBe("Escalate now.");
  });
});
