import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectQueue = vi.hoisted(() => ({ rows: [] as any[][] }));
const updated = vi.hoisted(() => ({ sets: [] as any[] }));

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectQueue.rows.shift() ?? [];
          const chain: any = {
            limit: async () => rows,
            innerJoin: () => ({
              where: async () => rows,
            }),
          };
          chain.then = (resolve: any) => Promise.resolve(rows).then(resolve);
          return chain;
        },
        innerJoin: () => ({
          where: async () => selectQueue.rows.shift() ?? [],
        }),
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

vi.mock("../escalations.js", () => ({
  checkSlaBreaches: vi.fn(async () => ({ checked: 0, breached: [] })),
}));

vi.mock("./sweep.js", () => ({
  resetStaleAttempts: vi.fn(async () => 0),
}));

import { checkPromiseBreaches, startSweeps, stopSweeps } from "./sweeps.js";
import { resetStaleAttempts } from "./sweep.js";
import { checkSlaBreaches } from "../escalations.js";

describe("checkPromiseBreaches", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    updated.sets = [];
  });

  it("breaches past-due open promises on unpaid invoices", async () => {
    selectQueue.rows = [
      [{ promiseId: "prom_1", invoiceId: "inv_1" }],
      [{ status: "overdue" }],
    ];

    const result = await checkPromiseBreaches(new Date("2026-09-04T00:00:00Z"));

    expect(result).toEqual({ checked: 1, breached: 1 });
    expect(updated.sets).toContainEqual(
      expect.objectContaining({ status: "breached" })
    );
  });

  it("skips promises whose invoice is already paid", async () => {
    selectQueue.rows = [
      [{ promiseId: "prom_1", invoiceId: "inv_1" }],
      [{ status: "paid" }],
    ];

    const result = await checkPromiseBreaches();

    expect(result).toEqual({ checked: 1, breached: 0 });
  });

  it("returns zeros when nothing is overdue", async () => {
    selectQueue.rows = [[]];
    await expect(checkPromiseBreaches()).resolves.toEqual({
      checked: 0,
      breached: 0,
    });
  });
});

describe("startSweeps / stopSweeps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopSweeps();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopSweeps();
    vi.useRealTimers();
  });

  it("runs all three sweeps on every tick", async () => {
    process.env.SWEEP_INTERVAL_MIN = "60";
    startSweeps();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(resetStaleAttempts).toHaveBeenCalledTimes(1);
    expect(checkSlaBreaches).toHaveBeenCalledTimes(1);
    // promise sweep hits the (mocked) db
    selectQueue.rows = [[]];
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(resetStaleAttempts).toHaveBeenCalledTimes(2);
  });

  it("a failing sweep does not kill the loop", async () => {
    vi.mocked(resetStaleAttempts).mockRejectedValueOnce(new Error("db down"));
    selectQueue.rows = [[], []];
    startSweeps();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(resetStaleAttempts).toHaveBeenCalledTimes(1);
    expect(checkSlaBreaches).toHaveBeenCalledTimes(1);
  });

  it("stopSweeps halts ticks and start is idempotent", async () => {
    startSweeps();
    startSweeps();
    stopSweeps();

    await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);

    expect(resetStaleAttempts).not.toHaveBeenCalled();
  });
});
