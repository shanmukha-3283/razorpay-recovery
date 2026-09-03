import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLedger } from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";

const auditRoute = new Hono();

auditRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLedger);

  const data = await db
    .select({
      id: auditLedger.id,
      recoveryAttemptId: auditLedger.recoveryAttemptId,
      action: auditLedger.action,
      amount: auditLedger.amount,
      timestamp: auditLedger.timestamp,
      metadata: auditLedger.metadata,
    })
    .from(auditLedger)
    .orderBy(auditLedger.timestamp)
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({ data, meta: paginationMeta(page, limit, count) });
});

export default auditRoute;
