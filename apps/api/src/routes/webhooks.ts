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
    .onConflictDoNothing({ target: rawEvents.razorpayEventId })
    .returning({ id: rawEvents.id });

  // Idempotency: Razorpay redelivers webhooks, and replays must not
  // re-process (which would double-schedule recovery). On a duplicate
  // event id, acknowledge without dispatching.
  if (!rawEvent) {
    const razorpayEventId = (event.id as string) || null;
    if (razorpayEventId) {
      const [existing] = await db
        .select({ id: rawEvents.id })
        .from(rawEvents)
        .where(eq(rawEvents.razorpayEventId, razorpayEventId));
      if (existing) {
        return c.json({ received: true, duplicate: true }, 200);
      }
    }
    // No row and no pre-existing match (e.g. null event id race):
    // fall through and acknowledge without processing.
    return c.json({ received: true }, 200);
  }

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
