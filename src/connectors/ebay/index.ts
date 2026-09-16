import { z } from "zod";
import type {
  ChannelCapabilities,
  CredentialBundle,
  HealthReport,
  NormalisedInbound,
  Page,
  PushResult,
  RemoteListing,
  RemoteListingRef,
  WorkspaceId,
} from "@/domain/channels/types";
import type { AccountContext, ChannelConnector, ListingRef, RawWebhookRequest, WebhookVerification } from "../contract";
import * as auth from "./auth";
import { type EbayConfig, UK_MARKETPLACE_ID } from "./config";
import * as fulfillment from "./fulfillment";
import { apiUrl, exchange, restHeaders } from "./http";
import * as inventory from "./inventory";
import { NotificationVerifier, parseInbound } from "./notifications";
import * as trading from "./trading";

export type { EbayConfig } from "./config";
export { orderIdFromNotification } from "./notifications";

interface Cursor {
  readonly model: "inventory" | "trading";
  readonly offset: number;
}

function decodeCursor(cursor?: string): Cursor {
  if (!cursor) return { model: "inventory", offset: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<Cursor>;
    return {
      model: parsed.model === "trading" ? "trading" : "inventory",
      offset: typeof parsed.offset === "number" ? parsed.offset : 0,
    };
  } catch {
    return { model: "inventory", offset: 0 };
  }
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

/** Which API manages this listing. Listings without an offer id are Trading API listings. */
function modelOf(listing: ListingRef): "inventory" | "trading" {
  if (listing.listingModel) return listing.listingModel;
  return listing.externalIds.offerId ? "inventory" : "trading";
}

function inventoryTarget(listing: ListingRef): inventory.InventoryTarget | null {
  const offerId = listing.externalIds.offerId;
  const sku = listing.externalIds.sku;
  return offerId && sku ? { offerId, sku } : null;
}

function tradingTarget(listing: ListingRef): trading.TradingTarget {
  const variationSku = listing.externalIds.variationSku;
  return { itemId: listing.externalListingId, ...(variationSku ? { variationSku } : {}) };
}

const MISSING_OFFER: PushResult = {
  kind: "terminal",
  code: "ebay.missing_offer",
  messageForSeller: "This eBay listing has no offer id on record. Re-import the listing from eBay.",
};

/**
 * eBay (UK). Two listing models live side by side: Inventory API (offers) and Trading API
 * (website-created listings). Every outbound call picks the API from the listing's model.
 * See README.md in this folder.
 */
const ListingDraftSchema = z.object({
  sku: z.string().min(1).max(50),
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(500_000),
  priceMinor: z.number().int().positive(),
  quantity: z.number().int().positive(),
  condition: z.enum([
    "new",
    "new_other",
    "refurbished",
    "used_like_new",
    "used_very_good",
    "used_good",
    "used_acceptable",
    "for_parts",
  ]),
  photoUrls: z.array(z.string().url()).max(24),
  brand: z.string().max(65).optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  channelHints: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

export class EbayConnector implements ChannelConnector {
  readonly channel = "ebay" as const;
  private readonly verifier: NotificationVerifier;

  constructor(private readonly cfg: EbayConfig) {
    this.verifier = new NotificationVerifier(cfg);
  }

  capabilities(): ChannelCapabilities {
    return { multiQuantity: true, webhooks: true, createListings: true, priceUpdates: true, auth: "oauth" };
  }

  buildAuthorizeUrl(input: { workspaceId: WorkspaceId; state: string; redirectUri: string }): URL {
    return auth.buildAuthorizeUrl(this.cfg, input);
  }

  exchangeAuthCode(input: { code: string; redirectUri: string }): Promise<PushResult<CredentialBundle>> {
    return auth.exchangeAuthCode(this.cfg, input.code);
  }

  refreshCredentials(bundle: CredentialBundle): Promise<PushResult<CredentialBundle>> {
    return auth.refreshCredentials(this.cfg, bundle);
  }

  /** The seller behind a token. `username` becomes external_account_id; webhooks route by it. */
  async identify(
    bundle: CredentialBundle,
  ): Promise<PushResult<{ externalAccountId: string; displayName: string; marketplace: string }>> {
    const res = await auth.getSellerIdentity(this.cfg, bundle);
    if (res.kind !== "ok") return res;
    return {
      kind: "ok",
      value: { externalAccountId: res.value.username, displayName: res.value.username, marketplace: UK_MARKETPLACE_ID },
    };
  }

  async healthCheck(account: AccountContext): Promise<HealthReport> {
    const checkedAt = (this.cfg.now ? this.cfg.now() : new Date()).toISOString();
    const res = await exchange(this.cfg, apiUrl(this.cfg, "/sell/account/v1/privilege"), {
      method: "GET",
      headers: restHeaders(account.credentials.accessToken),
    });
    if (res.kind !== "ok") return { ok: false, checkedAt, detail: res.kind === "retryable" ? res.message : res.kind };
    const ok = res.value.status >= 200 && res.value.status < 300;
    return ok ? { ok, checkedAt } : { ok, checkedAt, detail: `eBay returned ${res.value.status}` };
  }

  async listRemoteListings(account: AccountContext, cursor?: string): Promise<PushResult<Page<RemoteListing>>> {
    const token = account.credentials.accessToken;
    const c = decodeCursor(cursor);
    if (c.model === "inventory") {
      const page = await inventory.listInventory(this.cfg, token, c.offset);
      if (page.kind !== "ok") return page;
      const next = page.value.hasMore
        ? encodeCursor({ model: "inventory", offset: c.offset + page.value.items.length })
        : encodeCursor({ model: "trading", offset: 1 });
      return { kind: "ok", value: { items: page.value.items, nextCursor: next } };
    }
    const page = await trading.listActive(this.cfg, token, Math.max(1, c.offset));
    if (page.kind !== "ok") return page;
    return {
      kind: "ok",
      value: {
        items: page.value.items,
        ...(page.value.hasMore ? { nextCursor: encodeCursor({ model: "trading", offset: c.offset + 1 }) } : {}),
      },
    };
  }

  pushStock(account: AccountContext, listing: ListingRef, quantity: number): Promise<PushResult> {
    const token = account.credentials.accessToken;
    if (modelOf(listing) === "trading")
      return trading.reviseQuantity(this.cfg, token, tradingTarget(listing), quantity);
    const target = inventoryTarget(listing);
    return target ? inventory.updateQuantity(this.cfg, token, target, quantity) : Promise.resolve(MISSING_OFFER);
  }

  pushPrice(account: AccountContext, listing: ListingRef, priceMinor: number): Promise<PushResult> {
    const token = account.credentials.accessToken;
    if (modelOf(listing) === "trading") return trading.revisePrice(this.cfg, token, tradingTarget(listing), priceMinor);
    const target = inventoryTarget(listing);
    return target ? inventory.updatePrice(this.cfg, token, target, priceMinor) : Promise.resolve(MISSING_OFFER);
  }

  async createListing(account: AccountContext, payload: unknown): Promise<PushResult<RemoteListingRef>> {
    const parsed = ListingDraftSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        kind: "terminal",
        code: "ebay.draft.shape",
        messageForSeller:
          "The listing is missing something eBay needs: " + parsed.error.issues.map((i) => i.path.join(".")).join(", "),
      };
    }
    const d = parsed.data;
    const res = await trading.addFixedPriceItem(this.cfg, account.credentials.accessToken, {
      sku: d.sku,
      title: d.title,
      description: d.description,
      priceMinor: d.priceMinor,
      quantity: d.quantity,
      condition: d.condition,
      photoUrls: d.photoUrls,
      ...(d.brand ? { brand: d.brand } : {}),
      ...(d.attributes ? { attributes: d.attributes } : {}),
      ...(d.channelHints?.ebay ? { hints: d.channelHints.ebay } : {}),
    });
    if (res.kind !== "ok") return res;
    return {
      kind: "ok",
      value: { externalListingId: res.value.itemId, externalIds: { listingModel: "trading", sku: d.sku } },
    };
  }

  async updateListing(_account: AccountContext, _listing: ListingRef, _changes: unknown): Promise<PushResult> {
    return {
      kind: "terminal",
      code: "ebay.not_implemented",
      messageForSeller:
        "Editing eBay listing details from Sync is not available yet. Edit on eBay; stock and price still sync.",
    };
  }

  delist(account: AccountContext, listing: ListingRef): Promise<PushResult> {
    const token = account.credentials.accessToken;
    if (modelOf(listing) === "trading") return trading.endItem(this.cfg, token, listing.externalListingId);
    const offerId = listing.externalIds.offerId;
    return offerId ? inventory.withdrawOffer(this.cfg, token, offerId) : Promise.resolve(MISSING_OFFER);
  }

  verifyWebhook(request: RawWebhookRequest): Promise<WebhookVerification> {
    return this.verifier.verify(request);
  }

  async parseInbound(payload: unknown, topic: string): Promise<readonly NormalisedInbound[]> {
    return parseInbound(payload, topic);
  }

  /** When ORDER_CONFIRMATION carries no line items, the job calls this with the order id. */
  pullOrder(account: AccountContext, orderId: string): Promise<PushResult<readonly NormalisedInbound[]>> {
    return fulfillment.getOrder(this.cfg, account.credentials.accessToken, orderId);
  }

  pullOrders(account: AccountContext, sinceIso: string, cursor?: string): Promise<PushResult<Page<NormalisedInbound>>> {
    return fulfillment.pullOrders(this.cfg, account.credentials.accessToken, sinceIso, cursor);
  }

  async pullListingQuantities(
    account: AccountContext,
    listings: readonly ListingRef[],
  ): Promise<PushResult<ReadonlyMap<string, number>>> {
    const token = account.credentials.accessToken;
    const out = new Map<string, number>();
    for (const listing of listings) {
      if (modelOf(listing) === "inventory") {
        const offerId = listing.externalIds.offerId;
        if (!offerId) continue;
        const offer = await inventory.getOffer(this.cfg, token, offerId);
        if (offer.kind === "terminal" && offer.code === "ebay.listing_not_found") {
          out.set(listing.externalListingId, 0);
          continue;
        }
        if (offer.kind !== "ok") return offer;
        out.set(listing.externalListingId, offer.value.availableQuantity ?? 0);
      } else {
        const item = await trading.getItemQuantity(this.cfg, token, listing.externalListingId);
        if (item.kind === "terminal" && item.code === "ebay.listing_not_found") {
          out.set(listing.externalListingId, 0);
          continue;
        }
        if (item.kind !== "ok") return item;
        out.set(listing.externalListingId, item.value.available);
      }
    }
    return { kind: "ok", value: out };
  }
}
