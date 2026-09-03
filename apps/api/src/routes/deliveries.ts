import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { messageDeliveries, subscriptions } from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";

const deliveriesRoute = new Hono();

deliveriesRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );
  const subscriptionId = c.req.query("subscription_id");
  const status = c.req.query("status");
  const channel = c.req.query("channel");

  const conditions = [];
  if (subscriptionId) conditions.push(eq(messageDeliveries.subscriptionId, subscriptionId));
  if (status) conditions.push(eq(messageDeliveries.status, status));
  if (channel) conditions.push(eq(messageDeliveries.channel, channel));

  const where = conditions.length ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messageDeliveries)
    .where(where);

  const data = await db
    .select({
      id: messageDeliveries.id,
      channel: messageDeliveries.channel,
      toEmail: messageDeliveries.toEmail,
      status: messageDeliveries.status,
      providerMessageId: messageDeliveries.providerMessageId,
      error: messageDeliveries.error,
      createdAt: messageDeliveries.createdAt,
      sentAt: messageDeliveries.sentAt,
      subscriptionId: messageDeliveries.subscriptionId,
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
    })
    .from(messageDeliveries)
    .leftJoin(subscriptions, eq(messageDeliveries.subscriptionId, subscriptions.id))
    .where(where)
    .orderBy(messageDeliveries.createdAt)
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({ data, meta: paginationMeta(page, limit, count) });
});

export default deliveriesRoute;
