$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$aprilProof = Join-Path $root 'scripts/verify-maple-april-disposable.ps1'
$maySql = Join-Path $root 'tests/season/maple-2027-may.verify.sql'
$snapshotSql = @'
create temporary table season_may_snapshot(table_name text primary key, state jsonb);
do $snapshot$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public'
    and tablename not in ('assigned_program_passes','assigned_program_pass_products','application_records','repository_write_receipts')
    order by tablename
  loop
    execute format('insert into season_may_snapshot select %L, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from public.%I t', r.tablename, r.tablename);
  end loop;
end
$snapshot$;
insert into season_may_snapshot
select 'repository_write_receipts:prior', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb)
from public.repository_write_receipts t
where not (farm_id='27010000-0000-4000-8000-000000000001' and operation_id='27ff0000-0000-4000-8000-000000000005');
insert into season_may_snapshot
select 'assigned_program_passes:unaffected', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb)
from public.assigned_program_passes t where id <> '27053000-0000-4000-8000-000000000001';
insert into season_may_snapshot
select 'assigned_program_passes:target-normalized', coalesce(jsonb_agg(to_jsonb(t) - array['status','applied_on','applied_acres','application_record_id','updated_by','updated_at'] order by id), '[]'::jsonb)
from public.assigned_program_passes t where id='27053000-0000-4000-8000-000000000001';
insert into season_may_snapshot
select 'assigned_program_pass_products:unaffected', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb)
from public.assigned_program_pass_products t where id <> '27053100-0000-4000-8000-000000000001';
insert into season_may_snapshot
select 'assigned_program_pass_products:target-normalized', coalesce(jsonb_agg(to_jsonb(t) - array['actual_product_name','actual_rate_text','actual_unit_text','actual_cost_per_acre','updated_by','updated_at'] order by id), '[]'::jsonb)
from public.assigned_program_pass_products t where id='27053100-0000-4000-8000-000000000001';
insert into season_may_snapshot
select 'application_records:unaffected', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb)
from public.application_records t where id <> '27054000-0000-4000-8000-000000000001';
select jsonb_object_agg(table_name,state order by table_name)::text from season_may_snapshot;
'@
$preconditionSql = @'
select (
  (select count(*) from public.repository_write_receipts where farm_id='27010000-0000-4000-8000-000000000001' and user_id='27000000-0000-4000-8000-000000000001')=8
  and (select count(*) from public.farm_tasks)=0
  and (select count(*) from public.application_records)=0
  and (select count(*) from public.application_products)=0
  and (select status from public.assigned_program_passes where id='27053000-0000-4000-8000-000000000001')='planned'
  and (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000001' and product_id='27040000-0000-4000-8000-000000000000')=100.0000
)::text;
'@

if (-not $env:FARMRX_SEASON_OWNER_PASSWORD) { throw 'FARMRX_SEASON_OWNER_PASSWORD is required and must contain only the synthetic local fixture password.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the Maple May proof.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js/npm with npx is required for the Maple May browser proof.' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }

Push-Location $root
try {
  # April invokes March -> February -> January. January is the sole reset owner.
  & powershell -NoProfile -ExecutionPolicy Bypass -File $aprilProof
  if ($LASTEXITCODE -ne 0) { throw 'Continuous Maple January-April prerequisite failed.' }
  $running = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $running -notcontains $expectedContainer) { throw "Refusing May proof: expected disposable database container $expectedContainer is not running." }

  $pre = $preconditionSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($pre -join '') -cne 'true') {
    throw "May prerequisite state is not exact: $($pre -join '')"
  }
  $before = $snapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $before) { throw 'Could not capture the pre-May unrelated-state snapshot.' }

  $env:DO_NOT_TRACK = '1'
  $oldPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $statusLines = @(& $supabase --profile supabase status -o env 2>$null); $statusExit = $LASTEXITCODE } finally { $ErrorActionPreference = $oldPreference }
  if ($statusExit -ne 0) { throw 'Could not read disposable local Supabase browser configuration.' }
  $status = @{}; foreach ($line in $statusLines) { if ($line -match '^([A-Z0-9_]+)="?(.*?)"?$') { $status[$matches[1]]=$matches[2] } }
  if ($status['API_URL'] -ne 'http://127.0.0.1:55321') { throw 'Refusing May proof: local API URL is not the expected loopback endpoint.' }
  if (-not $status['PUBLISHABLE_KEY'] -or $status['PUBLISHABLE_KEY'] -notmatch '^sb_publishable_') { throw 'Refusing May proof: no browser-safe local publishable key was found.' }
  $env:VITE_LOCAL_SUPABASE_PROJECT_REF='farmrxlocalsimplicity2027'; $env:VITE_LOCAL_SUPABASE_URL=$status['API_URL']; $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY=$status['PUBLISHABLE_KEY']

  npx playwright test --config playwright.season-may.config.ts
  if ($LASTEXITCODE -ne 0) { throw 'Maple May browser scenario failed.' }

  $after = $snapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($before -join "`n") -cne ($after -join "`n")) { throw 'Maple May changed an unrelated continuous-year table or row.' }
  Get-Content -Raw -LiteralPath $maySql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off
  if ($LASTEXITCODE -ne 0) { throw 'Maple May post-browser database assertions failed.' }
  Write-Output 'MAPLE_2027_MAY_DISPOSABLE_PASS'
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Pop-Location
}
