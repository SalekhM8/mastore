-- Sync: core schema. Source of truth: docs/architecture-and-data-model.md
-- Conventions: lowercase snake_case, uuid v7 ids, timestamptz, integer minor units for money,
-- workspace_id on every tenant table, RLS on every tenant table in this same migration.

-------------------------------------------------------------------------------
-- 0. Schemas and helpers
-------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Time-ordered UUID v7 (RFC 9562). No extension dependency.
create or replace function private.uuid_v7() returns uuid
language plpgsql volatile as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms = substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  uuid_bytes = uuid_send(gen_random_uuid());
  uuid_bytes = overlay(uuid_bytes placing unix_ts_ms from 1 for 6);
  uuid_bytes = set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  return encode(uuid_bytes, 'hex')::uuid;
end
$$;
grant execute on function private.uuid_v7() to authenticated, service_role;

create or replace function private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Append-only guard for ledger tables.
create or replace function private.reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'table % is append-only', tg_table_name using errcode = 'P0001';
end
$$;

-------------------------------------------------------------------------------
-- 1. Identity and tenancy
-------------------------------------------------------------------------------
create table public.workspaces (
  id                     uuid primary key default private.uuid_v7(),
  name                   text not null check (char_length(name) between 1 and 120),
  slug                   text not null unique,
  currency               char(3) not null default 'GBP',
  vat_registered         boolean not null default false,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  billing_status         text not null default 'trialing'
                         check (billing_status in ('trialing','active','past_due','cancelled','paused')),
  trial_ends_at          timestamptz,
  founding_price_lock    boolean not null default false,
  settings               jsonb not null default '{}'::jsonb,
  feature_flags          jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);
