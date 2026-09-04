import { describe, expect, it, vi, beforeEach } from "vitest";

const attemptsForQuery = vi.fn<() => any[]>();

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => attemptsForQuery(),
        }),
      }),
    }),
  },
}));

import {
  decideRecovery,
  MAX_ATTEMPTS,
  RETRY_SPACING_MS,
  RETRY_WINDOW_HOURS,
} from "./retryPolicy.js";

function makeAttempt(
  attemptNumber: number,
  createdAt: Date,
  status = "completed"
) {
  return { id: `a${attemptNumber}`, attemptNumber, status, createdAt };
}

const HOUR = 60 * 60 * 1000;

describe("decideRecovery / retry policy", () => {
  beforeEach(() => {
    attemptsForQuery.mockReset();
  });

  it("schedules the first attempt ~1h out when no completed attempts exist", async () => {
    attemptsForQuery.mockReturnValue([]);
    const before = Date.now();
    const decision = await decideRecovery("subscription", "sub_1");

    expect(decision.allowed).toBe(true);
    expect(decision.attemptNumber).toBe(1);
    expect(decision.reason).toBe("scheduled");
    // The scheduled time must be exactly the spacing window out from call time.
    expect(decision.scheduledFor!.getTime()).toBeGreaterThanOrEqual(
      before + RETRY_SPACING_MS[0]
    );
  });

  it("spaces attempt 2 and 3 per the RETRY_SPACING window", async () => {
    const t1 = new Date("2026-09-01T00:00:00Z");
    attemptsForQuery.mockReturnValue([
      makeAttempt(1, t1),
    ]);
    const d2 = await decideRecovery("subscription", "sub_1");
    expect(d2.attemptNumber).toBe(2);
    expect(d2.scheduledFor!.getTime()).toBe(
      t1.getTime() + RETRY_SPACING_MS[1]
    );

    attemptsForQuery.mockReturnValue([
      makeAttempt(2, new Date("2026-09-02T00:00:00Z")),
      makeAttempt(1, t1),
    ]);
    const d3 = await decideRecovery("subscription", "sub_1");
    expect(d3.attemptNumber).toBe(3);
    expect(d3.scheduledFor!.getTime()).toBe(
      new Date("2026-09-02T00:00:00Z").getTime() + RETRY_SPACING_MS[2]
    );
  });

  it("caps retries after MAX_ATTEMPTS completed attempts", async () => {
    attemptsForQuery.mockReturnValue([
      makeAttempt(3, new Date("2026-09-03T00:00:00Z")),
      makeAttempt(2, new Date("2026-09-02T00:00:00Z")),
      makeAttempt(1, new Date("2026-09-01T00:00:00Z")),
    ]);
    const decision = await decideRecovery("subscription", "sub_1");

    expect(decision.allowed).toBe(false);
    expect(decision.attemptNumber).toBe(MAX_ATTEMPTS);
    expect(decision.reason).toBe("cap_reached");
    expect(decision.scheduledFor).toBeNull();
  });

  it("denies when the next attempt would exceed the 72h window", async () => {
    // attempt 3 was created > 72h after attempt 1 but late enough that
    // attempt 4's spacing would push it past the window end.
    const t1 = new Date("2026-09-01T00:00:00Z");
    const t3 = new Date(t1.getTime() + RETRY_WINDOW_HOURS * 60 * 60 * 1000);
    attemptsForQuery.mockReturnValue([
      makeAttempt(3, t3),
      makeAttempt(2, new Date("2026-09-02T00:00:00Z")),
      makeAttempt(1, t1),
    ]);

    const decision = await decideRecovery("subscription", "sub_1");
    expect(decision.allowed).toBe(false);
    expect(decision.attemptNumber).toBe(MAX_ATTEMPTS);
    expect(decision.reason).toBe("cap_reached");
  });

  it("allows a next attempt that lands inside the window boundary", async () => {
    const t1 = new Date("2026-09-01T00:00:00Z");
    // Attempt 3's scheduled time = t2 + RETRY_SPACING_MS[2] (24h).
    // Choose t2 so that lands just inside the 72h window (t1 + 71h).
    const spacing3 = RETRY_SPACING_MS[2];
    const t2 = new Date(
      t1.getTime() + RETRY_WINDOW_HOURS * 60 * 60 * 1000 - spacing3 - HOUR
    );
    attemptsForQuery.mockReturnValue([
      makeAttempt(2, t2),
      makeAttempt(1, t1),
    ]);

    const decision = await decideRecovery("subscription", "sub_1");
    expect(decision.allowed).toBe(true);
    expect(decision.attemptNumber).toBe(3);
    expect(decision.scheduledFor!.getTime()).toBeLessThan(
      t1.getTime() + RETRY_WINDOW_HOURS * 60 * 60 * 1000
    );
  });
});

describe("decideRecovery / checkout policy (2 reminders / 48h)", () => {
  beforeEach(() => {
    attemptsForQuery.mockReset();
  });

  it("delays the first reminder by the 30-minute grace window", async () => {
    attemptsForQuery.mockReturnValue([]);
    const before = Date.now();
    const decision = await decideRecovery("checkout", "co_1");

    expect(decision.allowed).toBe(true);
    expect(decision.attemptNumber).toBe(1);
    expect(decision.scheduledFor!.getTime()).toBeGreaterThanOrEqual(
      before + 30 * 60 * 1000
    );
  });

  it("caps checkout reminders after 2 completed attempts", async () => {
    attemptsForQuery.mockReturnValue([
      makeAttempt(2, new Date("2026-09-02T00:00:00Z")),
      makeAttempt(1, new Date("2026-09-01T00:00:00Z")),
    ]);

    const decision = await decideRecovery("checkout", "co_1");
    expect(decision.allowed).toBe(false);
    expect(decision.attemptNumber).toBe(2);
    expect(decision.reason).toBe("cap_reached");
  });

  it("schedules the second reminder ~24h after the first", async () => {
    const t1 = new Date("2026-09-01T00:00:00Z");
    attemptsForQuery.mockReturnValue([makeAttempt(1, t1)]);

    const decision = await decideRecovery("checkout", "co_1");
    expect(decision.allowed).toBe(true);
    expect(decision.attemptNumber).toBe(2);
    expect(decision.scheduledFor!.getTime()).toBe(
      t1.getTime() + 24 * 60 * 60 * 1000
    );
  });
});
