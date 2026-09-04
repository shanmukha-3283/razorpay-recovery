import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  class RazorpayApiErrorMock extends Error {
    constructor(
      message: string,
      readonly status?: number,
      readonly code?: string
    ) {
      super(message);
      this.name = "RazorpayApiError";
    }
  }
  return {
    getSubscription: vi.fn(),
    getSubscriptionInvoices: vi.fn(),
    issueInvoice: vi.fn(),
    pauseSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    RazorpayApiError: RazorpayApiErrorMock,
  };
});

vi.mock("../razorpay/client.js", () => ({
  getSubscription: mocks.getSubscription,
  getSubscriptionInvoices: mocks.getSubscriptionInvoices,
  issueInvoice: mocks.issueInvoice,
  pauseSubscription: mocks.pauseSubscription,
  cancelSubscription: mocks.cancelSubscription,
  RazorpayApiError: mocks.RazorpayApiError,
}));

import { executeRazorpayAction } from "./actions.js";
import type { RazorpaySubscription } from "../razorpay/client.js";

function sub(overrides: Partial<RazorpaySubscription> = {}): RazorpaySubscription {
  return {
    id: "sub_1",
    entity: "subscription",
    status: "active",
    short_url: "https://rzp.io/x/abc",
    ...overrides,
  };
}

describe("executeRazorpayAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns noop when there is no razorpay subscription id", async () => {
    const result = await executeRazorpayAction({
      decision: "retry",
      razorpaySubscriptionId: null,
    });
    expect(result.action).toBe("razorpay.noop");
    expect(result.success).toBe(false);
    expect(mocks.getSubscription).not.toHaveBeenCalled();
  });

  it("retry issues the known invoice and returns shortUrl", async () => {
    mocks.getSubscription.mockResolvedValue(sub());
    mocks.issueInvoice.mockResolvedValue({
      id: "inv_2",
      entity: "invoice",
      status: "issued",
      short_url: "https://rzp.io/x/retry",
    });

    const result = await executeRazorpayAction({
      decision: "retry",
      razorpaySubscriptionId: "sub_1",
      invoiceId: "inv_2",
    });

    expect(result.action).toBe("razorpay.retry");
    expect(result.success).toBe(true);
    expect(mocks.issueInvoice).toHaveBeenCalledWith("inv_2");
    expect(result.shortUrl).toBe("https://rzp.io/x/retry");
  });

  it("retry resolves an issuable invoice when none is provided", async () => {
    mocks.getSubscription.mockResolvedValue(sub());
    mocks.getSubscriptionInvoices.mockResolvedValue([
      { id: "inv_pending", entity: "invoice", status: "pending" },
    ]);
    mocks.issueInvoice.mockResolvedValue({
      id: "inv_pending",
      entity: "invoice",
      status: "issued",
      short_url: "https://rzp.io/x/pending",
    });

    const result = await executeRazorpayAction({
      decision: "retry",
      razorpaySubscriptionId: "sub_1",
    });

    expect(result.success).toBe(true);
    expect(mocks.getSubscriptionInvoices).toHaveBeenCalledWith("sub_1");
    expect(mocks.issueInvoice).toHaveBeenCalledWith("inv_pending");
  });

  it("retry fails gracefully when no issuable invoice exists", async () => {
    mocks.getSubscription.mockResolvedValue(sub());
    mocks.getSubscriptionInvoices.mockResolvedValue([]);

    const result = await executeRazorpayAction({
      decision: "retry",
      razorpaySubscriptionId: "sub_1",
    });

    expect(result.action).toBe("razorpay.retry");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no issuable invoice/i);
  });

  it("adjust returns the subscription short_url", async () => {
    mocks.getSubscription.mockResolvedValue(
      sub({ status: "active", short_url: "https://rzp.io/x/adjust" })
    );

    const result = await executeRazorpayAction({
      decision: "adjust",
      razorpaySubscriptionId: "sub_1",
    });

    expect(result.action).toBe("razorpay.adjust");
    expect(result.success).toBe(true);
    expect(result.shortUrl).toBe("https://rzp.io/x/adjust");
    expect(mocks.getSubscription).toHaveBeenCalledWith("sub_1");
  });

  it("adjust fails when the subscription has no short_url", async () => {
    mocks.getSubscription.mockResolvedValue(
      sub({ status: "active", short_url: null })
    );

    const result = await executeRazorpayAction({
      decision: "adjust",
      razorpaySubscriptionId: "sub_1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no short_url/i);
  });

  it("halt on a terminal state does not call the provider", async () => {
    mocks.getSubscription.mockResolvedValue(sub({ status: "cancelled" }));

    const result = await executeRazorpayAction({
      decision: "halt",
      razorpaySubscriptionId: "sub_1",
    });

    expect(result.action).toBe("razorpay.halt");
    expect(result.success).toBe(true);
    expect(result.providerStatus).toBe("cancelled");
    expect(mocks.pauseSubscription).not.toHaveBeenCalled();
    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
  });

  it("halt pauses an active subscription", async () => {
    mocks.getSubscription.mockResolvedValue(sub({ status: "authenticated" }));
    mocks.pauseSubscription.mockResolvedValue(
      sub({ status: "paused", short_url: "https://rzp.io/x/paused" })
    );

    const result = await executeRazorpayAction({
      decision: "halt",
      razorpaySubscriptionId: "sub_1",
    });

    expect(result.action).toBe("razorpay.halt");
    expect(result.success).toBe(true);
    expect(result.providerStatus).toBe("paused");
    expect(mocks.pauseSubscription).toHaveBeenCalledWith("sub_1");
    expect(mocks.cancelSubscription).not.toHaveBeenCalled();
  });

  it("halt falls back to cancel when pause is not enabled", async () => {
    mocks.getSubscription.mockResolvedValue(sub({ status: "created" }));
    mocks.pauseSubscription.mockRejectedValue(
      new mocks.RazorpayApiError("feature is not enabled")
    );
    mocks.cancelSubscription.mockResolvedValue(sub({ status: "cancelled" }));

    const result = await executeRazorpayAction({
      decision: "halt",
      razorpaySubscriptionId: "sub_1",
    });

    expect(result.action).toBe("razorpay.cancel");
    expect(result.success).toBe(true);
    expect(result.providerStatus).toBe("cancelled");
    expect(mocks.cancelSubscription).toHaveBeenCalledWith("sub_1", false);
  });

  it("unmapped decision returns a failure", async () => {
    mocks.getSubscription.mockResolvedValue(sub());

    const result = await executeRazorpayAction({
      decision: "contact_support",
      razorpaySubscriptionId: "sub_1",
    });

    expect(result.action).toBe("razorpay.contact_support");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no razorpay action mapped/i);
  });
});
