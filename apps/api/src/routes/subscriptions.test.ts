import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const selectQueue = vi.hoisted(() => ({ rows: [] as any[][] }));
const scheduleRecovery = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        // Awaitable directly (subscription lookup) and chainable via
        // orderBy/limit (latest-payment lookup).
        where: () => {
          const rows = selectQueue.rows.shift() ?? [];
          const chain: any = {
            orderBy: () => ({ limit: async () => rows }),
          };
          chain.then = (resolve: any) =>
            Promise.resolve(rows).then(resolve);
          return chain;
        },
      }),
    }),
  },
}));

vi.mock("../queue/scheduler.js", () => ({
  scheduleRecovery,
}));

import subscriptionsRoute from "./subscriptions.js";

function makeApp() {
  const app = new Hono();
  app.route("/api/subscriptions", subscriptionsRoute);
  return app;
}

function postRecover(app: Hono, id: string, body?: unknown) {
  return app.request(`/api/subscriptions/${id}/recover`, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/subscriptions/:id/recover", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    scheduleRecovery.mockReset();
  });

  it("schedules recovery using the latest failed payment amount", async () => {
    selectQueue.rows = [
      [{ id: "sub_1" }],
      [{ amount: 24900, currency: "INR" }],
    ];
    const scheduledFor = new Date(Date.now() + 3600_000);
    scheduleRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 2,
      scheduledFor,
      reason: "scheduled",
    });

    const res = await postRecover(makeApp(), "sub_1");

    expect(res.status).toBe(200);
    expect(scheduleRecovery).toHaveBeenCalledWith({
      domain: "subscription",
      ownerId: "sub_1",
      amount: 24900,
      currency: "INR",
    });
    const json = (await res.json()) as any;
    expect(json.data).toMatchObject({
      scheduled: true,
      attemptNumber: 2,
      reason: "scheduled",
    });
  });

  it("falls back to zero amount when there is no failed payment", async () => {
    selectQueue.rows = [[{ id: "sub_1" }], []];
    scheduleRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 1,
      scheduledFor: new Date(),
      reason: "scheduled",
    });

    const res = await postRecover(makeApp(), "sub_1");

    expect(res.status).toBe(200);
    expect(scheduleRecovery).toHaveBeenCalledWith({
      domain: "subscription",
      ownerId: "sub_1",
      amount: 0,
      currency: "INR",
    });
  });

  it("respects an explicit amount/currency override", async () => {
    selectQueue.rows = [[{ id: "sub_1" }]];
    scheduleRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 1,
      scheduledFor: new Date(),
      reason: "scheduled",
    });

    const res = await postRecover(makeApp(), "sub_1", {
      amount: 5000,
      currency: "USD",
    });

    expect(res.status).toBe(200);
    expect(scheduleRecovery).toHaveBeenCalledWith({
      domain: "subscription",
      ownerId: "sub_1",
      amount: 5000,
      currency: "USD",
    });
  });

  it("returns 404 for an unknown subscription", async () => {
    selectQueue.rows = [[]];

    const res = await postRecover(makeApp(), "missing");

    expect(res.status).toBe(404);
    expect(scheduleRecovery).not.toHaveBeenCalled();
  });

  it("returns 409 when the cap/guard refuses scheduling", async () => {
    selectQueue.rows = [
      [{ id: "sub_1" }],
      [{ amount: 19900, currency: "INR" }],
    ];
    scheduleRecovery.mockResolvedValue({
      allowed: false,
      attemptNumber: 3,
      scheduledFor: null,
      reason: "cap_reached",
    });

    const res = await postRecover(makeApp(), "sub_1");

    expect(res.status).toBe(409);
    const json = (await res.json()) as any;
    expect(json).toMatchObject({ scheduled: false, reason: "cap_reached" });
  });
});
