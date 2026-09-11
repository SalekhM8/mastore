import { CHANNELS } from "@/domain/channels/types";
import { makePushFunction, makePushSweeper } from "./push";
import { makeListingReconcile, makeOrderPoll } from "./reconcile";
import { webhookIngest } from "./webhook-ingest";

/** Every Inngest function the app serves. Registered at /api/inngest. */
export const functions = [
  webhookIngest,
  ...CHANNELS.flatMap((c) => [makePushFunction(c), makePushSweeper(c), makeOrderPoll(c), makeListingReconcile(c)]),
];
