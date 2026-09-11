import type { Channel } from "../channels/types";

/**
 * One format for every idempotency key in the system:
 *   {channel}:{externalAccountId}:{resource}:{resourceId}:{action}[:{qualifier}]
 * A duplicate key is not an error; apply_ledger_event returns the original event.
 */
export function inboundKey(input: {
  channel: Channel;
  externalAccountId: string;
  resource: "orderline" | "listing";
  resourceId: string;
  action: "sale" | "cancel" | "return" | "baseline";
}): string {
  return [input.channel, input.externalAccountId, input.resource, input.resourceId, input.action]
    .map(assertNoColon)
    .join(":");
}

export function manualKey(input: {
  userId: string;
  skuId: string;
  action: "restock" | "adjust" | "correction";
  clientId: string;
}): string {
  return ["user", input.userId, "sku", input.skuId, input.action, input.clientId].map(assertNoColon).join(":");
}

function assertNoColon(part: string): string {
  if (part.includes(":")) throw new Error(`idempotency key part contains ':' (${part})`);
  if (part.length === 0) throw new Error("idempotency key part is empty");
  return part;
}
