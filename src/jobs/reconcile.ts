import { type ChannelAccountRow, listAccountsForPull } from "@/db/channel-accounts";
import { db, json } from "@/db/client";
import { listManagedListings, recordRemoteQuantity, toListingRef } from "@/db/listings";
import { getConnectorSwitch, logActivity, raiseIncident } from "@/db/ops";
import { enqueueStockJob } from "@/db/push-jobs";
import type { Channel, NormalisedInbound } from "@/domain/channels/types";
import { withContext } from "@/lib/log";
import { inngest } from "./client";
import { CHANNEL_LABEL, getConnector } from "./connectors";
import { loadFreshAccount } from "./credentials";
import { processInbound } from "./inbound";
import { requestPushesOrRun } from "./push";

/**
 * Reconciliation: the safety net under best-effort webhooks.
 * See docs/reliability-and-operations.md section 5.
 */

const ORDER_OVERLAP_MS = 10 * 60_000;
const FIRST_POLL_LOOKBACK_MS = 24 * 60 * 60_000;
const MAX_DRIFT_RATIO = 0.05;

export async function pollOrdersForAccount(
  row: ChannelAccountRow,
): Promise<{ pages: number; events: number } | { skipped: string }> {
  const channel = row.channel;
  const connector = getConnector(channel);
  if (!connector) return { skipped: "no_connector" };
  const loaded = await loadFreshAccount(channel, row.id);
  if (!loaded.ok) return { skipped: loaded.reason };
  const log = withContext({ workspaceId: row.workspace_id, channel, channelAccountId: row.id });

  const lastPoll =
    typeof row.account_settings.last_orders_poll_at === "string"
      ? Date.parse(row.account_settings.last_orders_poll_at)
      : Number.NaN;
  const since = new Date(
    (Number.isNaN(lastPoll) ? Date.now() - FIRST_POLL_LOOKBACK_MS : lastPoll) - ORDER_OVERLAP_MS,
  ).toISOString();
  const startedAt = new Date().toISOString();

  const all: NormalisedInbound[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await connector.pullOrders(loaded.context, since, cursor);
    if (page.kind !== "ok") {
      log.warn({ result: page.kind }, "order poll failed");
      return { skipped: page.kind };
    }
    all.push(...page.value.items);
    cursor = page.value.nextCursor;
    pages++;
  } while (cursor && pages < 50);

  const summary = await processInbound(row, all, "poll");
  if (summary.applied > 0) {
    log.warn({ applied: summary.applied }, "order poll found sales the webhook never delivered");
  }
  await db()`update public.channel_accounts set account_settings = account_settings || ${json(db(), { last_orders_poll_at: startedAt })} where id = ${row.id}`;
  return { pages, events: all.length };
}

