param([ValidateSet('', 'row', 'storage', 'terminal-epoch', 'terminal-edit', 'terminal-path', 'terminal-row', 'terminal-object', 'terminal-duplicate')][string]$MutateGuard = '')

$ErrorActionPreference = 'Stop'
$name = "farmrx-soil-rx-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false

function Invoke-Probe([string]$sql, [string]$failure) {
  $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw $failure }
}

function Remove-CrossFarmGuard([string]$sql, [string]$mode) {
  $denial = if ($mode -eq 'row') { 'soil test absence verification requires current farm edit access' } else { 'soil report absence verification requires current farm edit access' }
  $pattern = "  perform public\.assert_current_farm_access_epoch\(p_farm_id\);\r?\n  if auth\.uid\(\) is null or not public\.can_edit_farm\(p_farm_id\) then\r?\n    raise exception using errcode = '42501', message = '$([regex]::Escape($denial))';\r?\n  end if;\r?\n"
  $matches = [regex]::Matches($sql, $pattern)
  if ($matches.Count -ne 1) { throw "Disposable Soil Rx $mode cross-farm mutation target drifted." }
  return [regex]::Replace($sql, $pattern, '', 1)
}

function Mutate-TerminalGuard([string]$sql, [string]$mode) {
  $replacements = @{
    'terminal-epoch' = @("begin`n  perform public.assert_current_farm_access_epoch(p_farm_id);`n  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then`n    raise exception using errcode = '42501', message = 'soil report terminal cleanup verification requires current farm edit access';`n  end if;`n", "begin`n  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then`n    raise exception using errcode = '42501', message = 'soil report terminal cleanup verification requires current farm edit access';`n  end if;`n")
    'terminal-edit' = @("  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then`n    raise exception using errcode = '42501', message = 'soil report terminal cleanup verification requires current farm edit access';`n  end if;`n", '')
    'terminal-path' = @("        or split_part(requested.path, '/', 1) <> p_farm_id::text`n        or split_part(requested.path, '/', 2) <> p_field_id::text`n        or split_part(requested.path, '/', 3) <> p_test_id::text`n", '')
    'terminal-row' = @("  if exists (`n    select 1`n    from public.soil_tests test`n    where test.farm_id = p_farm_id and test.id = p_test_id`n  ) then`n    raise exception using errcode = '42501', message = 'soil report terminal cleanup test identity still exists';`n  end if;`n", '')
    'terminal-object' = @("  if exists (`n    select 1`n    from storage.objects object`n    where object.bucket_id = 'soil-test-reports'`n      and object.name = any (p_paths)`n  )`n  then`n    raise exception using errcode = '42501', message = 'soil report terminal cleanup object still exists';`n  end if;`n", '')
    'terminal-duplicate' = @("  if p_field_id is null or p_test_id is null`n    or p_paths is null or cardinality(p_paths) < 1 or cardinality(p_paths) > 100`n    or (select count(distinct requested.path) from unnest(p_paths) requested(path)) <> cardinality(p_paths)`n    or exists (", "  if p_field_id is null or p_test_id is null`n    or p_paths is null or cardinality(p_paths) < 1 or cardinality(p_paths) > 100`n    or false`n    or exists (")
  }
  $pair = $replacements[$mode]
  if ($null -eq $pair) { throw "Unknown terminal mutation $mode." }
  $normalized = $sql -replace "`r`n", "`n"
  if ([regex]::Matches($normalized, [regex]::Escape([string]$pair[0])).Count -ne 1) { throw "Disposable Soil Rx $mode mutation target drifted." }
  return $normalized.Replace([string]$pair[0], [string]$pair[1])
}

