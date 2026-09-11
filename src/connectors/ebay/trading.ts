import { z } from "zod";
import type { PushResult, RemoteListing } from "@/domain/channels/types";
import { type EbayConfig, endpoints, TRADING_COMPAT_LEVEL, UK_SITE_ID } from "./config";
import { type Exchange, exchange, type Failure, retryAfterMs } from "./http";
import { toMinor } from "./schemas";
import { escapeXml, tagBlocks, tagText, tradingEnvelope } from "./xml";

/**
 * Trading API (XML) for listings created on the eBay website or through older tools. These
 * listings have no Inventory API offer, so quantity, price and ending go through here.
 * Only four calls are used: ReviseInventoryStatus, EndFixedPriceItem, GetItem, GetMyeBaySelling.
 */

/** Trading error codes that mean the listing is over or not ours. */
const ENDED_CODES = new Set(["17", "291", "1047", "21916750", "21916884", "21916293", "21916012"]);
/** Trading error codes that mean the token is dead. */
const AUTH_CODES = new Set(["931", "932", "21916984", "21917053", "21916013"]);
/** Trading error codes for call-limit exhaustion. */
const LIMIT_CODES = new Set(["218050", "218053", "218054"]);
/** Trading error codes eBay documents as transient. */
const TRANSIENT_CODES = new Set(["10007", "21919189"]);

const TradingError = z.object({
  code: z.string(),
  severity: z.string(),
  shortMessage: z.string().optional(),
  longMessage: z.string().optional(),
});

interface TradingReply {
  readonly ack: string;
  readonly errors: z.infer<typeof TradingError>[];
  readonly xml: string;
}

async function call(
  cfg: EbayConfig,
  token: string,
  callName: string,
  inner: string,
): Promise<{ kind: "ok"; value: TradingReply } | Failure> {
  const res = await exchange(cfg, endpoints(cfg.env).trading, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": UK_SITE_ID,
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: tradingEnvelope(callName, inner),
  });
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status === 429) return { kind: "rate_limited", retryAfterMs: retryAfterMs(x.headers) };
  if (x.status === 401) return { kind: "auth_revoked", message: "eBay no longer accepts this account's token." };
  if (x.status >= 500) return { kind: "retryable", message: `eBay Trading API returned ${x.status} for ${callName}` };
  return { kind: "ok", value: parseReply(x) };
}

function parseReply(x: Exchange): TradingReply {
  const ack = tagText(x.text, "Ack") ?? "Failure";
  const errors = tagBlocks(x.text, "Errors")
    .map((block) => ({
      code: tagText(block, "ErrorCode") ?? "",
      severity: tagText(block, "SeverityCode") ?? "Error",
      shortMessage: tagText(block, "ShortMessage"),
      longMessage: tagText(block, "LongMessage"),
    }))
    .map((e) => TradingError.safeParse(e))
    .flatMap((p) => (p.success ? [p.data] : []));
  return { ack, errors, xml: x.text };
}

/** Turns a Failure ack into the taxonomy. Warnings are treated as success. */
function classify(reply: TradingReply, callName: string): Failure | null {
  if (reply.ack === "Success" || reply.ack === "Warning") return null;
  const errs = reply.errors.filter((e) => e.severity === "Error");
  const codes = errs.map((e) => e.code);
  const message = errs[0]?.longMessage ?? errs[0]?.shortMessage ?? `eBay rejected ${callName}.`;
  if (codes.some((c) => AUTH_CODES.has(c)))
    return { kind: "auth_revoked", message: "eBay no longer accepts this account's token." };
  if (codes.some((c) => LIMIT_CODES.has(c))) return { kind: "rate_limited", retryAfterMs: 60 * 60 * 1000 };
  if (codes.some((c) => TRANSIENT_CODES.has(c))) return { kind: "retryable", message };
  if (codes.some((c) => ENDED_CODES.has(c)))
    return { kind: "terminal", code: "ebay.listing_not_found", messageForSeller: message };
  return { kind: "terminal", code: `ebay.trading.${codes[0] ?? "failure"}`, messageForSeller: message };
}

export interface TradingTarget {
  readonly itemId: string;
  /** Variation SKU, only for multi-variation listings. */
  readonly variationSku?: string;
}

function inventoryStatus(target: TradingTarget, fields: string): string {
  const sku = target.variationSku ? `<SKU>${escapeXml(target.variationSku)}</SKU>` : "";
  return `<InventoryStatus><ItemID>${escapeXml(target.itemId)}</ItemID>${sku}${fields}</InventoryStatus>`;
}

/** ReviseInventoryStatus Quantity is the quantity available, not the original total. */
export async function reviseQuantity(
  cfg: EbayConfig,
  token: string,
  target: TradingTarget,
  quantity: number,
): Promise<PushResult> {
  const res = await call(
    cfg,
    token,
    "ReviseInventoryStatus",
    inventoryStatus(target, `<Quantity>${quantity}</Quantity>`),
  );
  if (res.kind !== "ok") return res;
  return classify(res.value, "ReviseInventoryStatus") ?? { kind: "ok", value: undefined };
}

