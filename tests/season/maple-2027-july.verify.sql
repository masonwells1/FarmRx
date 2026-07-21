-- Post-browser proof for Scenario MR July. Read-only assertions only.
begin transaction read only;

do $proof$
declare
  v_farm constant uuid := '27010000-0000-4000-8000-000000000001';
  v_owner constant uuid := '27000000-0000-4000-8000-000000000001';
  v_field constant uuid := '27020000-0000-4000-8000-000000000001';
  v_note constant uuid := '27060000-0000-4000-8000-000000000001';
  v_task constant uuid := '27061000-0000-4000-8000-000000000001';
  v_operation constant uuid := '27ff0000-0000-4000-8000-000000000007';
  v_instant constant timestamptz := '2027-07-09 21:10:00+00';
begin
  if (select count(*) from public.scouting_notes) <> 1 or not exists (
    select 1 from public.scouting_notes where id=v_note and farm_id=v_farm and field_id=v_field
      and observed_on=date '2027-07-09' and category='weed' and note='Synthetic waterhemp at south gate'
      and latitude is null and longitude is null and created_by=v_owner
      and date_trunc('second', created_at)=v_instant and date_trunc('second', updated_at)=v_instant
  ) then raise exception 'MR July failed: exact Maple scouting note is missing or not server-clocked'; end if;

  if (select count(*) from public.farm_tasks) <> 1 or not exists (
    select 1 from public.farm_tasks where id=v_task and farm_id=v_farm and title='Inspect Maple south gate'
      and details='Check synthetic waterhemp patch.' and status='todo' and priority='normal' and assigned_to=v_owner
      and due_on=date '2027-07-10' and field_id=v_field and equipment_id is null and source='manual'
      and interval_id is null and interval_cycle_key is null and program_assigned_pass_id is null and program_cycle_key is null
      and completed_by is null and completed_at is null and created_by=v_owner
      and date_trunc('second', created_at)=v_instant and date_trunc('second', updated_at)=v_instant
  ) then raise exception 'MR July failed: exact separate manual task is missing or not server-clocked'; end if;

  if (select count(*) from public.repository_write_receipts where farm_id=v_farm and user_id=v_owner) <> 10
     or not exists (select 1 from public.repository_write_receipts where farm_id=v_farm and user_id=v_owner and operation_id=v_operation
       and result->>'id'=v_note::text and result->>'farm_id'=v_farm::text and result->>'field_id'=v_field::text
       and result->>'observed_on'='2027-07-09' and result->>'category'='weed' and result->>'note'='Synthetic waterhemp at south gate'
       and result->'photos'='[]'::jsonb and not (result ? 'created_task_id')
       and date_trunc('second', completed_at)=v_instant)
  then raise exception 'MR July failed: exact scouting receipt is missing'; end if;

  if (select count(*) from public.scouting_photos) <> 0
     or (select count(*) from public.notifications) <> 0
     or (select count(*) from public.application_products) <> 1
     or (select count(*) from public.inventory_receipts) <> 1
     or (select count(*) from public.inventory_receipt_lines) <> 1
     or (select count(*) from public.inventory_adjustments) <> 0
     or (select count(*) from public.inventory_delivery_events) <> 0
     or (select count(*) from public.production_estimates) <> 0
     or (select count(*) from public.grain_contracts) <> 0
     or (select count(*) from public.grain_contract_deliveries) <> 0
     or (select count(*) from public.grain_bins) <> 0
     or (select count(*) from public.bin_inventory) <> 0
     or (select count(*) from public.bin_transactions) <> 0
  then raise exception 'MR July failed: photos, notifications, Programs, or another non-write boundary changed'; end if;

  if not exists (select 1 from public.application_records where id='27043000-0000-4000-8000-000000000000' and farm_id=v_farm
      and status='completed' and application_date=date '2027-06-18' and applied_acres=160.00 and completed_at='2027-06-18 13:20:00+00')
     or not exists (select 1 from public.application_records where id='27054000-0000-4000-8000-000000000001' and farm_id=v_farm
      and status='draft' and application_date=date '2027-05-20' and applied_acres=160.00 and completed_at is null)
     or not exists (select 1 from public.inventory_on_hand where farm_id=v_farm and product_id='27040000-0000-4000-8000-000000000000'
      and received_quantity=100.00 and used_quantity=10.00 and on_hand_quantity=90.00)
  then raise exception 'MR July failed: retained January-June business state changed'; end if;
end
$proof$;

select 'Maple Ridge July browser/database proof: PASS' as proof;
rollback;
