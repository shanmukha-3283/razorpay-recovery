import { Hono } from "hono";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import Papa from "papaparse";
import { db } from "../db/index.js";
import {
  paymentPromises,
  receivableInvoices,
  recoveryAttempts,
} from "../db/schema.js";
import { parsePagination, paginationMeta } from "./pagination.js";
import {
  clampString,
  isValidAmount,
  isValidEmail,
  MAX_AMOUNT,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  parseJsonBody,
  sanitizeCurrency,
} from "./validation.js";
import { scheduleRecovery } from "../queue/scheduler.js";
import { checkPromiseBreaches } from "../queue/sweeps.js";

const receivablesRoute = new Hono();

type ReceivableBody = {
  external_id?: string;
  customer_name?: string | null;
  customer_email?: string | null;
  amount?: number;
  currency?: string;
  due_date?: string | null;
};

function parseDueDate(value: unknown): Date | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? "invalid" : d;
}

async function upsertInvoice(row: {
  externalId: string;
  customerName: string | null;
  customerEmail: string | null;
  amount: number;
  currency: string;
  dueDate: Date | null;
}) {
  const [invoice] = await db
    .insert(receivableInvoices)
    .values({
      externalId: row.externalId,
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      amount: row.amount,
      currency: row.currency,
      dueDate: row.dueDate,
      status: "overdue",
    })
    .onConflictDoUpdate({
      target: receivableInvoices.externalId,
      set: {
        // Never resurrect a paid invoice via re-import.
        customerName: row.customerName || undefined,
        customerEmail: row.customerEmail || undefined,
        amount: row.amount,
        currency: row.currency,
        dueDate: row.dueDate ?? undefined,
        updatedAt: new Date(),
      },
    })
    .returning({ id: receivableInvoices.id, status: receivableInvoices.status });

  return invoice;
}

async function maybeSchedule(invoiceId: string, amount: number, currency: string) {
  // Skip silently when a touch is already pending (re-import idempotency).
  const [pending] = await db
    .select({ id: recoveryAttempts.id })
    .from(recoveryAttempts)
    .where(
      and(
        eq(recoveryAttempts.domain, "receivable"),
        eq(recoveryAttempts.domainId, invoiceId),
        eq(recoveryAttempts.status, "pending")
      )
    )
    .limit(1);

  if (pending) {
    return { scheduled: false as const, reason: "already_scheduled" as const };
  }

  const decision = await scheduleRecovery({
    domain: "receivable",
    ownerId: invoiceId,
    amount,
    currency,
  });

  if (!decision.allowed || !decision.scheduledFor) {
    return { scheduled: false as const, reason: decision.reason };
  }

  return {
    scheduled: true as const,
    attemptNumber: decision.attemptNumber,
    scheduledFor: decision.scheduledFor,
    reason: decision.reason,
  };
}

