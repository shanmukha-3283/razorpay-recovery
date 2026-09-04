import { describe, expect, it, vi, beforeEach } from "vitest";

const statusRow = vi.hoisted(() => ({ value: [] as any[] }));
const decideRecovery = vi.hoisted(() => vi.fn());
const queueAdd = vi.hoisted(() => vi.fn());
const inserted = vi.hoisted(() => ({ values: [] as any[] }));

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => statusRow.value,
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        inserted.values.push(v);
        return {
          returning: async () => [{ id: "attempt_1" }],
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => [],
      }),
    }),
  },
}));

vi.mock("./retryPolicy.js", () => ({
  decideRecovery,
  MAX_ATTEMPTS: 3,
}));

vi.mock("./index.js", () => ({
  recoveryQueue: { add: queueAdd },
  closeQueue: vi.fn(),
}));

import { scheduleRecovery } from "./scheduler.js";

describe("scheduleRecovery terminal guard", () => {
  beforeEach(() => {
    statusRow.value = [];
    inserted.values = [];
    decideRecovery.mockReset();
    queueAdd.mockReset();
  });

  it("does not schedule when the subscription is halted", async () => {
    statusRow.value = [{ status: "halted" }];

    const decision = await scheduleRecovery({
      domain: "subscription",
      ownerId: "sub_1",
      amount: 1000,
      currency: "INR",
    });

    expect(decision).toEqual({
      allowed: false,
      attemptNumber: 3,
      scheduledFor: null,
      reason: "cap_reached",
    });
    expect(decideRecovery).not.toHaveBeenCalled();
    expect(inserted.values).toHaveLength(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("does not schedule when the subscription is cancelled", async () => {
    statusRow.value = [{ status: "cancelled" }];

    const decision = await scheduleRecovery({
      domain: "subscription",
      ownerId: "sub_1",
      amount: 1000,
      currency: "INR",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cap_reached");
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("schedules normally for an active subscription", async () => {
    statusRow.value = [{ status: "active" }];
    const scheduledFor = new Date(Date.now() + 3600_000);
    decideRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 1,
      scheduledFor,
      reason: "scheduled",
    });
    queueAdd.mockResolvedValue({});

    const decision = await scheduleRecovery({
      domain: "subscription",
      ownerId: "sub_1",
      amount: 1000,
      currency: "INR",
    });

    expect(decision.allowed).toBe(true);
    expect(inserted.values).toHaveLength(1);
    expect(inserted.values[0]).toMatchObject({
      subscriptionId: "sub_1",
      attemptNumber: 1,
      status: "pending",
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when the checkout is recovered", async () => {
    statusRow.value = [{ status: "recovered" }];

    const decision = await scheduleRecovery({
      domain: "checkout",
      ownerId: "co_1",
      amount: 24900,
      currency: "INR",
    });

    expect(decision).toEqual({
      allowed: false,
      attemptNumber: 2,
      scheduledFor: null,
      reason: "cap_reached",
    });
    expect(decideRecovery).not.toHaveBeenCalled();
    expect(inserted.values).toHaveLength(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("schedules normally for an abandoned checkout with owner columns", async () => {
    statusRow.value = [{ status: "abandoned" }];
    const scheduledFor = new Date(Date.now() + 30 * 60 * 1000);
    decideRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 1,
      scheduledFor,
      reason: "scheduled",
    });
    queueAdd.mockResolvedValue({});

    const decision = await scheduleRecovery({
      domain: "checkout",
      ownerId: "co_1",
      amount: 24900,
      currency: "INR",
    });

    expect(decision.allowed).toBe(true);
    expect(decideRecovery).toHaveBeenCalledWith("checkout", "co_1");
    expect(inserted.values).toHaveLength(1);
    expect(inserted.values[0]).toMatchObject({
      domain: "checkout",
      domainId: "co_1",
      subscriptionId: null,
      attemptNumber: 1,
      status: "pending",
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it("does not schedule when the invoice is paid", async () => {
    statusRow.value = [{ status: "paid" }];

    const decision = await scheduleRecovery({
      domain: "receivable",
      ownerId: "inv_1",
      amount: 50000,
      currency: "INR",
    });

    expect(decision).toEqual({
      allowed: false,
      attemptNumber: 4,
      scheduledFor: null,
      reason: "cap_reached",
    });
    expect(decideRecovery).not.toHaveBeenCalled();
    expect(inserted.values).toHaveLength(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("schedules normally for an overdue invoice with owner columns", async () => {
    statusRow.value = [{ status: "overdue" }];
    const scheduledFor = new Date(Date.now());
    decideRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 1,
      scheduledFor,
      reason: "scheduled",
    });
    queueAdd.mockResolvedValue({});

    const decision = await scheduleRecovery({
      domain: "receivable",
      ownerId: "inv_1",
      amount: 50000,
      currency: "INR",
    });

    expect(decision.allowed).toBe(true);
    expect(decideRecovery).toHaveBeenCalledWith("receivable", "inv_1");
    expect(inserted.values).toHaveLength(1);
    expect(inserted.values[0]).toMatchObject({
      domain: "receivable",
      domainId: "inv_1",
      subscriptionId: null,
      attemptNumber: 1,
      status: "pending",
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });
});
