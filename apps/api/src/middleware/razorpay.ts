import { createMiddleware } from "hono/factory";
import crypto from "node:crypto";

type Variables = {
  rawBody: string;
  webhookEvent: Record<string, unknown>;
};

/** Max webhook body (256 KB) — Razorpay events are a few KB. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * Max event age (24h). Razorpay retries a delivery for hours, so the window
 * must tolerate legitimate redelivery — but a signed payload captured today
 * must not be replayable forever.
 */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

export const razorpayWebhook = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const signature = c.req.header("x-razorpay-signature");
    if (!signature) {
      return c.json({ error: "Invalid signature" }, 400);
    }

    const rawBody = await c.req.text();
    if (rawBody.length > MAX_WEBHOOK_BYTES) {
      return c.json({ error: "Webhook body too large" }, 400);
    }

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      return c.json({ error: "Server configuration error" }, 500);
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const a = Buffer.from(expected);
    const b = Buffer.from(signature);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return c.json({ error: "Invalid signature" }, 400);
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return c.json({ error: "Invalid event shape" }, 400);
    }

    // Replay guard: real Razorpay events carry `created_at` (unix seconds).
    // Enforce the age window when present; accept when absent (simulators
    // and older payloads omit it) so verification stays the hard gate.
    const createdAt = event.created_at;
    if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
      const ageMs = Date.now() - createdAt * 1000;
      if (ageMs < -5 * 60 * 1000 || ageMs > MAX_EVENT_AGE_MS) {
        return c.json({ error: "Stale webhook event" }, 400);
      }
    }

    c.set("rawBody", rawBody);
    c.set("webhookEvent", event);

    await next();
  }
);
