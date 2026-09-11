import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apply, asUser, createListedProduct, createUser, createWorkspaceFor, sql } from "./setup";

let userA: string;
let userB: string;
let wsA: string;
let wsB: string;

beforeAll(async () => {
  userA = await createUser();
  userB = await createUser();
  wsA = await createWorkspaceFor(userA);
  wsB = await createWorkspaceFor(userB);
});
afterAll(async () => {
  await sql.end();
});

describe("apply_ledger_event: unique item", () => {
  it("a sale on eBay sets on-hand to 0 and queues a delist on every other channel, priority 0", async () => {
    const f = await createListedProduct(wsA, "unique");
    await apply(sql, { workspaceId: wsA, skuId: f.skuId, kind: "import_baseline", delta: 1, key: `base:${f.skuId}` });
    const r = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "sale",
      delta: -1,
      key: `ebay:acc:orderline:1:sale:${f.skuId}`,
      source: f.accounts.ebay,
    });
    expect(r.duplicate).toBe(false);
    expect(r.on_hand).toBe(0);
    expect(r.incident_id).toBeNull();
    const jobs =
      await sql`select channel_listing_id, kind, priority, desired from public.push_jobs where id = any(${r.job_ids}::uuid[])`;
    expect(jobs.map((j) => j.channel_listing_id).sort()).toEqual([f.listings.depop, f.listings.vinted].sort());
    expect(jobs.every((j) => j.kind === "delist" && j.priority === 0 && j.desired.quantity === 0)).toBe(true);
    const [stock] = await sql`select on_hand, last_event_seq from public.sku_stock where sku_id = ${f.skuId}`;
    expect(stock.on_hand).toBe(0);
    expect(Number(stock.last_event_seq)).toBe(Number(r.event_seq));
  });

  it("the same webhook delivered twice records one event and creates no second job", async () => {
    const f = await createListedProduct(wsA, "unique");
    await apply(sql, { workspaceId: wsA, skuId: f.skuId, kind: "import_baseline", delta: 1, key: `base:${f.skuId}` });
    const key = `ebay:acc:orderline:dup:sale:${f.skuId}`;
    const first = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "sale",
      delta: -1,
      key,
      source: f.accounts.ebay,
    });
    const second = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "sale",
      delta: -1,
      key,
      source: f.accounts.ebay,
    });
    expect(second.duplicate).toBe(true);
    expect(second.event_seq).toBe(first.event_seq);
    expect(second.on_hand).toBe(0);
    expect(second.job_ids).toEqual([]);
    const [{ count }] =
      await sql`select count(*)::int as count from public.ledger_events where sku_id = ${f.skuId} and kind = 'sale'`;
    expect(count).toBe(1);
  });

  it("a second sale on another channel after stock hit zero is recorded and raises an oversell incident", async () => {
    const f = await createListedProduct(wsA, "unique");
    await apply(sql, { workspaceId: wsA, skuId: f.skuId, kind: "import_baseline", delta: 1, key: `base:${f.skuId}` });
    await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "sale",
      delta: -1,
      key: `ebay:1:${f.skuId}`,
      source: f.accounts.ebay,
    });
    const r = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "sale",
      delta: -1,
      key: `depop:1:${f.skuId}`,
      source: f.accounts.depop,
    });
    expect(r.on_hand).toBe(-1);
    expect(r.incident_id).not.toBeNull();
    const [inc] =
      await sql`select kind, severity, sku_id, channel_account_id, status from public.incidents where id = ${r.incident_id}`;
    expect(inc.kind).toBe("oversell");
    expect(inc.severity).toBe(1);
    expect(inc.channel_account_id).toBe(f.accounts.depop);
    // A third sale does not raise a second incident for the same crossing.
    const r3 = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "sale",
      delta: -1,
      key: `vinted:1:${f.skuId}`,
      source: f.accounts.vinted,
    });
    expect(r3.incident_id).toBeNull();
  });
});

