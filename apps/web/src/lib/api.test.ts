import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function mockFetchOnce(json: unknown, ok = true, status = 200) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      ({
        ok,
        status,
        statusText: ok ? "OK" : "Error",
        json: async () => json,
      }) as Response
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("GETs stats at /stats", async () => {
    const fetchFn = mockFetchOnce({ data: {} });
    await api.stats();
    expect(fetchFn).toHaveBeenCalledWith("/api/stats");
  });

  it("serializes subscription list filters to a query string", async () => {
    const fetchFn = mockFetchOnce({ data: [], meta: {} });
    await api.subscriptions({ page: "2", status: "pending" });
    const url = fetchFn.mock.calls[0][0];
    expect(url.startsWith("/api/subscriptions?")).toBe(true);
    expect(url).toContain("page=2");
    expect(url).toContain("status=pending");
  });

  it("GETs a single subscription by id", async () => {
    const fetchFn = mockFetchOnce({ data: {} });
    await api.subscription("sub_1");
    expect(fetchFn).toHaveBeenCalledWith("/api/subscriptions/sub_1");
  });

  it("POSTs subscription sync", async () => {
    const fetchFn = mockFetchOnce({ data: {} });
    await api.subscriptionSync("sub_1");
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/subscriptions/sub_1/sync",
      expect.objectContaining({ method: "POST" })
    );
  });

  it.each([
    ["events", () => api.events()],
    ["recovery-attempts", () => api.recovery()],
    ["audit-ledger", () => api.audit()],
    ["deliveries", () => api.deliveries()],
  ])("GETs /%s", async (path, call) => {
    const fetchFn = mockFetchOnce({ data: [], meta: {} });
    await call();
    expect(fetchFn).toHaveBeenCalledWith(`/api/${path}`);
  });

  it("GETs checkouts list with filters", async () => {
    const fetchFn = mockFetchOnce({ data: [], meta: {} });
    await api.checkouts({ page: "1", status: "abandoned" });
    const url = fetchFn.mock.calls[0][0];
    expect(url.startsWith("/api/checkouts?")).toBe(true);
    expect(url).toContain("status=abandoned");
  });

  it("GETs a single checkout by id", async () => {
    const fetchFn = mockFetchOnce({ data: {} });
    await api.checkout("co_1");
    expect(fetchFn).toHaveBeenCalledWith("/api/checkouts/co_1");
  });

  it("throws on non-OK responses", async () => {
    mockFetchOnce({}, false, 500);
    await expect(api.stats()).rejects.toThrow("API error 500");
  });

  it("recoverSubscription posts an empty JSON body by default", async () => {
    const fetchFn = mockFetchOnce({ data: { scheduled: true } });
    const out = await api.recoverSubscription("sub_1");
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/subscriptions/sub_1/recover",
      expect.objectContaining({ method: "POST", body: "{}" })
    );
    expect(out).toEqual({ data: { scheduled: true } });
  });

  it("recoverSubscription forwards an amount override", async () => {
    const fetchFn = mockFetchOnce({ data: { scheduled: true } });
    await api.recoverSubscription("sub_1", { amount: 5000, currency: "USD" });
    const init = fetchFn.mock.calls[0][1];
    expect(init?.body).toBe(JSON.stringify({ amount: 5000, currency: "USD" }));
  });

  it("recoverSubscription throws the server message on 409", async () => {
    mockFetchOnce(
      { error: "Recovery not allowed: cap_reached", scheduled: false },
      false,
      409
    );
    await expect(api.recoverSubscription("sub_1")).rejects.toThrow(
      "Recovery not allowed: cap_reached"
    );
  });
});
