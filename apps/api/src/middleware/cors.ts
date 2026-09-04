import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

/**
 * Cross-origin setup for split deployments (e.g. static frontend on one
 * host, API on another). When WEB_ORIGIN is unset, same-origin serving
 * (Vite proxy / nginx) needs no CORS headers and this is a pass-through.
 */
export function webOrigin(): string | null {
  const origin = (process.env.WEB_ORIGIN ?? "").trim();
  return origin.length > 0 ? origin : null;
}

export function corsMiddleware(): MiddlewareHandler {
  const origin = webOrigin();
  if (!origin) {
    return async (_c, next) => {
      await next();
    };
  }
  return cors({
    origin,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  });
}
