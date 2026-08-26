\set ON_ERROR_STOP on
\pset pager off

-- Browser-positive state and transactional deny/rollback matrix.
create temporary table cw2_browser_after as
select table_name,row_count,row_hash,rows from cw2_proof.public_snapshot();

do $browser_snapshot$
declare
  v_changed text[] := array['assigned_program_pass_products','assigned_program_passes','program_inventory_matches','repository_write_receipts'];
  v_before jsonb;
  v_after jsonb;
  v_match jsonb;
  v_receipt jsonb;
begin
  if exists(
    select 1 from cw2_proof.browser_baseline baseline
    full join cw2_browser_after after using(table_name)
    where baseline.table_name is null or after.table_name is null
  ) then raise exception 'CW2 browser snapshot did not enumerate the same public base and partitioned tables'; end if;
  if exists(
    select 1 from cw2_proof.browser_baseline baseline
    join cw2_browser_after after using(table_name)
    where baseline.table_name <> all(v_changed)
      and (baseline.row_count,baseline.row_hash,baseline.rows) is distinct from (after.row_count,after.row_hash,after.rows)
  ) then raise exception 'CW2 browser changed a public table outside the exact four-table whitelist'; end if;

  select value into strict v_before from cw2_proof.browser_baseline baseline, jsonb_array_elements(baseline.rows) value
  where baseline.table_name='assigned_program_passes' and value->>'id'='c2000000-0000-4000-8000-000000000005';
  select value into strict v_after from cw2_browser_after after, jsonb_array_elements(after.rows) value
  where after.table_name='assigned_program_passes' and value->>'id'='c2000000-0000-4000-8000-000000000005';
  if (v_before - array['status','applied_on','applied_acres','application_record_id','updated_by','updated_at']) <>
     (v_after - array['status','applied_on','applied_acres','application_record_id','updated_by','updated_at'])
     or v_before->>'status' <> 'planned' or v_after->>'status' <> 'applied'
     or v_after->>'applied_on' <> '2027-07-07' or (v_after->>'applied_acres')::numeric <> 40
     or v_after->'application_record_id' <> 'null'::jsonb
     or v_after->>'updated_by' <> '27000000-0000-4000-8000-000000000001'
  then raise exception 'CW2 browser changed unauthorized assigned-pass columns'; end if;
  if (select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from cw2_proof.browser_baseline baseline, jsonb_array_elements(baseline.rows) value where baseline.table_name='assigned_program_passes' and value->>'id'<>'c2000000-0000-4000-8000-000000000005') <>
     (select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from cw2_browser_after after, jsonb_array_elements(after.rows) value where after.table_name='assigned_program_passes' and value->>'id'<>'c2000000-0000-4000-8000-000000000005')
  then raise exception 'CW2 browser changed an unrelated assigned pass'; end if;

  select value into strict v_before from cw2_proof.browser_baseline baseline, jsonb_array_elements(baseline.rows) value
  where baseline.table_name='assigned_program_pass_products' and value->>'id'='c2000000-0000-4000-8000-000000000006';
  select value into strict v_after from cw2_browser_after after, jsonb_array_elements(after.rows) value
  where after.table_name='assigned_program_pass_products' and value->>'id'='c2000000-0000-4000-8000-000000000006';
  if (v_before - array['actual_product_name','actual_rate_text','actual_unit_text','actual_cost_per_acre','updated_by','updated_at']) <>
     (v_after - array['actual_product_name','actual_rate_text','actual_unit_text','actual_cost_per_acre','updated_by','updated_at'])
     or v_after->>'actual_product_name' <> 'Synthetic Cedar Herbicide 41'
     or v_after->>'actual_rate_text' <> '0.001' or v_after->>'actual_unit_text' <> 'gal total'
     or (v_after->>'actual_cost_per_acre')::numeric <> 0.01
     or v_after->>'updated_by' <> '27000000-0000-4000-8000-000000000001'
  then raise exception 'CW2 browser changed unauthorized assigned-product columns'; end if;
  if (select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from cw2_proof.browser_baseline baseline, jsonb_array_elements(baseline.rows) value where baseline.table_name='assigned_program_pass_products' and value->>'id'<>'c2000000-0000-4000-8000-000000000006') <>
     (select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from cw2_browser_after after, jsonb_array_elements(after.rows) value where after.table_name='assigned_program_pass_products' and value->>'id'<>'c2000000-0000-4000-8000-000000000006')
  then raise exception 'CW2 browser changed an unrelated assigned product'; end if;

  if (select rows from cw2_proof.browser_baseline where table_name='program_inventory_matches') <> '[]'::jsonb
     or (select row_count from cw2_browser_after where table_name='program_inventory_matches') <> 1
  then raise exception 'CW2 browser match ledger delta was not exactly one row'; end if;
  select value into strict v_match from cw2_browser_after after, jsonb_array_elements(after.rows) value where after.table_name='program_inventory_matches';
  if v_match->>'farm_id' <> '27010000-0000-4000-8000-000000000005'
     or v_match->>'assigned_product_id' <> 'c2000000-0000-4000-8000-000000000006'
     or v_match->>'inventory_product_id' <> '27040000-0000-4000-8000-000000000005'
     or (v_match->>'quantity_in_inventory_unit')::numeric <> 0.001
     or v_match->>'inventory_product_name_snapshot' <> 'Synthetic Cedar Herbicide 41'
     or v_match->>'inventory_unit_snapshot' <> 'gal'
     or v_match->>'confirmed_by' <> '27000000-0000-4000-8000-000000000001'
     or v_match->>'confirmed_at' is null
  then raise exception 'CW2 browser inserted unexpected match facts'; end if;

  if (select rows from cw2_proof.browser_baseline where table_name='repository_write_receipts') <> '[]'::jsonb
     or (select row_count from cw2_browser_after where table_name='repository_write_receipts') <> 1
  then raise exception 'CW2 browser receipt delta was not exactly one row'; end if;
  select value into strict v_receipt from cw2_browser_after after, jsonb_array_elements(after.rows) value where after.table_name='repository_write_receipts';
  if v_receipt->>'farm_id' <> v_match->>'farm_id' or v_receipt->>'operation_id' <> v_match->>'operation_id'
     or v_receipt->>'user_id' <> v_match->>'confirmed_by'
     or v_receipt->'result'->>'inventory_matched' <> 'true'
     or (v_receipt->'result'->>'inventory_match_count')::integer <> 1
  then raise exception 'CW2 browser receipt identity or result drifted'; end if;
  if (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005') <> 19.999
  then raise exception 'CW2 browser derived Inventory was not exactly 19.999 gal'; end if;
end
$browser_snapshot$;

begin;
set local statement_timeout = '30s';
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('27010000-0000-4000-8000-000000000005',1)::text)::text,true);

