import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth-state";

const secret = "test-secret-at-least-forty-characters-long-1234567890";
const input = { workspaceId: "ws-1", userId: "u-1", channel: "ebay" };

describe("oauth state", () => {
  it("round-trips when the nonce cookie matches", () => {
    const { state, nonce } = createOAuthState(secret, input, () => 1000);
    const v = verifyOAuthState(secret, state, nonce, () => 1100);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.state).toMatchObject(input);
  });
  it("rejects a missing or different nonce cookie", () => {
    const { state } = createOAuthState(secret, input);
    expect(verifyOAuthState(secret, state, undefined)).toEqual({ ok: false, reason: "nonce" });
    expect(verifyOAuthState(secret, state, "other")).toEqual({ ok: false, reason: "nonce" });
  });
  it("rejects after ten minutes", () => {
    const { state, nonce } = createOAuthState(secret, input, () => 1000);
    expect(verifyOAuthState(secret, state, nonce, () => 1000 + 601)).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects a tampered payload and a wrong secret", () => {
    const { state, nonce } = createOAuthState(secret, input);
    const [payload, sig] = state.split(".") as [string, string];
    const forged = `${Buffer.from(JSON.stringify({ ...input, workspaceId: "ws-2", nonce, exp: 9e9 })).toString("base64url")}.${sig}`;
    expect(verifyOAuthState(secret, forged, nonce)).toEqual({ ok: false, reason: "signature" });
    expect(verifyOAuthState(`${secret}x`, `${payload}.${sig}`, nonce)).toEqual({ ok: false, reason: "signature" });
    expect(verifyOAuthState(secret, "garbage", nonce)).toEqual({ ok: false, reason: "malformed" });
  });
});
