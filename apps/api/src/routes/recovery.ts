import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { recoveryAttempts, subscriptions } from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";

const recoveryRoute = new Hono();

recoveryRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );
  const status = c.req.query("status");

  const conditions = [];
  if (status) conditions.push(eq(recoveryAttempts.status, status));

  const where = conditions.length ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recoveryAttempts)
    .where(where);

  const data = await db
    .select({
      id: recoveryAttempts.id,
      attemptNumber: recoveryAttempts.attemptNumber,
      action: recoveryAttempts.action,
      status: recoveryAttempts.status,
      amount: recoveryAttempts.amount,
      details: recoveryAttempts.details,
      createdAt: recoveryAttempts.createdAt,
      nextAttemptAt: recoveryAttempts.nextAttemptAt,
      subscriptionId: subscriptions.id,
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
    })
    .from(recoveryAttempts)
    .leftJoin(subscriptions, eq(recoveryAttempts.subscriptionId, subscriptions.id))
    .where(where)
    .orderBy(recoveryAttempts.createdAt)
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({ data, meta: paginationMeta(page, limit, count) });
});

export default recoveryRoute;
