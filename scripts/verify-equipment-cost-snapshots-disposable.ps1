$ErrorActionPreference = 'Stop'

$name = "farmrx-equipment-cost-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the disposable equipment-cost proof.'
}

function Invoke-Probe([string]$sql, [string]$failure) {
  $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw $failure }
}

function Invoke-ExpectedFailure([string]$sql, [string]$expected, [string]$failure) {
  $priorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $priorPreference
  }
  if ($exitCode -eq 0 -or ($output -join "`n") -notmatch [regex]::Escape($expected)) {
    throw $failure
  }
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Disposable postgres:17 did not become ready.' }

  Invoke-Probe "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;" 'Disposable database bootstrap failed.'

  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' |
    Sort-Object Name |
    ForEach-Object {
      Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)"
    }

  Invoke-Probe @'
insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000001','owner-a@equipment.test'),
  ('10000000-0000-4000-8000-000000000002','worker-a@equipment.test'),
  ('10000000-0000-4000-8000-000000000003','owner-b@equipment.test');

select set_config('request.jwt.claims','{"role":"service_role","sub":"10000000-0000-4000-8000-000000000001"}',false);
insert into public.farms(id,name,created_by)
values ('10000000-0000-4000-8000-000000000010','Equipment Proof A','10000000-0000-4000-8000-000000000001');
insert into public.farm_memberships(farm_id,user_id,role,status,can_view_financials)
values ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000002','worker','active',false);

select set_config('request.jwt.claims','{"role":"service_role","sub":"10000000-0000-4000-8000-000000000003"}',false);
insert into public.farms(id,name,created_by)
values ('10000000-0000-4000-8000-000000000020','Equipment Proof B','10000000-0000-4000-8000-000000000003');

select set_config('request.jwt.claims','{"role":"service_role","sub":"10000000-0000-4000-8000-000000000001"}',false);
insert into public.equipment(id,farm_id,name,category,purchase_price,created_by)
values ('10000000-0000-4000-8000-000000000100','10000000-0000-4000-8000-000000000010','Proof Sprayer','sprayer',90000,'10000000-0000-4000-8000-000000000001');
insert into public.equipment_service_log(id,farm_id,equipment_id,service_date,work_performed,cost,created_by) values
  ('10000000-0000-4000-8000-000000000110','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000100','2027-02-15','Pump service',100.25,'10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000111','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000100','2027-06-20','Nozzle service',200.50,'10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000112','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000100','2027-07-01','Inspection without invoice',null,'10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000113','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000100','2026-12-31','Prior-year service',999.99,'10000000-0000-4000-8000-000000000001');
insert into public.crop_budgets(id,farm_id,crop_year,commodity_id,name,expected_yield_per_acre,expected_price_per_bushel)
values ('10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000010',2027,'corn_yellow','2027 Corn',200,4.50);
insert into public.crop_budgets(id,farm_id,crop_year,commodity_id,name,expected_yield_per_acre,expected_price_per_bushel)
values ('10000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000020',2027,'corn_yellow','Other Farm Corn',200,4.50);
'@ 'Equipment-cost fixtures failed.'

  Invoke-Probe @'
do $$
declare
  v_type text;
  v_trigger_count integer;
begin
  select format_type(a.atttypid,a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid='public.budget_cost_lines'::regclass and a.attname='amount_per_acre';
  if v_type <> 'numeric(14,4)' then raise exception 'equipment migration widened the established amount_per_acre contract'; end if;
  if not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='upsert_equipment_cost_snapshot'
      and not p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']::text[]
  ) then raise exception 'equipment snapshot RPC is missing its invoker/search-path boundary'; end if;
  if has_function_privilege('anon','public.upsert_equipment_cost_snapshot(uuid,uuid,uuid,date,date,numeric,text,uuid,numeric,integer,integer)','execute')
    or not has_function_privilege('authenticated','public.upsert_equipment_cost_snapshot(uuid,uuid,uuid,date,date,numeric,text,uuid,numeric,integer,integer)','execute')
  then raise exception 'equipment snapshot RPC grants are wrong'; end if;
  select count(*) into v_trigger_count from pg_trigger
  where tgrelid='public.budget_cost_lines'::regclass and tgname='budget_cost_lines_guard_equipment_snapshot' and not tgisinternal;
  if v_trigger_count <> 1 then raise exception 'equipment snapshot direct-write trigger is missing'; end if;
  if not exists(
    select 1 from pg_indexes where schemaname='public' and tablename='budget_cost_lines'
      and indexname='budget_cost_lines_equipment_snapshot_key'
      and indexdef like '%UNIQUE INDEX%WHERE (source_kind = ''equipment''::text)%'
  ) then raise exception 'equipment snapshot partial uniqueness guard is missing'; end if;
