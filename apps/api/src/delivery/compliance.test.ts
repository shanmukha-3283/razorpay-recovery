import { beforeEach, describe, expect, it, vi } from "vitest";

const selectQueue = vi.hoisted(() => ({ rows: [] as any[][] }));

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectQueue.rows.shift() ?? [];
          const chain: any = {
            limit: async () => rows,
          };
          chain.then = (resolve: any) => Promise.resolve(rows).then(resolve);
          return chain;
        },
      }),
    }),
  },
}));

import { checkCompliance, isQuietHours } from "./compliance.js";

const CFG = {
  quietStartHour: 21,
  quietEndHour: 8,
  timeZone: "Asia/Kolkata",
  dailyCap: 1,
  weeklyCap: 3,
};

// 2026-09-04T10:00:00Z = 15:30 IST (outside quiet hours).
const DAY = new Date("2026-09-04T10:00:00.000Z");
// 2026-09-04T18:00:00Z = 23:30 IST (inside quiet hours).
const NIGHT = new Date("2026-09-04T18:00:00.000Z");

describe("isQuietHours", () => {
  it("is quiet overnight and loud midday", () => {
    expect(isQuietHours(NIGHT, CFG)).toBe(true);
    expect(isQuietHours(DAY, CFG)).toBe(false);
  });

  it("handles the exact boundaries", () => {
    // 21:00 IST sharp is quiet; 08:00 IST sharp is not.
    expect(
      isQuietHours(new Date("2026-09-04T15:30:00.000Z"), CFG)
    ).toBe(true);
    expect(
      isQuietHours(new Date("2026-09-04T02:30:00.000Z"), CFG)
    ).toBe(false);
  });
});

describe("checkCompliance", () => {
  beforeEach(() => {
    selectQueue.rows = [];
  });

  it("passes a clean recipient in daytime", async () => {
    // DND: none; day count: 0; week count: 0.
    selectQueue.rows = [[], [{ sentDay: 0 }], [{ sentWeek: 0 }]];
    await expect(
      checkCompliance("buyer@example.com", DAY, CFG)
    ).resolves.toEqual({ ok: true });
  });

  it("suppresses DND-listed recipients", async () => {
    selectQueue.rows = [[{ id: "dnd_1" }]];
    await expect(
      checkCompliance("stop@example.com", DAY, CFG)
    ).resolves.toEqual({ ok: false, reason: "recipient on DND list" });
  });

  it("suppresses sends during quiet hours", async () => {
    selectQueue.rows = [[], [{ sentDay: 0 }], [{ sentWeek: 0 }]];
    await expect(
      checkCompliance("buyer@example.com", NIGHT, CFG)
    ).resolves.toEqual({ ok: false, reason: "quiet hours" });
  });

  it("enforces the daily frequency cap", async () => {
    selectQueue.rows = [[], [{ sentDay: 1 }], [{ sentWeek: 1 }]];
    await expect(
      checkCompliance("buyer@example.com", DAY, CFG)
    ).resolves.toEqual({ ok: false, reason: "daily frequency cap reached" });
  });

  it("enforces the weekly frequency cap", async () => {
    selectQueue.rows = [[], [{ sentDay: 0 }], [{ sentWeek: 3 }]];
    await expect(
      checkCompliance("buyer@example.com", DAY, CFG)
    ).resolves.toEqual({ ok: false, reason: "weekly frequency cap reached" });
  });
});
