import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const selectQueue = vi.hoisted(() => ({ rows: [] as any[][] }));
const insertReturning = vi.hoisted(() => vi.fn());
const scheduleRecovery = vi.hoisted(() => vi.fn());
const getOrder = vi.hoisted(() => vi.fn());
const RazorpayApiErrorMock = vi.hoisted(
  () =>
    class MockRazorpayApiError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "RazorpayApiError";
      }
    }
);

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectQueue.rows.shift() ?? [];
          const chain: any = {
            limit: async () => rows,
            orderBy: () => ({
              offset: () => ({
                limit: async () => [],
              }),
            }),
          };
          chain.then = (resolve: any) => Promise.resolve(rows).then(resolve);
          return chain;
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => insertReturning(),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => [],
      }),
    }),
  },
}));

vi.mock("../razorpay/client.js", () => ({
  getOrder,
  RazorpayApiError: RazorpayApiErrorMock,
}));

vi.mock("../queue/scheduler.js", () => ({
  scheduleRecovery,
}));

import checkoutsRoute from "./checkouts.js";

function makeApp() {
  const app = new Hono();
  app.route("/api/checkouts", checkoutsRoute);
  return app;
}

function postAbandoned(app: Hono, body: unknown) {
  return app.request("/api/checkouts/abandoned", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/checkouts/abandoned", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    insertReturning.mockReset();
    scheduleRecovery.mockReset();
    getOrder.mockReset();
    getOrder.mockRejectedValue(
      new RazorpayApiErrorMock("Razorpay credentials not configured")
    );
  });

  it("rejects a missing order_id", async () => {
    const res = await postAbandoned(makeApp(), { amount: 100 });

    expect(res.status).toBe(400);
    expect(scheduleRecovery).not.toHaveBeenCalled();
  });

  it("ingests a new abandoned checkout and schedules recovery", async () => {
    // captured-payment lookup: none
    selectQueue.rows = [[]];
    insertReturning.mockResolvedValue([
      { id: "co_1", status: "abandoned" },
    ]);
    const scheduledFor = new Date(Date.now() + 30 * 60 * 1000);
    scheduleRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 1,
      scheduledFor,
      reason: "scheduled",
    });

    const res = await postAbandoned(makeApp(), {
      order_id: "order_9",
      amount: 24900,
      currency: "INR",
      email: "buyer@example.com",
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toMatchObject({ id: "co_1", scheduled: true });
    expect(scheduleRecovery).toHaveBeenCalledWith({
      domain: "checkout",
      ownerId: "co_1",
      amount: 24900,
      currency: "INR",
    });
  });

  it("marks already-paid orders recovered without scheduling", async () => {
    selectQueue.rows = [[{ id: "pay_1" }]];
    insertReturning.mockResolvedValue([{ id: "co_1" }]);

    const res = await postAbandoned(makeApp(), {
      order_id: "order_paid",
      amount: 1000,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toMatchObject({ status: "recovered", scheduled: false });
    expect(scheduleRecovery).not.toHaveBeenCalled();
  });

  it("falls back to the order payload when verification is unavailable", async () => {
    selectQueue.rows = [[]];
    insertReturning.mockResolvedValue([
      { id: "co_2", status: "abandoned" },
    ]);
    scheduleRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 1,
      scheduledFor: new Date(),
      reason: "scheduled",
    });

    const res = await postAbandoned(makeApp(), { order_id: "order_10" });

    expect(res.status).toBe(200);
    expect(scheduleRecovery).toHaveBeenCalledWith({
      domain: "checkout",
      ownerId: "co_2",
      amount: 0,
      currency: "INR",
    });
  });

  it("skips scheduling when a reminder is already pending", async () => {
    // captured-payment lookup: none; pending-attempt lookup: one row.
    selectQueue.rows = [[], [{ id: "attempt_pending" }]];
    insertReturning.mockResolvedValue([
      { id: "co_1", status: "abandoned" },
    ]);

    const res = await postAbandoned(makeApp(), {
      order_id: "order_9",
      amount: 24900,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toMatchObject({
      scheduled: false,
      reason: "already_scheduled",
    });
    expect(scheduleRecovery).not.toHaveBeenCalled();
  });
});