receivablesRoute.post("/", async (c) => {
  const parsed = await parseJsonBody<ReceivableBody>(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.value;

  const externalId = (body.external_id || "").trim().slice(0, 255);
  if (!externalId) return c.json({ error: "external_id is required" }, 400);
  if (!isValidAmount(body.amount)) {
    return c.json(
      { error: `amount must be a finite number between 0 and ${MAX_AMOUNT}` },
      400
    );
  }
  const currency = body.currency
    ? sanitizeCurrency(body.currency)
    : "INR";
  if (!currency) {
    return c.json({ error: "currency must be a 3-letter ISO code" }, 400);
  }
  if (body.customer_email != null && !isValidEmail(body.customer_email)) {
    return c.json({ error: "customer_email is not valid" }, 400);
  }
  if (body.customer_name != null && clampString(body.customer_name, 255) === null) {
    return c.json({ error: "customer_name must be 1-255 chars" }, 400);
  }

  const dueDate = parseDueDate(body.due_date ?? null);
  if (dueDate === "invalid") {
    return c.json({ error: "due_date is not a valid date" }, 400);
  }

  const invoice = await upsertInvoice({
    externalId,
    customerName: body.customer_name?.trim() || null,
    customerEmail: body.customer_email?.trim().toLowerCase() || null,
    amount: body.amount,
    currency,
    dueDate,
  });

  if (invoice.status === "paid") {
    return c.json({ data: { id: invoice.id, status: "paid", scheduled: false } });
  }

  const scheduled = await maybeSchedule(invoice.id, body.amount, currency);
  return c.json({ data: { id: invoice.id, status: "overdue", ...scheduled } });
});

type CsvRow = Record<string, string>;

receivablesRoute.post("/import", async (c) => {
  const text = await c.req.text();
  if (!text.trim()) {
    return c.json({ error: "Empty CSV body" }, 400);
  }
  if (text.length > MAX_CSV_BYTES) {
    return c.json(
      { error: `CSV body too large (max ${MAX_CSV_BYTES} bytes)` },
      400
    );
  }

  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (parsed.errors.length > 0) {
    return c.json({ error: "CSV parse error" }, 400);
  }
  if (parsed.data.length > MAX_CSV_ROWS) {
    return c.json(
      { error: `Too many rows (max ${MAX_CSV_ROWS} per import)` },
      400
    );
  }

  const results: Array<{ external_id: string; ok: boolean; error?: string }> =
    [];

  for (const row of parsed.data) {
    const externalId = (row.external_id || "").trim().slice(0, 255);
    const amount = Number(row.amount);
    const dueDate = parseDueDate(row.due_date ?? null);
    const currency = row.currency?.trim()
      ? sanitizeCurrency(row.currency)
      : "INR";
    const customerEmail = row.customer_email?.trim().toLowerCase() || null;
    const customerName = row.customer_name?.trim() || null;

    if (!externalId) {
      results.push({ external_id: "", ok: false, error: "missing external_id" });
      continue;
    }
    if (!isValidAmount(amount)) {
      results.push({ external_id: externalId, ok: false, error: "invalid amount" });
      continue;
    }
    if (dueDate === "invalid") {
      results.push({ external_id: externalId, ok: false, error: "invalid due_date" });
      continue;
    }
    if (!currency) {
      results.push({ external_id: externalId, ok: false, error: "invalid currency" });
      continue;
    }
    if (customerEmail !== null && !isValidEmail(customerEmail)) {
      results.push({ external_id: externalId, ok: false, error: "invalid customer_email" });
      continue;
    }
    if (customerName !== null && clampString(customerName, 255) === null) {
      results.push({ external_id: externalId, ok: false, error: "invalid customer_name" });
      continue;
    }

    try {
      const invoice = await upsertInvoice({
        externalId,
        customerName,
        customerEmail,
        amount,
        currency,
        dueDate,
      });
      if (invoice.status !== "paid") {
        await maybeSchedule(invoice.id, amount, currency);
      }
      results.push({ external_id: externalId, ok: true });
    } catch (err) {
      console.error("CSV row insert failed:", err);
      results.push({
        external_id: externalId,
        ok: false,
        error: "insert failed",
      });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return c.json({
    data: { imported: okCount, failed: results.length - okCount, rows: results },
  });
});

receivablesRoute.post("/:id/promises", async (c) => {
  const id = c.req.param("id");

  const parsed = await parseJsonBody<{
    promised_amount?: number;
    promised_date?: string;
  }>(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.value;

  if (!body.promised_date || isNaN(new Date(body.promised_date).getTime())) {
    return c.json({ error: "promised_date must be a valid date" }, 400);
  }
  if (body.promised_amount !== undefined && !isValidAmount(body.promised_amount)) {
    return c.json(
      { error: `promised_amount must be a finite number between 0 and ${MAX_AMOUNT}` },
      400
    );
  }

  const [invoice] = await db
    .select({ id: receivableInvoices.id, status: receivableInvoices.status })
    .from(receivableInvoices)
    .where(eq(receivableInvoices.id, id));

  if (!invoice) return c.json({ error: "Invoice not found" }, 404);
  if (invoice.status === "paid") {
    return c.json({ error: "Invoice is already paid" }, 409);
  }

  const [promise] = await db
    .insert(paymentPromises)
    .values({
      invoiceId: id,
      promisedAmount: body.promised_amount ?? null,
      promisedDate: new Date(body.promised_date),
      status: "open",
    })
    .returning({ id: paymentPromises.id });

  await db
    .update(receivableInvoices)
    .set({ status: "promised", updatedAt: new Date() })
    .where(eq(receivableInvoices.id, id));

  return c.json({ data: { id: promise.id, invoiceId: id, status: "open" } });
});

receivablesRoute.post("/:id/mark-paid", async (c) => {
  const id = c.req.param("id");

  const [invoice] = await db
    .select({ id: receivableInvoices.id })
    .from(receivableInvoices)
    .where(eq(receivableInvoices.id, id));

  if (!invoice) return c.json({ error: "Invoice not found" }, 404);

  await db
    .update(receivableInvoices)
    .set({ status: "paid", updatedAt: new Date() })
    .where(eq(receivableInvoices.id, id));

  // A paid invoice keeps its promises.
  await db
    .update(paymentPromises)
    .set({ status: "kept" })
    .where(
      and(
        eq(paymentPromises.invoiceId, id),
        eq(paymentPromises.status, "open")
      )
    );

  return c.json({ data: { id, status: "paid" } });
});

receivablesRoute.post("/check-breaches", async (c) => {
  const result = await checkPromiseBreaches();
  return c.json({ data: result });
});

receivablesRoute.get("/", async (c) => {
  const { page, limit } = parsePagination(
    c.req.query("page"),
    c.req.query("limit")
  );
  const status = c.req.query("status");

  const where = status ? eq(receivableInvoices.status, status) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(receivableInvoices)
    .where(where);

  const data = await db
    .select({
      id: receivableInvoices.id,
      externalId: receivableInvoices.externalId,
      customerName: receivableInvoices.customerName,
      customerEmail: receivableInvoices.customerEmail,
      amount: receivableInvoices.amount,
      currency: receivableInvoices.currency,
      dueDate: receivableInvoices.dueDate,
      status: receivableInvoices.status,
      createdAt: receivableInvoices.createdAt,
      updatedAt: receivableInvoices.updatedAt,
    })
    .from(receivableInvoices)
    .where(where)
    .orderBy(desc(receivableInvoices.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({ data, meta: paginationMeta(page, limit, count) });
});

receivablesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [row] = await db
    .select({
      id: receivableInvoices.id,
      externalId: receivableInvoices.externalId,
      customerName: receivableInvoices.customerName,
      customerEmail: receivableInvoices.customerEmail,
      amount: receivableInvoices.amount,
      currency: receivableInvoices.currency,
      dueDate: receivableInvoices.dueDate,
      status: receivableInvoices.status,
      createdAt: receivableInvoices.createdAt,
      updatedAt: receivableInvoices.updatedAt,
    })
    .from(receivableInvoices)
    .where(eq(receivableInvoices.id, id));

  if (!row) return c.json({ error: "Invoice not found" }, 404);

  const [promises, attempts] = await Promise.all([
    db
      .select({
        id: paymentPromises.id,
        promisedAmount: paymentPromises.promisedAmount,
        promisedDate: paymentPromises.promisedDate,
        status: paymentPromises.status,
        createdAt: paymentPromises.createdAt,
      })
      .from(paymentPromises)
      .where(eq(paymentPromises.invoiceId, id))
      .orderBy(desc(paymentPromises.createdAt)),
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
      .where(
        and(
          eq(recoveryAttempts.domain, "receivable"),
          eq(recoveryAttempts.domainId, id)
        )
      )
      .orderBy(recoveryAttempts.createdAt),
  ]);

  return c.json({ data: { ...row, promises, recoveryAttempts: attempts } });
});

export default receivablesRoute;
