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
      (Get-Content -Raw $_.FullName) | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
      if ($LASTEXITCODE -ne 0) { throw "Migration failed in disposable push-revocation proof: $($_.Name)" }
    }

  @'
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
end $$;
'@ | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw 'Revoked queued-push deny-path probe failed.' }

  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}

if ($passed) { Write-Output 'PUSH ACCESS REVOCATION DISPOSABLE PROBE: PASS' }
