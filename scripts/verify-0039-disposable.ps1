$ErrorActionPreference = 'Stop'
$name = "farmrx-0039-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the disposable 0039 proof but is not available on PATH.' }

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
  } finally { $ErrorActionPreference = $priorPreference }
  if ($exitCode -eq 0 -or ($output -join "`n") -notmatch [regex]::Escape($expected)) { throw $failure }
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
  $repairMigration = $migrations | Where-Object Name -EQ '0039_scheduler_weather_push_semantics.sql'
  if (!$repairMigration) { throw 'Migration 0039 scheduler/weather/push repair is missing.' }
  $migrations | Where-Object Name -LT $repairMigration.Name | ForEach-Object { Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)" }

  Invoke-Probe @'
insert into auth.users(id,email) values ('00000000-0000-4000-8000-0000000000e1','rollout@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000e1"}',false);
insert into public.farms(id,name,created_by,time_zone) values ('00000000-0000-4000-8000-0000000000e2','Rollout Farm','00000000-0000-4000-8000-0000000000e1','America/Chicago');
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-0000000000e1','owner','active') on conflict(farm_id,user_id) do update set role=excluded.role,status=excluded.status;
insert into public.notifications(id,farm_id,user_id,category,title,created_by) values
  ('00000000-0000-4000-8000-0000000000e3','00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-0000000000e1','task','Failed legacy parent','00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000e4','00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-0000000000e1','task','In-flight legacy parent','00000000-0000-4000-8000-0000000000e1');
update public.push_deliveries set status='failed',attempts=1,claimed_at=now() where notification_id='00000000-0000-4000-8000-0000000000e3';
update public.push_deliveries set status='pending',attempts=1,claimed_at=now() where notification_id='00000000-0000-4000-8000-0000000000e4';
'@ 'Ambiguous legacy rollout fixture failed.'
  Invoke-ExpectedFailure (Get-Content -Raw $repairMigration.FullName) '0039 rollout blocked: 2 ambiguous legacy push deliveries require adjudication' '0039 did not refuse failed and in-flight legacy parent deliveries.'
  Invoke-Probe "delete from public.notifications where id in ('00000000-0000-4000-8000-0000000000e3','00000000-0000-4000-8000-0000000000e4'); delete from public.farm_memberships where farm_id='00000000-0000-4000-8000-0000000000e2'; delete from public.farms where id='00000000-0000-4000-8000-0000000000e2'; delete from auth.users where id='00000000-0000-4000-8000-0000000000e1';" 'Ambiguous legacy rollout fixture cleanup failed.'
  Invoke-Probe (Get-Content -Raw $repairMigration.FullName) 'Migration failed: 0039_scheduler_weather_push_semantics.sql'
  $migrations | Where-Object Name -GT $repairMigration.Name | ForEach-Object { Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)" }

  Invoke-Probe @'
insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000001','scheduler@example.test'),
  ('00000000-0000-4000-8000-000000000002','push@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1,'00000000-0000-4000-8000-000000000011',1)::text)::text,false);
insert into public.farms(id,name,created_by,time_zone) values
  ('00000000-0000-4000-8000-000000000010','Failing Farm','00000000-0000-4000-8000-000000000001','America/Chicago'),
  ('00000000-0000-4000-8000-000000000011','Completing Farm','00000000-0000-4000-8000-000000000001','America/Chicago');
insert into public.farm_memberships(farm_id,user_id,role,status) values
  ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','owner','active'),
  ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','owner','active')
on conflict(farm_id,user_id) do nothing;
insert into public.entities(id,farm_id,name,entity_type) values
  ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','Fail Entity','individual'),
  ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','Good Entity','individual');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values
  ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Fail Field',10),
  ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Good Field',10);
insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planted_acres) values
  ('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030',2026,'corn_yellow',10),
  ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',2026,'corn_yellow',10);
