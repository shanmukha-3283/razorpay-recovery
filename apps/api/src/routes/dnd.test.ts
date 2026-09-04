import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const selectQueue = vi.hoisted(() => ({ rows: [] as any[][] }));
const insertReturning = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectQueue.rows.shift() ?? [];
          const withRows = (obj: any) => {
            obj.then = (resolve: any) => Promise.resolve(rows).then(resolve);
            return obj;
          };
          return withRows({
            limit: async () => rows,
            orderBy: () =>
              withRows({
                limit: async () => rows,
                offset: () => withRows({ limit: async () => rows }),
              }),
          });
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => insertReturning(),
        }),
      }),
    }),
    delete: () => ({
      where: async () => [],
    }),
  },
}));

import dndRoute from "./dnd.js";

function makeApp() {
  const app = new Hono();
  app.route("/api/dnd", dndRoute);
  return app;
}

describe("dnd routes", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    insertReturning.mockReset();
  });

  it("POST / validates emails and lowercases", async () => {
    const bad = await makeApp().request("/api/dnd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(bad.status).toBe(400);
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it("POST / inserts and reports duplicates", async () => {
    insertReturning.mockResolvedValue([
      { id: "dnd_1", email: "stop@example.com" },
    ]);
    const created = await makeApp().request("/api/dnd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "Stop@Example.com",
        reason: "opt-out",
      }),
    });
    expect(created.status).toBe(201);

    insertReturning.mockResolvedValue([]);
    const dup = await makeApp().request("/api/dnd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "stop@example.com" }),
    });
    expect(dup.status).toBe(200);
    const json = (await dup.json()) as any;
    expect(json.data.duplicate).toBe(true);
  });

  it("DELETE /:id 404s unknown entries", async () => {
    selectQueue.rows = [[]];
    const res = await makeApp().request("/api/dnd/missing", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});
