import type { AccountContext } from "@/connectors/contract";
import type { Channel, CredentialBundle, WorkspaceId } from "@/domain/channels/types";
import { decryptCredentials, encryptCredentials, masterKeyFromBase64 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { db, json } from "./client";

export interface ChannelAccountRow {
  id: string;
  workspace_id: string;
  channel: Channel;
  external_account_id: string;
  display_name: string;
  marketplace: string;
  credentials_ciphertext: Buffer | null;
  credentials_key_id: string | null;
  token_expires_at: Date | null;
  scopes: string[];
  status: "connecting" | "healthy" | "degraded" | "auth_revoked" | "disconnected";
  sync_enabled: boolean;
  account_settings: Record<string, unknown>;
}

function masterKey() {
  const e = env();
  return masterKeyFromBase64(e.CREDENTIALS_MASTER_KEY_ID, e.CREDENTIALS_MASTER_KEY);
}

export async function getChannelAccount(id: string): Promise<ChannelAccountRow | null> {
  const rows = await db()<
    ChannelAccountRow[]
  >`select * from public.channel_accounts where id = ${id} and deleted_at is null`;
  return rows[0] ?? null;
}

/**
 * Loads an account and decrypts its credentials for one job. The bundle lives in memory for the
 * duration of the call and is never returned to a browser.
 */
export async function loadAccountContext(
  id: string,
): Promise<{ row: ChannelAccountRow; context: AccountContext } | null> {
  const row = await getChannelAccount(id);
  if (!row || !row.credentials_ciphertext) return null;
  const key = masterKey();
  if (row.credentials_key_id !== key.id) {
    throw new Error(
      `account ${id} is wrapped with key ${row.credentials_key_id}, active key is ${key.id}; run the rewrap job`,
    );
  }
  const credentials = decryptCredentials(
    Buffer.from(row.credentials_ciphertext),
    { workspaceId: row.workspace_id, channelAccountId: row.id },
    key,
  );
  return {
    row,
    context: {
      workspaceId: row.workspace_id as WorkspaceId,
      channelAccountId: row.id,
      externalAccountId: row.external_account_id,
      marketplace: row.marketplace,
      credentials,
      settings: row.account_settings,
    },
  };
}

export async function saveCredentials(input: {
  workspaceId: string;
  channelAccountId: string;
  bundle: CredentialBundle;
}): Promise<void> {
  const { ciphertext, keyId } = encryptCredentials(
    input.bundle,
    { workspaceId: input.workspaceId, channelAccountId: input.channelAccountId },
    masterKey(),
  );
  await db()`
    update public.channel_accounts
    set credentials_ciphertext = ${ciphertext}, credentials_key_id = ${keyId},
        token_expires_at = ${input.bundle.expiresAt ?? null}, scopes = ${input.bundle.scopes as string[]}
    where id = ${input.channelAccountId} and workspace_id = ${input.workspaceId}`;
}

/** Create or reconnect an account after OAuth. Returns the account id. */
export async function upsertConnectedAccount(input: {
  workspaceId: string;
  channel: Channel;
  externalAccountId: string;
  displayName: string;
  marketplace: string;
  bundle: CredentialBundle;
  settings?: Record<string, unknown>;
}): Promise<string> {
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into public.channel_accounts (workspace_id, channel, external_account_id, display_name, marketplace, status, account_settings)
    values (${input.workspaceId}, ${input.channel}, ${input.externalAccountId}, ${input.displayName}, ${input.marketplace}, 'healthy', ${json(sql, input.settings ?? {})})
    on conflict (workspace_id, channel, external_account_id)
    do update set display_name = excluded.display_name, status = 'healthy', deleted_at = null
    returning id`;
  const row = rows[0];
  if (!row) throw new Error("upsertConnectedAccount returned no row");
  await saveCredentials({ workspaceId: input.workspaceId, channelAccountId: row.id, bundle: input.bundle });
  return row.id;
}

export async function setAccountStatus(
  id: string,
  status: ChannelAccountRow["status"],
  detail?: string,
): Promise<void> {
  const sql = db();
  await sql`
    update public.channel_accounts
    set status = ${status}, last_health_check_at = now(),
        account_settings = account_settings || ${json(sql, { last_status_detail: detail ?? null })}
    where id = ${id}`;
}

export async function touchAccount(id: string, direction: "inbound" | "outbound"): Promise<void> {
  if (direction === "inbound") await db()`update public.channel_accounts set last_inbound_at = now() where id = ${id}`;
  else await db()`update public.channel_accounts set last_outbound_at = now() where id = ${id}`;
}

export async function findAccountByExternalId(
  channel: Channel,
  externalAccountId: string,
): Promise<ChannelAccountRow[]> {
  return db()<ChannelAccountRow[]>`
    select * from public.channel_accounts
    where channel = ${channel} and external_account_id = ${externalAccountId} and deleted_at is null`;
}

export async function listAccountsForPull(channel: Channel): Promise<ChannelAccountRow[]> {
  return db()<ChannelAccountRow[]>`
    select * from public.channel_accounts
    where channel = ${channel} and deleted_at is null and sync_enabled and status in ('healthy','degraded')
    order by last_health_check_at nulls first`;
}
