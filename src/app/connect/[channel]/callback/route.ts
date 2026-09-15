import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { upsertConnectedAccount } from "@/db/channel-accounts";
import { logActivity } from "@/db/ops";
import { CHANNELS } from "@/domain/channels/types";
import { EVENTS, inngest } from "@/jobs/client";
import { CHANNEL_LABEL, getConnector } from "@/jobs/connectors";
import { env } from "@/lib/env";
import { withContext } from "@/lib/log";
import { STATE_COOKIE, verifyOAuthState } from "@/lib/oauth-state";
import { requireWorkspace } from "@/lib/workspace";

function fail(message: string): never {
  redirect(`/app/channels?error=${encodeURIComponent(message)}`);
}

/**
 * OAuth callback. Verifies the signed state against the session and the nonce cookie, exchanges
 * the code, asks the channel who the seller is, stores encrypted credentials, and kicks off import.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ channel: string }> }): Promise<Response> {
  const { channel: raw } = await ctx.params;
  const channel = z.enum(CHANNELS).safeParse(raw);
  if (!channel.success) return new Response("unknown channel", { status: 404 });
  const { workspace, userId } = await requireWorkspace();
  const log = withContext({ workspaceId: workspace.id, channel: channel.data });
  const sp = request.nextUrl.searchParams;
  const label = CHANNEL_LABEL[channel.data];

  if (sp.get("error")) {
    log.warn({ error: sp.get("error") }, "seller declined or channel returned an error");
    fail(`${label} did not complete the connection. Nothing was changed.`);
  }
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) fail(`${label} returned an incomplete response.`);

  const verified = verifyOAuthState(env().OAUTH_STATE_SECRET, state, request.cookies.get(STATE_COOKIE)?.value);
  if (
    !verified.ok ||
    verified.state.workspaceId !== workspace.id ||
    verified.state.userId !== userId ||
    verified.state.channel !== channel.data
  ) {
    log.warn({ reason: verified.ok ? "mismatch" : verified.reason }, "oauth state rejected");
    fail("That connection link was not valid. Start again from the Channels page.");
  }

  const connector = getConnector(channel.data);
  if (!connector) fail("This channel is not configured.");
  const redirectUri = `${env().APP_URL}/connect/${channel.data}/callback`;
  const exchanged = await connector.exchangeAuthCode({ code, redirectUri });
  if (exchanged.kind !== "ok") {
    log.warn({ kind: exchanged.kind }, "code exchange failed");
    fail(`${label} rejected the authorisation. Try connecting again.`);
  }
  const identity = await connector.identify(exchanged.value);
  if (identity.kind !== "ok") {
    log.warn({ kind: identity.kind }, "identify failed");
    fail(`${label} connected but did not say which account this is. Try again.`);
  }

  const accountId = await upsertConnectedAccount({
    workspaceId: workspace.id,
    channel: channel.data,
    externalAccountId: identity.value.externalAccountId,
    displayName: identity.value.displayName,
    marketplace: identity.value.marketplace,
    bundle: exchanged.value,
  });
  await logActivity({
    workspaceId: workspace.id,
    channelAccountId: accountId,
    message: `${label} account ${identity.value.displayName} connected. Sync is off until you turn it on.`,
  });
  try {
    await inngest.send({
      name: EVENTS.accountConnected,
      data: { workspaceId: workspace.id, channel: channel.data, channelAccountId: accountId },
    });
  } catch (e) {
    // The account is saved; import can be started by hand. Locally this fails when no Inngest dev server runs.
    log.warn({ err: e }, "could not emit account.connected");
  }

  const headers = new Headers({
    Location: `/app/channels?notice=${encodeURIComponent(`${label} connected as ${identity.value.displayName}.`)}`,
  });
  headers.append("Set-Cookie", `${STATE_COOKIE}=; Path=/connect; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}
