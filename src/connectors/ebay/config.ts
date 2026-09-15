/**
 * Everything the eBay connector needs from its host. Nothing in this folder reads process.env;
 * the caller builds this object from src/lib/env.ts and hands it in.
 */
export interface EbayConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** eBay's "RuName", which stands in for the redirect URI in the consent flow. */
  readonly ruName: string;
  readonly env: "sandbox" | "production";
  /** Marketplace account deletion challenge: the token we registered with eBay. */
  readonly deletionVerificationToken?: string;
  /** The exact public URL eBay calls, used in the challenge hash. */
  readonly webhookEndpointUrl?: string;
  /** Injected for tests. Defaults to global fetch. */
  readonly fetch?: typeof fetch;
  /** Injected for tests. Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

export interface EbayEndpoints {
  readonly api: string;
  readonly auth: string;
  readonly trading: string;
  /** Commerce Identity API is served from the apiz host, not api. */
  readonly apiz: string;
}

export function endpoints(env: EbayConfig["env"]): EbayEndpoints {
  const sub = env === "sandbox" ? "sandbox." : "";
  return {
    api: `https://api.${sub}ebay.com`,
    auth: `https://auth.${sub}ebay.com`,
    trading: `https://api.${sub}ebay.com/ws/api.dll`,
    apiz: `https://apiz.${sub}ebay.com`,
  };
}

/** Scope URLs are identical in sandbox and production. */
export const USER_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
] as const;

export const APP_SCOPES = ["https://api.ebay.com/oauth/api_scope"] as const;

/** UK site for Trading API calls. */
export const UK_SITE_ID = "3";
export const TRADING_COMPAT_LEVEL = "1271";
export const UK_MARKETPLACE_ID = "EBAY_GB";
