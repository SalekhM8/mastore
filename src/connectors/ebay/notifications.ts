import { createHash, createVerify } from "node:crypto";
import type { NormalisedInbound } from "@/domain/channels/types";
import type { RawWebhookRequest, WebhookVerification } from "../contract";
import { appToken } from "./auth";
import type { EbayConfig } from "./config";
import { apiUrl, exchange, restHeaders } from "./http";
import { NotificationEnvelope, OrderConfirmationData, PublicKeyResponse, SignatureHeader, toMinor } from "./schemas";

/**
 * eBay Notification API: signature verification, the account deletion challenge, and mapping
 * of ORDER_CONFIRMATION payloads. eBay signs the raw body with ECDSA and, per its official
 * event-notification SDK, hashes with SHA1 unless the signature header says otherwise.
 */

const KEY_TTL_MS = 60 * 60 * 1000;

interface CachedKey {
  readonly pem: string;
  readonly digest: string;
  readonly fetchedAt: number;
}

export class NotificationVerifier {
  private readonly keys = new Map<string, CachedKey>();
  private app: { token: string; expiresAt: number } | null = null;

  constructor(private readonly cfg: EbayConfig) {}

  private now(): number {
    return (this.cfg.now ? this.cfg.now() : new Date()).getTime();
  }

  /** GET ?challenge_code=… from eBay when the endpoint is registered or re-verified. */
  challenge(challengeCode: string): WebhookVerification {
    const token = this.cfg.deletionVerificationToken;
    const endpoint = this.cfg.webhookEndpointUrl;
    if (!token || !endpoint) {
      return {
        valid: false,
        externalEventId: `challenge:${challengeCode}`,
        topic: "CHALLENGE",
        challengeResponse: {
          status: 500,
          body: JSON.stringify({ error: "verification token not configured" }),
          contentType: "application/json",
        },
      };
    }
    const hash = createHash("sha256").update(challengeCode).update(token).update(endpoint).digest("hex");
    return {
      valid: true,
      externalEventId: `challenge:${challengeCode}`,
      topic: "CHALLENGE",
      challengeResponse: {
        status: 200,
        body: JSON.stringify({ challengeResponse: hash }),
        contentType: "application/json",
      },
    };
  }

  private async appToken(): Promise<string | null> {
    if (this.app && this.app.expiresAt - 60_000 > this.now()) return this.app.token;
    const res = await appToken(this.cfg);
    if (res.kind !== "ok") return null;
    this.app = { token: res.value.token, expiresAt: Date.parse(res.value.expiresAt) };
    return this.app.token;
  }

  private async publicKey(kid: string): Promise<CachedKey | null> {
    const cached = this.keys.get(kid);
    if (cached && this.now() - cached.fetchedAt < KEY_TTL_MS) return cached;
    const token = await this.appToken();
    if (!token) return null;
    const res = await exchange(
      this.cfg,
      apiUrl(this.cfg, `/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`),
      {
        method: "GET",
        headers: restHeaders(token),
      },
    );
    if (res.kind !== "ok" || res.value.status < 200 || res.value.status >= 300) return null;
    const parsed = PublicKeyResponse.safeParse(res.value.json);
    if (!parsed.success) return null;
    const key: CachedKey = { pem: toPem(parsed.data.key), digest: parsed.data.digest ?? "SHA1", fetchedAt: this.now() };
    this.keys.set(kid, key);
    return key;
  }

  async verify(request: RawWebhookRequest): Promise<WebhookVerification> {
    const url = new URL(request.url, "https://placeholder.invalid");
    const challengeCode = url.searchParams.get("challenge_code");
    if (challengeCode) return this.challenge(challengeCode);

    const envelope = NotificationEnvelope.safeParse(safeJson(request.rawBody));
    const externalEventId = envelope.success
      ? envelope.data.notification.notificationId
      : `unparsed:${sha256(request.rawBody)}`;
    const topic = envelope.success ? envelope.data.metadata.topic : "UNKNOWN";
    const invalid: WebhookVerification = { valid: false, externalEventId, topic };

    const headerRaw = lookupHeader(request.headers, "x-ebay-signature");
    if (!headerRaw || !envelope.success) return invalid;
    const header = SignatureHeader.safeParse(safeJson(Buffer.from(headerRaw, "base64").toString("utf8")));
    if (!header.success) return invalid;

    const key = await this.publicKey(header.data.kid);
    if (!key) return invalid;
    const digest = (header.data.digest ?? key.digest ?? "SHA1").toUpperCase();
    try {
      const verifier = createVerify(digest);
      verifier.update(request.rawBody);
      verifier.end();
      const ok = verifier.verify(key.pem, Buffer.from(header.data.signature, "base64"));
      const externalAccountId = sellerIdentity(envelope.data.notification.data);
      return { valid: ok, externalEventId, topic, ...(externalAccountId ? { externalAccountId } : {}) };
    } catch {
      return invalid;
    }
  }
}

/** eBay returns the key with header and footer but sometimes without line breaks. */
export function toPem(raw: string): string {
  const body = raw
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

function lookupHeader(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const direct = headers[name];
  if (direct) return direct;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

/**
 * The seller the event belongs to, when eBay includes it. Account deletion carries `username`;
 * order notifications are expected to carry `sellerId` or `username`. Absent either, the ingest
 * job routes by order lookup.
 */
function sellerIdentity(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  for (const key of ["username", "sellerId", "sellerUsername", "userId"]) {
    const v = d[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The order id inside an ORDER_CONFIRMATION notification, so the job can pull it when line items are absent. */
export function orderIdFromNotification(payload: unknown): string | null {
  const envelope = NotificationEnvelope.safeParse(payload);
  if (!envelope.success) return null;
  const data = OrderConfirmationData.safeParse(envelope.data.notification.data);
  return data.success ? data.data.orderId : null;
}

/** Maps a notification to inbound events. Returns [] when the job must pull the order instead. */
export function parseInbound(payload: unknown, topic: string): readonly NormalisedInbound[] {
  if (topic !== "ORDER_CONFIRMATION") return [];
  const envelope = NotificationEnvelope.safeParse(payload);
  if (!envelope.success) return [];
  const data = OrderConfirmationData.safeParse(envelope.data.notification.data);
  if (!data.success || !data.data.lineItems || data.data.lineItems.length === 0) return [];
  const occurredAt = data.data.creationDate ?? envelope.data.notification.eventDate ?? new Date().toISOString();
  return data.data.lineItems.map((line) => ({
    type: "sale" as const,
    externalOrderId: data.data.orderId,
    externalLineId: line.lineItemId,
    externalListingId: line.legacyItemId,
    quantity: line.quantity,
    unitPrice: { amountMinor: Math.round(toMinor(line.lineItemCost.value) / line.quantity), currency: "GBP" as const },
    occurredAt,
  }));
}
