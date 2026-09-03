import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import webhooks from "./routes/webhooks.js";

const app = new Hono();

app.use("*", logger());

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.route("/api/webhooks", webhooks);

const port = parseInt(process.env.PORT || "3000");

console.log(`Server starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
