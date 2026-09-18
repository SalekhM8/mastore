import { z } from "zod";
import type { NormalisedInbound, PushResult, RemoteListing } from "@/domain/channels/types";
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

/** eBay condition ids (Trading ConditionID) for our normalised conditions. */
const CONDITION_ID: Record<string, string> = {
  new: "1000",
  new_other: "1500",
  refurbished: "2000",
  used_like_new: "2750",
  used_very_good: "3000",
  used_good: "4000",
  used_acceptable: "5000",
  for_parts: "7000",
};

/** Sensible UK defaults a seller can override per listing through channelHints.ebay. */
const DEFAULTS = {
  categoryId: "88433", // Everything Else > Other. Overridden by channelHints.ebay.categoryId.
  location: "United Kingdom",
  postalCode: "",
  dispatchDays: "3",
  shippingService: "UK_RoyalMailSecondClassStandard",
  shippingCostMinor: "0",
  returnsWithin: "Days_30",
};

export interface NewFixedPriceItem {
  readonly sku: string;
  readonly title: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly quantity: number;
  readonly condition: string;
  readonly photoUrls: readonly string[];
  readonly brand?: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly hints?: Readonly<Record<string, string>>;
}

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * AddFixedPriceItem: creates a Good 'Til Cancelled fixed-price listing on ebay.co.uk.
 * Returns the new ItemID. The listing is a "trading" model listing for every later call.
 */
export async function addFixedPriceItem(
  cfg: EbayConfig,
  token: string,
  item: NewFixedPriceItem,
): Promise<PushResult<{ itemId: string; fees: string | undefined }>> {
  const h = { ...DEFAULTS, ...(item.hints ?? {}) };
  const specifics = Object.entries({ ...(item.brand ? { Brand: item.brand } : {}), ...(item.attributes ?? {}) })
    .map(([n, v]) => `<NameValueList><Name>${escapeXml(n)}</Name><Value>${escapeXml(v)}</Value></NameValueList>`)
    .join("");
  const pictures = item.photoUrls.map((u) => `<PictureURL>${escapeXml(u)}</PictureURL>`).join("");
  // Element order follows eBay's AddFixedPriceItem sample. The Trading API validates sequence.
  const inner = `<Item>
<Title>${escapeXml(item.title.slice(0, 80))}</Title>
<Description><![CDATA[${item.description}]]></Description>
<PrimaryCategory><CategoryID>${escapeXml(h.categoryId)}</CategoryID></PrimaryCategory>
<StartPrice currencyID="GBP">${money(item.priceMinor)}</StartPrice>
<CategoryMappingAllowed>true</CategoryMappingAllowed>
<ConditionID>${CONDITION_ID[item.condition] ?? "3000"}</ConditionID>
<Country>GB</Country>
<Currency>GBP</Currency>
<DispatchTimeMax>${escapeXml(h.dispatchDays)}</DispatchTimeMax>
${specifics ? `<ItemSpecifics>${specifics}</ItemSpecifics>` : ""}
<ListingDuration>GTC</ListingDuration>
<ListingType>FixedPriceItem</ListingType>
<Location>${escapeXml(h.location)}</Location>
${pictures ? `<PictureDetails>${pictures}</PictureDetails>` : ""}
${h.postalCode ? `<PostalCode>${escapeXml(h.postalCode)}</PostalCode>` : ""}
<Quantity>${Math.max(1, Math.floor(item.quantity))}</Quantity>
<ReturnPolicy><ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption><ReturnsWithinOption>${escapeXml(h.returnsWithin)}</ReturnsWithinOption><ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption></ReturnPolicy>
<ShippingDetails><ShippingServiceOptions><ShippingService>${escapeXml(h.shippingService)}</ShippingService><ShippingServiceCost currencyID="GBP">${money(Number(h.shippingCostMinor) || 0)}</ShippingServiceCost><ShippingServicePriority>1</ShippingServicePriority></ShippingServiceOptions><ShippingType>Flat</ShippingType></ShippingDetails>
<Site>UK</Site>
<SKU>${escapeXml(item.sku)}</SKU>
</Item>`;
  const res = await call(cfg, token, "AddFixedPriceItem", inner);
  if (res.kind !== "ok") return res;
  const failure = classify(res.value, "AddFixedPriceItem");
  if (failure) return failure;
  const itemId = tagText(res.value.xml, "ItemID");
  if (!itemId)
    return {
      kind: "terminal",
      code: "ebay.add_item.no_id",
      messageForSeller: "eBay accepted the listing but returned no item id.",
    };
  return { kind: "ok", value: { itemId, fees: tagText(res.value.xml, "Fee") } };
}

