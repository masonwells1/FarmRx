-- DRAFT ONLY -- Adds an optional field weather point and the dedicated
-- set_field_location RPC. The migration is additive-safe after 0017 because
-- all three new columns are nullable and existing rows satisfy every check.
-- The SECURITY DEFINER RPC uses a plain UPDATE with no SELECT ... FOR UPDATE:
-- unlike the SECURITY INVOKER path fixed in 0017, it bypasses RLS, and the
-- farm-scoped UPDATE itself safely verifies ownership without an RLS trap.
-- It uses can_edit_farm, matching save_field_bundle; that predicate permits
-- active owners, managers, and workers while excluding read_only users and reps.

alter table public.fields
  add column latitude numeric(9, 6)
    check (latitude is null or latitude between -90 and 90),
  add column longitude numeric(9, 6)
    check (longitude is null or longitude between -180 and 180),
  add column location_source text
    check (location_source is null or location_source in ('gps', 'manual')),
  add constraint fields_location_coordinates_complete check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null)
  ),
  add constraint fields_location_source_requires_coordinates check (
    location_source is null
    or (latitude is not null and longitude is not null)
  );

create function public.set_field_location(
  p_farm_id uuid,
  p_field_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_field public.fields%rowtype;
begin
  if v_caller is null then
    raise exception 'authentication is required';
  end if;

  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'latitude and longitude are required';
  end if;
  if p_latitude not between -90 and 90 then
    raise exception 'latitude must be between -90 and 90';
  end if;
  if p_longitude not between -180 and 180 then
    raise exception 'longitude must be between -180 and 180';
  end if;
  if p_source is null or p_source not in ('gps', 'manual') then
    raise exception 'location source must be gps or manual';
  end if;

  update public.fields
  set
    latitude = p_latitude,
    longitude = p_longitude,
    location_source = p_source
  where id = p_field_id
    and farm_id = p_farm_id
  returning * into v_field;

  if not found then
    raise exception 'field does not belong to this farm';
  end if;

  return to_jsonb(v_field);
end;
$$;

revoke all on function public.set_field_location(uuid, uuid, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.set_field_location(uuid, uuid, numeric, numeric, text)
  to authenticated;
