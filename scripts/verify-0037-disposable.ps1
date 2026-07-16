$ErrorActionPreference = 'Stop'
$name = "farmrx-0037-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the disposable 0037 proof but is not available on PATH.' }

function Invoke-Probe([string]$sql, [string]$failure) {
  $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw $failure }
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Disposable postgres:17 did not become ready.' }

  Invoke-Probe "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;" 'Disposable bootstrap failed.'
  $migrations = Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name
  $repairMigration = $migrations | Where-Object Name -EQ '0038_modern_postgrest_service_role_claims.sql'
  if (!$repairMigration) { throw 'Migration 0038 modern PostgREST service-role repair is missing.' }
  $migrations | Where-Object Name -LT $repairMigration.Name | ForEach-Object { Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)" }

  Invoke-Probe @'
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000001','scheduler-owner@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
insert into public.farms(id,name,created_by,time_zone) values ('00000000-0000-4000-8000-000000000010','Scheduler Farm','00000000-0000-4000-8000-000000000001','America/Chicago');
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','owner','active') on conflict(farm_id,user_id) do update set role='owner',status='active';
insert into public.entities(id,farm_id,name,entity_type) values
  ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','Scoped Entity','individual'),
  ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000010','Other Entity','individual');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Scheduler Field',80);
insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planted_acres) values ('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030',2026,'corn_yellow',80);

-- The scoped entity is 10% marketed. The other entity makes a whole-farm
-- calculation exceed 100%, so this proves the scheduler does not leak scope.
insert into public.production_estimates(id,farm_id,crop_year,commodity_id,operating_entity_id,planted_acres,aph_yield,expected_bushels,drives_math) values
  ('00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000010',2026,'corn_yellow','00000000-0000-4000-8000-000000000020',80,180,1000,'projected'),
  ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000010',2026,'corn_yellow','00000000-0000-4000-8000-000000000021',10,50,100,'projected');
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,operating_entity_id,contract_type,buyer,bushels,cash_price) values
  ('00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000010',2026,'corn_yellow','00000000-0000-4000-8000-000000000020','forward_cash','Scoped Buyer',100,4.5),
  ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000010',2026,'corn_yellow','00000000-0000-4000-8000-000000000021','forward_cash','Other Buyer',1000,4.5);
insert into public.cash_bids(id,farm_id,elevator,commodity_id,bid_date,basis,cash_price) values
  ('00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000010','Fresh Elevator','corn_yellow','2026-07-14',0,5.00),
  ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000010','Stale Elevator','soybeans','2026-07-12',0,20.00);
insert into public.marketing_alert_rules(id,farm_id,crop_year,commodity_id,operating_entity_id,rule_type,direction,threshold) values
  ('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000010',2026,'corn_yellow',null,'price_target','at_or_above',4.75),
  ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000010',2026,'soybeans',null,'price_target','at_or_above',12.00),
  ('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000010',2026,'corn_yellow','00000000-0000-4000-8000-000000000020','pct_marketed_goal',null,50);

