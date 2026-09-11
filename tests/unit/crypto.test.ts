import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptCredentials,
  encryptCredentials,
  masterKeyFromBase64,
  rewrapCredentials,
  safeEqual,
} from "@/lib/crypto";
import { REDACTED, redact } from "@/lib/log";

const k1 = masterKeyFromBase64("k1", randomBytes(32).toString("base64"));
const k2 = masterKeyFromBase64("k2", randomBytes(32).toString("base64"));
const aad = { workspaceId: "ws-1", channelAccountId: "acc-1" };
const bundle = {
  accessToken: "v^1.1#i^1#abc",
  refreshToken: "v^1.1#r^1#def",
  expiresAt: "2026-09-11T12:00:00Z",
  scopes: ["sell.inventory"],
};

describe("credential envelope encryption", () => {
  it("round-trips a bundle", () => {
    const { ciphertext, keyId } = encryptCredentials(bundle, aad, k1);
    expect(keyId).toBe("k1");
    expect(ciphertext.toString("utf8")).not.toContain("v^1.1");
    expect(decryptCredentials(ciphertext, aad, k1)).toEqual(bundle);
  });
  it("refuses to decrypt under a different workspace or account", () => {
    const { ciphertext } = encryptCredentials(bundle, aad, k1);
    expect(() => decryptCredentials(ciphertext, { ...aad, channelAccountId: "acc-2" }, k1)).toThrow();
    expect(() => decryptCredentials(ciphertext, { ...aad, workspaceId: "ws-2" }, k1)).toThrow();
  });
  it("refuses a tampered byte", () => {
    const { ciphertext } = encryptCredentials(bundle, aad, k1);
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;
    expect(() => decryptCredentials(tampered, aad, k1)).toThrow();
  });
  it("rewraps under a new master key without changing the inner ciphertext", () => {
    const first = encryptCredentials(bundle, aad, k1);
    const second = rewrapCredentials(first.ciphertext, aad, k1, k2);
    expect(second.keyId).toBe("k2");
    expect(second.ciphertext.subarray(61)).toEqual(first.ciphertext.subarray(61));
    expect(decryptCredentials(second.ciphertext, aad, k2)).toEqual(bundle);
    expect(() => decryptCredentials(second.ciphertext, aad, k1)).toThrow();
  });
  it("rejects a master key of the wrong length", () => {
    expect(() => masterKeyFromBase64("bad", "c2hvcnQ=")).toThrow(/32 bytes/);
  });
});

describe("safeEqual", () => {
  it("compares equal and unequal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("log redaction", () => {
  it("redacts secret-looking keys and token-looking values wherever they appear", () => {
    const out = redact({
      accessToken: "plain",
      nested: { refresh_token: "x", client_secret: "y", Authorization: "Bearer z" },
      list: ["v^1.1#i^1#abc", "sk_live_123", "fine"],
      jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
      idempotency_key: "ebay:seller:orderline:1:sale",
      credentials_key_id: "k1",
      workspaceId: "ws-1",
    });
    expect(out.accessToken).toBe(REDACTED);
    expect(out.nested).toEqual({ refresh_token: REDACTED, client_secret: REDACTED, Authorization: REDACTED });
    expect(out.list).toEqual([REDACTED, REDACTED, "fine"]);
    expect(out.jwt).toBe(REDACTED);
    expect(out.idempotency_key).toBe("ebay:seller:orderline:1:sale");
    expect(out.credentials_key_id).toBe("k1");
    expect(out.workspaceId).toBe("ws-1");
  });
  it("redacts buyer PII by key and email by value", () => {
    const out = redact({
      buyer_email: "a@b.com",
      shipping_address: "1 Road",
      contact: "someone@example.com",
      orderId: "o1",
    });
    expect(out).toEqual({ buyer_email: REDACTED, shipping_address: REDACTED, contact: REDACTED, orderId: "o1" });
  });
});
