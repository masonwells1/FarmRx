$ErrorActionPreference = 'Stop'
$name = "farmrx-0035-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the disposable 0035 proof but is not available on PATH.' }
try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) { if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') { $ready = $true; break }; Start-Sleep -Milliseconds 500 }
  if (!$ready) { throw 'Disposable postgres:17 did not become ready.' }
  $bootstrap = "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;"
  $bootstrap | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object { (Get-Content -Raw $_.FullName) | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable; if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" } }
  @'
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000001','probe@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000010','Probe Farm','00000000-0000-4000-8000-000000000001');
insert into public.entities(id,farm_id,name,entity_type) values ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','Probe Entity','individual');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Probe Field',10);
insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planted_acres) values ('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030',2026,'corn_yellow',10);
insert into public.programs(id,farm_id,name,program_kind,commodity_id,crop_year,created_by,updated_by) values ('00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000010','Probe Program','chemical','corn_yellow',2026,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
insert into public.program_assignments(id,farm_id,program_id,crop_assignment_id,program_name_snapshot,program_kind_snapshot,template_revision,assigned_by) values ('00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000040','Probe Program','chemical',1,'00000000-0000-4000-8000-000000000001');
insert into public.assigned_program_passes(id,farm_id,assignment_id,source_revision,sequence,name,pass_type,activity_type,reminder_lead_days,due_on,due_source,is_field_override,status,created_by,updated_by) values ('00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000060',1,1,'Probe Pass','pre','spray',3,current_date,'manual',true,'planned','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
insert into public.marketing_alert_rules(id,farm_id,crop_year,commodity_id,rule_type,direction,threshold,active) values ('00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000010',2026,'corn_yellow','price_target','at_or_above',5,true);
select public.generate_due_program_notifications('00000000-0000-4000-8000-000000000010',current_date);
select public.generate_due_program_notifications('00000000-0000-4000-8000-000000000010',current_date);
-- The client-path generator (0024) and the scheduler (0035) must share one dedupe key.
select public.generate_due_program_items('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-0000000000aa',current_date);
do $$ begin
 if (select count(*) from public.notifications where dedupe_key like 'program:%:due:%') <> 1 then raise exception 'client and scheduler generators produced duplicate notifications'; end if;
 if (select count(*) from public.push_deliveries) <> 1 then raise exception 'due generation queue missing or duplicated'; end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('push_deliveries','service_log_meter_readings','alert_rule_states') and c.relrowsecurity) <> 3 then raise exception '0035 table missing row level security'; end if;
 if has_function_privilege('authenticated','public.claim_push_deliveries(integer)','execute') or has_function_privilege('anon','public.claim_push_deliveries(integer)','execute') then raise exception '0038 widened push-claim grants'; end if;
 if has_function_privilege('authenticated','public.finish_push_delivery(uuid,boolean,text)','execute') or has_function_privilege('anon','public.finish_push_delivery(uuid,boolean,text)','execute') then raise exception '0038 widened push-finish grants'; end if;
 if has_function_privilege('service_role','public.claim_push_deliveries(integer)','execute') or has_function_privilege('service_role','public.finish_push_delivery(uuid,boolean,text)','execute') then raise exception '0039 left the legacy parent push protocol executable'; end if;
 if not has_function_privilege('service_role','public.claim_push_delivery_targets(uuid,integer)','execute') or not has_function_privilege('service_role','public.finish_push_delivery_target(uuid,text,text)','execute') or not has_function_privilege('service_role','public.get_push_delivery_health(uuid)','execute') then raise exception '0039 target push protocol grants are incomplete'; end if;
 if not has_function_privilege('authenticated','public.generate_due_program_notifications(uuid,date)','execute') or has_function_privilege('anon','public.generate_due_program_notifications(uuid,date)','execute') then raise exception '0038 changed Program generator grants'; end if;
 if has_function_privilege('service_role','public.request_uses_service_role()','execute') or has_function_privilege('authenticated','public.request_uses_service_role()','execute') or has_function_privilege('anon','public.request_uses_service_role()','execute') then raise exception 'internal claim helper is directly executable'; end if;
 -- Modern JSON claims are authoritative. A conflicting legacy service role
 -- must not elevate authenticated or anonymous requests.
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 perform set_config('request.jwt.claim.role','service_role',true);
 begin perform * from public.claim_push_deliveries(25); raise exception 'authenticated claim was accepted'; exception when others then if sqlerrm <> 'server delivery only' then raise; end if; end;
 begin perform public.finish_push_delivery('00000000-0000-4000-8000-0000000000ff',true); raise exception 'authenticated finish was accepted'; exception when others then if sqlerrm <> 'server delivery only' then raise; end if; end;
 begin perform public.generate_due_program_notifications('00000000-0000-4000-8000-000000000010',current_date); raise exception 'legacy role overrode modern authenticated Program request'; exception when others then if sqlerrm <> 'authentication is required' then raise; end if; end;
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 begin perform * from public.claim_push_deliveries(25); raise exception 'anonymous claim was accepted'; exception when others then if sqlerrm <> 'server delivery only' then raise; end if; end;
 begin perform public.finish_push_delivery('00000000-0000-4000-8000-0000000000ff',true); raise exception 'anonymous finish was accepted'; exception when others then if sqlerrm <> 'server delivery only' then raise; end if; end;
 begin perform public.generate_due_program_notifications('00000000-0000-4000-8000-000000000010',current_date); raise exception 'anonymous Program generation was accepted'; exception when others then if sqlerrm <> 'authentication is required' then raise; end if; end;
 -- Malformed modern JSON also fails closed instead of falling back to legacy.
 perform set_config('request.jwt.claims','not-json',true);
 if public.request_uses_service_role() then raise exception 'malformed modern claims fell back to legacy service role'; end if;
 -- Legacy remains a compatibility fallback only when modern claims are absent.
 perform set_config('request.jwt.claims','',true);
 if not public.request_uses_service_role() then raise exception 'legacy service-role fallback was not preserved'; end if;

 -- JSON-only service-role Program generation succeeds. The legacy parent push
 -- protocol is retired once 0039 makes per-device targets authoritative.
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('request.jwt.claim.role','',true);
 perform public.generate_due_program_notifications('00000000-0000-4000-8000-000000000010',current_date);
 begin perform * from public.claim_push_deliveries(25); raise exception 'legacy claim remained active'; exception when others then if sqlerrm <> 'legacy push protocol retired' then raise; end if; end;
 begin perform public.finish_push_delivery((select id from public.push_deliveries where notification_id=(select id from public.notifications where dedupe_key like 'program:%:due:%')),true); raise exception 'legacy finish remained active'; exception when others then if sqlerrm <> 'legacy push protocol retired' then raise; end if; end;
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
 perform set_config('request.jwt.claim.role','',true);
 insert into public.farm_tasks(id,farm_id,title,status,priority,source,program_assigned_pass_id,program_cycle_key,created_by) values ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000010','Program task','todo','normal','program','00000000-0000-4000-8000-000000000070','probe','00000000-0000-4000-8000-000000000001');
 -- This disposable block runs as the table owner, the same trusted identity as
 -- the SECURITY DEFINER Program RPCs. Application-role attacks are proven in
 -- verify-0042-disposable.ps1.
 update public.farm_tasks set status='done' where id='00000000-0000-4000-8000-000000000071';
 if (select status from public.farm_tasks where id='00000000-0000-4000-8000-000000000071') <> 'done' then raise exception 'trusted Program task transition failed'; end if;
 insert into public.equipment(id,farm_id,name,category,created_by) values ('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000010','Probe Tractor','tractor','00000000-0000-4000-8000-000000000001');
 insert into public.equipment_service_intervals(id,farm_id,equipment_id,name,every_months,created_by) values ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000080','Oil',6,'00000000-0000-4000-8000-000000000001');
 -- Keep older same-value service history plus an unrelated manual reading. The
 -- save RPC must link the new explicit reading rather than guessing either row.
 insert into public.equipment_meter_readings(id,farm_id,equipment_id,reading,read_on,source,created_by) values ('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000080',100,current_date,'service','00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000083','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000080',101,current_date,'manual','00000000-0000-4000-8000-000000000001');
 perform public.save_service_log_entry(
   '00000000-0000-4000-8000-000000000010',
   jsonb_build_object(
     'id','00000000-0000-4000-8000-000000000084',
     'equipment_id','00000000-0000-4000-8000-000000000080',
     'service_date',current_date::text,
     'work_performed','Oil change',
     'parts',null,
     'vendor',null,
     'cost',null,
     'meter_reading',100,
     'interval_id','00000000-0000-4000-8000-000000000081'
   ),
   '00000000-0000-4000-8000-000000000085'
 );
 if (select meter_reading_id from public.service_log_meter_readings where service_log_id='00000000-0000-4000-8000-000000000084') is distinct from '00000000-0000-4000-8000-000000000085'::uuid then raise exception 'save RPC did not persist exact service-reading provenance'; end if;
 perform public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000084');
 if exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000084') or exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000085') or not exists(select 1 from public.equipment_meter_readings where id in ('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000083')) then raise exception 'service reversal provenance failed'; end if;
 if exists(select 1 from public.equipment_service_intervals where id='00000000-0000-4000-8000-000000000081' and (last_done_on is not null or last_done_reading is not null)) then raise exception 'service reversal did not clear interval'; end if;
 perform public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000084');
 perform public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000090',true);
 perform public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000090',true);
 if (select count(*) from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000090') <> 1 then raise exception 'alert transition unique receipt missing'; end if;
 -- A rule id from another farm must be rejected even for a user who can edit both.
 insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000011','Second Farm','00000000-0000-4000-8000-000000000001');
 perform set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1,'00000000-0000-4000-8000-000000000011',1)::text)::text,true);
 begin perform public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000090',true); raise exception 'cross-farm alert rule accepted'; exception when others then if position('alert rule not found for this farm' in sqlerrm)=0 then raise; end if; end;
end $$;
'@ | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw '0035 operational-integrity behavior probe failed.' }
  $passed = $true
} finally { docker rm -f $name 2>$null | Out-Null }
if ($passed) { Write-Output 'PROBE disposable migration suite: PASS' }
