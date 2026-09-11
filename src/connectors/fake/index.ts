import type { NormalisedInbound, Page, PushResult, RemoteListing } from "@/domain/channels/types";
import type { AccountContext, ChannelConnector, ListingRef, RawWebhookRequest } from "../contract";

/**
 * In-memory connector for tests and local development. Behaves like a well-mannered marketplace:
 * remembers what was pushed, can be told to fail, and can emit inbound events on demand.
 */
export class FakeConnector implements ChannelConnector {
  readonly channel = "storefront" as const;
  readonly pushed: Array<{ op: string; externalListingId: string; value?: number }> = [];
  private failNext: PushResult | null = null;
  private readonly remoteQty = new Map<string, number>();

  constructor(private readonly opts: { multiQuantity?: boolean; webhooks?: boolean } = {}) {}

  capabilities() {
    return {
      multiQuantity: this.opts.multiQuantity ?? true,
      webhooks: this.opts.webhooks ?? true,
      createListings: true,
      priceUpdates: true,
      auth: "token" as const,
    };
  }

  /** Make the next outbound call return this result instead of ok. */
  failOnce(result: PushResult) {
    this.failNext = result;
  }

  seedRemote(externalListingId: string, quantity: number) {
    this.remoteQty.set(externalListingId, quantity);
  }

  private consumeFailure(): PushResult | null {
    const f = this.failNext;
    this.failNext = null;
    return f;
  }

  buildAuthorizeUrl() {
    return null;
  }
  async exchangeAuthCode(): Promise<PushResult<never>> {
    return { kind: "terminal", code: "unsupported", messageForSeller: "This channel uses a pasted token." };
  }
  async refreshCredentials(bundle: AccountContext["credentials"]) {
    return { kind: "ok" as const, value: bundle };
  }
  async identify(bundle: AccountContext["credentials"]) {
    return {
      kind: "ok" as const,
      value: {
        externalAccountId: `fake-${bundle.accessToken.slice(0, 8)}`,
        displayName: "Fake store",
        marketplace: "GB",
      },
    };
  }
  async healthCheck() {
    return { ok: true, checkedAt: new Date().toISOString() };
  }
  async listRemoteListings(): Promise<PushResult<Page<RemoteListing>>> {
    const items: RemoteListing[] = [...this.remoteQty.entries()].map(([id, quantity]) => ({
      externalListingId: id,
      externalIds: {},
      title: `Remote ${id}`,
      quantity,
      price: { amountMinor: 1000, currency: "GBP" },
      status: "active",
      photoUrls: [],
    }));
    return { kind: "ok", value: { items } };
  }
  async pushStock(_a: AccountContext, listing: ListingRef, quantity: number): Promise<PushResult> {
    const f = this.consumeFailure();
    if (f) return f;
    this.remoteQty.set(listing.externalListingId, quantity);
    this.pushed.push({ op: "stock", externalListingId: listing.externalListingId, value: quantity });
    return { kind: "ok", value: undefined };
  }
  async pushPrice(_a: AccountContext, listing: ListingRef, priceMinor: number): Promise<PushResult> {
    const f = this.consumeFailure();
    if (f) return f;
    this.pushed.push({ op: "price", externalListingId: listing.externalListingId, value: priceMinor });
    return { kind: "ok", value: undefined };
  }
  async createListing(): Promise<PushResult<{ externalListingId: string; externalIds: Record<string, string> }>> {
    const f = this.consumeFailure();
    if (f) return f as PushResult<never>;
    const id = `fake-${this.pushed.length + 1}`;
    this.pushed.push({ op: "create", externalListingId: id });
    return { kind: "ok", value: { externalListingId: id, externalIds: {} } };
  }
  async updateListing(_a: AccountContext, listing: ListingRef): Promise<PushResult> {
    const f = this.consumeFailure();
    if (f) return f;
    this.pushed.push({ op: "update", externalListingId: listing.externalListingId });
    return { kind: "ok", value: undefined };
  }
  async delist(_a: AccountContext, listing: ListingRef): Promise<PushResult> {
    const f = this.consumeFailure();
    if (f) return f;
    this.remoteQty.set(listing.externalListingId, 0);
    this.pushed.push({ op: "delist", externalListingId: listing.externalListingId, value: 0 });
    return { kind: "ok", value: undefined };
  }
  async verifyWebhook(request: RawWebhookRequest) {
    const body = JSON.parse(request.rawBody) as { id: string; topic: string };
    return { valid: request.headers["x-fake-signature"] === "valid", externalEventId: body.id, topic: body.topic };
  }
  async parseInbound(payload: unknown): Promise<readonly NormalisedInbound[]> {
    return (payload as { events: NormalisedInbound[] }).events ?? [];
  }
  async pullOrders(): Promise<PushResult<Page<NormalisedInbound>>> {
    return { kind: "ok", value: { items: [] } };
  }
  async pullListingQuantities(
    _a: AccountContext,
    listings: readonly ListingRef[],
  ): Promise<PushResult<ReadonlyMap<string, number>>> {
    const m = new Map<string, number>();
    for (const l of listings) m.set(l.externalListingId, this.remoteQty.get(l.externalListingId) ?? 0);
    return { kind: "ok", value: m };
  }
}
