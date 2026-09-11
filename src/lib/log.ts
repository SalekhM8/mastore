import pino from "pino";

/**
 * Structured logger. See docs/engineering-standards.md section 7 and
 * docs/security-and-compliance.md "What never enters logs".
 *
 * Every value passes through redact() before it is written. Keys that look like secrets are
 * replaced wholesale; string values that look like tokens are replaced wherever they appear.
 */

const SECRET_KEY = /token|secret|password|authorization|cookie|credential|signature|api[_-]?key|private[_-]?key/i;
const ALLOWED_KEYS = new Set(["idempotency_key", "idempotencyKey", "key_id", "keyId", "credentials_key_id", "kid"]);
const PII_KEY =
  /^(buyer|shipping|billing)?_?(email|phone|address|name|first_name|last_name|full_name|address_line\d?|postcode|zip)$/i;
const TOKEN_VALUE = /^(Atzr\||v\^1\.1#|pak_|sk_live|sk_test|whsec_|rk_live|eyJ[A-Za-z0-9_-]{40,})/;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const REDACTED = "[redacted]";

export function redact<T>(value: T, depth = 0): T {
  if (depth > 12) return REDACTED as unknown as T;
  if (typeof value === "string") {
    if (TOKEN_VALUE.test(value) || (value.length > 40 && value.startsWith("eyJ"))) return REDACTED as unknown as T;
    if (EMAIL_VALUE.test(value)) return REDACTED as unknown as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    if (value instanceof Error) {
      return { name: value.name, message: redact(value.message), stack: value.stack } as unknown as T;
    }
    if (Buffer.isBuffer(value)) return `[buffer ${value.length}]` as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!ALLOWED_KEYS.has(k) && (SECRET_KEY.test(k) || PII_KEY.test(k))) out[k] = REDACTED;
      else out[k] = redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isTest ? "silent" : isProd ? "info" : "debug"),
  formatters: {
    log: (obj) => redact(obj),
  },
  ...(isProd || isTest
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } }),
});

export type Logger = typeof logger;

/** A child logger with the fields every job or request line must carry. */
export function withContext(ctx: {
  workspaceId?: string;
  jobId?: string;
  requestId?: string;
  channel?: string;
  channelAccountId?: string;
}): Logger {
  return logger.child(ctx);
}