create function pg_temp.cw2_actual(
  p_assigned_product uuid,
  p_name text,
  p_inventory_product uuid default null,
  p_quantity numeric default null,
  p_unit text default null
) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', p_assigned_product,
      'actual_product_name', p_name,
      'actual_rate_text', '0.001',
      'actual_unit_text', 'gal total',
      'actual_cost_per_acre', 0.01
    ) || case when p_inventory_product is null then '{}'::jsonb else jsonb_build_object(
      'inventory_match', jsonb_build_object(
        'inventory_product_id', p_inventory_product,
        'quantity_in_inventory_unit', p_quantity,
        'inventory_unit', p_unit
      )
    ) end
  )
$$;

create function pg_temp.cw2_clone(p_pass uuid, p_product uuid, p_sequence integer)
returns void language plpgsql as $$
begin
  insert into public.assigned_program_passes (
    id, farm_id, assignment_id, source_program_pass_id, source_revision,
    sequence, name, pass_type, activity_type, target_date, reminder_lead_days,
    due_on, due_source, is_field_override, status, created_by, updated_by
  ) values (
    p_pass, '27010000-0000-4000-8000-000000000005',
    'c2000000-0000-4000-8000-000000000004',
    'c2000000-0000-4000-8000-000000000002', 1,
    p_sequence, 'CW-2 SQL proof pass ' || p_sequence, 'post', 'spray',
    '2027-07-07', 0, '2027-07-07', 'template_date', false, 'planned',
    '27000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001'
  );
  insert into public.assigned_program_pass_products (
    id, farm_id, assigned_pass_id, source_program_pass_product_id, sequence,
    product_name, rate_text, unit_text, estimated_cost_per_acre,
    catalog_product_id, is_active, created_by, updated_by
  ) values (
    p_product, '27010000-0000-4000-8000-000000000005', p_pass,
    'c2000000-0000-4000-8000-000000000003', 1,
    'Synthetic Cedar Herbicide 41', '0.001', 'gal total', 0.01,
    '27040000-0000-4000-8000-000000000005', true,
    '27000000-0000-4000-8000-000000000001',
    '27000000-0000-4000-8000-000000000001'
  );
end
$$;

do $browser$
declare
  v_match public.program_inventory_matches%rowtype;
  v_receipt jsonb;
  v_replay jsonb;
  v_rejected boolean := false;
  v_actuals jsonb;
  v_request jsonb;
  v_expected_fingerprint text;
  v_conflict jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_before_conflicts jsonb;
  v_after_conflicts jsonb;
  v_null_cost jsonb;
  v_missing_cost jsonb;
  v_ordered jsonb;
  v_reversed jsonb;
  v_error text;
