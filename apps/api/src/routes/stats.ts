import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLedger, payments, rawEvents, recoveryAttempts, subscriptions } from "../db/schema.js";

const statsRoute = new Hono();

statsRoute.get("/", async (c) => {
  const [
    [{ totalSubscriptions }],
    [{ pendingSubscriptions }],
    [{ haltedSubscriptions }],
    [{ cancelledSubscriptions }],
    [{ activeSubscriptions }],
    [{ failedPayments }],
    [{ totalRawEvents }],
    [{ totalRecoveredAmount }],
    [{ retriesFired }],
    [{ lastRecoveredAt }],
  ] = await Promise.all([
    db.select({ totalSubscriptions: sql<number>`count(*)` }).from(subscriptions),
    db
      .select({ pendingSubscriptions: sql<number>`count(*)` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "pending")),
    db
      .select({ haltedSubscriptions: sql<number>`count(*)` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "halted")),
    db
      .select({ cancelledSubscriptions: sql<number>`count(*)` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "cancelled")),
    db
      .select({ activeSubscriptions: sql<number>`count(*)` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active")),
    db
      .select({ failedPayments: sql<number>`count(*)` })
      .from(payments)
      .where(eq(payments.status, "failed")),
    db.select({ totalRawEvents: sql<number>`count(*)` }).from(rawEvents),
    db.select({
      totalRecoveredAmount: sql<number>`coalesce(sum(amount), 0)`,
    }).from(auditLedger),
    db.select({ retriesFired: sql<number>`count(*)` }).from(recoveryAttempts),
    db.select({
      lastRecoveredAt: sql<Date | null>`max(timestamp)`,
    }).from(auditLedger),
  ]);

  return c.json({
    data: {
      totalSubscriptions: Number(totalSubscriptions),
      pendingSubscriptions: Number(pendingSubscriptions),
      haltedSubscriptions: Number(haltedSubscriptions),
      cancelledSubscriptions: Number(cancelledSubscriptions),
      activeSubscriptions: Number(activeSubscriptions),
      failedPayments: Number(failedPayments),
      totalRawEvents: Number(totalRawEvents),
      totalRecoveredAmount: Number(totalRecoveredAmount),
      retriesFired: Number(retriesFired),
      lastRecoveredAt,
    },
  });
});

export default statsRoute;
