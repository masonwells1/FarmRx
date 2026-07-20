-- Post-browser proof for Scenario MR January. Read-only assertions only.

begin transaction read only;

do $proof$
declare
  v_farm_id constant uuid := '27010000-0000-4000-8000-000000000001';
  v_owner_id constant uuid := '27000000-0000-4000-8000-000000000001';
  v_entity_id constant uuid := '27011000-0000-4000-8000-000000000001';
  v_field_id constant uuid := '27020000-0000-4000-8000-000000000001';
  v_arrangement_id constant uuid := '27021000-0000-4000-8000-000000000001';
  v_crop_id constant uuid := '27030000-0000-4000-8000-000000000001';
  v_outcome_count bigint;
begin
  if (select count(*) from public.fields) <> 1 or not exists (
    select 1 from public.fields
    where id = v_field_id
      and farm_id = v_farm_id
      and operating_entity_id = v_entity_id
      and name = 'Maple East 160'
      and total_acres = 160.00
      and county = 'Jackson County'
      and state = 'IL'
      and legal_description is null
      and fsa_farm_number is null
      and fsa_tract_number is null
      and soil_productivity_index is null
      and latitude is null
      and longitude is null
      and location_source is null
      and is_active is true
  ) then
    raise exception 'MR January failed: exact field row is missing or extra fields exist';
  end if;

  if (select count(*) from public.arrangements) <> 1 or not exists (
    select 1 from public.arrangements
    where id = v_arrangement_id
      and farm_id = v_farm_id
      and field_id = v_field_id
      and arrangement_type = 'owned'
      and effective_from = date '2027-01-01'
      and effective_to is null
      and landlord_name is null
      and landlord_phone is null
      and landlord_contact_notes is null
      and cash_rent_per_acre is null
      and flex_bonus_formula is null
      and landlord_crop_pct is null
      and landlord_seed_pct = 0
      and landlord_fertilizer_pct = 0
      and landlord_chemical_pct = 0
      and landlord_fuel_pct = 0
      and landlord_labor_custom_pct = 0
      and landlord_crop_insurance_pct = 0
      and landlord_equipment_pct = 0
      and landlord_interest_pct = 0
      and landlord_other_input_pct = 0
      and notes is null
  ) then
    raise exception 'MR January failed: exact owned arrangement is missing';
  end if;

  if (select count(*) from public.crop_assignments) <> 1 or not exists (
    select 1 from public.crop_assignments
    where id = v_crop_id
      and farm_id = v_farm_id
      and field_id = v_field_id
      and crop_year = 2027
      and commodity_id = 'corn_yellow'
      and planting_sequence = 1
      and planted_acres = 160.00
      and expected_yield_per_acre = 200.0000
      and variety is null
      and planting_date is null
      and harvest_date is null
      and harvested_bushels is null
      and expected_price_per_bu is null
      and actual_price_per_bu is null
      and notes is null
  ) then
    raise exception 'MR January failed: exact crop assignment is missing';
  end if;

  if (select count(*) from public.repository_write_receipts
      where farm_id = v_farm_id and user_id = v_owner_id and result ? 'field') <> 5 then
    raise exception 'MR January failed: browser did not produce exactly five field-write receipts';
  end if;

  select
      (select count(*) from public.programs)
    + (select count(*) from public.program_passes)
    + (select count(*) from public.program_pass_products)
    + (select count(*) from public.program_assignments)
    + (select count(*) from public.assigned_program_passes)
    + (select count(*) from public.assigned_program_pass_products)
    + (select count(*) from public.inventory_receipts)
    + (select count(*) from public.inventory_receipt_lines)
    + (select count(*) from public.inventory_adjustments)
    + (select count(*) from public.application_records)
    + (select count(*) from public.application_products)
    + (select count(*) from public.scouting_notes)
    + (select count(*) from public.scouting_photos)
    + (select count(*) from public.farm_tasks)
    + (select count(*) from public.notifications)
    + (select count(*) from public.production_estimates)
    + (select count(*) from public.grain_contracts)
    + (select count(*) from public.grain_contract_deliveries)
    + (select count(*) from public.grain_bins)
    + (select count(*) from public.bin_inventory)
    + (select count(*) from public.bin_transactions)
  into v_outcome_count;

  if v_outcome_count <> 0 then
    raise exception 'MR January failed: % non-January outcome rows changed', v_outcome_count;
  end if;

  if (select count(*) from public.inventory_on_hand where farm_id = v_farm_id) <> 1
     or not exists (
       select 1 from public.inventory_on_hand
       where farm_id = v_farm_id
         and product_id = '27040000-0000-4000-8000-000000000000'
         and on_hand_quantity = 0
     ) then
    raise exception 'MR January failed: starting inventory changed';
  end if;

  if (select count(*) from public.cash_bids where farm_id = v_farm_id) <> 1 then
    raise exception 'MR January failed: starting cash bid changed';
  end if;
end
$proof$;

select 'Maple Ridge January browser/database proof: PASS' as proof;

rollback;
