import { z } from "zod";

/** Every eBay response is parsed with one of these before anything is read from it. */

export const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
  token_type: z.string().optional(),
});

export const OAuthError = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

export const RestError = z.object({
  errorId: z.number().int(),
  domain: z.string().optional(),
  category: z.string().optional(),
  message: z.string().optional(),
  longMessage: z.string().optional(),
});
export const RestErrorBody = z.object({ errors: z.array(RestError).default([]) });

const Amount = z.object({ value: z.string(), currency: z.string() });

export const BulkUpdateResponse = z.object({
  responses: z.array(
    z.object({
      sku: z.string().optional(),
      statusCode: z.number().int(),
      offers: z
        .array(
          z.object({
            offerId: z.string(),
            statusCode: z.number().int(),
            errors: z.array(RestError).optional(),
          }),
        )
        .optional(),
      errors: z.array(RestError).optional(),
    }),
  ),
});

export const Offer = z.object({
  offerId: z.string(),
  sku: z.string().optional(),
  marketplaceId: z.string().optional(),
  availableQuantity: z.number().int().optional(),
  status: z.enum(["PUBLISHED", "UNPUBLISHED"]).optional(),
  listing: z.object({ listingId: z.string().optional(), listingStatus: z.string().optional() }).optional(),
  pricingSummary: z.object({ price: Amount.optional() }).optional(),
});
export const OffersResponse = z.object({ offers: z.array(Offer).default([]), total: z.number().int().optional() });

export const InventoryItem = z.object({
  sku: z.string(),
  product: z
    .object({
      title: z.string().optional(),
      imageUrls: z.array(z.string()).optional(),
    })
    .optional(),
  availability: z
    .object({
      shipToLocationAvailability: z.object({ quantity: z.number().int().optional() }).optional(),
    })
    .optional(),
});
export const InventoryItemsResponse = z.object({
  inventoryItems: z.array(InventoryItem).default([]),
  total: z.number().int().optional(),
  next: z.string().optional(),
});

export const OrderLineItem = z.object({
  lineItemId: z.string(),
  legacyItemId: z.string(),
  legacyVariationId: z.string().optional(),
  sku: z.string().optional(),
  quantity: z.number().int().positive(),
  lineItemCost: Amount,
  lineItemFulfillmentStatus: z.string().optional(),
});
export const Order = z.object({
  orderId: z.string(),
  creationDate: z.string(),
  lastModifiedDate: z.string().optional(),
  orderFulfillmentStatus: z.string().optional(),
  cancelStatus: z.object({ cancelState: z.string().optional() }).optional(),
  lineItems: z.array(OrderLineItem).default([]),
});
export const OrdersResponse = z.object({
  orders: z.array(Order).default([]),
  total: z.number().int().optional(),
  next: z.string().optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});

/** Notification API envelope. `data` differs per topic and is parsed per topic. */
export const NotificationEnvelope = z.object({
  metadata: z.object({ topic: z.string(), schemaVersion: z.string().optional(), deprecated: z.boolean().optional() }),
  notification: z.object({
    notificationId: z.string(),
    eventDate: z.string().optional(),
    publishDate: z.string().optional(),
    publishAttemptCount: z.number().int().optional(),
    data: z.unknown(),
  }),
});

/**
 * ORDER_CONFIRMATION data. eBay's published schema for this topic is thin; we accept an
 * orderId and, when present, line items in Fulfillment API shape. If line items are absent the
 * caller must pull the order. See README "Known quirks".
 */
export const OrderConfirmationData = z.object({
  orderId: z.string(),
  creationDate: z.string().optional(),
  lineItems: z.array(OrderLineItem).optional(),
});

export const AccountDeletionData = z.object({
  username: z.string().optional(),
  userId: z.string().optional(),
  eiasToken: z.string().optional(),
});

export const SignatureHeader = z.object({
  alg: z.string().optional(),
  kid: z.string().min(1),
  signature: z.string().min(1),
  digest: z.string().optional(),
});

/** GET /commerce/identity/v1/user/ . `username` is the stable public seller id we key accounts on. */
export const IdentityUser = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
  accountType: z.string().optional(),
  registrationMarketplaceId: z.string().optional(),
});

export const PublicKeyResponse = z.object({
  key: z.string().min(1),
  algorithm: z.string().optional(),
  digest: z.string().optional(),
});

/** Money from eBay is a decimal string. GBP minor units are pence. */
export function toMinor(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}