begin
  select * into strict v_match from public.program_inventory_matches
  where farm_id='27010000-0000-4000-8000-000000000005'
    and assigned_product_id='c2000000-0000-4000-8000-000000000006';
  if v_match.inventory_product_id <> '27040000-0000-4000-8000-000000000005'
     or v_match.quantity_in_inventory_unit <> 0.001
     or v_match.inventory_product_name_snapshot <> 'Synthetic Cedar Herbicide 41'
     or v_match.inventory_unit_snapshot <> 'gal'
     or v_match.confirmed_by <> '27000000-0000-4000-8000-000000000001' then
    raise exception 'CW2 browser match facts drifted';
  end if;
  if not exists (
    select 1 from public.assigned_program_passes
    where id='c2000000-0000-4000-8000-000000000005'
      and farm_id='27010000-0000-4000-8000-000000000005'
      and status='applied' and applied_on='2027-07-07' and applied_acres=40
      and application_record_id is null
  ) then raise exception 'CW2 browser pass did not apply without an application record'; end if;
  if exists(select 1 from public.application_records)
     or exists(select 1 from public.application_products) then
    raise exception 'CW2 browser positive wrote application records or products';
  end if;
  if (select on_hand_quantity from public.inventory_on_hand
      where farm_id='27010000-0000-4000-8000-000000000005'
        and product_id='27040000-0000-4000-8000-000000000005') <> 19.999 then
    raise exception 'CW2 browser draw-down was not exactly 20 minus 0.001';
  end if;
  select result into strict v_receipt from public.repository_write_receipts
  where farm_id=v_match.farm_id and operation_id=v_match.operation_id;
  select coalesce(jsonb_agg(actual.value order by actual.value->>'id'),'[]'::jsonb)
    into v_actuals
  from jsonb_array_elements(pg_temp.cw2_actual(
    'c2000000-0000-4000-8000-000000000006','Synthetic Cedar Herbicide 41',
    v_match.inventory_product_id,0.001,'gal'
  )) actual(value);
  v_request := jsonb_build_object(
    'farm_id',v_match.farm_id,
    'operation_id',v_match.operation_id,
    'user_id',v_match.confirmed_by,
    'access_epoch',1,
    'assigned_pass_id','c2000000-0000-4000-8000-000000000005'::uuid,
    'applied_on','2027-07-07'::date,
    'applied_acres',40::numeric,
    'actual_products',v_actuals,
    'application_record_id',null,
    'create_application_record',false
  );
  v_expected_fingerprint := md5(v_request::text);
  if v_receipt->>'request_fingerprint' is distinct from v_expected_fingerprint then
    raise exception 'CW2 stored fingerprint does not match the independent complete request oracle';
  end if;

  -- A null cost and a missing cost are distinct bound requests, and product
  -- ordering is canonical by assigned-product ID rather than caller order.
  v_null_cost := jsonb_set(v_request,'{actual_products,0,actual_cost_per_acre}','null'::jsonb,false);
  v_missing_cost := v_null_cost #- '{actual_products,0,actual_cost_per_acre}';
  if md5(v_null_cost::text) in (v_expected_fingerprint,md5(v_missing_cost::text)) then
    raise exception 'CW2 fingerprint did not bind explicit-null actual cost';
  end if;
  if md5(jsonb_set(v_request,'{user_id}',to_jsonb('27000000-0000-4000-8000-000000000006'::text))::text)=v_expected_fingerprint
     or md5(jsonb_set(v_request,'{access_epoch}','2'::jsonb)::text)=v_expected_fingerprint then
    raise exception 'CW2 fingerprint did not bind receipt user and access epoch';
  end if;
  select jsonb_agg(value order by value->>'id') into v_ordered
  from jsonb_array_elements(v_actuals || jsonb_build_array(jsonb_set(v_actuals->0,'{id}',to_jsonb('00000000-0000-4000-8000-000000000001'::text)))) item(value);
  select jsonb_agg(value order by value->>'id') into v_reversed
  from jsonb_array_elements(jsonb_build_array((v_ordered->1),(v_ordered->0))) item(value);
  if v_ordered <> v_reversed then raise exception 'CW2 actual-product fingerprint ordering is not canonical'; end if;

  -- Each JSON entry differs from the accepted request in exactly one bound
  -- field. Every replay must reject without changing any public table.
  v_conflicts := jsonb_build_array(
    jsonb_set(v_request,'{farm_id}',to_jsonb('00000000-0000-4000-8000-000000000049'::text)),
    jsonb_set(v_request,'{operation_id}',to_jsonb('00000000-0000-4000-8000-000000000050'::text)),
    jsonb_set(v_request,'{assigned_pass_id}',to_jsonb('00000000-0000-4000-8000-000000000051'::text)),
    jsonb_set(v_request,'{applied_on}',to_jsonb('2027-07-08'::text)),
    jsonb_set(v_request,'{applied_acres}','41'::jsonb),
    jsonb_set(v_request,'{actual_products,0,id}',to_jsonb('00000000-0000-4000-8000-000000000052'::text)),
    jsonb_set(v_request,'{actual_products,0,actual_product_name}',to_jsonb('Altered exact product'::text)),
    jsonb_set(v_request,'{actual_products,0,actual_rate_text}',to_jsonb('0.002'::text)),
    jsonb_set(v_request,'{actual_products,0,actual_unit_text}',to_jsonb('qt total'::text)),
    v_null_cost,
    v_missing_cost,
    v_request #- '{actual_products,0,inventory_match}',
    jsonb_set(v_request,'{actual_products,0,inventory_match,inventory_product_id}',to_jsonb('00000000-0000-4000-8000-000000000053'::text)),
    jsonb_set(v_request,'{actual_products,0,inventory_match,quantity_in_inventory_unit}','0.002'::jsonb),
    jsonb_set(v_request,'{actual_products,0,inventory_match,inventory_unit}',to_jsonb('qt'::text)),
    jsonb_set(v_request,'{application_record_id}',to_jsonb('00000000-0000-4000-8000-000000000054'::text)),
    jsonb_set(v_request,'{create_application_record}','true'::jsonb)
  );
  select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'hash',row_hash,'rows',rows) order by table_name)
    into v_before_conflicts from cw2_proof.public_snapshot();
  v_replay := public.mark_program_pass_applied(
    v_match.farm_id, v_match.operation_id,
    'c2000000-0000-4000-8000-000000000005', '2027-07-07', 40,
    pg_temp.cw2_actual('c2000000-0000-4000-8000-000000000006',
      'Synthetic Cedar Herbicide 41', v_match.inventory_product_id, 0.001, 'gal'),
    null, false
  );
  if v_replay <> v_receipt
     or (select count(*) from public.program_inventory_matches where operation_id=v_match.operation_id) <> 1
     or (select on_hand_quantity from public.inventory_on_hand where farm_id=v_match.farm_id and product_id=v_match.inventory_product_id) <> 19.999 then
    raise exception 'CW2 exact replay did not return the one prior receipt';
  end if;
  for v_conflict in select value from jsonb_array_elements(v_conflicts) item(value) loop
    if md5(v_conflict::text)=v_expected_fingerprint then raise exception 'CW2 one-field fingerprint mutation was not distinct'; end if;
    v_rejected := false;
    begin
      perform public.mark_program_pass_applied(
        (v_conflict->>'farm_id')::uuid,(v_conflict->>'operation_id')::uuid,
        (v_conflict->>'assigned_pass_id')::uuid,(v_conflict->>'applied_on')::date,
        (v_conflict->>'applied_acres')::numeric,v_conflict->'actual_products',
        case when v_conflict->'application_record_id'='null'::jsonb then null else (v_conflict->>'application_record_id')::uuid end,
        (v_conflict->>'create_application_record')::boolean
      );
    exception when others then v_rejected := true;
    end;
    if not v_rejected then raise exception 'CW2 one-field conflicting replay was accepted: %',v_conflict; end if;
  end loop;
  perform set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
  perform set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000006',true);
  perform set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000006','x-farm-rx-access-epochs',jsonb_build_object(v_match.farm_id::text,1)::text)::text,true);
  v_rejected := false;
  begin
    perform public.mark_program_pass_applied(v_match.farm_id,v_match.operation_id,'c2000000-0000-4000-8000-000000000005','2027-07-07',40,v_actuals,null,false);
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'CW2 conflicting receipt user replay was accepted'; end if;
  perform set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  perform set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);
  perform set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object(v_match.farm_id::text,2)::text)::text,true);
  v_rejected := false; v_error := null;
  begin
    perform public.mark_program_pass_applied(v_match.farm_id,v_match.operation_id,'c2000000-0000-4000-8000-000000000005','2027-07-07',40,v_actuals,null,false);
  exception when others then v_rejected := true; v_error := sqlerrm;
  end;
  if not v_rejected or v_error <> 'FARM_ACCESS_EPOCH_CHANGED' then raise exception 'CW2 conflicting access-epoch replay did not fail at the exact fence'; end if;
  perform set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object(v_match.farm_id::text,1)::text)::text,true);
  select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'hash',row_hash,'rows',rows) order by table_name)
    into v_after_conflicts from cw2_proof.public_snapshot();
  if v_after_conflicts <> v_before_conflicts
     or (select count(*) from public.program_inventory_matches where operation_id=v_match.operation_id) <> 1
     or (select on_hand_quantity from public.inventory_on_hand where farm_id=v_match.farm_id and product_id=v_match.inventory_product_id) <> 19.999 then
    raise exception 'CW2 exact or conflicting replay changed public state';
  end if;
