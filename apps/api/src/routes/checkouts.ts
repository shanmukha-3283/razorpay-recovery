import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  abandonedCheckouts,
  payments,
  recoveryAttempts,
} from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";
import { getOrder, RazorpayApiError } from "../razorpay/client.js";
import { scheduleRecovery } from "../queue/scheduler.js";

const checkoutsRoute = new Hono();

type AbandonBody = {
  order_id?: string;
  amount?: number;
  currency?: string;
  email?: string | null;
  contact?: string | null;
  short_url?: string | null;
};

checkoutsRoute.post("/abandoned", async (c) => {
  let body: AbandonBody;
  try {
    body = (await c.req.json()) as AbandonBody;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const orderId = body.order_id || "";
  if (!orderId) {
    return c.json({ error: "order_id is required" }, 400);
  }

  // Best-effort verification against Razorpay when credentials exist.
  // Missing credentials (or lookup failure) fall back to the payload.
  let remote: Awaited<ReturnType<typeof getOrder>> | null = null;
  try {
    remote = await getOrder(orderId);
  } catch (err) {
    if (!(err instanceof RazorpayApiError)) throw err;
    remote = null;
  }

  const amount = body.amount ?? remote?.amount ?? 0;
  const currency = body.currency ?? remote?.currency ?? "INR";

  // Already paid? Record recovered without scheduling anything.
  const [captured] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(eq(payments.orderId, orderId), eq(payments.status, "captured"))
    )
    .limit(1);

  if (captured) {
    const [row] = await db
      .insert(abandonedCheckouts)
      .values({
        razorpayOrderId: orderId,
        amount,
        currency,
        email: body.email || null,
        contact: body.contact || null,
        shortUrl: body.short_url || null,
        status: "recovered",
      })
      .onConflictDoUpdate({
        target: abandonedCheckouts.razorpayOrderId,
        set: { status: "recovered", updatedAt: new Date() },
      })
      .returning({ id: abandonedCheckouts.id });
    return c.json({ data: { id: row.id, status: "recovered", scheduled: false } });
  }

  const [row] = await db
    .insert(abandonedCheckouts)
    .values({
      razorpayOrderId: orderId,
      amount,
      currency,
      email: body.email || null,
      contact: body.contact || null,
      shortUrl: body.short_url || null,
      status: "abandoned",
    })
    .onConflictDoUpdate({
      target: abandonedCheckouts.razorpayOrderId,
      set: {
        email: body.email || undefined,
        contact: body.contact || undefined,
        shortUrl: body.short_url || undefined,
        updatedAt: new Date(),
      },
    })
    .returning({ id: abandonedCheckouts.id, status: abandonedCheckouts.status });

  // Re-ingest of an in-flight checkout just refreshes contact details.
  // If a reminder is already pending, don't schedule a duplicate.
  const [pending] = await db
    .select({ id: recoveryAttempts.id })
    .from(recoveryAttempts)
    .where(
      and(
        eq(recoveryAttempts.domain, "checkout"),
        eq(recoveryAttempts.domainId, row.id),
        eq(recoveryAttempts.status, "pending")
      )
    )
    .limit(1);

  if (pending) {
    return c.json({
      data: {
        id: row.id,
        status: row.status,
        scheduled: false,
        reason: "already_scheduled",
      },
    });
  }

  // Otherwise the terminal guard + cap inside scheduleRecovery prevent
  // re-arming of recovered/expired checkouts.
  const decision = await scheduleRecovery({
    domain: "checkout",
    ownerId: row.id,
    amount,
    currency,
  });

  if (!decision.allowed || !decision.scheduledFor) {
    return c.json(
      {
        data: {
          id: row.id,
          status: row.status,
          scheduled: false,
          reason: decision.reason,
        },
      },
      200
    );
  }

  return c.json({
    data: {
      id: row.id,
      status: row.status,
      scheduled: true,
      attemptNumber: decision.attemptNumber,
      scheduledFor: decision.scheduledFor,
      reason: decision.reason,
    },
  });
});

checkoutsRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );
  const status = c.req.query("status");

  const where = status
    ? eq(abandonedCheckouts.status, status)
    : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(abandonedCheckouts)
    .where(where);

  const data = await db
    .select({
      id: abandonedCheckouts.id,
      razorpayOrderId: abandonedCheckouts.razorpayOrderId,
      amount: abandonedCheckouts.amount,
      currency: abandonedCheckouts.currency,
      email: abandonedCheckouts.email,
      contact: abandonedCheckouts.contact,
      status: abandonedCheckouts.status,
      createdAt: abandonedCheckouts.createdAt,
      updatedAt: abandonedCheckouts.updatedAt,
    })
    .from(abandonedCheckouts)
    .where(where)
    .orderBy(desc(abandonedCheckouts.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({ data, meta: paginationMeta(page, limit, count) });
});

checkoutsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [row] = await db
    .select({
      id: abandonedCheckouts.id,
      razorpayOrderId: abandonedCheckouts.razorpayOrderId,
      amount: abandonedCheckouts.amount,
      currency: abandonedCheckouts.currency,
      email: abandonedCheckouts.email,
      contact: abandonedCheckouts.contact,
      shortUrl: abandonedCheckouts.shortUrl,
      status: abandonedCheckouts.status,
      createdAt: abandonedCheckouts.createdAt,
      updatedAt: abandonedCheckouts.updatedAt,
    })
    .from(abandonedCheckouts)
    .where(eq(abandonedCheckouts.id, id));

  if (!row) return c.json({ error: "Checkout not found" }, 404);

  const attempts = await db
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
    .where(
      and(
        eq(recoveryAttempts.domain, "checkout"),
        eq(recoveryAttempts.domainId, id)
      )
    )
    .orderBy(recoveryAttempts.createdAt);

  return c.json({ data: { ...row, recoveryAttempts: attempts } });
});

export default checkoutsRoute;