/**
 * GetOrders: every order touched since a point in time, paid or not. eBay reduces the listing's
 * quantity the moment a buyer commits, so an unpaid order is already a sale for stock purposes.
 * Cancelled orders yield cancellations. Cursor is the page number.
 */
export async function getOrders(
  cfg: EbayConfig,
  token: string,
  modifiedSinceIso: string,
  cursor?: string,
): Promise<PushResult<{ items: NormalisedInbound[]; nextCursor?: string }>> {
  const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
  const now = cfg.now ? cfg.now() : new Date();
  // eBay requires the window to be at most 30 days and the end to be no later than now.
  const from = new Date(Math.max(Date.parse(modifiedSinceIso), now.getTime() - 29 * 24 * 3600_000));
  const inner = `<ModTimeFrom>${from.toISOString()}</ModTimeFrom><ModTimeTo>${now.toISOString()}</ModTimeTo><OrderRole>Seller</OrderRole><OrderStatus>All</OrderStatus><Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>`;
  const res = await call(cfg, token, "GetOrders", inner);
  if (res.kind !== "ok") return res;
  const failure = classify(res.value, "GetOrders");
  if (failure) return failure;
  const items: NormalisedInbound[] = [];
  for (const order of tagBlocks(res.value.xml, "Order")) {
    const orderId = tagText(order, "OrderID");
    const status = tagText(order, "OrderStatus") ?? "Active";
    const created = tagText(order, "CreatedTime") ?? now.toISOString();
    const modified = tagText(order, "CheckoutStatus")
      ? (tagText(tagBlocks(order, "CheckoutStatus")[0] ?? "", "LastModifiedTime") ?? created)
      : created;
    if (!orderId) continue;
    const cancelled = status === "Cancelled" || tagText(order, "CancelStatus") === "CancelComplete";
    if (status === "Inactive") continue; // abandoned checkout, never counted by eBay
    for (const tx of tagBlocks(order, "Transaction")) {
      const lineId = tagText(tx, "OrderLineItemID") ?? tagText(tx, "TransactionID");
      const itemId = tagText(tagBlocks(tx, "Item")[0] ?? "", "ItemID");
      const quantity = Number(tagText(tx, "QuantityPurchased") ?? "1") || 1;
      if (!lineId || !itemId) continue;
      if (cancelled) {
        items.push({
          type: "cancellation",
          externalOrderId: orderId,
          externalLineId: lineId,
          quantity,
          occurredAt: modified,
        });
      } else {
        const price = tagText(tx, "TransactionPrice") ?? "0";
        items.push({
          type: "sale",
          externalOrderId: orderId,
          externalLineId: lineId,
          externalListingId: itemId,
          quantity,
          unitPrice: { amountMinor: toMinor(price), currency: "GBP" },
          occurredAt: tagText(tx, "CreatedDate") ?? created,
        });
      }
    }
  }
  const more = tagText(res.value.xml, "HasMoreOrders") === "true";
  return { kind: "ok", value: { items, ...(more ? { nextCursor: String(page + 1) } : {}) } };
}

/**
 * Platform Notifications: eBay's per-seller push for sales and listing changes. The modern
 * Notification API has no new-order topic for third-party apps, so this is how a sale reaches us
 * within seconds. Idempotent: calling it again re-asserts the same preferences.
 */
export async function setNotificationPreferences(
  cfg: EbayConfig,
  token: string,
  applicationUrl: string,
  alertEmail?: string,
): Promise<PushResult> {
  const events = ["FixedPriceTransaction", "AuctionCheckoutComplete", "ItemSold", "ItemClosed", "ItemRevised"];
  const prefs = events
    .map((e) => `<NotificationEnable><EventType>${e}</EventType><EventEnable>Enable</EventEnable></NotificationEnable>`)
    .join("");
  const inner = `<ApplicationDeliveryPreferences><ApplicationEnable>Enable</ApplicationEnable><ApplicationURL>${escapeXml(applicationUrl)}</ApplicationURL><DeviceType>Platform</DeviceType>${alertEmail ? `<AlertEnable>Enable</AlertEnable><AlertEmail>mailto://${escapeXml(alertEmail)}</AlertEmail>` : ""}</ApplicationDeliveryPreferences><UserDeliveryPreferenceArray>${prefs}</UserDeliveryPreferenceArray>`;
  const res = await call(cfg, token, "SetNotificationPreferences", inner);
  if (res.kind !== "ok") return res;
  const failure = classify(res.value, "SetNotificationPreferences");
  if (failure) return failure;
  return { kind: "ok", value: undefined };
}
