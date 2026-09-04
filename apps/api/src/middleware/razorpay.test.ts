import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import crypto from "node:crypto";
import { razorpayWebhook } from "./razorpay.js";

const SECRET = "test_webhook_secret";

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function makeApp() {
  const app = new Hono();
  app.post(
    "/razorpay",
    razorpayWebhook,
    (c) => {
      const event = c.get("webhookEvent");
      const rawBody = c.get("rawBody");
      return c.json({ eventType: event.event, rawBody }, 200);
    }
  );
  return app;
}

const body = JSON.stringify({
  entity: "event",
  id: "evt_123",
  event: "payment.failed",
  payload: { payment: { id: "pay_123", status: "failed" } },
});

describe("razorpayWebhook middleware", () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  });

  it("rejects when no signature header is present", async () => {
    const res = await makeApp().request("/razorpay", {
      method: "POST",
      body,
    });
    expect(res.status).toBe(400);
  });

  it("returns 500 when the webhook secret is not configured", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const res = await makeApp().request("/razorpay", {
      method: "POST",
      body,
      headers: { "x-razorpay-signature": sign(body, SECRET) },
    });
    expect(res.status).toBe(500);
  });

  it("rejects a wrong signature", async () => {
    const res = await makeApp().request("/razorpay", {
      method: "POST",
      body,
      headers: { "x-razorpay-signature": "deadbeefdeadbeefdeadbeefdeadbeef" },
    });
    expect(res.status).toBe(400);
  });

  it("accepts a valid signature and parses the event", async () => {
    const res = await makeApp().request("/razorpay", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": sign(body, SECRET),
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { eventType: string; rawBody: string };
    expect(json.eventType).toBe("payment.failed");
    expect(JSON.parse(json.rawBody)).toEqual(JSON.parse(body));
  });
});
