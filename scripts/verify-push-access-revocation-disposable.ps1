param([switch]$MutateParentDeliveryLock)

$ErrorActionPreference = 'Stop'
$name = "farmrx-push-revocation-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the disposable push-revocation proof but is not available on PATH.'
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Disposable postgres:17 did not become ready.' }

  $bootstrap = "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;"
  $bootstrap | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw 'Disposable database bootstrap failed.' }

  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' |
    Sort-Object Name |
    ForEach-Object {
      $sql = Get-Content -Raw $_.FullName
      if ($MutateParentDeliveryLock -and $_.Name -eq '20260812135210_deny_revoked_push_delivery.sql') {
        $mutated = $sql -replace '(?ms)(from public\.push_deliveries\s+where id = p_delivery_id)\s+for update;', '$1;'
        $mutated = $mutated -replace '(?m)^  where delivery\.id = p_delivery_id;$', "  where delivery.id = p_delivery_id`r`n    and public.mutation_push_reconciliation_barrier(delivery.id);"
        if ($mutated -eq $sql -or $mutated -notmatch 'mutation_push_reconciliation_barrier\(delivery\.id\)') {
          throw 'Parent-delivery lock mutation did not change both required reconciliation sites.'
        }
        $mutationPrelude = @'
create sequence public.mutation_push_reconciliation_barrier_sequence;
create function public.mutation_push_reconciliation_barrier(p_delivery_id uuid)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_arrival bigint;
  v_attempts integer := 0;
begin
  if not exists (
    select 1
    from public.push_deliveries delivery
    where delivery.id=p_delivery_id
      and delivery.notification_id='00000000-0000-4000-8000-000000000034'
  ) then
    return true;
  end if;

  -- This test-only predicate runs inside the parent UPDATE statement, after
  -- its READ COMMITTED snapshot is fixed. Both sessions must therefore try
  -- to reconcile from the same pre-commit view when the production lock is
  -- intentionally removed, making the lost-finalization mutation repeatable.
  v_arrival := nextval('public.mutation_push_reconciliation_barrier_sequence');
  if v_arrival=1 then
    while (select last_value from public.mutation_push_reconciliation_barrier_sequence)<2 loop
      v_attempts := v_attempts + 1;
      if v_attempts >= 500 then
        raise exception 'push revalidation barrier timed out';
      end if;
      perform pg_sleep(0.01);
    end loop;
  end if;
  return true;
end;
$$;
'@
        $sql = "$mutationPrelude`r`n$mutated"
      }
      if ($MutateParentDeliveryLock -and $_.Name -eq '20260825175933_serialize_push_revalidation_before_target_transition.sql') {
        $mutated = $sql -replace '(?ms)(from public\.push_deliveries\s+where id = v_target\.delivery_id)\s+for update;', '$1;'
        if ($mutated -eq $sql) {
          throw 'Early parent-delivery lock mutation did not change the serialized target transition.'
        }
        $sql = $mutated
      }
      $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
      if ($LASTEXITCODE -ne 0) { throw "Migration failed in disposable push-revocation proof: $($_.Name)" }
    }

  $priorErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $probeOutput = @'
insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000001','owner@example.test'),
  ('00000000-0000-4000-8000-000000000002','removed@example.test'),
  ('00000000-0000-4000-8000-000000000003','removed-rep@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text
  )::text,
  false
);

insert into public.farms(id,name,created_by)
values ('00000000-0000-4000-8000-000000000010','Push Access Probe','00000000-0000-4000-8000-000000000001');
insert into public.farm_memberships(farm_id,user_id,role,status)
values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','manager','active');
insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth)
values ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000002','https://push.example.test/removed-device','synthetic-p256dh','synthetic-auth');
insert into public.notifications(id,farm_id,user_id,category,title,body,link,dedupe_key,created_by)
values (
  '00000000-0000-4000-8000-000000000030',
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000002',
  'task',
  'Synthetic private task',
  'This payload must not leave after access removal.',
  '/tasks',
  'push-revocation-probe',
  '00000000-0000-4000-8000-000000000001'
);

update public.farm_memberships
set status='revoked'
where farm_id='00000000-0000-4000-8000-000000000010'
  and user_id='00000000-0000-4000-8000-000000000002';

select set_config('request.jwt.claims','{"role":"service_role"}',false);

do $$
declare
  claimed_count integer;
  live_target_count integer;
  delivery_status text;
