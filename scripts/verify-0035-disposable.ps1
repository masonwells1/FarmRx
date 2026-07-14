$ErrorActionPreference = 'Stop'
$name = "farmrx-0035-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false
try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:16 | Out-Null
  for ($i = 0; $i -lt 30; $i++) { if ((docker exec $name pg_isready -U postgres -d farmrx_disposable 2>$null) -match 'accepting connections') { break }; Start-Sleep -Milliseconds 500 }
  if ((docker exec $name pg_isready -U postgres -d farmrx_disposable 2>$null) -notmatch 'accepting connections') { throw 'Disposable postgres:16 did not become ready.' }
  $bootstrap = "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid `$`$; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;"
  $bootstrap | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object { (Get-Content -Raw $_.FullName) | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable; if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" } }
  @'
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000001','probe@example.test');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000010','Probe Farm','00000000-0000-4000-8000-000000000001');
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','owner','active') on conflict(farm_id,user_id) do update set role='owner',status='active';
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
 -- Claim honors the in-flight backoff: a second sweep inside the window gets nothing.
 perform set_config('request.jwt.claim.role','service_role',true);
 if (select count(*) from public.claim_push_deliveries(25)) <> 1 then raise exception 'first claim did not return the pending delivery'; end if;
 if (select count(*) from public.claim_push_deliveries(25)) <> 0 then raise exception 'second claim double-claimed an in-flight delivery'; end if;
 -- A failure recorded on a NEVER-claimed row must stamp claimed_at so the sweep can retry it.
 insert into public.notifications(id,farm_id,user_id,category,title,created_by) values ('00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','task','Probe unclaimed failure','00000000-0000-4000-8000-000000000001');
 perform public.finish_push_delivery((select id from public.push_deliveries where notification_id='00000000-0000-4000-8000-0000000000b0'),false,'probe failure');
 if (select claimed_at from public.push_deliveries where notification_id='00000000-0000-4000-8000-0000000000b0') is null then raise exception 'failed-unclaimed delivery left claimed_at null (permanently unretryable)'; end if;
 update public.push_deliveries set claimed_at=now()-interval '6 minutes' where notification_id='00000000-0000-4000-8000-0000000000b0';
 if (select count(*) from public.claim_push_deliveries(25)) <> 1 then raise exception 'failed delivery past backoff was not reclaimed'; end if;
 perform set_config('request.jwt.claim.role','',true);
 insert into public.farm_tasks(id,farm_id,title,status,priority,source,program_assigned_pass_id,program_cycle_key,created_by) values ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000010','Program task','todo','normal','program','00000000-0000-4000-8000-000000000070','probe','00000000-0000-4000-8000-000000000001');
 begin update public.farm_tasks set status='done' where id='00000000-0000-4000-8000-000000000071'; raise exception 'direct program task status change accepted'; exception when others then if position('PROGRAM_TASK_STATUS_MANAGED_BY_PROGRAM' in sqlerrm)=0 then raise; end if; end;
 perform set_config('farmrx.program_task_status_change','on',true); update public.farm_tasks set status='done' where id='00000000-0000-4000-8000-000000000071'; if (select status from public.farm_tasks where id='00000000-0000-4000-8000-000000000071') <> 'done' then raise exception 'program flag did not permit status'; end if;
 insert into public.equipment(id,farm_id,name,category,created_by) values ('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000010','Probe Tractor','tractor','00000000-0000-4000-8000-000000000001');
 insert into public.equipment_service_intervals(id,farm_id,equipment_id,name,every_months,created_by) values ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000080','Oil',6,'00000000-0000-4000-8000-000000000001');
 insert into public.equipment_meter_readings(id,farm_id,equipment_id,reading,read_on,source,created_by) values ('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000080',100,current_date,'service','00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000083','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000080',101,current_date,'manual','00000000-0000-4000-8000-000000000001');
 insert into public.equipment_service_log(id,farm_id,equipment_id,service_date,work_performed,meter_reading,interval_id,created_by) values ('00000000-0000-4000-8000-000000000084','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000080',current_date,'Oil change',100,'00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000001');
 perform public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000084');
 if exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000084') or exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000082') or not exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000083') then raise exception 'service reversal provenance failed'; end if;
 if exists(select 1 from public.equipment_service_intervals where id='00000000-0000-4000-8000-000000000081' and (last_done_on is not null or last_done_reading is not null)) then raise exception 'service reversal did not clear interval'; end if;
 perform public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000084');
 perform public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000090',true);
 perform public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000090',true);
 if (select count(*) from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000090') <> 1 then raise exception 'alert transition unique receipt missing'; end if;
 -- A rule id from another farm must be rejected even for a user who can edit both.
 insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000011','Second Farm','00000000-0000-4000-8000-000000000001');
 insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','owner','active') on conflict(farm_id,user_id) do update set role='owner',status='active';
 begin perform public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000090',true); raise exception 'cross-farm alert rule accepted'; exception when others then if position('alert rule not found for this farm' in sqlerrm)=0 then raise; end if; end;
end $$;
'@ | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw '0035 operational-integrity behavior probe failed.' }
  $passed = $true
} finally { docker rm -f $name 2>$null | Out-Null }
if ($passed) { Write-Output 'PROBE disposable migration suite: PASS' }
