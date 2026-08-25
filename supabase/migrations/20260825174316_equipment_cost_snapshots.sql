-- Equipment service costs -> Profitability, as an explicit immutable snapshot.
-- Purchase price is intentionally excluded: only equipment_service_log.cost is summed.

alter table public.budget_cost_lines
  add column equipment_period_start date,
  add column equipment_period_end date,
  add column equipment_total_source_amount numeric,
  add column equipment_allocation_acres numeric,
  add column equipment_included_row_count integer,
  add column equipment_excluded_null_cost_count integer,
  add column equipment_captured_at timestamptz;

alter table public.budget_cost_lines
  add constraint budget_cost_lines_equipment_snapshot_consistent check (
    (
      source_kind = 'equipment'
      and equipment_period_start is not null
      and equipment_period_end is not null
      and equipment_period_start <= equipment_period_end
      and equipment_total_source_amount is not null
      and equipment_total_source_amount > 0
      and equipment_allocation_acres is not null
      and equipment_allocation_acres > 0
      and equipment_included_row_count is not null
      and equipment_included_row_count > 0
      and equipment_excluded_null_cost_count is not null
      and equipment_excluded_null_cost_count >= 0
      and equipment_captured_at is not null
      and amount_per_acre = round(equipment_total_source_amount / equipment_allocation_acres, 4)
    )
    or
    (
      source_kind <> 'equipment'
      and equipment_period_start is null
      and equipment_period_end is null
      and equipment_total_source_amount is null
      and equipment_allocation_acres is null
      and equipment_included_row_count is null
      and equipment_excluded_null_cost_count is null
      and equipment_captured_at is null
    )
  );

create unique index budget_cost_lines_equipment_snapshot_key
  on public.budget_cost_lines (
    budget_id,
    source_record_id,
    equipment_period_start,
    equipment_period_end
  )
  where source_kind = 'equipment';

create or replace function public.guard_equipment_cost_snapshot_write()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (
    (tg_op = 'INSERT' and new.source_kind = 'equipment')
    or
    (tg_op = 'UPDATE' and (old.source_kind = 'equipment' or new.source_kind = 'equipment'))
  ) and current_setting('farmrx.equipment_cost_snapshot_rpc', true) is distinct from 'allowed'
  then
    raise exception 'equipment cost snapshots must be created or replaced from current server service costs';
  end if;
  return new;
end;
$$;

create trigger budget_cost_lines_guard_equipment_snapshot
before insert or update on public.budget_cost_lines
for each row execute function public.guard_equipment_cost_snapshot_write();

-- Serialize every service-log mutation with a snapshot read for the same machine.
-- Moving a row between machines takes both locks in UUID-text order to avoid a
-- two-machine deadlock. The RPC below takes the identical one-machine lock
-- before establishing its capture timestamp or aggregate snapshot.
create or replace function public.lock_equipment_service_cost_stream()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_first uuid;
  v_second uuid;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.equipment_id::text, 2026081101));
    return new;
  elsif tg_op = 'DELETE' then
    perform pg_advisory_xact_lock(hashtextextended(old.equipment_id::text, 2026081101));
    return old;
  end if;

  if old.equipment_id = new.equipment_id then
    perform pg_advisory_xact_lock(hashtextextended(new.equipment_id::text, 2026081101));
  else
    if old.equipment_id::text < new.equipment_id::text then
      v_first := old.equipment_id;
      v_second := new.equipment_id;
    else
      v_first := new.equipment_id;
      v_second := old.equipment_id;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_first::text, 2026081101));
    perform pg_advisory_xact_lock(hashtextextended(v_second::text, 2026081101));
  end if;
  return new;
end;
$$;

create trigger equipment_service_log_cost_stream_lock
before insert or update or delete on public.equipment_service_log
for each row execute function public.lock_equipment_service_cost_stream();