begin
  select count(*) into claimed_count
  from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000030', 10);

  if claimed_count <> 0 then
    raise exception 'revoked recipient received % claimed push payload(s)', claimed_count;
  end if;

  select count(*) into live_target_count
  from public.push_delivery_targets target
  join public.push_deliveries delivery on delivery.id=target.delivery_id
  where delivery.notification_id='00000000-0000-4000-8000-000000000030'
    and target.status <> 'gone';

  select status into delivery_status
  from public.push_deliveries
  where notification_id='00000000-0000-4000-8000-000000000030';

  if live_target_count <> 0 then
    raise exception 'revoked delivery retained % live target(s)', live_target_count;
  end if;
  if delivery_status is distinct from 'sent' then
    raise exception 'revoked delivery did not reach a terminal state: %', coalesce(delivery_status,'missing');
  end if;
end $$;

-- Also prove the retry path: initialize two targets while access is valid,
-- claim one, revoke access, then show no remaining payload can be reclaimed.
update public.farm_memberships
set status='active'
where farm_id='00000000-0000-4000-8000-000000000010'
  and user_id='00000000-0000-4000-8000-000000000002';
insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth)
values ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000002','https://push.example.test/removed-device-two','synthetic-p256dh-two','synthetic-auth-two');
insert into public.notifications(id,farm_id,user_id,category,title,body,link,dedupe_key,created_by)
values (
  '00000000-0000-4000-8000-000000000031',
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000002',
  'task',
  'Synthetic initialized task',
  'Already initialized targets must also fail closed after removal.',
  '/tasks',
  'push-revocation-initialized-probe',
  '00000000-0000-4000-8000-000000000001'
);

create temporary table first_authorized_claim as
select * from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000031', 1);

do $$
begin
  if (select count(*) from first_authorized_claim) <> 1 then
    raise exception 'valid recipient did not receive the one bounded authorized claim';
  end if;
  if (select count(*) from public.push_delivery_targets target join public.push_deliveries delivery on delivery.id=target.delivery_id where delivery.notification_id='00000000-0000-4000-8000-000000000031') <> 2 then
    raise exception 'valid recipient target snapshot was incomplete';
  end if;
end $$;

update public.farm_memberships
set status='revoked'
where farm_id='00000000-0000-4000-8000-000000000010'
  and user_id='00000000-0000-4000-8000-000000000002';

do $$
declare
  claimed_target uuid;
  claimed_subscription uuid;
begin
  select target_id into claimed_target from first_authorized_claim;
  select subscription_id into claimed_subscription
  from public.push_delivery_targets
  where id=claimed_target;
  if public.revalidate_claimed_push_delivery_target(claimed_target) then
    raise exception 'revoked recipient remained authorized immediately before provider send';
  end if;
  if (select status from public.push_delivery_targets where id=claimed_target) <> 'gone' then
    raise exception 'send-time revalidation did not terminalize the revoked target';
  end if;
  if not exists (
    select 1 from public.push_subscriptions
    where id=claimed_subscription
  ) then
    raise exception 'access revocation incorrectly deleted the valid device subscription';
  end if;
end $$;

-- Reproduce the six-worker Edge shape with two real PostgreSQL connections.
-- The lock-removal mutation installs its own sequence as a marker. Only that
-- intentionally unsafe variant pauses after each target becomes gone: healthy
-- code holds the parent before its target transition, so making the healthy
-- worker wait for a second transition would deadlock the very serialization
-- this probe is meant to prove.
update public.farm_memberships
set status='active'
where farm_id='00000000-0000-4000-8000-000000000010'
  and user_id='00000000-0000-4000-8000-000000000002';
insert into public.notifications(id,farm_id,user_id,category,title,body,link,dedupe_key,created_by)
values (
  '00000000-0000-4000-8000-000000000034',
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000002',
  'task',
  'Synthetic concurrent revoke',
  'Concurrent send-time denials must reconcile one terminal parent.',
  '/tasks',
  'push-concurrent-revalidation-probe',
  '00000000-0000-4000-8000-000000000001'
);
create temporary table concurrent_claims as
select * from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000034', 10);
do $$ begin
  if (select count(*) from concurrent_claims) <> 2 then
    raise exception 'concurrency probe did not claim exactly two targets';
  end if;
end $$;
update public.farm_memberships
set status='revoked'
where farm_id='00000000-0000-4000-8000-000000000010'
  and user_id='00000000-0000-4000-8000-000000000002';

