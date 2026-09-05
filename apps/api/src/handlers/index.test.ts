import { describe, expect, it, vi, beforeEach } from "vitest";

const scheduleRecovery = vi.hoisted(() => vi.fn());
const syncPayment = vi.hoisted(() => vi.fn());
const syncCustomer = vi.hoisted(() => vi.fn(async () => "cus_internal"));
const syncSubscription = vi.hoisted(() => vi.fn(async () => "sub_internal"));
const lookupSub = vi.hoisted(() => vi.fn());

vi.mock("../queue/scheduler.js", () => ({
  scheduleRecovery,
}));

vi.mock("./sync.js", () => ({
  syncCustomer,
  syncSubscription,
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
    syncCustomer.mockReset();
    syncSubscription.mockReset();
    lookupSub.mockReset();
    syncCustomer.mockResolvedValue("cus_internal");
    syncSubscription.mockResolvedValue("sub_internal");
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
    expect(scheduleRecovery).toHaveBeenCalledWith({
      domain: "subscription",
      ownerId: "internal-sub-123",
      amount: 24900,
      currency: "INR",
    });
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

  it("unwraps the real Razorpay nested entity object", async () => {
    lookupSub.mockReturnValue([{ id: "internal-sub-nested" }]);
    syncPayment.mockResolvedValue("pay-id");

    const payload = {
      payload: {
        payment: {
          entity: {
            entity: "payment",
            id: "pay_nested",
            order_id: "order_nested",
            invoice_id: null,
            amount: 34900,
            currency: "INR",
            status: "failed",
            method: "upi",
            error_code: "BAD_UPI_HANDLE",
            error_description: "Invalid UPI handle",
            subscription_id: "sub_rzp_nested",
          },
        },
      },
    };

    const ok = await dispatchWebhookEvent("payment.failed", {
      payload: payload.payload,
      rawEventId: "raw_nested",
    });

    expect(ok).toBe(true);
    expect(syncPayment).toHaveBeenCalledWith(
      "pay_nested",
      expect.objectContaining({
        subscriptionId: "internal-sub-nested",
        amount: 34900,
        errorCode: "BAD_UPI_HANDLE",
        status: "failed",
      })
    );
    expect(scheduleRecovery).toHaveBeenCalledWith({
      domain: "subscription",
      ownerId: "internal-sub-nested",
      amount: 34900,
      currency: "INR",
    });
  });

  it("passes the customer name from subscription payloads into syncCustomer", async () => {
    const payload = {
      subscription: {
        entity: "subscription",
        id: "sub_rzp_9",
        customer_id: "cus_rzp_9",
        customer_name: "Priya Nair",
        plan_id: "plan_1",
        status: "pending",
      },
      payment: {
        entity: "payment",
        id: "pay_9",
        amount: 24900,
        currency: "INR",
        status: "failed",
      },
    };

    const ok = await dispatchWebhookEvent("subscription.pending", {
      payload,
      rawEventId: "raw_3",
    });

    expect(ok).toBe(true);
    expect(syncCustomer).toHaveBeenCalledWith(
      "cus_rzp_9",
      expect.objectContaining({ name: "Priya Nair" })
    );
    expect(syncSubscription).toHaveBeenCalledWith(
      "sub_rzp_9",
      expect.objectContaining({ status: "pending" })
    );
  });
});
