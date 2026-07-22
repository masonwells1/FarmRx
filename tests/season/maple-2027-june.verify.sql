-- Post-browser proof for Scenario MR June. Read-only assertions only.
begin transaction read only;

do $proof$
declare
  v_farm constant uuid := '27010000-0000-4000-8000-000000000001';
  v_owner constant uuid := '27000000-0000-4000-8000-000000000001';
  v_application constant uuid := '27043000-0000-4000-8000-000000000000';
  v_line constant uuid := '27044000-0000-4000-8000-000000000000';
  v_may_draft constant uuid := '27054000-0000-4000-8000-000000000001';
begin
  if (select count(*) from public.application_records) <> 2 or not exists (
    select 1 from public.application_records where id=v_application and farm_id=v_farm
      and field_id='27020000-0000-4000-8000-000000000001' and crop_assignment_id='27030000-0000-4000-8000-000000000001'
      and status='completed' and application_date=date '2027-06-18' and start_time=time '08:20' and end_time is null
      and applied_acres=160.00 and target_pest='Synthetic broadleaf' and applicator_user_id is null
      and applicator_name_snapshot='Scenario Operator' and applicator_license_number_snapshot='PRESENCE-ONLY-2027'
      and applicator_license_state_snapshot is null and wind_speed_mph=8.0 and wind_direction='SW'
      and temperature_f=74.0 and relative_humidity_pct=52.0 and corrects_application_id is null and correction_reason is null
      and created_by=v_owner and completed_at='2027-06-18 13:20:00+00' and voided_at is null and voided_by is null and void_reason is null and notes is null
  ) then raise exception 'MR June failed: exact completed application is missing'; end if;

  if (select count(*) from public.application_products) <> 1 or not exists (
    select 1 from public.application_products where id=v_line and farm_id=v_farm and application_id=v_application
      and product_id='27040000-0000-4000-8000-000000000000' and product_kind_snapshot='chemical'
      and product_name_snapshot='Synthetic Herbicide 41 — Maple' and epa_registration_number_snapshot is null
      and is_restricted_use_snapshot is false and signal_word_snapshot is null
      and restricted_entry_interval_hours_snapshot is null and preharvest_interval_hours_snapshot is null
      and max_label_rate_snapshot is null and max_label_rate_unit_snapshot is null and max_label_rate_basis_snapshot is null
      and inventory_unit_snapshot='gal' and rate=0.0625 and rate_unit='gal' and rate_basis='acre'
      and total_quantity=10.00 and total_unit='gal' and inventory_units_per_total_unit=1.0
      and quantity_in_inventory_unit=10.00 and unit_cost_per_inventory_unit_snapshot is null and lot_number_snapshot is null and notes is null
  ) then raise exception 'MR June failed: exact application product and catalog snapshots are missing'; end if;

  if not exists (select 1 from public.inventory_on_hand where farm_id=v_farm and product_id='27040000-0000-4000-8000-000000000000'
      and received_quantity=100.00 and adjusted_quantity=0 and used_quantity=10.00 and on_hand_quantity=90.00)
  then raise exception 'MR June failed: Inventory did not reconcile from 100 to 90 gallons'; end if;

  if not exists (select 1 from public.application_records where id=v_may_draft and farm_id=v_farm and status='draft'
      and application_date=date '2027-05-20' and applied_acres=160.00 and created_at=updated_at and completed_at is null)
     or not exists (select 1 from public.assigned_program_passes where id='27053000-0000-4000-8000-000000000001' and status='applied' and application_record_id=v_may_draft)
     or not exists (select 1 from public.assigned_program_pass_products where id='27053100-0000-4000-8000-000000000001'
       and actual_product_name='Free-Typed Program Herbicide' and actual_rate_text='10.00' and actual_unit_text='gal total' and actual_cost_per_acre=7.0000)
     or not exists (select 1 from public.program_application_products where application_record_id=v_may_draft and assigned_pass_id='27053000-0000-4000-8000-000000000001'
       and assigned_product_id='27053100-0000-4000-8000-000000000001' and inventory_matched is false)
  then raise exception 'MR June failed: May draft/pass/product/view history changed'; end if;

  if (select count(*) from public.repository_write_receipts where farm_id=v_farm and user_id=v_owner) <> 9
     or (select count(*) from public.inventory_receipts) <> 1 or (select count(*) from public.inventory_receipt_lines) <> 1
     or (select count(*) from public.inventory_adjustments) <> 0 or (select count(*) from public.inventory_delivery_events) <> 0
     or (select count(*) from public.farm_tasks) <> 0 or (select count(*) from public.notifications) <> 0
     or (select count(*) from public.scouting_notes) <> 0 or (select count(*) from public.scouting_photos) <> 0
     or (select count(*) from public.production_estimates) <> 0 or (select count(*) from public.grain_contracts) <> 0
     or (select count(*) from public.grain_contract_deliveries) <> 0 or (select count(*) from public.grain_bins) <> 0
     or (select count(*) from public.bin_inventory) <> 0 or (select count(*) from public.bin_transactions) <> 0
  then raise exception 'MR June failed: a weather/provider/queue or unrelated non-write boundary changed'; end if;
end
$proof$;

select 'Maple Ridge June browser/database proof: PASS' as proof;
rollback;
