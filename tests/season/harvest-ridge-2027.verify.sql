-- Post-browser assertions for the canonical Harvest Ridge order.
do $verify$
declare
  v_actual numeric; v_math public.production_math_basis; v_harvest numeric; v_bin numeric; v_moves integer; v_delivery integer; v_delivered numeric; v_proof_bin integer; v_inbound integer; v_contract integer;
begin
  select harvested_bushels into v_harvest from public.crop_assignments where id='27030000-0000-4000-8000-000000000004';
  if v_harvest <> 27600 then raise exception 'HR harvest actual expected 27600, got %', v_harvest; end if;
  if (select updated_at from public.crop_assignments where id='27030000-0000-4000-8000-000000000004') <> timestamptz '2027-10-11 22:30:00+00' then raise exception 'HR harvest server timestamp is not HR-1'; end if;
  select actual_bushels, drives_math into v_actual, v_math from public.production_estimates where id='27070000-0000-4000-8000-000000000004';
  if v_actual <> 27600 or v_math <> 'actual' then raise exception 'HR Grain reconciliation is not exact actual/actual: % / %', v_actual, v_math; end if;
  if (select updated_at from public.production_estimates where id='27070000-0000-4000-8000-000000000004') <> timestamptz '2027-10-11 22:45:00+00' then raise exception 'HR reconciliation server timestamp is not HR-3'; end if;
  select coalesce(sum(case direction when 'in' then bushels else -bushels end),0) + 30000 into v_bin from public.bin_transactions where grain_bin_id='27073000-0000-4000-8000-000000000004';
  if v_bin <> 25000 then raise exception 'HR bin on-hand expected 25000, got %', v_bin; end if;
  select count(*) into v_moves from public.bin_transactions where id='27074000-0000-4000-8000-000000000004' and farm_id='27010000-0000-4000-8000-000000000004' and direction='out' and bushels=5000 and commodity_id='corn_yellow' and occurred_on='2027-11-06' and source_kind='manual entry' and note='Delivery to Synthetic Elevator';
  if v_moves <> 1 then raise exception 'HR expected one exact manual bin-out, got %', v_moves; end if;
  if (select created_at from public.bin_transactions where id='27074000-0000-4000-8000-000000000004') <> timestamptz '2027-11-06 15:00:00+00' then raise exception 'HR main-bin out server timestamp is not HR-4'; end if;
  select count(*), coalesce(sum(bushels),0) into v_delivery, v_delivered from public.grain_contract_deliveries where grain_contract_id='27071000-0000-4000-8000-000000000004';
  if v_delivery <> 1 or v_delivered <> 5000 then raise exception 'HR delivery total expected one/5000, got %/%', v_delivery, v_delivered; end if;
  if not exists (select 1 from public.grain_contract_deliveries where id='27072000-0000-4000-8000-000000000004' and grain_contract_id='27071000-0000-4000-8000-000000000004' and farm_id='27010000-0000-4000-8000-000000000004' and bushels=5000 and delivered_on='2027-11-06') then raise exception 'HR delivery row is missing or not exact'; end if;
  if (select created_at from public.grain_contract_deliveries where id='27072000-0000-4000-8000-000000000004') <> timestamptz '2027-11-06 15:05:00+00' then raise exception 'HR delivery server timestamp is not HR-5'; end if;
  select count(*) into v_proof_bin from public.grain_bins where id='27073000-0000-4000-8000-000000000005' and farm_id='27010000-0000-4000-8000-000000000004' and name='Harvest Ridge Proof Bin' and capacity_bu=40000 and location_type='on_farm';
  if v_proof_bin <> 1 then raise exception 'HR expected one exact proof bin, got %', v_proof_bin; end if;
  if not exists (select 1 from public.grain_bins where id='27073000-0000-4000-8000-000000000005' and created_at=timestamptz '2027-11-06 14:50:00+00' and updated_at=timestamptz '2027-11-06 14:50:00+00') then raise exception 'HR proof bin server timestamps are not the documented 08:50 CST instant'; end if;
  select count(*) into v_inbound from public.bin_transactions where id='27074000-0000-4000-8000-000000000005' and farm_id='27010000-0000-4000-8000-000000000004' and grain_bin_id='27073000-0000-4000-8000-000000000005' and direction='in' and bushels=2600 and commodity_id='corn_yellow' and occurred_on='2027-11-06' and source_kind='manual entry';
  if v_inbound <> 1 then raise exception 'HR expected one exact proof-bin inbound movement, got %', v_inbound; end if;
  if (select created_at from public.bin_transactions where id='27074000-0000-4000-8000-000000000005') <> timestamptz '2027-11-06 14:55:00+00' then raise exception 'HR proof inbound server timestamp is not the documented 08:55 CST instant'; end if;
  select count(*) into v_contract from public.grain_contracts where id='27071000-0000-4000-8000-000000000005' and farm_id='27010000-0000-4000-8000-000000000004' and crop_year=2027 and commodity_id='corn_yellow' and contract_type='cash_spot' and buyer='Synthetic Elevator' and bushels=2600 and cash_price=4.25 and delivery_start='2027-11-01' and delivery_end='2027-12-15' and contract_number='HR-2027-PROOF-001';
  if v_contract <> 1 then raise exception 'HR expected one exact proof contract, got %', v_contract; end if;
  if not exists (select 1 from public.grain_contracts where id='27071000-0000-4000-8000-000000000005' and created_at=timestamptz '2027-11-06 14:58:00+00' and updated_at=timestamptz '2027-11-06 14:58:00+00') then raise exception 'HR proof contract server timestamps are not the documented 08:58 CST instant'; end if;
  if (select count(*) from public.repository_write_receipts where farm_id='27010000-0000-4000-8000-000000000004' and operation_id='27076000-0000-4000-8000-000000000004' and user_id='27000000-0000-4000-8000-000000000001' and result->>'id'='27030000-0000-4000-8000-000000000004') <> 1 then raise exception 'HR expected one exact harvest operation receipt'; end if;
  if (select completed_at from public.repository_write_receipts where operation_id='27076000-0000-4000-8000-000000000004') <> timestamptz '2027-10-11 22:30:00+00' then raise exception 'HR harvest receipt server timestamp is not HR-1'; end if;
  if (select count(*) from public.repository_write_receipts where farm_id='27010000-0000-4000-8000-000000000004') <> 1 then raise exception 'HR created an unexpected operation receipt'; end if;
  if exists (select 1 from public.bin_transactions where grain_bin_id='27073000-0000-4000-8000-000000000004' and id <> '27074000-0000-4000-8000-000000000004') then raise exception 'HR created an unexpected bin movement'; end if;
  if exists (select 1 from public.bin_transactions where grain_bin_id='27073000-0000-4000-8000-000000000005' and id <> '27074000-0000-4000-8000-000000000005') then raise exception 'HR created an unexpected proof-bin movement'; end if;
  if (select count(*) from public.grain_contracts where farm_id='27010000-0000-4000-8000-000000000004') <> 2 then raise exception 'HR created a duplicate or missing contract'; end if;
  if (select count(*) from public.grain_contract_deliveries where farm_id='27010000-0000-4000-8000-000000000004') <> 1 then raise exception 'HR created a duplicate or missing delivery'; end if;
end $verify$;

select 'HARVEST_RIDGE_2027_VERIFY_PASS';
