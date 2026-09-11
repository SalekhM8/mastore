import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CredentialBundle } from "@/domain/channels/types";

/**
 * Envelope encryption for marketplace credentials. See docs/security-and-compliance.md section 3.
 *
 * One self-describing blob per channel account, stored in channel_accounts.credentials_ciphertext:
 *
 *   byte 0        format version (0x01)
 *   bytes 1..12   DEK nonce (12)
 *   bytes 13..60  DEK wrapped with the master key, AES-256-GCM (32 + 16 tag)
 *   bytes 61..72  data nonce (12)
 *   bytes 73..    credentials JSON encrypted with the DEK, AES-256-GCM (n + 16 tag)
 *
 * AAD for both layers is `${workspaceId}|${channelAccountId}`, so a blob copied onto another row
 * fails to decrypt. The master key id is stored beside the blob in credentials_key_id so rotation
 * can re-wrap the DEK without touching the inner ciphertext.
 */

const VERSION = 0x01;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export interface MasterKey {
  readonly id: string;
  readonly key: Buffer;
}

export interface CredentialAad {
  readonly workspaceId: string;
  readonly channelAccountId: string;
}

export function masterKeyFromBase64(id: string, base64: string): MasterKey {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_LEN) throw new Error(`master key ${id} must be 32 bytes, got ${key.length}`);
  return { id, key };
}

function aadBytes(aad: CredentialAad): Buffer {
  return Buffer.from(`${aad.workspaceId}|${aad.channelAccountId}`, "utf8");
}

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): { nonce: Buffer; out: Buffer } {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const out = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { nonce, out };
}

function open(key: Buffer, nonce: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  const tag = sealed.subarray(sealed.length - TAG_LEN);
  const body = sealed.subarray(0, sealed.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function encryptCredentials(
  bundle: CredentialBundle,
  aad: CredentialAad,
  master: MasterKey,
): { ciphertext: Buffer; keyId: string } {
  const a = aadBytes(aad);
  const dek = randomBytes(KEY_LEN);
  const wrapped = seal(master.key, dek, a);
  const data = seal(dek, Buffer.from(JSON.stringify(bundle), "utf8"), a);
  dek.fill(0);
  return {
    ciphertext: Buffer.concat([Buffer.from([VERSION]), wrapped.nonce, wrapped.out, data.nonce, data.out]),
    keyId: master.id,
  };
}

export function decryptCredentials(ciphertext: Buffer, aad: CredentialAad, master: MasterKey): CredentialBundle {
  if (ciphertext[0] !== VERSION) throw new Error(`unknown credentials blob version ${ciphertext[0]}`);
  const a = aadBytes(aad);
  let p = 1;
  const dekNonce = ciphertext.subarray(p, (p += NONCE_LEN));
  const wrapped = ciphertext.subarray(p, (p += KEY_LEN + TAG_LEN));
  const dataNonce = ciphertext.subarray(p, (p += NONCE_LEN));
  const sealed = ciphertext.subarray(p);
  const dek = open(master.key, dekNonce, wrapped, a);
  try {
    const json = open(dek, dataNonce, sealed, a).toString("utf8");
    return JSON.parse(json) as CredentialBundle;
  } finally {
    dek.fill(0);
  }
}

/** Re-wrap the DEK under a new master key. The inner credential ciphertext is untouched. */
export function rewrapCredentials(
  ciphertext: Buffer,
  aad: CredentialAad,
  from: MasterKey,
  to: MasterKey,
): { ciphertext: Buffer; keyId: string } {
  if (ciphertext[0] !== VERSION) throw new Error(`unknown credentials blob version ${ciphertext[0]}`);
  const a = aadBytes(aad);
  const dekNonce = ciphertext.subarray(1, 1 + NONCE_LEN);
  const wrapped = ciphertext.subarray(1 + NONCE_LEN, 1 + NONCE_LEN + KEY_LEN + TAG_LEN);
  const rest = ciphertext.subarray(1 + NONCE_LEN + KEY_LEN + TAG_LEN);
  const dek = open(from.key, dekNonce, wrapped, a);
  const rewrapped = seal(to.key, dek, a);
  dek.fill(0);
  return { ciphertext: Buffer.concat([Buffer.from([VERSION]), rewrapped.nonce, rewrapped.out, rest]), keyId: to.id };
}

/** Constant-time comparison for signatures and tokens. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