end
$browser$;

-- A pre-CW-2 receipt without a request fingerprint may still replay its old
-- unmatched result, but it can never be reused to confirm an Inventory match.
select pg_temp.cw2_clone('c2050000-0000-4000-8000-000000000001','c2050000-0000-4000-8000-000000000002',100);
insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
values (
  '27010000-0000-4000-8000-000000000005','c2050000-0000-4000-8000-000000000003',
  '27000000-0000-4000-8000-000000000001',jsonb_build_object('inventory_matched',false,'inventory_on_hand_changed',false)
);
do $legacy_receipt$
declare v_rejected boolean := false;
begin
  begin
    perform public.mark_program_pass_applied(
      '27010000-0000-4000-8000-000000000005','c2050000-0000-4000-8000-000000000003',
      'c2050000-0000-4000-8000-000000000001','2027-07-07',40,
      pg_temp.cw2_actual('c2050000-0000-4000-8000-000000000002','Synthetic Cedar Herbicide 41','27040000-0000-4000-8000-000000000005',0.001,'gal'),
      null,false
    );
  exception when others then v_rejected := sqlerrm='legacy operation receipt cannot confirm an inventory match';
  end;
  if not v_rejected
     or not exists(select 1 from public.assigned_program_passes where id='c2050000-0000-4000-8000-000000000001' and status='planned')
     or exists(select 1 from public.program_inventory_matches where assigned_product_id='c2050000-0000-4000-8000-000000000002')
     or exists(select 1 from public.assigned_program_pass_products where id='c2050000-0000-4000-8000-000000000002' and actual_product_name is not null)
  then raise exception 'CW2 legacy fingerprint-less receipt confirmed a match or wrote state'; end if;
end
$legacy_receipt$;

-- Legacy no-match create/link remain supported and never draw Inventory.
select pg_temp.cw2_clone('c2100000-0000-4000-8000-000000000001','c2100000-0000-4000-8000-000000000002',101);
select public.mark_program_pass_applied(
  '27010000-0000-4000-8000-000000000005','c2100000-0000-4000-8000-000000000003',
  'c2100000-0000-4000-8000-000000000001','2027-07-07',40,
  pg_temp.cw2_actual('c2100000-0000-4000-8000-000000000002','Free-typed create product'),
  'c2100000-0000-4000-8000-000000000004',true
);
insert into public.application_records (
  id,farm_id,field_id,crop_assignment_id,status,application_date,applied_acres,created_by,notes
) values (
  'c2100000-0000-4000-8000-000000000005','27010000-0000-4000-8000-000000000005',
  '27020000-0000-4000-8000-000000000005','27030000-0000-4000-8000-000000000005',
  'draft','2027-07-06',39,'27000000-0000-4000-8000-000000000001','CW2 existing link proof'
);
select pg_temp.cw2_clone('c2100000-0000-4000-8000-000000000006','c2100000-0000-4000-8000-000000000007',102);
select public.mark_program_pass_applied(
  '27010000-0000-4000-8000-000000000005','c2100000-0000-4000-8000-000000000008',
  'c2100000-0000-4000-8000-000000000006','2027-07-07',40,
  pg_temp.cw2_actual('c2100000-0000-4000-8000-000000000007','Free-typed link product'),
  'c2100000-0000-4000-8000-000000000005',false
);

