import { createHash } from "node:crypto";
import { db, json } from "./client";

export interface WebhookEventRow {
  id: string;
  channel: string;
  external_event_id: string;
  workspace_id: string | null;
  channel_account_id: string | null;
  topic: string | null;
  headers: Record<string, string>;
  body: string;
  payload_hash: string;
  status: "received" | "verified" | "rejected" | "processed" | "unmatched" | "failed";
  received_at: Date;
}

/** Insert a receipt. Returns the new id, or null when this (channel, external id) was already received. */
export async function insertWebhookReceipt(input: {
  channel: string;
  externalEventId: string;
  headers: Record<string, string>;
  body: string;
  sourceIp?: string | null;
  topic?: string | null;
}): Promise<string | null> {
  const sql = db();
  const hash = createHash("sha256").update(input.body).digest("hex");
  const rows = await sql<{ id: string }[]>`
    insert into public.webhook_events (channel, external_event_id, headers, body, payload_hash, source_ip, topic)
    values (${input.channel}, ${input.externalEventId}, ${json(sql, input.headers)}, ${input.body}, ${hash}, ${input.sourceIp ?? null}, ${input.topic ?? null})
    on conflict (channel, external_event_id) do nothing
    returning id`;
  return rows[0]?.id ?? null;
}

export async function getWebhookReceipt(id: string): Promise<WebhookEventRow | null> {
  const rows = await db()<WebhookEventRow[]>`select * from public.webhook_events where id = ${id}`;
  return rows[0] ?? null;
}

export async function updateWebhookReceipt(
  id: string,
  patch: {
    status: WebhookEventRow["status"];
    workspaceId?: string | null;
    channelAccountId?: string | null;
    topic?: string | null;
    error?: unknown;
  },
): Promise<void> {
  const sql = db();
  await sql`
    update public.webhook_events
    set status = ${patch.status},
        workspace_id = coalesce(${patch.workspaceId ?? null}, workspace_id),
        channel_account_id = coalesce(${patch.channelAccountId ?? null}, channel_account_id),
        topic = coalesce(${patch.topic ?? null}, topic),
        error = ${patch.error === undefined ? null : json(sql, patch.error as never)},
        processed_at = case when ${patch.status} in ('processed','rejected','unmatched','failed') then now() else processed_at end
    where id = ${id}`;
}
