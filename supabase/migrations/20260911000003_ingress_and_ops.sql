-- Webhook ingress receipts, per-channel kill switches, and the push job claim and retry
-- functions. See docs/security-and-compliance.md section 4, docs/engineering-standards.md
-- section 8, docs/reliability-and-operations.md section 3.

-------------------------------------------------------------------------------
-- 1. Webhook receipts. Inserted by the ingress route before anything is verified.
--    workspace_id is resolved later by the job, so it is nullable here; the table is
--    reachable only by the service role.
-------------------------------------------------------------------------------
create table public.webhook_events (
  id                   uuid primary key default private.uuid_v7(),
  channel              text not null check (channel in ('ebay','amazon','tiktok','vinted','depop','etsy','onbuy','storefront','stripe')),
  external_event_id    text not null,
  workspace_id         uuid references public.workspaces(id) on delete set null,
  channel_account_id   uuid references public.channel_accounts(id) on delete set null,
  topic                text,
  headers              jsonb not null default '{}'::jsonb,
  body                 text not null,
  payload_hash         text not null,
  source_ip            text,
  status               text not null default 'received'
                       check (status in ('received','verified','rejected','processed','unmatched','failed')),
  error                jsonb,
  received_at          timestamptz not null default now(),
  processed_at         timestamptz,
  unique (channel, external_event_id)
);
create index webhook_events_status_idx on public.webhook_events (status, received_at) where status in ('received','verified');
create index webhook_events_workspace_idx on public.webhook_events (workspace_id, received_at desc);

alter table public.webhook_events enable row level security;
-- No policies: only service_role (bypasses RLS) may touch receipts. The browser never sees raw payloads.
revoke all on public.webhook_events from authenticated, anon;

-------------------------------------------------------------------------------
-- 2. Kill switches. One row per channel. Flipping push_enabled false pauses every outbound
--    job for that channel at the queue without losing it.
-------------------------------------------------------------------------------
create table public.connector_switches (
  channel          text primary key check (channel in ('ebay','amazon','tiktok','vinted','depop','etsy','onbuy','storefront')),
  push_enabled     boolean not null default true,
  pull_enabled     boolean not null default true,
  webhooks_enabled boolean not null default true,
  note             text,
  updated_at       timestamptz not null default now()
);
create trigger connector_switches_updated_at before update on public.connector_switches
  for each row execute function private.set_updated_at();
alter table public.connector_switches enable row level security;
create policy connector_switches_read on public.connector_switches for select to authenticated using (true);
revoke insert, update, delete on public.connector_switches from authenticated, anon;
insert into public.connector_switches (channel)
values ('ebay'),('amazon'),('tiktok'),('vinted'),('depop'),('etsy'),('onbuy'),('storefront');

-- 3 and 4: activity_log and deletion_requests already exist in 20260909000001_core_schema.sql.

-------------------------------------------------------------------------------
-- 5. Claiming push jobs. Atomic "queued/failed and due -> running" for one job id so two
--    workers can never run the same job. Returns the row when claimed, nothing otherwise.
-------------------------------------------------------------------------------
create or replace function public.claim_push_job(p_job_id uuid)
returns setof public.push_jobs
language sql
security definer
set search_path = ''
as $$
  update public.push_jobs
  set status = 'running', attempts = attempts + 1, started_at = now()
  where id = p_job_id
    and status in ('queued','failed')
    and next_attempt_at <= now()
  returning *;
$$;
revoke execute on function public.claim_push_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_push_job(uuid) to service_role;

-- A seller's one-click retry of a dead job.
create or replace function public.retry_push_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.push_jobs where id = p_job_id;
  if v_ws is null or not (select private.is_workspace_member(v_ws)) then
    raise exception 'job % not found', p_job_id using errcode = 'P0002';
  end if;
  update public.push_jobs
  set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null
  where id = p_job_id and status = 'dead';
end
$$;
revoke execute on function public.retry_push_job(uuid) from public, anon;
grant execute on function public.retry_push_job(uuid) to authenticated, service_role;
