$ErrorActionPreference = 'Stop'
$name = "farmrx-0040-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the disposable 0040 proof but is not available on PATH.' }

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
  ('00000000-0000-4000-8000-000000000002','member@example.test'),
  ('00000000-0000-4000-8000-000000000003','rep@example.test'),
  ('00000000-0000-4000-8000-000000000004','bootstrap@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000010','Epoch Farm','00000000-0000-4000-8000-000000000001');
insert into public.entities(id,farm_id,name,entity_type) values ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','Epoch Entity','individual');
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','worker','active');
insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000011','Second Epoch Farm','00000000-0000-4000-8000-000000000001');
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1,'00000000-0000-4000-8000-000000000011',1)::text)::text,false);
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','worker','active');
do $$ begin
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000001')<>1 then raise exception 'owner bootstrap epoch was not one'; end if;
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002')<>1 then raise exception 'member grant epoch was not one'; end if;
end $$;
update public.farm_memberships set status='revoked' where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002';
update public.farm_memberships set status='active' where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002';
do $$ begin
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002')<>3 then raise exception 'revoke/regrant did not advance epoch to three'; end if;
end $$;
update public.farm_memberships set can_view_financials=true where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002';
update public.farm_memberships set can_view_financials=false where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002';
do $$ begin
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-000000000010' and user_id='00000000-0000-4000-8000-000000000002')<>5 then raise exception 'financial grant/revoke did not advance epoch to five'; end if;
end $$;
'@ '0040 seed or monotonic epoch proof failed.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000004"}',false);
select set_config('request.headers','{}',false);
do $$ declare result jsonb; begin
  result:=public.bootstrap_first_farm('Bootstrap Farm','Bootstrap Entity','llc');
  if result->'farm'->>'id' is null or result->'entity'->>'id' is null then raise exception 'bootstrap did not return its farm and entity'; end if;
  if (select access_epoch from public.farm_access_epochs where user_id='00000000-0000-4000-8000-000000000004')<>1 then raise exception 'bootstrap did not create owner epoch one'; end if;
end $$;
'@ 'First-farm bootstrap did not receive its narrow same-transaction exception.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
update public.entities set name='STALE DIRECT WRITE' where id='00000000-0000-4000-8000-000000000020';
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A revoked-then-regranted client wrote with its old epoch.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers','{}',false);
update public.entities set name='MISSING HEADER WRITE' where id='00000000-0000-4000-8000-000000000020';
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'An authenticated farm write succeeded without an epoch header.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.create_notification('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','task','STALE RPC WRITE',null,'/notifications','epoch-stale-rpc');
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A SECURITY DEFINER RPC bypassed the stale epoch guard.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into storage.objects(bucket_id,name,owner) values ('scouting-photos','00000000-0000-4000-8000-000000000010/field/note/photo.jpg','00000000-0000-4000-8000-000000000002');
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A stale storage write bypassed the farm epoch guard.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',5)::text)::text,false);
update public.entities set name='Current Entity' where id='00000000-0000-4000-8000-000000000020';
select public.create_notification('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','task','Current RPC write',null,'/notifications','epoch-current-rpc');
insert into storage.objects(bucket_id,name,owner) values ('scouting-photos','00000000-0000-4000-8000-000000000010/field/note/photo.jpg','00000000-0000-4000-8000-000000000002');
do $$ begin
  if (select name from public.entities where id='00000000-0000-4000-8000-000000000020')<>'Current Entity' then raise exception 'current direct write did not persist'; end if;
  if (select count(*) from public.notifications where dedupe_key='epoch-current-rpc')<>1 then raise exception 'current RPC write did not persist'; end if;
  if (select count(*) from storage.objects where name like '00000000-0000-4000-8000-000000000010/%')<>1 then raise exception 'current storage write did not persist'; end if;
  if (select count(*) from public.get_current_farm_access_epochs() where farm_id='00000000-0000-4000-8000-000000000010' and access_epoch=5)<>1 then raise exception 'epoch RPC did not return the current accessible farm'; end if;
