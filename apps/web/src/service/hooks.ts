import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { RecoveryAttempt, SubscriptionDetail } from "@/lib/types";

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await api.stats();
      return res.data;
    },
  });
}

export function useSubscriptions(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["subscriptions", filters],
    queryFn: () => api.subscriptions(filters),
    placeholderData: (prev) => prev,
  });
}

export function useSubscription(id: string) {
  return useQuery({
    queryKey: ["subscription", id],
    queryFn: async () => {
      const res = await api.subscription(id);
      return res.data satisfies SubscriptionDetail;
    },
    enabled: !!id,
  });
}

export function useEvents(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["events", filters],
    queryFn: () => api.events(filters),
    placeholderData: (prev) => prev,
  });
}

export function useRecovery(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["recovery", filters],
    queryFn: () => api.recovery(filters),
    placeholderData: (prev) => prev,
  });
}

export function useAudit(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["audit", filters],
    queryFn: () => api.audit(filters),
    placeholderData: (prev) => prev,
  });
}

export function useDeliveries(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["deliveries", filters],
    queryFn: () => api.deliveries(filters),
    placeholderData: (prev) => prev,
  });
}

export type { RecoveryAttempt, SubscriptionDetail };
