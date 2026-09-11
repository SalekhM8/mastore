/**
 * Normalised channel types. Every connector maps its marketplace's API to and from these.
 * Domain code imports only from here; it never sees a marketplace payload.
 */

export const CHANNELS = ["ebay", "amazon", "tiktok", "vinted", "depop", "etsy", "onbuy", "storefront"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Branded ids so a SkuId can never be passed where a WorkspaceId is expected. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type SkuId = Brand<string, "SkuId">;
export type ProductId = Brand<string, "ProductId">;
export type ChannelAccountId = Brand<string, "ChannelAccountId">;
export type ChannelListingId = Brand<string, "ChannelListingId">;
export type PushJobId = Brand<string, "PushJobId">;

/** Money is always integer minor units with an explicit currency. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: "GBP";
}

export type ItemType = "unique" | "stocked";

export interface ChannelCapabilities {
  /** Can a listing carry a quantity greater than one? Vinted and Depop: no. */
  readonly multiQuantity: boolean;
  /** Does the marketplace push events to us, or must we poll? OnBuy: poll only. */
  readonly webhooks: boolean;
  /** Can we create listings from the catalog? Amazon in v1: no, sync only. */
  readonly createListings: boolean;
  readonly priceUpdates: boolean;
  /** Is authorisation OAuth (redirect) or a pasted token? */
  readonly auth: "oauth" | "token";
}

export interface CredentialBundle {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string; // ISO
  readonly scopes: readonly string[];
  readonly extra?: Readonly<Record<string, string>>;
}

export interface HealthReport {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly detail?: string;
}

export interface RemoteListing {
  readonly externalListingId: string;
  readonly externalIds: Readonly<Record<string, string>>;
  readonly title: string;
  readonly sku?: string;
  readonly quantity: number;
  readonly price: Money;
  readonly status: "active" | "ended" | "draft";
  readonly photoUrls: readonly string[];
  readonly raw?: unknown;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

/**
 * Every outbound call resolves to one of these. A connector never throws for an expected
 * API failure; the job runner maps each variant to retry behaviour.
 */
export type PushResult<T = undefined> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "retryable"; readonly message: string; readonly retryAfterMs?: number }
  | { readonly kind: "rate_limited"; readonly retryAfterMs: number }
  | { readonly kind: "auth_revoked"; readonly message: string }
  | { readonly kind: "terminal"; readonly code: string; readonly messageForSeller: string };

export interface RemoteListingRef {
  readonly externalListingId: string;
  readonly externalIds: Readonly<Record<string, string>>;
}

/** What a webhook or poll turns into before it touches the ledger. */
export type NormalisedInbound =
  | {
      readonly type: "sale";
      readonly externalOrderId: string;
      readonly externalLineId: string;
      readonly externalListingId: string;
      readonly quantity: number;
      readonly unitPrice: Money;
      readonly occurredAt: string;
    }
  | {
      readonly type: "cancellation" | "return";
      readonly externalOrderId: string;
      readonly externalLineId: string;
      readonly quantity: number;
      readonly occurredAt: string;
    }
  | {
      readonly type: "listing_changed";
      readonly externalListingId: string;
      readonly quantity?: number;
      readonly status?: RemoteListing["status"];
      readonly occurredAt: string;
    }
  | { readonly type: "auth_revoked"; readonly occurredAt: string };
