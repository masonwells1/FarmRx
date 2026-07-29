-- 0017_service_log_rls_fix.sql
-- Fixes a row-lock/RLS conflict in save_service_log_entry (applied in 0016):
-- SELECT ... FOR UPDATE under row-level security returns only rows the caller
-- could UPDATE. Workers cannot update service intervals (owner/manager only)
-- and NOBODY can update the append-only log/reading history rows, so the
-- invoker RPC's three row locks made a worker's service entry fail with
-- 'service interval must belong to this farm' and would have broken offline
-- replay for every role. The per-farm advisory lock taken earlier in the
-- function already serializes these writes, so the row locks are removed;
-- the checks become plain RLS-scoped SELECTs. Interval stamping still happens
-- in the SECURITY DEFINER trigger stamp_service_interval_from_log, which keeps
-- its own FOR UPDATE legitimately.

create or replace function public.save_service_log_entry(
  p_farm_id uuid,
  p_log jsonb,
  p_reading_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_log_id uuid;
  v_equipment_id uuid;
  v_service_date date;
  v_work_performed text;
  v_parts text;
  v_vendor text;
  v_cost numeric;
  v_meter_reading numeric;
  v_interval_id uuid;
  v_log public.equipment_service_log%rowtype;
  v_reading public.equipment_meter_readings%rowtype;
  v_interval public.equipment_service_intervals%rowtype;
  v_existing_log boolean := false;
  v_existing_reading boolean := false;
  v_log_json jsonb;
  v_reading_json jsonb := null;
  v_interval_json jsonb := null;
begin
  if v_caller is null then
    raise exception 'you must be signed in to save a service entry';
  end if;
  if p_farm_id is null then
    raise exception 'farm is required to save a service entry';
  end if;
  if not public.is_active_farm_member(p_farm_id) then
    raise exception 'you must be an active member of this farm to save a service entry';
  end if;
  if jsonb_typeof(p_log) is distinct from 'object' then
    raise exception 'service entry must be a JSON object';
  end if;
  if (select count(*) from jsonb_object_keys(p_log)) <> 9
    or exists (
      select 1
      from jsonb_object_keys(p_log) as k(key)
      where k.key not in (
        'id', 'equipment_id', 'service_date', 'work_performed', 'parts',
        'vendor', 'cost', 'meter_reading', 'interval_id'
      )
    )
  then
    raise exception 'service entry keys do not match the accepted contract';
  end if;
  if jsonb_typeof(p_log -> 'id') is distinct from 'string'
    or jsonb_typeof(p_log -> 'equipment_id') is distinct from 'string'
    or jsonb_typeof(p_log -> 'service_date') is distinct from 'string'
    or jsonb_typeof(p_log -> 'work_performed') is distinct from 'string'
    or coalesce(jsonb_typeof(p_log -> 'parts'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_log -> 'vendor'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_log -> 'cost'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_log -> 'meter_reading'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_log -> 'interval_id'), 'null') not in ('string', 'null')
  then
    raise exception 'service entry fields have invalid JSON types';
  end if;

  begin
    v_log_id := (p_log ->> 'id')::uuid;
    v_equipment_id := (p_log ->> 'equipment_id')::uuid;
    v_service_date := (p_log ->> 'service_date')::date;
    v_interval_id := nullif(p_log ->> 'interval_id', '')::uuid;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'service entry IDs and date must be valid';
  end;

  v_work_performed := p_log ->> 'work_performed';
  v_parts := p_log ->> 'parts';
  v_vendor := p_log ->> 'vendor';
  v_cost := (p_log ->> 'cost')::numeric;
  v_meter_reading := (p_log ->> 'meter_reading')::numeric;

  if length(btrim(v_work_performed)) not between 1 and 10000 then
    raise exception 'work performed must be between 1 and 10000 characters';
  end if;
  if v_parts is not null and length(btrim(v_parts)) not between 1 and 10000 then
    raise exception 'parts must be between 1 and 10000 characters when provided';
  end if;
  if v_vendor is not null and length(btrim(v_vendor)) not between 1 and 200 then
    raise exception 'vendor must be between 1 and 200 characters when provided';
  end if;
  if v_cost is not null and v_cost < 0 then
    raise exception 'service cost cannot be negative';
  end if;
  if v_meter_reading is not null and v_meter_reading < 0 then
    raise exception 'service meter reading cannot be negative';
  end if;
  if v_meter_reading is not null and p_reading_id is null then
    raise exception 'meter reading ID is required when a service meter reading is provided';
  end if;
  if v_meter_reading is null and p_reading_id is not null then
    raise exception 'meter reading ID is allowed only when a service meter reading is provided';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text, 0));

  perform 1
  from public.equipment e
  where e.id = v_equipment_id
    and e.farm_id = p_farm_id;
  if not found then
    raise exception 'equipment must belong to this farm';
  end if;

  if v_interval_id is not null then
    select i.id, i.farm_id, i.equipment_id, i.name, i.every_meter,
      i.every_months, i.last_done_on, i.last_done_reading, i.is_active,
      i.created_by, i.created_at, i.updated_at
    into v_interval
    from public.equipment_service_intervals i
    where i.id = v_interval_id
      and i.farm_id = p_farm_id;

    if not found then
      raise exception 'service interval must belong to this farm';
    end if;
    if v_interval.equipment_id <> v_equipment_id then
      raise exception 'service interval must belong to the selected equipment';
    end if;
    if v_interval.every_meter is not null and v_meter_reading is null then
      raise exception 'a meter reading is required to complete a meter-based interval';
    end if;
  end if;

  select l.id, l.farm_id, l.equipment_id, l.service_date, l.work_performed,
    l.parts, l.vendor, l.cost, l.meter_reading, l.interval_id, l.created_by,
    l.created_at, l.updated_at
  into v_log
  from public.equipment_service_log l
  where l.id = v_log_id;
  v_existing_log := found;

  if v_existing_log then
    if v_log.farm_id is distinct from p_farm_id
      or v_log.equipment_id is distinct from v_equipment_id
      or v_log.service_date is distinct from v_service_date
      or v_log.work_performed is distinct from v_work_performed
      or v_log.parts is distinct from v_parts
      or v_log.vendor is distinct from v_vendor
      or v_log.cost is distinct from v_cost
      or v_log.meter_reading is distinct from v_meter_reading
      or v_log.interval_id is distinct from v_interval_id
      or v_log.created_by is distinct from v_caller
    then
      raise exception 'service entry replay does not match stored history';
    end if;
  else
    insert into public.equipment_service_log (
      id, farm_id, equipment_id, service_date, work_performed, parts, vendor,
      cost, meter_reading, interval_id, created_by
    ) values (
      v_log_id, p_farm_id, v_equipment_id, v_service_date, v_work_performed,
      v_parts, v_vendor, v_cost, v_meter_reading, v_interval_id, v_caller
    )
    returning id, farm_id, equipment_id, service_date, work_performed, parts,
      vendor, cost, meter_reading, interval_id, created_by, created_at, updated_at
    into v_log;
  end if;

  if v_meter_reading is not null then
    select r.id, r.farm_id, r.equipment_id, r.reading, r.read_on, r.source,
      r.notes, r.created_by, r.created_at, r.updated_at
    into v_reading
    from public.equipment_meter_readings r
    where r.id = p_reading_id;
    v_existing_reading := found;

    if v_existing_reading then
      if v_reading.farm_id is distinct from p_farm_id
        or v_reading.equipment_id is distinct from v_equipment_id
        or v_reading.reading is distinct from v_meter_reading
        or v_reading.read_on is distinct from v_service_date
        or v_reading.source is distinct from 'service'
        or v_reading.notes is not null
        or v_reading.created_by is distinct from v_caller
      then
        raise exception 'service meter reading replay does not match stored history';
      end if;
    else
      insert into public.equipment_meter_readings (
        id, farm_id, equipment_id, reading, read_on, source, notes, created_by
      ) values (
        p_reading_id, p_farm_id, v_equipment_id, v_meter_reading,
        v_service_date, 'service', null, v_caller
      )
      returning id, farm_id, equipment_id, reading, read_on, source, notes,
        created_by, created_at, updated_at
      into v_reading;
    end if;
  end if;

  if v_interval_id is not null then
    select i.id, i.farm_id, i.equipment_id, i.name, i.every_meter,
      i.every_months, i.last_done_on, i.last_done_reading, i.is_active,
      i.created_by, i.created_at, i.updated_at
    into v_interval
    from public.equipment_service_intervals i
    where i.id = v_interval_id
      and i.farm_id = p_farm_id;
  end if;

  v_log_json := jsonb_build_object(
    'id', v_log.id,
    'farm_id', v_log.farm_id,
    'equipment_id', v_log.equipment_id,
    'service_date', v_log.service_date,
    'work_performed', v_log.work_performed,
    'parts', v_log.parts,
    'vendor', v_log.vendor,
    'cost', v_log.cost,
    'meter_reading', v_log.meter_reading,
    'interval_id', v_log.interval_id,
    'created_by', v_log.created_by,
    'created_at', v_log.created_at,
    'updated_at', v_log.updated_at
  );

  if v_meter_reading is not null then
    v_reading_json := jsonb_build_object(
      'id', v_reading.id,
      'farm_id', v_reading.farm_id,
      'equipment_id', v_reading.equipment_id,
      'reading', v_reading.reading,
      'read_on', v_reading.read_on,
      'source', v_reading.source,
      'notes', v_reading.notes,
      'created_by', v_reading.created_by,
      'created_at', v_reading.created_at,
      'updated_at', v_reading.updated_at
    );
  end if;

  if v_interval_id is not null then
    v_interval_json := jsonb_build_object(
      'id', v_interval.id,
      'farm_id', v_interval.farm_id,
      'equipment_id', v_interval.equipment_id,
      'name', v_interval.name,
      'every_meter', v_interval.every_meter,
      'every_months', v_interval.every_months,
      'last_done_on', v_interval.last_done_on,
      'last_done_reading', v_interval.last_done_reading,
      'is_active', v_interval.is_active,
      'created_by', v_interval.created_by,
      'created_at', v_interval.created_at,
      'updated_at', v_interval.updated_at
    );
  end if;

  return jsonb_build_object(
    'log', v_log_json,
    'reading', v_reading_json,
    'interval', v_interval_json
  );
end;
$$;

revoke all on function public.save_service_log_entry(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.save_service_log_entry(uuid, jsonb, uuid) to authenticated;
