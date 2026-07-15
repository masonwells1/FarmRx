$ErrorActionPreference = 'Stop'
$name = "farmrx-rls-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false

function Invoke-DisposablePsql([string]$sql) {
  $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw 'Disposable RLS psql failed.' }
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:16 | Out-Null
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Disposable postgres:16 did not become ready.' }

  Invoke-DisposablePsql @'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid);
alter table storage.objects enable row level security;
'@

  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object {
    Invoke-DisposablePsql (Get-Content -Raw $_.FullName)
  }

  Invoke-DisposablePsql @'
insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000001','owner@example.test'),
  ('10000000-0000-4000-8000-000000000002','manager@example.test'),
  ('10000000-0000-4000-8000-000000000003','worker@example.test'),
  ('10000000-0000-4000-8000-000000000004','readonly@example.test'),
  ('10000000-0000-4000-8000-000000000005','rep@example.test'),
  ('10000000-0000-4000-8000-000000000006','stranger@example.test');

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
insert into public.farms(id,name,created_by) values
  ('20000000-0000-4000-8000-000000000001','Matrix Farm','10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002','Other Farm','10000000-0000-4000-8000-000000000001');
insert into public.farm_memberships(farm_id,user_id,role,status) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','manager','active'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','worker','active'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','read_only','active');
insert into public.farm_rep_access(farm_id,rep_user_id,enabled,granted_by)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005',true,'10000000-0000-4000-8000-000000000001');

set role authenticated;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$ begin
  if not public.can_access_farm('20000000-0000-4000-8000-000000000001') then raise exception 'manager access failed'; end if;
  if not public.can_edit_farm('20000000-0000-4000-8000-000000000001') then raise exception 'manager edit failed'; end if;
  if not public.can_manage_farm('20000000-0000-4000-8000-000000000001') then raise exception 'manager manage failed'; end if;
  if not public.can_read_private_financials('20000000-0000-4000-8000-000000000001') then raise exception 'manager financial access failed'; end if;
  if (select count(*) from public.farms) <> 1 then raise exception 'manager visible farm count failed'; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$ begin
  if not public.can_access_farm('20000000-0000-4000-8000-000000000001') then raise exception 'worker access failed'; end if;
  if not public.can_edit_farm('20000000-0000-4000-8000-000000000001') then raise exception 'worker edit failed'; end if;
  if public.can_manage_farm('20000000-0000-4000-8000-000000000001') then raise exception 'worker manage leaked'; end if;
  if public.can_read_private_financials('20000000-0000-4000-8000-000000000001') then raise exception 'worker financial access leaked'; end if;
  if (select count(*) from public.farms) <> 1 then raise exception 'worker visible farm count failed'; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$ begin
  if not public.can_access_farm('20000000-0000-4000-8000-000000000001') then raise exception 'read-only access failed'; end if;
  if public.can_edit_farm('20000000-0000-4000-8000-000000000001') then raise exception 'read-only edit leaked'; end if;
  if public.can_manage_farm('20000000-0000-4000-8000-000000000001') then raise exception 'read-only manage leaked'; end if;
  if public.can_read_private_financials('20000000-0000-4000-8000-000000000001') then raise exception 'read-only financial access leaked'; end if;
  if (select count(*) from public.farms) <> 1 then raise exception 'read-only visible farm count failed'; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',false);
do $$ begin
  if public.can_access_farm('20000000-0000-4000-8000-000000000001') then raise exception 'rep accessed farm while sharing off'; end if;
  if public.can_read_private_financials('20000000-0000-4000-8000-000000000001') then raise exception 'rep read financials while sharing off'; end if;
  if (select count(*) from public.farms) <> 0 then raise exception 'rep saw farm while sharing off'; end if;
end $$;

reset role;
update public.farms set share_with_rep=true where id='20000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',false);
do $$ begin
  if not public.can_access_farm('20000000-0000-4000-8000-000000000001') then raise exception 'explicit rep access failed'; end if;
  if public.can_edit_farm('20000000-0000-4000-8000-000000000001') then raise exception 'rep edit leaked'; end if;
  if public.can_manage_farm('20000000-0000-4000-8000-000000000001') then raise exception 'rep manage leaked'; end if;
  if not public.can_read_private_financials('20000000-0000-4000-8000-000000000001') then raise exception 'rep financial access failed'; end if;
  if (select count(*) from public.farms) <> 1 then raise exception 'rep visible farm count failed'; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',false);
do $$ begin
  if public.can_access_farm('20000000-0000-4000-8000-000000000001') then raise exception 'stranger access leaked'; end if;
  if public.can_edit_farm('20000000-0000-4000-8000-000000000001') then raise exception 'stranger edit leaked'; end if;
  if public.can_manage_farm('20000000-0000-4000-8000-000000000001') then raise exception 'stranger manage leaked'; end if;
  if public.can_read_private_financials('20000000-0000-4000-8000-000000000001') then raise exception 'stranger financial access leaked'; end if;
  if (select count(*) from public.farms) <> 0 then raise exception 'stranger saw a farm'; end if;
end $$;

reset role;
'@
  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}

if ($passed) { Write-Output 'PROBE RLS role matrix: PASS' }
