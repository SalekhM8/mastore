import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeConnector } from "@/connectors/fake";
import { upsertConnectedAccount } from "@/db/channel-accounts";
import { db } from "@/db/client";
import { insertWebhookReceipt } from "@/db/webhook-events";
import { setConnector } from "@/jobs/connectors";
import { processInbound } from "@/jobs/inbound";
import { runPushJob } from "@/jobs/push";
import { reconcileListingsForAccount } from "@/jobs/reconcile";
import { processWebhookReceipt } from "@/jobs/webhook-ingest";
import { apply, createListedProduct, createUser, createWorkspaceFor, sql } from "./setup";

/**
 * The job tier end to end against real Postgres with the in-memory connector:
 * inbound sale -> ledger -> push job -> connector call -> listing updated -> activity logged.
 */

let userA: string;
let wsA: string;
let fake: FakeConnector;

async function connectedAccount(workspaceId: string, externalAccountId: string) {
  const id = await upsertConnectedAccount({
    workspaceId,
    channel: "storefront",
    externalAccountId,
    displayName: "Fake store",
    marketplace: "GB",
    bundle: { accessToken: "tok", scopes: [] },
  });
  await sql`update public.channel_accounts set sync_enabled = true, status = 'healthy' where id = ${id}`;
  return id;
}

async function listingOn(
  workspaceId: string,
  accountId: string,
  skuId: string,
  externalListingId: string,
  title: string,
) {
  const [row] = await sql<{ id: string }[]>`
    insert into public.channel_listings (workspace_id, channel_account_id, sku_id, external_listing_id, status, managed, desired_quantity, title_snapshot)
    values (${workspaceId}, ${accountId}, ${skuId}, ${externalListingId}, 'active', true, 1, ${title}) returning id`;
  return row?.id as string;
}

async function accountRow(id: string) {
  const [row] = await sql`select * from public.channel_accounts where id = ${id}`;
  return row as never;
}

beforeAll(async () => {
  userA = await createUser();
  wsA = await createWorkspaceFor(userA);
});
beforeEach(() => {
  fake = new FakeConnector();
  setConnector("storefront", fake);
});
afterAll(async () => {
  setConnector("storefront", null);
  await db().end();
  await sql.end();
});

describe("inbound sale through to push", () => {
  it("a sale on one storefront account delists the item on another and logs it", async () => {
    const f = await createListedProduct(wsA, "unique", []);
    const source = await connectedAccount(wsA, "store-src");
    const target = await connectedAccount(wsA, "store-dst");
    await listingOn(wsA, source, f.skuId, "src-1", "Nike Air Max");
    const targetListing = await listingOn(wsA, target, f.skuId, "dst-1", "Nike Air Max");
    await apply(sql, { workspaceId: wsA, skuId: f.skuId, kind: "import_baseline", delta: 1, key: `base:${f.skuId}` });

    const summary = await processInbound(
      await accountRow(source),
      [
        {
          type: "sale",
          externalOrderId: "o1",
          externalLineId: "l1",
          externalListingId: "src-1",
          quantity: 1,
          unitPrice: { amountMinor: 2500, currency: "GBP" },
          occurredAt: new Date().toISOString(),
        },
      ],
      "webhook",
    );
    expect(summary).toMatchObject({ applied: 1, duplicates: 0, unmatched: 0 });

    const jobs =
      await sql`select id, kind, status from public.push_jobs where channel_listing_id = ${targetListing} order by created_at`;
    // The import baseline queued a stock push; the sale's delist makes it stale.
    expect(jobs.map((j) => [j.kind, j.status])).toEqual([
      ["stock", "superseded"],
      ["delist", "queued"],
    ]);
    const delist = jobs[1];

    const outcome = await runPushJob("storefront", delist?.id as string);
    expect(outcome).toEqual({ outcome: "succeeded" });
    expect(fake.pushed).toEqual([{ op: "delist", externalListingId: "dst-1", value: 0 }]);

    const [l] =
      await sql`select status, pushed_quantity, applied_ledger_seq from public.channel_listings where id = ${targetListing}`;
    expect(l?.status).toBe("ended");
    expect(l?.pushed_quantity).toBe(0);
    expect(Number(l?.applied_ledger_seq)).toBeGreaterThan(0);

    const activity =
      await sql`select message, level from public.activity_log where workspace_id = ${wsA} and sku_id = ${f.skuId} order by created_at`;
    expect(activity.map((a) => a.message)).toEqual([
      expect.stringContaining("1 sold, stock now 0"),
      expect.stringContaining("Nike Air Max ended after stock reached 0"),
    ]);
  });

  it("the same sale processed twice is a duplicate and creates no second push", async () => {
    const f = await createListedProduct(wsA, "stocked", []);
    const source = await connectedAccount(wsA, "store-src2");
    const target = await connectedAccount(wsA, "store-dst2");
    await listingOn(wsA, source, f.skuId, "src-2", "Tee");
    const targetListing = await listingOn(wsA, target, f.skuId, "dst-2", "Tee");
    await apply(sql, { workspaceId: wsA, skuId: f.skuId, kind: "import_baseline", delta: 5, key: `base:${f.skuId}` });
    const sale = {
      type: "sale" as const,
      externalOrderId: "o2",
      externalLineId: "l1",
      externalListingId: "src-2",
      quantity: 2,
      unitPrice: { amountMinor: 900, currency: "GBP" as const },
      occurredAt: new Date().toISOString(),
    };
    const first = await processInbound(await accountRow(source), [sale], "webhook");
    const second = await processInbound(await accountRow(source), [sale], "poll");
    expect(first.applied).toBe(1);
    expect(second).toMatchObject({ applied: 0, duplicates: 1 });
    const jobs =
      await sql`select desired from public.push_jobs where channel_listing_id = ${targetListing} and status = 'queued'`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.desired).toEqual({ quantity: 3 });
  });

  it("a sale for an unknown listing raises an unmatched_sale incident and touches no stock", async () => {
    const source = await connectedAccount(wsA, "store-src3");
    const summary = await processInbound(
      await accountRow(source),
      [
        {
          type: "sale",
          externalOrderId: "o3",
          externalLineId: "l1",
          externalListingId: "nope",
          quantity: 1,
          unitPrice: { amountMinor: 100, currency: "GBP" },
          occurredAt: new Date().toISOString(),
        },
      ],
      "webhook",
    );
    expect(summary.unmatched).toBe(1);
    const inc =
      await sql`select kind from public.incidents where workspace_id = ${wsA} and channel_account_id = ${source}`;
    expect(inc.map((i) => i.kind)).toContain("unmatched_sale");
  });
});

