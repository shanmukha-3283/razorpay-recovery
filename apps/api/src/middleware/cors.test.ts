import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { corsMiddleware, webOrigin } from "./cors.js";

const SAVED_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED_ENV };
});

describe("webOrigin", () => {
  it("returns null when unset or blank", () => {
    delete process.env.WEB_ORIGIN;
    expect(webOrigin()).toBeNull();
    process.env.WEB_ORIGIN = "   ";
    expect(webOrigin()).toBeNull();
  });

  it("returns the trimmed origin when set", () => {
    process.env.WEB_ORIGIN = "  https://app.example.com  ";
    expect(webOrigin()).toBe("https://app.example.com");
  });
});

describe("corsMiddleware", () => {
  function makeApp() {
    const app = new Hono();
    app.use("/api/*", corsMiddleware());
    app.get("/api/ping", (c) => c.json({ ok: true }));
    return app;
  }

  it("passes through without CORS headers when WEB_ORIGIN is unset", async () => {
    delete process.env.WEB_ORIGIN;
    const res = await makeApp().request("/api/ping", {
      headers: { Origin: "https://other.example.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("emits CORS headers for the configured origin", async () => {
    process.env.WEB_ORIGIN = "https://app.example.com";
    const res = await makeApp().request("/api/ping", {
      headers: { Origin: "https://app.example.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com"
    );
  });

  it("answers preflight requests", async () => {
    process.env.WEB_ORIGIN = "https://app.example.com";
    const res = await makeApp().request("/api/ping", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com"
    );
  });
});