export async function revisePrice(
  cfg: EbayConfig,
  token: string,
  target: TradingTarget,
  priceMinor: number,
): Promise<PushResult> {
  const price = (priceMinor / 100).toFixed(2);
  const res = await call(
    cfg,
    token,
    "ReviseInventoryStatus",
    inventoryStatus(target, `<StartPrice>${price}</StartPrice>`),
  );
  if (res.kind !== "ok") return res;
  return classify(res.value, "ReviseInventoryStatus") ?? { kind: "ok", value: undefined };
}

export async function endItem(cfg: EbayConfig, token: string, itemId: string): Promise<PushResult> {
  const res = await call(
    cfg,
    token,
    "EndFixedPriceItem",
    `<ItemID>${escapeXml(itemId)}</ItemID><EndingReason>NotAvailable</EndingReason>`,
  );
  if (res.kind !== "ok") return res;
  const failure = classify(res.value, "EndFixedPriceItem");
  // Ending an already-ended listing is the outcome we wanted.
  if (failure && failure.kind === "terminal" && failure.code === "ebay.listing_not_found")
    return { kind: "ok", value: undefined };
  return failure ?? { kind: "ok", value: undefined };
}

export interface ItemQuantity {
  readonly itemId: string;
  readonly available: number;
  readonly status: string;
}

export async function getItemQuantity(
  cfg: EbayConfig,
  token: string,
  itemId: string,
): Promise<PushResult<ItemQuantity>> {
  const res = await call(
    cfg,
    token,
    "GetItem",
    `<ItemID>${escapeXml(itemId)}</ItemID><DetailLevel>ReturnAll</DetailLevel><OutputSelector>Item.Quantity</OutputSelector><OutputSelector>Item.SellingStatus</OutputSelector>`,
  );
  if (res.kind !== "ok") return res;
  const failure = classify(res.value, "GetItem");
  if (failure) return failure;
  const item = tagBlocks(res.value.xml, "Item")[0] ?? "";
  const parsed = z
    .object({ quantity: z.coerce.number().int(), sold: z.coerce.number().int(), status: z.string() })
    .safeParse({
      quantity: tagText(item, "Quantity") ?? "0",
      sold: tagText(tagBlocks(item, "SellingStatus")[0] ?? "", "QuantitySold") ?? "0",
      status: tagText(tagBlocks(item, "SellingStatus")[0] ?? "", "ListingStatus") ?? "Unknown",
    });
  if (!parsed.success)
    return {
      kind: "terminal",
      code: "ebay.getitem.shape",
      messageForSeller: "eBay returned an unexpected listing shape.",
    };
  const available = parsed.data.status === "Active" ? Math.max(0, parsed.data.quantity - parsed.data.sold) : 0;
  return { kind: "ok", value: { itemId, available, status: parsed.data.status } };
}

export interface TradingPage {
  readonly items: RemoteListing[];
  readonly hasMore: boolean;
}

/** Active fixed-price listings, one page at a time. */
export async function listActive(
  cfg: EbayConfig,
  token: string,
  page: number,
  perPage = 100,
): Promise<PushResult<TradingPage>> {
  const inner = `<ActiveList><Include>true</Include><Sort>TimeLeft</Sort><Pagination><EntriesPerPage>${perPage}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><DetailLevel>ReturnAll</DetailLevel>`;
  const res = await call(cfg, token, "GetMyeBaySelling", inner);
  if (res.kind !== "ok") return res;
  const failure = classify(res.value, "GetMyeBaySelling");
  if (failure) return failure;
  const active = tagBlocks(res.value.xml, "ActiveList")[0] ?? "";
  const totalPages = Number(tagText(tagBlocks(active, "PaginationResult")[0] ?? "", "TotalNumberOfPages") ?? "1");
  const items: RemoteListing[] = [];
  for (const block of tagBlocks(active, "Item")) {
    const itemId = tagText(block, "ItemID");
    if (!itemId) continue;
    const selling = tagBlocks(block, "SellingStatus")[0] ?? "";
    const qtyAvailable = tagText(block, "QuantityAvailable");
    const qty = Number(tagText(block, "Quantity") ?? "0");
    const sold = Number(tagText(selling, "QuantitySold") ?? "0");
    const price =
      tagText(selling, "CurrentPrice") ?? tagText(block, "BuyItNowPrice") ?? tagText(block, "StartPrice") ?? "0";
    const sku = tagText(block, "SKU");
    const gallery = tagText(tagBlocks(block, "PictureDetails")[0] ?? "", "GalleryURL");
    items.push({
      externalListingId: itemId,
      externalIds: { listingModel: "trading", ...(sku ? { sku } : {}) },
      title: tagText(block, "Title") ?? "",
      ...(sku ? { sku } : {}),
      quantity: qtyAvailable !== undefined ? Number(qtyAvailable) : Math.max(0, qty - sold),
      price: { amountMinor: toMinor(price), currency: "GBP" },
      status: "active",
      photoUrls: gallery ? [gallery] : [],
      raw: { listingModel: "trading" },
    });
  }
  return { kind: "ok", value: { items, hasMore: page < totalPages } };
}
