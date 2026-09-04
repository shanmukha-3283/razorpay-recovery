import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  useManualRecovery,
  useSubscription,
  useSubscriptionSync,
} from "./hooks";

vi.mock("@/lib/api", () => ({
  api: {
    subscription: vi.fn(),
    subscriptionSync: vi.fn(),
    recoverSubscription: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api, true);

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("data hooks", () => {
  it("useSubscription unwraps res.data", async () => {
    mockedApi.subscription.mockResolvedValue({
      data: { id: "s1" },
    } as never);
    const { wrapper } = setup();
    const { result } = renderHook(() => useSubscription("s1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: "s1" });
    expect(mockedApi.subscription).toHaveBeenCalledWith("s1");
  });

  it("useSubscriptionSync invalidates subscription caches", async () => {
    mockedApi.subscriptionSync.mockResolvedValue({ data: {} } as never);
    const { wrapper, invalidateSpy } = setup();
    const { result } = renderHook(() => useSubscriptionSync(), { wrapper });

    result.current.mutate("s1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi.subscriptionSync).toHaveBeenCalledWith("s1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["subscription"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["subscriptions"],
    });
  });

  it("useManualRecovery forwards id/body and invalidates recovery too", async () => {
    mockedApi.recoverSubscription.mockResolvedValue({
      data: { scheduled: true },
    } as never);
    const { wrapper, invalidateSpy } = setup();
    const { result } = renderHook(() => useManualRecovery(), { wrapper });

    result.current.mutate({ id: "s1", body: { amount: 5000 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi.recoverSubscription).toHaveBeenCalledWith("s1", {
      amount: 5000,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["subscription"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["subscriptions"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["recovery"] });
  });

  it("useManualRecovery surfaces server refusal as error", async () => {
    mockedApi.recoverSubscription.mockRejectedValue(
      new Error("Recovery not allowed: cap_reached")
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useManualRecovery(), { wrapper });

    result.current.mutate({ id: "s1" });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe(
      "Recovery not allowed: cap_reached"
    );
  });
});
