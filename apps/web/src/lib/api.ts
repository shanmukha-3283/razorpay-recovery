const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
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
};
