import type { z } from "zod";
import type { NormalisedInbound, Page, PushResult } from "@/domain/channels/types";
import type { EbayConfig } from "./config";
import { apiUrl, classifyRest, exchange, restHeaders } from "./http";
import { Order, OrdersResponse, toMinor } from "./schemas";

const PAGE = 50;

/** Fulfillment API orders modified since a point in time, one page per call. Cursor is the offset. */
export async function pullOrders(
  cfg: EbayConfig,
  token: string,
  sinceIso: string,
  cursor?: string,
): Promise<PushResult<Page<NormalisedInbound>>> {
  const offset = cursor ? Number(cursor) : 0;
  const filter = encodeURIComponent(`lastmodifieddate:[${sinceIso}..]`);
  const res = await exchange(
    cfg,
    apiUrl(cfg, `/sell/fulfillment/v1/order?filter=${filter}&limit=${PAGE}&offset=${offset}`),
    {
      method: "GET",
      headers: restHeaders(token),
    },
  );
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status < 200 || x.status >= 300) return classifyRest(x, "order pull");
  const parsed = OrdersResponse.safeParse(x.json);
  if (!parsed.success)
    return {
      kind: "terminal",
      code: "ebay.orders.shape",
      messageForSeller: "eBay returned an unexpected orders shape.",
    };
  const items = parsed.data.orders.flatMap(orderToInbound);
  const total = parsed.data.total ?? offset + parsed.data.orders.length;
  const nextOffset = offset + parsed.data.orders.length;
  return {
    kind: "ok",
    value: {
      items,
      ...(nextOffset < total && parsed.data.orders.length > 0 ? { nextCursor: String(nextOffset) } : {}),
    },
  };
}

export async function getOrder(
  cfg: EbayConfig,
  token: string,
  orderId: string,
): Promise<PushResult<readonly NormalisedInbound[]>> {
  const res = await exchange(cfg, apiUrl(cfg, `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`), {
    method: "GET",
    headers: restHeaders(token),
  });
  if (res.kind !== "ok") return res;
  const x = res.value;
  if (x.status < 200 || x.status >= 300) return classifyRest(x, "order lookup");
  const parsed = Order.safeParse(x.json);
  if (!parsed.success)
    return { kind: "terminal", code: "ebay.order.shape", messageForSeller: "eBay returned an unexpected order shape." };
  return { kind: "ok", value: orderToInbound(parsed.data) };
}

/** A cancelled order yields cancellations; anything else yields sales. Both key on lineItemId. */
export function orderToInbound(order: z.infer<typeof Order>): NormalisedInbound[] {
  const cancelled = order.cancelStatus?.cancelState === "CANCELED";
  return order.lineItems.map((line) => {
    if (cancelled) {
      return {
        type: "cancellation" as const,
        externalOrderId: order.orderId,
        externalLineId: line.lineItemId,
        quantity: line.quantity,
        occurredAt: order.lastModifiedDate ?? order.creationDate,
      };
    }
    const totalMinor = toMinor(line.lineItemCost.value);
    return {
      type: "sale" as const,
      externalOrderId: order.orderId,
      externalLineId: line.lineItemId,
      externalListingId: line.legacyItemId,
      quantity: line.quantity,
      unitPrice: { amountMinor: Math.round(totalMinor / line.quantity), currency: "GBP" as const },
      occurredAt: order.creationDate,
    };
  });
}