function Invoke-ExpectedGuardMutation([string]$mode, [string]$expected) {
  $shell = (Get-Command pwsh -ErrorAction Stop).Source
  $priorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& $shell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -MutateGuard $mode 2>&1)
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $priorPreference }
  $text = [string]::Join("`n", [string[]]$output)
  if ($exitCode -eq 0 -or $text -notmatch [regex]::Escape($expected)) { throw "Disposable Soil Rx $mode mutation was not detected." }
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) { if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') { $ready = $true; break }; Start-Sleep -Milliseconds 500 }
  if (!$ready) { throw 'Disposable Soil Rx postgres:17 did not become ready.' }
  Start-Sleep -Milliseconds 500
  Invoke-Probe "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;" 'Disposable Soil Rx bootstrap failed.'
  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object {
    $migrationSql = Get-Content -Raw $_.FullName
    if ($MutateGuard -and $_.Name -eq '20260810223508_soil_rx_storage.sql') {
      $migrationSql = if ($MutateGuard -in @('row', 'storage')) { Remove-CrossFarmGuard $migrationSql $MutateGuard } else { Mutate-TerminalGuard $migrationSql $MutateGuard }
    }
    Invoke-Probe $migrationSql "Migration failed: $($_.Name)"
  }
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
insert into public.soil_tests(id,farm_id,field_id,sample_date,lab_name,created_by)
values ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000022','2027-01-09','Other Farm Lab','00000000-0000-4000-8000-000000000002');

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
  if public.verify_soil_test_absent('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000013') then raise exception 'present Soil test was reported absent'; end if;
  if (select count(*) from public.verify_soil_report_objects_absent('00000000-0000-4000-8000-000000000010',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/report.pdf','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/missing.pdf'])) <> 1 then raise exception 'mixed present/absent report verification did not return an exact subset'; end if;
  if (select name from public.verify_soil_report_objects_absent('00000000-0000-4000-8000-000000000010',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/report.pdf','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/missing.pdf'])) <> '00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/missing.pdf' then raise exception 'present report was incorrectly reported absent'; end if;
  -- The custody record is written before the first remote write. If that
  -- write never reaches Postgres, no Soil test or Storage object exists; an
  -- editor must still be able to prove the path absent without deleting it.
  if (select name from public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000018',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000018/never-uploaded.pdf'])) <> '00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000018/never-uploaded.pdf' then raise exception 'never-uploaded Soil report was not verified absent'; end if;
  if exists (select 1 from storage.objects where bucket_id='soil-test-reports' and name='00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000018/never-uploaded.pdf') then raise exception 'absence verification deleted or created a never-uploaded Soil report'; end if;
  begin perform public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000018',array['00000000-0000-4000-8000-000000000020/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000018/wrong-farm.pdf']); raise exception using errcode='ZX003', message='SOIL_RX_TERMINAL_PATH_GUARD_BYPASSED'; exception when others then if sqlstate <> '22023' or sqlerrm <> 'invalid Soil report terminal cleanup verification request' then raise; end if; end;
  begin perform public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000018',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000018/duplicate.pdf','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000018/duplicate.pdf']); raise exception using errcode='ZX004', message='SOIL_RX_TERMINAL_DUPLICATE_GUARD_BYPASSED'; exception when others then if sqlstate <> '22023' or sqlerrm <> 'invalid Soil report terminal cleanup verification request' then raise; end if; end;
  -- A row owned by another farm must neither block cleanup nor disclose its
  -- existence through this SECURITY DEFINER function.
  if (select name from public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000023',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000023/collision.pdf'])) <> '00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000023/collision.pdf' then raise exception 'terminal cleanup leaked or blocked an other-farm test identity'; end if;
  begin perform public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/row-exists.pdf']); raise exception using errcode='ZX005', message='SOIL_RX_TERMINAL_ROW_ABSENCE_GUARD_BYPASSED'; exception when others then if sqlstate <> '42501' or sqlerrm <> 'soil report terminal cleanup test identity still exists' then raise; end if; end;
  begin insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013'); raise exception 'filename-free soil report path was accepted'; exception when sqlstate '42501' then null; end;
  begin insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/..'); raise exception 'traversal soil report path was accepted'; exception when sqlstate '42501' then null; end;
  begin update public.soil_tests set field_id='00000000-0000-4000-8000-000000000022' where id='00000000-0000-4000-8000-000000000013'; raise exception 'soil test identity moved'; exception when others then if position('soil test identity cannot be changed' in sqlerrm)=0 then raise; end if; end;
