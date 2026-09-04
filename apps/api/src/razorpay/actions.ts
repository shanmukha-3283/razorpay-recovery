import {
  cancelSubscription,
  getSubscription,
  getSubscriptionInvoices,
  issueInvoice,
  pauseSubscription,
  RazorpayApiError,
  type RazorpaySubscription,
} from "./client.js";

export type RazorpayActionInput = {
  decision: string;
  razorpaySubscriptionId?: string | null;
  invoiceId?: string | null;
};

export type RazorpayActionResult = {
  action: string;
  success: boolean;
  providerStatus?: string | null;
  shortUrl?: string | null;
  error?: string;
};

function asResult(
  action: string,
  success: boolean,
  extras: Partial<RazorpayActionResult> = {}
): RazorpayActionResult {
  return {
    action: `razorpay.${action}`,
    success,
    providerStatus: extras.providerStatus ?? null,
    shortUrl: extras.shortUrl ?? null,
    error: extras.error,
  };
}

async function handleRetry(
  razorpaySubscriptionId: string,
  invoiceId?: string | null
): Promise<RazorpayActionResult> {
  let invoice = invoiceId;

  if (!invoice) {
    const invoices = await getSubscriptionInvoices(razorpaySubscriptionId);
    const issuable = invoices.find(
      (i) => i.status === "issued" || i.status === "pending"
    );
    invoice = issuable?.id ?? null;
  }

  if (!invoice) {
    return asResult("retry", false, {
      error: "no issuable invoice found for subscription",
    });
  }

  const result = await issueInvoice(invoice);
  return asResult("retry", true, {
    providerStatus: result.status,
    shortUrl: result.short_url,
  });
}

async function handleAdjust(
  razorpaySubscriptionId: string,
  fallbackSub?: RazorpaySubscription
): Promise<RazorpayActionResult> {
  const sub = fallbackSub ?? (await getSubscription(razorpaySubscriptionId));
  if (!sub?.short_url) {
    return asResult("adjust", false, {
      error: "no short_url available for payment update",
    });
  }
  return asResult("adjust", true, {
    providerStatus: sub.status,
    shortUrl: sub.short_url,
  });
}

async function handleHalt(
  razorpaySubscriptionId: string,
  fallbackSub?: RazorpaySubscription
): Promise<RazorpayActionResult> {
  const sub = fallbackSub ?? (await getSubscription(razorpaySubscriptionId));
  const status = sub.status;

  // Terminal states cannot be paused/cancelled further.
  if (["cancelled", "expired", "completed"].includes(status)) {
    return asResult("halt", true, {
      providerStatus: status,
      error: `subscription already in terminal state: ${status}`,
    });
  }

  try {
    const paused = await pauseSubscription(razorpaySubscriptionId);
    return asResult("halt", true, {
      providerStatus: paused.status,
      shortUrl: paused.short_url,
    });
  } catch (err) {
    if (err instanceof RazorpayApiError) {
      // Pause requires an active subscription and the feature to be enabled.
      // Fall back to cancel when the subscription is not pause-able.
      if (
        status === "pending" ||
        status === "created" ||
        status === "authenticated" ||
        /not.*active|feature is not enabled/i.test(err.message)
      ) {
        const cancelled = await cancelSubscription(razorpaySubscriptionId, false);
        return asResult("cancel", true, {
          providerStatus: cancelled.status,
          error: `pause failed (${err.message}); cancelled instead`,
        });
      }
      return asResult("halt", false, { error: err.message });
    }
    throw err;
  }
}

export async function executeRazorpayAction(
  input: RazorpayActionInput
): Promise<RazorpayActionResult> {
  if (!input.razorpaySubscriptionId) {
    return asResult("noop", false, {
      error: "no razorpay subscription id available",
    });
  }

  // Fetch the subscription up front so retry/adjust/halt can reuse it.
  let sub: RazorpaySubscription | undefined;
  try {
    sub = await getSubscription(input.razorpaySubscriptionId);
  } catch (err) {
    if (err instanceof RazorpayApiError) {
      return asResult("noop", false, { error: err.message });
    }
    throw err;
  }

  switch (input.decision) {
    case "retry":
      return handleRetry(input.razorpaySubscriptionId, input.invoiceId);
    case "adjust":
      return handleAdjust(input.razorpaySubscriptionId, sub);
    case "halt":
      return handleHalt(input.razorpaySubscriptionId, sub);
    default:
      return asResult(input.decision, false, {
        error: `no razorpay action mapped for decision "${input.decision}"`,
      });
  }
}
