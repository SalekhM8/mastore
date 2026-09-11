import type { CredentialBundle, PushResult, WorkspaceId } from "@/domain/channels/types";
import { APP_SCOPES, type EbayConfig, endpoints, USER_SCOPES } from "./config";
import { apiUrl, classifyRest, exchange, restHeaders } from "./http";
import { IdentityUser, OAuthError, TokenResponse } from "./schemas";

function basicAuth(cfg: EbayConfig): string {
  return `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;
}

function now(cfg: EbayConfig): Date {
  return cfg.now ? cfg.now() : new Date();
}

export function buildAuthorizeUrl(cfg: EbayConfig, input: { workspaceId: WorkspaceId; state: string }): URL {
  const url = new URL("/oauth2/authorize", endpoints(cfg.env).auth);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", USER_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("prompt", "login");
  return url;
}

async function tokenCall(cfg: EbayConfig, form: URLSearchParams): Promise<PushResult<CredentialBundle>> {
  const res = await exchange(cfg, `${endpoints(cfg.env).api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status >= 200 && x.status < 300) {
    const parsed = TokenResponse.safeParse(x.json);
    if (!parsed.success) {
      return {
        kind: "terminal",
        code: "ebay.token.shape",
        messageForSeller: "eBay returned an unexpected token response.",
      };
    }
    const t = parsed.data;
    const bundle: CredentialBundle = {
      accessToken: t.access_token,
      expiresAt: new Date(now(cfg).getTime() + t.expires_in * 1000).toISOString(),
      scopes: [...USER_SCOPES],
      ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      ...(t.refresh_token_expires_in
        ? {
            extra: {
              refreshTokenExpiresAt: new Date(now(cfg).getTime() + t.refresh_token_expires_in * 1000).toISOString(),
            },
          }
        : {}),
    };
    return { kind: "ok", value: bundle };
  }
  const oauthErr = OAuthError.safeParse(x.json);
  if (x.status === 400 || x.status === 401) {
    const code = oauthErr.success ? oauthErr.data.error : "invalid_request";
    if (code === "invalid_grant" || code === "invalid_client" || x.status === 401) {
      return { kind: "auth_revoked", message: `eBay rejected the grant (${code}).` };
    }
    return {
      kind: "terminal",
      code: `ebay.oauth.${code}`,
      messageForSeller: oauthErr.success ? (oauthErr.data.error_description ?? code) : "eBay rejected the sign-in.",
    };
  }
  return classifyRest(x, "token request");
}

export function exchangeAuthCode(cfg: EbayConfig, code: string): Promise<PushResult<CredentialBundle>> {
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.ruName });
  return tokenCall(cfg, form);
}

export async function refreshCredentials(
  cfg: EbayConfig,
  bundle: CredentialBundle,
): Promise<PushResult<CredentialBundle>> {
  if (!bundle.refreshToken) return { kind: "auth_revoked", message: "No refresh token stored for this eBay account." };
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: bundle.refreshToken,
    scope: USER_SCOPES.join(" "),
  });
  const result = await tokenCall(cfg, form);
  if (result.kind !== "ok") return result;
  // eBay does not return a new refresh token on refresh; keep the one we have.
  return {
    kind: "ok",
    value: {
      ...result.value,
      refreshToken: bundle.refreshToken,
      ...(bundle.extra ? { extra: { ...bundle.extra, ...result.value.extra } } : {}),
    },
  };
}

/** Application token (client credentials). Needed for the public key endpoint only. */
export async function appToken(cfg: EbayConfig): Promise<PushResult<{ token: string; expiresAt: string }>> {
  const form = new URLSearchParams({ grant_type: "client_credentials", scope: APP_SCOPES.join(" ") });
  const res = await exchange(cfg, `${endpoints(cfg.env).api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status < 200 || x.status >= 300) return classifyRest(x, "application token request");
  const parsed = TokenResponse.safeParse(x.json);
  if (!parsed.success) {
    return {
      kind: "terminal",
      code: "ebay.token.shape",
      messageForSeller: "eBay returned an unexpected token response.",
    };
  }
  return {
    kind: "ok",
    value: {
      token: parsed.data.access_token,
      expiresAt: new Date(now(cfg).getTime() + parsed.data.expires_in * 1000).toISOString(),
    },
  };
}

export interface SellerIdentity {
  readonly username: string;
  readonly userId: string;
}

/**
 * Who the token belongs to. The connect flow stores `username` as the channel account's
 * external_account_id, and webhook verification returns the same field, so events route by it.
 */
export async function getSellerIdentity(
  cfg: EbayConfig,
  bundle: CredentialBundle,
): Promise<PushResult<SellerIdentity>> {
  const res = await exchange(cfg, apiUrl(cfg, "/commerce/identity/v1/user/"), {
    method: "GET",
    headers: restHeaders(bundle.accessToken),
  });
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status < 200 || x.status >= 300) return classifyRest(x, "identity lookup");
  const parsed = IdentityUser.safeParse(x.json);
  if (!parsed.success) {
    return {
      kind: "terminal",
      code: "ebay.identity.shape",
      messageForSeller: "eBay returned an unexpected account identity.",
    };
  }
  return { kind: "ok", value: { username: parsed.data.username, userId: parsed.data.userId } };
}
