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
import checkoutsRoute from "./routes/checkouts.js";
import { startWorker, closeWorker } from "./queue/worker.js";
import { resetStaleAttempts } from "./queue/sweep.js";
import { closeQueue } from "./queue/index.js";
import { closeDb } from "./db/index.js";

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
app.route("/api/checkouts", checkoutsRoute);

startWorker();

// Clean up stale in_progress attempts left by an unclean shutdown, then
// start accepting jobs. Runs before the worker picks up redelivered jobs
// so the claim guard sees truthful attempt state.
resetStaleAttempts().catch((err) => {
  console.error("Startup sweep failed:", err);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  try {
    await closeWorker();
    await closeQueue();
    await closeDb();
  } catch (err) {
    console.error("Shutdown error:", err);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

const port = parseInt(process.env.PORT || "3000");

console.log(`Server starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
