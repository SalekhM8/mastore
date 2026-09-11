import type { PushResult } from "@/domain/channels/types";
import type { EbayConfig } from "./config";
import { endpoints } from "./config";
import { RestErrorBody } from "./schemas";

/** One HTTP exchange, already read. `json` is undefined when the body is not JSON. */
export interface Exchange {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly json: unknown;
}

export type Failure = Exclude<PushResult, { kind: "ok" }>;

export function fetcher(cfg: EbayConfig): typeof fetch {
  return cfg.fetch ?? fetch;
}

/** Runs a request and turns transport failures into `retryable`. Never throws. */
export async function exchange(
  cfg: EbayConfig,
  url: string,
  init: RequestInit,
): Promise<{ kind: "ok"; value: Exchange } | Failure> {
  try {
    const res = await fetcher(cfg)(url, init);
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { kind: "ok", value: { status: res.status, headers: res.headers, text, json } };
  } catch (e) {
    return { kind: "retryable", message: `eBay request failed: ${e instanceof Error ? e.message : "network error"}` };
  }
}

export function retryAfterMs(headers: Headers, fallbackMs = 10_000): number {
  const raw = headers.get("retry-after");
  if (!raw) return fallbackMs;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallbackMs;
}

/** eBay REST error ids that mean the listing is gone or was never ours to touch. */
const LISTING_GONE_IDS = new Set([25710, 25713, 25002, 25001, 25715, 25716, 25604]);
/** Error ids that mean the token no longer works. */
const AUTH_IDS = new Set([1001, 1002, 1003, 1100]);

export function sellerMessageFromErrors(json: unknown, fallback: string): string {
  const parsed = RestErrorBody.safeParse(json);
  if (!parsed.success || parsed.data.errors.length === 0) return fallback;
  const first = parsed.data.errors[0];
  return first.longMessage ?? first.message ?? fallback;
}

function errorIds(json: unknown): number[] {
  const parsed = RestErrorBody.safeParse(json);
  return parsed.success ? parsed.data.errors.map((e) => e.errorId) : [];
}

/**
 * Maps a non-2xx REST response to the error taxonomy. Callers handle 2xx themselves because
 * some eBay endpoints return 200 with per-item failures inside the body.
 */
export function classifyRest(x: Exchange, context: string): Failure {
  const ids = errorIds(x.json);
  if (x.status === 429) return { kind: "rate_limited", retryAfterMs: retryAfterMs(x.headers) };
  if (x.status === 401 || ids.some((id) => AUTH_IDS.has(id))) {
    return { kind: "auth_revoked", message: "eBay no longer accepts this account's token." };
  }
  if (x.status >= 500) return { kind: "retryable", message: `eBay returned ${x.status} for ${context}` };
  if (x.status === 404 || ids.some((id) => LISTING_GONE_IDS.has(id))) {
    return {
      kind: "terminal",
      code: "ebay.listing_not_found",
      messageForSeller: sellerMessageFromErrors(x.json, "eBay could not find this listing. It may have ended."),
    };
  }
  if (x.status === 403) {
    return {
      kind: "terminal",
      code: "ebay.forbidden",
      messageForSeller: sellerMessageFromErrors(x.json, "eBay refused this request for the connected account."),
    };
  }
  return {
    kind: "terminal",
    code: `ebay.http_${x.status}`,
    messageForSeller: sellerMessageFromErrors(x.json, `eBay rejected the ${context}.`),
  };
}

export function restHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Content-Language": "en-GB",
    "Accept-Language": "en-GB",
    ...extra,
  };
}

export function apiUrl(cfg: EbayConfig, path: string): string {
  return `${endpoints(cfg.env).api}${path}`;
}