describe("apply_ledger_event: stocked item", () => {
  it("a sale decrements everywhere else with a stock job carrying the new quantity", async () => {
    const f = await createListedProduct(wsA, "stocked");
    await apply(sql, { workspaceId: wsA, skuId: f.skuId, kind: "import_baseline", delta: 10, key: `base:${f.skuId}` });
    const r = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "sale",
      delta: -3,
      key: `ebay:s1:${f.skuId}`,
      source: f.accounts.ebay,
    });
    expect(r.on_hand).toBe(7);
    const jobs = await sql`select kind, desired from public.push_jobs where id = any(${r.job_ids}::uuid[])`;
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.kind === "stock" && j.desired.quantity === 7)).toBe(true);
    const [l] = await sql`select desired_quantity from public.channel_listings where id = ${f.listings.depop}`;
    expect(l.desired_quantity).toBe(7);
  });

  it("rapid sales coalesce into one queued job per listing carrying the latest quantity and sequence", async () => {
    const f = await createListedProduct(wsA, "stocked");
    await apply(sql, { workspaceId: wsA, skuId: f.skuId, kind: "import_baseline", delta: 10, key: `base:${f.skuId}` });
    const r1 = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "sale",
      delta: -1,
      key: `ebay:c1:${f.skuId}`,
      source: f.accounts.ebay,
    });
    const r2 = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "sale",
      delta: -1,
      key: `ebay:c2:${f.skuId}`,
      source: f.accounts.ebay,
    });
    expect(r2.job_ids.sort()).toEqual(r1.job_ids.sort());
    const jobs =
      await sql`select status, desired, ledger_seq from public.push_jobs where channel_listing_id = ${f.listings.depop}`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");
    expect(jobs[0].desired.quantity).toBe(8);
    expect(Number(jobs[0].ledger_seq)).toBe(Number(r2.event_seq));
  });

  it("a manual restock with no source pushes to every channel including the one that usually sells", async () => {
    const f = await createListedProduct(wsA, "stocked");
    const r = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "restock",
      delta: 5,
      key: `user:u:sku:${f.skuId}:restock:c1`,
      actor: `user:${userA}`,
    });
    expect(r.on_hand).toBe(5);
    expect(r.job_ids).toHaveLength(3);
    const jobs = await sql`select priority from public.push_jobs where id = any(${r.job_ids}::uuid[])`;
    expect(jobs.every((j) => j.priority === 3)).toBe(true);
  });

  it("listings that are unmanaged, ended, or on a sync-disabled account are never pushed to", async () => {
    const f = await createListedProduct(wsA, "stocked");
    await sql`update public.channel_listings set managed = false where id = ${f.listings.depop}`;
    await sql`update public.channel_accounts set sync_enabled = false where id = ${f.accounts.vinted}`;
    const r = await apply(sql, {
      workspaceId: wsA,
      skuId: f.skuId,
      kind: "restock",
      delta: 2,
      key: `restock:${f.skuId}`,
    });
    const jobs = await sql`select channel_listing_id from public.push_jobs where id = any(${r.job_ids}::uuid[])`;
    expect(jobs.map((j) => j.channel_listing_id)).toEqual([f.listings.ebay]);
  });
});

describe("tenant isolation and append-only", () => {
  it("a member of workspace B cannot see or move stock in workspace A", async () => {
    const f = await createListedProduct(wsA, "stocked");
    const visible = await asUser(userB, (tx) => tx`select id from public.products where workspace_id = ${wsA}`);
    expect(visible).toHaveLength(0);
    await expect(
      asUser(userB, (tx) =>
        apply(tx, { workspaceId: wsA, skuId: f.skuId, kind: "restock", delta: 1, key: `evil:${f.skuId}` }),
      ),
    ).rejects.toThrow(/not found/);
    const mine = await asUser(userA, (tx) => tx`select id from public.products where workspace_id = ${wsA}`);
    expect(mine.length).toBeGreaterThan(0);
    const theirs = await asUser(userB, (tx) => tx`select id from public.products where workspace_id = ${wsB}`);
    expect(theirs).toHaveLength(0);
  });

  it("the owner can move stock through the function as the authenticated role", async () => {
    const f = await createListedProduct(wsA, "stocked");
    const r = await asUser(userA, (tx) =>
      apply(tx, {
        workspaceId: wsA,
        skuId: f.skuId,
        kind: "restock",
        delta: 4,
        key: `own:${f.skuId}`,
        actor: `user:${userA}`,
      }),
    );
    expect(r.on_hand).toBe(4);
  });

  it("credentials are unreadable from the browser role even by the owner", async () => {
    await createListedProduct(wsA, "stocked");
    await expect(
      asUser(userA, (tx) => tx`select credentials_ciphertext from public.channel_accounts where workspace_id = ${wsA}`),
    ).rejects.toThrow(/permission denied/);
    const ok = await asUser(
      userA,
      (tx) => tx`select id, channel, status from public.channel_accounts where workspace_id = ${wsA}`,
    );
    expect(ok.length).toBeGreaterThan(0);
  });

  it("ledger events cannot be updated or deleted by anyone", async () => {
    const f = await createListedProduct(wsA, "stocked");
    await apply(sql, { workspaceId: wsA, skuId: f.skuId, kind: "restock", delta: 1, key: `ao:${f.skuId}` });
    await expect(sql`update public.ledger_events set quantity_delta = 99 where sku_id = ${f.skuId}`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from public.ledger_events where sku_id = ${f.skuId}`).rejects.toThrow(/append-only/);
    await expect(
      asUser(userA, (tx) => tx`update public.ledger_events set quantity_delta = 99 where sku_id = ${f.skuId}`),
    ).rejects.toThrow(/permission denied|append-only/);
  });
});
