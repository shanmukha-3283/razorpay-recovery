import { Queue } from "bullmq";
import { connection } from "./connection.js";

export type RecoveryJobData = {
  subscriptionId: string;
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
