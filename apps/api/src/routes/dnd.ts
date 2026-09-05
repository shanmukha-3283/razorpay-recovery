import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dndEntries } from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";
import { clampString, isValidEmail, parseJsonBody } from "./validation.js";

const dndRoute = new Hono();

dndRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(dndEntries);

  const data = await db
    .select()
    .from(dndEntries)
    .orderBy(desc(dndEntries.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({ data, meta: paginationMeta(page, limit, count) });
});

dndRoute.post("/", async (c) => {
  const parsed = await parseJsonBody<{ email?: string; reason?: string }>(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.value;

  const email = isValidEmail(body.email)
    ? (body.email as string).trim().toLowerCase()
    : null;
  if (!email) {
    return c.json({ error: "a valid email is required" }, 400);
  }
  const reason =
    body.reason === undefined ? null : clampString(body.reason, 500);
  if (body.reason !== undefined && reason === null) {
    return c.json({ error: "reason must be 1-500 chars" }, 400);
  }

  const [row] = await db
    .insert(dndEntries)
    .values({ email, reason })
    .onConflictDoNothing({ target: dndEntries.email })
    .returning();

  if (!row) {
    return c.json({ data: { email, duplicate: true } });
  }
  return c.json({ data: row }, 201);
});

dndRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const [row] = await db
    .select({ id: dndEntries.id })
    .from(dndEntries)
    .where(eq(dndEntries.id, id));

  if (!row) return c.json({ error: "DND entry not found" }, 404);

  await db.delete(dndEntries).where(eq(dndEntries.id, id));
  return c.json({ data: { id, deleted: true } });
});

export default dndRoute;