end $$;
'@ 'Equipment-cost schema/catalog proof failed.'

  Invoke-Probe @'
begin;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object(
  'x-farm-rx-expected-user-id','10000000-0000-4000-8000-000000000001',
  'x-farm-rx-access-epochs',jsonb_build_object('10000000-0000-4000-8000-000000000010',(select access_epoch from public.farm_access_epochs where farm_id='10000000-0000-4000-8000-000000000010' and user_id='10000000-0000-4000-8000-000000000001'))::text
)::text,true);
set local role authenticated;
do $$
declare
  v_preview jsonb;
  v_saved jsonb;
  v_current jsonb;
  v_before integer;
begin
  select count(*) into v_before from public.budget_cost_lines;
  v_preview := public.upsert_equipment_cost_snapshot(
    '10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000100',
    '2027-01-01','2027-12-31',125,'preview','10000000-0000-4000-8000-000000000300'
  );
  if (select count(*) from public.budget_cost_lines) <> v_before then raise exception 'preview wrote a cost line'; end if;
  if v_preview #>> '{candidate,total_source_amount}' <> '300.75'
    or (v_preview #>> '{candidate,included_row_count}')::integer <> 2
    or (v_preview #>> '{candidate,excluded_null_cost_count}')::integer <> 1
    or (v_preview #>> '{candidate,amount_per_acre}')::numeric <> 2.4060
  then raise exception 'preview did not use the exact dated service costs and null-cost count'; end if;
  if (v_preview #>> '{candidate,total_source_amount}')::numeric = 90300.75 then raise exception 'purchase price leaked into service costs'; end if;

  v_saved := public.upsert_equipment_cost_snapshot(
    '10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000100',
    '2027-01-01','2027-12-31',125,'insert','10000000-0000-4000-8000-000000000300',300.75,2,1
  );
  if v_saved->>'action' <> 'insert' then raise exception 'reviewed insert was not confirmed'; end if;
  if not exists(
    select 1 from public.budget_cost_lines
    where id='10000000-0000-4000-8000-000000000300' and budget_id='10000000-0000-4000-8000-000000000200'
      and source_kind='equipment' and source_record_id='10000000-0000-4000-8000-000000000100'
      and amount_per_acre=2.4060 and equipment_total_source_amount=300.75 and equipment_allocation_acres=125
      and equipment_included_row_count=2 and equipment_excluded_null_cost_count=1
      and equipment_period_start='2027-01-01' and equipment_period_end='2027-12-31' and equipment_captured_at is not null
  ) then raise exception 'reviewed equipment snapshot provenance was not persisted exactly'; end if;

  begin
    insert into public.budget_cost_lines(id,farm_id,budget_id,category,label,amount_per_acre,source_kind,source_record_id,sort_order,equipment_period_start,equipment_period_end,equipment_total_source_amount,equipment_allocation_acres,equipment_included_row_count,equipment_excluded_null_cost_count,equipment_captured_at)
    values ('10000000-0000-4000-8000-000000000301','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','repairs','Forged snapshot',1,'equipment','10000000-0000-4000-8000-000000000100',1,'2027-01-01','2027-12-31',125,125,1,0,now());
    raise exception 'direct equipment snapshot insert succeeded';
  exception when others then
    if position('must be created or replaced from current server service costs' in sqlerrm)=0 then raise; end if;
  end;

  perform public.save_service_log_entry(
    '10000000-0000-4000-8000-000000000010',
    jsonb_build_object('id','10000000-0000-4000-8000-000000000115','equipment_id','10000000-0000-4000-8000-000000000100','service_date','2027-08-01','work_performed','Later service after review','parts',null,'vendor',null,'cost',50.00,'meter_reading',null,'interval_id',null),
    null
  );
  begin
    perform public.upsert_equipment_cost_snapshot(
      '10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000100',
      '2027-01-01','2027-12-31',125,'replace','10000000-0000-4000-8000-000000000300',300.75,2,1
    );
    raise exception 'stale reviewed total was saved';
  exception when others then
    if position('service costs changed after review' in sqlerrm)=0 then raise; end if;
  end;

  v_current := public.upsert_equipment_cost_snapshot(
    '10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000100',
    '2027-01-01','2027-12-31',125,'preview','10000000-0000-4000-8000-000000000999'
  );
  perform public.upsert_equipment_cost_snapshot(
    '10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000100',
    '2027-01-01','2027-12-31',125,'replace','10000000-0000-4000-8000-000000000300',
    (v_current #>> '{candidate,total_source_amount}')::numeric,(v_current #>> '{candidate,included_row_count}')::integer,(v_current #>> '{candidate,excluded_null_cost_count}')::integer
  );
  if (select count(*) from public.budget_cost_lines where budget_id='10000000-0000-4000-8000-000000000200' and source_kind='equipment') <> 1
    or not exists(select 1 from public.budget_cost_lines where id='10000000-0000-4000-8000-000000000300' and equipment_total_source_amount=350.75 and amount_per_acre=2.8060)
  then raise exception 'replace did not update the exact existing row once'; end if;

  perform public.save_service_log_entry(
    '10000000-0000-4000-8000-000000000010',
    jsonb_build_object('id','10000000-0000-4000-8000-000000000116','equipment_id','10000000-0000-4000-8000-000000000100','service_date','2027-09-01','work_performed','Another later service','parts',null,'vendor',null,'cost',150.00,'meter_reading',null,'interval_id',null),
    null
  );
  v_current := public.upsert_equipment_cost_snapshot(
    '10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000100',
    '2027-01-01','2027-12-31',125,'preview','10000000-0000-4000-8000-000000000302'
  );
  begin
    perform public.upsert_equipment_cost_snapshot(
      '10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000100',
      '2027-01-01','2027-12-31',125,'insert','10000000-0000-4000-8000-000000000302',
      (v_current #>> '{candidate,total_source_amount}')::numeric,(v_current #>> '{candidate,included_row_count}')::integer,(v_current #>> '{candidate,excluded_null_cost_count}')::integer
    );
    raise exception 'changed duplicate snapshot was silently kept';
  exception when others then
    if position('older equipment cost snapshot already exists' in sqlerrm)=0 then raise; end if;
  end;
end $$;
commit;
'@ 'Authenticated equipment-cost behavior proof failed.'

  Invoke-ExpectedFailure @'
begin;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000002"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','10000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('10000000-0000-4000-8000-000000000010',(select access_epoch from public.farm_access_epochs where farm_id='10000000-0000-4000-8000-000000000010' and user_id='10000000-0000-4000-8000-000000000002'))::text)::text,true);
set local role authenticated;
select public.upsert_equipment_cost_snapshot('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000100','2027-01-01','2027-12-31',125,'preview','10000000-0000-4000-8000-000000000400');
'@ "you do not have permission to edit this farm's profitability" 'A worker without private-financial permission read equipment costs.'

  Invoke-ExpectedFailure @'
begin;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','10000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('10000000-0000-4000-8000-000000000010',(select access_epoch from public.farm_access_epochs where farm_id='10000000-0000-4000-8000-000000000010' and user_id='10000000-0000-4000-8000-000000000001'))::text)::text,true);
set local role authenticated;
select public.upsert_equipment_cost_snapshot('10000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000100','2027-01-01','2027-12-31',125,'preview','10000000-0000-4000-8000-000000000401');
'@ "you do not have permission to edit this farm's profitability" 'An owner reached another farm through the equipment-cost RPC.'

  Invoke-ExpectedFailure @'
set role anon;
select public.upsert_equipment_cost_snapshot('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000200','10000000-0000-4000-8000-000000000100','2027-01-01','2027-12-31',125,'preview','10000000-0000-4000-8000-000000000402');
'@ 'permission denied for function upsert_equipment_cost_snapshot' 'Anonymous execution reached the equipment-cost RPC.'

  $passed = $true
  Write-Output 'Disposable equipment-cost snapshot proof passed.'
} finally {
  $priorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  docker rm -f $name 2>$null | Out-Null
  $ErrorActionPreference = $priorPreference
  if (-not $passed) { Write-Error 'Disposable equipment-cost snapshot proof failed; container cleanup was attempted.' }
}
