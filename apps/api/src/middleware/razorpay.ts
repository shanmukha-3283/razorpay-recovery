import { createMiddleware } from "hono/factory";
import crypto from "node:crypto";

type Variables = {
  rawBody: string;
  webhookEvent: Record<string, unknown>;
};

export const razorpayWebhook = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const signature = c.req.header("x-razorpay-signature");
    if (!signature) {
      return c.json({ error: "Invalid signature" }, 400);
    }

    const rawBody = await c.req.text();

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

    const event = JSON.parse(rawBody);
    c.set("rawBody", rawBody);
    c.set("webhookEvent", event);

    await next();
  }
);