export async function reconcileListingsForAccount(
  row: ChannelAccountRow,
): Promise<{ checked: number; drift: number; corrected: number } | { skipped: string }> {
  const channel = row.channel;
  const label = CHANNEL_LABEL[channel];
  const connector = getConnector(channel);
  if (!connector) return { skipped: "no_connector" };
  const loaded = await loadFreshAccount(channel, row.id);
  if (!loaded.ok) return { skipped: loaded.reason };
  const log = withContext({ workspaceId: row.workspace_id, channel, channelAccountId: row.id });

  const listings = await listManagedListings(row.id);
  if (listings.length === 0) return { checked: 0, drift: 0, corrected: 0 };
  const remote = await connector.pullListingQuantities(loaded.context, listings.map(toListingRef));
  if (remote.kind !== "ok") return { skipped: remote.kind };

  const drifted: typeof listings = [];
  for (const l of listings) {
    const q = remote.value.get(l.external_listing_id);
    if (q === undefined) continue;
    await recordRemoteQuantity(l.id, q);
    const inFlight = Number(l.applied_ledger_seq) !== Number(l.last_event_seq);
    if (q !== l.desired_quantity && !inFlight) drifted.push({ ...l, remote_quantity: q });
  }

  if (drifted.length / listings.length > MAX_DRIFT_RATIO && drifted.length > 2) {
    await raiseIncident({
      workspaceId: row.workspace_id,
      kind: "drift",
      severity: 2,
      channelAccountId: row.id,
      details: { drifted: drifted.length, checked: listings.length, auto_correct: false },
    });
    await logActivity({
      workspaceId: row.workspace_id,
      channelAccountId: row.id,
      level: "error",
      message: `${label}: ${drifted.length} of ${listings.length} listings disagree with Sync. Automatic correction is paused for this account until you review it.`,
    });
    log.error({ drifted: drifted.length, checked: listings.length }, "drift above threshold; not correcting");
    return { checked: listings.length, drift: drifted.length, corrected: 0 };
  }

  const jobIds: string[] = [];
  for (const l of drifted) {
    const remoteQty = l.remote_quantity ?? 0;
    const dangerous = remoteQty > l.desired_quantity; // marketplace can oversell
    const id = await enqueueStockJob({
      workspaceId: row.workspace_id,
      channelAccountId: row.id,
      channelListingId: l.id,
      quantity: l.item_type === "unique" && l.on_hand <= 0 ? 0 : l.desired_quantity,
      ledgerSeq: Number(l.last_event_seq),
      priority: dangerous ? 0 : 3,
      kind: l.item_type === "unique" && l.on_hand <= 0 ? "delist" : "stock",
    });
    jobIds.push(id);
    await logActivity({
      workspaceId: row.workspace_id,
      channelAccountId: row.id,
      skuId: l.sku_id,
      level: dangerous ? "warn" : "info",
      message: `${label}: ${l.title_snapshot ?? l.external_listing_id} showed ${remoteQty} but should be ${l.desired_quantity}. Correcting.`,
      context: { listing_id: l.id },
    });
  }
  await requestPushesOrRun(jobIds);
  return { checked: listings.length, drift: drifted.length, corrected: jobIds.length };
}

const ORDER_POLL_CRON: Record<Channel, string> = {
  ebay: "*/5 * * * *",
  amazon: "*/5 * * * *",
  tiktok: "*/5 * * * *",
  depop: "*/10 * * * *",
  etsy: "*/30 * * * *",
  onbuy: "*/10 * * * *",
  vinted: "*/10 * * * *",
  storefront: "*/10 * * * *",
};
const LISTING_POLL_CRON: Record<Channel, string> = {
  ebay: "0 */6 * * *",
  amazon: "0 */6 * * *",
  tiktok: "0 */6 * * *",
  depop: "0 */6 * * *",
  etsy: "0 */12 * * *",
  onbuy: "0 */12 * * *",
  vinted: "0 */6 * * *",
  storefront: "0 */6 * * *",
};

export function makeOrderPoll(channel: Channel) {
  return inngest.createFunction(
    {
      id: `poll-orders-${channel}`,
      triggers: [{ cron: ORDER_POLL_CRON[channel] }],
      retries: 0,
      concurrency: { limit: 1 },
    },
    async ({ step }) => {
      const sw = await step.run("switch", () => getConnectorSwitch(channel));
      if (!sw.pull_enabled) return { skipped: "kill_switch" };
      const accounts = await step.run("accounts", () => listAccountsForPull(channel));
      const results: Record<string, unknown> = {};
      for (const a of accounts) {
        results[a.id] = await step.run(`poll-${a.id}`, () => pollOrdersForAccount(a as ChannelAccountRow));
      }
      return results;
    },
  );
}

export function makeListingReconcile(channel: Channel) {
  return inngest.createFunction(
    {
      id: `reconcile-listings-${channel}`,
      triggers: [{ cron: LISTING_POLL_CRON[channel] }],
      retries: 0,
      concurrency: { limit: 1 },
    },
    async ({ step }) => {
      const sw = await step.run("switch", () => getConnectorSwitch(channel));
      if (!sw.pull_enabled) return { skipped: "kill_switch" };
      const accounts = await step.run("accounts", () => listAccountsForPull(channel));
      const results: Record<string, unknown> = {};
      for (const a of accounts) {
        results[a.id] = await step.run(`reconcile-${a.id}`, () => reconcileListingsForAccount(a as ChannelAccountRow));
      }
      return results;
    },
  );
}
