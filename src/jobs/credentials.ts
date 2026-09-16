import type { AccountContext } from "@/connectors/contract";
import { loadAccountContext, saveCredentials, setAccountStatus } from "@/db/channel-accounts";
import type { Channel, PushResult } from "@/domain/channels/types";
import { withContext } from "@/lib/log";
import { getConnector } from "./connectors";

/**
 * Load an account for a job with credentials that are good for at least the next few minutes.
 * Marketplace access tokens are short-lived (eBay: two hours); every job goes through here so no
 * job ever calls a channel with a stale token. A failed refresh marks the account for reconnection.
 */

const REFRESH_AHEAD_MS = 5 * 60_000;

export type AccountLoad =
  | { ok: true; context: AccountContext; row: NonNullable<Awaited<ReturnType<typeof loadAccountContext>>>["row"] }
  | { ok: false; reason: "no_connector" | "no_credentials" | "refresh_failed"; result?: PushResult };

export async function loadFreshAccount(channel: Channel, channelAccountId: string): Promise<AccountLoad> {
  const connector = getConnector(channel);
  if (!connector) return { ok: false, reason: "no_connector" };
  const loaded = await loadAccountContext(channelAccountId);
  if (!loaded) return { ok: false, reason: "no_credentials" };
  const { context, row } = loaded;
  const exp = context.credentials.expiresAt ? Date.parse(context.credentials.expiresAt) : Number.NaN;
  // Unknown expiry: refresh defensively when a refresh token exists.
  const stale = Number.isNaN(exp) ? Boolean(context.credentials.refreshToken) : exp - Date.now() < REFRESH_AHEAD_MS;
  if (!stale) return { ok: true, context, row };

  const log = withContext({ workspaceId: row.workspace_id, channel, channelAccountId });
  const refreshed = await connector.refreshCredentials(context.credentials);
  if (refreshed.kind !== "ok") {
    log.warn({ result: refreshed.kind }, "token refresh failed");
    if (refreshed.kind === "auth_revoked")
      await setAccountStatus(channelAccountId, "auth_revoked", "token refresh rejected");
    return { ok: false, reason: "refresh_failed", result: refreshed as PushResult };
  }
  await saveCredentials({ workspaceId: row.workspace_id, channelAccountId, bundle: refreshed.value });
  log.info("token refreshed");
  return { ok: true, context: { ...context, credentials: refreshed.value }, row };
}
