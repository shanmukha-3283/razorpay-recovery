import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { payments, recoveryAttempts, subscriptions } from "../db/schema.js";
import { MAX_ATTEMPTS } from "../queue/retryPolicy.js";
import {
  classifyFailure,
  draftMessage,
  type FailureClassification,
} from "./llmService.js";

export const RecoveryState = Annotation.Root({
  subscriptionId: Annotation<string>(),
  attemptNumber: Annotation<number>(),
  amount: Annotation<number>(),
  currency: Annotation<string>(),
  status: Annotation<string>(),
  decision: Annotation<string>(),
  reason: Annotation<string>(),
  details: Annotation<Record<string, unknown>>(),
  errorCode: Annotation<string>(),
  errorDescription: Annotation<string>(),
  classification: Annotation<FailureClassification | null>(),
});

type State = typeof RecoveryState.State;

type PriorAttempt = {
  action: string;
  status: string;
};

async function loadContext(state: State): Promise<Partial<State>> {
  const [subscription] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.id, state.subscriptionId));

  if (!subscription) {
    return {
      status: "unknown",
      decision: "no-op",
      reason: "subscription not found",
      details: {},
    };
  }

  const latestPayment = await db
    .select({
      errorCode: payments.errorCode,
      errorDescription: payments.errorDescription,
    })
    .from(payments)
    .where(eq(payments.subscriptionId, state.subscriptionId))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  const priorAttempts = await db
    .select({ action: recoveryAttempts.action, status: recoveryAttempts.status })
    .from(recoveryAttempts)
    .where(
      and(
        eq(recoveryAttempts.subscriptionId, state.subscriptionId),
        eq(recoveryAttempts.status, "completed")
      )
    )
    .orderBy(desc(recoveryAttempts.createdAt));

  return {
    status: subscription.status,
    errorCode: latestPayment[0]?.errorCode ?? "",
    errorDescription: latestPayment[0]?.errorDescription ?? "",
    details: { priorAttempts: priorAttempts as PriorAttempt[] },
  };
}

function needsClassification(state: State): boolean {
  if (state.errorCode || state.errorDescription) return true;
  const knownStatuses = ["pending", "failed", "halted", "cancelled", "active"];
  return !knownStatuses.includes(state.status ?? "");
}

async function llmClassify(state: State): Promise<Partial<State>> {
  const classification = await classifyFailure({
    status: state.status,
    errorCode: state.errorCode,
    errorDescription: state.errorDescription,
    amount: state.amount,
    currency: state.currency,
    attemptNumber: state.attemptNumber,
  });

  return { classification };
}

export async function decideAction(state: State): Promise<Partial<State>> {
  if (state.attemptNumber >= MAX_ATTEMPTS) {
    return {
      decision: "halt",
      reason: "maximum retry attempts reached",
    };
  }

  const classification = state.classification;

  if (
    classification &&
    classification.confidence >= 0.7 &&
    classification.recoveryHint === "halt"
  ) {
    return {
      decision: "halt",
      reason: `LLM classified as "${classification.failureCategory}" with high confidence`,
    };
  }

  if (
    classification &&
    classification.confidence >= 0.7 &&
    classification.recoveryHint === "adjust_payment_method"
  ) {
    return {
      decision: "adjust",
      reason: `LLM recommended adjusting payment method (${classification.failureCategory})`,
    };
  }

  if (
    classification &&
    classification.confidence >= 0.7 &&
    classification.recoveryHint === "contact_support"
  ) {
    return {
      decision: "escalate",
      reason: `LLM recommended human support (${classification.failureCategory})`,
    };
  }

  const priorAttempts = (state.details?.priorAttempts ?? []) as PriorAttempt[];
  const alreadyRetried = priorAttempts.some(
    (a) => a.action === "retry" && a.status === "completed"
  );

  if (alreadyRetried) {
    return {
      decision: "adjust",
      reason: "prior retry did not resolve; change payment approach",
    };
  }

  return {
    decision: "retry",
    reason:
      classification && classification.confidence >= 0.7
        ? `default recovery with LLM hint (${classification.failureCategory})`
        : "default recovery action",
  };
}

async function draftAction(state: State): Promise<Partial<State>> {
  const classificationMessage = state.classification?.message ?? null;

  const message =
    classificationMessage ??
    (await draftMessage({
      decision: state.decision,
      reason: state.reason,
      amount: state.amount,
      currency: state.currency,
      attemptNumber: state.attemptNumber,
    })) ??
    (state.decision === "adjust"
      ? "Prompting customer to update payment details for subscription."
      : "Triggering automated payment retry for subscription.");

  return {
    details: {
      ...(state.details ?? {}),
      message,
      failureCategory: state.classification?.failureCategory ?? null,
    },
  };
}

const graph = new StateGraph(RecoveryState)
  .addNode("loadContext", loadContext)
  .addNode("llmClassify", llmClassify)
  .addNode("decideAction", decideAction)
  .addNode("draftAction", draftAction)
  .addEdge(START, "loadContext")
  .addConditionalEdges("loadContext", (state) => {
    if (state.decision === "no-op") return END;
    if (needsClassification(state)) return "llmClassify";
    return "decideAction";
  })
  .addEdge("llmClassify", "decideAction")
  .addConditionalEdges("decideAction", (state) =>
    state.decision === "halt" ? END : "draftAction"
  )
  .addEdge("draftAction", END)
  .compile();

export const recoveryAgent = graph;
