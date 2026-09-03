import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { rawEvents } from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";

const eventsRoute = new Hono();

eventsRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );
  const eventType = c.req.query("event_type");
  const processed = c.req.query("processed");

  const conditions = [];
  if (eventType) conditions.push(eq(rawEvents.eventType, eventType));
  if (processed === "true") conditions.push(sql`${rawEvents.processedAt} IS NOT NULL`);
  if (processed === "false") conditions.push(sql`${rawEvents.processedAt} IS NULL`);

  const where = conditions.length ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(rawEvents)
    .where(where);

  const data = await db
    .select({
      id: rawEvents.id,
      eventType: rawEvents.eventType,
      razorpayEventId: rawEvents.razorpayEventId,
      receivedAt: rawEvents.receivedAt,
      processedAt: rawEvents.processedAt,
    })
    .from(rawEvents)
    .where(where)
    .orderBy(rawEvents.receivedAt)
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({ data, meta: paginationMeta(page, limit, count) });
});

export default eventsRoute;