create extension dblink;
create sequence public.push_revalidation_race_barrier_sequence;
create function public.pause_concurrent_push_revalidation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_arrival bigint;
  v_attempts integer := 0;
begin
  if old.status='sending' and new.status='gone' and exists (
    select 1
    from public.push_deliveries delivery
    where delivery.id=new.delivery_id
      and delivery.notification_id='00000000-0000-4000-8000-000000000034'
  ) and to_regclass('public.mutation_push_reconciliation_barrier_sequence') is not null then
    v_arrival := nextval('public.push_revalidation_race_barrier_sequence');
    if v_arrival=1 then
      while (select last_value from public.push_revalidation_race_barrier_sequence)<2 loop
        v_attempts := v_attempts + 1;
        if v_attempts >= 500 then
          raise exception 'push revalidation barrier timed out';
        end if;
        perform pg_sleep(0.01);
      end loop;
    end if;
    -- Give both sessions the same release delay. Without this rendezvous the
    -- second arrival can finish reconciliation before the first leaves its
    -- polling loop, hiding the missing parent lock under a lucky schedule.
    perform pg_sleep(0.25);
  end if;
  return new;
end;
$$;
create trigger pause_concurrent_push_revalidation
after update of status on public.push_delivery_targets
for each row execute function public.pause_concurrent_push_revalidation();

select dblink_connect('push_race_a','dbname=farmrx_disposable user=postgres');
select dblink_connect('push_race_b','dbname=farmrx_disposable user=postgres');
select * from dblink('push_race_a', $$select set_config('request.jwt.claims','{"role":"service_role"}',false)$$) as configured(value text);
select * from dblink('push_race_b', $$select set_config('request.jwt.claims','{"role":"service_role"}',false)$$) as configured(value text);
select dblink_send_query('push_race_a', format(
  'select public.revalidate_claimed_push_delivery_target(%L::uuid)',
  (select target_id from concurrent_claims order by target_id limit 1)
));
select dblink_send_query('push_race_b', format(
  'select public.revalidate_claimed_push_delivery_target(%L::uuid)',
  (select target_id from concurrent_claims order by target_id offset 1 limit 1)
));
do $$ begin
  while dblink_is_busy('push_race_a')=1 or dblink_is_busy('push_race_b')=1 loop
    perform pg_sleep(0.01);
  end loop;
end $$;
create temporary table push_race_a_result as
select * from dblink_get_result('push_race_a') as result(allowed boolean);
create temporary table push_race_b_result as
select * from dblink_get_result('push_race_b') as result(allowed boolean);
select dblink_disconnect('push_race_a');
select dblink_disconnect('push_race_b');
drop trigger pause_concurrent_push_revalidation on public.push_delivery_targets;
drop function public.pause_concurrent_push_revalidation();
drop sequence public.push_revalidation_race_barrier_sequence;

do $$
begin
  if (select bool_or(allowed) from push_race_a_result) or (select bool_or(allowed) from push_race_b_result) then
    raise exception 'concurrent revoked targets retained send authorization';
  end if;
  if (select count(*) from public.push_delivery_targets target join public.push_deliveries delivery on delivery.id=target.delivery_id where delivery.notification_id='00000000-0000-4000-8000-000000000034' and target.status='gone')<>2 then
    raise exception 'concurrent revoked targets did not both become gone';
  end if;
  if not exists (select 1 from public.push_deliveries where notification_id='00000000-0000-4000-8000-000000000034' and status='sent' and sent_at is not null) then
    raise exception 'concurrent terminal targets left their parent non-terminal';
  end if;
  if (select count(*) from public.push_subscriptions where user_id='00000000-0000-4000-8000-000000000002')<>2 then
    raise exception 'concurrent access denial deleted a valid device subscription';
  end if;
end $$;

do $$
declare
  reclaimed_count integer;
begin
  select count(*) into reclaimed_count
  from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000031', 10);
  if reclaimed_count <> 0 then
    raise exception 'revoked initialized recipient reclaimed % private payload(s)', reclaimed_count;
  end if;
  if exists (
    select 1
    from public.push_delivery_targets target
    join public.push_deliveries delivery on delivery.id=target.delivery_id
    where delivery.notification_id='00000000-0000-4000-8000-000000000031'
      and target.status <> 'gone'
  ) then
    raise exception 'revoked initialized delivery retained a live target';
  end if;
  if not exists (
    select 1 from public.push_deliveries
    where notification_id='00000000-0000-4000-8000-000000000031'
      and status='sent'
  ) then
    raise exception 'revoked initialized delivery did not become terminal';
  end if;
