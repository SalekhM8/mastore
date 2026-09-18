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

/**
 * Platform Notifications arrive as SOAP XML. eBay signs them with
 * base64(md5(Timestamp + DevID + AppID + CertID)); the seller is RecipientUserID.
 */
export function isPlatformNotification(rawBody: string): boolean {
  return /<(soapenv|soap):Envelope/i.test(rawBody) && /<NotificationEventName>/.test(rawBody);
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}[^>]*>([^<]*)</(?:[a-zA-Z0-9]+:)?${name}>`));
  return m?.[1];
}
function blocks(xml: string, name: string): string[] {
  return xml.match(new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}[^>]*>[\\s\\S]*?</(?:[a-zA-Z0-9]+:)?${name}>`, "g")) ?? [];
}

export function verifyPlatformNotification(
  rawBody: string,
  keys: { devId: string; appId: string; certId: string },
): WebhookVerification {
  const timestamp = tag(rawBody, "Timestamp") ?? "";
  const signature = tag(rawBody, "NotificationSignature") ?? "";
  const event = tag(rawBody, "NotificationEventName") ?? "unknown";
  const recipient = tag(rawBody, "RecipientUserID");
  const correlation = tag(rawBody, "CorrelationID");
  const expected = createHash("md5")
    .update(timestamp)
    .update(keys.devId)
    .update(keys.appId)
    .update(keys.certId)
    .digest("base64");
  const valid = signature.length > 0 && signature === expected;
  const externalEventId = correlation ?? `platform:${createHash("sha256").update(rawBody).digest("hex")}`;
  return { valid, externalEventId, topic: `platform:${event}`, ...(recipient ? { externalAccountId: recipient } : {}) };
}

/** Sale and listing events out of a Platform Notification body. */
export function parsePlatformNotification(rawBody: string, topic: string): readonly NormalisedInbound[] {
  const event = topic.replace(/^platform:/, "");
  const itemId = tag(blocks(rawBody, "Item")[0] ?? rawBody, "ItemID") ?? tag(rawBody, "ItemID");
  if (!itemId) return [];
  const occurredAt = tag(rawBody, "Timestamp") ?? new Date().toISOString();
  if (event === "ItemClosed")
    return [{ type: "listing_changed", externalListingId: itemId, status: "ended", occurredAt }];
  if (event === "ItemRevised") return [{ type: "listing_changed", externalListingId: itemId, occurredAt }];
  if (event !== "FixedPriceTransaction" && event !== "AuctionCheckoutComplete" && event !== "ItemSold") return [];
  const out: NormalisedInbound[] = [];
  for (const tx of blocks(rawBody, "Transaction")) {
    const lineId = tag(tx, "OrderLineItemID") ?? tag(tx, "TransactionID");
    if (!lineId) continue;
    const quantity = Number(tag(tx, "QuantityPurchased") ?? "1") || 1;
    const price = tag(tx, "TransactionPrice") ?? "0";
    const orderId = tag(blocks(tx, "ContainingOrder")[0] ?? "", "OrderID") ?? lineId;
    out.push({
      type: "sale",
      externalOrderId: orderId,
      externalLineId: lineId,
      externalListingId: itemId,
      quantity,
      unitPrice: { amountMinor: toMinor(price), currency: "GBP" },
      occurredAt: tag(tx, "CreatedDate") ?? occurredAt,
    });
  }
  return out;
}
