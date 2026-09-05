import type { Context } from "hono";

/**
 * Shared input-validation helpers for API routes.
 *
 * Policy: reject malformed/unbounded input at the edge with 400 so junk
 * never reaches the DB, the queue, or the audit ledger.
 */

/** Max money value in paise (₹1 crore). Amounts above this are rejected. */
export const MAX_AMOUNT = 1_000_000_000;

/** Max JSON request body (100 KB). */
export const MAX_JSON_BYTES = 100 * 1024;

/** Max CSV import body (256 KB). */
export const MAX_CSV_BYTES = 256 * 1024;

/** Max rows processed per CSV import. */
export const MAX_CSV_ROWS = 500;

/** Razorpay object ids are alphanumeric plus `_`/`-` (e.g. `order_…`). */
const PROVIDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** ISO currency codes: exactly 3 uppercase letters. */
const CURRENCY_RE = /^[A-Z]{3}$/;

/** Conservative email check that also rejects header-injection newlines. */
const EMAIL_RE = /^[^\s@\r\n]{1,200}@[^\s@\r\n]{1,200}\.[^\s@\r\n]{1,100}$/;

export function isValidAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_AMOUNT
  );
}

/** Uppercase-trim a currency code; returns null when malformed. */
export function sanitizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CURRENCY_RE.test(code) ? code : null;
}

export function isValidProviderId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_ID_RE.test(value);
}

export function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

/** Escape `%`, `_` and `\` so user input can't act as LIKE wildcards. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function clampString(
  value: unknown,
  maxLength: number
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  if (/[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

export type JsonBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Read a JSON body with an explicit byte cap. Returns ok:false when the
 * body is oversized or unparseable — callers map that to 400.
 */
export async function parseJsonBody<T>(
  c: Context,
  maxBytes = MAX_JSON_BYTES
): Promise<JsonBodyResult<T>> {
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return { ok: false, error: "Unreadable request body" };
  }
  if (text.length > maxBytes) {
    return { ok: false, error: "Request body too large" };
  }
  if (!text.trim()) {
    return { ok: true, value: {} as T };
  }
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
}
