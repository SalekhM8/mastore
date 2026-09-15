import { z } from "zod";
import { findAccountByExternalId } from "@/db/channel-accounts";
import { getConnectorSwitch, recordDeletionRequest } from "@/db/ops";
import { getWebhookReceipt, updateWebhookReceipt } from "@/db/webhook-events";
import type { Channel } from "@/domain/channels/types";
import { withContext } from "@/lib/log";
import { EVENTS, inngest, WebhookReceivedData } from "./client";
import { getConnector } from "./connectors";
import { processInbound } from "./inbound";
import { pollOrdersForAccount } from "./reconcile";

/**
 * Verifies and processes a webhook receipt. The ingress route only stored it.
 * See docs/reliability-and-operations.md section 4 and docs/security-and-compliance.md section 4.
 */

const EbayDeletion = z.object({
  metadata: z.object({ topic: z.literal("MARKETPLACE_ACCOUNT_DELETION") }),
  notification: z.object({
    data: z.object({ username: z.string().optional(), userId: z.string(), eiasToken: z.string().optional() }),
  }),
});

export async function processWebhookReceipt(receiptId: string): Promise<{ status: string; detail?: string }> {
  const receipt = await getWebhookReceipt(receiptId);
  if (!receipt) return { status: "missing" };
  if (receipt.status !== "received") return { status: "already", detail: receipt.status };
  const channel = receipt.channel as Channel;
  const log = withContext({ channel, requestId: receiptId });

  const sw = await getConnectorSwitch(channel);
  if (!sw.webhooks_enabled) {
    log.warn("webhooks kill switch is on; leaving receipt for later");
    return { status: "deferred", detail: "kill_switch" };
  }
  const connector = getConnector(channel);
  if (!connector) {
    await updateWebhookReceipt(receiptId, { status: "failed", error: { reason: "no_connector" } });
    return { status: "failed", detail: "no_connector" };
  }

  const verification = await connector.verifyWebhook({ headers: receipt.headers, rawBody: receipt.body, url: "" });
  if (!verification.valid) {
    await updateWebhookReceipt(receiptId, {
      status: "rejected",
      topic: verification.topic,
      error: { reason: "signature_invalid" },
    });
    log.warn({ sourceIp: undefined }, "webhook signature rejected");
    return { status: "rejected" };
  }
  await updateWebhookReceipt(receiptId, { status: "verified", topic: verification.topic });

  let payload: unknown;
  try {
    payload = JSON.parse(receipt.body);
  } catch {
    await updateWebhookReceipt(receiptId, { status: "failed", error: { reason: "body_not_json" } });
    return { status: "failed", detail: "body_not_json" };
  }

  // eBay programme requirement: record account deletion requests. Execution is a separate job.
  if (channel === "ebay" && verification.topic === "MARKETPLACE_ACCOUNT_DELETION") {
    const parsed = EbayDeletion.safeParse(payload);
    if (!parsed.success) {
      await updateWebhookReceipt(receiptId, { status: "failed", error: { reason: "deletion_shape" } });
      return { status: "failed", detail: "deletion_shape" };
    }
    const accounts = await findAccountByExternalId("ebay", parsed.data.notification.data.userId);
    const byName = parsed.data.notification.data.username
      ? await findAccountByExternalId("ebay", parsed.data.notification.data.username)
      : [];
    const workspaceIds = [...new Set([...accounts, ...byName].map((a) => a.workspace_id))];
    await recordDeletionRequest({
      channel: "ebay",
      externalUserId: parsed.data.notification.data.userId,
      externalUsername: parsed.data.notification.data.username ?? null,
      webhookEventId: receiptId,
      workspaceIds,
    });
    await updateWebhookReceipt(receiptId, { status: "processed" });
    return { status: "processed", detail: "deletion_recorded" };
  }

  if (!verification.externalAccountId) {
    await updateWebhookReceipt(receiptId, { status: "unmatched", error: { reason: "no_account_in_payload" } });
    return { status: "unmatched", detail: "no_account_in_payload" };
  }
  const candidates = await findAccountByExternalId(channel, verification.externalAccountId);
  const account = candidates[0];
  if (!account) {
    await updateWebhookReceipt(receiptId, { status: "unmatched", error: { reason: "account_not_connected" } });
    return { status: "unmatched", detail: "account_not_connected" };
  }

  const inbound = await connector.parseInbound(payload, verification.topic);
  // Some notifications only carry an order id. A targeted poll for this account picks the order up now
  // rather than waiting for the scheduled poll.
  const summary =
    inbound.length === 0 && verification.topic === "ORDER_CONFIRMATION"
      ? await (async () => {
          await pollOrdersForAccount(account);
          return { applied: 0, duplicates: 0, unmatched: 0, ignored: 0, jobsRequested: 0, oversells: 0, viaPoll: true };
        })()
      : await processInbound(account, inbound, "webhook");
  await updateWebhookReceipt(receiptId, {
    status: "processed",
    workspaceId: account.workspace_id,
    channelAccountId: account.id,
  });
  return { status: "processed", detail: JSON.stringify(summary) };
}

export const webhookIngest = inngest.createFunction(
  {
    id: "webhook-ingest",
    triggers: [{ event: EVENTS.webhookReceived }],
    concurrency: { key: "event.data.channel", limit: 5 }, // Inngest free plan caps per-function concurrency at 5
    retries: 3,
  },
  async ({ event, step }) => {
    const data = WebhookReceivedData.parse(event.data);
    return step.run("process", () => processWebhookReceipt(data.receiptId));
  },
);