do $legacy$
begin
  if not exists(select 1 from public.application_records where id='c2100000-0000-4000-8000-000000000004' and status='draft')
     or not exists(select 1 from public.assigned_program_passes where id='c2100000-0000-4000-8000-000000000001' and status='applied' and application_record_id='c2100000-0000-4000-8000-000000000004')
     or not exists(select 1 from public.assigned_program_passes where id='c2100000-0000-4000-8000-000000000006' and status='applied' and application_record_id='c2100000-0000-4000-8000-000000000005' and applied_on='2027-07-06' and applied_acres=39)
     or exists(select 1 from public.program_inventory_matches where assigned_product_id in ('c2100000-0000-4000-8000-000000000002','c2100000-0000-4000-8000-000000000007'))
     or exists(select 1 from public.application_products)
     or (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005') <> 19.999 then
    raise exception 'CW2 legacy create/link behavior changed Inventory or failed to apply';
  end if;
end
$legacy$;

-- Confirmed create/link, unmatched/stale/foreign/ambiguous, and unsafe quantities.
do $negative$
declare
  v_pass uuid;
  v_product uuid;
  v_rejected boolean;
  v_index integer := 0;
  v_case record;
  v_before_public jsonb;
  v_before_on_hand numeric;
  v_foreign_product_before jsonb;
  v_error text;
begin
  for v_case in select * from (values
    ('create-match','c2200000-0000-4000-8000-000000000001'::uuid,'c2200000-0000-4000-8000-000000000002'::uuid,'c2200000-0000-4000-8000-000000000003'::uuid,'c2200000-0000-4000-8000-000000000004'::uuid,true),
    ('link-match','c2200000-0000-4000-8000-000000000005'::uuid,'c2200000-0000-4000-8000-000000000006'::uuid,'c2200000-0000-4000-8000-000000000007'::uuid,'c2100000-0000-4000-8000-000000000005'::uuid,false)
  ) as cases(label,pass_id,product_id,operation_id,application_id,create_record)
  loop
    v_index := v_index + 1; perform pg_temp.cw2_clone(v_case.pass_id,v_case.product_id,110+v_index);
    v_rejected := false;
    begin
      perform public.mark_program_pass_applied(
        '27010000-0000-4000-8000-000000000005',v_case.operation_id,v_case.pass_id,
        '2027-07-07',40,
        pg_temp.cw2_actual(v_case.product_id,'Synthetic Cedar Herbicide 41','27040000-0000-4000-8000-000000000005',0.001,'gal'),
        v_case.application_id,v_case.create_record
      );
    exception when others then v_rejected := true;
    end;
    if not v_rejected
       or not exists(select 1 from public.assigned_program_passes where id=v_case.pass_id and status='planned')
       or exists(select 1 from public.program_inventory_matches where assigned_product_id=v_case.product_id)
       or exists(select 1 from public.repository_write_receipts where operation_id=v_case.operation_id)
       or exists(select 1 from public.application_records where id=v_case.application_id and v_case.create_record) then
      raise exception 'CW2 % did not fail with zero writes',v_case.label;
    end if;
  end loop;

  perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000011','c2200000-0000-4000-8000-000000000012',113);
  perform public.mark_program_pass_applied(
    '27010000-0000-4000-8000-000000000005','c2200000-0000-4000-8000-000000000013',
    'c2200000-0000-4000-8000-000000000011','2027-07-07',40,
    pg_temp.cw2_actual('c2200000-0000-4000-8000-000000000012','Unmatched free-typed product'),null,false
  );
  if not exists(select 1 from public.assigned_program_passes where id='c2200000-0000-4000-8000-000000000011' and status='applied' and application_record_id is null)
     or exists(select 1 from public.program_inventory_matches where assigned_product_id='c2200000-0000-4000-8000-000000000012') then
    raise exception 'CW2 unmatched no-confirm path did not apply without Inventory';
  end if;

  -- CW2 stale-unit database denial with exact zero-public-state proof.
  perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000071','c2200000-0000-4000-8000-000000000072',119);
  select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'hash',row_hash,'rows',rows) order by table_name)
    into strict v_before_public from cw2_proof.public_snapshot();
  select on_hand_quantity into strict v_before_on_hand from public.inventory_on_hand
  where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005';
  v_rejected := false;
  begin
    perform public.mark_program_pass_applied(
      '27010000-0000-4000-8000-000000000005','c2200000-0000-4000-8000-000000000073',
      'c2200000-0000-4000-8000-000000000071','2027-07-07',40,
      pg_temp.cw2_actual('c2200000-0000-4000-8000-000000000072','Synthetic Cedar Herbicide 41','27040000-0000-4000-8000-000000000005',0.001,'qt'),null,false
    );
  exception when others then v_rejected := true;
  end;
  if not v_rejected
     or not exists(select 1 from public.assigned_program_passes where id='c2200000-0000-4000-8000-000000000071' and status='planned' and applied_on is null and applied_acres is null and application_record_id is null)
     or not exists(select 1 from public.assigned_program_pass_products where id='c2200000-0000-4000-8000-000000000072' and actual_product_name is null and actual_rate_text is null and actual_unit_text is null and actual_cost_per_acre is null)
     or exists(select 1 from public.program_inventory_matches where assigned_product_id='c2200000-0000-4000-8000-000000000072')
     or exists(select 1 from public.repository_write_receipts where operation_id='c2200000-0000-4000-8000-000000000073')
     or exists(select 1 from public.application_records where id='c2200000-0000-4000-8000-000000000073')
     or exists(select 1 from public.application_products where application_id='c2200000-0000-4000-8000-000000000073')
     or (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005') <> v_before_on_hand
     or (select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'hash',row_hash,'rows',rows) order by table_name) from cw2_proof.public_snapshot()) <> v_before_public then
    raise exception 'CW2 stale Inventory unit did not fail with exact zero public state change';
  end if;

  perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000061','c2200000-0000-4000-8000-000000000062',113);
  v_rejected := false;
  begin
    perform public.mark_program_pass_applied(
      '27010000-0000-4000-8000-000000000005','c2200000-0000-4000-8000-000000000063',
      'c2200000-0000-4000-8000-000000000061','2027-07-07',40,
      pg_temp.cw2_actual('c2200000-0000-4000-8000-000000000062','synthetic cedar herbicide 41','27040000-0000-4000-8000-000000000005',0.001,'gal'),null,false
    );
  exception when others then v_rejected := true;
  end;
  if not v_rejected
     or not exists(select 1 from public.assigned_program_passes where id='c2200000-0000-4000-8000-000000000061' and status='planned')
     or exists(select 1 from public.assigned_program_pass_products where id='c2200000-0000-4000-8000-000000000062' and actual_product_name is not null)
     or exists(select 1 from public.program_inventory_matches where assigned_product_id='c2200000-0000-4000-8000-000000000062')
     or exists(select 1 from public.repository_write_receipts where operation_id='c2200000-0000-4000-8000-000000000063') then
    raise exception 'CW2 case-only Inventory name match did not fail with zero writes';
  end if;

  insert into public.inventory_products (id,farm_id,product_kind,name,inventory_unit,is_active)
  values ('c2200000-0000-4000-8000-000000000020','27010000-0000-4000-8000-000000000005','chemical','Synthetic Cedar Herbicide 41','gal',true);
  perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000021','c2200000-0000-4000-8000-000000000022',114);
  v_rejected := false;
  begin
    perform public.mark_program_pass_applied('27010000-0000-4000-8000-000000000005','c2200000-0000-4000-8000-000000000023','c2200000-0000-4000-8000-000000000021','2027-07-07',40,pg_temp.cw2_actual('c2200000-0000-4000-8000-000000000022','Synthetic Cedar Herbicide 41','27040000-0000-4000-8000-000000000005',0.001,'gal'),null,false);
  exception when others then v_rejected := true;
  end;
  if not v_rejected or not exists(select 1 from public.assigned_program_passes where id='c2200000-0000-4000-8000-000000000021' and status='planned') then raise exception 'CW2 ambiguous exact name did not fail closed'; end if;
  delete from public.inventory_products where id='c2200000-0000-4000-8000-000000000020';

  insert into public.inventory_products (id,farm_id,product_kind,name,inventory_unit,is_active)
  values ('c2200000-0000-4000-8000-000000000030','27010000-0000-4000-8000-000000000005','chemical','Inactive CW2 product','gal',false);
  perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000031','c2200000-0000-4000-8000-000000000032',115);
  v_rejected := false;
  begin
    perform public.mark_program_pass_applied('27010000-0000-4000-8000-000000000005','c2200000-0000-4000-8000-000000000033','c2200000-0000-4000-8000-000000000031','2027-07-07',40,pg_temp.cw2_actual('c2200000-0000-4000-8000-000000000032','Inactive CW2 product','c2200000-0000-4000-8000-000000000030',0.001,'gal'),null,false);
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'CW2 inactive product did not fail closed'; end if;

  -- CW2-FIXTURE-002 foreign authenticated context begin.
  perform set_config(
    'request.headers',
    jsonb_build_object(
      'x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001',
      'x-farm-rx-access-epochs',jsonb_build_object('c2290000-0000-4000-8000-000000000001',1)::text
    )::text,
    true
  );
  insert into public.farms (id,name,share_with_rep,created_by,time_zone)
  values ('c2290000-0000-4000-8000-000000000001','CW2 foreign farm',false,'27000000-0000-4000-8000-000000000001','America/Chicago');
  if auth.uid() <> '27000000-0000-4000-8000-000000000001'
     or public.current_request_expected_user_id() <> '27000000-0000-4000-8000-000000000001'
     or public.current_request_farm_access_epoch('c2290000-0000-4000-8000-000000000001') <> 1
     or public.current_request_farm_access_epoch('27010000-0000-4000-8000-000000000005') is not null
     or not public.can_access_farm('c2290000-0000-4000-8000-000000000001')
     or not exists (
       select 1 from public.farm_memberships
       where farm_id='c2290000-0000-4000-8000-000000000001'
         and user_id='27000000-0000-4000-8000-000000000001'
         and role='owner' and status='active'
     )
     or not exists (
       select 1 from public.farm_access_epochs
       where farm_id='c2290000-0000-4000-8000-000000000001'
         and user_id='27000000-0000-4000-8000-000000000001'
         and access_epoch=1
     ) then
    raise exception 'CW2 foreign fixture did not establish exact authenticated owner epoch one';
  end if;
  insert into public.inventory_products (id,farm_id,product_kind,name,inventory_unit,is_active)
  values ('c2290000-0000-4000-8000-000000000002','c2290000-0000-4000-8000-000000000001','chemical','Synthetic Cedar Herbicide 41','gal',true);
  perform set_config(
    'request.headers',
    jsonb_build_object(
      'x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001',
      'x-farm-rx-access-epochs',jsonb_build_object('27010000-0000-4000-8000-000000000005',1)::text
    )::text,
    true
  );
  if auth.uid() <> '27000000-0000-4000-8000-000000000001'
     or public.current_request_expected_user_id() <> '27000000-0000-4000-8000-000000000001'
     or public.current_request_farm_access_epoch('27010000-0000-4000-8000-000000000005') <> 1
     or public.current_request_farm_access_epoch('c2290000-0000-4000-8000-000000000001') is not null
     or not public.can_access_farm('27010000-0000-4000-8000-000000000005') then
    raise exception 'CW2 did not restore the exact Cedar operation context before foreign denial';
  end if;
  perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000041','c2200000-0000-4000-8000-000000000042',116);
  select to_jsonb(product) into strict v_foreign_product_before
  from public.inventory_products product where product.id='c2290000-0000-4000-8000-000000000002';
  select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'hash',row_hash,'rows',rows) order by table_name)
    into strict v_before_public from cw2_proof.public_snapshot();
  v_rejected := false; v_error := null;
  begin
    perform public.mark_program_pass_applied('27010000-0000-4000-8000-000000000005','c2200000-0000-4000-8000-000000000043','c2200000-0000-4000-8000-000000000041','2027-07-07',40,pg_temp.cw2_actual('c2200000-0000-4000-8000-000000000042','Synthetic Cedar Herbicide 41','c2290000-0000-4000-8000-000000000002',0.001,'gal'),null,false);
  exception when others then v_rejected := true; v_error := sqlerrm;
  end;
  if not v_rejected
     or v_error <> 'confirmed inventory product is inactive, foreign, stale, or not the exact name match'
     or public.current_request_farm_access_epoch('27010000-0000-4000-8000-000000000005') <> 1
     or public.current_request_farm_access_epoch('c2290000-0000-4000-8000-000000000001') is not null
     or not exists (
       select 1 from public.assigned_program_passes
       where id='c2200000-0000-4000-8000-000000000041' and status='planned'
         and applied_on is null and applied_acres is null and application_record_id is null
     )
     or not exists (
       select 1 from public.assigned_program_pass_products
       where id='c2200000-0000-4000-8000-000000000042'
         and actual_product_name is null and actual_rate_text is null
         and actual_unit_text is null and actual_cost_per_acre is null
     )
     or exists(select 1 from public.program_inventory_matches where assigned_product_id='c2200000-0000-4000-8000-000000000042')
     or exists(select 1 from public.repository_write_receipts where operation_id='c2200000-0000-4000-8000-000000000043')
     or exists(select 1 from public.application_records where id='c2200000-0000-4000-8000-000000000043')
     or exists(select 1 from public.application_products where application_id='c2200000-0000-4000-8000-000000000043')
     or (select to_jsonb(product) from public.inventory_products product where product.id='c2290000-0000-4000-8000-000000000002') <> v_foreign_product_before
     or (select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'hash',row_hash,'rows',rows) order by table_name) from cw2_proof.public_snapshot()) <> v_before_public then
    raise exception 'CW2 foreign Inventory product did not fail at the exact RPC farm boundary with zero public change';
  end if;
  -- CW2-FIXTURE-002 foreign authenticated context end.

  for v_case in select * from (values
    ('c2200000-0000-4000-8000-000000000051'::uuid,'c2200000-0000-4000-8000-000000000052'::uuid,'c2200000-0000-4000-8000-000000000053'::uuid,0.000000001::numeric),
    ('c2200000-0000-4000-8000-000000000054'::uuid,'c2200000-0000-4000-8000-000000000055'::uuid,'c2200000-0000-4000-8000-000000000056'::uuid,10000000.00000001::numeric)
  ) as cases(pass_id,product_id,operation_id,quantity)
  loop
    v_index := v_index + 1; perform pg_temp.cw2_clone(v_case.pass_id,v_case.product_id,120+v_index);
    v_rejected := false;
    begin
      perform public.mark_program_pass_applied('27010000-0000-4000-8000-000000000005',v_case.operation_id,v_case.pass_id,'2027-07-07',40,pg_temp.cw2_actual(v_case.product_id,'Synthetic Cedar Herbicide 41','27040000-0000-4000-8000-000000000005',v_case.quantity,'gal'),null,false);
    exception when others then v_rejected := true;
    end;
    if not v_rejected or exists(select 1 from public.program_inventory_matches where assigned_product_id=v_case.product_id) then raise exception 'CW2 unsafe quantity did not fail before writes'; end if;
  end loop;
