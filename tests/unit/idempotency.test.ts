import { describe, expect, it } from "vitest";
import { inboundKey, manualKey } from "@/domain/ledger/idempotency";

describe("idempotency keys", () => {
  it("builds the documented format for an inbound sale", () => {
    expect(
      inboundKey({
        channel: "ebay",
        externalAccountId: "seller123",
        resource: "orderline",
        resourceId: "12-34567-89012",
        action: "sale",
      }),
    ).toBe("ebay:seller123:orderline:12-34567-89012:sale");
  });
  it("builds a manual key with a client-generated id so a double click is one event", () => {
    expect(manualKey({ userId: "u1", skuId: "s1", action: "restock", clientId: "c1" })).toBe(
      "user:u1:sku:s1:restock:c1",
    );
  });
  it("rejects parts that would corrupt the format", () => {
    expect(() =>
      inboundKey({
        channel: "ebay",
        externalAccountId: "a:b",
        resource: "listing",
        resourceId: "x",
        action: "baseline",
      }),
    ).toThrow();
    expect(() => manualKey({ userId: "", skuId: "s", action: "adjust", clientId: "c" })).toThrow();
  });
});
