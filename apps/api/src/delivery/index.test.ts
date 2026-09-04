import { describe, expect, it, vi, beforeEach } from "vitest";

const inserted = vi.hoisted(() => ({ values: [] as any[] }));
const checkCompliance = vi.hoisted(() => vi.fn());
const sendEmail = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  db: {
    insert: () => ({
      values: async (v: any) => {
        inserted.values.push(v);
        return [];
      },
    }),
  },
}));

vi.mock("./compliance.js", () => ({ checkCompliance }));
vi.mock("./email.js", () => ({ sendEmail }));

import { sendRecoveryMessage } from "./index.js";

const base = {
  domain: "subscription" as const,
  ownerId: "sub_1",
  recoveryAttemptId: "a_1",
  toEmail: "user@example.com",
  message: "Pay up.",
};

describe("sendRecoveryMessage compliance gate", () => {
  beforeEach(() => {
    inserted.values = [];
    checkCompliance.mockReset();
    sendEmail.mockReset();
  });

  it("skips + records when compliance fails, without sending", async () => {
    checkCompliance.mockResolvedValue({
      ok: false,
      reason: "quiet hours",
    });

    const out = await sendRecoveryMessage(base);

    expect(out).toMatchObject({
      status: "skipped",
      error: "quiet hours",
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(inserted.values[0]).toMatchObject({
      status: "skipped",
      toEmail: "user@example.com",
      error: "quiet hours",
    });
  });

  it("sends when compliance passes", async () => {
    checkCompliance.mockResolvedValue({ ok: true });
    sendEmail.mockResolvedValue({ ok: true, providerMessageId: "msg_1" });

    const out = await sendRecoveryMessage(base);

    expect(out.status).toBe("sent");
    expect(sendEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      message: "Pay up.",
    });
    expect(inserted.values[0]).toMatchObject({
      status: "sent",
      providerMessageId: "msg_1",
    });
  });

  it("still skips on missing recipient without consulting compliance", async () => {
    const out = await sendRecoveryMessage({ ...base, toEmail: null });

    expect(out.status).toBe("skipped");
    expect(checkCompliance).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