end
$negative$;

-- Every accepted edge of the shared 1e-8 scaled-integer domain round-trips
-- through the RPC and immutable ledger without a guessed conversion.
do $accepted_bounds$
declare v_case record; v_match numeric; v_result jsonb; v_index integer := 0; v_before_on_hand numeric; v_rolled_back boolean; v_rollback_message constant text := 'CW2 accepted-bound isolation rollback';
begin
  select on_hand_quantity into strict v_before_on_hand from public.inventory_on_hand
  where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005';
  for v_case in select * from (values
    ('c2250000-0000-4000-8000-000000000001'::uuid,'c2250000-0000-4000-8000-000000000002'::uuid,'c2250000-0000-4000-8000-000000000003'::uuid,0.00000001::numeric),
    ('c2250000-0000-4000-8000-000000000004'::uuid,'c2250000-0000-4000-8000-000000000005'::uuid,'c2250000-0000-4000-8000-000000000006'::uuid,0.001::numeric),
    ('c2250000-0000-4000-8000-000000000007'::uuid,'c2250000-0000-4000-8000-000000000008'::uuid,'c2250000-0000-4000-8000-000000000009'::uuid,9999999.99999999::numeric),
    ('c2250000-0000-4000-8000-000000000010'::uuid,'c2250000-0000-4000-8000-000000000011'::uuid,'c2250000-0000-4000-8000-000000000012'::uuid,10000000::numeric)
  ) as cases(pass_id,product_id,operation_id,quantity)
  loop
    v_index := v_index + 1; perform pg_temp.cw2_clone(v_case.pass_id,v_case.product_id,125+v_index);
    v_rolled_back := false;
    begin
      v_result := public.mark_program_pass_applied(
        '27010000-0000-4000-8000-000000000005',v_case.operation_id,v_case.pass_id,
        '2027-07-07',40,
        pg_temp.cw2_actual(v_case.product_id,'Synthetic Cedar Herbicide 41','27040000-0000-4000-8000-000000000005',v_case.quantity,'gal'),
        null,false
      );
      select quantity_in_inventory_unit into strict v_match
      from public.program_inventory_matches where assigned_product_id=v_case.product_id;
      if v_match <> v_case.quantity
         or v_result->>'inventory_matched' <> 'true'
         or (v_result->>'inventory_match_count')::integer <> 1
         or jsonb_array_length(v_result->'inventory_matches') <> 1
         or (v_result#>>'{inventory_matches,0,quantity_in_inventory_unit}')::numeric <> v_case.quantity
      then raise exception 'CW2 accepted quantity % did not round-trip with the exact result shape',v_case.quantity; end if;
      raise exception using errcode='CW201',message=v_rollback_message;
    exception when sqlstate 'CW201' then
      if sqlerrm <> v_rollback_message then raise; end if;
      v_rolled_back := true;
    end;
    if not v_rolled_back
       or not exists(select 1 from public.assigned_program_passes where id=v_case.pass_id and status='planned')
       or exists(select 1 from public.program_inventory_matches where assigned_product_id=v_case.product_id)
       or exists(select 1 from public.repository_write_receipts where operation_id=v_case.operation_id)
       or exists(select 1 from public.assigned_program_pass_products where id=v_case.product_id and actual_product_name is not null)
       or (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005') <> v_before_on_hand
    then raise exception 'CW2 accepted quantity % poisoned the shared browser baseline',v_case.quantity; end if;
  end loop;
end
$accepted_bounds$;

-- The table itself rejects values the RPC rejects.
select pg_temp.cw2_clone('c2300000-0000-4000-8000-000000000001','c2300000-0000-4000-8000-000000000002',130);
do $table_bounds$
declare v_rejected boolean; v_quantity numeric;
begin
  foreach v_quantity in array array[0.000000001::numeric,10000000.00000001::numeric] loop
    v_rejected := false;
    begin
      insert into public.program_inventory_matches (
        farm_id,assigned_product_id,inventory_product_id,quantity_in_inventory_unit,
        inventory_product_name_snapshot,inventory_unit_snapshot,operation_id,confirmed_by
      ) values (
        '27010000-0000-4000-8000-000000000005','c2300000-0000-4000-8000-000000000002',
        '27040000-0000-4000-8000-000000000005',v_quantity,
        'Synthetic Cedar Herbicide 41','gal','c2300000-0000-4000-8000-000000000003',
        '27000000-0000-4000-8000-000000000001'
      );
    exception when check_violation then v_rejected := true;
    end;
    if not v_rejected then raise exception 'CW2 table accepted unsafe quantity %',v_quantity; end if;
  end loop;
end
$table_bounds$;

-- A deliberately late receipt failure must roll back pass facts and draw-down.
select pg_temp.cw2_clone('c2400000-0000-4000-8000-000000000001','c2400000-0000-4000-8000-000000000002',140);
create function public.cw2_fail_receipt_probe() returns trigger language plpgsql set search_path='' as $$
begin
  if new.operation_id='c2400000-0000-4000-8000-000000000003' then raise exception 'CW2 deliberate late receipt failure'; end if;
  return new;
end
$$;
create trigger cw2_fail_receipt_probe before insert on public.repository_write_receipts
for each row execute function public.cw2_fail_receipt_probe();
do $atomic$
declare v_rejected boolean := false;
begin
  begin
    perform public.mark_program_pass_applied(
      '27010000-0000-4000-8000-000000000005','c2400000-0000-4000-8000-000000000003',
      'c2400000-0000-4000-8000-000000000001','2027-07-07',40,
      pg_temp.cw2_actual('c2400000-0000-4000-8000-000000000002','Synthetic Cedar Herbicide 41','27040000-0000-4000-8000-000000000005',0.001,'gal'),
      null,false
    );
  exception when others then v_rejected := true;
  end;
  if not v_rejected
     or not exists(select 1 from public.assigned_program_passes where id='c2400000-0000-4000-8000-000000000001' and status='planned')
     or exists(select 1 from public.program_inventory_matches where assigned_product_id='c2400000-0000-4000-8000-000000000002')
     or exists(select 1 from public.repository_write_receipts where operation_id='c2400000-0000-4000-8000-000000000003')
     or exists(select 1 from public.assigned_program_pass_products where id='c2400000-0000-4000-8000-000000000002' and actual_product_name is not null)
     or (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005') <> 19.999 then
    raise exception 'CW2 late failure did not roll back the atomic transaction';
  end if;
end
$atomic$;
drop trigger cw2_fail_receipt_probe on public.repository_write_receipts;
drop function public.cw2_fail_receipt_probe();

-- Owner can read the immutable match but API roles cannot write it directly.
set local role authenticated;
do $rls_owner$
declare v_rejected boolean := false;
begin
  if (select count(*) from public.program_inventory_matches where farm_id='27010000-0000-4000-8000-000000000005') <> 1 then raise exception 'CW2 owner RLS read failed'; end if;
  begin
    insert into public.program_inventory_matches (
      farm_id,assigned_product_id,inventory_product_id,quantity_in_inventory_unit,
      inventory_product_name_snapshot,inventory_unit_snapshot,operation_id,confirmed_by
    ) values (
      '27010000-0000-4000-8000-000000000005','c2300000-0000-4000-8000-000000000002',
      '27040000-0000-4000-8000-000000000005',1,
      'Synthetic Cedar Herbicide 41','gal','c2300000-0000-4000-8000-000000000004',
      '27000000-0000-4000-8000-000000000001'
    );
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'CW2 API role directly wrote the match ledger'; end if;
end
$rls_owner$;
reset role;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000006',true);
select set_config('request.headers','{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000006","x-farm-rx-access-epochs":"{}"}',true);
set local role authenticated;
do $rls_denied$
begin
  if (select count(*) from public.program_inventory_matches) <> 0 then raise exception 'CW2 denied actor read match history'; end if;
end
$rls_denied$;
reset role;
rollback;
drop schema cw2_proof cascade;
\echo CONNECT_WORKFLOWS_CW2_BASE_SQL_PASS
