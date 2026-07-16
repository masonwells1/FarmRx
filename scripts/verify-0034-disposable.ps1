$ErrorActionPreference = 'Stop'
$name = "farmrx-0034-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false
try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:16 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) { if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') { $ready = $true; break }; Start-Sleep -Milliseconds 500 }
  if (!$ready) { throw 'Disposable postgres:16 did not become ready.' }
  $bootstrap = "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid `$`$; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;"
  $bootstrap | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  $beforeMigrations = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object { (Get-Content -Raw $_.FullName) | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable; if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $beforeMigrations; throw "Migration failed: $($_.Name)" } }
  $ErrorActionPreference = $beforeMigrations
  @'
insert into auth.users (id,email) values ('00000000-0000-4000-8000-000000000001','probe@example.test');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into public.farms (id,name,created_by) values ('00000000-0000-4000-8000-000000000010','Probe Farm','00000000-0000-4000-8000-000000000001');
do $$
declare b jsonb := '{"id":"00000000-0000-4000-8000-000000000100","farm_id":"00000000-0000-4000-8000-000000000010","crop_year":2026,"commodity_id":"corn_yellow","operating_entity_id":null,"enterprise_label":null,"name":"Probe create","expected_yield_per_acre":200,"expected_price_per_bushel":4.5,"rp_coverage_pct":80,"rp_aph_yield":180,"rp_projected_price":4.62,"rp_premium_per_acre":10,"copied_from_budget_id":null,"notes":null}'::jsonb;
  s jsonb := '[{"id":"00000000-0000-4000-8000-000000000101","budget_id":"00000000-0000-4000-8000-000000000100","axis":"price","value":4,"sort_order":0},{"id":"00000000-0000-4000-8000-000000000102","budget_id":"00000000-0000-4000-8000-000000000100","axis":"price","value":5,"sort_order":1},{"id":"00000000-0000-4000-8000-000000000103","budget_id":"00000000-0000-4000-8000-000000000100","axis":"yield","value":180,"sort_order":0},{"id":"00000000-0000-4000-8000-000000000104","budget_id":"00000000-0000-4000-8000-000000000100","axis":"yield","value":220,"sort_order":1}]'::jsonb;
  c jsonb; cl jsonb; copied jsonb;
begin
  perform public.create_crop_budget_with_matrix('00000000-0000-4000-8000-000000000010',b,s);
  perform public.create_crop_budget_with_matrix('00000000-0000-4000-8000-000000000010',b,s);
  if (select count(*) from public.crop_budgets where id='00000000-0000-4000-8000-000000000100') <> 1 then raise exception 'create replay inserted another row'; end if;
  begin perform public.create_crop_budget_with_matrix('00000000-0000-4000-8000-000000000010',b,jsonb_set(s,'{0,value}','6')); raise exception 'different create replay did not conflict'; exception when others then if position('CREATE_BUDGET_OPERATION_CONFLICT' in sqlerrm)=0 then raise; end if; end;
  begin perform public.replace_profitability_matrix_steps('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',s,'[]'::jsonb); raise exception 'CAS mismatch did not conflict'; exception when others then if position('MATRIX_CHANGED_ON_ANOTHER_DEVICE' in sqlerrm)=0 then raise; end if; end;
  perform public.replace_profitability_matrix_steps('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',s,s);
  perform public.replace_profitability_matrix_steps('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',s);
  copied := jsonb_set(b,'{id}','"00000000-0000-4000-8000-000000000110"'); copied := jsonb_set(copied,'{name}','"Probe copy"'); copied := jsonb_set(copied,'{copied_from_budget_id}','"00000000-0000-4000-8000-000000000100"');
  c := jsonb_set(s,'{0,budget_id}','"00000000-0000-4000-8000-000000000110"'); c := jsonb_set(c,'{1,budget_id}','"00000000-0000-4000-8000-000000000110"'); c := jsonb_set(c,'{2,budget_id}','"00000000-0000-4000-8000-000000000110"'); c := jsonb_set(c,'{3,budget_id}','"00000000-0000-4000-8000-000000000110"'); c := jsonb_set(c,'{0,id}','"00000000-0000-4000-8000-000000000111"'); c := jsonb_set(c,'{1,id}','"00000000-0000-4000-8000-000000000112"'); c := jsonb_set(c,'{2,id}','"00000000-0000-4000-8000-000000000113"'); c := jsonb_set(c,'{3,id}','"00000000-0000-4000-8000-000000000114"');
  cl := '[{"id":"00000000-0000-4000-8000-000000000115","farm_id":"00000000-0000-4000-8000-000000000010","budget_id":"00000000-0000-4000-8000-000000000110","category":"seed","label":"Probe seed","amount_per_acre":42,"source_kind":"manual","source_record_id":null,"sort_order":0,"notes":null}]'::jsonb;
  perform public.copy_crop_budget_durable('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',copied,cl,c);
  perform public.copy_crop_budget_durable('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',copied,cl,c);
  begin perform public.copy_crop_budget_durable('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',copied,jsonb_set(cl,'{0,amount_per_acre}','43'),c); raise exception 'cost-line-only copy replay did not conflict'; exception when others then if position('COPY_BUDGET_OPERATION_CONFLICT' in sqlerrm)=0 then raise; end if; end;
  begin perform public.copy_crop_budget_durable('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',copied,cl,jsonb_set(c,'{0,value}','6')); raise exception 'different copy replay did not conflict'; exception when others then if position('COPY_BUDGET_OPERATION_CONFLICT' in sqlerrm)=0 then raise; end if; end;
end $$;
'@ | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw '0034 durability behavior probe failed.' }
  $passed = $true
} finally { docker rm -f $name 2>$null | Out-Null }
if ($passed) { Write-Output 'PROBE disposable migration suite: PASS' }
