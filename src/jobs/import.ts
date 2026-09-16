import { z } from "zod";
import { createProductWithSku, findSkuByCode, setImportStatus, upsertImportedListing } from "@/db/catalogue";
import type { ChannelAccountRow } from "@/db/channel-accounts";
import { applyLedgerEvent } from "@/db/ledger";
import { skuLastEventSeq } from "@/db/listings";
import { logActivity } from "@/db/ops";
import { CHANNELS, type RemoteListing } from "@/domain/channels/types";
import { inboundKey } from "@/domain/ledger/idempotency";
import { withContext } from "@/lib/log";
import { EVENTS, inngest } from "./client";
import { CHANNEL_LABEL, getConnector } from "./connectors";
import { loadFreshAccount } from "./credentials";

/**
 * Listing import. Pages through a channel account's live listings and turns each into a product,
 * a SKU, an unmanaged channel listing and a baseline stock event. Nothing is pushed anywhere:
 * managed stays false and sync stays off until the seller turns them on.
 * See docs/architecture-and-data-model.md "Importing 800 existing eBay listings at sign-up".
 */

export const ImportRequestedData = z.object({
  channelAccountId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  channel: z.enum(CHANNELS),
});

export interface ImportSummary {
  pages: number;
  seen: number;
  created: number;
  linked: number;
  baselined: number;
  skipped: number;
}

function skuCodeFor(channel: string, r: RemoteListing): string {
  const own = r.sku?.trim();
  return own && own.length > 0 ? own : `${channel.toUpperCase()}-${r.externalListingId}`;
}

/** Import one page. Returns how many were created or linked. Safe to re-run: every write is an upsert or idempotent. */
export async function importPage(
  row: ChannelAccountRow,
  items: readonly RemoteListing[],
): Promise<Omit<ImportSummary, "pages">> {
  const channel = row.channel;
  const out = { seen: 0, created: 0, linked: 0, baselined: 0, skipped: 0 };
  for (const r of items) {
    out.seen++;
    if (r.status === "draft") {
      out.skipped++;
      continue;
    }
    const code = skuCodeFor(channel, r);
    let skuId: string;
    const existing = await findSkuByCode(row.workspace_id, code);
    if (existing) {
      skuId = existing.id;
      out.linked++;
    } else {
      const created = await createProductWithSku({
        workspaceId: row.workspace_id,
        title: r.title,
        itemType: r.quantity <= 1 ? "unique" : "stocked",
        priceMinor: r.price.amountMinor,
        sku: code,
      });
      skuId = created.skuId;
      out.created++;
    }
    await upsertImportedListing({ workspaceId: row.workspace_id, channelAccountId: row.id, skuId, remote: r });

    // Baseline stock only for a SKU the ledger has never seen. A SKU already on another channel keeps its
    // ledger quantity; any disagreement shows up as drift for the seller to resolve.
    if ((await skuLastEventSeq(skuId)) === 0 && r.quantity > 0) {
      await applyLedgerEvent({
        workspaceId: row.workspace_id,
        skuId,
        kind: "import_baseline",
        quantityDelta: r.quantity,
        idempotencyKey: inboundKey({
          channel,
          externalAccountId: row.external_account_id,
          resource: "listing",
          resourceId: r.externalListingId,
          action: "baseline",
        }),
        actor: `system:${channel}_import`,
        sourceChannelAccountId: row.id,
        metadata: { external_listing_id: r.externalListingId },
      });
      out.baselined++;
    }
  }
  return out;
}

/** Whole import, synchronous. Used by the Inngest function step by step and by the inline fallback. */
export async function runImport(row: ChannelAccountRow, maxPages = 200): Promise<ImportSummary | { skipped: string }> {
  const channel = row.channel;
  const label = CHANNEL_LABEL[channel];
  const log = withContext({ workspaceId: row.workspace_id, channel, channelAccountId: row.id });
  const connector = getConnector(channel);
  if (!connector) return { skipped: "no_connector" };
  const loaded = await loadFreshAccount(channel, row.id);
  if (!loaded.ok) {
    await setImportStatus(row.id, {
      state: "failed",
      error: loaded.reason === "refresh_failed" ? "eBay sign-in has expired. Reconnect the account." : loaded.reason,
    });
    return { skipped: loaded.reason };
  }

  const startedAt = new Date().toISOString();
  await setImportStatus(row.id, { state: "running", started_at: startedAt, seen: 0 });
  const total: ImportSummary = { pages: 0, seen: 0, created: 0, linked: 0, baselined: 0, skipped: 0 };
  let cursor: string | undefined;
  try {
    do {
      const page = await connector.listRemoteListings(loaded.context, cursor);
      if (page.kind !== "ok") {
        const detail =
          page.kind === "terminal" ? page.messageForSeller : page.kind === "retryable" ? page.message : page.kind;
        await setImportStatus(row.id, { state: "failed", started_at: startedAt, error: detail, ...total });
        await logActivity({
          workspaceId: row.workspace_id,
          channelAccountId: row.id,
          level: "error",
          message: `${label}: import stopped. ${detail}`,
        });
        log.warn({ result: page.kind, pages: total.pages }, "import page failed");
        return total;
      }
      const r = await importPage(row, page.value.items);
      total.pages++;
      total.seen += r.seen;
      total.created += r.created;
      total.linked += r.linked;
      total.baselined += r.baselined;
      total.skipped += r.skipped;
      await setImportStatus(row.id, { state: "running", started_at: startedAt, ...total });
      cursor = page.value.nextCursor;
    } while (cursor && total.pages < maxPages);
  } catch (e) {
    await setImportStatus(row.id, { state: "failed", started_at: startedAt, error: "unexpected error", ...total });
    log.error({ err: e }, "import crashed");
    throw e;
  }
  await setImportStatus(row.id, {
    state: "done",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    ...total,
  });
  await logActivity({
    workspaceId: row.workspace_id,
    channelAccountId: row.id,
    message: `${label}: imported ${total.seen} listing${total.seen === 1 ? "" : "s"}. ${total.created} new product${total.created === 1 ? "" : "s"}, ${total.linked} matched to existing SKUs. Nothing was pushed.`,
    context: { ...total },
  });
  log.info(total, "import finished");
  return total;
}

export const importListings = inngest.createFunction(
  {
    id: "import-listings",
    triggers: [{ event: EVENTS.accountConnected }, { event: EVENTS.importRequested }],
    concurrency: { key: "event.data.channelAccountId", limit: 1 },
    retries: 2,
  },
  async ({ event, step }) => {
    const data = ImportRequestedData.parse(event.data);
    const { getChannelAccount } = await import("@/db/channel-accounts");
    const row = await step.run("load-account", () => getChannelAccount(data.channelAccountId));
    if (!row) return { skipped: "no_account" };
    return step.run("import", () => runImport(row as ChannelAccountRow));
  },
);
