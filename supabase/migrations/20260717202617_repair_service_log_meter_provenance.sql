-- Repair service-log meter provenance so a reversal can delete only the exact
-- service-created reading. Migration 0035 tried to discover that relationship
-- from an AFTER INSERT trigger on the log, but save_service_log_entry inserts
-- the reading afterward. That ordering could leave no link or select an older
-- same-value reading.

create schema if not exists private;
revoke all on schema private from public, anon;

drop trigger if exists equipment_service_log_capture_meter_reading
  on public.equipment_service_log;
drop function if exists public.capture_service_log_meter_reading();

-- Every existing row was produced by the heuristic trigger. Rebuild only links
-- that are unambiguous in both directions; ambiguous history stays unlinked and
-- the delete RPC below fails closed rather than guessing.
delete from public.service_log_meter_readings;

with candidates as (
  select
    l.id as service_log_id,
    r.id as meter_reading_id,
    count(*) over (partition by l.id) as readings_for_log,
    count(*) over (partition by r.id) as logs_for_reading
  from public.equipment_service_log l
  join public.equipment_meter_readings r
    on r.farm_id = l.farm_id
   and r.equipment_id = l.equipment_id
   and r.reading = l.meter_reading
   and r.read_on = l.service_date
   and r.source = 'service'
   and r.notes is null
   and r.created_by = l.created_by
   and r.created_at = l.created_at
  where l.meter_reading is not null
)
insert into public.service_log_meter_readings(service_log_id, meter_reading_id)
select service_log_id, meter_reading_id
from candidates
where readings_for_log = 1
  and logs_for_reading = 1;

-- Keep the proven 0017 writer unchanged and RLS-aware, but move it out of the
-- Data API. The public wrapper below adds exact provenance in the same database
-- transaction after the core function has created or confirmed both rows.
alter function public.save_service_log_entry(uuid, jsonb, uuid)
  set schema private;
alter function private.save_service_log_entry(uuid, jsonb, uuid)
  rename to save_service_log_entry_core;

revoke all on function private.save_service_log_entry_core(uuid, jsonb, uuid)
  from public, anon, authenticated;