describe("push retry policy against the database", () => {
  async function queuedJobFor(externalAccount: string) {
    const f = await createListedProduct(wsA, "stocked", []);
    const target = await connectedAccount(wsA, externalAccount);
    const listing = await listingOn(wsA, target, f.skuId, `l-${externalAccount}`, "Jacket");
    const r = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "restock",
      delta: 4,
      key: `restock:${f.skuId}`,
    });
    expect(r.job_ids).toHaveLength(1);
    return { jobId: r.job_ids[0] as string, listing, target, skuId: f.skuId };
  }

  it("a retryable failure schedules a retry and keeps the attempt count", async () => {
    const { jobId } = await queuedJobFor("store-r1");
    fake.failOnce({ kind: "retryable", message: "503 from channel" });
    const out = await runPushJob("storefront", jobId);
    expect(out.outcome).toBe("failed");
    const [j] =
      await sql`select status, attempts, next_attempt_at, last_error from public.push_jobs where id = ${jobId}`;
    expect(j?.status).toBe("failed");
    expect(j?.attempts).toBe(1);
    expect(new Date(j?.next_attempt_at as string).getTime()).toBeGreaterThan(Date.now());
    // Not due yet, so it cannot be claimed again.
    expect(await runPushJob("storefront", jobId)).toEqual({ outcome: "skipped", reason: "not_claimable" });
  });

  it("a terminal rejection kills the job, marks the listing and raises an incident", async () => {
    const { jobId, listing } = await queuedJobFor("store-r2");
    fake.failOnce({ kind: "terminal", code: "ended", messageForSeller: "Listing has ended on the channel." });
    const out = await runPushJob("storefront", jobId);
    expect(out).toEqual({ outcome: "dead", sideEffect: "listing_error" });
    const [l] = await sql`select status from public.channel_listings where id = ${listing}`;
    expect(l?.status).toBe("error");
    const inc = await sql`select kind from public.incidents where channel_listing_id = ${listing}`;
    expect(inc.map((i) => i.kind)).toEqual(["push_dead"]);
  });

  it("auth revoked stops the account", async () => {
    const { jobId, target } = await queuedJobFor("store-r3");
    fake.failOnce({ kind: "auth_revoked", message: "token invalid" });
    const out = await runPushJob("storefront", jobId);
    expect(out).toEqual({ outcome: "dead", sideEffect: "account_auth_revoked" });
    const [a] = await sql`select status from public.channel_accounts where id = ${target}`;
    expect(a?.status).toBe("auth_revoked");
  });

  it("a job whose SKU has moved on is superseded without calling the channel", async () => {
    const { jobId, skuId } = await queuedJobFor("store-r4");
    // Park the job as a failed attempt awaiting retry, then move the SKU on so a newer job exists.
    await sql`update public.push_jobs set status = 'failed', attempts = 1, next_attempt_at = now() where id = ${jobId}`;
    await apply(sql, { workspaceId: wsA, skuId, kind: "sale", delta: -1, key: `sale:${skuId}` });
    const out = await runPushJob("storefront", jobId);
    expect(out).toEqual({ outcome: "superseded" });
    expect(fake.pushed).toEqual([]);
  });

  it("the kill switch leaves the job queued and untouched", async () => {
    const { jobId } = await queuedJobFor("store-r5");
    await sql`update public.connector_switches set push_enabled = false where channel = 'storefront'`;
    try {
      expect(await runPushJob("storefront", jobId)).toEqual({ outcome: "skipped", reason: "kill_switch" });
      const [j] = await sql`select status, attempts from public.push_jobs where id = ${jobId}`;
      expect(j).toEqual({ status: "queued", attempts: 0 });
    } finally {
      await sql`update public.connector_switches set push_enabled = true where channel = 'storefront'`;
    }
  });
});

