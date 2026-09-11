import { randomUUID } from "node:crypto";
import postgres from "postgres";

export const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Superuser connection: bypasses RLS, stands in for the service role in tests. */
export const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });

export async function createUser(): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      ${`${id}@test.local`}, '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false)`;
  return id;
}

/** Run a callback as the `authenticated` role with the given user's JWT claims, inside one transaction. */
export async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx): Promise<T> => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}

export async function createWorkspaceFor(userId: string): Promise<string> {
  const slug = `ws-${randomUUID().slice(0, 8)}`;
  const rows = await asUser(
    userId,
    (tx) => tx<{ create_workspace: string }[]>`select public.create_workspace(${"Test " + slug}, ${slug})`,
  );
  return rows[0].create_workspace;
}

export interface Fixture {
  workspaceId: string;
  productId: string;
  skuId: string;
  accounts: Record<string, string>;
  listings: Record<string, string>;
}

/** A product with one SKU, listed on three channel accounts, all managed, active and sync-enabled. */
export async function createListedProduct(
  workspaceId: string,
  itemType: "unique" | "stocked",
  channels = ["ebay", "depop", "vinted"],
): Promise<Fixture> {
  const [product] = await sql<{ id: string }[]>`
    insert into public.products (workspace_id, item_type, title, base_price_minor)
    values (${workspaceId}, ${itemType}, ${`Test ${itemType} ${randomUUID().slice(0, 6)}`}, 2500) returning id`;
  const [sku] = await sql<{ id: string }[]>`
    insert into public.skus (workspace_id, product_id, sku) values (${workspaceId}, ${product.id}, ${`SKU-${randomUUID().slice(0, 8)}`}) returning id`;
  const accounts: Record<string, string> = {};
  const listings: Record<string, string> = {};
  for (const ch of channels) {
    const [acc] = await sql<{ id: string }[]>`
      insert into public.channel_accounts (workspace_id, channel, external_account_id, display_name, marketplace, status, sync_enabled)
      values (${workspaceId}, ${ch}, ${`${ch}-${randomUUID().slice(0, 6)}`}, ${ch}, 'GB', 'healthy', true) returning id`;
    accounts[ch] = acc.id;
    const [l] = await sql<{ id: string }[]>`
      insert into public.channel_listings (workspace_id, channel_account_id, sku_id, external_listing_id, status, managed, desired_quantity)
      values (${workspaceId}, ${acc.id}, ${sku.id}, ${`ext-${randomUUID().slice(0, 8)}`}, 'active', true, 1) returning id`;
    listings[ch] = l.id;
  }
  return { workspaceId, productId: product.id, skuId: sku.id, accounts, listings };
}

export interface ApplyResult {
  duplicate: boolean;
  event_seq: number;
  on_hand: number;
  job_ids: string[];
  incident_id: string | null;
}

export async function apply(
  db: postgres.Sql | postgres.TransactionSql,
  input: {
    workspaceId: string;
    skuId: string;
    kind: string;
    delta: number;
    key: string;
    source?: string | null;
    actor?: string;
  },
): Promise<ApplyResult> {
  const rows = await db<{ apply_ledger_event: ApplyResult }[]>`
    select public.apply_ledger_event(${input.workspaceId}, ${input.skuId}, ${input.kind}, ${input.delta}, ${input.key},
      ${input.actor ?? "test"}, ${input.source ?? null}, null, now(), '{}'::jsonb)`;
  return rows[0].apply_ledger_event;
}
