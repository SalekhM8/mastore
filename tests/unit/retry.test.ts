import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { backoffMs, decideTransition, isSuperseded, MAX_ATTEMPTS } from "@/domain/push/retry";

const now = new Date("2026-09-11T12:00:00Z");
const mid = () => 0.5; // zero jitter

describe("backoffMs", () => {
  it("doubles from 2 s and caps at 5 min", () => {
    expect(backoffMs(1, mid)).toBe(2_000);
    expect(backoffMs(2, mid)).toBe(4_000);
    expect(backoffMs(3, mid)).toBe(8_000);
    expect(backoffMs(6, mid)).toBe(64_000);
    expect(backoffMs(9, mid)).toBe(300_000);
    expect(backoffMs(50, mid)).toBe(300_000);
  });
  it("jitter stays within ±30%", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.double({ min: 0, max: 1, noNaN: true }), (attempt, r) => {
        const base = backoffMs(attempt, mid);
        const v = backoffMs(attempt, () => r);
        expect(v).toBeGreaterThanOrEqual(Math.floor(base * 0.7));
        expect(v).toBeLessThanOrEqual(Math.ceil(base * 1.3));
      }),
    );
  });
});

describe("decideTransition", () => {
  it("ok succeeds", () => {
    expect(decideTransition({ kind: "ok", value: undefined }, 1, now)).toEqual({ status: "succeeded" });
  });
  it("retryable schedules the next attempt with backoff", () => {
    const t = decideTransition({ kind: "retryable", message: "503" }, 2, now, mid);
    expect(t.status).toBe("failed");
    if (t.status === "failed") expect(t.nextAttemptAt.getTime() - now.getTime()).toBe(4_000);
  });
  it("rate limited honours retryAfterMs", () => {
    const t = decideTransition({ kind: "rate_limited", retryAfterMs: 42_000 }, 1, now, mid);
    expect(t.status).toBe("failed");
    if (t.status === "failed") expect(t.nextAttemptAt.getTime() - now.getTime()).toBe(42_000);
  });
  it("the sixth retryable failure is dead", () => {
    const t = decideTransition({ kind: "retryable", message: "timeout" }, MAX_ATTEMPTS, now, mid);
    expect(t.status).toBe("dead");
    if (t.status === "dead") expect(t.sideEffect).toBe("none");
  });
  it("auth revoked is dead immediately and stops the account", () => {
    const t = decideTransition({ kind: "auth_revoked", message: "token invalid" }, 1, now);
    expect(t).toMatchObject({ status: "dead", sideEffect: "account_auth_revoked" });
  });
  it("terminal is dead immediately and marks the listing", () => {
    const t = decideTransition({ kind: "terminal", code: "ended", messageForSeller: "Listing has ended." }, 1, now);
    expect(t).toMatchObject({ status: "dead", sideEffect: "listing_error", error: { code: "ended" } });
  });
  it("never retries more than MAX_ATTEMPTS times", () => {
    fc.assert(
      fc.property(fc.integer({ min: MAX_ATTEMPTS, max: 100 }), (attempt) => {
        expect(decideTransition({ kind: "retryable", message: "x" }, attempt, now).status).toBe("dead");
      }),
    );
  });
});

describe("isSuperseded", () => {
  it("is true only when the SKU has moved past the job's sequence", () => {
    expect(isSuperseded(10, 10)).toBe(false);
    expect(isSuperseded(10, 11)).toBe(true);
    expect(isSuperseded(10, 9)).toBe(false);
  });
});
