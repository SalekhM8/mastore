import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { CHANNELS, type WorkspaceId } from "@/domain/channels/types";
import { getConnector } from "@/jobs/connectors";
import { env } from "@/lib/env";
import { createOAuthState, STATE_COOKIE } from "@/lib/oauth-state";
import { requireWorkspace } from "@/lib/workspace";

/** Starts a marketplace OAuth flow: signed state bound to the session, nonce in a cookie, redirect. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ channel: string }> }): Promise<Response> {
  const { channel: raw } = await ctx.params;
  const channel = z.enum(CHANNELS).safeParse(raw);
  if (!channel.success) return new Response("unknown channel", { status: 404 });
  const { workspace, userId } = await requireWorkspace();
  const connector = getConnector(channel.data);
  if (!connector) redirect(`/app/channels?error=${encodeURIComponent("This channel is not configured yet.")}`);
  const e = env();
  const { state, nonce } = createOAuthState(e.OAUTH_STATE_SECRET, {
    workspaceId: workspace.id,
    userId,
    channel: channel.data,
  });
  const redirectUri = `${e.APP_URL}/connect/${channel.data}/callback`;
  const url = connector.buildAuthorizeUrl({ workspaceId: workspace.id as WorkspaceId, state, redirectUri });
  if (!url) redirect(`/app/channels?error=${encodeURIComponent("This channel does not use OAuth.")}`);
  const res = Response.redirect(url.toString(), 302);
  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", `${STATE_COOKIE}=${nonce}; Path=/connect; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return new Response(null, { status: 302, headers });
}