end $$;

-- Named-rep access is equally revocable. Queue while the exact rep grant and
-- farm sharing toggle are valid, switch sharing off, then deny the payload.
update public.farms
set share_with_rep=true
where id='00000000-0000-4000-8000-000000000010';
insert into public.farm_rep_access(farm_id,rep_user_id,enabled,granted_by)
values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000003',true,'00000000-0000-4000-8000-000000000001');
insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth)
values ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000003','https://push.example.test/removed-rep-device','synthetic-rep-p256dh','synthetic-rep-auth');
insert into public.notifications(id,farm_id,user_id,category,title,body,link,dedupe_key,created_by)
values (
  '00000000-0000-4000-8000-000000000032',
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000003',
  'general',
  'Synthetic private rep notice',
  'A rep must not receive this after sharing is disabled.',
  '/fields',
  'push-rep-revocation-probe',
  '00000000-0000-4000-8000-000000000001'
);

-- Use a separate notification to prove the grant's positive path without
-- initializing the queued-then-revoked negative control above.
insert into public.notifications(id,farm_id,user_id,category,title,body,link,dedupe_key,created_by)
values (
  '00000000-0000-4000-8000-000000000033',
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000003',
  'general',
  'Synthetic authorized rep notice',
  'An enabled named rep must receive this private payload.',
  '/fields',
  'push-rep-authorized-probe',
  '00000000-0000-4000-8000-000000000001'
);

create temporary table first_authorized_rep_claim as
select * from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000033', 10);

do $$
begin
  if (select count(*) from first_authorized_rep_claim) <> 1 then
    raise exception 'authorized rep did not receive exactly one private payload';
  end if;
  if (select endpoint from first_authorized_rep_claim) is distinct from 'https://push.example.test/removed-rep-device' then
    raise exception 'authorized rep claim returned the wrong subscription endpoint';
  end if;
  if not exists (
    select 1 from public.farm_access_epochs
    where farm_id='00000000-0000-4000-8000-000000000010'
      and user_id='00000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'authorized rep did not retain a farm access epoch';
  end if;
end $$;

update public.farms
set share_with_rep=false
where id='00000000-0000-4000-8000-000000000010';

do $$
declare
  claimed_count integer;
begin
  select count(*) into claimed_count
  from public.claim_push_delivery_targets('00000000-0000-4000-8000-000000000032', 10);
  if claimed_count <> 0 then
    raise exception 'revoked rep received % private payload(s)', claimed_count;
  end if;
  if exists (
    select 1
    from public.push_delivery_targets target
    join public.push_deliveries delivery on delivery.id=target.delivery_id
    where delivery.notification_id='00000000-0000-4000-8000-000000000032'
      and target.status <> 'gone'
  ) then
    raise exception 'revoked rep delivery retained a live target';
  end if;
  if not exists (
    select 1 from public.push_deliveries
    where notification_id='00000000-0000-4000-8000-000000000032'
      and status='sent'
  ) then
    raise exception 'revoked rep delivery did not become terminal';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon','public.push_recipient_has_current_farm_access(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.push_recipient_has_current_farm_access(uuid,uuid)','EXECUTE')
    or has_function_privilege('service_role','public.push_recipient_has_current_farm_access(uuid,uuid)','EXECUTE') then
    raise exception 'internal push access helper is directly executable by an API role';
  end if;
  if has_function_privilege('anon','public.revalidate_claimed_push_delivery_target(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.revalidate_claimed_push_delivery_target(uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.revalidate_claimed_push_delivery_target(uuid)','EXECUTE') then
    raise exception 'send-time push revalidation grants are not service-role only';
  end if;
end $$;
'@ | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable 2>&1
    $probeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $priorErrorActionPreference
  }
  $probeOutput | Write-Output
  if ($probeExitCode -ne 0) {
    if ($MutateParentDeliveryLock -and (($probeOutput | Out-String) -match 'concurrent terminal targets left their parent non-terminal')) {
      throw 'EXPECTED_PARENT_RECONCILIATION_MUTATION_DETECTED'
    }
    throw 'Revoked queued-push deny-path probe failed.'
  }

  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}

if ($passed) { Write-Output 'PUSH ACCESS REVOCATION DISPOSABLE PROBE: PASS' }
