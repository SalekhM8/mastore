import type {
  Channel,
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

/** The credentials and identity a connector needs for one call. Never persisted by the connector. */
export interface AccountContext {
  readonly workspaceId: WorkspaceId;
  readonly channelAccountId: string;
  readonly externalAccountId: string;
  readonly marketplace: string;
  readonly credentials: CredentialBundle;
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface ListingRef {
  readonly channelListingId: string;
  readonly externalListingId: string;
  readonly externalIds: Readonly<Record<string, string>>;
  readonly listingModel?: "inventory" | "trading";
}

export interface RawWebhookRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly url: string;
}

export interface WebhookVerification {
  readonly valid: boolean;
  readonly externalEventId: string;
  readonly topic: string;
  /** The seller account the event belongs to, when the payload identifies it. Without it the
   *  ingest job cannot route the event and marks the receipt unmatched; the order poll picks it up. */
  readonly externalAccountId?: string;
  /** Some channels need a synchronous challenge reply (eBay). */
  readonly challengeResponse?: { status: number; body: string; contentType: string };
}

/**
 * Every channel implements exactly this. A connector never touches the ledger, the database,
 * or another connector. It translates. See docs/engineering-standards.md section 3.
 */
export interface ChannelConnector {
  readonly channel: Channel;
  capabilities(): ChannelCapabilities;

  buildAuthorizeUrl(input: { workspaceId: WorkspaceId; state: string; redirectUri: string }): URL | null;
  exchangeAuthCode(input: { code: string; redirectUri: string }): Promise<PushResult<CredentialBundle>>;
  refreshCredentials(bundle: CredentialBundle): Promise<PushResult<CredentialBundle>>;
  /** Who do these credentials belong to? Used once at connect time to key the channel account. */
  identify(
    bundle: CredentialBundle,
  ): Promise<PushResult<{ externalAccountId: string; displayName: string; marketplace: string }>>;
  healthCheck(account: AccountContext): Promise<HealthReport>;

  listRemoteListings(account: AccountContext, cursor?: string): Promise<PushResult<Page<RemoteListing>>>;

  pushStock(account: AccountContext, listing: ListingRef, quantity: number): Promise<PushResult>;
  pushPrice(account: AccountContext, listing: ListingRef, priceMinor: number): Promise<PushResult>;
  createListing(account: AccountContext, payload: unknown): Promise<PushResult<RemoteListingRef>>;
  updateListing(account: AccountContext, listing: ListingRef, changes: unknown): Promise<PushResult>;
  delist(account: AccountContext, listing: ListingRef): Promise<PushResult>;

  verifyWebhook(request: RawWebhookRequest): Promise<WebhookVerification>;
  parseInbound(payload: unknown, topic: string): Promise<readonly NormalisedInbound[]>;
  pullOrders(account: AccountContext, sinceIso: string, cursor?: string): Promise<PushResult<Page<NormalisedInbound>>>;
  pullListingQuantities(
    account: AccountContext,
    listings: readonly ListingRef[],
  ): Promise<PushResult<ReadonlyMap<string, number>>>;
}
