$ErrorActionPreference = 'Stop'
$name = "farmrx-0041-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the disposable 0041 proof but is not available on PATH.' }

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
  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object {
    Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)"
  }

  Invoke-Probe @'
insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000001','owner@example.test'),
  ('00000000-0000-4000-8000-000000000002','member@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000010','Unscoped Write Farm','00000000-0000-4000-8000-000000000001');
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','worker','active');
insert into public.marketing_alert_rules(id,farm_id,crop_year,commodity_id,rule_type,direction,threshold,active)
values ('00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000010',2026,'corn_yellow','price_target','at_or_above',5,true);
do $$ begin
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002')<>1 then raise exception 'member epoch was not one'; end if;
end $$;
'@ '0041 seed failed.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000090',true);
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A later user changed alert state for an earlier captured operation.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.save_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/device','key-a','auth-a','Farm Rx probe');
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A later user adopted an earlier captured push subscription.'

  Invoke-Probe @'
do $$ begin
  if exists(select 1 from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000090') then raise exception 'cross-user alert state persisted'; end if;
  if exists(select 1 from public.push_subscriptions where endpoint='https://push.example.test/device') then raise exception 'cross-user push subscription persisted'; end if;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000090',true);
select public.save_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/device','key-current','auth-current','Farm Rx probe');
do $$ begin
  if not exists(select 1 from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000090' and is_condition_true) then raise exception 'current alert transition did not persist'; end if;
  if not exists(select 1 from public.push_subscriptions where endpoint='https://push.example.test/device' and user_id='00000000-0000-4000-8000-000000000002' and p256dh='key-current') then raise exception 'current push subscription did not persist'; end if;
end $$;
'@ 'Current user/epoch alert or push write failed.'

  Invoke-ExpectedFailure @'
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,user_agent)
values ('00000000-0000-4000-8000-000000000002','https://push.example.test/direct-insert','direct-key','direct-auth','Direct DML probe');
'@ 'permission denied for table push_subscriptions' 'Authenticated direct INSERT bypassed the fenced push RPC.'

  Invoke-ExpectedFailure @'
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
update public.push_subscriptions set p256dh='direct-update-key'
where endpoint='https://push.example.test/device';
'@ 'permission denied for table push_subscriptions' 'Authenticated direct UPDATE bypassed the fenced push RPC.'

  Invoke-ExpectedFailure @'
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
delete from public.push_subscriptions where endpoint='https://push.example.test/device';
'@ 'permission denied for table push_subscriptions' 'Authenticated direct DELETE bypassed the fenced push RPC.'

  Invoke-Probe @'
do $$ begin
  if exists(select 1 from public.push_subscriptions where endpoint='https://push.example.test/direct-insert') then raise exception 'direct insert persisted'; end if;
  if not exists(select 1 from public.push_subscriptions where endpoint='https://push.example.test/device' and user_id='00000000-0000-4000-8000-000000000002' and p256dh='key-current') then raise exception 'direct update/delete changed the fenced subscription'; end if;
end $$;
'@ 'Direct push table DML denial did not preserve subscription state.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.save_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/shared-device','key-owner','auth-owner','Farm Rx owner probe');
insert into public.notifications(id,farm_id,user_id,category,title,body,link,dedupe_key,created_by)
values ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','general','Ownership probe','Pending delivery must stay with its owner','/notifications','push-owner-probe','00000000-0000-4000-8000-000000000001');
insert into public.push_delivery_targets(delivery_id,subscription_id,status)
select delivery.id, subscription.id, 'pending'
from public.push_deliveries delivery
join public.push_subscriptions subscription on subscription.endpoint='https://push.example.test/shared-device'
where delivery.notification_id='00000000-0000-4000-8000-000000000091';
do $$ begin
  if not exists(
    select 1 from public.push_delivery_targets target
    join public.push_deliveries delivery on delivery.id=target.delivery_id
    join public.push_subscriptions subscription on subscription.id=target.subscription_id
    where delivery.notification_id='00000000-0000-4000-8000-000000000091'
      and target.status='pending'
      and subscription.user_id='00000000-0000-4000-8000-000000000001'
      and subscription.p256dh='key-owner'
      and subscription.auth='auth-owner'
  ) then raise exception 'owner delivery target was not seeded'; end if;
end $$;
'@ 'Push endpoint ownership-transfer seed failed.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.save_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/shared-device','key-member','auth-member','Farm Rx member probe');
'@ 'PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_USER' 'A valid later user adopted another user''s endpoint and pending push delivery.'

  Invoke-Probe @'
do $$ begin
  if not exists(
    select 1 from public.push_delivery_targets target
    join public.push_deliveries delivery on delivery.id=target.delivery_id
    join public.push_subscriptions subscription on subscription.id=target.subscription_id
    where delivery.notification_id='00000000-0000-4000-8000-000000000091'
      and target.status='pending'
      and subscription.user_id='00000000-0000-4000-8000-000000000001'
      and subscription.p256dh='key-owner'
      and subscription.auth='auth-owner'
  ) then raise exception 'cross-user registration changed endpoint ownership, keys, or pending target'; end if;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.save_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/shared-device','key-owner-refresh','auth-owner-refresh','Farm Rx owner refresh');
do $$ begin
  if not exists(
    select 1 from public.push_delivery_targets target
    join public.push_deliveries delivery on delivery.id=target.delivery_id
    join public.push_subscriptions subscription on subscription.id=target.subscription_id
    where delivery.notification_id='00000000-0000-4000-8000-000000000091'
      and target.status='pending'
      and subscription.user_id='00000000-0000-4000-8000-000000000001'
      and subscription.p256dh='key-owner-refresh'
      and subscription.auth='auth-owner-refresh'
  ) then raise exception 'same-user refresh did not preserve ownership and pending target'; end if;
end $$;
'@ 'Push endpoint ownership isolation or same-user refresh proof failed.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.delete_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/device');
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A later user deleted a push subscription for an earlier captured operation.'

  Invoke-Probe @'
do $$ begin
  if not exists(select 1 from public.push_subscriptions where endpoint='https://push.example.test/device' and user_id='00000000-0000-4000-8000-000000000002') then raise exception 'cross-user delete removed the subscription'; end if;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
update public.farm_memberships set status='revoked' where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002';
update public.farm_memberships set status='active' where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002';
do $$ begin
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002')<>3 then raise exception 'regrant did not advance the epoch to three'; end if;
end $$;
'@ 'Revoke/regrant setup failed.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000090',false);
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A stale epoch changed alert state after revoke/regrant.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.save_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/device','key-stale','auth-stale','Farm Rx stale probe');
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A stale epoch changed push ownership or keys after revoke/regrant.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.delete_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/device');
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A stale epoch deleted a push subscription after revoke/regrant.'

  Invoke-Probe @'
do $$ begin
  if not exists(select 1 from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000090' and is_condition_true) then raise exception 'stale epoch changed alert state'; end if;
  if not exists(select 1 from public.push_subscriptions where endpoint='https://push.example.test/device' and user_id='00000000-0000-4000-8000-000000000002' and p256dh='key-current') then raise exception 'stale epoch changed or removed push state'; end if;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',3)::text)::text,false);
select public.record_marketing_alert_transition('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000090',false);
select public.save_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/device','key-fresh','auth-fresh','Farm Rx fresh probe');
select public.delete_push_subscription('00000000-0000-4000-8000-000000000010','https://push.example.test/device');
do $$ begin
  if not exists(select 1 from public.alert_rule_states where rule_id='00000000-0000-4000-8000-000000000090' and not is_condition_true) then raise exception 'fresh epoch alert transition did not persist'; end if;
  if exists(select 1 from public.push_subscriptions where endpoint='https://push.example.test/device') then raise exception 'fresh epoch push delete did not persist'; end if;
  if has_function_privilege('authenticated','public.save_push_subscription(text,text,text,text)','execute')
    or has_function_privilege('authenticated','public.delete_push_subscription(text)','execute') then raise exception 'legacy unfenced push signatures remain executable'; end if;
  if not has_function_privilege('authenticated','public.save_push_subscription(uuid,text,text,text,text)','execute')
    or not has_function_privilege('authenticated','public.delete_push_subscription(uuid,text)','execute')
    or not has_function_privilege('authenticated','public.record_marketing_alert_transition(uuid,uuid,boolean)','execute') then raise exception 'fenced authenticated signatures are not executable'; end if;
  if has_function_privilege('anon','public.save_push_subscription(uuid,text,text,text,text)','execute')
    or has_function_privilege('service_role','public.save_push_subscription(uuid,text,text,text,text)','execute')
    or has_function_privilege('anon','public.delete_push_subscription(uuid,text)','execute')
    or has_function_privilege('service_role','public.delete_push_subscription(uuid,text)','execute') then raise exception 'fenced push signatures have widened grants'; end if;
  if has_table_privilege('authenticated','public.push_subscriptions','insert')
    or has_table_privilege('authenticated','public.push_subscriptions','update')
    or has_table_privilege('authenticated','public.push_subscriptions','delete') then raise exception 'authenticated direct push table DML remains granted'; end if;
  if exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='push_subscriptions' and cmd in ('INSERT','UPDATE','DELETE')
  ) then raise exception 'direct push write policies remain installed'; end if;
end $$;
'@ 'Fresh epoch write/delete or exact-signature ACL proof failed.'

  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}
if ($passed) { Write-Output 'PROBE 0041 unscoped authenticated write fencing: PASS' }