end $$;
-- A concurrent field delete cascades the provisional Soil test. The typed
-- custody path remains sufficient for a read-only exact-absence proof.
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres)
values ('00000000-0000-4000-8000-000000000025','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','Deleted Field',20);
insert into public.soil_tests(id,farm_id,field_id,sample_date,lab_name,created_by)
values ('00000000-0000-4000-8000-000000000026','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000025','2027-01-10','Deleted Field Lab','00000000-0000-4000-8000-000000000001');
delete from public.fields where id='00000000-0000-4000-8000-000000000025';
do $$ begin
  if exists (select 1 from public.soil_tests where id='00000000-0000-4000-8000-000000000026') then raise exception 'field delete did not cascade its Soil test'; end if;
  if (select count(*) from public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000025','00000000-0000-4000-8000-000000000026',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000025/00000000-0000-4000-8000-000000000026/deleted-field.pdf'])) <> 1 then raise exception 'cascaded field cleanup could not reach terminal absence'; end if;
end $$;

-- SECURITY DEFINER must see an orphan object that authenticated Storage RLS
-- would hide. One present path makes the entire terminal set fail closed.
reset role;
insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000019/orphan.pdf');
set role authenticated;
do $$ begin
  begin perform public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000019',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000019/orphan.pdf']); raise exception using errcode='ZX006', message='SOIL_RX_TERMINAL_OBJECT_ABSENCE_GUARD_BYPASSED'; exception when others then if sqlstate <> '42501' or sqlerrm <> 'soil report terminal cleanup object still exists' then raise; end if; end;
  begin perform public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000019',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000019/absent.pdf','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000019/orphan.pdf']); raise exception 'mixed terminal object state was accepted'; exception when others then if sqlstate <> '42501' or sqlerrm <> 'soil report terminal cleanup object still exists' then raise; end if; end;
