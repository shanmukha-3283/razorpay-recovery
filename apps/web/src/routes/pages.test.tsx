import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jsonResponse, renderRoute } from "@/test/router-harness";

const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };

const fixtures: Record<string, unknown> = {
  "/api/stats": {
    data: {
      totalSubscriptions: 3,
      pendingSubscriptions: 1,
      haltedSubscriptions: 1,
      cancelledSubscriptions: 0,
      activeSubscriptions: 1,
      failedPayments: 2,
      totalRawEvents: 4,
      totalRecoveredAmount: 19900,
      retriesFired: 3,
      lastRecoveredAt: "2026-09-04T00:00:00Z",
    },
  },
  "/api/recovery-attempts": {
    data: [
      {
        id: "a1",
        attemptNumber: 1,
        action: "retry",
        status: "completed",
        amount: 19900,
        details: { failureCategory: "card_declined", reason: "retry" },
        createdAt: "2026-09-04T00:00:00Z",
        nextAttemptAt: null,
        subscriptionId: "sub_1",
        razorpaySubscriptionId: "sub_rzp_1",
      },
    ],
    meta,
  },
  "/api/subscriptions": {
    data: [
      {
        id: "sub_1",
        razorpaySubscriptionId: "sub_rzp_1",
        planId: "plan_1",
        status: "active",
        currentStart: null,
        currentEnd: null,
        paidCount: 1,
        totalCount: 12,
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-04T00:00:00Z",
        customerId: "cus_1",
        customerEmail: "user@example.com",
        customerName: "Ada User",
      },
    ],
    meta,
  },
  "/api/subscriptions/sub_1": {
    data: {
      id: "sub_1",
      razorpaySubscriptionId: "sub_rzp_1",
      planId: "plan_1",
      status: "active",
      currentStart: null,
      currentEnd: null,
      paidCount: 1,
      totalCount: 12,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-04T00:00:00Z",
      customerId: "cus_1",
      customerEmail: "user@example.com",
      customerName: "Ada User",
      customerContact: "+910000000000",
      payments: [],
      recoveryAttempts: [
        {
          id: "a9",
          attemptNumber: 1,
          action: "retry",
          status: "completed",
          amount: 19900,
          details: {
            failureCategory: "card_declined",
            reason: "default recovery action",
          },
          createdAt: "2026-09-04T00:00:00Z",
          nextAttemptAt: null,
        },
      ],
    },
  },
  "/api/events": {
    data: [
      {
        id: "e1",
        eventType: "payment.failed",
        razorpayEventId: "evt_1",
        receivedAt: "2026-09-04T00:00:00Z",
        processedAt: "2026-09-04T00:00:01Z",
      },
    ],
    meta,
  },
  "/api/audit-ledger": {
    data: [
      {
        id: "al1",
        recoveryAttemptId: "a1",
        action: "retry",
        amount: 19900,
        timestamp: "2026-09-04T00:00:00Z",
        metadata: { reason: "retry" },
      },
    ],
    meta,
  },
  "/api/deliveries": {
    data: [
      {
        id: "d1",
        channel: "email",
        toEmail: "user@example.com",
        status: "sent",
        providerMessageId: "msg_1",
        error: null,
        createdAt: "2026-09-04T00:00:00Z",
        sentAt: "2026-09-04T00:00:01Z",
        subscriptionId: "sub_1",
        razorpaySubscriptionId: "sub_rzp_1",
      },
    ],
    meta,
  },
  "/api/dnd": { data: [], meta: { ...meta, total: 0 } },
  "/api/checkouts": {
    data: [
      {
        id: "co_1",
        razorpayOrderId: "order_9",
        amount: 24900,
        currency: "INR",
        email: "buyer@example.com",
        contact: null,
        status: "abandoned",
        createdAt: "2026-09-04T00:00:00Z",
        updatedAt: "2026-09-04T00:00:00Z",
      },
    ],
    meta,
  },
  "/api/checkouts/co_1": {
    data: {
      id: "co_1",
      razorpayOrderId: "order_9",
      amount: 24900,
      currency: "INR",
      email: "buyer@example.com",
      contact: null,
      shortUrl: null,
      status: "abandoned",
      createdAt: "2026-09-04T00:00:00Z",
      updatedAt: "2026-09-04T00:00:00Z",
      recoveryAttempts: [],
    },
  },
  "/api/receivables": {
    data: [
      {
        id: "inv_1",
        externalId: "INV-001",
        customerName: "Acme",
        customerEmail: "ap@example.com",
        amount: 50000,
        currency: "INR",
        dueDate: "2026-08-01T00:00:00Z",
        status: "overdue",
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    ],
    meta,
  },
  "/api/receivables/inv_1": {
    data: {
      id: "inv_1",
      externalId: "INV-001",
      customerName: "Acme",
      customerEmail: "ap@example.com",
      amount: 50000,
      currency: "INR",
      dueDate: "2026-08-01T00:00:00Z",
      status: "overdue",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
      promises: [],
      recoveryAttempts: [],
    },
  },
  "/api/batches": {
    data: [
      {
        id: "b_1",
        name: "week-36",
        domain: "subscription",
        status: "open",
        createdBy: null,
        createdAt: "2026-09-01T00:00:00Z",
        closedAt: null,
        touchedOwners: 2,
        completedTouches: 3,
        recoveredOwners: 1,
        recoveredAmount: 19900,
        recoveryRate: 0.5,
      },
    ],
    meta,
  },
  "/api/batches/b_1": {
    data: {
      id: "b_1",
      name: "week-36",
      domain: "subscription",
      status: "open",
      createdBy: null,
      createdAt: "2026-09-01T00:00:00Z",
      closedAt: null,
      touchedOwners: 2,
      completedTouches: 3,
      recoveredOwners: 1,
      recoveredAmount: 19900,
      recoveryRate: 0.5,
      attempts: [],
    },
  },
  "/api/escalations": {
    data: [
      {
        id: "esc_1",
        domain: "subscription",
        ownerId: "sub_1",
        reason: "needs human",
        owner: "support-queue",
        status: "open",
        slaDue: "2026-09-06T00:00:00Z",
        createdAt: "2026-09-04T00:00:00Z",
        updatedAt: "2026-09-04T00:00:00Z",
      },
    ],
    meta,
  },
};

function stubFetch(
  overrides: Record<string, { json: unknown; status?: number }> = {}
) {
  return vi.fn(async (url: string) => {
    const path = url.split("?")[0];
    if (overrides[path]) {
      const o = overrides[path];
      return jsonResponse(o.json, o.status ?? 200);
    }
    if (path in fixtures) return jsonResponse(fixtures[path]);
    return jsonResponse({ error: "not mocked" }, 404);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboard pages render", () => {
  const cases: Array<[string, string, string]> = [
    ["/", "Dashboard", "Total Subscriptions"],
    ["/subscriptions", "Subscriptions", "sub_rzp_1"],
    ["/events", "Raw Events", "payment.failed"],
    ["/recovery", "Recovery Attempts", "sub_rzp_1"],
    ["/checkouts", "Abandoned Checkouts", "order_9"],
    ["/receivables", "Receivables", "INV-001"],
    ["/deliveries", "Deliveries", "user@example.com"],
    ["/batches", "Recovery Batches", "week-36"],
    ["/escalations", "Escalations", "needs human"],
    ["/audit", "Audit Ledger", "a1"],
  ];

  it.each(cases)("%s renders %s with data", async (path, heading, content) => {
    vi.stubGlobal("fetch", stubFetch());
    await renderRoute(path);
    expect(
      await screen.findByRole("heading", { name: heading })
    ).toBeTruthy();
    expect(await screen.findByText(content)).toBeTruthy();
  });

  it("/subscriptions/$id renders detail with AI insight", async () => {
    vi.stubGlobal("fetch", stubFetch());
    await renderRoute("/subscriptions/sub_1");
    expect(await screen.findByText("sub_rzp_1")).toBeTruthy();
    expect(await screen.findByText("card_declined")).toBeTruthy();
    expect(await screen.findByText("default recovery action")).toBeTruthy();
  });

  it("recover button posts and shows the scheduled state", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "/api/subscriptions/sub_1/recover": {
          json: {
            data: {
              scheduled: true,
              attemptNumber: 2,
              scheduledFor: "2026-09-05T00:00:00Z",
              reason: "scheduled",
            },
          },
        },
      })
    );
    await renderRoute("/subscriptions/sub_1");

    const button = await screen.findByText("Retry recovery now");
    await user.click(button);

    expect(
      await screen.findByText(/Recovery attempt #2 scheduled/)
    ).toBeTruthy();
  });

  it("recover button surfaces the cap refusal message", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "/api/subscriptions/sub_1/recover": {
          json: {
            error: "Recovery not allowed: cap_reached",
            scheduled: false,
            reason: "cap_reached",
          },
          status: 409,
        },
      })
    );
    await renderRoute("/subscriptions/sub_1");

    const button = await screen.findByText("Retry recovery now");
    await user.click(button);

    expect(
      await screen.findByText("Recovery not allowed: cap_reached")
    ).toBeTruthy();
  });
});
