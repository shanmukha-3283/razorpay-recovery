import { describe, expect, it, vi, beforeEach } from "vitest";

const scheduleRecovery = vi.hoisted(() => vi.fn());
const syncPayment = vi.hoisted(() => vi.fn());
const lookupSub = vi.hoisted(() => vi.fn());

vi.mock("../queue/scheduler.js", () => ({
  scheduleRecovery,
}));

vi.mock("./sync.js", () => ({
  syncCustomer: vi.fn(async () => "cus_internal"),
  syncSubscription: vi.fn(async () => "sub_internal"),
  syncPayment,
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => lookupSub(),
      }),
    }),
  },
}));

import { dispatchWebhookEvent } from "./index.js";

describe("dispatchWebhookEvent / getEntity", () => {
  beforeEach(() => {
    scheduleRecovery.mockReset();
    syncPayment.mockReset();
    lookupSub.mockReset();
  });

  it("extracts the payment object (not the entity string) and schedules recovery", async () => {
    lookupSub.mockReturnValue([
      { id: "internal-sub-123" },
    ]);
    syncPayment.mockResolvedValue("pay-id");

    const payload = {
      entity: "event",
      event: "payment.failed",
      payload: {
        payment: {
          entity: "payment",
          id: "pay_abc",
          order_id: "order_1",
          invoice_id: "inv_9",
          amount: 24900,
          currency: "INR",
          status: "failed",
          method: "card",
          error_code: "CARD_DECLINED",
          error_description: "declined",
          subscription_id: "sub_rzp_1",
        },
      },
    };

    const ok = await dispatchWebhookEvent("payment.failed", {
      payload: payload.payload,
      rawEventId: "raw_1",
    });

    expect(ok).toBe(true);
    // getEntity must return the payment object, not the ".entity" string marker.
    expect(syncPayment).toHaveBeenCalledWith("pay_abc", expect.objectContaining({
      invoiceId: "inv_9",
      subscriptionId: "internal-sub-123",
      status: "failed",
    }));
    // Recovery is scheduled against the resolved internal subscription id.
    expect(scheduleRecovery).toHaveBeenCalledWith(
      "internal-sub-123",
      24900,
      "INR"
    );
  });

  it("does not schedule recovery when the subscription is not known", async () => {
    lookupSub.mockReturnValue([]);
    syncPayment.mockResolvedValue("pay-id");

    const payload = {
      payload: {
        payment: {
          entity: "payment",
          id: "pay_unknown",
          subscription_id: "sub_rzp_unknown",
          amount: 100,
        },
      },
    };

    const ok = await dispatchWebhookEvent("payment.failed", {
      payload: payload.payload,
      rawEventId: "raw_2",
    });

    expect(ok).toBe(true);
    expect(syncPayment).toHaveBeenCalledWith("pay_unknown", expect.any(Object));
    expect(scheduleRecovery).not.toHaveBeenCalled();
  });
});
