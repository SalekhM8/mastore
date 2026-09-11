import { Inngest } from "inngest";
import { z } from "zod";
import { CHANNELS } from "@/domain/channels/types";

/**
 * Inngest client and the schemas of every event we send. Event payloads are parsed with zod
 * inside each function; nothing trusts event.data as typed. See docs/engineering-standards.md section 4.
 */

export const inngest = new Inngest({ id: "sync" });

export const EVENTS = {
  pushRequested: "sync/push.requested",
  webhookReceived: "sync/webhook.received",
  accountConnected: "sync/account.connected",
} as const;

export const PushRequestedData = z.object({
  jobId: z.string().uuid(),
  channel: z.enum(CHANNELS),
  channelAccountId: z.string().uuid(),
});
export type PushRequestedData = z.infer<typeof PushRequestedData>;

export const WebhookReceivedData = z.object({
  receiptId: z.string().uuid(),
  channel: z.enum([...CHANNELS, "stripe"]),
});
export type WebhookReceivedData = z.infer<typeof WebhookReceivedData>;

export const AccountConnectedData = z.object({
  workspaceId: z.string().uuid(),
  channel: z.enum(CHANNELS),
  channelAccountId: z.string().uuid(),
});
export type AccountConnectedData = z.infer<typeof AccountConnectedData>;
