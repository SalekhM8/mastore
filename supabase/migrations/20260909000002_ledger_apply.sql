-- The only write path into the ledger and its projection. See architecture doc section 7.
-- Runs with definer rights: direct writes to ledger_events, sku_stock and push_jobs are revoked
-- from the web tier, so this function is the only way stock moves. Because RLS does not apply
-- inside it, the tenant boundary is enforced explicitly at the top: a signed-in caller must be
-- a member of the workspace; the service role and postgres are trusted to pass the right one.

create or replace function public.apply_ledger_event(
  p_workspace_id uuid,
  p_sku_id uuid,
  p_kind text,
  p_quantity_delta integer,
  p_idempotency_key text,
  p_actor text,
  p_source_channel_account_id uuid default null,
  p_order_line_id uuid default null,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_type   text;
  v_seq         bigint;
  v_on_hand     integer;
  v_prev        integer;
  v_job_ids     uuid[] := '{}';
  v_job_id      uuid;
  v_listing     record;
  v_kind        text;
  v_priority    smallint;
  v_incident_id uuid;
begin
  -- 0. Tenant boundary. auth.uid() is null for service_role and postgres.
  if (select auth.uid()) is not null and not (select private.is_workspace_member(p_workspace_id)) then
    raise exception 'sku % not found in workspace %', p_sku_id, p_workspace_id using errcode = 'P0002';
  end if;

  -- 1. The SKU must belong to the workspace.
  select p.item_type into v_item_type
  from public.skus s join public.products p on p.id = s.product_id
  where s.id = p_sku_id and s.workspace_id = p_workspace_id and s.deleted_at is null;
  if v_item_type is null then
    raise exception 'sku % not found in workspace %', p_sku_id, p_workspace_id using errcode = 'P0002';
  end if;

  -- 2. Serialise all events for this SKU. Insert the projection row if it does not exist yet.
  insert into public.sku_stock (sku_id, workspace_id) values (p_sku_id, p_workspace_id)
  on conflict (sku_id) do nothing;
  select on_hand into v_prev from public.sku_stock where sku_id = p_sku_id for update;

  -- 3. Record the event. A duplicate idempotency key returns the original and changes nothing.
  insert into public.ledger_events
    (workspace_id, sku_id, kind, quantity_delta, source_channel_account_id, order_line_id,
     idempotency_key, occurred_at, actor, metadata)
  values
    (p_workspace_id, p_sku_id, p_kind, p_quantity_delta, p_source_channel_account_id, p_order_line_id,
     p_idempotency_key, p_occurred_at, p_actor, p_metadata)
  on conflict (workspace_id, idempotency_key) do nothing
  returning seq into v_seq;

  if v_seq is null then
    select e.seq into v_seq from public.ledger_events e
    where e.workspace_id = p_workspace_id and e.idempotency_key = p_idempotency_key;
    return jsonb_build_object('duplicate', true, 'event_seq', v_seq, 'on_hand', v_prev, 'job_ids', '[]'::jsonb);
  end if;

  -- 4. Update the projection.
  v_on_hand := v_prev + p_quantity_delta;
  update public.sku_stock
  set on_hand = v_on_hand, last_event_seq = v_seq, updated_at = now()
  where sku_id = p_sku_id;

  -- 5. Fan out: one push job per managed listing on every other channel account with sync on.
  for v_listing in
    select cl.id, cl.channel_account_id
    from public.channel_listings cl
    join public.channel_accounts ca on ca.id = cl.channel_account_id
    where cl.sku_id = p_sku_id
      and cl.managed
      and cl.status in ('active','pending')
      and ca.sync_enabled
      and ca.deleted_at is null
      and (p_source_channel_account_id is null or cl.channel_account_id <> p_source_channel_account_id)
  loop
    if v_item_type = 'unique' and v_on_hand <= 0 then
      v_kind := 'delist';
    else
      v_kind := 'stock';
    end if;
    -- Sale-driven changes outrank everything else in the queue.
    v_priority := case when p_kind in ('sale','cancellation','return') then 0 when p_kind = 'import_baseline' then 9 else 3 end;

    update public.channel_listings set desired_quantity = greatest(v_on_hand, 0) where id = v_listing.id;

    -- A queued job of another kind for this listing (e.g. a stock update before a delist) is now stale.
    update public.push_jobs set status = 'superseded', finished_at = now()
    where channel_listing_id = v_listing.id and status = 'queued' and kind <> v_kind;

    insert into public.push_jobs
      (workspace_id, channel_account_id, channel_listing_id, kind, desired, ledger_seq, priority)
    values
      (p_workspace_id, v_listing.channel_account_id, v_listing.id, v_kind,
       jsonb_build_object('quantity', greatest(v_on_hand, 0)), v_seq, v_priority)
    on conflict (channel_listing_id, kind) where status = 'queued'
    do update set
      desired = excluded.desired,
      ledger_seq = excluded.ledger_seq,
      priority = least(public.push_jobs.priority, excluded.priority),
      next_attempt_at = now()
    returning id into v_job_id;

    v_job_ids := v_job_ids || v_job_id;
  end loop;

  -- 6. Oversell: the marketplace already sold it. Record the fact and alert immediately.
  if v_on_hand < 0 and v_prev >= 0 then
    insert into public.incidents (workspace_id, kind, severity, sku_id, channel_account_id, details)
    values (p_workspace_id, 'oversell', 1, p_sku_id, p_source_channel_account_id,
            jsonb_build_object('on_hand', v_on_hand, 'event_seq', v_seq, 'order_line_id', p_order_line_id))
    returning id into v_incident_id;
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'event_seq', v_seq,
    'on_hand', v_on_hand,
    'job_ids', to_jsonb(v_job_ids),
    'incident_id', v_incident_id
  );
end
$$;

revoke execute on function public.apply_ledger_event(uuid, uuid, text, integer, text, text, uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.apply_ledger_event(uuid, uuid, text, integer, text, text, uuid, uuid, timestamptz, jsonb) to authenticated, service_role;
