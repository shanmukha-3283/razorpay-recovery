import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import { subscriptions } from "../db/schema.js";
import { syncCustomer, syncSubscription, syncPayment } from "./sync.js";

type WebhookPayload = Record<string, unknown>;

type HandlerContext = {
  payload: WebhookPayload;
  rawEventId: string;
};

type WebhookHandler = (ctx: HandlerContext) => Promise<void>;

function getEntity<T>(payload: WebhookPayload, key: string): T | undefined {
  const holder = payload[key] as { entity?: T } | undefined;
  if (holder && holder.entity) return holder.entity;
  return undefined;
}

async function handlePaymentFailed({ payload }: HandlerContext) {
  const payment = getEntity<Record<string, unknown>>(payload, "payment");
  if (!payment) return;

  const subscriptionId = payment.subscription_id as string | undefined;

  await syncPayment(payment.id as string, {
    orderId: (payment.order_id as string) || null,
    amount: (payment.amount as number) ?? null,
    currency: (payment.currency as string) || null,
    status: (payment.status as string) || "failed",
    method: (payment.method as string) || null,
    errorCode: (payment.error_code as string) || null,
    errorDescription:
      (payment.error_description as string) ||
      (payment.error_reason as string) ||
      null,
    subscriptionId,
  });

  if (subscriptionId) {
    await db
      .update(subscriptions)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(subscriptions.razorpaySubscriptionId, subscriptionId));
  }
}

async function handleSubscriptionPending({ payload }: HandlerContext) {
  const subscription = getEntity<Record<string, unknown>>(
    payload,
    "subscription"
  );
  if (!subscription) return;

  const customerId = await syncCustomer(
    (subscription.customer_id as string) || "",
    undefined,
    undefined
  );

  const subscriptionId = await syncSubscription(
    subscription.id as string,
    {
      customerId: customerId || undefined,
      planId: (subscription.plan_id as string) || null,
      status: (subscription.status as string) || "pending",
      currentStart: subscription.current_start as number | undefined,
      currentEnd: subscription.current_end as number | undefined,
      paidCount: subscription.paid_count as number | undefined,
      totalCount: subscription.total_count as number | undefined,
    }
  );

  const payment = getEntity<Record<string, unknown>>(payload, "payment");
  if (payment) {
    await syncPayment(payment.id as string, {
      orderId: (payment.order_id as string) || null,
      amount: (payment.amount as number) ?? null,
      currency: (payment.currency as string) || null,
      status: (payment.status as string) || "failed",
      method: (payment.method as string) || null,
      errorCode: (payment.error_code as string) || null,
      errorDescription:
        (payment.error_description as string) ||
        (payment.error_reason as string) ||
        null,
      subscriptionId: subscriptionId || undefined,
    });
  }
}

async function handleSubscriptionHalted({ payload }: HandlerContext) {
  const subscription = getEntity<Record<string, unknown>>(
    payload,
    "subscription"
  );
  if (!subscription) return;

  const customerId = await syncCustomer(
    (subscription.customer_id as string) || "",
    undefined,
    undefined
  );

  await syncSubscription(subscription.id as string, {
    customerId: customerId || undefined,
    planId: (subscription.plan_id as string) || null,
    status: (subscription.status as string) || "halted",
    currentStart: subscription.current_start as number | undefined,
    currentEnd: subscription.current_end as number | undefined,
    paidCount: subscription.paid_count as number | undefined,
    totalCount: subscription.total_count as number | undefined,
  });
}

async function handleSubscriptionCancelled({ payload }: HandlerContext) {
  const subscription = getEntity<Record<string, unknown>>(
    payload,
    "subscription"
  );
  if (!subscription) return;

  const customerId = await syncCustomer(
    (subscription.customer_id as string) || "",
    undefined,
    undefined
  );

  await syncSubscription(subscription.id as string, {
    customerId: customerId || undefined,
    planId: (subscription.plan_id as string) || null,
    status: (subscription.status as string) || "cancelled",
    currentStart: subscription.current_start as number | undefined,
    currentEnd: subscription.current_end as number | undefined,
    paidCount: subscription.paid_count as number | undefined,
    totalCount: subscription.total_count as number | undefined,
  });
}

const handlers: Record<string, WebhookHandler> = {
  "payment.failed": handlePaymentFailed,
  "subscription.pending": handleSubscriptionPending,
  "subscription.halted": handleSubscriptionHalted,
  "subscription.cancelled": handleSubscriptionCancelled,
};

export const SUPPORTED_EVENTS = Object.keys(handlers);

export async function dispatchWebhookEvent(
  eventType: string,
  ctx: HandlerContext
): Promise<boolean> {
  const handler = handlers[eventType];
  if (!handler) return false;

  await handler(ctx);
  return true;
}
