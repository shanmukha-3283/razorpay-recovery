const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  stats: () => request<{ data: import("./types").Stats }>("/stats"),
  subscriptions: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<import("./types").Paginated<import("./types").Subscription>>(
      `/subscriptions${qs}`
    );
  },
  subscription: (id: string) =>
    request<{ data: import("./types").SubscriptionDetail }>(
      `/subscriptions/${id}`
    ),
  subscriptionSync: (id: string) =>
    post<{ data: { id: string; status: string; synced: boolean } }>(
      `/subscriptions/${id}/sync`
    ),
  recoverSubscription: async (
    id: string,
    body?: { amount?: number; currency?: string }
  ) => {
    const res = await fetch(`${API_URL}/subscriptions/${id}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json()) as
      | { data: import("./types").RecoverResult }
      | { error: string; scheduled: false; reason: string };
    if (!res.ok) {
      throw new Error(
        "error" in json ? json.error : `API error ${res.status}`
      );
    }
    return json as { data: import("./types").RecoverResult };
  },
  events: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<import("./types").Paginated<import("./types").RawEvent>>(
      `/events${qs}`
    );
  },
  recovery: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<import("./types").Paginated<import("./types").RecoveryAttempt>>(
      `/recovery-attempts${qs}`
    );
  },
  audit: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<import("./types").Paginated<import("./types").AuditEntry>>(
      `/audit-ledger${qs}`
    );
  },
  deliveries: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<import("./types").Paginated<import("./types").Delivery>>(
      `/deliveries${qs}`
    );
  },
  checkouts: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<import("./types").Paginated<import("./types").Checkout>>(
      `/checkouts${qs}`
    );
  },
  checkout: (id: string) =>
    request<{ data: import("./types").CheckoutDetail }>(
      `/checkouts/${id}`
    ),
  receivables: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<
      import("./types").Paginated<import("./types").ReceivableInvoice>
    >(`/receivables${qs}`);
  },
  receivable: (id: string) =>
    request<{ data: import("./types").ReceivableDetail }>(
      `/receivables/${id}`
    ),
  recordPromise: (id: string, body: { promised_amount?: number; promised_date: string }) =>
    post<{ data: { id: string; invoiceId: string; status: string } }>(
      `/receivables/${id}/promises`,
      body
    ),
  markInvoicePaid: (id: string) =>
    post<{ data: { id: string; status: string } }>(
      `/receivables/${id}/mark-paid`,
      {}
    ),
  batches: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<import("./types").Paginated<import("./types").Batch>>(
      `/batches${qs}`
    );
  },
  batch: (id: string) =>
    request<{ data: import("./types").BatchDetail }>(`/batches/${id}`),
  createBatch: (body: { name: string; domain: string }) =>
    post<{ data: import("./types").Batch }>(`/batches`, body),
  closeBatch: (id: string) =>
    post<{ data: { id: string; status: string } }>(`/batches/${id}/close`, {}),
  escalations: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<
      import("./types").Paginated<import("./types").Escalation>
    >(`/escalations${qs}`);
  },
  ackEscalation: (id: string, body: { status?: string; owner?: string }) =>
    patch<{ data: import("./types").Escalation }>(
      `/escalations/${id}`,
      body
    ),
  checkEscalationSla: () =>
    post<{
      data: {
        checked: number;
        breached: Array<{ id: string; domain: string; owner: string }>;
      };
    }>(`/escalations/check-sla`, {}),
  dndList: (params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request<import("./types").Paginated<import("./types").DndEntry>>(
      `/dnd${qs}`
    );
  },
  dndAdd: (body: { email: string; reason?: string }) =>
    post<{ data: import("./types").DndEntry }>(`/dnd`, body),
  dndRemove: (id: string) =>
    del<{ data: { id: string; deleted: boolean } }>(`/dnd/${id}`),
};
