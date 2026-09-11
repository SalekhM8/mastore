# eBay connector

UK marketplace (`EBAY_GB`, Trading site id 3). Implements `ChannelConnector` from `src/connectors/contract.ts`. Sandbox and production differ only by host; scope URLs are identical.

## Auth model

OAuth 2.0 authorization code. `buildAuthorizeUrl` sends the seller to `auth.[sandbox.]ebay.com/oauth2/authorize` with the RuName as `redirect_uri` (eBay maps the RuName to the real callback URL registered in the developer portal). `exchangeAuthCode` and `refreshCredentials` post to `/identity/v1/oauth2/token` with HTTP Basic `clientId:clientSecret`. User access tokens last 2 hours; refresh tokens about 18 months and are not rotated on refresh, so the bundle keeps the original. `invalid_grant` on refresh means the seller must reconnect: mapped to `auth_revoked`.

`identify(bundle)` calls `GET /commerce/identity/v1/user/` and returns the eBay **username** as `externalAccountId` (also `displayName`), marketplace `EBAY_GB`. Webhook verification returns the same username in `externalAccountId` when the payload carries one, so events route to the right account.

Scopes requested: `api_scope`, `sell.inventory`, `sell.fulfillment`, `sell.account`, `sell.marketing.readonly`, `commerce.notification.subscription`, `commerce.identity.readonly`.

The application token (client credentials, `api_scope`) is used only to fetch notification public keys.

## Two listing models

| Model | How the listing was made | Quantity and price | Delist | Read quantity |
|---|---|---|---|---|
| `inventory` | Inventory API (has an offer id) | `POST /sell/inventory/v1/bulk_update_price_quantity` | `POST /sell/inventory/v1/offer/{offerId}/withdraw` | `GET /sell/inventory/v1/offer/{offerId}` → `availableQuantity` |
| `trading` | eBay website or legacy tools (no offer) | Trading `ReviseInventoryStatus` (`Quantity` = available, `StartPrice`) | Trading `EndFixedPriceItem`, reason `NotAvailable` | Trading `GetItem` → `Quantity − QuantitySold`, 0 unless `ListingStatus` is `Active` |

`ListingRef.listingModel` decides. When it is missing, a listing with `externalIds.offerId` is treated as inventory and anything else as trading. Inventory listings need both `externalIds.sku` and `externalIds.offerId`; without them the push is terminal `ebay.missing_offer` and the seller is asked to re-import.

`listRemoteListings` pages the Inventory API first (25 items per page, one offer lookup per item), then hands the cursor to Trading `GetMyeBaySelling` active list (100 per page). A listing created through the Inventory API also appears in the Trading active list; the import job dedupes on `(channel_account_id, external_listing_id)` and should prefer the inventory row because it carries the offer id. Unpublished offers surface as `status: draft` with `externalListingId` = `offer:{offerId}`.

## Error mapping

REST: 429 → `rate_limited` (honours `Retry-After`, else 10 s); 401 or error ids 1001–1003, 1100 → `auth_revoked`; 5xx or a thrown fetch → `retryable`; 404 or error ids 25001, 25002, 25710, 25713, 25715, 25716, 25604 → `terminal` `ebay.listing_not_found`; other 4xx → `terminal` with eBay's `longMessage`. `bulk_update_price_quantity` returns 200 with per-item `statusCode`, which is classified the same way.

Trading (`Ack=Failure`): codes 931, 932, 21916984, 21917053, 21916013 → `auth_revoked`; 218050, 218053, 218054 (call limits) → `rate_limited` for an hour; 10007, 21919189 → `retryable`; 17, 291, 1047, 21916750, 21916884, 21916293, 21916012 → `terminal` `ebay.listing_not_found`; anything else → `terminal` with `LongMessage`. `Ack=Warning` is success. Ending an already ended listing or withdrawing an already unpublished offer is reported as `ok`, because the desired state holds.

## Rate limits (vendor figures, verify before launch)

- Inventory API: 2,000,000 calls/day per application.
- Fulfillment API: 100,000 calls/day per application (orders), used by the 5 minute poll.
- Trading API: 5,000 calls/day per application by default; `ReviseInventoryStatus` accepts up to 4 items per call (we send one).
- Queue policy lives in `docs/reliability-and-operations.md` section 3: concurrency 2 per account, 20 calls per 10 s.

## Webhooks (Notification API)

- Topics subscribed: `ORDER_CONFIRMATION` (sales) and `MARKETPLACE_ACCOUNT_DELETION` (mandatory for a production keyset).
- Header `X-EBAY-SIGNATURE` is base64 JSON `{alg, kid, signature, digest}`. The public key comes from `GET /commerce/notification/v1/public_key/{kid}` (app token), is normalised to PEM (eBay may omit line breaks) and cached in memory for one hour per `kid`. The signature is verified with Node `crypto.createVerify(digest)`. eBay's official event-notification SDK uses **SHA1** as the digest; we honour the header's `digest` field and fall back to SHA1.
- Account deletion challenge: `GET ?challenge_code=…` is answered with `{"challengeResponse": sha256hex(challengeCode + verificationToken + endpointUrl)}`, content type `application/json`, in that concatenation order. `deletionVerificationToken` and `webhookEndpointUrl` must match what was entered in the developer portal exactly.
- `parseInbound` maps `ORDER_CONFIRMATION` line items (Fulfillment shape: `lineItemId`, `legacyItemId`, `quantity`, `lineItemCost`) to `sale` events keyed on `lineItemId`. If the payload carries only an `orderId`, it returns `[]` and the ingest job must call `pullOrder(account, orderIdFromNotification(payload))`.
- `externalAccountId` on verification is read from `notification.data.username`, `sellerId`, `sellerUsername` or `userId`, whichever is present. If none is present it is left undefined; the ingest job then marks the receipt unmatched and the 5 minute `getOrders` poll picks the sale up.

## Orders

`pullOrders(account, sinceIso, cursor)` calls `GET /sell/fulfillment/v1/order?filter=lastmodifieddate:[since..]&limit=50&offset=N`. Each line item becomes a `sale` (unit price = `lineItemCost / quantity`, rounded to pence) unless `cancelStatus.cancelState` is `CANCELED`, in which case it becomes a `cancellation`. Idempotency is by `lineItemId`, the same key the webhook path uses, so a poll and a webhook for the same sale collapse in the ledger.

## Known quirks

- `ReviseInventoryStatus` `Quantity` is the quantity **available**, unlike `ReviseItem` where it is the original total. Do not mix them up.
- Multi-variation Trading listings need `<SKU>` (the variation SKU, `externalIds.variationSku`) alongside `ItemID`; without it eBay revises the parent, which is wrong.
- The ORDER_CONFIRMATION payload schema is not fully documented by eBay. The zod schema in `schemas.ts` accepts an `orderId` and optional line items and must be tightened against a recorded sandbox payload before launch.
- Trading responses are read with a minimal tag extractor (`xml.ts`), not an XML parser. It is adequate for the four calls used here and every value is validated with zod afterwards.
- `GetMyeBaySelling` reports `QuantityAvailable` for active listings; when absent we use `Quantity − QuantitySold`.
- Production keysets stay disabled until the deletion challenge endpoint passes eBay's check.

## Fixtures

`fixtures/` were **hand-written from eBay's public API documentation on 11 Sep 2026**, not recorded. They must be re-recorded from the sandbox before the connector is used against a real account, and the contract tests then re-run against the recordings. Engineering standards require re-recording at most every 90 days.
