import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { escalations } from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";
import { clampString, parseJsonBody } from "./validation.js";
import { checkSlaBreaches } from "../escalations.js";

const escalationsRoute = new Hono();

escalationsRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );
  const status = c.req.query("status");
  const domain = c.req.query("domain");

  const conditions = [];
  if (status) conditions.push(eq(escalations.status, status));
  if (domain) conditions.push(eq(escalations.domain, domain));
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(escalations)
    .where(where);

  const data = await db
    .select()
    .from(escalations)
    .where(where)
    .orderBy(desc(escalations.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({ data, meta: paginationMeta(page, limit, count) });
});

escalationsRoute.patch("/:id", async (c) => {
  const id = c.req.param("id");

  const parsed = await parseJsonBody<{ status?: string; owner?: string }>(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.value;

  if (body.status && !["open", "acked", "resolved"].includes(body.status)) {
    return c.json({ error: "status must be open, acked, or resolved" }, 400);
  }
  const owner: string | undefined =
    body.owner === undefined ? undefined : clampString(body.owner, 255) ?? undefined;
  if (body.owner !== undefined && owner === undefined) {
    return c.json({ error: "owner must be 1-255 chars" }, 400);
  }

  const [row] = await db
    .select({ id: escalations.id })
    .from(escalations)
    .where(eq(escalations.id, id));

  if (!row) return c.json({ error: "Escalation not found" }, 404);

  const [updated] = await db
    .update(escalations)
    .set({
      status: body.status || undefined,
      owner,
      updatedAt: new Date(),
    })
    .where(eq(escalations.id, id))
    .returning();

  return c.json({ data: updated });
});

escalationsRoute.post("/check-sla", async (c) => {
  const result = await checkSlaBreaches();
  return c.json({ data: result });
});

export default escalationsRoute;
