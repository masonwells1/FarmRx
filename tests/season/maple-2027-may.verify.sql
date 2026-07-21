-- Post-browser proof for Scenario MR May. Read-only assertions only.
begin transaction read only;

do $proof$
declare
  v_farm constant uuid := '27010000-0000-4000-8000-000000000001';
  v_owner constant uuid := '27000000-0000-4000-8000-000000000001';
  v_pass constant uuid := '27053000-0000-4000-8000-000000000001';
  v_product constant uuid := '27053100-0000-4000-8000-000000000001';
  v_draft constant uuid := '27054000-0000-4000-8000-000000000001';
begin
  if (select count(*) from public.assigned_program_passes) <> 1 or not exists (
    select 1 from public.assigned_program_passes
    where id=v_pass and farm_id=v_farm and assignment_id='27052000-0000-4000-8000-000000000001'
      and source_program_pass_id='27051000-0000-4000-8000-000000000001'
      and sequence=1 and name='Post-emerge synthetic pass' and activity_type='spray'
      and due_on=date '2027-05-20' and due_source='template_date' and status='applied'
      and applied_on=date '2027-05-20' and applied_acres=160.00 and application_record_id=v_draft
      and skipped_on is null and skip_reason is null and cancel_reason is null
      and created_by=v_owner and updated_by=v_owner and updated_at > created_at
  ) then raise exception 'MR May failed: exact applied pass is missing'; end if;

  if (select count(*) from public.assigned_program_pass_products) <> 1 or not exists (
    select 1 from public.assigned_program_pass_products
    where id=v_product and farm_id=v_farm and assigned_pass_id=v_pass
      and source_program_pass_product_id='27051100-0000-4000-8000-000000000001'
      and sequence=1 and product_name='Free-Typed Program Herbicide' and rate_text='10.00'
      and unit_text='gal total' and estimated_cost_per_acre=7.0000 and is_active is true
      and actual_product_name='Free-Typed Program Herbicide' and actual_rate_text='10.00'
      and actual_unit_text='gal total' and actual_cost_per_acre=7.0000
      and created_by=v_owner and updated_by=v_owner and updated_at > created_at
  ) then raise exception 'MR May failed: exact actual Program product is missing'; end if;

  if (select count(*) from public.application_records) <> 1 or not exists (
    select 1 from public.application_records
    where id=v_draft and farm_id=v_farm and field_id='27020000-0000-4000-8000-000000000001'
      and crop_assignment_id='27030000-0000-4000-8000-000000000001' and status='draft'
      and application_date=date '2027-05-20' and applied_acres=160.00 and created_by=v_owner
      and notes='Created from Programs pass 27053000-0000-4000-8000-000000000001'
      and start_time is null and end_time is null and target_pest is null and applicator_user_id is null
      and applicator_name_snapshot is null and applicator_license_number_snapshot is null
      and applicator_license_state_snapshot is null and wind_speed_mph is null and wind_direction is null
      and temperature_f is null and relative_humidity_pct is null
      and corrects_application_id is null and correction_reason is null
      and completed_at is null and voided_at is null and voided_by is null and void_reason is null
      and created_at=updated_at
  ) then raise exception 'MR May failed: exact manifest draft application is missing'; end if;

  if (select count(*) from public.program_application_products) <> 1 or not exists (
    select 1 from public.program_application_products
    where farm_id=v_farm and application_record_id=v_draft and assigned_pass_id=v_pass
      and assignment_id='27052000-0000-4000-8000-000000000001'
      and program_id='27050000-0000-4000-8000-000000000001'
      and program_name_snapshot='Maple 2027 Corn Program' and program_kind_snapshot='chemical'
      and crop_assignment_id='27030000-0000-4000-8000-000000000001'
      and assigned_product_id=v_product and sequence=1
      and actual_product_name='Free-Typed Program Herbicide' and actual_rate_text='10.00'
      and actual_unit_text='gal total' and actual_cost_per_acre=7.0000 and inventory_matched is false
  ) then raise exception 'MR May failed: Program draft product view is not exact'; end if;

  if (select count(*) from public.repository_write_receipts where farm_id=v_farm and user_id=v_owner) <> 9
     or not exists (select 1 from public.repository_write_receipts where farm_id=v_farm and user_id=v_owner
       and operation_id='27ff0000-0000-4000-8000-000000000005'
       and result->>'inventory_matched'='false' and result->>'inventory_on_hand_changed'='false'
       and result->'pass'->>'id'=v_pass::text
       and result->'pass'->>'application_record_id'=v_draft::text
       and completed_at >= greatest(
         (select updated_at from public.assigned_program_passes where id=v_pass),
         (select updated_at from public.assigned_program_pass_products where id=v_product)
       ))
  then raise exception 'MR May failed: the single Programs write receipt is not exact'; end if;

  if (select count(*) from public.application_products) <> 0
     or (select count(*) from public.inventory_receipts) <> 1
     or (select count(*) from public.inventory_receipt_lines) <> 1
     or (select count(*) from public.inventory_on_hand where farm_id=v_farm) <> 1
     or not exists (select 1 from public.inventory_on_hand where farm_id=v_farm and product_id='27040000-0000-4000-8000-000000000000' and on_hand_quantity=100.00)
     or (select count(*) from public.inventory_adjustments) <> 0
     or (select count(*) from public.inventory_delivery_events) <> 0
     or (select count(*) from public.farm_tasks) <> 0
     or (select count(*) from public.notifications) <> 0
     or (select count(*) from public.scouting_notes) <> 0
     or (select count(*) from public.scouting_photos) <> 0
     or (select count(*) from public.production_estimates) <> 0
     or (select count(*) from public.grain_contracts) <> 0
     or (select count(*) from public.grain_contract_deliveries) <> 0
     or (select count(*) from public.grain_bins) <> 0
     or (select count(*) from public.bin_inventory) <> 0
     or (select count(*) from public.bin_transactions) <> 0
  then raise exception 'MR May failed: free-typed Program actuals moved inventory or another non-write boundary'; end if;
end
$proof$;

select 'Maple Ridge May browser/database proof: PASS' as proof;
rollback;
