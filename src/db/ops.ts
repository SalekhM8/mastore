import type { Channel } from "@/domain/channels/types";
import { db, json } from "./client";

/** Seller-facing activity feed. Plain English, no PII, no secrets. */
export async function logActivity(input: {
  workspaceId: string;
  message: string;
  level?: "info" | "warn" | "error";
  channelAccountId?: string | null;
  skuId?: string | null;
  context?: Record<string, unknown>;
}): Promise<void> {
  const sql = db();
  await sql`
    insert into public.activity_log (workspace_id, channel_account_id, sku_id, level, message, context)
    values (${input.workspaceId}, ${input.channelAccountId ?? null}, ${input.skuId ?? null}, ${input.level ?? "info"}, ${input.message}, ${json(sql, input.context ?? {})})`;
}

export async function raiseIncident(input: {
  workspaceId: string;
  kind: "oversell" | "push_dead" | "auth_revoked" | "drift" | "webhook_signature_failed" | "unmatched_sale";
  severity?: 1 | 2 | 3 | 4;
  skuId?: string | null;
  channelAccountId?: string | null;
  channelListingId?: string | null;
  details?: Record<string, unknown>;
}): Promise<string> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into public.incidents (workspace_id, kind, severity, sku_id, channel_account_id, channel_listing_id, details)
    values (${input.workspaceId}, ${input.kind}, ${input.severity ?? 2}, ${input.skuId ?? null}, ${input.channelAccountId ?? null}, ${input.channelListingId ?? null}, ${json(sql, input.details ?? {})})
    returning id`;
  const row = rows[0];
  if (!row) throw new Error("raiseIncident returned no row");
  return row.id;
}

export interface ConnectorSwitch {
  push_enabled: boolean;
  pull_enabled: boolean;
  webhooks_enabled: boolean;
}

export async function getConnectorSwitch(channel: Channel): Promise<ConnectorSwitch> {
  const rows = await db()<
    ConnectorSwitch[]
  >`select push_enabled, pull_enabled, webhooks_enabled from public.connector_switches where channel = ${channel}`;
  return rows[0] ?? { push_enabled: true, pull_enabled: true, webhooks_enabled: true };
}

export async function recordDeletionRequest(input: {
  channel: Channel;
  externalUserId: string;
  externalUsername?: string | null;
  webhookEventId?: string | null;
  workspaceIds: string[];
}): Promise<string> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into public.deletion_requests (channel, external_user_id, workspace_ids, evidence)
    values (${input.channel}, ${input.externalUserId}, ${input.workspaceIds},
            ${json(sql, { username: input.externalUsername ?? null, webhook_event_id: input.webhookEventId ?? null })})
    returning id`;
  const row = rows[0];
  if (!row) throw new Error("recordDeletionRequest returned no row");
  return row.id;
}
