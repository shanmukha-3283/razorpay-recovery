import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { customers, subscriptions, payments } from "../db/schema.js";

export async function syncCustomer(
  razorpayCustomerId: string,
  email?: string | null,
  contact?: string | null
): Promise<string> {
  if (!razorpayCustomerId) return "";

  const emailValue = email || null;
  const contactValue = contact || null;

  const rows = await db
    .insert(customers)
    .values({
      razorpayCustomerId,
      email: emailValue,
      contact: contactValue,
    })
    .onConflictDoUpdate({
      target: customers.razorpayCustomerId,
      set: {
        email: sql`COALESCE(excluded.email, ${customers.email})`,
        contact: sql`COALESCE(excluded.contact, ${customers.contact})`,
      },
    })
    .returning({ id: customers.id });

  return rows[0]?.id ?? "";
}

export async function syncSubscription(
  razorpaySubscriptionId: string,
  data: {
    customerId?: string | null;
    planId?: string | null;
    status: string;
    currentStart?: number | null;
    currentEnd?: number | null;
    paidCount?: number | null;
    totalCount?: number | null;
  }
): Promise<string> {
  const rows = await db
    .insert(subscriptions)
    .values({
      razorpaySubscriptionId,
      customerId: data.customerId || null,
      planId: data.planId || null,
      status: data.status,
      currentStart: data.currentStart
        ? new Date(data.currentStart * 1000)
        : null,
      currentEnd: data.currentEnd ? new Date(data.currentEnd * 1000) : null,
      paidCount: data.paidCount ?? 0,
      totalCount: data.totalCount ?? null,
    })
    .onConflictDoUpdate({
      target: subscriptions.razorpaySubscriptionId,
      set: {
        customerId: data.customerId || undefined,
        planId: data.planId || undefined,
        status: data.status,
        currentStart: data.currentStart
          ? new Date(data.currentStart * 1000)
          : undefined,
        currentEnd: data.currentEnd
          ? new Date(data.currentEnd * 1000)
          : undefined,
        paidCount: data.paidCount ?? undefined,
        totalCount: data.totalCount ?? undefined,
        updatedAt: new Date(),
      },
    })
    .returning({ id: subscriptions.id });

  return rows[0]?.id ?? "";
}

export async function syncPayment(
  razorpayPaymentId: string,
  data: {
    subscriptionId?: string | null;
    orderId?: string | null;
    amount?: number | null;
    currency?: string | null;
    status: string;
    method?: string | null;
    errorCode?: string | null;
    errorDescription?: string | null;
  }
): Promise<string> {
  const rows = await db
    .insert(payments)
    .values({
      razorpayPaymentId,
      subscriptionId: data.subscriptionId || null,
      orderId: data.orderId || null,
      amount: data.amount ?? 0,
      currency: data.currency || "INR",
      status: data.status,
      method: data.method || null,
      errorCode: data.errorCode || null,
      errorDescription: data.errorDescription || null,
    })
    .onConflictDoUpdate({
      target: payments.razorpayPaymentId,
      set: {
        subscriptionId: data.subscriptionId || undefined,
        orderId: data.orderId || undefined,
        amount: data.amount ?? undefined,
        currency: data.currency || undefined,
        status: data.status,
        method: data.method || undefined,
        errorCode: data.errorCode || undefined,
        errorDescription: data.errorDescription || undefined,
      },
    })
    .returning({ id: payments.id });

  return rows[0]?.id ?? "";
}
