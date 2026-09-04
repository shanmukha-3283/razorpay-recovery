import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { paymentPromises, receivableInvoices } from "../db/schema.js";
import { classifyFailure, draftMessage } from "./llmService.js";

export type ReceivableDecision =
  | "remind"
  | "escalate"
  | "await"
  | "breach"
  | "paid"
  | "no-op";

const ReceivableState = Annotation.Root({
  invoiceId: Annotation<string>(),
  attemptNumber: Annotation<number>(),
  amount: Annotation<number>(),
  currency: Annotation<string>(),
  email: Annotation<string>(),
  daysOverdue: Annotation<number>(),
  decision: Annotation<ReceivableDecision>(),
  reason: Annotation<string>(),
  details: Annotation<Record<string, unknown>>(),
  classification: Annotation<import("./llmService.js").FailureClassification | null>(),
});

type State = typeof ReceivableState.State;

function daysSince(date: Date | null): number {
  if (!date) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000))
  );
}

async function loadReceivable(state: State): Promise<Partial<State>> {
  const [invoice] = await db
    .select()
    .from(receivableInvoices)
    .where(eq(receivableInvoices.id, state.invoiceId));

  if (!invoice) {
    return { decision: "no-op", reason: "invoice not found", details: {} };
  }

  if (invoice.status === "paid") {
    return {
      email: invoice.customerEmail ?? "",
      daysOverdue: daysSince(invoice.dueDate),
      decision: "paid",
      reason: "invoice already paid",
      details: {},
    };
  }

  const [promise] = await db
    .select()
    .from(paymentPromises)
    .where(
      and(
        eq(paymentPromises.invoiceId, state.invoiceId),
        eq(paymentPromises.status, "open")
      )
    )
    .orderBy(desc(paymentPromises.createdAt))
    .limit(1);

  const overdue = daysSince(invoice.dueDate);
  const base = {
    email: invoice.customerEmail ?? "",
    daysOverdue: overdue,
  };

  if (promise) {
    if (promise.promisedDate.getTime() > Date.now()) {
      return {
        ...base,
        decision: "await",
        reason: `active promise due ${promise.promisedDate.toISOString()}`,
        details: { promiseId: promise.id },
      };
    }
    return {
      ...base,
      decision: "breach",
      reason: `promise ${promise.id} breached on ${promise.promisedDate.toISOString()}`,
      details: { promiseId: promise.id },
    };
  }

  return { ...base, details: {} };
}

async function decideReceivable(state: State): Promise<Partial<State>> {
  if (state.decision) return {};

  // LLM hint (best-effort; null when the provider is unreachable).
  let hint: string | null = null;
  let classification: State["classification"] = null;
  try {
    classification = await classifyFailure({
      status: `overdue ${state.daysOverdue}d`,
      errorDescription: "b2b invoice past due date",
      amount: state.amount,
      currency: state.currency,
      attemptNumber: state.attemptNumber,
    });
    hint = classification?.recoveryHint ?? null;
  } catch {
    hint = null;
  }

  // Dunning ladder by attempt: polite → firm → firm+ → escalate.
  // An LLM halt hint jumps straight to the final rung.
  if (hint === "halt" || state.attemptNumber >= 4) {
    return {
      decision: "escalate",
      reason:
        hint === "halt"
          ? 'LLM hint "halt" mapped to final escalation'
          : "final dunning touch before close",
      classification,
    };
  }

  if (hint === "contact_support") {
    return {
      decision: "escalate",
      reason: 'LLM hint "contact_support" mapped to escalation',
      classification,
    };
  }

  const tone =
    state.attemptNumber <= 1
      ? "polite first reminder"
      : state.attemptNumber === 2
      ? "firm follow-up"
      : "final notice before escalation";
  return { decision: "remind", reason: tone, classification };
}

async function draftReceivableMessage(
  state: State
): Promise<Partial<State>> {
  const classificationMessage = state.classification?.message ?? null;

  const fallback =
    state.decision === "escalate" || state.decision === "breach"
      ? `Invoice of ${state.amount} ${state.currency} is ${state.daysOverdue} days overdue. Please pay immediately or contact our collections team to resolve this.`
      : `Friendly reminder: invoice of ${state.amount} ${state.currency} is ${state.daysOverdue} days overdue. Please arrange payment at your earliest convenience.`;

  const message =
    classificationMessage ??
    (await draftMessage({
      decision:
        state.decision === "escalate" || state.decision === "breach"
          ? "contact_support"
          : "retry",
      reason: state.reason,
      amount: state.amount,
      currency: state.currency,
      attemptNumber: state.attemptNumber,
    })) ??
    fallback;

  return { details: { ...(state.details ?? {}), message } };
}

const graph = new StateGraph(ReceivableState)
  .addNode("loadReceivable", loadReceivable)
  .addNode("decideReceivable", decideReceivable)
  .addNode("draftReceivableMessage", draftReceivableMessage)
  .addEdge(START, "loadReceivable")
  .addConditionalEdges("loadReceivable", (state) => {
    if (state.decision) return END;
    return "decideReceivable";
  })
  .addConditionalEdges("decideReceivable", (state) =>
    state.decision === "await" ? END : "draftReceivableMessage"
  )
  .addEdge("draftReceivableMessage", END)
  .compile();

export const receivableAgent = graph;
