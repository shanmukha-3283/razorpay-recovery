import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const insertReturning = vi.hoisted(() => vi.fn());
const selectWhere = vi.hoisted(() => vi.fn());
const dispatchWebhookEvent = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => insertReturning(),
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => selectWhere(),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => [],
      }),
    }),
  },
}));

vi.mock("../handlers/index.js", () => ({
  dispatchWebhookEvent,
}));

import webhooks from "./webhooks.js";
import { Hono } from "hono";

const SECRET = "test_webhook_secret";

function makeApp() {
  const app = new Hono();
  app.route("/api/webhooks", webhooks);
  return app;
}

function signedBody(body: string) {
  return crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

const body = JSON.stringify({
  entity: "event",
  id: "evt_dup_1",
  event: "payment.failed",
  payload: { payment: { id: "pay_1", status: "failed" } },
});

function postWebhook(app: Hono) {
  return app.request("/api/webhooks/razorpay", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signedBody(body),
    },
  });
}

describe("POST /api/webhooks/razorpay idempotency", () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    insertReturning.mockReset();
    selectWhere.mockReset();
    dispatchWebhookEvent.mockReset();
  });

  it("processes the first delivery", async () => {
    insertReturning.mockResolvedValue([{ id: "raw_1" }]);
    dispatchWebhookEvent.mockResolvedValue(true);

    const res = await postWebhook(makeApp());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(dispatchWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a duplicate event id without re-processing", async () => {
    insertReturning.mockResolvedValue([]);
    selectWhere.mockResolvedValue([{ id: "raw_existing" }]);

    const res = await postWebhook(makeApp());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(dispatchWebhookEvent).not.toHaveBeenCalled();
  });

  it("accepts a fresh event carrying created_at", async () => {
    insertReturning.mockResolvedValue([{ id: "raw_1" }]);
    dispatchWebhookEvent.mockResolvedValue(true);

    const fresh = JSON.stringify({
      entity: "event",
      id: "evt_fresh_1",
      event: "payment.failed",
      created_at: Math.floor(Date.now() / 1000),
      payload: { payment: { id: "pay_1", status: "failed" } },
    });
    const res = await makeApp().request("/api/webhooks/razorpay", {
      method: "POST",
      body: fresh,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signedBody(fresh),
      },
    });

    expect(res.status).toBe(200);
    expect(dispatchWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale replayed event", async () => {
    const stale = JSON.stringify({
      entity: "event",
      id: "evt_stale_1",
      event: "payment.failed",
      created_at: Math.floor(Date.now() / 1000) - 48 * 60 * 60,
      payload: { payment: { id: "pay_1", status: "failed" } },
    });
    const res = await makeApp().request("/api/webhooks/razorpay", {
      method: "POST",
      body: stale,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signedBody(stale),
      },
    });

    expect(res.status).toBe(400);
    expect(dispatchWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON even with a valid signature", async () => {
    const raw = "{not-json";
    const res = await makeApp().request("/api/webhooks/razorpay", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": signedBody(raw),
      },
    });

    expect(res.status).toBe(400);
    expect(dispatchWebhookEvent).not.toHaveBeenCalled();
  });
});
