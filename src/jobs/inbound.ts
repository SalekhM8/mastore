import type { ChannelAccountRow } from "@/db/channel-accounts";
import { setAccountStatus } from "@/db/channel-accounts";
import { db } from "@/db/client";
import { applyLedgerEvent } from "@/db/ledger";
import { findListingByExternalId, recordRemoteQuantity } from "@/db/listings";
import { logActivity, raiseIncident } from "@/db/ops";
import type { Channel, NormalisedInbound } from "@/domain/channels/types";
import { planInbound } from "@/domain/ledger/inbound";
import { withContext } from "@/lib/log";
import { CHANNEL_LABEL } from "./connectors";
import { requestPushesOrRun } from "./push";

/**
 * Shared by webhook ingest and the order poll: takes normalised inbound events for one account
 * and drives the ledger. Whether an event came by webhook or poll makes no difference here,
 * which is what makes reconciliation a true safety net.
 */

export interface InboundSummary {
  applied: number;
  duplicates: number;
  unmatched: number;
  ignored: number;
  jobsRequested: number;
  oversells: number;
}

async function skuForOrderLine(workspaceId: string, saleKey: string): Promise<string | null> {
  const rows = await db()<{ sku_id: string }[]>`
    select sku_id from public.ledger_events where workspace_id = ${workspaceId} and idempotency_key = ${saleKey} limit 1`;
  return rows[0]?.sku_id ?? null;
}

export async function processInbound(
  account: ChannelAccountRow,
  events: readonly NormalisedInbound[],
  source: "webhook" | "poll",
): Promise<InboundSummary> {
  const channel: Channel = account.channel;
  const label = CHANNEL_LABEL[channel];
  const log = withContext({ workspaceId: account.workspace_id, channel, channelAccountId: account.id });
  const summary: InboundSummary = {
    applied: 0,
    duplicates: 0,
    unmatched: 0,
    ignored: 0,
    jobsRequested: 0,
    oversells: 0,
  };
  const jobIds: string[] = [];

  for (const inbound of events) {
    const plan = planInbound({ channel, externalAccountId: account.external_account_id, inbound });
    switch (plan.type) {
      case "ignore":
        summary.ignored++;
        continue;
      case "auth_revoked":
        await setAccountStatus(account.id, "auth_revoked", "channel reported revocation");
        await raiseIncident({
          workspaceId: account.workspace_id,
          kind: "auth_revoked",
          severity: 1,
          channelAccountId: account.id,
        });
        await logActivity({
          workspaceId: account.workspace_id,
          channelAccountId: account.id,
          level: "error",
          message: `${label} revoked access. Reconnect it to resume syncing.`,
        });
        continue;
      case "listing_changed": {
        const listing = await findListingByExternalId(account.id, plan.externalListingId);
        if (listing && plan.quantity !== undefined) await recordRemoteQuantity(listing.id, plan.quantity);
        summary.ignored++;
        continue;
      }
      case "ledger": {
        let skuId: string | null = null;
        if (plan.externalListingId) {
          const listing = await findListingByExternalId(account.id, plan.externalListingId);
          skuId = listing?.sku_id ?? null;
        } else {
          const saleKey = plan.idempotencyKey.replace(/:(cancel|return)$/, ":sale");
          skuId = await skuForOrderLine(account.workspace_id, saleKey);
        }
        if (!skuId) {
          summary.unmatched++;
          if (plan.kind === "sale") {
            await raiseIncident({
              workspaceId: account.workspace_id,
              kind: "unmatched_sale",
              severity: 2,
              channelAccountId: account.id,
              details: {
                external_order_id: plan.externalOrderId,
                external_line_id: plan.externalLineId,
                external_listing_id: plan.externalListingId,
                source,
              },
            });
            await logActivity({
              workspaceId: account.workspace_id,
              channelAccountId: account.id,
              level: "warn",
              message: `${label}: a sale came in for listing ${plan.externalListingId ?? "unknown"} that is not linked to a SKU. Stock elsewhere was not changed.`,
              context: { external_order_id: plan.externalOrderId },
            });
          }
          continue;
        }
        const result = await applyLedgerEvent({
          workspaceId: account.workspace_id,
          skuId,
          kind: plan.kind,
          quantityDelta: plan.quantityDelta,
          idempotencyKey: plan.idempotencyKey,
          actor: `system:${channel}_${source}`,
          sourceChannelAccountId: account.id,
          occurredAt: plan.occurredAt,
          metadata: {
            ...plan.metadata,
            external_order_id: plan.externalOrderId,
            external_line_id: plan.externalLineId,
            source,
          },
        });
        if (result.duplicate) {
          summary.duplicates++;
          continue;
        }
        summary.applied++;
        jobIds.push(...result.job_ids);
        const verb = plan.kind === "sale" ? "sold" : plan.kind === "cancellation" ? "cancelled" : "returned";
        await logActivity({
          workspaceId: account.workspace_id,
          channelAccountId: account.id,
          skuId,
          message: `${label}: ${Math.abs(plan.quantityDelta)} ${verb}, stock now ${result.on_hand}. ${result.job_ids.length} channel update${result.job_ids.length === 1 ? "" : "s"} queued.`,
          context: { event_seq: result.event_seq, external_order_id: plan.externalOrderId, source },
        });
        if (result.incident_id) {
          summary.oversells++;
          await logActivity({
            workspaceId: account.workspace_id,
            channelAccountId: account.id,
            skuId,
            level: "error",
            message: `Oversell: ${label} sold an item that was already out of stock. Check the order and refund if needed.`,
            context: { incident_id: result.incident_id, external_order_id: plan.externalOrderId },
          });
        }
      }
    }
  }
  summary.jobsRequested = (await requestPushesOrRun(jobIds)).sent;
  log.info({ ...summary, source }, "inbound processed");
  return summary;
}
