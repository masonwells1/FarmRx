-- Post-browser proof for Scenario MR February. Read-only assertions only.

begin transaction read only;

do $proof$
declare
  v_farm constant uuid := '27010000-0000-4000-8000-000000000001';
  v_owner constant uuid := '27000000-0000-4000-8000-000000000001';
  v_crop constant uuid := '27030000-0000-4000-8000-000000000001';
begin
  if (select count(*) from public.programs) <> 1 or not exists (
    select 1 from public.programs where id = '27050000-0000-4000-8000-000000000001'
      and farm_id = v_farm and name = 'Maple 2027 Corn Program'
      and program_kind = 'chemical' and commodity_id is null and crop_year = 2027
      and notes is null and revision = 2 and is_archived is false
  ) then raise exception 'MR February failed: exact Program row is missing'; end if;

  if (select count(*) from public.program_passes) <> 1 or not exists (
    select 1 from public.program_passes where id = '27051000-0000-4000-8000-000000000001'
      and farm_id = v_farm and program_id = '27050000-0000-4000-8000-000000000001'
      and sequence = 1 and name = 'Post-emerge synthetic pass' and pass_type = 'post'
      and activity_type = 'spray' and timing_label is null and target_date = date '2027-05-20'
      and planting_offset_days is null and reminder_lead_days = 3 and notes is null and is_archived is false
  ) then raise exception 'MR February failed: exact Program pass row is missing'; end if;

  if (select count(*) from public.program_pass_products) <> 1 or not exists (
    select 1 from public.program_pass_products where id = '27051100-0000-4000-8000-000000000001'
      and farm_id = v_farm and program_pass_id = '27051000-0000-4000-8000-000000000001'
      and sequence = 1 and product_name = 'Free-Typed Program Herbicide'
      and rate_text = '10.00' and unit_text = 'gal total' and estimated_cost_per_acre = 7.0000
      and catalog_product_id is null and notes is null and is_archived is false
  ) then raise exception 'MR February failed: exact free-typed Program product row is missing'; end if;

  if (select count(*) from public.program_assignments) <> 1 or not exists (
    select 1 from public.program_assignments where id = '27052000-0000-4000-8000-000000000001'
      and farm_id = v_farm and program_id = '27050000-0000-4000-8000-000000000001'
      and crop_assignment_id = v_crop and program_name_snapshot = 'Maple 2027 Corn Program'
      and program_kind_snapshot = 'chemical' and status = 'active' and template_revision = 2
      and assigned_by = v_owner and archived_by is null and archived_at is null and archive_reason is null
  ) then raise exception 'MR February failed: exact assignment row is missing'; end if;

  if (select count(*) from public.assigned_program_passes) <> 1 or not exists (
    select 1 from public.assigned_program_passes where id = '27053000-0000-4000-8000-000000000001'
      and farm_id = v_farm and assignment_id = '27052000-0000-4000-8000-000000000001'
      and source_program_pass_id = '27051000-0000-4000-8000-000000000001' and source_revision = 2
      and sequence = 1 and name = 'Post-emerge synthetic pass' and pass_type = 'post'
      and activity_type = 'spray' and timing_label is null and target_date = date '2027-05-20'
      and planting_offset_days is null and reminder_lead_days = 3 and notes is null
      and due_on = date '2027-05-20' and due_source = 'template_date' and is_field_override is false
      and status = 'planned' and applied_on is null and applied_acres is null and application_record_id is null
  ) then raise exception 'MR February failed: exact assigned pass snapshot is missing'; end if;

  if (select count(*) from public.assigned_program_pass_products) <> 1 or not exists (
    select 1 from public.assigned_program_pass_products where id = '27053100-0000-4000-8000-000000000001'
      and farm_id = v_farm and assigned_pass_id = '27053000-0000-4000-8000-000000000001'
      and source_program_pass_product_id = '27051100-0000-4000-8000-000000000001'
      and sequence = 1 and product_name = 'Free-Typed Program Herbicide'
      and rate_text = '10.00' and unit_text = 'gal total' and estimated_cost_per_acre = 7.0000
      and catalog_product_id is null and notes is null and is_active is true
      and actual_product_name is null and actual_rate_text is null and actual_unit_text is null and actual_cost_per_acre is null
  ) then raise exception 'MR February failed: exact assigned product snapshot is missing'; end if;

  if (select count(*) from public.repository_write_receipts where farm_id = v_farm and user_id = v_owner) <> 8 then
    raise exception 'MR February failed: January plus February did not produce exactly eight write receipts';
  end if;

  if (select count(*) from public.fields) <> 1 or (select count(*) from public.arrangements) <> 1
     or (select count(*) from public.crop_assignments) <> 1 or not exists (
       select 1 from public.crop_assignments where id = v_crop and farm_id = v_farm
         and crop_year = 2027 and commodity_id = 'corn_yellow' and planting_sequence = 1
         and planted_acres = 160.00 and expected_yield_per_acre = 200.0000
         and planting_date is null and harvest_date is null and harvested_bushels is null
         and expected_price_per_bu is null and actual_price_per_bu is null and notes is null
     ) then raise exception 'MR February failed: January field/crop state changed'; end if;

  if (select count(*) from public.inventory_products where farm_id = v_farm) <> 1
     or (select count(*) from public.inventory_on_hand where farm_id = v_farm) <> 1
     or not exists (select 1 from public.inventory_on_hand where farm_id = v_farm
       and product_id = '27040000-0000-4000-8000-000000000000' and on_hand_quantity = 0)
     or (select count(*) from public.inventory_receipts) <> 0
     or (select count(*) from public.inventory_receipt_lines) <> 0
     or (select count(*) from public.inventory_adjustments) <> 0
     or (select count(*) from public.application_records) <> 0
     or (select count(*) from public.application_products) <> 0
     or (select count(*) from public.farm_tasks) <> 0
     or (select count(*) from public.notifications) <> 0
     or (select count(*) from public.production_estimates) <> 0
     or (select count(*) from public.grain_contracts) <> 0
     or (select count(*) from public.grain_contract_deliveries) <> 0
     or (select count(*) from public.grain_bins) <> 0
     or (select count(*) from public.bin_inventory) <> 0
     or (select count(*) from public.bin_transactions) <> 0
     or (select count(*) from public.cash_bids where farm_id = v_farm) <> 1
  then raise exception 'MR February failed: an explicit non-write boundary changed'; end if;
end
$proof$;

select 'Maple Ridge February browser/database proof: PASS' as proof;

rollback;
