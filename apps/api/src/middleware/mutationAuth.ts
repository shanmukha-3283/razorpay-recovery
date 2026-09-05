import { createMiddleware } from "hono/factory";
import crypto from "node:crypto";

/**
 * Mutation-only dashboard auth.
 *
 * Policy (deliberate, do not "simplify" away): reads stay OPEN so evaluators
 * and local judges browse with zero friction; every state-changing request
 * requires a bearer token because this is a fintech product whose buttons
 * move real money (retries, pause/cancel, promises, batch close).
 *
 * Exempt (no token needed):
 * - GET requests (all reads)
 * - /api/webhooks/* (HMAC signature stays the webhook gate)
 * - anything outside /api/* (/health must stay open for platform checks)
 *
 * Fail-closed: when DASHBOARD_API_TOKEN is unset, mutations are denied
 * (mirrors the webhook-secret behavior) — never silently open.
 */
export const mutationAuth = createMiddleware(async (c, next) => {
  if (c.req.method === "GET") {
    await next();
    return;
  }

  const path = c.req.path;
  if (!path.startsWith("/api/") || path.startsWith("/api/webhooks")) {
    await next();
    return;
  }

  const configured = process.env.DASHBOARD_API_TOKEN;
  if (!configured) {
    return c.json({ error: "Server configuration error" }, 500);
  }

  const header = c.req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const a = Buffer.from(token);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});