end $$;
reset role;
delete from storage.objects where bucket_id='soil-test-reports' and name='00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000019/orphan.pdf';
set role authenticated;
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',2)::text)::text,false);
do $$ begin
  begin update public.soil_tests set lab_name='Stale tab attack' where id='00000000-0000-4000-8000-000000000013'; raise exception 'stale soil test write was accepted'; exception when sqlstate 'P0001' then if sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise; end if; end;
  begin insert into storage.objects(bucket_id,name) values ('soil-test-reports','00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/stale.pdf'); raise exception 'stale soil report write was accepted'; exception when sqlstate 'P0001' then if sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise; end if; end;
  begin perform public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000018',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000018/stale.pdf']); raise exception using errcode='ZX007', message='SOIL_RX_TERMINAL_EPOCH_GUARD_BYPASSED'; exception when others then if sqlstate <> 'P0001' or sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise; end if; end;
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
  if (select count(*) from public.verify_soil_report_objects_absent('00000000-0000-4000-8000-000000000010',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000016/retry.pdf'])) <> 1 then raise exception 'committed Storage delete could not be safely verified for retry'; end if;
  delete from public.soil_tests where id='00000000-0000-4000-8000-000000000016'; get diagnostics affected = row_count; if affected <> 1 then raise exception 'Storage cleanup retry did not delete its Soil row'; end if;
  if not public.verify_soil_test_absent('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000016') then raise exception 'committed Soil delete could not be safely verified for retry'; end if;
  if exists (select 1 from public.soil_tests where id='00000000-0000-4000-8000-000000000016') or exists (select 1 from storage.objects where bucket_id='soil-test-reports' and name='00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000016/retry.pdf') then raise exception 'Storage cleanup retry left custody residue'; end if;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000020',1)::text)::text,false);
do $$ begin
  if (select count(*) from public.soil_tests where id='00000000-0000-4000-8000-000000000013') <> 0 then raise exception 'other farm read soil test'; end if;
  if (select count(*) from storage.objects where bucket_id='soil-test-reports') <> 0 then raise exception 'other farm read soil report'; end if;
  begin perform public.verify_soil_test_absent('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000013'); raise exception using errcode = 'ZX001', message = 'SOIL_RX_CROSS_FARM_ROW_GUARD_BYPASSED'; exception when others then if sqlstate <> 'P0001' or sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise; end if; end;
  begin perform public.verify_soil_report_objects_absent('00000000-0000-4000-8000-000000000010',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/report.pdf']); raise exception using errcode = 'ZX002', message = 'SOIL_RX_CROSS_FARM_STORAGE_GUARD_BYPASSED'; exception when others then if sqlstate <> 'P0001' or sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise; end if; end;
  begin perform public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000018',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000018/cross-farm.pdf']); raise exception using errcode='ZX007', message='SOIL_RX_TERMINAL_CROSS_FARM_GUARD_BYPASSED'; exception when others then if sqlstate <> 'P0001' or sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise; end if; end;
  begin insert into public.soil_tests(id,farm_id,field_id,sample_date,lab_name,created_by) values ('00000000-0000-4000-8000-000000000024','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','2027-01-11','Cross-farm attack','00000000-0000-4000-8000-000000000002'); raise exception 'other farm wrote soil test'; exception when others then if sqlstate <> '42501' and not (sqlstate = 'P0001' and sqlerrm = 'FARM_ACCESS_EPOCH_CHANGED') then raise; end if; end;
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
  begin perform public.verify_soil_test_absent('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000013'); raise exception 'read-only rep verified a present Soil test as absent'; exception when sqlstate '42501' then null; end;
  begin perform public.verify_soil_report_objects_absent('00000000-0000-4000-8000-000000000010',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013/report.pdf']); raise exception 'read-only rep verified a present report as absent'; exception when sqlstate '42501' then null; end;
  begin perform public.verify_soil_report_cleanup_terminal_absence('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000018',array['00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000018/rep.pdf']); raise exception using errcode='ZX008', message='SOIL_RX_TERMINAL_EDIT_GUARD_BYPASSED'; exception when others then if sqlstate <> '42501' or sqlerrm <> 'soil report terminal cleanup verification requires current farm edit access' then raise; end if; end;
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
  if (-not $MutateGuard) {
    $mutations = [ordered]@{
      row = 'SOIL_RX_CROSS_FARM_ROW_GUARD_BYPASSED'
      storage = 'SOIL_RX_CROSS_FARM_STORAGE_GUARD_BYPASSED'
      'terminal-epoch' = 'SOIL_RX_TERMINAL_EPOCH_GUARD_BYPASSED'
      'terminal-edit' = 'SOIL_RX_TERMINAL_EDIT_GUARD_BYPASSED'
      'terminal-path' = 'SOIL_RX_TERMINAL_PATH_GUARD_BYPASSED'
      'terminal-row' = 'SOIL_RX_TERMINAL_ROW_ABSENCE_GUARD_BYPASSED'
      'terminal-object' = 'SOIL_RX_TERMINAL_OBJECT_ABSENCE_GUARD_BYPASSED'
      'terminal-duplicate' = 'SOIL_RX_TERMINAL_DUPLICATE_GUARD_BYPASSED'
    }
    foreach ($entry in $mutations.GetEnumerator()) { Invoke-ExpectedGuardMutation $entry.Key $entry.Value }
    Write-Output 'SOIL_RX_GUARD_MUTATIONS_PASS row=detected storage=detected terminal-epoch=detected terminal-edit=detected terminal-path=detected terminal-row=detected terminal-object=detected terminal-duplicate=detected'
  }
  $passed = $true
} finally { docker rm -f $name 2>$null | Out-Null }
if ($passed) { Write-Output 'SOIL_RX_DISPOSABLE_RLS_STORAGE_PASS' }
