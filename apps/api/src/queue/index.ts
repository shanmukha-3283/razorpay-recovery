import { Queue } from "bullmq";
import { connection } from "./connection.js";
import type { RecoveryDomain } from "./retryPolicy.js";

export type RecoveryJobData = {
  domain: RecoveryDomain;
  /** Internal owner id: subscription id or abandoned-checkout id. */
  ownerId: string;
  attemptNumber: number;
  amount: number;
  currency: string;
};

export const recoveryQueue = new Queue<RecoveryJobData>("recovery", {
  connection,
});

export async function closeQueue(): Promise<void> {
  await recoveryQueue.close();
}
