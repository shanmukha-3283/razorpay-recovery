const RAZORPAY_BASE = "https://api.razorpay.com/v1";

const keyId = () => process.env.RAZORPAY_KEY_ID ?? "";
const keySecret = () => process.env.RAZORPAY_KEY_SECRET ?? "";

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

export type RazorpaySubscription = {
  id: string;
  entity: string;
  plan_id?: string;
  customer_id?: string | null;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  quantity?: number;
  total_count?: number;
  paid_count?: number;
  customer_notify?: boolean;
  created_at?: number;
  expire_by?: number;
  short_url?: string | null;
  auth_attempts?: number;
  remaining_count?: number;
  customer_contact?: string | null;
  customer_email?: string | null;
  payment_method?: string | null;
};

export type RazorpayInvoice = {
  id: string;
  entity: string;
  status?: string;
  amount?: number;
  currency?: string;
  subscription_id?: string | null;
  customer_id?: string | null;
  description?: string | null;
  short_url?: string | null;
  created_at?: number;
};

type RazorpayResponse<T> = { data?: T; error?: { code: string; description: string } };

function hasCredentials(): boolean {
  return Boolean(keyId() && keySecret());
}

async function request<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  if (!hasCredentials()) {
    throw new RazorpayApiError("Razorpay credentials not configured");
  }

  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${keyId()}:${keySecret()}`).toString("base64")}`,
  };

  let options: RequestInit = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    options = { ...options, body: JSON.stringify(body) };
  }

  let res: Response;
  try {
    res = await fetch(`${RAZORPAY_BASE}${path}`, options);
  } catch (err) {
    throw new RazorpayApiError(
      err instanceof Error ? `Network error: ${err.message}` : "Network error"
    );
  }

  const payload = (await res.json().catch(() => ({}))) as RazorpayResponse<T>;

  if (!res.ok) {
    const code = payload.error?.code ?? "REQUEST_ERROR";
    const description =
      payload.error?.description ?? `Razorpay returned HTTP ${res.status}`;
    throw new RazorpayApiError(description, res.status, code);
  }

  return payload.data ?? (payload as unknown as T);
}

export async function getSubscription(
  razorpaySubscriptionId: string
): Promise<RazorpaySubscription> {
  return request<RazorpaySubscription>(
    "GET",
    `/subscriptions/${razorpaySubscriptionId}`
  );
}

export async function pauseSubscription(
  razorpaySubscriptionId: string
): Promise<RazorpaySubscription> {
  return request<RazorpaySubscription>(
    "POST",
    `/subscriptions/${razorpaySubscriptionId}/pause`,
    { pause_at: "now" }
  );
}

export async function cancelSubscription(
  razorpaySubscriptionId: string,
  cancelAtCycleEnd = false
): Promise<RazorpaySubscription> {
  return request<RazorpaySubscription>(
    "POST",
    `/subscriptions/${razorpaySubscriptionId}/cancel`,
    { cancel_at_cycle_end: cancelAtCycleEnd }
  );
}

export async function getSubscriptionInvoices(
  razorpaySubscriptionId: string,
  count = 10
): Promise<RazorpayInvoice[]> {
  const data = await request<{ items: RazorpayInvoice[] }>(
    "GET",
    `/invoices?subscription_id=${razorpaySubscriptionId}&count=${count}`
  );
  return data.items ?? [];
}

export async function issueInvoice(
  invoiceId: string
): Promise<RazorpayInvoice> {
  return request<RazorpayInvoice>(
    "POST",
    `/invoices/${invoiceId}/issue`
  );
}

export type RazorpayOrder = {
  id: string;
  entity: string;
  amount?: number;
  currency?: string;
  status?: string;
  amount_paid?: number;
  amount_due?: number;
  receipt?: string | null;
  created_at?: number;
};

export async function getOrder(
  razorpayOrderId: string
): Promise<RazorpayOrder> {
  return request<RazorpayOrder>("GET", `/orders/${razorpayOrderId}`);
}
