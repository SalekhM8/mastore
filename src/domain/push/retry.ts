import type { PushResult } from "../channels/types";

/**
 * Retry policy for outbound pushes. Pure. See docs/reliability-and-operations.md section 3.
 *
 * Attempts are counted in the database, not in Inngest, so the seller can see
 * "Retrying eBay (attempt 3 of 6)" and so a redeploy never resets the count.
 */

export const MAX_ATTEMPTS = 6;
const BASE_MS = 2_000;
const CAP_MS = 300_000;
const JITTER = 0.3;

/** min(2^attempt × 2 s, 5 min) with ±30% jitter. attempt is 1-based: the attempt that just failed. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const raw = Math.min(2 ** Math.max(attempt - 1, 0) * BASE_MS, CAP_MS);
  const jitter = 1 + (random() * 2 - 1) * JITTER;
  return Math.round(raw * jitter);
}

export type JobTransition =
  | { readonly status: "succeeded" }
  | { readonly status: "failed"; readonly nextAttemptAt: Date; readonly error: JobError }
  | {
      readonly status: "dead";
      readonly error: JobError;
      /** What else must change beyond the job row. */
      readonly sideEffect: "none" | "account_auth_revoked" | "listing_error";
    };

export interface JobError {
  readonly kind: Exclude<PushResult["kind"], "ok">;
  readonly message: string;
  readonly code?: string;
  readonly attempt: number;
}

/**
 * Given the connector's result and the attempt number that just ran (1-based), decide the job's next state.
 */
export function decideTransition(
  result: PushResult<unknown>,
  attempt: number,
  now: Date,
  random: () => number = Math.random,
): JobTransition {
  switch (result.kind) {
    case "ok":
      return { status: "succeeded" };
    case "retryable":
    case "rate_limited": {
      const message = result.kind === "retryable" ? result.message : "Rate limited by the channel";
      const error: JobError = { kind: result.kind, message, attempt };
      if (attempt >= MAX_ATTEMPTS) return { status: "dead", error, sideEffect: "none" };
      const delay = result.retryAfterMs ?? backoffMs(attempt, random);
      return { status: "failed", nextAttemptAt: new Date(now.getTime() + delay), error };
    }
    case "auth_revoked":
      return {
        status: "dead",
        error: { kind: "auth_revoked", message: result.message, attempt },
        sideEffect: "account_auth_revoked",
      };
    case "terminal":
      return {
        status: "dead",
        error: { kind: "terminal", message: result.messageForSeller, code: result.code, attempt },
        sideEffect: "listing_error",
      };
  }
}

/** A job is stale when a newer ledger event for its SKU has already been recorded. */
export function isSuperseded(jobLedgerSeq: number, skuLastEventSeq: number): boolean {
  return skuLastEventSeq > jobLedgerSeq;
}
