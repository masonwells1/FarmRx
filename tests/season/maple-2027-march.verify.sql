-- Post-browser proof for Scenario MR March. Read-only assertions only.

begin transaction read only;

do $proof$
declare
  v_farm constant uuid := '27010000-0000-4000-8000-000000000001';
  v_owner constant uuid := '27000000-0000-4000-8000-000000000001';
  v_product constant uuid := '27040000-0000-4000-8000-000000000000';
begin
  if (select count(*) from public.inventory_receipts) <> 1 or not exists (
    select 1 from public.inventory_receipts
    where id = '27041000-0000-4000-8000-000000000000'
      and farm_id = v_farm and source = 'other_vendor' and status = 'received'
      and vendor_name = 'Synthetic Ag Supply' and purchase_date = date '2027-03-22'
      and received_at = timestamptz '2027-03-22 12:30:00+00'
      and invoice_number is null and created_by = v_owner
      and cancelled_at is null and cancelled_by is null and cancellation_reason is null and notes is null
  ) then raise exception 'MR March failed: exact received receipt is missing'; end if;

  if (select count(*) from public.inventory_receipt_lines) <> 1 or not exists (
    select 1 from public.inventory_receipt_lines
    where id = '27042000-0000-4000-8000-000000000000'
      and farm_id = v_farm and receipt_id = '27041000-0000-4000-8000-000000000000'
      and product_id = v_product and entered_quantity = 100.00 and entered_unit = 'gal'
      and inventory_units_per_entered_unit = 1 and quantity_in_inventory_unit = 100.00
      and unit_cost_per_inventory_unit is null and lot_number is null and expiration_date is null
      and external_delivery_line_id is null and notes is null
  ) then raise exception 'MR March failed: exact receipt line is missing'; end if;

  if (select count(*) from public.inventory_on_hand where farm_id = v_farm) <> 1 or not exists (
    select 1 from public.inventory_on_hand
    where farm_id = v_farm and product_id = v_product and on_hand_quantity = 100.00
  ) then raise exception 'MR March failed: Maple on-hand is not exactly 100 gal'; end if;

  if (select count(*) from public.inventory_products where farm_id = v_farm) <> 1 or not exists (
    select 1 from public.inventory_products
    where id = v_product and farm_id = v_farm and product_kind = 'chemical'
      and name = 'Synthetic Herbicide 41 — Maple' and manufacturer is null and inventory_unit = 'gal'
      and epa_registration_number is null and is_restricted_use is false and signal_word is null
      and restricted_entry_interval_hours is null and preharvest_interval_hours is null
      and max_label_rate is null and max_label_rate_unit is null and max_label_rate_basis is null
      and commodity_id is null and variety_name is null and fertilizer_analysis is null
      and crop_rx_product_id is null and is_active is true and notes = 'Synthetic season fixture'
      and created_at = timestamptz '2027-01-12 14:00:00+00'
      and updated_at = timestamptz '2027-01-12 14:00:00+00'
  ) then raise exception 'MR March failed: existing manifest product changed'; end if;

  if (select count(*) from public.fields) <> 1 or (select count(*) from public.arrangements) <> 1
     or (select count(*) from public.crop_assignments) <> 1
     or (select count(*) from public.programs) <> 1
     or (select count(*) from public.program_passes) <> 1
     or (select count(*) from public.program_pass_products) <> 1
     or (select count(*) from public.program_assignments) <> 1
     or (select count(*) from public.assigned_program_passes) <> 1
     or (select count(*) from public.assigned_program_pass_products) <> 1
  then raise exception 'MR March failed: retained January-February state changed'; end if;

  if not exists (select 1 from public.crop_assignments where id = '27030000-0000-4000-8000-000000000001'
      and farm_id = v_farm and field_id = '27020000-0000-4000-8000-000000000001'
      and crop_year = 2027 and commodity_id = 'corn_yellow' and planting_sequence = 1
      and planted_acres = 160.00 and expected_yield_per_acre = 200.0000
      and variety is null and planting_date is null and harvest_date is null and harvested_bushels is null
      and expected_price_per_bu is null and actual_price_per_bu is null and notes is null)
     or not exists (select 1 from public.programs where id = '27050000-0000-4000-8000-000000000001'
      and farm_id = v_farm and name = 'Maple 2027 Corn Program' and program_kind = 'chemical'
      and commodity_id is null and crop_year = 2027 and notes is null and revision = 2 and is_archived is false)
     or not exists (select 1 from public.program_passes where id = '27051000-0000-4000-8000-000000000001'
      and program_id = '27050000-0000-4000-8000-000000000001' and sequence = 1
      and name = 'Post-emerge synthetic pass' and pass_type = 'post' and activity_type = 'spray'
      and target_date = date '2027-05-20' and reminder_lead_days = 3 and is_archived is false)
     or not exists (select 1 from public.program_pass_products where id = '27051100-0000-4000-8000-000000000001'
      and program_pass_id = '27051000-0000-4000-8000-000000000001' and sequence = 1
      and product_name = 'Free-Typed Program Herbicide' and rate_text = '10.00'
      and unit_text = 'gal total' and estimated_cost_per_acre = 7.0000 and catalog_product_id is null and is_archived is false)
     or not exists (select 1 from public.program_assignments where id = '27052000-0000-4000-8000-000000000001'
      and crop_assignment_id = '27030000-0000-4000-8000-000000000001' and status = 'active'
      and program_name_snapshot = 'Maple 2027 Corn Program' and program_kind_snapshot = 'chemical' and template_revision = 2)
     or not exists (select 1 from public.assigned_program_passes where id = '27053000-0000-4000-8000-000000000001'
      and assignment_id = '27052000-0000-4000-8000-000000000001'
      and source_program_pass_id = '27051000-0000-4000-8000-000000000001'
      and sequence = 1 and name = 'Post-emerge synthetic pass' and due_on = date '2027-05-20'
      and due_source = 'template_date' and status = 'planned' and applied_on is null and application_record_id is null)
     or not exists (select 1 from public.assigned_program_pass_products where id = '27053100-0000-4000-8000-000000000001'
      and assigned_pass_id = '27053000-0000-4000-8000-000000000001'
      and source_program_pass_product_id = '27051100-0000-4000-8000-000000000001'
      and sequence = 1 and product_name = 'Free-Typed Program Herbicide' and rate_text = '10.00'
      and unit_text = 'gal total' and estimated_cost_per_acre = 7.0000 and is_active is true
      and actual_product_name is null and actual_rate_text is null and actual_unit_text is null and actual_cost_per_acre is null)
  then raise exception 'MR March failed: exact retained January-February identities changed'; end if;

  if (select count(*) from public.inventory_adjustments) <> 0
     or (select count(*) from public.inventory_delivery_events) <> 0
     or (select count(*) from public.application_records) <> 0
     or (select count(*) from public.application_products) <> 0
     or (select count(*) from public.program_application_products) <> 0
     or (select count(*) from public.scouting_notes) <> 0
     or (select count(*) from public.scouting_photos) <> 0
     or (select count(*) from public.farm_tasks) <> 0
     or (select count(*) from public.notifications) <> 0
     or (select count(*) from public.production_estimates) <> 0
     or (select count(*) from public.grain_contracts) <> 0
     or (select count(*) from public.grain_contract_deliveries) <> 0
     or (select count(*) from public.marketing_plan_targets) <> 0
     or (select count(*) from public.insurance_units) <> 0
     or (select count(*) from public.grain_bins) <> 0
     or (select count(*) from public.bin_inventory) <> 0
     or (select count(*) from public.bin_transactions) <> 0
     or (select count(*) from public.marketing_alert_rules) <> 0
     or (select count(*) from public.firm_offers) <> 0
     or (select count(*) from public.grain_alert_settings) <> 0
     or (select count(*) from public.cash_bids where farm_id = v_farm) <> 1
  then raise exception 'MR March failed: an explicit non-write boundary changed'; end if;

  -- Inventory receipt idempotency is owned by the receipt/line identities and
  -- advisory lock; this RPC does not add a repository_write_receipts row.
  if (select count(*) from public.repository_write_receipts where farm_id = v_farm and user_id = v_owner) <> 8 then
    raise exception 'MR March failed: the inventory receipt unexpectedly changed repository receipt cardinality';
  end if;
end
$proof$;

select 'Maple Ridge March browser/database proof: PASS' as proof;

rollback;
