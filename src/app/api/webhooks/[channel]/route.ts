import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { insertWebhookReceipt } from "@/db/webhook-events";
import { CHANNELS } from "@/domain/channels/types";
import { EVENTS, inngest, type WebhookReceivedData } from "@/jobs/client";
import { env } from "@/lib/env";
import { withContext } from "@/lib/log";

/**
 * Webhook ingress. Does exactly four things: read the raw body, store a receipt, emit one
 * Inngest event, return 200. Verification and all logic happen in the ingest job.
 * See docs/reliability-and-operations.md section 4.
 *
 * The one exception is eBay's marketplace account deletion challenge on GET, which must be
 * answered synchronously.
 */

const ChannelParam = z.enum([...CHANNELS, "stripe"]);

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

/** Best-effort external id from the body so vendor retries dedupe at the receipt. */
function externalEventId(channel: string, body: string, headers: Record<string, string>): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const notif = j.notification as Record<string, unknown> | undefined;
    const candidates = [notif?.notificationId, j.id, j.event_id, j.eventId, j.notificationId];
    const found = candidates.find((c): c is string => typeof c === "string" && c.length > 0);
    if (found) return found;
  } catch {
    // not JSON; fall through
  }
  const sig = headers["x-ebay-signature"] ?? headers["x-depop-signature"] ?? headers["stripe-signature"] ?? "";
  return `${channel}:${createHash("sha256").update(body).update(sig).digest("hex")}`;
}

export async function GET(request: Request, ctx: { params: Promise<{ channel: string }> }): Promise<Response> {
  const { channel } = await ctx.params;
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge_code");
  if (channel === "ebay" && challenge) {
    const token = env().EBAY_DELETION_VERIFICATION_TOKEN;
    if (!token) return new Response("verification token not configured", { status: 503 });
    const endpoint = `${env().APP_URL}/api/webhooks/ebay`;
    const hash = createHash("sha256").update(challenge).update(token).update(endpoint).digest("hex");
    return Response.json({ challengeResponse: hash }, { status: 200 });
  }
  return new Response("method not allowed", { status: 405 });
}

export async function POST(request: Request, ctx: { params: Promise<{ channel: string }> }): Promise<Response> {
  const { channel: raw } = await ctx.params;
  const parsed = ChannelParam.safeParse(raw);
  if (!parsed.success) return new Response("unknown channel", { status: 404 });
  const channel = parsed.data;
  const requestId = randomUUID();
  const log = withContext({ channel, requestId });

  const body = await request.text();
  if (body.length > 1_000_000) return new Response("payload too large", { status: 413 });
  const headers = headersToRecord(request.headers);
  const sourceIp = headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? null;
  const id = externalEventId(channel, body, headers);

  let receiptId: string | null;
  try {
    receiptId = await insertWebhookReceipt({ channel, externalEventId: id, headers, body, sourceIp });
  } catch (e) {
    log.error({ err: e }, "webhook receipt insert failed");
    return new Response("try again", { status: 503 });
  }
  if (!receiptId) {
    log.info({ externalEventId: id }, "duplicate webhook delivery");
    return new Response(null, { status: 200 });
  }
  try {
    await inngest.send({ name: EVENTS.webhookReceived, data: { receiptId, channel } satisfies WebhookReceivedData });
  } catch (e) {
    // The receipt is stored; the sweeper-less path here relies on Inngest retry from the vendor.
    log.error({ err: e, receiptId }, "inngest send failed; receipt kept");
    return new Response("queued later", { status: 503 });
  }
  return new Response(null, { status: 200 });
}
