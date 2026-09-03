$ErrorActionPreference = 'Stop'
$name = "farmrx-soil-rx-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false

function Invoke-Probe([string]$sql, [string]$failure) {
  $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw $failure }
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) { if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') { $ready = $true; break }; Start-Sleep -Milliseconds 500 }
  if (!$ready) { throw 'Disposable Soil Rx postgres:17 did not become ready.' }
  Start-Sleep -Milliseconds 500
  Invoke-Probe "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;" 'Disposable Soil Rx bootstrap failed.'
  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object { Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)" }
  Invoke-Probe @'
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','owner-a@example.test'),
 ('00000000-0000-4000-8000-000000000002','owner-b@example.test'),
 ('00000000-0000-4000-8000-000000000003','rep@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000010','Soil Farm A','00000000-0000-4000-8000-000000000001');
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into public.entities(id,farm_id,name,entity_type) values ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','Entity A','individual');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','Field A',40);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000020','Soil Farm B','00000000-0000-4000-8000-000000000002');
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000020',1)::text)::text,false);
insert into public.entities(id,farm_id,name,entity_type) values ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000020','Entity B','individual');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000021','Field B',40);

set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into public.soil_tests(id,farm_id,field_id,sample_date,lab_name,ph,zinc_ppm,created_by)
values ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','2027-01-10','Probe Lab',6.555,2.1,'00000000-0000-4000-8000-000000000001');
insert into public.soil_test_attachments(id,farm_id,field_id,test_id,storage_path,original_filename,mime_type,size_bytes,created_by)
values ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/report.pdf','report.pdf','application/pdf',1024,'00000000-0000-4000-8000-000000000001');
insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/report.pdf');
do $$ begin
  if (select count(*) from public.soil_tests where id='00000000-0000-4000-8000-000000000013') <> 1 then raise exception 'owner cannot read soil test'; end if;
  if (select ph from public.soil_tests where id='00000000-0000-4000-8000-000000000013') <> 6.555 then raise exception 'pH precision changed'; end if;
  if (select count(*) from storage.objects where bucket_id='soil-test-reports') <> 1 then raise exception 'owner cannot read soil report'; end if;
  begin insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013'); raise exception 'filename-free soil report path was accepted'; exception when sqlstate '42501' then null; end;
  begin insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/..'); raise exception 'traversal soil report path was accepted'; exception when sqlstate '42501' then null; end;
  begin update public.soil_tests set field_id='00000000-0000-4000-8000-000000000022' where id='00000000-0000-4000-8000-000000000013'; raise exception 'soil test identity moved'; exception when others then if position('soil test identity cannot be changed' in sqlerrm)=0 then raise; end if; end;
end $$;
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',2)::text)::text,false);
do $$ begin
  begin update public.soil_tests set lab_name='Stale tab attack' where id='00000000-0000-4000-8000-000000000013'; raise exception 'stale soil test write was accepted'; exception when sqlstate 'P0001' then if sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise; end if; end;
  begin insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/stale.pdf'); raise exception 'stale soil report write was accepted'; exception when sqlstate 'P0001' then if sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise; end if; end;
end $$;
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
do $$ begin if (select lab_name from public.soil_tests where id='00000000-0000-4000-8000-000000000013') <> 'Probe Lab' then raise exception 'stale soil test write persisted'; end if; end $$;

-- A failed Storage removal must leave its still-authorizing Soil row intact.
-- The matching-context retry removes the object first, then the cascading row.
insert into public.soil_tests(id,farm_id,field_id,sample_date,lab_name,created_by)
values ('00000000-0000-4000-8000-000000000016','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','2027-01-11','Cleanup Retry Lab','00000000-0000-4000-8000-000000000001');
insert into public.soil_test_attachments(id,farm_id,field_id,test_id,storage_path,original_filename,mime_type,size_bytes,created_by)
values ('00000000-0000-4000-8000-000000000017','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000016','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000016/retry.pdf','retry.pdf','application/pdf',1024,'00000000-0000-4000-8000-000000000001');
insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000016/retry.pdf');
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',2)::text)::text,false);
do $$ begin
  begin delete from storage.objects where bucket_id='soil-test-reports' and name='00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000016/retry.pdf'; raise exception 'stale Storage cleanup was accepted'; exception when sqlstate 'P0001' then if sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise; end if; end;
  if (select count(*) from public.soil_tests where id='00000000-0000-4000-8000-000000000016') <> 1 then raise exception 'failed Storage cleanup removed its authorization row'; end if;
  if (select count(*) from storage.objects where bucket_id='soil-test-reports' and name='00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000016/retry.pdf') <> 1 then raise exception 'failed Storage cleanup removed its retry object'; end if;
