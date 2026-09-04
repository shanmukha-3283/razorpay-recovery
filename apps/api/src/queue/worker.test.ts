import { describe, expect, it, vi, beforeEach } from "vitest";

const selectRows = vi.hoisted(() => ({ queue: [] as any[][] }));
const updateSets = vi.hoisted(() => ({ values: [] as any[] }));
const updateReturning = vi.hoisted(() => ({ queue: [] as any[][] }));
const inserted = vi.hoisted(() => ({ values: [] as any[] }));
const executeRecoveryAction = vi.hoisted(() => vi.fn());
const executeRazorpayAction = vi.hoisted(() => vi.fn());
const sendRecoveryMessage = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectRows.queue.shift() ?? [];
          const chain: any = {
            orderBy: () => ({ limit: async () => rows }),
          };
          chain.then = (resolve: any) => Promise.resolve(rows).then(resolve);
          return chain;
        },
      }),
    }),
    update: () => ({
      set: (s: any) => {
        updateSets.values.push(s);
        return {
          where: () => ({
            returning: async () => updateReturning.queue.shift() ?? [],
          }),
        };
      },
    }),
    insert: () => ({
      values: async (v: any) => {
        inserted.values.push(v);
        return [];
      },
    }),
  },
}));

vi.mock("./connection.js", () => ({ connection: {} }));
vi.mock("./index.js", () => ({
  recoveryQueue: { add: vi.fn() },
  closeQueue: vi.fn(),
}));
vi.mock("./recoveryAction.js", () => ({ executeRecoveryAction }));
vi.mock("../razorpay/actions.js", () => ({ executeRazorpayAction }));
vi.mock("../delivery/index.js", () => ({ sendRecoveryMessage }));

import { processRecoveryJob } from "./worker.js";

function job() {
  return {
    id: "attempt_1",
    data: {
      subscriptionId: "sub_1",
      attemptNumber: 1,
      amount: 24900,
      currency: "INR",
    },
  } as any;
}

describe("processRecoveryJob", () => {
  beforeEach(() => {
    selectRows.queue = [];
    updateSets.values = [];
    updateReturning.queue = [];
    inserted.values = [];
    executeRecoveryAction.mockReset();
    executeRazorpayAction.mockReset();
    sendRecoveryMessage.mockReset();
  });

  it("records a deliberate halt as completed (not failed)", async () => {
    updateReturning.queue = [[{ id: "attempt_1" }]];
    executeRecoveryAction.mockResolvedValue({
      action: "halt",
      success: false,
      details: { reason: "terminal" },
    });
    // sub lookup, latest payment
    selectRows.queue = [
      [{ razorpaySubscriptionId: "sub_rzp_1" }],
      [{ invoiceId: null }],
    ];
    executeRazorpayAction.mockResolvedValue({
      action: "razorpay.halt",
      success: true,
      providerStatus: "paused",
      shortUrl: null,
      error: null,
    });

    await processRecoveryJob(job());

    const attemptUpdate = updateSets.values.find(
      (s) => "action" in s && s.action === "halt"
    );
    expect(attemptUpdate).toMatchObject({
      status: "completed",
      action: "halt",
    });
    // halt sends no email
    expect(sendRecoveryMessage).not.toHaveBeenCalled();
    // audit row still written
    expect(
      inserted.values.find((v) => v.recoveryAttemptId === "attempt_1")
    ).toMatchObject({ action: "halt", amount: 24900 });
  });

  it("records a failed retry as failed", async () => {
    updateReturning.queue = [[{ id: "attempt_1" }]];
    executeRecoveryAction.mockResolvedValue({
      action: "retry",
      success: false,
      details: { reason: "still failing" },
    });
    selectRows.queue = [
      [{ razorpaySubscriptionId: "sub_rzp_1" }],
      [{ invoiceId: null }],
    ];
    executeRazorpayAction.mockResolvedValue({
      action: "razorpay.retry",
      success: false,
      providerStatus: null,
      shortUrl: null,
      error: "no issuable invoice",
    });

    await processRecoveryJob(job());

    const attemptUpdate = updateSets.values.find(
      (s) => "action" in s && s.action === "retry"
    );
    expect(attemptUpdate).toMatchObject({
      status: "failed",
      action: "retry",
    });
  });

  it("skips without side effects when the attempt was already handled", async () => {
    // Claim finds no pending row (already completed/failed or swept).
    updateReturning.queue = [[]];

    await processRecoveryJob(job());

    expect(executeRecoveryAction).not.toHaveBeenCalled();
    expect(executeRazorpayAction).not.toHaveBeenCalled();
    expect(inserted.values).toHaveLength(0);
  });
});