create or replace function public.upsert_equipment_cost_snapshot(
  p_farm_id uuid,
  p_budget_id uuid,
  p_equipment_id uuid,
  p_period_start date,
  p_period_end date,
  p_allocation_acres numeric,
  p_action text,
  p_line_id uuid default null,
  p_expected_total numeric default null,
  p_expected_included_count integer default null,
  p_expected_excluded_null_count integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_budget public.crop_budgets%rowtype;
  v_equipment public.equipment%rowtype;
  v_existing public.budget_cost_lines%rowtype;
  v_saved public.budget_cost_lines%rowtype;
  v_total numeric;
  v_amount_per_acre numeric;
  v_included integer;
  v_excluded integer;
  v_sort_order smallint;
  v_label text;
  v_captured_at timestamptz;
  v_candidate jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication is required to import equipment service costs';
  end if;
  if p_farm_id is null or not public.can_edit_farm(p_farm_id)
    or not public.can_read_private_financials(p_farm_id)
  then
    raise exception 'you do not have permission to edit this farm''s profitability';
  end if;
  if p_action not in ('preview', 'insert', 'replace') then
    raise exception 'equipment cost snapshot action must be preview, insert, or replace';
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception 'choose a valid equipment service cost period';
  end if;
  if p_allocation_acres is null or p_allocation_acres <= 0 then
    raise exception 'allocation acres must be greater than zero';
  end if;
  if p_action in ('insert', 'replace') and p_line_id is null then
    raise exception 'a snapshot line id is required to save equipment service costs';
  end if;

  select * into v_budget
  from public.crop_budgets
  where id = p_budget_id and farm_id = p_farm_id;
  if not found then
    raise exception 'the selected crop budget does not belong to this farm';
  end if;

  select * into v_equipment
  from public.equipment
  where id = p_equipment_id and farm_id = p_farm_id;
  if not found then
    raise exception 'the selected machine does not belong to this farm';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_equipment_id::text, 2026081101));
  v_captured_at := clock_timestamp();

  select
    coalesce(sum(cost) filter (where cost is not null), 0),
    count(*) filter (where cost is not null)::integer,
    count(*) filter (where cost is null)::integer
  into v_total, v_included, v_excluded
  from public.equipment_service_log
  where farm_id = p_farm_id
    and equipment_id = p_equipment_id
    and service_date between p_period_start and p_period_end;

  if v_included = 0 or v_total <= 0 then
    raise exception 'no positive service cost is recorded for that machine and period';
  end if;
  if p_action in ('insert', 'replace') and (
    p_expected_total is null
    or p_expected_included_count is null
    or p_expected_excluded_null_count is null
    or p_expected_total <> v_total
    or p_expected_included_count <> v_included
    or p_expected_excluded_null_count <> v_excluded
  ) then
    raise exception 'service costs changed after review; review the snapshot again before saving';
  end if;

  -- Keep the established numeric(14,4) cost-line contract. The source total and
  -- allocation acres remain separately persisted, so the snapshot stays auditable.
  v_amount_per_acre := round(v_total / p_allocation_acres, 4);
  v_label := left(v_equipment.name, 112)
    || ' service costs ' || p_period_start::text || ' to ' || p_period_end::text;

  select * into v_existing
  from public.budget_cost_lines
  where budget_id = p_budget_id
    and source_kind = 'equipment'
    and source_record_id = p_equipment_id
    and equipment_period_start = p_period_start
    and equipment_period_end = p_period_end;

  v_candidate := jsonb_build_object(
    'line_id', p_line_id,
    'budget_id', p_budget_id,
    'equipment_id', p_equipment_id,
    'equipment_name', v_equipment.name,
    'category', 'repairs',
    'label', v_label,
    'amount_per_acre', v_amount_per_acre::text,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'total_source_amount', v_total::text,
    'allocation_acres', p_allocation_acres::text,
    'included_row_count', v_included,
    'excluded_null_cost_count', v_excluded,
    'captured_at', v_captured_at
  );

  if p_action = 'preview' then
    return jsonb_build_object(
      'action', 'preview',
      'candidate', v_candidate,
      'existing', case when v_existing.id is null then null else to_jsonb(v_existing) end
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_budget_id::text, 0));
  perform 1 from public.crop_budgets
  where id = p_budget_id and farm_id = p_farm_id
  for update;

  select * into v_existing
  from public.budget_cost_lines
  where budget_id = p_budget_id
    and source_kind = 'equipment'
    and source_record_id = p_equipment_id
    and equipment_period_start = p_period_start
    and equipment_period_end = p_period_end
  for update;

  if p_action = 'insert' and v_existing.id is not null then
    if v_existing.label <> v_label
      or v_existing.amount_per_acre <> v_amount_per_acre
      or v_existing.equipment_total_source_amount <> v_total
      or v_existing.equipment_allocation_acres <> p_allocation_acres
      or v_existing.equipment_included_row_count <> v_included
      or v_existing.equipment_excluded_null_cost_count <> v_excluded
    then
      raise exception 'an older equipment cost snapshot already exists; review it again before replacing';
    end if;
    return jsonb_build_object(
      'action', 'kept',
      'candidate', v_candidate,
      'line', to_jsonb(v_existing)
    );
  end if;

  if p_action = 'replace' then
    if v_existing.id is null then
      raise exception 'the equipment cost snapshot changed; review it again before replacing';
    end if;
    if v_existing.id <> p_line_id then
      raise exception 'the equipment cost snapshot changed; review it again before replacing';
    end if;
    if v_existing.label = v_label
      and v_existing.amount_per_acre = v_amount_per_acre
      and v_existing.equipment_total_source_amount = v_total
      and v_existing.equipment_allocation_acres = p_allocation_acres
      and v_existing.equipment_included_row_count = v_included
      and v_existing.equipment_excluded_null_cost_count = v_excluded
    then
      return jsonb_build_object(
        'action', 'kept',
        'candidate', v_candidate,
        'line', to_jsonb(v_existing)
      );
    end if;

    perform set_config('farmrx.equipment_cost_snapshot_rpc', 'allowed', true);
    update public.budget_cost_lines
    set category = 'repairs',
        label = v_label,
        amount_per_acre = v_amount_per_acre,
        equipment_total_source_amount = v_total,
        equipment_allocation_acres = p_allocation_acres,
        equipment_included_row_count = v_included,
        equipment_excluded_null_cost_count = v_excluded,
        equipment_captured_at = v_captured_at
    where id = v_existing.id and farm_id = p_farm_id
    returning * into v_saved;
    perform set_config('farmrx.equipment_cost_snapshot_rpc', '', true);
  else
    select coalesce(max(sort_order), -1) + 1
    into v_sort_order
    from public.budget_cost_lines
    where budget_id = p_budget_id and farm_id = p_farm_id;

    perform set_config('farmrx.equipment_cost_snapshot_rpc', 'allowed', true);
    insert into public.budget_cost_lines (
      id, farm_id, budget_id, category, label, amount_per_acre,
      source_kind, source_record_id, sort_order, notes,
      equipment_period_start, equipment_period_end,
      equipment_total_source_amount, equipment_allocation_acres,
      equipment_included_row_count, equipment_excluded_null_cost_count,
      equipment_captured_at
    ) values (
      p_line_id, p_farm_id, p_budget_id, 'repairs', v_label, v_amount_per_acre,
      'equipment', p_equipment_id, v_sort_order, null,
      p_period_start, p_period_end,
      v_total, p_allocation_acres,
      v_included, v_excluded,
      v_captured_at
    )
    returning * into v_saved;
    perform set_config('farmrx.equipment_cost_snapshot_rpc', '', true);
  end if;

  if v_saved.id is null then
    raise exception 'Farm Rx could not confirm the equipment cost snapshot';
  end if;

  return jsonb_build_object(
    'action', p_action,
    'candidate', v_candidate,
    'line', to_jsonb(v_saved)
  );
end;
$$;

revoke all on function public.guard_equipment_cost_snapshot_write()
  from public, anon, authenticated;
revoke all on function public.lock_equipment_service_cost_stream()
  from public, anon, authenticated;
revoke all on function public.upsert_equipment_cost_snapshot(
  uuid, uuid, uuid, date, date, numeric, text, uuid, numeric, integer, integer
) from public, anon, authenticated;
grant execute on function public.upsert_equipment_cost_snapshot(
  uuid, uuid, uuid, date, date, numeric, text, uuid, numeric, integer, integer
) to authenticated;
