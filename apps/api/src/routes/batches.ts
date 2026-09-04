import { Hono } from "hono";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  abandonedCheckouts,
  payments,
  receivableInvoices,
  recoveryAttempts,
  recoveryBatches,
  subscriptions,
} from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";
import type { RecoveryDomain } from "../queue/retryPolicy.js";

const batchesRoute = new Hono();

type BatchRow = {
  id: string;
  name: string;
  domain: string;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  closedAt: Date | null;
};

export type BatchReport = BatchRow & {
  touchedOwners: number;
  completedTouches: number;
  recoveredOwners: number;
  recoveredAmount: number;
  recoveryRate: number;
};

async function completedOwnerIds(
  batchId: string,
  domain: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ domainId: recoveryAttempts.domainId })
    .from(recoveryAttempts)
    .where(
      and(
        eq(recoveryAttempts.batchId, batchId),
        eq(recoveryAttempts.domain, domain),
        eq(recoveryAttempts.status, "completed")
      )
    );
  return rows
    .map((r) => r.domainId)
    .filter((id): id is string => id !== null);
}

async function completedTouchCount(batchId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recoveryAttempts)
    .where(
      and(
        eq(recoveryAttempts.batchId, batchId),
        eq(recoveryAttempts.status, "completed")
      )
    );
  return Number(count);
}

/**
 * Measured recovery: only money movement observed AFTER batch start counts.
 * Retried-but-unpaid work contributes touches, never dollars.
 */
async function measuredRecovery(
  batch: BatchRow,
  ownerIds: string[]
): Promise<{ recoveredOwners: number; recoveredAmount: number }> {
  if (ownerIds.length === 0) return { recoveredOwners: 0, recoveredAmount: 0 };
  const since = batch.createdAt;

  if (batch.domain === "subscription") {
    const pays = await db
      .select({ subscriptionId: payments.subscriptionId, amount: payments.amount })
      .from(payments)
      .where(
        and(
          inArray(payments.subscriptionId, ownerIds),
          eq(payments.status, "captured"),
          gte(payments.createdAt, since)
        )
      );
    const byOwner = new Map<string, number>();
    for (const p of pays) {
      if (!p.subscriptionId) continue;
      byOwner.set(p.subscriptionId, (byOwner.get(p.subscriptionId) ?? 0) + p.amount);
    }
    const recovered = [...byOwner.keys()].filter((id) => ownerIds.includes(id));
    return {
      recoveredOwners: recovered.length,
      recoveredAmount: recovered.reduce((s, id) => s + (byOwner.get(id) ?? 0), 0),
    };
  }

  if (batch.domain === "checkout") {
    const orders = await db
      .select({
        id: abandonedCheckouts.id,
        razorpayOrderId: abandonedCheckouts.razorpayOrderId,
      })
      .from(abandonedCheckouts)
      .where(inArray(abandonedCheckouts.id, ownerIds));
    const orderIds = orders
      .map((o) => o.razorpayOrderId)
      .filter((id): id is string => !!id);
    if (orderIds.length === 0) return { recoveredOwners: 0, recoveredAmount: 0 };

    const pays = await db
      .select({ orderId: payments.orderId, amount: payments.amount })
      .from(payments)
      .where(
        and(
          inArray(payments.orderId, orderIds),
          eq(payments.status, "captured"),
          gte(payments.createdAt, since)
        )
      );
    const orderToOwner = new Map(orders.map((o) => [o.razorpayOrderId, o.id]));
    const byOwner = new Map<string, number>();
    for (const p of pays) {
      const owner = p.orderId ? orderToOwner.get(p.orderId) : undefined;
      if (!owner) continue;
      byOwner.set(owner, (byOwner.get(owner) ?? 0) + p.amount);
    }
    const recovered = [...byOwner.keys()];
    return {
      recoveredOwners: recovered.length,
      recoveredAmount: recovered.reduce((s, id) => s + (byOwner.get(id) ?? 0), 0),
    };
  }

  // receivable: invoices flipped to paid after batch start.
  const paid = await db
    .select({ id: receivableInvoices.id, amount: receivableInvoices.amount })
    .from(receivableInvoices)
    .where(
      and(
        inArray(receivableInvoices.id, ownerIds),
        eq(receivableInvoices.status, "paid"),
        gte(receivableInvoices.updatedAt, since)
      )
    );
  return {
    recoveredOwners: paid.length,
    recoveredAmount: paid.reduce((s, r) => s + r.amount, 0),
  };
}