create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function private.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner','member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- Tenant membership check used by every RLS policy. Wrapped in (select ...) at call sites
-- so it is evaluated once per statement.
create or replace function private.is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function private.is_workspace_member(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated, service_role;

create or replace function private.is_workspace_owner(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;
revoke execute on function private.is_workspace_owner(uuid) from public, anon;
grant execute on function private.is_workspace_owner(uuid) to authenticated, service_role;


alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy workspaces_select on public.workspaces for select to authenticated
  using ((select private.is_workspace_member(id)));
create policy workspaces_update on public.workspaces for update to authenticated
  using ((select private.is_workspace_owner(id)))
  with check ((select private.is_workspace_owner(id)));
-- Inserts happen only through create_workspace() below.

create policy workspace_members_select on public.workspace_members for select to authenticated
  using ((select private.is_workspace_member(workspace_id)));
create policy workspace_members_manage on public.workspace_members for all to authenticated
  using ((select private.is_workspace_owner(workspace_id)))
  with check ((select private.is_workspace_owner(workspace_id)));

-- Creates a workspace and makes the caller its owner in one transaction.
create or replace function public.create_workspace(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.workspaces (name, slug, trial_ends_at)
  values (p_name, p_slug, now() + interval '14 days')
  returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_id, v_user, 'owner');
  return v_id;
end
$$;
revoke execute on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;

-------------------------------------------------------------------------------
-- 2. Catalog
-------------------------------------------------------------------------------
create table public.products (
  id                    uuid primary key default private.uuid_v7(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  item_type             text not null check (item_type in ('unique','stocked')),
  title                 text not null check (char_length(title) between 1 and 300),
  description           text not null default '',
  brand                 text,
  category_path         text,
  condition             text check (condition in ('new','new_other','refurbished','used_like_new','used_very_good','used_good','used_acceptable','for_parts')),
  attributes            jsonb not null default '{}'::jsonb,
  base_price_minor      bigint not null check (base_price_minor >= 0),
  currency              char(3) not null default 'GBP',
  cost_minor            bigint check (cost_minor is null or cost_minor >= 0),
  default_postage_minor bigint check (default_postage_minor is null or default_postage_minor >= 0),
  status                text not null default 'draft' check (status in ('draft','active','archived')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index products_workspace_status_idx on public.products (workspace_id, status) where deleted_at is null;
create index products_workspace_updated_idx on public.products (workspace_id, updated_at desc);
create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

create table public.skus (
  id                  uuid primary key default private.uuid_v7(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete cascade,
  sku                 text not null check (char_length(sku) between 1 and 80),
  barcode             text,
  option_values       jsonb not null default '{}'::jsonb,
  price_override_minor bigint check (price_override_minor is null or price_override_minor >= 0),
  cost_override_minor  bigint check (cost_override_minor is null or cost_override_minor >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (workspace_id, sku)
);
create index skus_product_id_idx on public.skus (product_id);
create trigger skus_updated_at before update on public.skus
  for each row execute function private.set_updated_at();

create table public.product_photos (
  id           uuid primary key default private.uuid_v7(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  position     smallint not null default 0,
  storage_path text not null,
  width        integer,
  height       integer,
  bytes        integer,
  sha256       text,
  created_at   timestamptz not null default now(),
  unique (product_id, position)
);
create index product_photos_workspace_sha_idx on public.product_photos (workspace_id, sha256);

-------------------------------------------------------------------------------
-- 3. Channels
-------------------------------------------------------------------------------
create table public.channel_accounts (
  id                     uuid primary key default private.uuid_v7(),
  workspace_id           uuid not null references public.workspaces(id) on delete cascade,
  channel                text not null check (channel in ('ebay','amazon','tiktok','vinted','depop','etsy','onbuy','storefront')),
  external_account_id    text not null,
  display_name           text not null,
  marketplace            text not null,
  credentials_ciphertext bytea,
  credentials_key_id     text,
  token_expires_at       timestamptz,
  scopes                 text[] not null default '{}',
  status                 text not null default 'connecting'
                         check (status in ('connecting','healthy','degraded','auth_revoked','disconnected')),
  sync_enabled           boolean not null default false,
  account_settings       jsonb not null default '{}'::jsonb,
  last_health_check_at   timestamptz,
  last_inbound_at        timestamptz,
  last_outbound_at       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  unique (workspace_id, channel, external_account_id)
);
create index channel_accounts_workspace_idx on public.channel_accounts (workspace_id) where deleted_at is null;
create trigger channel_accounts_updated_at before update on public.channel_accounts
  for each row execute function private.set_updated_at();

create table public.channel_listings (
  id                   uuid primary key default private.uuid_v7(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id   uuid not null references public.channel_accounts(id) on delete cascade,
  sku_id               uuid references public.skus(id) on delete set null,
  external_listing_id  text not null,
  external_ids         jsonb not null default '{}'::jsonb,
  listing_model        text check (listing_model is null or listing_model in ('inventory','trading')),
  status               text not null default 'draft'
                       check (status in ('draft','pending','active','ended','error','unmanaged')),
  managed              boolean not null default false,
  price_minor          bigint check (price_minor is null or price_minor >= 0),
  desired_quantity     integer not null default 0 check (desired_quantity >= 0),
  pushed_quantity      integer,
  pushed_at            timestamptz,
  remote_quantity      integer,
  remote_checked_at    timestamptz,
  applied_ledger_seq   bigint not null default 0,
  last_error           jsonb,
  channel_payload      jsonb not null default '{}'::jsonb,
  title_snapshot       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (channel_account_id, external_listing_id)
);
create unique index channel_listings_account_sku_uidx on public.channel_listings (channel_account_id, sku_id) where sku_id is not null;
create index channel_listings_sku_idx on public.channel_listings (sku_id);
create index channel_listings_workspace_idx on public.channel_listings (workspace_id, status);
create index channel_listings_drift_idx on public.channel_listings (workspace_id)
  where remote_quantity is not null and desired_quantity is distinct from remote_quantity;
create trigger channel_listings_updated_at before update on public.channel_listings
  for each row execute function private.set_updated_at();

create table public.channel_taxonomies (
  id          uuid primary key default private.uuid_v7(),
  channel     text not null,
  marketplace text not null,
  version     text not null,
  fetched_at  timestamptz not null default now(),
  payload     jsonb not null,
  unique (channel, marketplace, version)
);

create table public.channel_category_mappings (
  id                   uuid primary key default private.uuid_v7(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  channel              text not null,
  category_path        text not null,
  external_category_id text not null,
  aspect_defaults      jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  unique (workspace_id, channel, category_path)
);

-------------------------------------------------------------------------------
-- 4. The stock ledger
-------------------------------------------------------------------------------
create table public.ledger_events (
  seq                       bigint generated always as identity primary key,
  id                        uuid not null default private.uuid_v7() unique,
  workspace_id              uuid not null references public.workspaces(id) on delete cascade,
  sku_id                    uuid not null references public.skus(id) on delete cascade,
  kind                      text not null
                            check (kind in ('sale','cancellation','return','restock','manual_adjust','import_baseline','correction')),
  quantity_delta            integer not null check (quantity_delta <> 0),
  source_channel_account_id uuid references public.channel_accounts(id) on delete set null,
  order_line_id             uuid,
  idempotency_key           text not null,
  occurred_at               timestamptz not null default now(),
  recorded_at               timestamptz not null default now(),
  actor                     text not null,
  metadata                  jsonb not null default '{}'::jsonb,
  unique (workspace_id, idempotency_key)
);
create index ledger_events_sku_seq_idx on public.ledger_events (sku_id, seq);
create index ledger_events_workspace_recorded_idx on public.ledger_events (workspace_id, recorded_at desc);
create index ledger_events_source_account_idx on public.ledger_events (source_channel_account_id);
create trigger ledger_events_append_only before update or delete on public.ledger_events
  for each row execute function private.reject_mutation();

create table public.sku_stock (
  sku_id         uuid primary key references public.skus(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  on_hand        integer not null default 0,
  last_event_seq bigint not null default 0,
  updated_at     timestamptz not null default now()
);
create index sku_stock_workspace_idx on public.sku_stock (workspace_id);

-------------------------------------------------------------------------------
-- 5. Orders
-------------------------------------------------------------------------------
create table public.orders (
  id                     uuid primary key default private.uuid_v7(),
  workspace_id           uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id     uuid not null references public.channel_accounts(id) on delete cascade,
  external_order_id      text not null,
  status                 text not null
                         check (status in ('created','paid','shipped','delivered','cancelled','returned','partially_refunded')),
  currency               char(3) not null default 'GBP',
  subtotal_minor         bigint not null default 0,
  postage_charged_minor  bigint not null default 0,
  total_minor            bigint not null default 0,
  fees_minor             bigint,
  buyer_display          text,
  ship_to_country        char(2),
  ship_to_postcode_area  text,
  placed_at              timestamptz not null,
  raw_ref                uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (channel_account_id, external_order_id)
);
create index orders_workspace_placed_idx on public.orders (workspace_id, placed_at desc);
create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

create table public.order_lines (
  id                   uuid primary key default private.uuid_v7(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  order_id             uuid not null references public.orders(id) on delete cascade,
  external_line_id     text not null,
  channel_listing_id   uuid references public.channel_listings(id) on delete set null,
  sku_id               uuid references public.skus(id) on delete set null,
  external_listing_id  text,
  title_snapshot       text,
  quantity             integer not null check (quantity > 0),
  unit_price_minor     bigint not null default 0,
  line_fees_minor      bigint,
  status               text not null default 'active' check (status in ('active','cancelled','returned')),
  created_at           timestamptz not null default now(),
  unique (order_id, external_line_id)
);
create index order_lines_workspace_idx on public.order_lines (workspace_id);
create index order_lines_sku_idx on public.order_lines (sku_id);
create index order_lines_listing_idx on public.order_lines (channel_listing_id);

-- Exists so PII never lands in orders. Nothing writes to it in v1.
create table public.order_buyer_details (
  order_id     uuid primary key references public.orders(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text,
  address      jsonb,
  email        text,
  phone        text,
  purge_after  timestamptz not null,
  created_at   timestamptz not null default now()
);
create index order_buyer_details_purge_idx on public.order_buyer_details (purge_after);
create index order_buyer_details_workspace_idx on public.order_buyer_details (workspace_id);

-------------------------------------------------------------------------------
-- 6. Inbound and outbound
-------------------------------------------------------------------------------
create table public.channel_events (
  id                  uuid primary key default private.uuid_v7(),
  channel             text not null,
  channel_account_id  uuid references public.channel_accounts(id) on delete set null,
  workspace_id        uuid references public.workspaces(id) on delete cascade,
  external_event_id   text not null,
  topic               text not null,
  received_at         timestamptz not null default now(),
  signature_valid     boolean not null default false,
  payload             jsonb not null,
  status              text not null default 'received' check (status in ('received','processed','ignored','failed')),
  processed_at        timestamptz,
  error               jsonb,
  unique (channel, external_event_id)
);
create index channel_events_status_received_idx on public.channel_events (status, received_at);
create index channel_events_account_idx on public.channel_events (channel_account_id, received_at desc);
create index channel_events_workspace_idx on public.channel_events (workspace_id, received_at desc);

create table public.push_jobs (
  id                  uuid primary key default private.uuid_v7(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id  uuid not null references public.channel_accounts(id) on delete cascade,
  channel_listing_id  uuid not null references public.channel_listings(id) on delete cascade,
  kind                text not null check (kind in ('stock','price','listing_create','listing_update','delist','relist')),
  desired             jsonb not null default '{}'::jsonb,
  ledger_seq          bigint not null default 0,
  priority            smallint not null default 5 check (priority between 0 and 9),
  status              text not null default 'queued'
                      check (status in ('queued','running','succeeded','failed','superseded','dead')),
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  last_error          jsonb,
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz
);
-- Coalescing: at most one queued job per listing per kind. Newer desired values update the row.
create unique index push_jobs_queued_coalesce_uidx on public.push_jobs (channel_listing_id, kind) where status = 'queued';
create index push_jobs_due_idx on public.push_jobs (status, next_attempt_at) where status in ('queued','failed');
create index push_jobs_account_status_idx on public.push_jobs (channel_account_id, status);
create index push_jobs_workspace_created_idx on public.push_jobs (workspace_id, created_at desc);

-------------------------------------------------------------------------------
-- 7. Money
-------------------------------------------------------------------------------
create table public.fee_schedules (
  id             uuid primary key default private.uuid_v7(),
  channel        text not null,
  marketplace    text not null,
  account_type   text,
  effective_from date not null,
  effective_to   date,
  version        text not null,
  rules          jsonb not null,
  source_url     text,
  notes          text,
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index fee_schedules_lookup_idx on public.fee_schedules (channel, marketplace, account_type, effective_from desc);

create table public.sale_costings (
  order_line_id      uuid primary key references public.order_lines(id) on delete cascade,
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  fee_schedule_id    uuid references public.fee_schedules(id),
  gross_minor        bigint not null,
  fees_minor         bigint not null,
  postage_cost_minor bigint not null default 0,
  cost_minor         bigint,
  net_minor          bigint,
  margin_bps         integer,
  inputs             jsonb not null default '{}'::jsonb,
  computed_at        timestamptz not null default now()
);
create index sale_costings_workspace_idx on public.sale_costings (workspace_id);

-------------------------------------------------------------------------------
-- 8. Operations
-------------------------------------------------------------------------------
create table public.incidents (
  id                  uuid primary key default private.uuid_v7(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  kind                text not null check (kind in ('oversell','push_dead','auth_revoked','drift','webhook_signature_failed','unmatched_sale')),
  severity            smallint not null default 2 check (severity between 1 and 4),
  sku_id              uuid references public.skus(id) on delete set null,
  channel_account_id  uuid references public.channel_accounts(id) on delete set null,
  channel_listing_id  uuid references public.channel_listings(id) on delete set null,
  details             jsonb not null default '{}'::jsonb,
  status              text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_at          timestamptz not null default now(),
  acknowledged_at     timestamptz,
  resolved_at         timestamptz
);
create index incidents_workspace_open_idx on public.incidents (workspace_id, created_at desc) where status <> 'resolved';
create index incidents_sku_idx on public.incidents (sku_id);
create index incidents_account_idx on public.incidents (channel_account_id);
create index incidents_listing_idx on public.incidents (channel_listing_id);

create table public.activity_log (
  id                  uuid primary key default private.uuid_v7(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  channel_account_id  uuid references public.channel_accounts(id) on delete set null,
  sku_id              uuid references public.skus(id) on delete set null,
  level               text not null default 'info' check (level in ('info','warn','error')),
  message             text not null,
  context             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index activity_log_workspace_created_idx on public.activity_log (workspace_id, created_at desc);
create index activity_log_account_idx on public.activity_log (channel_account_id);
create index activity_log_sku_idx on public.activity_log (sku_id);

create table public.deletion_requests (
  id                uuid primary key default private.uuid_v7(),
  channel           text not null,
  external_user_id  text not null,
  received_at       timestamptz not null default now(),
  workspace_ids     uuid[] not null default '{}',
  completed_at      timestamptz,
  evidence          jsonb not null default '{}'::jsonb
);

create table public.stripe_events (
  id           text primary key,
  type         text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

create table public.ai_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  capability   text not null,
  level        text not null default 'suggest' check (level in ('suggest','auto_bounded','auto')),
  bounds       jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, capability)
);

create table public.analyst_digests (
  id            uuid primary key default private.uuid_v7(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  findings      jsonb not null default '[]'::jsonb,
  summary       text,
  model         text,
  sent_at       timestamptz,
  opened_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (workspace_id, period_start, period_end)
);

create table public.audit_events (
  id             uuid primary key default private.uuid_v7(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id  uuid,
  action         text not null,
  object_type    text not null,
  object_id      text,
  before_hash    text,
  after_hash     text,
  ip             inet,
  user_agent     text,
  created_at     timestamptz not null default now()
);
create index audit_events_workspace_created_idx on public.audit_events (workspace_id, created_at desc);
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function private.reject_mutation();

create table public.system_notices (
  id                  uuid primary key default private.uuid_v7(),
  scope               text not null check (scope in ('global','channel','account')),
  channel             text,
  channel_account_id  uuid references public.channel_accounts(id) on delete cascade,
  severity            text not null default 'info' check (severity in ('info','warn','critical')),
  message             text not null,
  link                text,
  starts_at           timestamptz not null default now(),
  ends_at             timestamptz
);
create index system_notices_active_idx on public.system_notices (starts_at, ends_at);
create index system_notices_account_idx on public.system_notices (channel_account_id);

-------------------------------------------------------------------------------
-- 9. Row level security. Every tenant table, same pattern.
-------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'products','skus','product_photos','channel_accounts','channel_listings','channel_category_mappings',
    'ledger_events','sku_stock','orders','order_lines','order_buyer_details','channel_events','push_jobs',
    'sale_costings','incidents','activity_log','ai_permissions','analyst_digests','audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.is_workspace_member(workspace_id))) with check ((select private.is_workspace_member(workspace_id)))',
      t || '_tenant_isolation', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Append-only tables: no update or delete for anyone through the API roles.
revoke update, delete on public.ledger_events from authenticated, anon, service_role;
revoke update, delete on public.audit_events from authenticated, anon, service_role;

-- Credentials never reach the browser: column-level grant excludes the ciphertext.
revoke select on public.channel_accounts from authenticated;
grant select (id, workspace_id, channel, external_account_id, display_name, marketplace, token_expires_at, scopes,
  status, sync_enabled, account_settings, last_health_check_at, last_inbound_at, last_outbound_at,
  created_at, updated_at, deleted_at) on public.channel_accounts to authenticated;
revoke insert, update on public.channel_accounts from authenticated;
grant update (display_name, sync_enabled, account_settings) on public.channel_accounts to authenticated;

-- Web tier reads, job tier writes.
revoke insert, update, delete on public.channel_events from authenticated;
revoke insert, update, delete on public.push_jobs from authenticated;
revoke insert, update, delete on public.orders, public.order_lines, public.sale_costings from authenticated;
revoke insert, update, delete on public.sku_stock from authenticated;
revoke insert, update, delete on public.order_buyer_details from authenticated;
revoke insert, update, delete on public.analyst_digests from authenticated;
grant update (status, acknowledged_at, resolved_at) on public.incidents to authenticated;
revoke insert, delete on public.incidents from authenticated;

-- Global reference tables: read by everyone signed in, written only by the service role.
alter table public.channel_taxonomies enable row level security;
alter table public.fee_schedules enable row level security;
alter table public.system_notices enable row level security;
create policy channel_taxonomies_read on public.channel_taxonomies for select to authenticated using (true);
create policy fee_schedules_read on public.fee_schedules for select to authenticated using (true);
create policy system_notices_read on public.system_notices for select to authenticated
  using (starts_at <= now() and (ends_at is null or ends_at > now()));
revoke insert, update, delete on public.channel_taxonomies, public.fee_schedules, public.system_notices from authenticated, anon;

-- Service-only tables.
alter table public.deletion_requests enable row level security;
alter table public.stripe_events enable row level security;
revoke all on public.deletion_requests, public.stripe_events from authenticated, anon;
