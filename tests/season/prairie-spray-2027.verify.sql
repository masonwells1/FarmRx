-- Post-browser proof for Scenario PS. Assertions are read-only and prove saved
-- snapshots/presence only; they do not evaluate any license or regulatory status.
begin transaction read only;

do $proof$
declare
  v_farm constant uuid := '27010000-0000-4000-8000-000000000003';
  v_manager constant uuid := '27000000-0000-4000-8000-000000000002';
  v_product constant uuid := '27040000-0000-4000-8000-000000000001';
  v_application constant uuid := '27043000-0000-4000-8000-000000000001';
  v_line constant uuid := '27044000-0000-4000-8000-000000000001';
begin
  if (select count(*) from public.application_records) <> 1 or not exists (
    select 1 from public.application_records
    where id=v_application and farm_id=v_farm
      and field_id='27020000-0000-4000-8000-000000000003'
      and crop_assignment_id='27030000-0000-4000-8000-000000000003'
      and status='completed' and application_date=date '2027-06-15'
      and start_time=time '14:10' and end_time is null and applied_acres=120.00
      and target_pest='Synthetic broadleaf' and applicator_user_id is null
      and applicator_name_snapshot='Scenario Operator'
      and applicator_license_number_snapshot='PRESENCE-ONLY-2027'
      and applicator_license_state_snapshot is null and wind_speed_mph=8.00
      and wind_direction='SW' and temperature_f=74.00 and relative_humidity_pct=52.00
      and corrects_application_id is null and correction_reason is null
      and created_by=v_manager and completed_at=timestamptz '2027-06-15 19:10:00+00'
      and voided_at is null and voided_by is null and void_reason is null and notes is null
  ) then raise exception 'PS failed: exact completed Prairie application is missing'; end if;

  if (select count(*) from public.application_products) <> 1 or not exists (
    select 1 from public.application_products
    where id=v_line and farm_id=v_farm and application_id=v_application and product_id=v_product
      and product_kind_snapshot='chemical' and product_name_snapshot='Synthetic Herbicide 41'
      and epa_registration_number_snapshot='00000-000' and is_restricted_use_snapshot is true
      and signal_word_snapshot='caution' and restricted_entry_interval_hours_snapshot=12.00
      and preharvest_interval_hours_snapshot=0.00 and max_label_rate_snapshot=0.125000
      and max_label_rate_unit_snapshot='gal' and max_label_rate_basis_snapshot='acre'
      and inventory_unit_snapshot='gal' and rate=0.0625 and rate_unit='gal'
      and rate_basis='acre' and total_quantity=7.50 and total_unit='gal'
      and inventory_units_per_total_unit=1.0 and quantity_in_inventory_unit=7.50
      and unit_cost_per_inventory_unit_snapshot is null and lot_number_snapshot is null and notes is null
  ) then raise exception 'PS failed: exact Prairie product/label snapshots are missing'; end if;

  if not exists (
    select 1 from public.inventory_on_hand
    where farm_id=v_farm and product_id=v_product
      and received_quantity=100.00 and adjusted_quantity=0 and used_quantity=7.50 and on_hand_quantity=92.50
  ) then raise exception 'PS failed: derived on-hand did not reconcile from 100.00 to 92.50 gal'; end if;

  if (select count(*) from public.farms) <> 1
     or (select count(*) from public.farm_memberships where farm_id=v_farm and user_id=v_manager and role='manager' and status='active') <> 1
     or (select count(*) from public.fields) <> 1 or (select count(*) from public.arrangements) <> 1
     or (select count(*) from public.crop_assignments) <> 1 or (select count(*) from public.inventory_products) <> 1
     or (select count(*) from public.inventory_receipts) <> 1 or (select count(*) from public.inventory_receipt_lines) <> 1
     or (select count(*) from public.inventory_adjustments) <> 0 or (select count(*) from public.inventory_delivery_events) <> 0
     or (select count(*) from public.repository_write_receipts) <> 0
     or (select count(*) from public.programs) <> 0 or (select count(*) from public.program_passes) <> 0
     or (select count(*) from public.program_assignments) <> 0 or (select count(*) from public.assigned_program_passes) <> 0
     or (select count(*) from public.farm_tasks) <> 0 or (select count(*) from public.notifications) <> 0
     or (select count(*) from public.production_estimates) <> 0 or (select count(*) from public.grain_contracts) <> 0
     or (select count(*) from public.grain_contract_deliveries) <> 0 or (select count(*) from public.grain_bins) <> 0
     or (select count(*) from public.bin_inventory) <> 0 or (select count(*) from public.bin_transactions) <> 0
     or (select count(*) from public.scouting_notes) <> 0 or (select count(*) from public.scouting_photos) <> 0
  then raise exception 'PS failed: a named non-write boundary changed'; end if;

  if not exists (
    select 1 from public.inventory_products
    where id=v_product and farm_id=v_farm and product_kind='chemical' and name='Synthetic Herbicide 41'
      and inventory_unit='gal' and epa_registration_number='00000-000' and is_restricted_use is true
      and signal_word='caution' and restricted_entry_interval_hours=12.00 and preharvest_interval_hours=0.00
      and max_label_rate=0.125000 and max_label_rate_unit='gal' and max_label_rate_basis='acre'
      and crop_rx_product_id is null and is_active is true and notes='Synthetic Prairie Spray fixture'
  ) then raise exception 'PS failed: seeded product changed'; end if;
end
$proof$;

select 'Prairie Spray browser/database proof: PASS' as proof;
rollback;