describe("webhook receipt processing", () => {
  const evt_bad = `evt-bad-${randomUUID()}`;
  const evt_ok = `evt-ok-${randomUUID()}`;
  const evt_dup = `evt-dup-${randomUUID()}`;
  it("a receipt with a bad signature is rejected and never reaches the ledger", async () => {
    const id = await insertWebhookReceipt({
      channel: "storefront",
      externalEventId: evt_bad,
      headers: { "x-fake-signature": "nope" },
      body: JSON.stringify({ id: evt_bad, topic: "sale", events: [] }),
    });
    expect(id).not.toBeNull();
    const r = await processWebhookReceipt(id as string);
    expect(r.status).toBe("rejected");
  });

  it("a valid receipt without an account identifier is left for the order poll", async () => {
    const id = await insertWebhookReceipt({
      channel: "storefront",
      externalEventId: evt_ok,
      headers: { "x-fake-signature": "valid" },
      body: JSON.stringify({ id: evt_ok, topic: "sale", events: [] }),
    });
    const r = await processWebhookReceipt(id as string);
    expect(r).toMatchObject({ status: "unmatched", detail: "no_account_in_payload" });
  });

  it("a duplicate delivery is a no-op at the receipt", async () => {
    const body = JSON.stringify({ id: evt_dup, topic: "sale", events: [] });
    const first = await insertWebhookReceipt({ channel: "storefront", externalEventId: evt_dup, headers: {}, body });
    const second = await insertWebhookReceipt({ channel: "storefront", externalEventId: evt_dup, headers: {}, body });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});

describe("listing reconciliation", () => {
  it("corrects a listing the channel shows higher than the ledger, at top priority", async () => {
    const f = await createListedProduct(wsA, "stocked", []);
    const acct = await connectedAccount(wsA, "store-rec1");
    const listing = await listingOn(wsA, acct, f.skuId, "rec-1", "Bag");
    await apply(sql, { workspaceId: wsA, skuId: f.skuId, kind: "import_baseline", delta: 2, key: `base:${f.skuId}` });
    // Baseline pushes are queued; mark them applied so nothing is "in flight".
    await sql`update public.push_jobs set status = 'succeeded' where channel_listing_id = ${listing}`;
    await sql`update public.channel_listings set applied_ledger_seq = (select last_event_seq from public.sku_stock where sku_id = ${f.skuId}), desired_quantity = 2 where id = ${listing}`;
    fake.seedRemote("rec-1", 7);

    const r = await reconcileListingsForAccount(await accountRow(acct));
    expect(r).toEqual({ checked: 1, drift: 1, corrected: 1 });
    const jobs =
      await sql`select kind, priority, desired, status from public.push_jobs where channel_listing_id = ${listing} and status = 'queued'`;
    expect(jobs).toEqual([{ kind: "stock", priority: 0, desired: { quantity: 2 }, status: "queued" }]);
    const [l] = await sql`select remote_quantity from public.channel_listings where id = ${listing}`;
    expect(l?.remote_quantity).toBe(7);
  });
});

describe("listing import", () => {
  it("turns remote listings into unmanaged products with baseline stock, and re-running changes nothing", async () => {
    const { runImport } = await import("@/jobs/import");
    const acct = await connectedAccount(wsA, "store-import1");
    fake.seedRemote("imp-1", 1);
    fake.seedRemote("imp-2", 4);
    const first = await runImport(await accountRow(acct));
    expect(first).toMatchObject({ pages: 1, seen: 2, created: 2, linked: 0, baselined: 2 });
    const listings =
      await sql`select managed, status, remote_quantity, sku_id from public.channel_listings where channel_account_id = ${acct} order by external_listing_id`;
    expect(listings.map((l) => [l.managed, l.status, l.remote_quantity])).toEqual([
      [false, "active", 1],
      [false, "active", 4],
    ]);
    const stock =
      await sql`select ss.on_hand, p.item_type from public.sku_stock ss join public.skus s on s.id = ss.sku_id join public.products p on p.id = s.product_id where ss.sku_id in ${sql(listings.map((l) => l.sku_id as string))} order by ss.on_hand`;
    expect(stock.map((r) => [r.on_hand, r.item_type])).toEqual([
      [1, "unique"],
      [4, "stocked"],
    ]);
    const jobs = await sql`select count(*)::int as n from public.push_jobs where channel_account_id = ${acct}`;
    expect(jobs[0]?.n).toBe(0);

    const second = await runImport(await accountRow(acct));
    expect(second).toMatchObject({ seen: 2, created: 0, linked: 2, baselined: 0 });
  });
});
