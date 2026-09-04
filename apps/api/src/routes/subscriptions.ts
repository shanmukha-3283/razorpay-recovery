import { Hono } from "hono";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  customers,
  payments,
  recoveryAttempts,
  subscriptions,
} from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";
import { getSubscription, RazorpayApiError } from "../razorpay/client.js";
import { syncSubscription } from "../handlers/sync.js";
import { scheduleRecovery } from "../queue/scheduler.js";

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
      customerName: customers.name,
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
      customerName: customers.name,
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
        invoiceId: payments.invoiceId,
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

subscriptionsRoute.post("/:id/sync", async (c) => {
  const id = c.req.param("id");

  const [sub] = await db
    .select({
      id: subscriptions.id,
      razorpaySubscriptionId: subscriptions.razorpaySubscriptionId,
      customerId: subscriptions.customerId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.id, id));

  if (!sub) return c.json({ error: "Subscription not found" }, 404);
  if (!sub.razorpaySubscriptionId) {
    return c.json({ error: "Subscription has no Razorpay id to sync" }, 400);
  }

  let remote;
  try {
    remote = await getSubscription(sub.razorpaySubscriptionId);
  } catch (err) {
    if (err instanceof RazorpayApiError) {
      return c.json({ error: err.message, code: err.code }, 502);
    }
    throw err;
  }

  await syncSubscription(sub.razorpaySubscriptionId, {
    customerId: sub.customerId,
    planId: remote.plan_id ?? null,
    status: remote.status,
    currentStart: remote.current_start ?? undefined,
    currentEnd: remote.current_end ?? undefined,
    paidCount: remote.paid_count ?? undefined,
    totalCount: remote.total_count ?? undefined,
  });

  return c.json({ data: { id: sub.id, status: remote.status, synced: true } });
});

subscriptionsRoute.post("/:id/recover", async (c) => {
  const id = c.req.param("id");

  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.id, id));

  if (!sub) return c.json({ error: "Subscription not found" }, 404);

  // Amount resolution: explicit body override, else the latest failed
  // payment for this subscription, else a zero-amount fallback.
  let body: { amount?: number; currency?: string } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }

  let amount = typeof body.amount === "number" ? body.amount : null;
  let currency = body.currency ?? null;

  if (amount === null || currency === null) {
    const [latestFailed] = await db
      .select({ amount: payments.amount, currency: payments.currency })
      .from(payments)
      .where(
        and(
          eq(payments.subscriptionId, id),
          eq(payments.status, "failed")
        )
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);

    if (amount === null) amount = latestFailed?.amount ?? 0;
    if (currency === null) currency = latestFailed?.currency ?? "INR";
  }

  // Reuses the webhook scheduling path: the halted/cancelled guard and
  // the 3-attempt/72h cap apply identically to manual triggers.
  const decision = await scheduleRecovery(id, amount, currency);

  if (!decision.allowed || !decision.scheduledFor) {
    return c.json(
      {
        error: `Recovery not allowed: ${decision.reason}`,
        scheduled: false,
        reason: decision.reason,
        attemptNumber: decision.attemptNumber,
      },
      409
    );
  }

  return c.json({
    data: {
      scheduled: true,
      attemptNumber: decision.attemptNumber,
      scheduledFor: decision.scheduledFor,
      reason: decision.reason,
    },
  });
});

export default subscriptionsRoute;
