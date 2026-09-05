import { afterEach, describe, expect, it, vi } from "vitest";
import { api, authedInit } from "./api";

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

describe("authedInit", () => {
  it("returns init untouched when no token is configured", () => {
    expect(authedInit(undefined, "")).toBeUndefined();
    const init = { method: "GET" } as RequestInit;
    expect(authedInit(init, "")).toBe(init);
  });

  it("attaches the Bearer header and preserves existing headers", () => {
    expect(authedInit(undefined, "tok")).toEqual({
      headers: { Authorization: "Bearer tok" },
    });
    expect(
      authedInit(
        { method: "POST", headers: { "Content-Type": "application/json" } },
        "tok"
      )
    ).toEqual({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer tok",
      },
    });
  });
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

  it("GETs receivables list with filters", async () => {
    const fetchFn = mockFetchOnce({ data: [], meta: {} });
    await api.receivables({ page: "1", status: "overdue" });
    const url = fetchFn.mock.calls[0][0];
    expect(url.startsWith("/api/receivables?")).toBe(true);
    expect(url).toContain("status=overdue");
  });

  it("GETs a single receivable by id", async () => {
    const fetchFn = mockFetchOnce({ data: {} });
    await api.receivable("inv_1");
    expect(fetchFn).toHaveBeenCalledWith("/api/receivables/inv_1");
  });

  it("POSTs promise record and mark-paid", async () => {
    const fetchFn = mockFetchOnce({ data: {} });
    await api.recordPromise("inv_1", { promised_date: "2026-10-01" });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/receivables/inv_1/promises",
      expect.objectContaining({ method: "POST" })
    );
    await api.markInvoicePaid("inv_1");
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/receivables/inv_1/mark-paid",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("GETs batches list and detail", async () => {
    const fetchFn = mockFetchOnce({ data: [], meta: {} });
    await api.batches({ page: "1" });
    const url = fetchFn.mock.calls[0][0];
    expect(url.startsWith("/api/batches?")).toBe(true);
    await api.batch("b_1");
    expect(fetchFn).toHaveBeenCalledWith("/api/batches/b_1");
  });

  it("POSTs batch create/close and SLA check", async () => {
    const fetchFn = mockFetchOnce({ data: {} });
    await api.createBatch({ name: "w36", domain: "subscription" });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/batches",
      expect.objectContaining({ method: "POST" })
    );
    await api.closeBatch("b_1");
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/batches/b_1/close",
      expect.objectContaining({ method: "POST" })
    );
    await api.checkEscalationSla();
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/escalations/check-sla",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("PATCHes escalations and manages DND", async () => {
    const fetchFn = mockFetchOnce({ data: {} });
    await api.ackEscalation("esc_1", { status: "acked" });
    const patchCall = fetchFn.mock.calls.find((c) =>
      String(c[0]).includes("/escalations/esc_1")
    );
    expect(patchCall?.[1]).toMatchObject({ method: "PATCH" });

    await api.dndAdd({ email: "stop@example.com" });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/dnd",
      expect.objectContaining({ method: "POST" })
    );
    await api.dndRemove("dnd_1");
    const delCall = fetchFn.mock.calls.find((c) =>
      String(c[0]).includes("/dnd/dnd_1")
    );
    expect(delCall?.[1]).toMatchObject({ method: "DELETE" });
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
