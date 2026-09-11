import type { z } from "zod";
import type { PushResult, RemoteListing } from "@/domain/channels/types";
import type { EbayConfig } from "./config";
import { UK_MARKETPLACE_ID } from "./config";
import { apiUrl, classifyRest, exchange, restHeaders, sellerMessageFromErrors } from "./http";
import { BulkUpdateResponse, InventoryItemsResponse, Offer, OffersResponse, toMinor } from "./schemas";

/**
 * Inventory API (REST) for listings that have an inventory item and an offer. Quantity and price
 * go through bulk_update_price_quantity; ending goes through offer withdraw.
 */

export interface InventoryTarget {
  readonly sku: string;
  readonly offerId: string;
}

async function bulkUpdate(
  cfg: EbayConfig,
  token: string,
  target: InventoryTarget,
  offerFields: Record<string, unknown>,
  skuFields: Record<string, unknown>,
): Promise<PushResult> {
  const body = {
    requests: [{ sku: target.sku, ...skuFields, offers: [{ offerId: target.offerId, ...offerFields }] }],
  };
  const res = await exchange(cfg, apiUrl(cfg, "/sell/inventory/v1/bulk_update_price_quantity"), {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify(body),
  });
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status < 200 || x.status >= 300) return classifyRest(x, "stock update");
  const parsed = BulkUpdateResponse.safeParse(x.json);
  if (!parsed.success) {
    return {
      kind: "terminal",
      code: "ebay.bulk_update.shape",
      messageForSeller: "eBay returned an unexpected update response.",
    };
  }
  for (const r of parsed.data.responses) {
    const perOffer = r.offers ?? [];
    const failed = [r, ...perOffer].find((p) => p.statusCode < 200 || p.statusCode >= 300);
    if (!failed) continue;
    const msg = sellerMessageFromErrors({ errors: failed.errors ?? [] }, "eBay rejected the update for this listing.");
    if (failed.statusCode === 404) return { kind: "terminal", code: "ebay.listing_not_found", messageForSeller: msg };
    if (failed.statusCode === 429) return { kind: "rate_limited", retryAfterMs: 10_000 };
    if (failed.statusCode >= 500) return { kind: "retryable", message: msg };
    return { kind: "terminal", code: `ebay.bulk_update.${failed.statusCode}`, messageForSeller: msg };
  }
  return { kind: "ok", value: undefined };
}

export function updateQuantity(
  cfg: EbayConfig,
  token: string,
  target: InventoryTarget,
  quantity: number,
): Promise<PushResult> {
  return bulkUpdate(cfg, token, target, { availableQuantity: quantity }, { shipToLocationAvailability: { quantity } });
}

export function updatePrice(
  cfg: EbayConfig,
  token: string,
  target: InventoryTarget,
  priceMinor: number,
): Promise<PushResult> {
  return bulkUpdate(cfg, token, target, { price: { value: (priceMinor / 100).toFixed(2), currency: "GBP" } }, {});
}

export async function withdrawOffer(cfg: EbayConfig, token: string, offerId: string): Promise<PushResult> {
  const res = await exchange(cfg, apiUrl(cfg, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`), {
    method: "POST",
    headers: restHeaders(token),
    body: "{}",
  });
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status >= 200 && x.status < 300) return { kind: "ok", value: undefined };
  const failure = classifyRest(x, "delist");
  // Withdrawing an offer that is already unpublished is the outcome we wanted.
  if (failure.kind === "terminal" && failure.code === "ebay.listing_not_found") return { kind: "ok", value: undefined };
  return failure;
}

export async function getOffer(
  cfg: EbayConfig,
  token: string,
  offerId: string,
): Promise<PushResult<z.infer<typeof Offer>>> {
  const res = await exchange(cfg, apiUrl(cfg, `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`), {
    method: "GET",
    headers: restHeaders(token),
  });
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status < 200 || x.status >= 300) return classifyRest(x, "offer lookup");
  const parsed = Offer.safeParse(x.json);
  if (!parsed.success)
    return { kind: "terminal", code: "ebay.offer.shape", messageForSeller: "eBay returned an unexpected offer shape." };
  return { kind: "ok", value: parsed.data };
}

async function offersForSku(cfg: EbayConfig, token: string, sku: string): Promise<PushResult<z.infer<typeof Offer>[]>> {
  const res = await exchange(
    cfg,
    apiUrl(cfg, `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${UK_MARKETPLACE_ID}`),
    { method: "GET", headers: restHeaders(token) },
  );
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status === 404) return { kind: "ok", value: [] };
  if (x.status < 200 || x.status >= 300) return classifyRest(x, "offer lookup");
  const parsed = OffersResponse.safeParse(x.json);
  if (!parsed.success)
    return {
      kind: "terminal",
      code: "ebay.offers.shape",
      messageForSeller: "eBay returned an unexpected offers shape.",
    };
  return { kind: "ok", value: parsed.data.offers };
}

export interface InventoryPage {
  readonly items: RemoteListing[];
  readonly hasMore: boolean;
}

/** One page of inventory items, each joined with its UK offer for price, quantity and listing id. */
export async function listInventory(
  cfg: EbayConfig,
  token: string,
  offset: number,
  limit = 25,
): Promise<PushResult<InventoryPage>> {
  const res = await exchange(cfg, apiUrl(cfg, `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`), {
    method: "GET",
    headers: restHeaders(token),
  });
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status < 200 || x.status >= 300) return classifyRest(x, "inventory listing");
  const parsed = InventoryItemsResponse.safeParse(x.json);
  if (!parsed.success) {
    return {
      kind: "terminal",
      code: "ebay.inventory.shape",
      messageForSeller: "eBay returned an unexpected inventory shape.",
    };
  }
  const items: RemoteListing[] = [];
  for (const item of parsed.data.inventoryItems) {
    const offers = await offersForSku(cfg, token, item.sku);
    if (offers.kind !== "ok") return offers;
    const offer = offers.value[0];
    const stockQty = item.availability?.shipToLocationAvailability?.quantity ?? 0;
    const published = offer?.status === "PUBLISHED" && offer.listing?.listingId;
    const externalListingId =
      published && offer.listing?.listingId
        ? offer.listing.listingId
        : offer
          ? `offer:${offer.offerId}`
          : `sku:${item.sku}`;
    items.push({
      externalListingId,
      externalIds: {
        listingModel: "inventory",
        sku: item.sku,
        ...(offer ? { offerId: offer.offerId } : {}),
      },
      title: item.product?.title ?? item.sku,
      sku: item.sku,
      quantity: offer?.availableQuantity ?? stockQty,
      price: {
        amountMinor: offer?.pricingSummary?.price ? toMinor(offer.pricingSummary.price.value) : 0,
        currency: "GBP",
      },
      status: published ? "active" : offer ? "draft" : "draft",
      photoUrls: item.product?.imageUrls ?? [],
      raw: { listingModel: "inventory" },
    });
  }
  const total = parsed.data.total ?? offset + items.length;
  return {
    kind: "ok",
    value: {
      items,
      hasMore: offset + parsed.data.inventoryItems.length < total && parsed.data.inventoryItems.length > 0,
    },
  };
}