insert into public.programs(id,farm_id,name,commodity_id,crop_year,created_by,updated_by) values ('00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000010','Scheduler Program','corn_yellow',2026,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
insert into public.program_assignments(id,farm_id,program_id,crop_assignment_id,program_name_snapshot,template_revision,assigned_by) values ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000040','Scheduler Program',1,'00000000-0000-4000-8000-000000000001');
insert into public.assigned_program_passes(id,farm_id,assignment_id,source_revision,sequence,name,pass_type,activity_type,target_date,reminder_lead_days,due_on,due_source,created_by,updated_by) values ('00000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000091',1,1,'Due Pass','post','spray','2026-07-16',1,'2026-07-16','template_date','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');

do $$ begin
  if has_function_privilege('authenticated','public.run_scheduled_alert_sweep(timestamptz)','execute') then raise exception 'authenticated can execute scheduler sweep'; end if;
  if has_function_privilege('anon','public.run_scheduled_alert_sweep(timestamptz)','execute') then raise exception 'anon can execute scheduler sweep'; end if;
  if has_function_privilege('authenticated','public.record_scheduled_spray_window(uuid,uuid,date,boolean,timestamptz,jsonb)','execute') then raise exception 'authenticated can record server spray state'; end if;
  if has_function_privilege('anon','public.record_scheduled_spray_window(uuid,uuid,date,boolean,timestamptz,jsonb)','execute') then raise exception 'anon can record server spray state'; end if;
  if not has_function_privilege('service_role','public.run_scheduled_alert_sweep(timestamptz)','execute') then raise exception 'service role cannot execute scheduler sweep'; end if;
  if has_table_privilege('authenticated','public.spray_window_states','select') then raise exception 'authenticated can read private scheduler state'; end if;
  begin update public.farms set time_zone='Definitely/Not_A_Time_Zone' where id='00000000-0000-4000-8000-000000000010'; raise exception 'invalid timezone accepted'; exception when check_violation then null; end;
end $$;
'@ '0037 seed or access-control probe failed.'

  # Before-state proof: 0035/0037 inspect only request.jwt.claim.role, so a
  # JSON-only PostgREST service-role request must be rejected before 0038.
  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.jwt.claim.role','',false);
do $$ begin
  perform public.run_scheduled_alert_sweep('2026-07-15T18:00:00Z');
  raise exception 'JSON-only service role unexpectedly passed before 0038';
exception when others then
  if sqlerrm <> 'server scheduler only' then raise; end if;
end $$;
'@ 'Before-state JSON-only rejection proof failed.'
  Write-Output 'BEFORE 0038 JSON-only service role rejected by legacy check: PASS'

  Invoke-Probe (Get-Content -Raw $repairMigration.FullName) 'Migration failed: 0038_modern_postgrest_service_role_claims.sql'

  Invoke-Probe @'
do $$ begin
  if has_function_privilege('service_role','public.request_uses_service_role()','execute') then raise exception 'service role can call internal claim helper directly'; end if;
  if has_function_privilege('authenticated','public.request_uses_service_role()','execute') then raise exception 'authenticated can call internal claim helper directly'; end if;
  if has_function_privilege('anon','public.request_uses_service_role()','execute') then raise exception 'anon can call internal claim helper directly'; end if;
  if has_function_privilege('authenticated','public.run_scheduled_alert_sweep(timestamptz)','execute') then raise exception '0038 widened authenticated sweep access'; end if;
  if has_function_privilege('anon','public.run_scheduled_alert_sweep(timestamptz)','execute') then raise exception '0038 widened anon sweep access'; end if;
  if not has_function_privilege('service_role','public.run_scheduled_alert_sweep(timestamptz)','execute') then raise exception '0038 removed service-role sweep access'; end if;
end $$;
'@ '0038 grant-preservation probe failed.'

  Invoke-Probe @'
do $$ begin
  -- Modern claims must win over a conflicting legacy service-role setting.
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  perform set_config('request.jwt.claim.role','service_role',true);
  begin perform public.run_scheduled_alert_sweep('2026-07-15T18:00:00Z'); raise exception 'authenticated sweep was accepted'; exception when others then if sqlerrm <> 'server scheduler only' then raise; end if; end;
  begin perform public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','2026-07-15',false,'2026-07-15T12:00:00Z','{"wind_speed_10m":15}'::jsonb); raise exception 'authenticated spray recording was accepted'; exception when others then if sqlerrm <> 'server scheduler only' then raise; end if; end;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  perform set_config('request.jwt.claim.role','',true);
  begin perform public.run_scheduled_alert_sweep('2026-07-15T18:00:00Z'); raise exception 'anonymous sweep was accepted'; exception when others then if sqlerrm <> 'server scheduler only' then raise; end if; end;
  begin perform public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','2026-07-15',false,'2026-07-15T12:00:00Z','{"wind_speed_10m":15}'::jsonb); raise exception 'anonymous spray recording was accepted'; exception when others then if sqlerrm <> 'server scheduler only' then raise; end if; end;
end $$;
'@ 'Modern-claim scheduler denial probe failed.'

  Invoke-Probe @'
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.jwt.claim.role','authenticated',false);
do $$ declare r jsonb; begin
  r:=public.run_scheduled_alert_sweep('2026-07-15T18:00:00Z');
  if (r->>'marketing_created')::integer<>2 or (r->>'program_created')::integer<>1 then raise exception 'unexpected first sweep result: %',r; end if;
  if (select count(*) from public.notifications)<>3 then raise exception 'first sweep did not create exactly three notifications'; end if;
  if (select count(*) from public.push_deliveries)<>3 then raise exception 'notifications did not enqueue exactly three push deliveries'; end if;
  if exists(select 1 from public.notifications where dedupe_key like 'marketing-rule:00000000-0000-4000-8000-000000000081:%') then raise exception 'stale soybean bid fired'; end if;
  if not exists(select 1 from public.notifications where dedupe_key like 'marketing-rule:00000000-0000-4000-8000-000000000082:%' and body like '%10.0%') then raise exception 'entity-scoped percent calculation did not fire at 10 percent'; end if;
  if (select is_condition_true from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000081') then raise exception 'stale-bid rule persisted a true state'; end if;
end $$;
'@ 'First scheduled sweep proof failed.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.jwt.claim.role','',false);
do $$ declare r jsonb; begin
  r:=public.run_scheduled_alert_sweep('2026-07-15T18:15:00Z');
  if (r->>'marketing_created')::integer<>0 or (r->>'program_created')::integer<>0 then raise exception 'replayed sweep duplicated work: %',r; end if;
  if (select count(*) from public.notifications)<>3 or (select count(*) from public.push_deliveries)<>3 then raise exception 'replayed sweep duplicated durable rows'; end if;
end $$;
'@ 'Scheduled sweep replay was not idempotent.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.jwt.claim.role','',false);
do $$ declare r jsonb; begin
  r:=public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','2026-07-15',false,'2026-07-15T12:00:00Z','{"wind_speed_10m":15}'::jsonb);
  if coalesce((r->>'fired')::boolean,false) or not (r->>'initialized')::boolean then raise exception 'first observation fired: %',r; end if;
  r:=public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','2026-07-15',false,'2026-07-15T12:15:00Z','{"wind_speed_10m":14}'::jsonb);
  if coalesce((r->>'fired')::boolean,false) then raise exception 'false-to-false observation fired: %',r; end if;
  r:=public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','2026-07-15',true,'2026-07-15T12:30:00Z','{"wind_speed_10m":6}'::jsonb);
  if not (r->>'fired')::boolean then raise exception 'false-to-true observation did not fire: %',r; end if;
  r:=public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','2026-07-15',true,'2026-07-15T12:45:00Z','{"wind_speed_10m":5}'::jsonb);
  if coalesce((r->>'fired')::boolean,false) then raise exception 'true-to-true observation fired twice: %',r; end if;
  if (select count(*) from public.notifications where dedupe_key='spray:00000000-0000-4000-8000-000000000030:2026-07-15')<>1 then raise exception 'spray transition did not create exactly one durable notification'; end if;
  if (select count(*) from public.push_deliveries)<>4 then raise exception 'spray notification did not create one push delivery'; end if;
end $$;
'@ 'Scheduled spray transition proof failed.'

  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}
if ($passed) { Write-Output 'PROBE 0037 scheduled alert foundation: PASS' }
