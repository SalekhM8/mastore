import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AccountContext, ListingRef } from "@/connectors/contract";
import { EbayConnector, orderIdFromNotification } from "@/connectors/ebay";
import type { WorkspaceId } from "@/domain/channels/types";

const FIXTURES = path.resolve(__dirname, "../../../src/connectors/ebay/fixtures");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

type Route = (req: Recorded) => Response | Promise<Response>;

/** A fake fetch keyed on "METHOD path-prefix". Records every request for assertions. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
    const rec: Recorded = { url, method, headers, body: typeof init?.body === "string" ? init.body : "" };
    calls.push(rec);
    const u = new URL(url);
    const key = Object.keys(routes).find((k) => {
      const [m, prefix] = k.split(" ");
      return m === method && (u.pathname + u.search).startsWith(prefix);
    });
    if (!key)
      return new Response(
        JSON.stringify({ errors: [{ errorId: 0, message: `no route for ${method} ${u.pathname}` }] }),
        { status: 599 },
      );
    return routes[key](rec);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const json = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
const xml = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/xml" } });

const NOW = new Date("2026-09-11T10:00:00.000Z");

function connector(routes: Record<string, Route>, extra: Partial<ConstructorParameters<typeof EbayConnector>[0]> = {}) {
  const f = fakeFetch(routes);
  const c = new EbayConnector({
    clientId: "SyncLtd-Sync-SBX-abc123",
    clientSecret: "SBX-secret-value",
    ruName: "Sync_Ltd-SyncLtd-Sync-S-abcdef",
    env: "sandbox",
    deletionVerificationToken: "verification_token_that_is_at_least_32_chars_long",
    webhookEndpointUrl: "https://sync.example.com/api/webhooks/ebay",
    fetch: f.fetch,
    now: () => NOW,
    ...extra,
  });
  return { c, calls: f.calls };
}

const account: AccountContext = {
  workspaceId: "ws-1" as WorkspaceId,
  channelAccountId: "ca-1",
  externalAccountId: "sync_seller_uk",
  marketplace: "EBAY_GB",
  credentials: { accessToken: "v^1.1#access", refreshToken: "v^1.1#refresh", scopes: [] },
  settings: {},
};

const inventoryListing: ListingRef = {
  channelListingId: "cl-1",
  externalListingId: "110556789012",
  externalIds: { sku: "SKU-RED-9", offerId: "8765432109", listingModel: "inventory" },
  listingModel: "inventory",
};
const tradingListing: ListingRef = {
  channelListingId: "cl-2",
  externalListingId: "110556789099",
  externalIds: { listingModel: "trading" },
  listingModel: "trading",
};

describe("eBay OAuth", () => {
  it("builds a sandbox consent URL with the RuName, scopes and state", () => {
    const { c } = connector({});
    const url = c.buildAuthorizeUrl({ workspaceId: "ws-1" as WorkspaceId, state: "st4te", redirectUri: "ignored" });
    expect(url.origin).toBe("https://auth.sandbox.ebay.com");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("SyncLtd-Sync-SBX-abc123");
    expect(url.searchParams.get("redirect_uri")).toBe("Sync_Ltd-SyncLtd-Sync-S-abcdef");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st4te");
    const scope = url.searchParams.get("scope") ?? "";
    for (const s of [
      "sell.inventory",
      "sell.fulfillment",
      "sell.account",
      "commerce.notification.subscription",
      "commerce.identity.readonly",
    ]) {
      expect(scope).toContain(`https://api.ebay.com/oauth/api_scope/${s}`);
    }
  });

  it("exchanges an auth code with Basic auth and maps the token response", async () => {
    const { c, calls } = connector({ "POST /identity/v1/oauth2/token": () => json(fixture("token.json")) });
    const res = await c.exchangeAuthCode({ code: "v^1.1#code", redirectUri: "ignored" });
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.value.accessToken).toBe("v^1.1#i^1#f^0#r^0#p^3#I^3#t^H4sIAAAAAAAAAOVXa2wUVRTe7bal");
    expect(res.value.refreshToken).toBe("v^1.1#i^1#f^0#r^1#p^3#I^3#t^Ul4xMF8yOjE2NDQ5NDMzNzAyNjE");
    expect(res.value.expiresAt).toBe(new Date(NOW.getTime() + 7200 * 1000).toISOString());
    expect(res.value.extra?.refreshTokenExpiresAt).toBe(new Date(NOW.getTime() + 47304000 * 1000).toISOString());
    const req = calls[0];
    expect(req.url).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    expect(req.headers.authorization).toBe(
      `Basic ${Buffer.from("SyncLtd-Sync-SBX-abc123:SBX-secret-value").toString("base64")}`,
    );
    expect(req.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(req.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("v^1.1#code");
    expect(form.get("redirect_uri")).toBe("Sync_Ltd-SyncLtd-Sync-S-abcdef");
  });

  it("refreshes with the refresh token and keeps it when eBay omits one", async () => {
    const { c, calls } = connector({
      "POST /identity/v1/oauth2/token": () =>
        json(JSON.stringify({ access_token: "new-access", expires_in: 7200, token_type: "User Access Token" })),
    });
    const res = await c.refreshCredentials(account.credentials);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.value.accessToken).toBe("new-access");
    expect(res.value.refreshToken).toBe("v^1.1#refresh");
    expect(new URLSearchParams(calls[0].body).get("grant_type")).toBe("refresh_token");
  });

  it("maps invalid_grant to auth_revoked", async () => {
    const { c } = connector({
      "POST /identity/v1/oauth2/token": () =>
        json(JSON.stringify({ error: "invalid_grant", error_description: "refresh token expired" }), 400),
    });
    const res = await c.refreshCredentials(account.credentials);
    expect(res.kind).toBe("auth_revoked");
  });

  it("identifies the seller by eBay username", async () => {
    const { c, calls } = connector({ "GET /commerce/identity/v1/user/": () => json(fixture("identity_user.json")) });
    const res = await c.identify(account.credentials);
    expect(res).toEqual({
      kind: "ok",
      value: { externalAccountId: "sync_seller_uk", displayName: "sync_seller_uk", marketplace: "EBAY_GB" },
    });
    expect(calls[0].headers.authorization).toBe("Bearer v^1.1#access");
  });

  it("identify maps 401 to auth_revoked and 503 to retryable", async () => {
    const a = connector({ "GET /commerce/identity/v1/user/": () => json("{}", 401) });
    expect((await a.c.identify(account.credentials)).kind).toBe("auth_revoked");
    const b = connector({ "GET /commerce/identity/v1/user/": () => json("{}", 503) });
    expect((await b.c.identify(account.credentials)).kind).toBe("retryable");
  });
});

describe("eBay Inventory API pushes", () => {
  it("pushStock sends bulk_update_price_quantity with the bearer token and maps ok", async () => {
    const { c, calls } = connector({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => json(fixture("bulk_update_ok.json")),
    });
    const res = await c.pushStock(account, inventoryListing, 3);
    expect(res).toEqual({ kind: "ok", value: undefined });
    const req = calls[0];
    expect(req.url).toBe("https://api.sandbox.ebay.com/sell/inventory/v1/bulk_update_price_quantity");
    expect(req.headers.authorization).toBe("Bearer v^1.1#access");
    expect(req.headers["content-language"]).toBe("en-GB");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({
      requests: [
        {
          sku: "SKU-RED-9",
          shipToLocationAvailability: { quantity: 3 },
          offers: [{ offerId: "8765432109", availableQuantity: 3 }],
        },
      ],
    });
  });

  it("pushPrice sends the price as a decimal string in GBP", async () => {
    const { c, calls } = connector({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => json(fixture("bulk_update_ok.json")),
    });
    const res = await c.pushPrice(account, inventoryListing, 2499);
    expect(res.kind).toBe("ok");
    expect(JSON.parse(calls[0].body).requests[0].offers[0].price).toEqual({ value: "24.99", currency: "GBP" });
  });

  it("maps 429 to rate_limited honouring Retry-After", async () => {
    const { c } = connector({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => json("{}", 429, { "retry-after": "17" }),
    });
    const res = await c.pushStock(account, inventoryListing, 3);
    expect(res).toEqual({ kind: "rate_limited", retryAfterMs: 17_000 });
  });

  it("maps 401 to auth_revoked", async () => {
    const { c } = connector({ "POST /sell/inventory/v1/bulk_update_price_quantity": () => json("{}", 401) });
    expect((await c.pushStock(account, inventoryListing, 3)).kind).toBe("auth_revoked");
  });

  it("maps a per-item 404 inside a 200 response to terminal listing_not_found with eBay's message", async () => {
    const { c } = connector({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => json(fixture("bulk_update_not_found.json")),
    });
    const res = await c.pushStock(account, inventoryListing, 3);
    expect(res.kind).toBe("terminal");
    if (res.kind !== "terminal") return;
    expect(res.code).toBe("ebay.listing_not_found");
    expect(res.messageForSeller).toContain("didn't find the entity");
  });

  it("maps 500 to retryable and a thrown fetch to retryable", async () => {
    const a = connector({ "POST /sell/inventory/v1/bulk_update_price_quantity": () => json("{}", 500) });
    expect((await a.c.pushStock(account, inventoryListing, 3)).kind).toBe("retryable");
    const b = connector({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => {
        throw new Error("ECONNRESET");
      },
    });
    expect((await b.c.pushStock(account, inventoryListing, 3)).kind).toBe("retryable");
  });

  it("delist withdraws the offer and treats an already-withdrawn offer as success", async () => {
    const { c, calls } = connector({
      "POST /sell/inventory/v1/offer/8765432109/withdraw": () => json(JSON.stringify({ listingId: "110556789012" })),
    });
    expect((await c.delist(account, inventoryListing)).kind).toBe("ok");
    expect(calls[0].method).toBe("POST");
    const gone = connector({
      "POST /sell/inventory/v1/offer/8765432109/withdraw": () =>
        json(JSON.stringify({ errors: [{ errorId: 25713, message: "Offer is unpublished" }] }), 400),
    });
    expect((await gone.c.delist(account, inventoryListing)).kind).toBe("ok");
  });

  it("refuses an inventory-model listing with no offer id with a plain seller message", async () => {
    const { c } = connector({});
    const res = await c.pushStock(account, { ...inventoryListing, externalIds: { sku: "SKU-RED-9" } }, 1);
    expect(res.kind).toBe("terminal");
    if (res.kind === "terminal") expect(res.code).toBe("ebay.missing_offer");
  });
});

describe("eBay Trading API pushes", () => {
  it("ReviseInventoryStatus carries ItemID and Quantity with the IAF token header and maps Success", async () => {
    const { c, calls } = connector({ "POST /ws/api.dll": () => xml(fixture("revise_inventory_status_ok.xml")) });
    const res = await c.pushStock(account, tradingListing, 3);
    expect(res).toEqual({ kind: "ok", value: undefined });
    const req = calls[0];
    expect(req.url).toBe("https://api.sandbox.ebay.com/ws/api.dll");
    expect(req.headers["x-ebay-api-call-name"]).toBe("ReviseInventoryStatus");
    expect(req.headers["x-ebay-api-siteid"]).toBe("3");
    expect(req.headers["x-ebay-api-compatibility-level"]).toBe("1271");
    expect(req.headers["x-ebay-api-iaf-token"]).toBe("v^1.1#access");
    expect(req.body).toContain("<ReviseInventoryStatusRequest");
    expect(req.body).toContain("<ItemID>110556789099</ItemID>");
    expect(req.body).toContain("<Quantity>3</Quantity>");
    expect(req.body).not.toContain("eBayAuthToken");
  });

  it("includes the variation SKU when the listing has one", async () => {
    const { c, calls } = connector({ "POST /ws/api.dll": () => xml(fixture("revise_inventory_status_ok.xml")) });
    await c.pushStock(
      account,
      { ...tradingListing, externalIds: { listingModel: "trading", variationSku: "RED-9" } },
      2,
    );
    expect(calls[0].body).toContain("<SKU>RED-9</SKU>");
  });

  it("maps an ended-listing Failure ack to terminal listing_not_found", async () => {
    const { c } = connector({ "POST /ws/api.dll": () => xml(fixture("revise_inventory_status_ended.xml")) });
    const res = await c.pushStock(account, tradingListing, 3);
    expect(res.kind).toBe("terminal");
    if (res.kind !== "terminal") return;
    expect(res.code).toBe("ebay.listing_not_found");
    expect(res.messageForSeller).toContain("has ended");
  });

  it("maps an invalid-token Failure ack to auth_revoked and a call-limit ack to rate_limited", async () => {
    const failure = (code: string) =>
      `<?xml version="1.0"?><ReviseInventoryStatusResponse><Ack>Failure</Ack><Errors><ShortMessage>x</ShortMessage><LongMessage>y</LongMessage><ErrorCode>${code}</ErrorCode><SeverityCode>Error</SeverityCode></Errors></ReviseInventoryStatusResponse>`;
    const a = connector({ "POST /ws/api.dll": () => xml(failure("931")) });
    expect((await a.c.pushStock(account, tradingListing, 3)).kind).toBe("auth_revoked");
    const b = connector({ "POST /ws/api.dll": () => xml(failure("218050")) });
    expect((await b.c.pushStock(account, tradingListing, 3)).kind).toBe("rate_limited");
  });

  it("pushPrice sends StartPrice as a decimal", async () => {
    const { c, calls } = connector({ "POST /ws/api.dll": () => xml(fixture("revise_inventory_status_ok.xml")) });
    await c.pushPrice(account, tradingListing, 3500);
    expect(calls[0].body).toContain("<StartPrice>35.00</StartPrice>");
  });

  it("delist ends the item with reason NotAvailable", async () => {
    const { c, calls } = connector({ "POST /ws/api.dll": () => xml(fixture("end_item_ok.xml")) });
    expect((await c.delist(account, tradingListing)).kind).toBe("ok");
    expect(calls[0].headers["x-ebay-api-call-name"]).toBe("EndFixedPriceItem");
    expect(calls[0].body).toContain("<ItemID>110556789099</ItemID>");
    expect(calls[0].body).toContain("<EndingReason>NotAvailable</EndingReason>");
  });

  it("treats a listing without an offer id and without a model as Trading", async () => {
    const { c, calls } = connector({ "POST /ws/api.dll": () => xml(fixture("revise_inventory_status_ok.xml")) });
    const legacy: ListingRef = { channelListingId: "cl-3", externalListingId: "110556789099", externalIds: {} };
    expect((await c.pushStock(account, legacy, 1)).kind).toBe("ok");
    expect(calls[0].headers["x-ebay-api-call-name"]).toBe("ReviseInventoryStatus");
  });

  it("maps HTTP 500 from the Trading endpoint to retryable", async () => {
    const { c } = connector({ "POST /ws/api.dll": () => xml("<html>oops</html>", 500) });
    expect((await c.pushStock(account, tradingListing, 3)).kind).toBe("retryable");
  });
});

describe("eBay listing reads", () => {
  it("pullListingQuantities reads offers for inventory listings and GetItem for trading listings", async () => {
    const { c, calls } = connector({
      "GET /sell/inventory/v1/offer/8765432109": () => json(fixture("offer.json")),
      "POST /ws/api.dll": () => xml(fixture("get_item.xml")),
    });
    const res = await c.pullListingQuantities(account, [
      inventoryListing,
      { ...tradingListing, externalListingId: "110556789012" },
    ]);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.value.get("110556789012")).toBe(3);
    const getItem = calls.find((r) => r.headers["x-ebay-api-call-name"] === "GetItem");
    expect(getItem?.body).toContain("<ItemID>110556789012</ItemID>");
    // Both reads targeted the same listing id; the trading read ran last and reports 10 - 7 = 3.
    expect(calls).toHaveLength(2);
  });

  it("GetItem maps quantity minus sold and treats non-active listings as zero", async () => {
    const ended = fixture("get_item.xml").replace(
      "<ListingStatus>Active</ListingStatus>",
      "<ListingStatus>Completed</ListingStatus>",
    );
    const { c } = connector({ "POST /ws/api.dll": () => xml(ended) });
    const res = await c.pullListingQuantities(account, [{ ...tradingListing, externalListingId: "110556789012" }]);
    expect(res.kind === "ok" && res.value.get("110556789012")).toBe(0);
  });

  it("listRemoteListings pages inventory items joined with offers, then hands off to Trading", async () => {
    const { c, calls } = connector({
      "GET /sell/inventory/v1/inventory_item": () => json(fixture("inventory_items.json")),
      "GET /sell/inventory/v1/offer?sku=SKU-RED-9": () => json(fixture("offers_red.json")),
      "GET /sell/inventory/v1/offer?sku=SKU-BLUE-8": () => json(fixture("offers_blue.json")),
      "POST /ws/api.dll": () => xml(fixture("get_my_ebay_selling.xml")),
    });
    const first = await c.listRemoteListings(account);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(first.value.items).toHaveLength(2);
    expect(first.value.items[0]).toMatchObject({
      externalListingId: "110556789012",
      externalIds: { listingModel: "inventory", sku: "SKU-RED-9", offerId: "8765432109" },
      sku: "SKU-RED-9",
      quantity: 4,
      price: { amountMinor: 2499, currency: "GBP" },
      status: "active",
      photoUrls: ["https://i.ebayimg.com/images/g/abc/s-l1600.jpg"],
    });
    expect(first.value.items[1]).toMatchObject({
      externalListingId: "offer:8765432110",
      status: "draft",
      quantity: 1,
      price: { amountMinor: 6000 },
    });
    expect(calls[0].url).toContain("/sell/inventory/v1/inventory_item?limit=25&offset=0");
    expect(first.value.nextCursor).toBeDefined();

    const second = await c.listRemoteListings(account, first.value.nextCursor);
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.value.items).toHaveLength(2);
    expect(second.value.items[0]).toMatchObject({
      externalListingId: "110556789012",
      externalIds: { listingModel: "trading", sku: "SKU-RED-9" },
      quantity: 3,
      price: { amountMinor: 2499 },
      photoUrls: ["https://i.ebayimg.com/images/g/abc/s-l140.jpg"],
    });
    expect(second.value.items[1]).toMatchObject({
      externalListingId: "110556789099",
      title: "Vintage Levi's 501 W32 L32",
      quantity: 1,
      price: { amountMinor: 3500 },
    });
    expect(second.value.nextCursor).toBeUndefined();
    const selling = calls.find((r) => r.headers["x-ebay-api-call-name"] === "GetMyeBaySelling");
    expect(selling?.body).toContain("<PageNumber>1</PageNumber>");
  });
});

describe("eBay orders", () => {
  it("pullOrders filters by lastmodifieddate and maps sales and cancellations in pence", async () => {
    const { c, calls } = connector({ "GET /sell/fulfillment/v1/order?": () => json(fixture("orders.json")) });
    const res = await c.pullOrders(account, "2026-09-10T00:00:00.000Z");
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(decodeURIComponent(calls[0].url)).toContain("filter=lastmodifieddate:[2026-09-10T00:00:00.000Z..]");
    expect(calls[0].url).toContain("limit=50&offset=0");
    expect(res.value.items).toEqual([
      {
        type: "sale",
        externalOrderId: "12-34567-89012",
        externalLineId: "10045678901234",
        externalListingId: "110556789012",
        quantity: 2,
        unitPrice: { amountMinor: 2499, currency: "GBP" },
        occurredAt: "2026-09-10T14:03:11.000Z",
      },
      {
        type: "cancellation",
        externalOrderId: "12-34567-89013",
        externalLineId: "10045678901235",
        quantity: 1,
        occurredAt: "2026-09-10T15:00:00.000Z",
      },
    ]);
    expect(res.value.nextCursor).toBeUndefined();
  });

  it("pullOrders returns an offset cursor while more pages remain", async () => {
    const page = JSON.parse(fixture("orders.json"));
    page.total = 120;
    const { c } = connector({ "GET /sell/fulfillment/v1/order?": () => json(JSON.stringify(page)) });
    const res = await c.pullOrders(account, "2026-09-10T00:00:00.000Z", "50");
    expect(res.kind === "ok" && res.value.nextCursor).toBe("52");
  });

  it("pullOrder fetches one order by id when a notification carries no line items", async () => {
    const order = JSON.parse(fixture("orders.json")).orders[0];
    const { c, calls } = connector({
      "GET /sell/fulfillment/v1/order/12-34567-89012": () => json(JSON.stringify(order)),
    });
    const res = await c.pullOrder(account, "12-34567-89012");
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0].type).toBe("sale");
    expect(calls[0].url).toBe("https://api.sandbox.ebay.com/sell/fulfillment/v1/order/12-34567-89012");
  });
});

describe("eBay notifications", () => {
  it("answers the account deletion challenge with sha256(code + token + endpoint)", async () => {
    const { c } = connector({});
    const res = await c.verifyWebhook({
      url: "https://sync.example.com/api/webhooks/ebay?challenge_code=abc123",
      headers: {},
      rawBody: "",
    });
    const expected = createHash("sha256")
      .update("abc123")
      .update("verification_token_that_is_at_least_32_chars_long")
      .update("https://sync.example.com/api/webhooks/ebay")
      .digest("hex");
    expect(res.valid).toBe(true);
    expect(res.challengeResponse).toEqual({
      status: 200,
      body: JSON.stringify({ challengeResponse: expected }),
      contentType: "application/json",
    });
  });

  it("fails the challenge with a 500 when no verification token is configured", async () => {
    const { c } = connector({}, { deletionVerificationToken: undefined });
    const res = await c.verifyWebhook({ url: "/api/webhooks/ebay?challenge_code=abc", headers: {}, rawBody: "" });
    expect(res.valid).toBe(false);
    expect(res.challengeResponse?.status).toBe(500);
  });

  it("verifies an ECDSA/SHA1 signature against the public key fetched with an app token, and caches the key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    // eBay serves the key without line breaks.
    const ebayKey = pem.replace(/\n/g, "");
    const body = fixture("order_confirmation.json");
    const signature = createSign("SHA1").update(body).end().sign(privateKey).toString("base64");
    const header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "kid-1", signature, digest: "SHA1" })).toString(
      "base64",
    );
    const { c, calls } = connector({
      "POST /identity/v1/oauth2/token": () => json(JSON.stringify({ access_token: "app-token", expires_in: 7200 })),
      "GET /commerce/notification/v1/public_key/kid-1": () =>
        json(JSON.stringify({ key: ebayKey, algorithm: "ECDSA", digest: "SHA1" })),
    });
    const req = {
      url: "https://sync.example.com/api/webhooks/ebay",
      headers: { "X-EBAY-SIGNATURE": header },
      rawBody: body,
    };
    const res = await c.verifyWebhook(req);
    expect(res).toEqual({
      valid: true,
      externalEventId: "49feeaeb-4982-42d9-9e4d-6a8c5f1e0e12",
      topic: "ORDER_CONFIRMATION",
      externalAccountId: "sync_seller_uk",
    });
    const tokenCall = calls.find((r) => r.url.endsWith("/identity/v1/oauth2/token"));
    expect(new URLSearchParams(tokenCall?.body).get("grant_type")).toBe("client_credentials");
    const keyCall = calls.find((r) => r.url.includes("/commerce/notification/v1/public_key/kid-1"));
    expect(keyCall?.headers.authorization).toBe("Bearer app-token");

    const again = await c.verifyWebhook(req);
    expect(again.valid).toBe(true);
    expect(calls.filter((r) => r.url.includes("/public_key/")).length).toBe(1);

    const tampered = await c.verifyWebhook({ ...req, rawBody: body.replace('"quantity": 2', '"quantity": 3') });
    expect(tampered.valid).toBe(false);
  });

  it("rejects a body with no signature header but still reports the event id", async () => {
    const { c } = connector({});
    const res = await c.verifyWebhook({
      url: "/api/webhooks/ebay",
      headers: {},
      rawBody: fixture("account_deletion.json"),
    });
    expect(res).toEqual({
      valid: false,
      externalEventId: "49feeaeb-4982-42d9-9e4d-6a8c5f1e0e99",
      topic: "MARKETPLACE_ACCOUNT_DELETION",
    });
  });

  it("parseInbound maps ORDER_CONFIRMATION line items to sales and ignores account deletion", async () => {
    const { c } = connector({});
    const payload = JSON.parse(fixture("order_confirmation.json"));
    const events = await c.parseInbound(payload, "ORDER_CONFIRMATION");
    expect(events).toEqual([
      {
        type: "sale",
        externalOrderId: "12-34567-89012",
        externalLineId: "10045678901234",
        externalListingId: "110556789012",
        quantity: 2,
        unitPrice: { amountMinor: 2499, currency: "GBP" },
        occurredAt: "2026-09-10T14:03:11.000Z",
      },
    ]);
    expect(await c.parseInbound(JSON.parse(fixture("account_deletion.json")), "MARKETPLACE_ACCOUNT_DELETION")).toEqual(
      [],
    );
  });

  it("parseInbound returns nothing for an order notification without line items, and exposes the order id", async () => {
    const { c } = connector({});
    const payload = JSON.parse(fixture("order_confirmation.json"));
    payload.notification.data = { orderId: "12-34567-89012" };
    expect(await c.parseInbound(payload, "ORDER_CONFIRMATION")).toEqual([]);
    expect(orderIdFromNotification(payload)).toBe("12-34567-89012");
    expect(orderIdFromNotification({ nope: true })).toBeNull();
  });
});

describe("eBay misc", () => {
  it("healthCheck calls the account privilege endpoint", async () => {
    const { c, calls } = connector({
      "GET /sell/account/v1/privilege": () => json(JSON.stringify({ sellingLimit: {} })),
    });
    const res = await c.healthCheck(account);
    expect(res.ok).toBe(true);
    expect(res.checkedAt).toBe(NOW.toISOString());
    expect(calls[0].url).toBe("https://api.sandbox.ebay.com/sell/account/v1/privilege");
  });

  it("createListing and updateListing are terminal not_implemented with a seller message", async () => {
    const { c } = connector({});
    const created = await c.createListing(account, {});
    expect(created.kind).toBe("terminal");
    if (created.kind === "terminal") expect(created.code).toBe("ebay.not_implemented");
    const updated = await c.updateListing(account, inventoryListing, {});
    expect(updated.kind).toBe("terminal");
  });

  it("uses production hosts when configured", () => {
    const { c } = connector({}, { env: "production" });
    expect(c.buildAuthorizeUrl({ workspaceId: "ws" as WorkspaceId, state: "s", redirectUri: "" }).origin).toBe(
      "https://auth.ebay.com",
    );
  });
});
