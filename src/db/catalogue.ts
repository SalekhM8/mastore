import type { RemoteListing } from "@/domain/channels/types";
import { db, json } from "./client";

/** Catalogue writes used by import. Reads for the UI go through the RLS client in the app. */

export async function findSkuByCode(
  workspaceId: string,
  sku: string,
): Promise<{ id: string; product_id: string } | null> {
  const rows = await db()<{ id: string; product_id: string }[]>`
    select id, product_id from public.skus where workspace_id = ${workspaceId} and sku = ${sku} and deleted_at is null`;
  return rows[0] ?? null;
}

export async function createProductWithSku(input: {
  workspaceId: string;
  title: string;
  itemType: "unique" | "stocked";
  priceMinor: number;
  sku: string;
  condition?: string | null;
  attributes?: Record<string, unknown>;
}): Promise<{ productId: string; skuId: string }> {
  const sql = db();
  return sql.begin(async (tx) => {
    const [p] = await tx<{ id: string }[]>`
      insert into public.products (workspace_id, item_type, title, base_price_minor, status, condition, attributes)
      values (${input.workspaceId}, ${input.itemType}, ${input.title.slice(0, 300)}, ${input.priceMinor}, 'active',
              ${input.condition ?? null}, ${json(tx, input.attributes ?? {})})
      returning id`;
    if (!p) throw new Error("product insert returned no row");
    const [s] = await tx<{ id: string }[]>`
      insert into public.skus (workspace_id, product_id, sku) values (${input.workspaceId}, ${p.id}, ${input.sku.slice(0, 80)}) returning id`;
    if (!s) throw new Error("sku insert returned no row");
    return { productId: p.id, skuId: s.id };
  });
}

/** Insert or refresh the channel listing row for one remote listing. Never touches managed or sync flags. */
export async function upsertImportedListing(input: {
  workspaceId: string;
  channelAccountId: string;
  skuId: string;
  remote: RemoteListing;
}): Promise<{ id: string; created: boolean }> {
  const sql = db();
  const r = input.remote;
  const model = typeof r.externalIds.listingModel === "string" ? r.externalIds.listingModel : null;
  const status = r.status === "active" ? "active" : r.status === "ended" ? "ended" : "draft";
  const rows = await sql<{ id: string; created: boolean }[]>`
    insert into public.channel_listings
      (workspace_id, channel_account_id, sku_id, external_listing_id, external_ids, listing_model, status, managed,
       price_minor, desired_quantity, remote_quantity, remote_checked_at, title_snapshot, channel_payload)
    values
      (${input.workspaceId}, ${input.channelAccountId}, ${input.skuId}, ${r.externalListingId}, ${json(sql, r.externalIds)},
       ${model === "inventory" || model === "trading" ? model : null}, ${status}, false,
       ${r.price.amountMinor}, ${Math.max(r.quantity, 0)}, ${r.quantity}, now(), ${r.title.slice(0, 300)}, ${json(sql, r.raw ?? {})})
    on conflict (channel_account_id, external_listing_id) do update set
      sku_id = coalesce(public.channel_listings.sku_id, excluded.sku_id),
      external_ids = excluded.external_ids,
      listing_model = coalesce(excluded.listing_model, public.channel_listings.listing_model),
      status = case when public.channel_listings.managed then public.channel_listings.status else excluded.status end,
      price_minor = excluded.price_minor,
      remote_quantity = excluded.remote_quantity,
      remote_checked_at = now(),
      title_snapshot = excluded.title_snapshot,
      channel_payload = excluded.channel_payload
    returning id, (xmax = 0) as created`;
  const row = rows[0];
  if (!row) throw new Error("listing upsert returned no row");
  return row;
}

export async function setImportStatus(channelAccountId: string, status: Record<string, unknown>): Promise<void> {
  const sql = db();
  await sql`update public.channel_accounts set account_settings = account_settings || ${json(sql, { import: status })} where id = ${channelAccountId}`;
}
