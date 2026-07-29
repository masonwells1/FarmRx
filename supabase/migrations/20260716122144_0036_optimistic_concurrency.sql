-- DRAFT ONLY -- Foundation concurrency controls. Review and apply through the
-- normal migration release process; this repair loop does not touch live data.

create function public.save_field_bundle_versioned(
  p_farm_id uuid,
  p_operation_id uuid,
  p_expected_versions jsonb,
  p_draft jsonb
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
  v_field_id uuid;
  v_field public.fields%rowtype;
  v_arrangement_expected jsonb;
  v_arrangement public.arrangements%rowtype;
  v_crop_versions jsonb;
begin
  if p_farm_id is null or p_operation_id is null then raise exception 'farm ID and operation ID are required'; end if;
  if v_caller is null then raise exception 'authentication is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  if jsonb_typeof(p_draft) is distinct from 'object' then raise exception 'field draft must be a JSON object'; end if;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text));
  select r.user_id, r.result into v_receipt_user, v_result
  from public.repository_write_receipts r
  where r.farm_id = p_farm_id and r.operation_id = p_operation_id;
  if found then
    if v_receipt_user <> v_caller then raise exception 'operation ID was already used by another user'; end if;
    return v_result;
  end if;

  begin v_field_id := nullif(p_draft ->> 'id', '')::uuid;
  exception when invalid_text_representation then raise exception 'field ID is invalid'; end;
  if v_field_id is null then raise exception 'field ID is required'; end if;

  -- This is the same aggregate lock used by save_field_bundle. Harvest takes it
  -- too, so field and quick-harvest editors cannot pass their checks together.
  perform pg_advisory_xact_lock(hashtext('field-save'), hashtext(p_farm_id::text || ':' || v_field_id::text));

  select * into v_field from public.fields where id = v_field_id and farm_id = p_farm_id;
  if found then
    if jsonb_typeof(p_expected_versions) is distinct from 'object'
      or nullif(p_expected_versions ->> 'field_updated_at', '') is null
      or v_field.updated_at is distinct from (p_expected_versions ->> 'field_updated_at')::timestamptz
    then raise exception using errcode = 'PT409', message = 'FARM_RX_STALE_WRITE'; end if;

    v_arrangement_expected := p_expected_versions -> 'arrangement';
    if jsonb_typeof(v_arrangement_expected) is distinct from 'object' then
      raise exception using errcode = 'PT409', message = 'FARM_RX_STALE_WRITE';
    end if;
    select * into v_arrangement from public.arrangements
    where id = nullif(v_arrangement_expected ->> 'id', '')::uuid
      and farm_id = p_farm_id and field_id = v_field_id and effective_to is null;
    if not found or v_arrangement.updated_at is distinct from (v_arrangement_expected ->> 'updated_at')::timestamptz then
      raise exception using errcode = 'PT409', message = 'FARM_RX_STALE_WRITE';
    end if;

    -- Compare the entire mutable child set, not only rows still present in the
    -- submitted draft. This catches another editor adding/deleting a crop and
    -- prevents a stale full-bundle save from silently erasing that work.
    v_crop_versions := p_expected_versions -> 'crop_assignments';
    if jsonb_typeof(v_crop_versions) is distinct from 'array' then
      raise exception using errcode = 'PT409', message = 'FARM_RX_STALE_WRITE';
    end if;
    if jsonb_array_length(v_crop_versions) is distinct from (
        select count(*)::integer from public.crop_assignments c where c.farm_id=p_farm_id and c.field_id=v_field_id
      )
      or exists (
        select 1 from public.crop_assignments c
        left join lateral (
          select value from jsonb_array_elements(v_crop_versions)
          where value ->> 'id'=c.id::text limit 1
        ) expected on true
        where c.farm_id=p_farm_id and c.field_id=v_field_id
          and (expected.value is null or c.updated_at is distinct from (expected.value ->> 'updated_at')::timestamptz)
      )
    then raise exception using errcode = 'PT409', message = 'FARM_RX_STALE_WRITE'; end if;
  elsif p_expected_versions is not null then
    raise exception using errcode = 'PT409', message = 'FARM_RX_STALE_WRITE';
  end if;

  return public.save_field_bundle(p_farm_id, p_operation_id, p_draft - 'expected_versions');
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception using errcode = 'PT409', message = 'FARM_RX_STALE_WRITE';
end;
$$;

create function public.save_crop_harvest_versioned(
  p_farm_id uuid,
  p_operation_id uuid,
  p_expected_updated_at timestamptz,
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
  v_crop_id uuid;
  v_field_id uuid;
  v_current_updated_at timestamptz;
begin
  if p_farm_id is null or p_operation_id is null then raise exception 'farm ID and operation ID are required'; end if;
  if v_caller is null then raise exception 'authentication is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  if jsonb_typeof(p_entry) is distinct from 'object' then raise exception 'crop harvest entry must be a JSON object'; end if;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text));
  select r.user_id, r.result into v_receipt_user, v_result
  from public.repository_write_receipts r
  where r.farm_id = p_farm_id and r.operation_id = p_operation_id;
  if found then
    if v_receipt_user <> v_caller then raise exception 'operation ID was already used by another user'; end if;
    return v_result;
  end if;

  begin v_crop_id := nullif(p_entry ->> 'crop_assignment_id', '')::uuid;
  exception when invalid_text_representation then raise exception 'crop assignment ID is invalid'; end;
  select field_id into v_field_id from public.crop_assignments where id = v_crop_id and farm_id = p_farm_id;
  if not found then raise exception 'crop assignment does not belong to this farm'; end if;

  perform pg_advisory_xact_lock(hashtext('field-save'), hashtext(p_farm_id::text || ':' || v_field_id::text));
  select updated_at into v_current_updated_at from public.crop_assignments where id = v_crop_id and farm_id = p_farm_id;
  if not found or p_expected_updated_at is null or v_current_updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'PT409', message = 'FARM_RX_STALE_WRITE';
  end if;

  return public.save_crop_harvest(p_farm_id, p_operation_id, p_entry - 'expected_updated_at');
end;
$$;

revoke all on function public.save_field_bundle(uuid, uuid, jsonb) from authenticated;
revoke all on function public.save_crop_harvest(uuid, uuid, jsonb) from authenticated;
revoke all on function public.save_field_bundle_versioned(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_crop_harvest_versioned(uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.save_field_bundle_versioned(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.save_crop_harvest_versioned(uuid, uuid, timestamptz, jsonb) to authenticated;
