import { describe, expect, it, vi, beforeEach } from "vitest";

const selectRows = vi.hoisted(() => ({ queue: [] as any[][] }));
const updateSets = vi.hoisted(() => ({ values: [] as any[] }));
const updateReturning = vi.hoisted(() => ({ queue: [] as any[][] }));
const inserted = vi.hoisted(() => ({ values: [] as any[] }));
const executeRecoveryAction = vi.hoisted(() => vi.fn());
const executeRazorpayAction = vi.hoisted(() => vi.fn());
const sendRecoveryMessage = vi.hoisted(() => vi.fn());
const checkoutInvoke = vi.hoisted(() => vi.fn());
const receivableInvoke = vi.hoisted(() => vi.fn());
const fileEscalation = vi.hoisted(() => vi.fn(async () => "esc_1"));

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
vi.mock("../agent/checkoutAgent.js", () => ({
  checkoutAgent: { invoke: checkoutInvoke },
}));
vi.mock("../agent/receivableAgent.js", () => ({
  receivableAgent: { invoke: receivableInvoke },
}));
vi.mock("../escalations.js", () => ({
  fileEscalation,
  checkSlaBreaches: vi.fn(),
  isSlaBreached: vi.fn(),
}));
vi.mock("../delivery/index.js", () => ({ sendRecoveryMessage }));

import { processRecoveryJob } from "./worker.js";

function job() {
  return {
    id: "attempt_1",
    data: {
      domain: "subscription",
      ownerId: "sub_1",
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
    fileEscalation.mockReset();
    fileEscalation.mockResolvedValue("esc_1");
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

  it("files an escalation on escalate decisions and audits it", async () => {
    updateReturning.queue = [[{ id: "attempt_1" }]];
    executeRecoveryAction.mockResolvedValue({
      action: "escalate",
      success: true,
      details: {
        reason: "LLM recommended human support",
        message: "Support will contact you.",
      },
    });
    selectRows.queue = [
      [{ razorpaySubscriptionId: "sub_rzp_1" }],
      [{ invoiceId: null }],
      [{ customerId: "cus_1" }],
      [{ email: "user@example.com" }],
    ];
    sendRecoveryMessage.mockResolvedValue({
      status: "sent",
      channel: "email",
    });

    await processRecoveryJob(job());

    expect(fileEscalation).toHaveBeenCalledWith({
      domain: "subscription",
      ownerId: "sub_1",
      reason: "LLM recommended human support",
    });
    const audit = inserted.values.find(
      (v) => v.recoveryAttemptId === "attempt_1"
    );
    expect(audit).toMatchObject({ action: "escalate" });
    expect((audit.metadata as any).escalation).toEqual({ id: "esc_1" });
  });
});

describe("processRecoveryJob / checkout domain", () => {
  function checkoutJob() {
    return {
      id: "attempt_co_1",
      data: {
        domain: "checkout",
        ownerId: "co_1",
        attemptNumber: 1,
        amount: 24900,
        currency: "INR",
      },
    } as any;
  }

  beforeEach(() => {
    selectRows.queue = [];
    updateSets.values = [];
    updateReturning.queue = [];
    inserted.values = [];
    checkoutInvoke.mockReset();
    sendRecoveryMessage.mockReset();
    sendRecoveryMessage.mockResolvedValue({ status: "sent", channel: "email" });
    fileEscalation.mockReset();
    fileEscalation.mockResolvedValue("esc_9");
  });

  it("sends a reminder with the pay link and marks reminded", async () => {
    updateReturning.queue = [[{ id: "attempt_co_1" }]];
    selectRows.queue = [
      [
        {
          id: "co_1",
          razorpayOrderId: "order_9",
          email: "buyer@example.com",
          shortUrl: "https://rzp.io/x/pay9",
          status: "abandoned",
        },
      ],
    ];
    checkoutInvoke.mockResolvedValue({
      decision: "remind",
      reason: "first payment-link reminder",
      details: { message: "You left items behind." },
    });

    await processRecoveryJob(checkoutJob());

    const attemptUpdate = updateSets.values.find(
      (s) => "action" in s && s.action === "remind"
    );
    expect(attemptUpdate).toMatchObject({
      status: "completed",
      action: "remind",
    });
    expect(
      updateSets.values.find((s) => s.status === "reminded")
    ).toBeDefined();
    expect(sendRecoveryMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "checkout",
        ownerId: "co_1",
        recoveryAttemptId: "attempt_co_1",
        toEmail: "buyer@example.com",
      })
    );
    const sentMessage = sendRecoveryMessage.mock.calls[0][0].message as string;
    expect(sentMessage).toContain("https://rzp.io/x/pay9");
    expect(
      inserted.values.find((v) => v.recoveryAttemptId === "attempt_co_1")
    ).toMatchObject({ action: "remind", amount: 24900 });
  });

  it("applies recovered terminal state without emailing", async () => {
    updateReturning.queue = [[{ id: "attempt_co_1" }]];
    selectRows.queue = [
      [
        {
          id: "co_1",
          razorpayOrderId: "order_9",
          email: "buyer@example.com",
          shortUrl: null,
          status: "abandoned",
        },
      ],
    ];
    checkoutInvoke.mockResolvedValue({
      decision: "recovered",
      reason: "payment captured after abandonment",
      details: {},
    });

    await processRecoveryJob(checkoutJob());

    const attemptUpdate = updateSets.values.find(
      (s) => "action" in s && s.action === "recovered"
    );
    expect(attemptUpdate).toMatchObject({ status: "completed" });
    expect(
      updateSets.values.find((s) => s.status === "recovered")
    ).toBeDefined();
    expect(sendRecoveryMessage).not.toHaveBeenCalled();
  });

  it("records no-op when the checkout row is gone", async () => {
    updateReturning.queue = [[{ id: "attempt_co_1" }]];
    selectRows.queue = [[]];

    await processRecoveryJob(checkoutJob());

    expect(checkoutInvoke).not.toHaveBeenCalled();
    const attemptUpdate = updateSets.values.find(
      (s) => "action" in s && s.action === "no-op"
    );
    expect(attemptUpdate).toMatchObject({ status: "completed" });
  });

  it("files an escalation on escalate decisions", async () => {
    updateReturning.queue = [[{ id: "attempt_co_1" }]];
    selectRows.queue = [
      [
        {
          id: "co_1",
          razorpayOrderId: "order_9",
          email: "buyer@example.com",
          shortUrl: null,
          status: "abandoned",
        },
      ],
    ];
    checkoutInvoke.mockResolvedValue({
      decision: "escalate",
      reason: "final escalation",
      details: { message: "Contact support." },
    });

    await processRecoveryJob(checkoutJob());

    expect(fileEscalation).toHaveBeenCalledWith({
      domain: "checkout",
      ownerId: "co_1",
      reason: "final escalation",
    });
    const audit = inserted.values.find(
      (v) => v.recoveryAttemptId === "attempt_co_1"
    );
    expect((audit.metadata as any).escalation).toEqual({ id: "esc_9" });
  });
});