create or replace function private.link_service_log_meter_reading(
  p_farm_id uuid,
  p_log_id uuid,
  p_reading_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'authentication is required';
  end if;
  if p_farm_id is null or p_log_id is null or p_reading_id is null then
    raise exception 'service provenance IDs are required';
  end if;
  if not public.is_active_farm_member(p_farm_id) then
    raise exception 'you must be an active member of this farm to save a service entry';
  end if;

  perform 1
  from public.equipment_service_log l
  join public.equipment_meter_readings r
    on r.id = p_reading_id
   and r.farm_id = l.farm_id
   and r.equipment_id = l.equipment_id
   and r.reading = l.meter_reading
   and r.read_on = l.service_date
   and r.source = 'service'
   and r.notes is null
   and r.created_by = l.created_by
   and r.created_at = l.created_at
  where l.id = p_log_id
    and l.farm_id = p_farm_id
    and l.created_by = v_caller
    and l.meter_reading is not null;
  if not found then
    raise exception 'service meter provenance does not match the saved entry';
  end if;

  insert into public.service_log_meter_readings(service_log_id, meter_reading_id)
  values (p_log_id, p_reading_id)
  on conflict do nothing;

  if not exists (
    select 1
    from public.service_log_meter_readings p
    where p.service_log_id = p_log_id
      and p.meter_reading_id = p_reading_id
  ) then
    raise exception 'service meter provenance conflicts with stored history';
  end if;
end;
$$;

revoke all on function private.link_service_log_meter_reading(uuid, uuid, uuid)
  from public, anon, authenticated;

-- A service interval is a projection of immutable service history, not the
-- arrival order of offline writes. Recompute both completion dimensions from
-- canonical history so a backdated replay cannot move an interval backward.
create or replace function private.recompute_service_interval_completion(
  p_farm_id uuid,
  p_interval_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_done_on date;
  v_last_done_reading numeric;
begin
  select l.service_date
  into v_last_done_on
  from public.equipment_service_log l
  where l.farm_id = p_farm_id
    and l.interval_id = p_interval_id
  order by l.service_date desc, l.created_at desc, l.id desc
  limit 1;

  select l.meter_reading
  into v_last_done_reading
  from public.equipment_service_log l
  where l.farm_id = p_farm_id
    and l.interval_id = p_interval_id
    and l.meter_reading is not null
  order by l.service_date desc, l.created_at desc, l.id desc
  limit 1;

  update public.equipment_service_intervals
  set last_done_on = v_last_done_on,
      last_done_reading = v_last_done_reading
  where id = p_interval_id
    and farm_id = p_farm_id;
end;
$$;

revoke all on function private.recompute_service_interval_completion(uuid, uuid)
  from public, anon, authenticated;

-- Preserve the worker-safe interval validation from 0016, but make the stamp
-- deterministic and harden the trigger function's namespace resolution.
create or replace function public.stamp_service_interval_from_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_every_meter numeric;
  v_interval_equipment_id uuid;
begin
  if new.interval_id is null then
    return new;
  end if;
  if auth.uid() is null or not public.is_active_farm_member(new.farm_id) then
    raise exception 'you must be an active member of this farm to complete a service interval';
  end if;

  select i.every_meter, i.equipment_id
  into v_every_meter, v_interval_equipment_id
  from public.equipment_service_intervals i
  where i.id = new.interval_id
    and i.farm_id = new.farm_id
  for update;

  if not found then
    raise exception 'service interval must belong to this farm';
  end if;
  if v_interval_equipment_id is distinct from new.equipment_id then
    raise exception 'service interval must belong to the selected equipment';
  end if;
  if v_every_meter is not null and new.meter_reading is null then
    raise exception 'a meter reading is required to complete a meter-based interval';
  end if;

  perform private.recompute_service_interval_completion(new.farm_id, new.interval_id);
  return new;
end;
$$;

revoke all on function public.stamp_service_interval_from_log()
  from public, anon, authenticated;

-- Repair only intervals that already have linked service history. Manual
-- baselines on intervals with no history remain untouched.
do $$
declare
  v_interval record;
  v_prior_claims text := current_setting('request.jwt.claims', true);
begin
  -- Migration-owned repair bypasses browser epoch headers explicitly. Restore
  -- the caller's prior claims before leaving this block.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for v_interval in
    select distinct l.farm_id, l.interval_id
    from public.equipment_service_log l
    where l.interval_id is not null
  loop
    perform private.recompute_service_interval_completion(
      v_interval.farm_id,
      v_interval.interval_id
    );
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
exception
  when others then
    perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
    raise;
end;
$$;

grant usage on schema private to authenticated;
grant execute on function private.save_service_log_entry_core(uuid, jsonb, uuid)
  to authenticated;
grant execute on function private.link_service_log_meter_reading(uuid, uuid, uuid)
  to authenticated;

create function public.save_service_log_entry(
  p_farm_id uuid,
  p_log jsonb,
  p_reading_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_interval_id uuid;
  v_interval_completion jsonb;
  v_interval_reading jsonb;
begin
  v_result := private.save_service_log_entry_core(
    p_farm_id,
    p_log,
    p_reading_id
  );
  if p_reading_id is not null then
    perform private.link_service_log_meter_reading(
      p_farm_id,
      (v_result -> 'log' ->> 'id')::uuid,
      p_reading_id
    );
  end if;
  v_interval_id := (v_result -> 'log' ->> 'interval_id')::uuid;
  if v_interval_id is not null then
    select jsonb_build_object(
      'service_log_id', l.id,
      'service_date', l.service_date
    )
    into v_interval_completion
    from public.equipment_service_log l
    where l.farm_id = p_farm_id
      and l.interval_id = v_interval_id
    order by l.service_date desc, l.created_at desc, l.id desc
    limit 1;

    select jsonb_build_object(
      'service_log_id', l.id,
      'meter_reading', l.meter_reading
    )
    into v_interval_reading
    from public.equipment_service_log l
    where l.farm_id = p_farm_id
      and l.interval_id = v_interval_id
      and l.meter_reading is not null
    order by l.service_date desc, l.created_at desc, l.id desc
    limit 1;
  end if;
  return v_result || jsonb_build_object(
    'interval_completion', v_interval_completion,
    'interval_reading', v_interval_reading
  );
end;
$$;

revoke all on function public.save_service_log_entry(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.save_service_log_entry(uuid, jsonb, uuid)
  to authenticated;

-- The public writer inserts the log before its exact reading and provenance
-- link. A deferred constraint therefore validates the completed transaction,
-- while rejecting direct metered inserts or direct calls to the moved core.
create or replace function private.require_service_log_meter_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- FK actions and other non-provenance updates may touch preserved ambiguous
  -- history. Revalidate only when a column that defines the exact pair changes.
  if tg_op = 'UPDATE'
    and new.id is not distinct from old.id
    and new.farm_id is not distinct from old.farm_id
    and new.equipment_id is not distinct from old.equipment_id
    and new.service_date is not distinct from old.service_date
    and new.meter_reading is not distinct from old.meter_reading
    and new.created_by is not distinct from old.created_by
    and new.created_at is not distinct from old.created_at
  then
    return null;
  end if;

  -- A log created and atomically reversed in the same transaction no longer
  -- needs provenance at commit; authenticated callers cannot delete directly.
  if not exists (
    select 1 from public.equipment_service_log l where l.id = new.id
  ) then
    return null;
  end if;
  if new.meter_reading is null then
    if exists (
      select 1
      from public.service_log_meter_readings p
      where p.service_log_id = new.id
    ) then
      raise exception using
        message = 'SERVICE_LOG_READING_PROVENANCE_INVALID',
        detail = new.id::text;
    end if;
  elsif not exists (
    select 1
    from public.service_log_meter_readings p
    join public.equipment_meter_readings r
      on r.id = p.meter_reading_id
     and r.farm_id = new.farm_id
     and r.equipment_id = new.equipment_id
     and r.reading = new.meter_reading
     and r.read_on = new.service_date
     and r.source = 'service'
     and r.notes is null
     and r.created_by = new.created_by
     and r.created_at = new.created_at
    where p.service_log_id = new.id
  ) then
    raise exception using
      message = 'SERVICE_LOG_READING_PROVENANCE_REQUIRED',
      detail = new.id::text;
  end if;
  return null;
end;
$$;

revoke all on function private.require_service_log_meter_provenance()
  from public, anon, authenticated;

create constraint trigger equipment_service_log_requires_meter_provenance
after insert or update on public.equipment_service_log
deferrable initially deferred
for each row execute function private.require_service_log_meter_provenance();

-- Every service-log deletion must use the atomic reversal RPC. Direct table
-- deletion would cascade the provenance link while leaving the exact reading
-- and interval completion behind.
revoke delete on table public.equipment_service_log from authenticated;

create or replace function public.delete_service_log_with_reversal(
  p_farm_id uuid,
  p_log_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.equipment_service_log%rowtype;
  v_reading_id uuid;
  v_link_exists boolean := false;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;
  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  -- Match the save writer's per-farm lock before reading any log state. This
  -- prevents an uncommitted newer service from being omitted when an older
  -- entry is reversed and the interval completion is recomputed.
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text, 0));
  select * into v_log
  from public.equipment_service_log
  where id = p_log_id
    and farm_id = p_farm_id
  for update;
  if not found then
    return jsonb_build_object('id', p_log_id, 'already_deleted', true);
  end if;

  select p.meter_reading_id into v_reading_id
  from public.service_log_meter_readings p
  where p.service_log_id = v_log.id
  for update;
  v_link_exists := found;

  if v_log.meter_reading is not null and not v_link_exists then
    raise exception 'SERVICE_LOG_READING_PROVENANCE_REQUIRED';
  end if;
  if v_log.meter_reading is null and v_link_exists then
    raise exception 'SERVICE_LOG_READING_PROVENANCE_INVALID';
  end if;
  if v_link_exists then
    perform 1
    from public.equipment_meter_readings r
    where r.id = v_reading_id
      and r.farm_id = p_farm_id
      and r.equipment_id = v_log.equipment_id
      and r.reading = v_log.meter_reading
      and r.read_on = v_log.service_date
      and r.source = 'service'
      and r.notes is null
      and r.created_by = v_log.created_by
      and r.created_at = v_log.created_at
    for update;
    if not found then
      raise exception 'SERVICE_LOG_READING_PROVENANCE_INVALID';
    end if;
  end if;

  delete from public.equipment_service_log
  where id = v_log.id
    and farm_id = p_farm_id;

  if v_log.interval_id is not null then
    perform private.recompute_service_interval_completion(
      p_farm_id,
      v_log.interval_id
    );
  end if;

  if v_reading_id is not null then
    delete from public.equipment_meter_readings
    where id = v_reading_id
      and farm_id = p_farm_id
      and source = 'service';
  end if;

  return jsonb_build_object(
    'id', p_log_id,
    'reading_id', v_reading_id,
    'already_deleted', false
  );
end;
$$;

revoke all on function public.delete_service_log_with_reversal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_service_log_with_reversal(uuid, uuid)
  to authenticated;
