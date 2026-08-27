begin transaction read only;
do $proof$
declare
  v_farm constant uuid := '27010000-0000-4000-8000-000000000005';
  v_owner constant uuid := '27000000-0000-4000-8000-000000000001';
  v_application constant uuid := '27043000-0000-4000-8000-000000000005';
  v_line constant uuid := '27044000-0000-4000-8000-000000000005';
  v_product constant uuid := '27040000-0000-4000-8000-000000000005';
begin
  if (select count(*) from public.application_records) <> 1 or not exists (
    select 1 from public.application_records
    where id = v_application
      and farm_id = v_farm
      and field_id = '27020000-0000-4000-8000-000000000005'
      and crop_assignment_id = '27030000-0000-4000-8000-000000000005'
      and application_date = date '2027-07-07'
      and status = 'completed'
      and applied_acres = 40
      and start_time is null
      and end_time is null
      and target_pest is null
      and applicator_user_id is null
      and applicator_name_snapshot is null
      and applicator_license_number_snapshot is null
      and applicator_license_state_snapshot is null
      and relative_humidity_pct is null
      and wind_speed_mph = 9
      and wind_direction = 'W'
      and temperature_f = 75
      and corrects_application_id is null
      and correction_reason is null
      and created_by = v_owner
      and completed_at = timestamptz '2027-07-07 18:20:00+00'
      and voided_at is null
      and voided_by is null
      and void_reason is null
      and notes is null
  ) then raise exception 'CW-1 application is not exact'; end if;

  if (select count(*) from public.application_products) <> 1 or not exists (
    select 1 from public.application_products
    where id = v_line
      and farm_id = v_farm
      and application_id = v_application
      and product_id = v_product
      and product_kind_snapshot = 'chemical'
      and product_name_snapshot = 'Synthetic Cedar Herbicide 41'
      and epa_registration_number_snapshot = '00000-005'
      and is_restricted_use_snapshot = false
      and signal_word_snapshot = 'caution'
      and restricted_entry_interval_hours_snapshot = 12
      and preharvest_interval_hours_snapshot = 0
      and max_label_rate_snapshot = 0.125
      and max_label_rate_unit_snapshot = 'gal'
      and max_label_rate_basis_snapshot = 'acre'
      and inventory_unit_snapshot = 'gal'
      and rate = 0.125
      and rate_unit = 'gal'
      and rate_basis = 'acre'
      and total_quantity = 5
      and total_unit = 'gal'
      and inventory_units_per_total_unit = 1
      and quantity_in_inventory_unit = 5
      and unit_cost_per_inventory_unit_snapshot = 12.50
      and lot_number_snapshot is null
      and notes is null
  ) then raise exception 'CW-1 application product is not exact'; end if;

  if (select count(*) from public.inventory_on_hand) <> 1 or not exists (
    select 1 from public.inventory_on_hand
    where farm_id = v_farm and product_id = v_product
      and received_quantity = 20
      and adjusted_quantity = 0
      and used_quantity = 5
      and on_hand_quantity = 15
  )
  then raise exception 'CW-1 inventory did not reconcile from 20.00 to 15.00'; end if;

  if (select count(*) from public.farms) <> 1
     or (select count(*) from public.farm_memberships where farm_id = v_farm and user_id = v_owner and role = 'owner' and status = 'active') <> 1
     or (select count(*) from public.entities) <> 1
     or (select count(*) from public.fields) <> 1
     or (select count(*) from public.arrangements) <> 1
     or (select count(*) from public.crop_assignments) <> 1
     or (select count(*) from public.inventory_products) <> 1
     or (select count(*) from public.inventory_receipts) <> 1
     or (select count(*) from public.inventory_receipt_lines) <> 1
     or (select count(*) from public.inventory_adjustments) <> 0
     or (select count(*) from public.inventory_delivery_events) <> 0
     or (select count(*) from public.repository_write_receipts) <> 0
     or (select count(*) from public.programs) <> 0
     or (select count(*) from public.program_passes) <> 0
     or (select count(*) from public.program_pass_products) <> 0
     or (select count(*) from public.program_assignments) <> 0
     or (select count(*) from public.assigned_program_passes) <> 0
     or (select count(*) from public.program_application_products) <> 0
     or (select count(*) from public.scouting_notes) <> 0
     or (select count(*) from public.scouting_photos) <> 0
     or (select count(*) from public.farm_tasks) <> 0
     or (select count(*) from public.notifications) <> 0
     or (select count(*) from public.production_estimates) <> 0
     or (select count(*) from public.grain_contracts) <> 0
     or (select count(*) from public.grain_contract_deliveries) <> 0
     or (select count(*) from public.grain_bins) <> 0
     or (select count(*) from public.bin_inventory) <> 0
     or (select count(*) from public.bin_transactions) <> 0
     or (select count(*) from public.spray_window_states) <> 0
     or (select count(*) from public.push_deliveries) <> 0
     or (select count(*) from public.push_delivery_targets) <> 0
  then raise exception 'CW-1 named non-write tables or cardinalities changed'; end if;
end $proof$;
select 'CONNECT_WORKFLOWS_CW1_VERIFY_PASS';
rollback;
