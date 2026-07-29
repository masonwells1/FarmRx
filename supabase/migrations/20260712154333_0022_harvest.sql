-- DRAFT ONLY -- Adds realized harvest price and a focused harvest quick-entry
-- RPC after applied migration 0021. This is additive-safe: it adds one nullable
-- crop_assignments column and one new function without replacing or removing
-- any object created by 0001-0021.
--
-- The SECURITY DEFINER RPC uses an advisory transaction lock and never uses
-- SELECT ... FOR UPDATE. This follows the 0017 lesson: invoker-visible row
-- locks can be silently filtered by RLS. A fixed search path, explicit auth and
-- can_edit_farm gates, and a farm-scoped UPDATE keep the definer path narrow.
--
-- save_field_bundle and save_crop_harvest can both write harvested_bushels (and
-- harvest_date). Last-write-wins is acceptable and intentional;
-- save_crop_harvest is the focused quick-entry/offline path. Realized price is
-- kept separate from expected_price_per_bu and never overwrites it.

alter table public.crop_assignments
  add column actual_price_per_bu numeric(12, 6)
    check (actual_price_per_bu is null or actual_price_per_bu >= 0);

create function public.save_crop_harvest(
  p_farm_id uuid,
  p_operation_id uuid,
  p_entry jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_receipt_user uuid;
  v_result jsonb;
  v_crop_assignment_id uuid;
  v_harvested_bushels numeric;
  v_harvest_date date;
  v_actual_price_per_bu numeric;
  v_planting_date date;
  v_saved public.crop_assignments%rowtype;
begin
  if p_farm_id is null or p_operation_id is null then
    raise exception 'farm ID and operation ID are required';
  end if;

  if v_caller is null then
    raise exception 'authentication is required';
  end if;

  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  if jsonb_typeof(p_entry) is distinct from 'object' then
    raise exception 'crop harvest entry must be a JSON object';
  end if;

  -- Serialize every replay before reading its durable receipt. Concurrent
  -- calls with the same operation ID therefore perform at most one update.
  perform pg_advisory_xact_lock(
    hashtext(p_farm_id::text),
    hashtext(p_operation_id::text)
  );

  select r.user_id, r.result
    into v_receipt_user, v_result
  from public.repository_write_receipts r
  where r.farm_id = p_farm_id
    and r.operation_id = p_operation_id;

  if found then
    if v_receipt_user <> v_caller then
      raise exception 'operation ID was already used by another user';
    end if;
    return v_result;
  end if;

  if (select count(*) from jsonb_object_keys(p_entry)) <> 4
    or exists (
      select 1
      from jsonb_object_keys(p_entry) as k(key)
      where k.key not in (
        'crop_assignment_id',
        'harvested_bushels',
        'harvest_date',
        'actual_price_per_bu'
      )
    )
  then
    raise exception 'crop harvest entry keys do not match the accepted contract';
  end if;

  if jsonb_typeof(p_entry -> 'crop_assignment_id') is distinct from 'string'
    or coalesce(jsonb_typeof(p_entry -> 'harvested_bushels'), 'null')
      not in ('number', 'null')
    or coalesce(jsonb_typeof(p_entry -> 'harvest_date'), 'null')
      not in ('string', 'null')
    or coalesce(jsonb_typeof(p_entry -> 'actual_price_per_bu'), 'null')
      not in ('number', 'null')
  then
    raise exception 'crop harvest entry fields have invalid JSON types';
  end if;

  begin
    v_crop_assignment_id := (p_entry ->> 'crop_assignment_id')::uuid;
    v_harvested_bushels := (p_entry ->> 'harvested_bushels')::numeric;
    v_harvest_date := (p_entry ->> 'harvest_date')::date;
    v_actual_price_per_bu := (p_entry ->> 'actual_price_per_bu')::numeric;
  exception
    when invalid_text_representation
      or datetime_field_overflow
      or numeric_value_out_of_range
    then raise exception 'crop assignment ID, harvest date, and amounts must be valid';
  end;

  if v_harvested_bushels is not null and v_harvested_bushels < 0 then
    raise exception 'harvested bushels cannot be negative';
  end if;

  if v_actual_price_per_bu is not null and v_actual_price_per_bu < 0 then
    raise exception 'actual price per bushel cannot be negative';
  end if;

  -- SECURITY DEFINER bypasses RLS, so both the existence check and the write
  -- include farm_id. An ID owned by another farm is intentionally indistinct
  -- from an unknown ID.
  select ca.planting_date
    into v_planting_date
  from public.crop_assignments ca
  where ca.id = v_crop_assignment_id
    and ca.farm_id = p_farm_id;

  if not found then
    raise exception 'crop assignment does not belong to this farm';
  end if;

  if v_harvest_date is not null
    and v_planting_date is not null
    and v_harvest_date < v_planting_date
  then
    raise exception 'harvest date cannot be before planting date';
  end if;

  -- No row lock: this is a plain farm-scoped update per the 0017 lesson. The
  -- existing crop_assignments_date_order constraint is the final concurrency-
  -- safe guard if planting_date changes between the check and this statement.
  update public.crop_assignments ca
  set
    harvested_bushels = v_harvested_bushels,
    harvest_date = v_harvest_date,
    actual_price_per_bu = v_actual_price_per_bu
  where ca.id = v_crop_assignment_id
    and ca.farm_id = p_farm_id
  returning ca.* into strict v_saved;

  v_result := to_jsonb(v_saved);

  insert into public.repository_write_receipts (
    farm_id,
    operation_id,
    user_id,
    result
  )
  values (
    p_farm_id,
    p_operation_id,
    v_caller,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.save_crop_harvest(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_crop_harvest(uuid, uuid, jsonb)
  to authenticated;
