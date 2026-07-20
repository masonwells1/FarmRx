-- Executable database proof for the canonical January-only Maple Ridge state.
-- Run after maple-2027-start.sql against the named disposable local database.

begin;

do $proof$
declare
  v_farm_id constant uuid := '27010000-0000-4000-8000-000000000001';
  v_owner_id constant uuid := '27000000-0000-4000-8000-000000000001';
  v_entity_id constant uuid := '27011000-0000-4000-8000-000000000001';
  v_product_id constant uuid := '27040000-0000-4000-8000-000000000000';
  v_bid_id constant uuid := '27070500-0000-4000-8000-000000000001';
  v_outcome_count bigint;
begin
  if (select count(*) from public.farms) <> 1 or not exists (
    select 1 from public.farms
    where id = v_farm_id
      and name = 'Maple Ridge'
      and time_zone = 'America/Chicago'
      and share_with_rep is false
      and created_by = v_owner_id
  ) then
    raise exception 'Maple start proof failed: exact farm row is missing or extra farms exist';
  end if;

  if (select count(*) from public.farm_memberships) <> 1 or not exists (
    select 1 from public.farm_memberships
    where farm_id = v_farm_id
      and user_id = v_owner_id
      and role = 'owner'
      and status = 'active'
  ) then
    raise exception 'Maple start proof failed: owner bootstrap membership is not exact';
  end if;

  if (select count(*) from public.farm_access_epochs) <> 1 or not exists (
    select 1 from public.farm_access_epochs
    where farm_id = v_farm_id
      and user_id = v_owner_id
      and access_epoch = 1
  ) then
    raise exception 'Maple start proof failed: owner access epoch is not exactly 1';
  end if;

  if (select count(*) from public.entities) <> 1 or not exists (
    select 1 from public.entities
    where id = v_entity_id
      and farm_id = v_farm_id
      and name = 'Maple Ridge'
      and entity_type = 'sole_proprietorship'
      and is_active is true
  ) then
    raise exception 'Maple start proof failed: exact operating entity is missing';
  end if;

  if (select count(*) from public.inventory_products) <> 1 or not exists (
    select 1 from public.inventory_products
    where id = v_product_id
      and farm_id = v_farm_id
      and product_kind = 'chemical'
      and name = 'Synthetic Herbicide 41 — Maple'
      and inventory_unit = 'gal'
      and is_restricted_use is false
      and is_active is true
  ) then
    raise exception 'Maple start proof failed: exact inventory product is missing';
  end if;

  if (select count(*) from public.inventory_on_hand) <> 1 or not exists (
    select 1 from public.inventory_on_hand
    where product_id = v_product_id
      and farm_id = v_farm_id
      and received_quantity = 0
      and adjusted_quantity = 0
      and used_quantity = 0
      and on_hand_quantity = 0
      and weighted_known_receipt_cost_per_inventory_unit is null
  ) then
    raise exception 'Maple start proof failed: product does not start at exact zero on hand';
  end if;

  if (select count(*) from public.cash_bids) <> 1 or not exists (
    select 1 from public.cash_bids
    where id = v_bid_id
      and farm_id = v_farm_id
      and elevator = 'Synthetic Elevator'
      and commodity_id = 'corn_yellow'
      and bid_date = date '2027-11-10'
      and basis = 0
      and cash_price = 4.25
      and delivery_start = date '2027-11-10'
      and delivery_end = date '2027-12-15'
      and notes = 'Synthetic season fixture'
  ) then
    raise exception 'Maple start proof failed: exact cash-bid fixture is missing';
  end if;

  select
      (select count(*) from public.fields)
    + (select count(*) from public.arrangements)
    + (select count(*) from public.crop_assignments)
    + (select count(*) from public.programs)
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
    + (select count(*) from public.farm_tasks)
    + (select count(*) from public.production_estimates)
    + (select count(*) from public.grain_contracts)
    + (select count(*) from public.grain_contract_deliveries)
    + (select count(*) from public.grain_bins)
    + (select count(*) from public.bin_inventory)
    + (select count(*) from public.bin_transactions)
  into v_outcome_count;

  if v_outcome_count <> 0 then
    raise exception 'Maple start proof failed: % later-season outcome rows were pre-created', v_outcome_count;
  end if;
end
$proof$;

select 'Maple Ridge January database state: PASS' as proof;

rollback;
