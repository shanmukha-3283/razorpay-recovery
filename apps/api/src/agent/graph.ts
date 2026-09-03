import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { recoveryAttempts, subscriptions } from "../db/schema.js";
import { MAX_ATTEMPTS } from "../queue/retryPolicy.js";

export const RecoveryState = Annotation.Root({
  subscriptionId: Annotation<string>(),
  attemptNumber: Annotation<number>(),
  amount: Annotation<number>(),
  currency: Annotation<string>(),
  status: Annotation<string>(),
  decision: Annotation<string>(),
  reason: Annotation<string>(),
  details: Annotation<Record<string, unknown>>(),
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
    details: { priorAttempts: priorAttempts as PriorAttempt[] },
  };
}

async function decideAction(state: State): Promise<Partial<State>> {
  if (state.attemptNumber >= MAX_ATTEMPTS) {
    return {
      decision: "halt",
      reason: "maximum retry attempts reached",
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
    reason: "default recovery action",
  };
}

async function draftAction(state: State): Promise<Partial<State>> {
  return {
    details: {
      ...(state.details ?? {}),
      message:
        state.decision === "adjust"
          ? "Prompting customer to update payment details for subscription."
          : "Triggering automated payment retry for subscription.",
    },
  };
}

const graph = new StateGraph(RecoveryState)
  .addNode("loadContext", loadContext)
  .addNode("decideAction", decideAction)
  .addNode("draftAction", draftAction)
  .addEdge(START, "loadContext")
  .addConditionalEdges("loadContext", (state) =>
    state.decision === "no-op" ? END : "decideAction"
  )
  .addConditionalEdges("decideAction", (state) =>
    state.decision === "halt" ? END : "draftAction"
  )
  .addEdge("draftAction", END)
  .compile();

export const recoveryAgent = graph;
