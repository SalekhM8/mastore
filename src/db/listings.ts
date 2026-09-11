import type { ListingRef } from "@/connectors/contract";
import { db, json } from "./client";

export interface ChannelListingRow {
  id: string;
  workspace_id: string;
  channel_account_id: string;
  sku_id: string | null;
  external_listing_id: string;
  external_ids: Record<string, string>;
  listing_model: "inventory" | "trading" | null;
  status: "draft" | "pending" | "active" | "ended" | "error" | "unmanaged";
  managed: boolean;
  desired_quantity: number;
  pushed_quantity: number | null;
  remote_quantity: number | null;
  applied_ledger_seq: string;
  title_snapshot: string | null;
}

export async function getListing(id: string): Promise<ChannelListingRow | null> {
  const rows = await db()<ChannelListingRow[]>`select * from public.channel_listings where id = ${id}`;
  return rows[0] ?? null;
}

export async function findListingByExternalId(
  channelAccountId: string,
  externalListingId: string,
): Promise<ChannelListingRow | null> {
  const rows = await db()<ChannelListingRow[]>`
    select * from public.channel_listings where channel_account_id = ${channelAccountId} and external_listing_id = ${externalListingId}`;
  return rows[0] ?? null;
}

export function toListingRef(row: ChannelListingRow): ListingRef {
  return {
    channelListingId: row.id,
    externalListingId: row.external_listing_id,
    externalIds: row.external_ids,
    ...(row.listing_model ? { listingModel: row.listing_model } : {}),
  };
}

/**
 * Record a successful push. Only advances if this push is newer than what was last applied,
 * so an older in-flight push that lands late never overwrites a newer one.
 */
export async function recordPushApplied(input: {
  listingId: string;
  ledgerSeq: number;
  quantity: number;
  kind: "stock" | "delist" | "price" | "relist" | "listing_create" | "listing_update";
}): Promise<boolean> {
  const status = input.kind === "delist" ? "ended" : input.kind === "relist" ? "active" : null;
  const rows = await db()<{ id: string }[]>`
    update public.channel_listings
    set applied_ledger_seq = ${input.ledgerSeq}, pushed_quantity = ${input.quantity}, pushed_at = now(), last_error = null,
        status = coalesce(${status}, status)
    where id = ${input.listingId} and applied_ledger_seq <= ${input.ledgerSeq}
    returning id`;
  return rows.length > 0;
}

export async function setListingError(listingId: string, error: unknown): Promise<void> {
  const sql = db();
  await sql`update public.channel_listings set status = 'error', last_error = ${json(sql, error as never)} where id = ${listingId}`;
}

export async function recordRemoteQuantity(listingId: string, quantity: number): Promise<void> {
  await db()`update public.channel_listings set remote_quantity = ${quantity}, remote_checked_at = now() where id = ${listingId}`;
}

export async function listManagedListings(
  channelAccountId: string,
): Promise<(ChannelListingRow & { on_hand: number; last_event_seq: string; item_type: "unique" | "stocked" })[]> {
  return db()<(ChannelListingRow & { on_hand: number; last_event_seq: string; item_type: "unique" | "stocked" })[]>`
    select cl.*, coalesce(ss.on_hand, 0) as on_hand, coalesce(ss.last_event_seq, 0) as last_event_seq, p.item_type
    from public.channel_listings cl
    join public.skus s on s.id = cl.sku_id
    join public.products p on p.id = s.product_id
    left join public.sku_stock ss on ss.sku_id = cl.sku_id
    where cl.channel_account_id = ${channelAccountId} and cl.managed and cl.status in ('active','pending')`;
}

export async function skuLastEventSeq(skuId: string): Promise<number> {
  const rows = await db()<
    { last_event_seq: string }[]
  >`select last_event_seq from public.sku_stock where sku_id = ${skuId}`;
  return Number(rows[0]?.last_event_seq ?? 0);
}
