import { Hono } from "hono";
import { db } from "../db/index.js";
import { rawEvents } from "../db/schema.js";
import { razorpayWebhook } from "../middleware/razorpay.js";

type Variables = {
  rawBody: string;
  webhookEvent: Record<string, unknown>;
};

const webhooks = new Hono<{ Variables: Variables }>();

webhooks.post("/razorpay", razorpayWebhook, async (c) => {
  const event = c.get("webhookEvent");

  const eventType = event.event as string;
  const payload = event.payload as Record<string, unknown>;

  await db.insert(rawEvents).values({
    eventType,
    razorpayEventId: (event.id as string) || null,
    payload,
  });

  console.log(`Received webhook: ${eventType}`);

  return c.json({ received: true }, 200);
});

export default webhooks;
