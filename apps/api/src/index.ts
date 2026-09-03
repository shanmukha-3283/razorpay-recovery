import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import webhooks from "./routes/webhooks.js";
import subscriptionsRoute from "./routes/subscriptions.js";
import eventsRoute from "./routes/events.js";
import recoveryRoute from "./routes/recovery.js";
import auditRoute from "./routes/audit.js";
import statsRoute from "./routes/stats.js";
import deliveriesRoute from "./routes/deliveries.js";
import { startWorker } from "./queue/worker.js";

const app = new Hono();

app.use("*", logger());

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.route("/api/webhooks", webhooks);
app.route("/api/subscriptions", subscriptionsRoute);
app.route("/api/events", eventsRoute);
app.route("/api/recovery-attempts", recoveryRoute);
app.route("/api/audit-ledger", auditRoute);
app.route("/api/stats", statsRoute);
app.route("/api/deliveries", deliveriesRoute);

startWorker();

const port = parseInt(process.env.PORT || "3000");

console.log(`Server starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