describe("processRecoveryJob / receivable domain", () => {
  function receivableJob() {
    return {
      id: "attempt_inv_1",
      data: {
        domain: "receivable",
        ownerId: "inv_1",
        attemptNumber: 1,
        amount: 50000,
        currency: "INR",
      },
    } as any;
  }

  function invoiceRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "inv_1",
      externalId: "INV-001",
      customerEmail: "ap@example.com",
      status: "overdue",
      ...overrides,
    };
  }

  beforeEach(() => {
    selectRows.queue = [];
    updateSets.values = [];
    updateReturning.queue = [];
    inserted.values = [];
    receivableInvoke.mockReset();
    sendRecoveryMessage.mockReset();
    sendRecoveryMessage.mockResolvedValue({ status: "sent", channel: "email" });
    fileEscalation.mockReset();
    fileEscalation.mockResolvedValue("esc_9");
  });

  it("sends a band-toned reminder and completes", async () => {
    updateReturning.queue = [[{ id: "attempt_inv_1" }]];
    selectRows.queue = [[invoiceRow()]];
    receivableInvoke.mockResolvedValue({
      decision: "remind",
      reason: "polite first reminder",
      details: { message: "Please pay.", daysOverdue: 5 },
    });

    await processRecoveryJob(receivableJob());

    const attemptUpdate = updateSets.values.find(
      (s) => "action" in s && s.action === "remind"
    );
    expect(attemptUpdate).toMatchObject({ status: "completed" });
    expect(sendRecoveryMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "receivable",
        ownerId: "inv_1",
        recoveryAttemptId: "attempt_inv_1",
        toEmail: "ap@example.com",
      })
    );
    expect(
      inserted.values.find((v) => v.recoveryAttemptId === "attempt_inv_1")
    ).toMatchObject({ action: "remind", amount: 50000 });
  });

  it("marks a breached promise and the invoice on breach", async () => {
    updateReturning.queue = [[{ id: "attempt_inv_1" }]];
    selectRows.queue = [[invoiceRow()]];
    receivableInvoke.mockResolvedValue({
      decision: "breach",
      reason: "promise breached",
      details: { message: "Pay now.", promiseId: "prom_1" },
    });

    await processRecoveryJob(receivableJob());

    expect(
      updateSets.values.find((s) => s.status === "breached")
    ).toBeDefined();
    // The promise flip carries no updatedAt (invoice update does).
    expect(
      updateSets.values.find(
        (s) => s.status === "breached" && !("updatedAt" in s)
      )
    ).toBeDefined();
    // Promise flip targets the promise id specifically.
    expect(sendRecoveryMessage).toHaveBeenCalledTimes(1);
    expect(fileEscalation).toHaveBeenCalledWith({
      domain: "receivable",
      ownerId: "inv_1",
      reason: "promise breached",
    });
  });

  it("records no-op when the invoice row is gone", async () => {
    updateReturning.queue = [[{ id: "attempt_inv_1" }]];
    selectRows.queue = [[]];

    await processRecoveryJob(receivableJob());

    expect(receivableInvoke).not.toHaveBeenCalled();
    const attemptUpdate = updateSets.values.find(
      (s) => "action" in s && s.action === "no-op"
    );
    expect(attemptUpdate).toMatchObject({ status: "completed" });
  });
});
