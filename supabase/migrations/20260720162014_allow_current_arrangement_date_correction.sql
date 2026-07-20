-- Preserve agreement history when a farmer corrects only the current terms'
-- start date. The original bundle RPC intentionally treats unchanged terms as
-- an in-place edit, but it also discarded the submitted effective date.

alter function public.save_field_bundle_versioned(uuid, uuid, jsonb, jsonb)
  rename to save_field_bundle_versioned_core;

revoke all on function public.save_field_bundle_versioned_core(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;

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
  v_candidate public.arrangements%rowtype;
  v_saved public.arrangements%rowtype;
  v_previous public.arrangements%rowtype;
  v_previous_exists boolean := false;
  v_closed_count integer := 0;
  v_terms_equal boolean := false;
begin
  if p_farm_id is null or p_operation_id is null then
    raise exception 'farm ID and operation ID are required';
  end if;
  if v_caller is null then raise exception 'authentication is required'; end if;
  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  -- Preserve the core RPC's immutable replay contract. A retry must return its
  -- original receipt and must never reinterpret it against newer history.
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text));
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

  v_result := public.save_field_bundle_versioned_core(
    p_farm_id,
    p_operation_id,
    p_expected_versions,
    p_draft
  );
  v_saved := jsonb_populate_record(null::public.arrangements, v_result -> 'arrangement');
  v_candidate := jsonb_populate_record(null::public.arrangements, p_draft -> 'arrangement');

  v_terms_equal :=
    v_saved.arrangement_type is not distinct from v_candidate.arrangement_type
    and v_saved.landlord_name is not distinct from nullif(btrim(v_candidate.landlord_name), '')
    and v_saved.landlord_phone is not distinct from nullif(btrim(v_candidate.landlord_phone), '')
    and v_saved.landlord_contact_notes is not distinct from nullif(btrim(v_candidate.landlord_contact_notes), '')
    and v_saved.cash_rent_per_acre is not distinct from v_candidate.cash_rent_per_acre
    and v_saved.flex_bonus_formula is not distinct from v_candidate.flex_bonus_formula
    and v_saved.landlord_crop_pct is not distinct from v_candidate.landlord_crop_pct
    and v_saved.landlord_seed_pct is not distinct from v_candidate.landlord_seed_pct
    and v_saved.landlord_fertilizer_pct is not distinct from v_candidate.landlord_fertilizer_pct
    and v_saved.landlord_chemical_pct is not distinct from v_candidate.landlord_chemical_pct
    and v_saved.landlord_fuel_pct is not distinct from v_candidate.landlord_fuel_pct
    and v_saved.landlord_labor_custom_pct is not distinct from v_candidate.landlord_labor_custom_pct
    and v_saved.landlord_crop_insurance_pct is not distinct from v_candidate.landlord_crop_insurance_pct
    and v_saved.landlord_equipment_pct is not distinct from v_candidate.landlord_equipment_pct
    and v_saved.landlord_interest_pct is not distinct from v_candidate.landlord_interest_pct
    and v_saved.landlord_other_input_pct is not distinct from v_candidate.landlord_other_input_pct
    and v_saved.notes is not distinct from nullif(btrim(v_candidate.notes), '');

  if v_terms_equal
    and v_candidate.effective_from is distinct from v_saved.effective_from
  then
    select count(*)::integer
      into v_closed_count
    from public.arrangements a
    where a.farm_id = p_farm_id
      and a.field_id = v_saved.field_id
      and a.id <> v_saved.id
      and a.effective_to is not null;

    if exists (
      select 1
      from public.arrangements a
      where a.farm_id = p_farm_id
        and a.field_id = v_saved.field_id
        and a.id <> v_saved.id
        and a.effective_from >= v_saved.effective_from
    ) then
      raise exception 'agreement history must be repaired before changing the current start date';
    end if;

    select a.*
      into v_previous
    from public.arrangements a
    where a.farm_id = p_farm_id
      and a.field_id = v_saved.field_id
      and a.id <> v_saved.id
      and a.effective_to is not null
      and a.effective_to = v_saved.effective_from - 1
    order by a.effective_from desc, a.id
    limit 1
    for update;
    v_previous_exists := found;

    if v_closed_count > 0 and not v_previous_exists then
      raise exception 'agreement history must be repaired before changing the current start date';
    end if;

    if v_previous_exists
      and v_candidate.effective_from <= v_previous.effective_from
    then
      raise exception 'the current agreement must start after the previous agreement';
    end if;

    if v_previous_exists then
      update public.arrangements
      set effective_to = v_candidate.effective_from - 1
      where id = v_previous.id
        and farm_id = p_farm_id;
    end if;

    update public.arrangements
    set effective_from = v_candidate.effective_from
    where id = v_saved.id
      and farm_id = p_farm_id
    returning * into v_saved;

    v_result := jsonb_set(v_result, '{arrangement}', to_jsonb(v_saved));
    update public.repository_write_receipts
    set result = v_result
    where farm_id = p_farm_id
      and operation_id = p_operation_id
      and user_id = v_caller;
  end if;

  return v_result;
end;
$$;

revoke all on function public.save_field_bundle_versioned(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_field_bundle_versioned(uuid, uuid, jsonb, jsonb)
  to authenticated;
