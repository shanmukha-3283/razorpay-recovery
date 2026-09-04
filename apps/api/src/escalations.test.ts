import { describe, expect, it, vi, beforeEach } from "vitest";

const selectQueue = vi.hoisted(() => ({ rows: [] as any[][] }));
const insertReturning = vi.hoisted(() => vi.fn());
const updated = vi.hoisted(() => ({ sets: [] as any[] }));

vi.mock("./db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = selectQueue.rows.shift() ?? [];
          const chain: any = { limit: async () => rows };
          chain.then = (resolve: any) => Promise.resolve(rows).then(resolve);
          return chain;
        },
      }),
    }),
    insert: () => ({
      values: () => ({
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

import {
  checkSlaBreaches,
  fileEscalation,
  isSlaBreached,
} from "./escalations.js";

describe("fileEscalation", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    updated.sets = [];
    insertReturning.mockReset();
  });

  it("returns the existing open escalation instead of duplicating", async () => {
    selectQueue.rows = [[{ id: "esc_existing" }]];

    const id = await fileEscalation({
      domain: "subscription",
      ownerId: "sub_1",
      reason: "needs human",
    });

    expect(id).toBe("esc_existing");
  });

  it("files a new escalation with owner + SLA when none is open", async () => {
    selectQueue.rows = [[]];
    insertReturning.mockResolvedValue([{ id: "esc_new" }]);

    const id = await fileEscalation({
      domain: "checkout",
      ownerId: "co_1",
      reason: "final escalation",
    });

    expect(id).toBe("esc_new");
  });
});

describe("checkSlaBreaches", () => {
  beforeEach(() => {
    selectQueue.rows = [];
    updated.sets = [];
  });

  it("returns breached rows and marks them reviewed", async () => {
    const past = new Date("2026-01-01T00:00:00Z");
    selectQueue.rows = [
      [
        {
          id: "esc_1",
          domain: "subscription",
          owner: "support-queue",
          reason: "r",
          slaDue: past,
        },
      ],
    ];

    const result = await checkSlaBreaches(new Date("2026-09-04T00:00:00Z"));

    expect(result.checked).toBe(1);
    expect(result.breached).toHaveLength(1);
    expect(result.breached[0].id).toBe("esc_1");
    expect(updated.sets).toHaveLength(1);
  });

  it("returns empty when nothing is overdue", async () => {
    selectQueue.rows = [[]];
    const result = await checkSlaBreaches();
    expect(result).toEqual({ checked: 0, breached: [] });
  });
});

describe("isSlaBreached", () => {
  it("flags open escalations past their SLA only", () => {
    const now = new Date("2026-09-04T00:00:00Z");
    expect(
      isSlaBreached({ status: "open", slaDue: new Date("2026-01-01") }, now)
    ).toBe(true);
    expect(
      isSlaBreached(
        { status: "open", slaDue: new Date("2027-01-01") },
        now
      )
    ).toBe(false);
    expect(
      isSlaBreached({ status: "acked", slaDue: new Date("2026-01-01") }, now)
    ).toBe(false);
    expect(isSlaBreached({ status: "open", slaDue: null }, now)).toBe(false);
  });
});
