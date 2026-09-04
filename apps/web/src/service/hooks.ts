import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  BatchDetail,
  CheckoutDetail,
  ReceivableDetail,
  RecoveryAttempt,
  SubscriptionDetail,
} from "@/lib/types";

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

export function useSubscriptionSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.subscriptionSync(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });
}

export function useManualRecovery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body?: { amount?: number; currency?: string };
    }) => api.recoverSubscription(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
  });
}

export function useCheckouts(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["checkouts", filters],
    queryFn: () => api.checkouts(filters),
    placeholderData: (prev) => prev,
  });
}

export function useCheckout(id: string) {
  return useQuery({
    queryKey: ["checkout", id],
    queryFn: async () => {
      const res = await api.checkout(id);
      return res.data satisfies CheckoutDetail;
    },
    enabled: !!id,
  });
}

export function useReceivables(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["receivables", filters],
    queryFn: () => api.receivables(filters),
    placeholderData: (prev) => prev,
  });
}

export function useReceivable(id: string) {
  return useQuery({
    queryKey: ["receivable", id],
    queryFn: async () => {
      const res = await api.receivable(id);
      return res.data satisfies ReceivableDetail;
    },
    enabled: !!id,
  });
}

export function useRecordPromise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { promised_amount?: number; promised_date: string };
    }) => api.recordPromise(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receivable"] });
      queryClient.invalidateQueries({ queryKey: ["receivables"] });
    },
  });
}

export function useMarkInvoicePaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markInvoicePaid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receivable"] });
      queryClient.invalidateQueries({ queryKey: ["receivables"] });
    },
  });
}

export function useBatches(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["batches", filters],
    queryFn: () => api.batches(filters),
    placeholderData: (prev) => prev,
  });
}

export function useBatch(id: string) {
  return useQuery({
    queryKey: ["batch", id],
    queryFn: async () => {
      const res = await api.batch(id);
      return res.data satisfies BatchDetail;
    },
    enabled: !!id,
  });
}

export function useCreateBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; domain: string }) =>
      api.createBatch(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
    },
  });
}

export function useCloseBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeBatch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["batch"] });
    },
  });
}

export function useEscalations(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["escalations", filters],
    queryFn: () => api.escalations(filters),
    placeholderData: (prev) => prev,
  });
}

export function useAckEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { status?: string; owner?: string };
    }) => api.ackEscalation(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

export function useCheckEscalationSla() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.checkEscalationSla(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

export function useDnd(filters?: Record<string, string>) {
  return useQuery({
    queryKey: ["dnd", filters],
    queryFn: () => api.dndList(filters),
    placeholderData: (prev) => prev,
  });
}

export function useAddDnd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; reason?: string }) =>
      api.dndAdd(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dnd"] });
    },
  });
}

export function useRemoveDnd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.dndRemove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dnd"] });
    },
  });
}

export type {
  BatchDetail,
  CheckoutDetail,
  ReceivableDetail,
  RecoveryAttempt,
  SubscriptionDetail,
};