end $$;
'@ 'Current epoch direct, RPC, storage, or readback proof failed.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',5)::text)::text,false);
update public.entities set name='CROSS USER WRITE' where id='00000000-0000-4000-8000-000000000020';
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A same-farm user switch re-authored an operation captured by another user.'

  Invoke-ExpectedFailure @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1,'00000000-0000-4000-8000-000000000011',1)::text)::text,false);
update storage.objects
set name='00000000-0000-4000-8000-000000000011/field/note/photo.jpg'
where name='00000000-0000-4000-8000-000000000010/field/note/photo.jpg';
'@ 'FARM_ACCESS_EPOCH_CHANGED' 'A storage move validated only the new farm and ignored the stale old-farm epoch.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',5,'00000000-0000-4000-8000-000000000011',1)::text)::text,false);
update storage.objects
set name='00000000-0000-4000-8000-000000000011/field/note/photo.jpg'
where name='00000000-0000-4000-8000-000000000010/field/note/photo.jpg';
do $$ begin
  if (select count(*) from storage.objects where name='00000000-0000-4000-8000-000000000011/field/note/photo.jpg')<>1 then raise exception 'fresh old/new epoch storage move did not persist'; end if;
end $$;
'@ 'Fresh old/new storage epochs could not move the object.'

  Invoke-Probe @'
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.headers','{}',false);
insert into public.notifications(farm_id,user_id,category,title,created_by)
values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','task','Service worker write','00000000-0000-4000-8000-000000000001');
do $$ declare missing integer; unscoped text[]; begin
  if has_table_privilege('authenticated','public.farm_access_epochs','select')
    or has_table_privilege('anon','public.farm_access_epochs','select')
    or has_table_privilege('service_role','public.farm_access_epochs','select') then
    raise exception 'farm_access_epochs has direct Data API access';
  end if;
  if not has_function_privilege('authenticated','public.get_current_farm_access_epochs()','execute')
    or has_function_privilege('anon','public.get_current_farm_access_epochs()','execute')
    or has_function_privilege('service_role','public.get_current_farm_access_epochs()','execute') then
    raise exception 'epoch RPC grants are wrong';
  end if;
  if has_function_privilege('authenticated','public.current_request_expected_user_id()','execute')
    or has_function_privilege('anon','public.current_request_expected_user_id()','execute')
    or has_function_privilege('service_role','public.current_request_expected_user_id()','execute') then
    raise exception 'expected-user parser is directly executable';
  end if;
  select count(*) into missing
  from information_schema.columns column_row
  where column_row.table_schema='public' and column_row.column_name='farm_id'
    and column_row.table_name<>'farm_access_epochs'
    and exists (
      select 1 from pg_catalog.pg_class base_relation
      join pg_catalog.pg_namespace base_namespace on base_namespace.oid=base_relation.relnamespace
      where base_namespace.nspname='public' and base_relation.relname=column_row.table_name
        and base_relation.relkind in ('r','p')
    )
    and not exists (
      select 1 from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid=trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname=column_row.table_name
        and trigger_row.tgname='farm_access_epoch_guard' and not trigger_row.tgisinternal
    );
  if missing<>0 then raise exception '% farm-scoped tables lack the access epoch guard',missing; end if;
  select array_agg(distinct privilege.table_name order by privilege.table_name) into unscoped
  from information_schema.table_privileges privilege
  where privilege.table_schema='public' and privilege.grantee='authenticated'
    and privilege.privilege_type in ('INSERT','UPDATE','DELETE')
    and privilege.table_name not in ('farms','push_subscriptions')
    and not exists (
      select 1 from information_schema.columns farm_column
      where farm_column.table_schema=privilege.table_schema
        and farm_column.table_name=privilege.table_name and farm_column.column_name='farm_id'
    );
  if cardinality(unscoped)>0 then raise exception 'authenticated writable tables lack farm_id fencing: %',unscoped; end if;
  if (select count(*) from public.notifications where title='Service worker write')<>1 then raise exception 'service-role server write did not bypass browser epoch protocol'; end if;
end $$;
'@ '0040 ACL, trigger coverage, or service-role proof failed.'

  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}
if ($passed) { Write-Output 'PROBE 0040 server-owned farm access epoch fencing: PASS' }