end $$;
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
do $$ declare affected integer; begin
  delete from storage.objects where bucket_id='soil-test-reports' and name='00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000016/retry.pdf'; get diagnostics affected = row_count; if affected <> 1 then raise exception 'Storage cleanup retry did not delete its object'; end if;
  delete from public.soil_tests where id='00000000-0000-4000-8000-000000000016'; get diagnostics affected = row_count; if affected <> 1 then raise exception 'Storage cleanup retry did not delete its Soil row'; end if;
  if exists (select 1 from public.soil_tests where id='00000000-0000-4000-8000-000000000016') or exists (select 1 from storage.objects where bucket_id='soil-test-reports' and name='00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000016/retry.pdf') then raise exception 'Storage cleanup retry left custody residue'; end if;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000020',1)::text)::text,false);
do $$ begin
  if (select count(*) from public.soil_tests where id='00000000-0000-4000-8000-000000000013') <> 0 then raise exception 'other farm read soil test'; end if;
  if (select count(*) from storage.objects where bucket_id='soil-test-reports') <> 0 then raise exception 'other farm read soil report'; end if;
  begin insert into public.soil_tests(id,farm_id,field_id,sample_date,lab_name,created_by) values ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','2027-01-11','Cross-farm attack','00000000-0000-4000-8000-000000000002'); raise exception 'other farm wrote soil test'; exception when others then if sqlstate <> '42501' and not (sqlstate = 'P0001' and sqlerrm = 'FARM_ACCESS_EPOCH_CHANGED') then raise; end if; end;
  begin insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/cross-farm.pdf'); raise exception 'other farm wrote soil report'; exception when others then if sqlstate <> '42501' and not (sqlstate = 'P0001' and sqlerrm = 'FARM_ACCESS_EPOCH_CHANGED') then raise; end if; end;
end $$;

reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
update public.farms set share_with_rep=true where id='00000000-0000-4000-8000-000000000010';
insert into public.farm_rep_access(farm_id,rep_user_id,enabled,granted_by) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000003',true,'00000000-0000-4000-8000-000000000001');
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000003','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
do $$ declare affected integer; begin
  if (select count(*) from public.soil_tests where id='00000000-0000-4000-8000-000000000013') <> 1 then raise exception 'shared rep cannot read soil test'; end if;
  if (select count(*) from storage.objects where bucket_id='soil-test-reports') <> 1 then raise exception 'shared rep cannot read soil report'; end if;
  begin insert into public.soil_tests(id,farm_id,field_id,sample_date,lab_name,created_by) values ('00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','2027-01-12','Rep attack','00000000-0000-4000-8000-000000000003'); raise exception 'shared rep wrote soil test'; exception when sqlstate '42501' then null; end;
  delete from public.soil_tests where id='00000000-0000-4000-8000-000000000013'; get diagnostics affected = row_count; if affected <> 0 then raise exception 'shared rep deleted soil test'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
update public.farms set share_with_rep=false where id='00000000-0000-4000-8000-000000000010';
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003"}',false);
do $$ begin
  if (select count(*) from public.soil_tests where id='00000000-0000-4000-8000-000000000013') <> 0 then raise exception 'private rep read soil test'; end if;
  if (select count(*) from storage.objects where bucket_id='soil-test-reports') <> 0 then raise exception 'private rep read soil report'; end if;
end $$;
reset role;

do $$ begin
  if not exists (select 1 from storage.buckets where id='soil-test-reports' and public=false and file_size_limit=20971520 and allowed_mime_types @> array['application/pdf','image/jpeg','image/png','image/heic','image/heif']) then raise exception 'soil report bucket contract mismatch'; end if;
end $$;
'@ 'Focused Soil Rx RLS/storage proof failed.'
  $passed = $true
} finally { docker rm -f $name 2>$null | Out-Null }
if ($passed) { Write-Output 'SOIL_RX_DISPOSABLE_RLS_STORAGE_PASS' }