insert into public.programs(id,farm_id,name,program_kind,commodity_id,crop_year,created_by,updated_by) values
  ('00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000010','Fail Program','chemical','corn_yellow',2026,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000011','Good Program','chemical','corn_yellow',2026,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
insert into public.program_assignments(id,farm_id,program_id,crop_assignment_id,program_name_snapshot,program_kind_snapshot,template_revision,assigned_by) values
  ('00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000040','Fail Program','chemical',1,'00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000041','Good Program','chemical',1,'00000000-0000-4000-8000-000000000001');
insert into public.assigned_program_passes(id,farm_id,assignment_id,source_revision,sequence,name,pass_type,activity_type,reminder_lead_days,due_on,due_source,is_field_override,status,created_by,updated_by) values
  ('00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000060',1,1,'Fail Due','pre','spray',1,'2026-07-15','manual',true,'planned','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000061',1,1,'Good Due','pre','spray',1,'2026-07-15','manual',true,'planned','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');

create function public.probe_fail_one_farm_notification() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if new.farm_id='00000000-0000-4000-8000-000000000010' then raise exception 'forced farm-local failure'; end if;
  return new;
end $$;
create trigger probe_fail_one_farm_notification before insert on public.notifications for each row execute function public.probe_fail_one_farm_notification();

select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$ declare r jsonb; begin
  r:=public.run_scheduled_alert_sweep('2026-07-15T18:00:00Z');
  if (r->>'farm_failure_count')::integer<>1 or (r->>'processed_farm_count')::integer<>1 then raise exception 'farm containment counts were dishonest: %',r; end if;
  if r->'failed_farm_ids'<>jsonb_build_array('00000000-0000-4000-8000-000000000010'::uuid) then raise exception 'failed farm identity was wrong: %',r; end if;
  if (r->>'program_created')::integer<>1 then raise exception 'successful farm did not complete: %',r; end if;
  if exists(select 1 from public.notifications where farm_id='00000000-0000-4000-8000-000000000010') then raise exception 'failed farm partial work was not rolled back'; end if;
  if (select count(*) from public.notifications where farm_id='00000000-0000-4000-8000-000000000011' and dedupe_key like 'program:%:due:%')<>1 then raise exception 'second farm did not create its notification'; end if;
  r:=public.run_scheduled_alert_sweep('2026-07-15T18:00:00Z');
  if (r->>'program_created')::integer<>0 or (select count(*) from public.notifications where farm_id='00000000-0000-4000-8000-000000000011')<>1 then raise exception 'fixed-clock replay duplicated the successful farm'; end if;
end $$;
drop trigger probe_fail_one_farm_notification on public.notifications;
drop function public.probe_fail_one_farm_notification();

do $$ declare r jsonb; begin
  r:=public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031','2026-07-15',true,'2026-07-15T14:00:00Z','{"observed_at":"2026-07-15T14:00:00Z"}'::jsonb);
  if not coalesce((r->>'fired')::boolean,false) then raise exception 'first complete good observation did not fire: %',r; end if;
  r:=public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031','2026-07-15',true,'2026-07-15T14:00:00Z','{"observed_at":"2026-07-15T14:00:00Z"}'::jsonb);
  if r->>'ignored'<>'stale_observation' or (select count(*) from public.notifications where dedupe_key='spray:00000000-0000-4000-8000-000000000031:2026-07-15')<>1 then raise exception 'first-good replay was not deduped: %',r; end if;
  perform public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031','2026-07-16',false,'2026-07-16T15:00:00Z','{"observed_at":"2026-07-16T15:00:00Z"}'::jsonb);
  r:=public.record_scheduled_spray_window('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031','2026-07-16',true,'2026-07-16T14:00:00Z','{"observed_at":"2026-07-16T14:00:00Z"}'::jsonb);
  if r->>'ignored'<>'stale_observation' or (select is_good from public.spray_window_states where field_id='00000000-0000-4000-8000-000000000031' and local_date='2026-07-16') or (select observed_at from public.spray_window_states where field_id='00000000-0000-4000-8000-000000000031' and local_date='2026-07-16')<>'2026-07-16T15:00:00Z'::timestamptz then raise exception 'older good observation overwrote newer bad state: %',r; end if;
end $$;
'@ 'Per-farm containment and replay proof failed.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000011',1)::text)::text,false);
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','worker','active');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000011',1)::text)::text,false);
insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values
  ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000002','https://push.example/device-a','key-a','auth-a'),
  ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-000000000002','https://push.example/device-b','key-b','auth-b');
insert into public.notifications(id,farm_id,user_id,category,title,body,link,created_by) values
  ('00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','task','Two-device probe','Body','/notifications','00000000-0000-4000-8000-000000000001');

do $$ begin
  if has_table_privilege('authenticated','public.push_delivery_targets','select') or has_table_privilege('anon','public.push_delivery_targets','select') or has_table_privilege('service_role','public.push_delivery_targets','select') then raise exception 'target table has direct Data API access'; end if;
  if has_function_privilege('authenticated','public.claim_push_delivery_targets(uuid,integer)','execute') or has_function_privilege('anon','public.claim_push_delivery_targets(uuid,integer)','execute') then raise exception 'client role can claim push targets'; end if;
  if not has_function_privilege('service_role','public.claim_push_delivery_targets(uuid,integer)','execute') or not has_function_privilege('service_role','public.finish_push_delivery_target(uuid,text,text)','execute') or not has_function_privilege('service_role','public.get_push_delivery_health(uuid)','execute') then raise exception 'service role lacks target RPC access'; end if;
  if has_function_privilege('service_role','public.claim_push_deliveries(integer)','execute') or has_function_privilege('service_role','public.finish_push_delivery(uuid,boolean,text)','execute') then raise exception 'legacy parent push protocol remains executable'; end if;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  perform set_config('request.jwt.claim.role','service_role',true);
  begin perform * from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000090',100); raise exception 'modern authenticated claim was accepted'; exception when others then if sqlerrm<>'server delivery only' then raise; end if; end;
  begin perform public.get_push_delivery_health('00000000-0000-4000-8000-000000000090'); raise exception 'modern authenticated health read was accepted'; exception when others then if sqlerrm<>'server delivery only' then raise; end if; end;
end $$;

