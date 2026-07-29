-- DRAFT ONLY -- Extend save_field_bundle flex-formula validation for Farm Rx.
-- Designed to run directly after the applied 0009-0013 migrations.
-- Review before applying to any database. DO NOT APPLY from this session.
--
-- Why: the applied 0009 save_field_bundle accepts ONLY the legacy per-unit flex
-- shape {type,trigger,bonus_rate}. The arrangement editor now also writes the
-- structured flex-lease shape {method,...} (docs/flex-lease-research.md §3/§4).
-- This migration replaces the SECURITY DEFINER function with a byte-identical
-- copy of 0009 EXCEPT the flex-formula validation block, which is extended to
-- accept EITHER the legacy shape (unchanged rules) OR the structured shape, and
-- to fail closed on everything else. The server now enforces at least the same
-- rules as the client (src/data/flexLeaseValidation.ts) for the two v1 methods.

create or replace function public.save_field_bundle(
  p_farm_id uuid,
  p_operation_id uuid,
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
  v_entity_id uuid;
  v_field public.fields%rowtype;
  v_existing_field public.fields%rowtype;
  v_field_exists boolean := false;

  v_arrangement_json jsonb;
  v_candidate public.arrangements%rowtype;
  v_current public.arrangements%rowtype;
  v_saved_arrangement public.arrangements%rowtype;
  v_current_exists boolean := false;
  v_terms_equal boolean := false;

  v_crop_json jsonb;
  v_normalized_crops jsonb := '[]'::jsonb;
  v_assignment jsonb;
  v_assignment_id uuid;
  v_assignment_is_new boolean;
  v_existing_assignment public.crop_assignments%rowtype;
  v_assignment_exists boolean;
  v_assignment_ids uuid[] := array[]::uuid[];
  v_assignment_keys text[] := array[]::text[];
  v_affected_years integer[] := array[]::integer[];
  v_crop_year integer;
  v_assignment_key text;
  v_crop_assignments jsonb;
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

  if jsonb_typeof(p_draft) is distinct from 'object' then
    raise exception 'field draft must be a JSON object';
  end if;

  -- Serialize every replay of this farm/operation pair before checking its
  -- receipt. This closes the concurrent lost-response replay race.
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

  -- Ignore every nested farm_id/user_id. Tenant and actor stamps come only
  -- from the authenticated arguments above.
  v_field_id := coalesce(nullif(p_draft ->> 'id', '')::uuid, gen_random_uuid());
  v_entity_id := nullif(p_draft ->> 'operating_entity_id', '')::uuid;

  -- Distinct operations against one field must make arrangement-history and
  -- affected-year decisions in order. Taking this lock before any field write
  -- also gives the waiting call a fresh statement snapshot afterward.
  perform pg_advisory_xact_lock(
    hashtext('field-save'),
    hashtext(p_farm_id::text || ':' || v_field_id::text)
  );

  if v_entity_id is null or not exists (
    select 1
    from public.entities e
    where e.id = v_entity_id
      and e.farm_id = p_farm_id
  ) then
    raise exception 'operating entity does not belong to this farm';
  end if;

  select f.*
    into v_existing_field
  from public.fields f
  where f.id = v_field_id
  for update;
  v_field_exists := found;

  if v_field_exists and v_existing_field.farm_id <> p_farm_id then
    raise exception 'field does not belong to this farm';
  end if;

  if v_field_exists then
    update public.fields
    set
      operating_entity_id = v_entity_id,
      name = btrim(p_draft ->> 'name'),
      legal_description = nullif(btrim(p_draft ->> 'legal_description'), ''),
      county = nullif(btrim(p_draft ->> 'county'), ''),
      state = nullif(btrim(p_draft ->> 'state'), ''),
      total_acres = (p_draft ->> 'total_acres')::numeric,
      fsa_farm_number = nullif(btrim(p_draft ->> 'fsa_farm_number'), ''),
      fsa_tract_number = nullif(btrim(p_draft ->> 'fsa_tract_number'), ''),
      soil_productivity_index = nullif(p_draft ->> 'soil_productivity_index', '')::numeric
    where id = v_field_id
      and farm_id = p_farm_id
    returning * into v_field;
  else
    insert into public.fields (
      id,
      farm_id,
      operating_entity_id,
      name,
      legal_description,
      county,
      state,
      total_acres,
      fsa_farm_number,
      fsa_tract_number,
      soil_productivity_index
    )
    values (
      v_field_id,
      p_farm_id,
      v_entity_id,
      btrim(p_draft ->> 'name'),
      nullif(btrim(p_draft ->> 'legal_description'), ''),
      nullif(btrim(p_draft ->> 'county'), ''),
      nullif(btrim(p_draft ->> 'state'), ''),
      (p_draft ->> 'total_acres')::numeric,
      nullif(btrim(p_draft ->> 'fsa_farm_number'), ''),
      nullif(btrim(p_draft ->> 'fsa_tract_number'), ''),
      nullif(p_draft ->> 'soil_productivity_index', '')::numeric
    )
    returning * into v_field;
  end if;

  v_arrangement_json := p_draft -> 'arrangement';
  if jsonb_typeof(v_arrangement_json) is distinct from 'object' then
    raise exception 'arrangement must be a JSON object';
  end if;

  v_candidate.id := coalesce(
    nullif(v_arrangement_json ->> 'id', '')::uuid,
    gen_random_uuid()
  );
  v_candidate.farm_id := p_farm_id;
  v_candidate.field_id := v_field.id;
  v_candidate.arrangement_type :=
    (v_arrangement_json ->> 'arrangement_type')::public.land_arrangement_type;
  v_candidate.landlord_name :=
    nullif(btrim(v_arrangement_json ->> 'landlord_name'), '');
  v_candidate.landlord_phone :=
    nullif(btrim(v_arrangement_json ->> 'landlord_phone'), '');
  v_candidate.landlord_contact_notes :=
    nullif(btrim(v_arrangement_json ->> 'landlord_contact_notes'), '');
  v_candidate.effective_from :=
    (v_arrangement_json ->> 'effective_from')::date;
  v_candidate.effective_to := null;
  v_candidate.cash_rent_per_acre :=
    nullif(v_arrangement_json ->> 'cash_rent_per_acre', '')::numeric;
  v_candidate.flex_bonus_formula := v_arrangement_json -> 'flex_bonus_formula';
  if v_candidate.flex_bonus_formula = 'null'::jsonb then
    v_candidate.flex_bonus_formula := null;
  end if;
  v_candidate.landlord_crop_pct :=
    nullif(v_arrangement_json ->> 'landlord_crop_pct', '')::numeric;
  v_candidate.landlord_seed_pct :=
    coalesce(nullif(v_arrangement_json ->> 'landlord_seed_pct', '')::numeric, 0);
  v_candidate.landlord_fertilizer_pct :=
    coalesce(nullif(v_arrangement_json ->> 'landlord_fertilizer_pct', '')::numeric, 0);
  v_candidate.landlord_chemical_pct :=
    coalesce(nullif(v_arrangement_json ->> 'landlord_chemical_pct', '')::numeric, 0);
  v_candidate.landlord_fuel_pct :=
    coalesce(nullif(v_arrangement_json ->> 'landlord_fuel_pct', '')::numeric, 0);
  v_candidate.landlord_labor_custom_pct :=
    coalesce(nullif(v_arrangement_json ->> 'landlord_labor_custom_pct', '')::numeric, 0);
  v_candidate.landlord_crop_insurance_pct :=
    coalesce(nullif(v_arrangement_json ->> 'landlord_crop_insurance_pct', '')::numeric, 0);
  v_candidate.landlord_equipment_pct :=
    coalesce(nullif(v_arrangement_json ->> 'landlord_equipment_pct', '')::numeric, 0);
  v_candidate.landlord_interest_pct :=
    coalesce(nullif(v_arrangement_json ->> 'landlord_interest_pct', '')::numeric, 0);
  v_candidate.landlord_other_input_pct :=
    coalesce(nullif(v_arrangement_json ->> 'landlord_other_input_pct', '')::numeric, 0);
  v_candidate.notes := nullif(btrim(v_arrangement_json ->> 'notes'), '');
  v_candidate.created_at := now();
  v_candidate.updated_at := now();

  -- Module 1 intentionally stores the current UI formula without translating
  -- it to a different calculation contract from a later module. The saved
  -- formula may be the legacy per-unit shape {type,trigger,bonus_rate} OR the
  -- structured flex-lease shape {method,...} (docs/flex-lease-research.md
  -- §3/§4). Both shapes are validated below so a bad formula fails closed at
  -- this SECURITY DEFINER boundary with at least the same rules the client
  -- enforces in src/data/flexLeaseValidation.ts. Every read of the formula is
  -- a fixed jsonb accessor against static SQL; no JSON value is ever SQL text.
  if v_candidate.arrangement_type = 'flex_cash_rent' then
    if jsonb_typeof(v_candidate.flex_bonus_formula) is distinct from 'object' then
      raise exception 'flex rent formula is invalid';
    end if;

    if (v_candidate.flex_bonus_formula -> 'method') is not null then
      -- Structured flex-lease shape. Reject any key outside the documented
      -- schema so a forged formula cannot smuggle extra fields past this
      -- boundary (fail closed on unknown keys).
      if exists (
        select 1
        from jsonb_object_keys(v_candidate.flex_bonus_formula) as fk(key)
        where fk.key not in (
          'method',
          'base_rent_per_acre',
          'rate_pct',
          'trigger_revenue_per_acre',
          'base_price_per_bu',
          'base_yield_per_acre',
          'min_rent_per_acre',
          'max_rent_per_acre',
          'price_source_note'
        )
      ) then
        raise exception 'flex rent formula is invalid';
      end if;

      -- Only the two v1 methods are computable. The reserved lease-form methods
      -- base_flex_price / base_flex_price_yield are rejected until implemented.
      if jsonb_typeof(v_candidate.flex_bonus_formula -> 'method') is distinct from 'string'
        or v_candidate.flex_bonus_formula ->> 'method' not in ('base_plus_bonus', 'pct_of_revenue')
      then
        raise exception 'flex rent formula is invalid';
      end if;

      -- Both v1 methods require rate_pct as a jsonb number in (0, 100].
      if jsonb_typeof(v_candidate.flex_bonus_formula -> 'rate_pct') is distinct from 'number'
        or (v_candidate.flex_bonus_formula ->> 'rate_pct')::numeric <= 0
        or (v_candidate.flex_bonus_formula ->> 'rate_pct')::numeric > 100
      then
        raise exception 'flex rent formula is invalid';
      end if;

      -- base_plus_bonus additionally requires a base rent and a revenue
      -- trigger, both finite jsonb numbers >= 0.
      if v_candidate.flex_bonus_formula ->> 'method' = 'base_plus_bonus' and (
        jsonb_typeof(v_candidate.flex_bonus_formula -> 'base_rent_per_acre') is distinct from 'number'
        or (v_candidate.flex_bonus_formula ->> 'base_rent_per_acre')::numeric < 0
        or jsonb_typeof(v_candidate.flex_bonus_formula -> 'trigger_revenue_per_acre') is distinct from 'number'
        or (v_candidate.flex_bonus_formula ->> 'trigger_revenue_per_acre')::numeric < 0
      ) then
        raise exception 'flex rent formula is invalid';
      end if;

      -- Optional floor: when present and not JSON null it must be a jsonb
      -- number >= 0.
      if coalesce(jsonb_typeof(v_candidate.flex_bonus_formula -> 'min_rent_per_acre'), 'null') <> 'null' and (
        jsonb_typeof(v_candidate.flex_bonus_formula -> 'min_rent_per_acre') is distinct from 'number'
        or (v_candidate.flex_bonus_formula ->> 'min_rent_per_acre')::numeric < 0
      ) then
        raise exception 'flex rent formula is invalid';
      end if;

      -- Optional cap: same rule as the floor.
      if coalesce(jsonb_typeof(v_candidate.flex_bonus_formula -> 'max_rent_per_acre'), 'null') <> 'null' and (
        jsonb_typeof(v_candidate.flex_bonus_formula -> 'max_rent_per_acre') is distinct from 'number'
        or (v_candidate.flex_bonus_formula ->> 'max_rent_per_acre')::numeric < 0
      ) then
        raise exception 'flex rent formula is invalid';
      end if;

      -- When both bounds are present numbers, the floor must not exceed the cap.
      if jsonb_typeof(v_candidate.flex_bonus_formula -> 'min_rent_per_acre') is not distinct from 'number'
        and jsonb_typeof(v_candidate.flex_bonus_formula -> 'max_rent_per_acre') is not distinct from 'number'
        and (v_candidate.flex_bonus_formula ->> 'min_rent_per_acre')::numeric
            > (v_candidate.flex_bonus_formula ->> 'max_rent_per_acre')::numeric
      then
        raise exception 'flex rent formula is invalid';
      end if;

      -- For base_plus_bonus the base rent is the floor, so a present cap must
      -- not fall below it (mirrors structuredFlexFormulaError on the client).
      -- base_rent_per_acre is already proven a jsonb number >= 0 above.
      if v_candidate.flex_bonus_formula ->> 'method' = 'base_plus_bonus'
        and jsonb_typeof(v_candidate.flex_bonus_formula -> 'max_rent_per_acre') is not distinct from 'number'
        and (v_candidate.flex_bonus_formula ->> 'max_rent_per_acre')::numeric
            < (v_candidate.flex_bonus_formula ->> 'base_rent_per_acre')::numeric
      then
        raise exception 'flex rent formula is invalid';
      end if;

      -- Optional price source note: display-only text, at most 500 characters.
      if coalesce(jsonb_typeof(v_candidate.flex_bonus_formula -> 'price_source_note'), 'null') <> 'null' and (
        jsonb_typeof(v_candidate.flex_bonus_formula -> 'price_source_note') is distinct from 'string'
        or char_length(v_candidate.flex_bonus_formula ->> 'price_source_note') > 500
      ) then
        raise exception 'flex rent formula is invalid';
      end if;
    else
      -- Legacy per-unit shape {type,trigger,bonus_rate}. Rules unchanged from
      -- migration 0009 so already-saved formulas keep validating identically.
      if v_candidate.flex_bonus_formula ->> 'type' not in ('price', 'yield', 'revenue')
        or jsonb_typeof(v_candidate.flex_bonus_formula -> 'trigger') is distinct from 'number'
        or (v_candidate.flex_bonus_formula ->> 'trigger')::numeric < 0
        or jsonb_typeof(v_candidate.flex_bonus_formula -> 'bonus_rate') is distinct from 'number'
        or (v_candidate.flex_bonus_formula ->> 'bonus_rate')::numeric <= 0
      then
        raise exception 'flex rent formula is invalid';
      end if;
    end if;
  end if;

  select a.*
    into v_current
  from public.arrangements a
  where a.field_id = v_field.id
    and a.farm_id = p_farm_id
    and a.effective_to is null
  for update;
  v_current_exists := found;

  if v_current_exists then
    v_terms_equal :=
      v_current.arrangement_type is not distinct from v_candidate.arrangement_type
      and v_current.landlord_name is not distinct from v_candidate.landlord_name
      and v_current.landlord_phone is not distinct from v_candidate.landlord_phone
      and v_current.landlord_contact_notes is not distinct from v_candidate.landlord_contact_notes
      and v_current.cash_rent_per_acre is not distinct from v_candidate.cash_rent_per_acre
      and v_current.flex_bonus_formula is not distinct from v_candidate.flex_bonus_formula
      and v_current.landlord_crop_pct is not distinct from v_candidate.landlord_crop_pct
      and v_current.landlord_seed_pct is not distinct from v_candidate.landlord_seed_pct
      and v_current.landlord_fertilizer_pct is not distinct from v_candidate.landlord_fertilizer_pct
      and v_current.landlord_chemical_pct is not distinct from v_candidate.landlord_chemical_pct
      and v_current.landlord_fuel_pct is not distinct from v_candidate.landlord_fuel_pct
      and v_current.landlord_labor_custom_pct is not distinct from v_candidate.landlord_labor_custom_pct
      and v_current.landlord_crop_insurance_pct is not distinct from v_candidate.landlord_crop_insurance_pct
      and v_current.landlord_equipment_pct is not distinct from v_candidate.landlord_equipment_pct
      and v_current.landlord_interest_pct is not distinct from v_candidate.landlord_interest_pct
      and v_current.landlord_other_input_pct is not distinct from v_candidate.landlord_other_input_pct
      and v_current.notes is not distinct from v_candidate.notes;

    if v_terms_equal or v_candidate.effective_from = v_current.effective_from then
      update public.arrangements
      set
        arrangement_type = v_candidate.arrangement_type,
        landlord_name = v_candidate.landlord_name,
        landlord_phone = v_candidate.landlord_phone,
        landlord_contact_notes = v_candidate.landlord_contact_notes,
        effective_from = v_current.effective_from,
        cash_rent_per_acre = v_candidate.cash_rent_per_acre,
        flex_bonus_formula = v_candidate.flex_bonus_formula,
        landlord_crop_pct = v_candidate.landlord_crop_pct,
        landlord_seed_pct = v_candidate.landlord_seed_pct,
        landlord_fertilizer_pct = v_candidate.landlord_fertilizer_pct,
        landlord_chemical_pct = v_candidate.landlord_chemical_pct,
        landlord_fuel_pct = v_candidate.landlord_fuel_pct,
        landlord_labor_custom_pct = v_candidate.landlord_labor_custom_pct,
        landlord_crop_insurance_pct = v_candidate.landlord_crop_insurance_pct,
        landlord_equipment_pct = v_candidate.landlord_equipment_pct,
        landlord_interest_pct = v_candidate.landlord_interest_pct,
        landlord_other_input_pct = v_candidate.landlord_other_input_pct,
        notes = v_candidate.notes
      where id = v_current.id
        and farm_id = p_farm_id
      returning * into v_saved_arrangement;
    elsif v_candidate.effective_from < v_current.effective_from then
      raise exception 'a changed arrangement must start after the current arrangement';
    else
      update public.arrangements
      set effective_to = v_candidate.effective_from - 1
      where id = v_current.id
        and farm_id = p_farm_id;

      insert into public.arrangements (
        id, farm_id, field_id, arrangement_type, landlord_name,
        landlord_phone, landlord_contact_notes, effective_from, effective_to,
        cash_rent_per_acre, flex_bonus_formula, landlord_crop_pct,
        landlord_seed_pct, landlord_fertilizer_pct, landlord_chemical_pct,
        landlord_fuel_pct, landlord_labor_custom_pct,
        landlord_crop_insurance_pct, landlord_equipment_pct,
        landlord_interest_pct, landlord_other_input_pct, notes
      )
      values (
        v_candidate.id, p_farm_id, v_field.id, v_candidate.arrangement_type,
        v_candidate.landlord_name, v_candidate.landlord_phone,
        v_candidate.landlord_contact_notes, v_candidate.effective_from, null,
        v_candidate.cash_rent_per_acre, v_candidate.flex_bonus_formula,
        v_candidate.landlord_crop_pct, v_candidate.landlord_seed_pct,
        v_candidate.landlord_fertilizer_pct, v_candidate.landlord_chemical_pct,
        v_candidate.landlord_fuel_pct, v_candidate.landlord_labor_custom_pct,
        v_candidate.landlord_crop_insurance_pct, v_candidate.landlord_equipment_pct,
        v_candidate.landlord_interest_pct, v_candidate.landlord_other_input_pct,
        v_candidate.notes
      )
      returning * into v_saved_arrangement;
    end if;
  else
    insert into public.arrangements (
      id, farm_id, field_id, arrangement_type, landlord_name,
      landlord_phone, landlord_contact_notes, effective_from, effective_to,
      cash_rent_per_acre, flex_bonus_formula, landlord_crop_pct,
      landlord_seed_pct, landlord_fertilizer_pct, landlord_chemical_pct,
      landlord_fuel_pct, landlord_labor_custom_pct,
      landlord_crop_insurance_pct, landlord_equipment_pct,
      landlord_interest_pct, landlord_other_input_pct, notes
    )
    values (
      v_candidate.id, p_farm_id, v_field.id, v_candidate.arrangement_type,
      v_candidate.landlord_name, v_candidate.landlord_phone,
      v_candidate.landlord_contact_notes, v_candidate.effective_from, null,
      v_candidate.cash_rent_per_acre, v_candidate.flex_bonus_formula,
      v_candidate.landlord_crop_pct, v_candidate.landlord_seed_pct,
      v_candidate.landlord_fertilizer_pct, v_candidate.landlord_chemical_pct,
      v_candidate.landlord_fuel_pct, v_candidate.landlord_labor_custom_pct,
      v_candidate.landlord_crop_insurance_pct, v_candidate.landlord_equipment_pct,
      v_candidate.landlord_interest_pct, v_candidate.landlord_other_input_pct,
      v_candidate.notes
    )
    returning * into v_saved_arrangement;
  end if;

  v_crop_json := p_draft -> 'crop_assignments';
  if jsonb_typeof(v_crop_json) is distinct from 'array' then
    raise exception 'crop assignments must be a JSON array';
  end if;

  -- Normalize and validate the complete draft before deleting or changing any
  -- crop row. SQL statements are static; JSON values are never SQL text.
  for v_assignment in
    select value from jsonb_array_elements(v_crop_json)
  loop
    if jsonb_typeof(v_assignment) is distinct from 'object' then
      raise exception 'each crop assignment must be a JSON object';
    end if;

    if jsonb_typeof(v_assignment -> 'is_new') is distinct from 'boolean' then
      raise exception 'each crop assignment must include boolean is_new';
    end if;

    v_assignment_id := coalesce(
      nullif(v_assignment ->> 'id', '')::uuid,
      gen_random_uuid()
    );
    v_assignment_is_new := (v_assignment ->> 'is_new')::boolean;
    v_crop_year := (v_assignment ->> 'crop_year')::integer;
    v_assignment_key := concat_ws(
      '|',
      v_crop_year::text,
      v_assignment ->> 'commodity_id',
      (v_assignment ->> 'planting_sequence')::integer::text
    );

    if v_assignment_id = any(v_assignment_ids) then
      raise exception 'crop assignment ID is duplicated in the draft';
    end if;
    if v_assignment_key = any(v_assignment_keys) then
      raise exception 'crop assignments must have unique crop, year, and planting sequence combinations';
    end if;

    select ca.*
      into v_existing_assignment
    from public.crop_assignments ca
    where ca.id = v_assignment_id
    for update;
    v_assignment_exists := found;

    if v_assignment_is_new and v_assignment_exists then
      raise exception 'new crop assignment ID already exists';
    end if;

    if not v_assignment_is_new and not v_assignment_exists then
      raise exception 'existing crop assignment ID does not exist';
    end if;

    if not v_assignment_is_new and (
      v_existing_assignment.farm_id <> p_farm_id
      or v_existing_assignment.field_id <> v_field.id
    ) then
      raise exception 'existing crop assignment does not belong to this field and farm';
    end if;

    if not v_assignment_is_new and v_existing_assignment.crop_year <> v_crop_year then
      raise exception 'an existing crop assignment cannot be moved to another crop year';
    end if;

    if not exists (
      select 1
      from public.commodities c
      where c.id = v_assignment ->> 'commodity_id'
        and c.is_active = true
    ) then
      raise exception 'commodity is not active or does not exist';
    end if;

    -- Force casts now so malformed JSON fails before crop rows are changed.
    perform (v_assignment ->> 'planted_acres')::numeric;
    perform (v_assignment ->> 'planting_sequence')::smallint;
    perform nullif(v_assignment ->> 'planting_date', '')::date;
    perform nullif(v_assignment ->> 'harvest_date', '')::date;
    perform nullif(v_assignment ->> 'harvested_bushels', '')::numeric;
    perform nullif(v_assignment ->> 'expected_yield_per_acre', '')::numeric;
    perform nullif(v_assignment ->> 'expected_price_per_bu', '')::numeric;

    v_assignment_ids := array_append(v_assignment_ids, v_assignment_id);
    v_assignment_keys := array_append(v_assignment_keys, v_assignment_key);
    if not v_crop_year = any(v_affected_years) then
      v_affected_years := array_append(v_affected_years, v_crop_year);
    end if;
    v_normalized_crops := v_normalized_crops || jsonb_build_array(
      v_assignment || jsonb_build_object('id', v_assignment_id)
    );
  end loop;

  -- Empty means no assignment change. Otherwise, omissions delete rows only
  -- in the explicitly supplied years; all other years remain untouched.
  if jsonb_array_length(v_normalized_crops) > 0 then
    delete from public.crop_assignments ca
    where ca.farm_id = p_farm_id
      and ca.field_id = v_field.id
      and ca.crop_year = any(v_affected_years)
      and not (ca.id = any(v_assignment_ids));

    for v_assignment in
      select value from jsonb_array_elements(v_normalized_crops)
    loop
      v_assignment_id := (v_assignment ->> 'id')::uuid;

      if not (v_assignment ->> 'is_new')::boolean then
        update public.crop_assignments
        set
          crop_year = (v_assignment ->> 'crop_year')::integer,
          commodity_id = v_assignment ->> 'commodity_id',
          planting_sequence = (v_assignment ->> 'planting_sequence')::smallint,
          planted_acres = (v_assignment ->> 'planted_acres')::numeric,
          variety = nullif(btrim(v_assignment ->> 'variety'), ''),
          planting_date = nullif(v_assignment ->> 'planting_date', '')::date,
          harvest_date = nullif(v_assignment ->> 'harvest_date', '')::date,
          harvested_bushels = nullif(v_assignment ->> 'harvested_bushels', '')::numeric,
          expected_yield_per_acre = nullif(v_assignment ->> 'expected_yield_per_acre', '')::numeric,
          expected_price_per_bu = nullif(v_assignment ->> 'expected_price_per_bu', '')::numeric,
          notes = nullif(btrim(v_assignment ->> 'notes'), '')
        where id = v_assignment_id
          and farm_id = p_farm_id
          and field_id = v_field.id;
      else
        insert into public.crop_assignments (
          id, farm_id, field_id, crop_year, commodity_id,
          planting_sequence, planted_acres, variety, planting_date,
          harvest_date, harvested_bushels, expected_yield_per_acre,
          expected_price_per_bu, notes
        )
        values (
          v_assignment_id, p_farm_id, v_field.id,
          (v_assignment ->> 'crop_year')::integer,
          v_assignment ->> 'commodity_id',
          (v_assignment ->> 'planting_sequence')::smallint,
          (v_assignment ->> 'planted_acres')::numeric,
          nullif(btrim(v_assignment ->> 'variety'), ''),
          nullif(v_assignment ->> 'planting_date', '')::date,
          nullif(v_assignment ->> 'harvest_date', '')::date,
          nullif(v_assignment ->> 'harvested_bushels', '')::numeric,
          nullif(v_assignment ->> 'expected_yield_per_acre', '')::numeric,
          nullif(v_assignment ->> 'expected_price_per_bu', '')::numeric,
          nullif(btrim(v_assignment ->> 'notes'), '')
        );
      end if;
    end loop;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(ca) order by ca.crop_year, ca.planting_sequence, ca.commodity_id, ca.id),
    '[]'::jsonb
  )
    into v_crop_assignments
  from public.crop_assignments ca
  where ca.farm_id = p_farm_id
    and ca.field_id = v_field.id;

  -- Refresh rows after triggers so the receipt contains exactly the canonical
  -- values a replay and the TypeScript strict mapper will receive.
  select f.* into v_field
  from public.fields f
  where f.id = v_field.id
    and f.farm_id = p_farm_id;

  select a.* into v_saved_arrangement
  from public.arrangements a
  where a.id = v_saved_arrangement.id
    and a.farm_id = p_farm_id;

  v_result := jsonb_build_object(
    'field', to_jsonb(v_field),
    'arrangement', to_jsonb(v_saved_arrangement),
    'cropAssignments', v_crop_assignments
  );

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

revoke all on function public.save_field_bundle(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_field_bundle(uuid, uuid, jsonb)
  to authenticated;
