$ErrorActionPreference = 'Stop'
$name = "farmrx-pine-removed-epoch-$PID"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the disposable removed-farm epoch proof.'
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
  if ($exitCode -eq 0 -or ($output -join "`n") -notmatch [regex]::Escape($expected)) { throw $failure }
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

  Invoke-Probe "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;" 'Disposable bootstrap failed.'

  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' |
    Sort-Object Name |
    ForEach-Object {
      Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)"
    }

  Invoke-Probe @'
insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000001','owner@example.test'),
  ('00000000-0000-4000-8000-000000000002','worker@example.test'),
  ('00000000-0000-4000-8000-000000000003','rep@example.test'),
  ('00000000-0000-4000-8000-000000000004','outsider@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers','{}',false);
insert into public.farms(id,name,share_with_rep,created_by) values
  ('00000000-0000-4000-8000-000000000011','Revoked Member Farm',false,'00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000012','Suspended Member Farm',false,'00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000013','Revoked Rep Farm',true,'00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000014','Active Member Farm',false,'00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000015','Dual Active Farm',true,'00000000-0000-4000-8000-000000000001');
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs',jsonb_build_object(
      '00000000-0000-4000-8000-000000000011',1,
      '00000000-0000-4000-8000-000000000012',1,
      '00000000-0000-4000-8000-000000000013',1,
      '00000000-0000-4000-8000-000000000014',1,
      '00000000-0000-4000-8000-000000000015',1
    )::text
  )::text,
  false
);
insert into public.farm_memberships(farm_id,user_id,role,status) values
  ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','worker','active'),
  ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002','worker','active'),
  ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000002','worker','active');
insert into public.farm_rep_access(farm_id,rep_user_id,enabled,granted_by) values
  ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000003',true,'00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000003',true,'00000000-0000-4000-8000-000000000001');
update public.farm_memberships set status='revoked'
where farm_id='00000000-0000-4000-8000-000000000011' and user_id='00000000-0000-4000-8000-000000000002';
update public.farm_memberships set status='suspended'
where farm_id='00000000-0000-4000-8000-000000000012' and user_id='00000000-0000-4000-8000-000000000002';
update public.farm_rep_access set enabled=false, revoked_at='2027-08-04T19:45:00Z'
where rep_user_id='00000000-0000-4000-8000-000000000003';
insert into public.farm_memberships(farm_id,user_id,role,status)
values ('00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000003','worker','active');
'@ 'Removed-farm epoch fixture failed.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
set role authenticated;
do $$
begin
  if (select count(*) from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000011')) <> 1
    or (select access_epoch from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000011')) <> 2 then
    raise exception 'revoked member did not receive exact epoch 2';
  end if;
  if (select count(*) from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000012')) <> 1
    or (select access_epoch from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000012')) <> 2 then
    raise exception 'suspended member did not receive exact epoch 2';
  end if;
  if exists (select 1 from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000013')) then
    raise exception 'worker read another user revoked-rep epoch';
  end if;
  if exists (select 1 from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000014')) then
    raise exception 'active access was exposed through the removed path';
  end if;
end
$$;
reset role;
'@ 'Revoked/suspended member or cross-farm security proof failed.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003"}',false);
set role authenticated;
do $$
begin
  if (select count(*) from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000013')) <> 1
    or (select access_epoch from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000013')) <> 2 then
    raise exception 'revoked rep did not receive exact epoch 2';
  end if;
  if exists (select 1 from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000011')) then
    raise exception 'rep read another user revoked membership epoch';
  end if;
  if exists (select 1 from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000015')) then
    raise exception 'active membership leaked a historical revoked-rep epoch';
  end if;
end
$$;
reset role;
'@ 'Revoked-rep or dual-active security proof failed.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000004"}',false);
set role authenticated;
do $$
begin
  if exists (select 1 from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000011'))
    or exists (select 1 from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000013'))
    or exists (select 1 from public.get_removed_farm_access_epoch('ffffffff-ffff-4fff-8fff-ffffffffffff')) then
    raise exception 'outsider enumerated a farm epoch';
  end if;
end
$$;
reset role;
'@ 'Outsider or arbitrary-farm denial proof failed.'

  Invoke-ExpectedFailure @'
set role anon;
select * from public.get_removed_farm_access_epoch('00000000-0000-4000-8000-000000000011');
'@ 'permission denied for function get_removed_farm_access_epoch' 'Anonymous role executed the removed-farm epoch RPC.'

  Invoke-Probe @'
do $$
begin
  if not has_function_privilege('authenticated','public.get_removed_farm_access_epoch(uuid)','execute')
    or has_function_privilege('anon','public.get_removed_farm_access_epoch(uuid)','execute')
    or has_function_privilege('service_role','public.get_removed_farm_access_epoch(uuid)','execute') then
    raise exception 'removed-farm epoch RPC ACLs are wrong';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname='get_removed_farm_access_epoch'
      and (
        pg_catalog.pg_get_function_identity_arguments(procedure.oid) <> 'target_farm_id uuid'
        or not procedure.prosecdef
        or procedure.proconfig is distinct from array['search_path=""']::text[]
      )
  ) then
    raise exception 'removed-farm epoch RPC signature or security boundary drifted';
  end if;
  if has_table_privilege('authenticated','public.farm_access_epochs','select') then
    raise exception 'authenticated role gained direct epoch-table enumeration';
  end if;
end
$$;
'@ 'Removed-farm epoch catalog security proof failed.'

  Write-Output 'PINE_HILL_REMOVED_EPOCH_DISPOSABLE_PASS'
} finally {
  docker rm -f $name 2>$null | Out-Null
}
