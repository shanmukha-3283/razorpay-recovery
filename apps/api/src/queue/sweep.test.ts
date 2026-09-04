import { describe, expect, it, vi } from "vitest";

const updateReturning = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => updateReturning(),
        }),
      }),
    }),
  },
}));

import { resetStaleAttempts } from "./sweep.js";

describe("resetStaleAttempts", () => {
  it("returns the number of reset rows", async () => {
    updateReturning.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(resetStaleAttempts()).resolves.toBe(2);
  });

  it("returns zero when nothing is stale", async () => {
    updateReturning.mockResolvedValue([]);
    await expect(resetStaleAttempts()).resolves.toBe(0);
  });
});