select set_config('request.jwt.claims','{"role":"service_role"}',false);
select * from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000090',100);
do $$ declare a uuid; b uuid; begin
  if (select count(*) from public.push_delivery_targets t join public.push_deliveries d on d.id=t.delivery_id where d.notification_id='00000000-0000-4000-8000-000000000090' and t.status='sending')<>2 then raise exception 'first atomic claim did not claim both devices'; end if;
  if (select count(*) from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000090',100))<>0 then raise exception 'concurrent-style second claim duplicated in-flight targets'; end if;
  select t.id into a from public.push_delivery_targets t where t.subscription_id='00000000-0000-4000-8000-0000000000a1';
  select t.id into b from public.push_delivery_targets t where t.subscription_id='00000000-0000-4000-8000-0000000000b1';
  perform public.finish_push_delivery_target(a,'sent',null);
  perform public.finish_push_delivery_target(b,'retry','push provider status 503');
  if (select status from public.push_delivery_targets where id=a)<>'sent' or (select status from public.push_delivery_targets where id=b)<>'failed' then raise exception 'partial target outcomes were not durable'; end if;
  if (select status from public.push_deliveries where notification_id='00000000-0000-4000-8000-000000000090')<>'failed' then raise exception 'partial delivery parent was not honestly failed'; end if;
  if (select count(*) from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000090',100))<>0 then raise exception 'retry backoff was bypassed'; end if;
  update public.push_delivery_targets set claimed_at=now()-interval '6 minutes' where id=b;
  if (select count(*) from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000090',100))<>1 then raise exception 'only failed device B was not reclaimed'; end if;
  if (select status from public.push_delivery_targets where id=a)<>'sent' or (select attempts from public.push_delivery_targets where id=a)<>1 then raise exception 'successful device A was resent or changed'; end if;
  perform public.finish_push_delivery_target(b,'sent',null);
  if (select status from public.push_deliveries where notification_id='00000000-0000-4000-8000-000000000090')<>'sent' then raise exception 'delivery did not complete after B retry'; end if;
end $$;

insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-000000000001','https://push.example/gone','key-c','auth-c');
insert into public.notifications(id,farm_id,user_id,category,title,created_by) values ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','task','Gone probe','00000000-0000-4000-8000-000000000001');
select * from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000091',100);
do $$ declare target uuid; begin
  select t.id into target from public.push_delivery_targets t join public.push_deliveries d on d.id=t.delivery_id where d.notification_id='00000000-0000-4000-8000-000000000091';
  perform public.finish_push_delivery_target(target,'gone','push provider status 410');
  if exists(select 1 from public.push_subscriptions where id='00000000-0000-4000-8000-0000000000c1') then raise exception 'gone subscription was not removed'; end if;
  if (select status from public.push_deliveries where notification_id='00000000-0000-4000-8000-000000000091')<>'sent' then raise exception 'gone target blocked completion'; end if;
end $$;

insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-000000000001','https://push.example/exhausted','key-d','auth-d');
insert into public.notifications(id,farm_id,user_id,category,title,created_by) values ('00000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','task','Exhaustion probe','00000000-0000-4000-8000-000000000001');
select * from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000092',100);
do $$ declare target uuid; attempt integer; r jsonb; begin
  select t.id into target from public.push_delivery_targets t join public.push_deliveries d on d.id=t.delivery_id where d.notification_id='00000000-0000-4000-8000-000000000092';
  for attempt in 1..10 loop
    if attempt>1 then
      update public.push_delivery_targets set claimed_at=now()-interval '6 minutes' where id=target;
      if (select count(*) from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000092',100))<>1 then raise exception 'retry attempt % was not claimed',attempt; end if;
    end if;
    perform public.finish_push_delivery_target(target,'retry','push provider status 503');
  end loop;
  if (select count(*) from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000092',100))<>0 then raise exception 'exhausted target was claimed an eleventh time'; end if;
  r:=public.get_push_delivery_health('00000000-0000-4000-8000-000000000092');
  if (r->>'terminal_failed_targets')::integer<>1 or (select status from public.push_deliveries where notification_id='00000000-0000-4000-8000-000000000092')<>'failed' then raise exception 'terminal failure disappeared from health: %',r; end if;
  update public.push_delivery_targets set status='sending',last_error=null where id=target;
  r:=public.get_push_delivery_health('00000000-0000-4000-8000-000000000092');
  if (select attempts from public.push_delivery_targets where id=target)<>10 or (r->>'terminal_failed_targets')::integer<>1 or (r->>'retryable_targets')::integer<>0 then raise exception 'a lost finish at attempt ten disappeared from health: %',r; end if;
  begin perform * from public.claim_push_deliveries(25); raise exception 'legacy claim remained active'; exception when others then if sqlerrm<>'legacy push protocol retired' then raise; end if; end;
  begin perform public.finish_push_delivery((select delivery_id from public.push_delivery_targets where id=target),true); raise exception 'legacy finish remained active'; exception when others then if sqlerrm<>'legacy push protocol retired' then raise; end if; end;
end $$;
'@ 'Per-device push target, ACL, race, retry, or gone proof failed.'

  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}
if ($passed) { Write-Output 'PROBE 0039 scheduler/weather/push semantics: PASS' }
