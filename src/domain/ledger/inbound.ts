import type { Channel, NormalisedInbound } from "../channels/types";
import { inboundKey } from "./idempotency";

/**
 * Turns a normalised inbound event into the exact arguments for apply_ledger_event,
 * or into an instruction for the job when it is not a ledger matter. Pure.
 */

export interface LedgerCommand {
  readonly type: "ledger";
  readonly kind: "sale" | "cancellation" | "return";
  readonly quantityDelta: number;
  readonly idempotencyKey: string;
  readonly externalListingId: string | null;
  readonly externalOrderId: string;
  readonly externalLineId: string;
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type InboundPlan =
  | LedgerCommand
  | {
      readonly type: "listing_changed";
      readonly externalListingId: string;
      readonly quantity?: number;
      readonly status?: string;
    }
  | { readonly type: "auth_revoked" }
  | { readonly type: "ignore"; readonly reason: string };

export function planInbound(input: {
  channel: Channel;
  externalAccountId: string;
  inbound: NormalisedInbound;
}): InboundPlan {
  const { channel, externalAccountId, inbound } = input;
  switch (inbound.type) {
    case "sale": {
      if (inbound.quantity <= 0) return { type: "ignore", reason: "sale with non-positive quantity" };
      return {
        type: "ledger",
        kind: "sale",
        quantityDelta: -inbound.quantity,
        idempotencyKey: inboundKey({
          channel,
          externalAccountId,
          resource: "orderline",
          resourceId: `${inbound.externalOrderId}/${inbound.externalLineId}`,
          action: "sale",
        }),
        externalListingId: inbound.externalListingId,
        externalOrderId: inbound.externalOrderId,
        externalLineId: inbound.externalLineId,
        occurredAt: inbound.occurredAt,
        metadata: { unit_price_minor: inbound.unitPrice.amountMinor, currency: inbound.unitPrice.currency },
      };
    }
    case "cancellation":
    case "return": {
      if (inbound.quantity <= 0) return { type: "ignore", reason: `${inbound.type} with non-positive quantity` };
      return {
        type: "ledger",
        kind: inbound.type,
        quantityDelta: inbound.quantity,
        idempotencyKey: inboundKey({
          channel,
          externalAccountId,
          resource: "orderline",
          resourceId: `${inbound.externalOrderId}/${inbound.externalLineId}`,
          action: inbound.type === "cancellation" ? "cancel" : "return",
        }),
        externalListingId: null,
        externalOrderId: inbound.externalOrderId,
        externalLineId: inbound.externalLineId,
        occurredAt: inbound.occurredAt,
        metadata: {},
      };
    }
    case "listing_changed":
      return {
        type: "listing_changed",
        externalListingId: inbound.externalListingId,
        ...(inbound.quantity !== undefined ? { quantity: inbound.quantity } : {}),
        ...(inbound.status !== undefined ? { status: inbound.status } : {}),
      };
    case "auth_revoked":
      return { type: "auth_revoked" };
  }
}
