import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { rawEvents } from "../db/schema.js";
import { razorpayWebhook } from "../middleware/razorpay.js";
import { dispatchWebhookEvent } from "../handlers/index.js";

type Variables = {
  rawBody: string;
  webhookEvent: Record<string, unknown>;
};

const webhooks = new Hono<{ Variables: Variables }>();

webhooks.post("/razorpay", razorpayWebhook, async (c) => {
  const event = c.get("webhookEvent");

  const eventType = event.event as string;
  const payload = event.payload as Record<string, unknown>;

  const [rawEvent] = await db
    .insert(rawEvents)
    .values({
      eventType,
      razorpayEventId: (event.id as string) || null,
      payload,
    })
    .returning({ id: rawEvents.id });

  let handledSuccessfully = false;
  try {
    handledSuccessfully = await dispatchWebhookEvent(eventType, {
      payload,
      rawEventId: rawEvent.id,
    });
  } catch (err) {
    console.error(`Error handling webhook event ${eventType}:`, err);
  }

  if (handledSuccessfully) {
    await db
      .update(rawEvents)
      .set({ processedAt: new Date() })
      .where(eq(rawEvents.id, rawEvent.id));
  }

  console.log(`Received webhook: ${eventType}`);

  return c.json({ received: true }, 200);
});

export default webhooks;
