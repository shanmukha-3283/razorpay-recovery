import { Hono } from "hono";
import { and, eq, ilike, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  customers,
  payments,
  recoveryAttempts,
  subscriptions,
} from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";

const subscriptionsRoute = new Hono();

subscriptionsRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );
  const status = c.req.query("status");
  const planId = c.req.query("plan_id");

  const conditions = [];
  if (status) conditions.push(eq(subscriptions.status, status));
  if (planId) conditions.push(ilike(subscriptions.planId, `%${planId}%`));

  const where = conditions.length ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(where);

  const rows = await db
    .select({
      id: subscriptions.id,
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
      planId: subscriptions.planId,
      status: subscriptions.status,
      currentStart: subscriptions.currentStart,
      currentEnd: subscriptions.currentEnd,
      paidCount: subscriptions.paidCount,
      totalCount: subscriptions.totalCount,
      createdAt: subscriptions.createdAt,
      updatedAt: subscriptions.updatedAt,
      customerId: customers.id,
      customerEmail: customers.email,
      customerName: customers.contact,
    })
    .from(subscriptions)
    .leftJoin(customers, eq(subscriptions.customerId, customers.id))
    .where(where)
    .orderBy(subscriptions.createdAt)
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({
    data: rows,
    meta: paginationMeta(page, limit, count),
  });
});

subscriptionsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [row] = await db
    .select({
      id: subscriptions.id,
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
      planId: subscriptions.planId,
      status: subscriptions.status,
      currentStart: subscriptions.currentStart,
      currentEnd: subscriptions.currentEnd,
      paidCount: subscriptions.paidCount,
      totalCount: subscriptions.totalCount,
      createdAt: subscriptions.createdAt,
      updatedAt: subscriptions.updatedAt,
      customerId: customers.id,
      customerEmail: customers.email,
      customerContact: customers.contact,
    })
    .from(subscriptions)
    .leftJoin(customers, eq(subscriptions.customerId, customers.id))
    .where(eq(subscriptions.id, id));

  if (!row) return c.json({ error: "Subscription not found" }, 404);

  const [paymentsForSub, attemptsForSub] = await Promise.all([
    db
      .select({
        id: payments.id,
        razorpayPaymentId: payments.razorpayPaymentId,
        amount: payments.amount,
        currency: payments.currency,
        status: payments.status,
        method: payments.method,
        errorCode: payments.errorCode,
        errorDescription: payments.errorDescription,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.subscriptionId, id))
      .orderBy(payments.createdAt),
    db
      .select({
        id: recoveryAttempts.id,
        attemptNumber: recoveryAttempts.attemptNumber,
        action: recoveryAttempts.action,
        status: recoveryAttempts.status,
        amount: recoveryAttempts.amount,
        details: recoveryAttempts.details,
        createdAt: recoveryAttempts.createdAt,
        nextAttemptAt: recoveryAttempts.nextAttemptAt,
      })
      .from(recoveryAttempts)
      .where(eq(recoveryAttempts.subscriptionId, id))
      .orderBy(recoveryAttempts.createdAt),
  ]);

  return c.json({
    data: { ...row, payments: paymentsForSub, recoveryAttempts: attemptsForSub },
  });
});

export default subscriptionsRoute;
