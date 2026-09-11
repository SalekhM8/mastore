import { describe, expect, it } from "vitest";
import { planInbound } from "@/domain/ledger/inbound";

const base = { channel: "ebay" as const, externalAccountId: "seller123" };

describe("planInbound", () => {
  it("a sale becomes a negative ledger delta with a stable key", () => {
    const p = planInbound({
      ...base,
      inbound: {
        type: "sale",
        externalOrderId: "12-34567-89012",
        externalLineId: "1",
        externalListingId: "1234567",
        quantity: 2,
        unitPrice: { amountMinor: 2500, currency: "GBP" },
        occurredAt: "2026-09-11T10:00:00Z",
      },
    });
    expect(p).toMatchObject({
      type: "ledger",
      kind: "sale",
      quantityDelta: -2,
      idempotencyKey: "ebay:seller123:orderline:12-34567-89012/1:sale",
      externalListingId: "1234567",
    });
  });
  it("the same sale delivered twice produces the same key", () => {
    const inbound = {
      type: "sale" as const,
      externalOrderId: "o1",
      externalLineId: "l1",
      externalListingId: "x",
      quantity: 1,
      unitPrice: { amountMinor: 100, currency: "GBP" as const },
      occurredAt: "2026-09-11T10:00:00Z",
    };
    const a = planInbound({ ...base, inbound });
    const b = planInbound({ ...base, inbound });
    expect(a).toEqual(b);
  });
  it("a cancellation puts stock back with a different key from the sale", () => {
    const p = planInbound({
      ...base,
      inbound: {
        type: "cancellation",
        externalOrderId: "o1",
        externalLineId: "l1",
        quantity: 1,
        occurredAt: "2026-09-11T10:00:00Z",
      },
    });
    expect(p).toMatchObject({
      type: "ledger",
      kind: "cancellation",
      quantityDelta: 1,
      idempotencyKey: "ebay:seller123:orderline:o1/l1:cancel",
    });
  });
  it("zero-quantity events are ignored", () => {
    const p = planInbound({
      ...base,
      inbound: {
        type: "return",
        externalOrderId: "o1",
        externalLineId: "l1",
        quantity: 0,
        occurredAt: "2026-09-11T10:00:00Z",
      },
    });
    expect(p.type).toBe("ignore");
  });
  it("listing changes and auth revocations are passed through, not ledgered", () => {
    expect(
      planInbound({
        ...base,
        inbound: { type: "listing_changed", externalListingId: "x", quantity: 3, occurredAt: "t" },
      }),
    ).toEqual({
      type: "listing_changed",
      externalListingId: "x",
      quantity: 3,
    });
    expect(planInbound({ ...base, inbound: { type: "auth_revoked", occurredAt: "t" } })).toEqual({
      type: "auth_revoked",
    });
  });
});
