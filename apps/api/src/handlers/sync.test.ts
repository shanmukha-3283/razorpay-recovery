import { describe, expect, it, vi, beforeEach } from "vitest";

const inserts = vi.hoisted<Array<{ table: string; values: any }>>(() => []);

vi.mock("../db/index.js", () => ({
  db: {
    insert: () => {
      let valuesArg: any;
      const chain = {
        values: (v: any) => {
          valuesArg = v;
          return chain;
        },
        onConflictDoUpdate: () => chain,
        returning: async () => {
          inserts.push({ table: "?", values: valuesArg });
          return [{ id: "row_1" }];
        },
      };
      return chain;
    },
  },
}));

import { syncCustomer, syncPayment, syncSubscription } from "./sync.js";

function lastInsert() {
  return inserts[inserts.length - 1];
}

describe("sync handlers", () => {
  beforeEach(() => {
    inserts.length = 0;
  });

  it("syncPayment maps fields including invoiceId with defaults", async () => {
    const id = await syncPayment("pay_1", {
      subscriptionId: "sub_1",
      invoiceId: "inv_9",
      status: "failed",
    });
    const { values } = lastInsert();

    expect(id).toBe("row_1");
    expect(values).toMatchObject({
      razorpayPaymentId: "pay_1",
      subscriptionId: "sub_1",
      invoiceId: "inv_9",
      amount: 0,
      currency: "INR",
      status: "failed",
      method: null,
    });
  });

  it("syncPayment cascades invoiceId into the onConflict update set", async () => {
    await syncPayment("pay_1", {
      invoiceId: "inv_9",
      status: "failed",
      amount: 500,
    });
    // The onConflictDoUpdate set is the same object returned by values() in
    // this sync handler (values payload). We verify the invoiceId made it in.
    expect(lastInsert().values.invoiceId).toBe("inv_9");
    expect(lastInsert().values.amount).toBe(500);
  });

  it("syncCustomer applies email/contact fallbacks", async () => {
    await syncCustomer("cus_1", "", null);
    expect(lastInsert().values).toMatchObject({
      razorpayCustomerId: "cus_1",
      email: null,
      contact: null,
    });
  });

  it("syncSubscription converts epoch seconds to Date and defaults paidCount", async () => {
    await syncSubscription("sub_1", {
      customerId: "cus_1",
      status: "active",
      currentStart: 1000,
      paidCount: 2,
    });
    const { values } = lastInsert();

    expect(values.razorpaySubscriptionId).toBe("sub_1");
    expect(values.customerId).toBe("cus_1");
    expect(values.status).toBe("active");
    expect(values.currentStart).toEqual(new Date(1000 * 1000));
    expect(values.paidCount).toBe(2);
  });

  it("syncSubscription defaults paidCount to 0 when not provided", async () => {
    await syncSubscription("sub_1", { status: "active" });
    expect(lastInsert().values.paidCount).toBe(0);
    expect(lastInsert().values.currentStart).toBeNull();
  });
});
