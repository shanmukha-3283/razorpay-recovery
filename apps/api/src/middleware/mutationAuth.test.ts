import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";
import { mutationAuth } from "./mutationAuth.js";

const TOKEN = "dev-token-123";

function makeApp() {
  const app = new Hono();
  app.use("/api/*", mutationAuth);
  app.get("/health", (c) => c.json({ ok: true }));
  app.post("/api/webhooks/razorpay", (c) => c.json({ received: true }));
  app.get("/api/stats", (c) => c.json({ data: {} }));
  app.post("/api/subscriptions/:id/recover", (c) =>
    c.json({ data: { scheduled: true } })
  );
  return app;
}

describe("mutationAuth middleware", () => {
  beforeEach(() => {
    process.env.DASHBOARD_API_TOKEN = TOKEN;
  });

  it("lets /health through without a token", async () => {
    expect((await makeApp().request("/health")).status).toBe(200);
  });

  it("lets GET reads through without a token", async () => {
    expect((await makeApp().request("/api/stats")).status).toBe(200);
  });

  it("lets webhooks through without a bearer token", async () => {
    const res = await makeApp().request("/api/webhooks/razorpay", {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });

  it("rejects mutations with no token", async () => {
    const res = await makeApp().request("/api/subscriptions/abc/recover", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("rejects mutations with a wrong token or scheme", async () => {
    const wrong = await makeApp().request("/api/subscriptions/abc/recover", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(wrong.status).toBe(401);

    const basic = await makeApp().request("/api/subscriptions/abc/recover", {
      method: "POST",
      headers: { authorization: `Basic ${TOKEN}` },
    });
    expect(basic.status).toBe(401);
  });

  it("accepts mutations with the correct bearer token", async () => {
    const res = await makeApp().request("/api/subscriptions/abc/recover", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("fails closed when the token is not configured", async () => {
    delete process.env.DASHBOARD_API_TOKEN;
    const res = await makeApp().request("/api/subscriptions/abc/recover", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(500);
  });

  it("still serves reads when the token is not configured", async () => {
    delete process.env.DASHBOARD_API_TOKEN;
    expect((await makeApp().request("/api/stats")).status).toBe(200);
  });
});
