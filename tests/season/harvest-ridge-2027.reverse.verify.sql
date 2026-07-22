-- Post-browser assertions for an independently reset November reverse order.
do $verify$
declare
  v_on_hand numeric;
  v_delivery integer;
  v_movement integer;
begin
  select 30000 + coalesce(sum(case direction when 'in' then bushels else -bushels end), 0) into v_on_hand from public.bin_transactions where grain_bin_id='27073000-0000-4000-8000-000000000004';
  if v_on_hand <> 25000 then raise exception 'HR reverse main-bin on-hand expected 25000, got %', v_on_hand; end if;
  select count(*) into v_delivery from public.grain_contract_deliveries where id='27072000-0000-4000-8000-000000000005' and grain_contract_id='27071000-0000-4000-8000-000000000004' and bushels=5000 and delivered_on='2027-11-06';
  if v_delivery <> 1 then raise exception 'HR reverse expected one exact delivery, got %', v_delivery; end if;
  if (select created_at from public.grain_contract_deliveries where id='27072000-0000-4000-8000-000000000005') <> timestamptz '2027-11-06 15:05:00+00' then raise exception 'HR reverse delivery lost its HR-5 server instant'; end if;
  select count(*) into v_movement from public.bin_transactions where id='27074000-0000-4000-8000-000000000006' and grain_bin_id='27073000-0000-4000-8000-000000000004' and direction='out' and bushels=5000 and commodity_id='corn_yellow' and occurred_on='2027-11-06' and note='Reverse-order delivery movement';
  if v_movement <> 1 then raise exception 'HR reverse expected one exact manual out movement, got %', v_movement; end if;
  if (select created_at from public.bin_transactions where id='27074000-0000-4000-8000-000000000006') <> timestamptz '2027-11-06 15:00:00+00' then raise exception 'HR reverse out lost its HR-4 server instant'; end if;
  if (select count(*) from public.grain_contract_deliveries where farm_id='27010000-0000-4000-8000-000000000004') <> 1 or (select count(*) from public.bin_transactions where farm_id='27010000-0000-4000-8000-000000000004') <> 1 then raise exception 'HR reverse created a duplicate or hidden coupled row'; end if;
end $verify$;

select 'HARVEST_RIDGE_2027_REVERSE_VERIFY_PASS';
