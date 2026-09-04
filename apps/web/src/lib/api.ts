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
};