export async function batchReport(batch: BatchRow): Promise<BatchReport> {
  const ownerIds = await completedOwnerIds(batch.id, batch.domain);
  const [completedTouches, measured] = await Promise.all([
    completedTouchCount(batch.id),
    measuredRecovery(batch, ownerIds),
  ]);
  return {
    ...batch,
    touchedOwners: ownerIds.length,
    completedTouches,
    recoveredOwners: measured.recoveredOwners,
    recoveredAmount: measured.recoveredAmount,
    recoveryRate:
      ownerIds.length > 0 ? measured.recoveredOwners / ownerIds.length : 0,
  };
}

const DOMAINS: RecoveryDomain[] = ["subscription", "checkout", "receivable"];

batchesRoute.post("/", async (c) => {
  let body: { name?: string; domain?: string; created_by?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  if (!body.domain || !(DOMAINS as string[]).includes(body.domain)) {
    return c.json(
      { error: `domain must be one of: ${DOMAINS.join(", ")}` },
      400
    );
  }

  const [open] = await db
    .select({ id: recoveryBatches.id })
    .from(recoveryBatches)
    .where(
      and(
        eq(recoveryBatches.domain, body.domain),
        eq(recoveryBatches.status, "open")
      )
    )
    .limit(1);

  if (open) {
    return c.json(
      { error: "An open batch already exists for this domain" },
      409
    );
  }

  const [batch] = await db
    .insert(recoveryBatches)
    .values({
      name: body.name.trim(),
      domain: body.domain,
      status: "open",
      createdBy: body.created_by || null,
    })
    .returning();

  return c.json({ data: batch }, 201);
});

batchesRoute.post("/:id/close", async (c) => {
  const id = c.req.param("id");

  const [batch] = await db
    .select({ id: recoveryBatches.id, status: recoveryBatches.status })
    .from(recoveryBatches)
    .where(eq(recoveryBatches.id, id));

  if (!batch) return c.json({ error: "Batch not found" }, 404);

  await db
    .update(recoveryBatches)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(recoveryBatches.id, id));

  return c.json({ data: { id, status: "closed" } });
});

batchesRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );
  const domain = c.req.query("domain");

  const where = domain ? eq(recoveryBatches.domain, domain) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(recoveryBatches)
    .where(where);

  const rows = (await db
    .select()
    .from(recoveryBatches)
    .where(where)
    .orderBy(desc(recoveryBatches.createdAt))
    .limit(limit)
    .offset((page - 1) * limit)) as BatchRow[];

  const data = await Promise.all(rows.map(batchReport));

  return c.json({ data, meta: paginationMeta(page, limit, count) });
});

batchesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [row] = (await db
    .select()
    .from(recoveryBatches)
    .where(eq(recoveryBatches.id, id))) as BatchRow[];

  if (!row) return c.json({ error: "Batch not found" }, 404);

  const attempts = await db
    .select({
      id: recoveryAttempts.id,
      domain: recoveryAttempts.domain,
      domainId: recoveryAttempts.domainId,
      attemptNumber: recoveryAttempts.attemptNumber,
      action: recoveryAttempts.action,
      status: recoveryAttempts.status,
      amount: recoveryAttempts.amount,
      createdAt: recoveryAttempts.createdAt,
    })
    .from(recoveryAttempts)
    .where(eq(recoveryAttempts.batchId, id))
    .orderBy(recoveryAttempts.createdAt);

  return c.json({ data: { ...(await batchReport(row)), attempts } });
});

export default batchesRoute;
