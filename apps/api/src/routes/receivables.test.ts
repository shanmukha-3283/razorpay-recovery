import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const selectQueue = vi.hoisted(() => ({ rows: [] as any[][] }));
const insertReturning = vi.hoisted(() => vi.fn());
const scheduleRecovery = vi.hoisted(() => vi.fn());
const updated = vi.hoisted(() => ({ sets: [] as any[] }));

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => selectQueue.rows.shift() ?? [],
        }),
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
        returning: async () => insertReturning(),
      }),
    }),
    update: () => ({
      set: (s: any) => {
        updated.sets.push(s);
        return { where: async () => [] };
      },
    }),
  },
}));

vi.mock("../queue/scheduler.js", () => ({
  scheduleRecovery,
}));

import receivablesRoute from "./receivables.js";

function makeApp() {
  const app = new Hono();
  app.route("/api/receivables", receivablesRoute);
  return app;
}

describe("receivables routes", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    updated.sets = [];
    insertReturning.mockReset();
    scheduleRecovery.mockReset();
  });

  it("POST / validates external_id and amount", async () => {
    const app = makeApp();
    const noId = await app.request("/api/receivables", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 100 }),
    });
    expect(noId.status).toBe(400);

    const badAmount = await app.request("/api/receivables", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ external_id: "INV-1", amount: -5 }),
    });
    expect(badAmount.status).toBe(400);
    expect(scheduleRecovery).not.toHaveBeenCalled();
  });

  it("POST / ingests and schedules a touch", async () => {
    selectQueue.rows = [[]]; // no pending attempt
    insertReturning.mockResolvedValue([{ id: "inv_1", status: "overdue" }]);
    scheduleRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 1,
      scheduledFor: new Date(),
      reason: "scheduled",
    });

    const res = await makeApp().request("/api/receivables", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        external_id: "INV-001",
        customer_email: "ap@example.com",
        amount: 50000,
        due_date: "2026-08-01",
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toMatchObject({ id: "inv_1", scheduled: true });
    expect(scheduleRecovery).toHaveBeenCalledWith({
      domain: "receivable",
      ownerId: "inv_1",
      amount: 50000,
      currency: "INR",
    });
  });

  it("POST /import reports per-row results", async () => {
    selectQueue.rows = [[]];
    insertReturning.mockResolvedValue([{ id: "inv_9", status: "overdue" }]);
    scheduleRecovery.mockResolvedValue({
      allowed: true,
      attemptNumber: 1,
      scheduledFor: new Date(),
      reason: "scheduled",
    });

    const csv = [
      "external_id,customer_name,customer_email,amount,currency,due_date",
      "INV-A,Acme,acme@example.com,10000,INR,2026-08-01",
      ",Nobody,nobody@example.com,5000,INR,2026-08-01",
      "INV-B,Bad,bad@example.com,notanumber,INR,2026-08-01",
    ].join("\n");

    const res = await makeApp().request("/api/receivables/import", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csv,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.imported).toBe(1);
    expect(json.data.failed).toBe(2);
    expect(json.data.rows).toHaveLength(3);
  });

  it("POST /:id/promises records a promise and flips status", async () => {
    selectQueue.rows = [[{ id: "inv_1", status: "overdue" }]];
    insertReturning.mockResolvedValue([{ id: "prom_1" }]);

    const res = await makeApp().request("/api/receivables/inv_1/promises", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promised_date: "2026-10-01" }),
    });

    expect(res.status).toBe(200);
    expect(updated.sets).toContainEqual(
      expect.objectContaining({ status: "promised" })
    );
  });

  it("POST /:id/mark-paid closes invoice and keeps promises", async () => {
    selectQueue.rows = [[{ id: "inv_1" }]];

    const res = await makeApp().request("/api/receivables/inv_1/mark-paid", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(updated.sets).toContainEqual(
      expect.objectContaining({ status: "paid" })
    );
    expect(updated.sets).toContainEqual(
      expect.objectContaining({ status: "kept" })
    );
  });

  it("POST /check-breaches flips past-due open promises", async () => {
    // sweep select returns one past-due open promise on an unpaid invoice.
    selectQueue.rows = [
      [{ promiseId: "prom_1", invoiceId: "inv_1" }],
      [{ status: "overdue" }],
    ];

    const res = await makeApp().request("/api/receivables/check-breaches", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toMatchObject({ checked: 1, breached: 1 });
    expect(updated.sets).toContainEqual(
      expect.objectContaining({ status: "breached" })
    );
  });
});
