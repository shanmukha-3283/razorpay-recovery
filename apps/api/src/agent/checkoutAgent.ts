import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { abandonedCheckouts, payments } from "../db/schema.js";
import { classifyFailure, draftMessage, type FailureClassification } from "./llmService.js";

export type CheckoutDecision =
  | "remind"
  | "escalate"
  | "expire"
  | "recovered"
  | "no-op";

const CheckoutState = Annotation.Root({
  checkoutId: Annotation<string>(),
  attemptNumber: Annotation<number>(),
  amount: Annotation<number>(),
  currency: Annotation<string>(),
  email: Annotation<string>(),
  status: Annotation<string>(),
  decision: Annotation<CheckoutDecision>(),
  reason: Annotation<string>(),
  details: Annotation<Record<string, unknown>>(),
  classification: Annotation<FailureClassification | null>(),
});

type State = typeof CheckoutState.State;

async function loadCheckout(state: State): Promise<Partial<State>> {
  const [checkout] = await db
    .select()
    .from(abandonedCheckouts)
    .where(eq(abandonedCheckouts.id, state.checkoutId));

  if (!checkout) {
    return { decision: "no-op", reason: "checkout not found", details: {} };
  }

  // Already paid after abandonment? Recovered without any touch.
  const captured = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.orderId, checkout.razorpayOrderId),
        eq(payments.status, "captured")
      )
    )
    .limit(1);

  if (captured.length > 0) {
    return {
      status: checkout.status,
      email: checkout.email ?? "",
      decision: "recovered",
      reason: "payment captured after abandonment",
      details: {},
    };
  }

  return {
    status: checkout.status,
    email: checkout.email ?? "",
    details: {},
  };
}

async function decideCheckout(state: State): Promise<Partial<State>> {
  if (state.decision) return {};

  // Unreachable customer: expire rather than burn the reminder budget.
  if (!state.email) {
    return {
      decision: "expire",
      reason: "no customer email to remind",
    };
  }

  // LLM hint (best-effort; null when the provider is unreachable).
  let hint: string | null = null;
  let classification: State["classification"] = null;
  try {
    classification = await classifyFailure({
      status: state.status || "abandoned",
      errorDescription: "customer abandoned checkout before payment",
      amount: state.amount,
      currency: state.currency,
      attemptNumber: state.attemptNumber,
    });
    hint = classification?.recoveryHint ?? null;
  } catch {
    hint = null;
  }

  if (hint === "halt" || hint === "contact_support") {
    return {
      decision: state.attemptNumber >= 2 ? "escalate" : "remind",
      reason: `LLM hint "${hint}" mapped to checkout recovery`,
      classification,
    };
  }

  if (state.attemptNumber >= 2) {
    return {
      decision: "escalate",
      reason: "final reminder with support contact",
    };
  }

  return { decision: "remind", reason: "first payment-link reminder" };
}

async function draftCheckoutMessage(
  state: State
): Promise<Partial<State>> {
  const classificationMessage = state.classification?.message ?? null;

  const message =
    classificationMessage ??
    (await draftMessage({
      decision: state.decision === "escalate" ? "contact_support" : "retry",
      reason: state.reason,
      amount: state.amount,
      currency: state.currency,
      attemptNumber: state.attemptNumber,
    })) ??
    (state.decision === "escalate"
      ? "Your reserved items are about to expire. Reply to this email or contact support and we will help you complete your purchase."
      : "You left items in your checkout. Complete your purchase soon — your order is still reserved.");

  return { details: { ...(state.details ?? {}), message } };
}

const graph = new StateGraph(CheckoutState)
  .addNode("loadCheckout", loadCheckout)
  .addNode("decideCheckout", decideCheckout)
  .addNode("draftCheckoutMessage", draftCheckoutMessage)
  .addEdge(START, "loadCheckout")
  .addConditionalEdges("loadCheckout", (state) => {
    if (state.decision) return END;
    return "decideCheckout";
  })
  .addConditionalEdges("decideCheckout", (state) =>
    state.decision === "expire" ? END : "draftCheckoutMessage"
  )
  .addEdge("draftCheckoutMessage", END)
  .compile();

export const checkoutAgent = graph;
