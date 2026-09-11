import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./crypto";

/**
 * Signed OAuth state for marketplace connect flows. Bound to the workspace, the user and a
 * nonce that is also set as a cookie, valid for 10 minutes. See docs/security-and-compliance.md section 7.
 */

export interface OAuthState {
  readonly workspaceId: string;
  readonly userId: string;
  readonly channel: string;
  readonly nonce: string;
  readonly exp: number; // unix seconds
}

const TTL_S = 10 * 60;

/** Cookie carrying the nonce half of the state. */
export const STATE_COOKIE = "sync_oauth_nonce";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(secret: string, payload: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function createOAuthState(
  secret: string,
  input: { workspaceId: string; userId: string; channel: string },
  now: () => number = () => Math.floor(Date.now() / 1000),
): { state: string; nonce: string } {
  const nonce = b64url(randomBytes(16));
  const body: OAuthState = { ...input, nonce, exp: now() + TTL_S };
  const payload = b64url(Buffer.from(JSON.stringify(body), "utf8"));
  return { state: `${payload}.${sign(secret, payload)}`, nonce };
}

export type StateVerification =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "nonce" };

export function verifyOAuthState(
  secret: string,
  state: string,
  cookieNonce: string | undefined,
  now: () => number = () => Math.floor(Date.now() / 1000),
): StateVerification {
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [payload, sig] = parts;
  if (!safeEqual(sig, sign(secret, payload))) return { ok: false, reason: "signature" };
  let body: OAuthState;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof body.exp !== "number" || body.exp < now()) return { ok: false, reason: "expired" };
  if (!cookieNonce || !safeEqual(cookieNonce, body.nonce)) return { ok: false, reason: "nonce" };
  return { ok: true, state: body };
}
