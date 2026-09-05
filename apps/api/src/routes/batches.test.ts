import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const selectQueue = vi.hoisted(() => ({ rows: [] as any[][] }));
const insertReturning = vi.hoisted(() => vi.fn());
const inserted = vi.hoisted(() => ({ rows: [] as any[] }));
const updated = vi.hoisted(() => ({ sets: [] as any[] }));

vi.mock("../db/index.js", () => {
  const queuedSelect = () => ({
    from: () => ({
      where: () => {
        const rows = selectQueue.rows.shift() ?? [];
        const withRows = (obj: any) => {
          obj.then = (resolve: any) => Promise.resolve(rows).then(resolve);
          return obj;
        };
        const limitOffset = () =>
          withRows({
            offset: () => withRows({ limit: async () => rows }),
          });
        return withRows({
          limit: () => limitOffset(),
          offset: () => withRows({ limit: async () => rows }),
          orderBy: () =>
            withRows({
              limit: () => limitOffset(),
              offset: () => withRows({ limit: async () => rows }),
            }),
        });
      },
    }),
  });
  return {
    db: {
      select: queuedSelect,
      selectDistinct: queuedSelect,
      insert: () => ({
      values: (v: any) => {
        inserted.rows.push(v);
        return {
          onConflictDoUpdate: () => ({
            returning: async () => insertReturning(),
          }),
          returning: async () => insertReturning(),
        };
      },
    }),
    update: () => ({
      set: (s: any) => {
        updated.sets.push(s);
        // where() stays awaitable (old call sites) and supports
        // .returning() for guarded updates (close route).
        const whereResult = Promise.resolve([]) as unknown as Promise<
          unknown[]
        > & {
          returning: () => Promise<unknown[]>;
        };
        whereResult.returning = async () => [{ id: "b_1", status: "closed" }];
        return { where: () => whereResult };
      },
    }),
    },
  };
});

import batchesRoute from "./batches.js";

function makeApp() {
  const app = new Hono();
  app.route("/api/batches", batchesRoute);
  return app;
}

const BATCH = {
  id: "b_1",
  name: "launch",
  domain: "subscription",
  status: "open",
  createdBy: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  closedAt: null,
};

describe("batches routes", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    updated.sets = [];
    inserted.rows = [];
    insertReturning.mockReset();
  });

  it("POST / validates name and domain", async () => {
    const app = makeApp();
    const noName = await app.request("/api/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "subscription" }),
    });
    expect(noName.status).toBe(400);

    const badDomain = await app.request("/api/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", domain: "nope" }),
    });
    expect(badDomain.status).toBe(400);
  });

  it("POST / refuses a second open batch per domain", async () => {
    selectQueue.rows = [[{ id: "b_existing" }]];

    const res = await makeApp().request("/api/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "second", domain: "subscription" }),
    });

    expect(res.status).toBe(409);
  });

  it("POST / creates a batch when none is open", async () => {
    selectQueue.rows = [[]];
    insertReturning.mockResolvedValue([{ ...BATCH, id: "b_new" }]);

    const res = await makeApp().request("/api/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "week 36", domain: "checkout" }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.data.id).toBe("b_new");
  });

  it("GET / reports measured recovery per batch", async () => {
    // count, batch list, then per-batch: owners, touch count, payments.
    selectQueue.rows = [
      [{ count: 1 }],
      [BATCH],
      [{ domainId: "s1" }, { domainId: "s2" }],
      [{ count: 3 }],
      [{ subscriptionId: "s1", amount: 1000 }],
    ];

    const res = await makeApp().request("/api/batches");

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data[0]).toMatchObject({
      touchedOwners: 2,
      completedTouches: 3,
      recoveredOwners: 1,
      recoveredAmount: 1000,
      recoveryRate: 0.5,
    });
  });

  it("GET /:id returns 404 for unknown batches", async () => {
    selectQueue.rows = [[]];

    const res = await makeApp().request("/api/batches/missing");

    expect(res.status).toBe(404);
  });

  it("POST /:id/close closes, audits, and reports", async () => {
    selectQueue.rows = [
      [{ ...BATCH, status: "open" }],
      [],
      [{ count: 0 }],
      [],
    ];

    const res = await makeApp().request("/api/batches/b_1/close", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(updated.sets).toContainEqual(
      expect.objectContaining({ status: "closed" })
    );
    expect(inserted.rows).toContainEqual(
      expect.objectContaining({
        action: "batch.closed",
        recoveryAttemptId: null,
      })
    );
  });

  it("POST /:id/close refuses an already-closed batch", async () => {
    selectQueue.rows = [[{ ...BATCH, status: "closed" }]];

    const res = await makeApp().request("/api/batches/b_1/close", {
      method: "POST",
    });

    expect(res.status).toBe(409);
    expect(inserted.rows).toHaveLength(0);
  });
});
