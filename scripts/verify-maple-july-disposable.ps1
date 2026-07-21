$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$juneProof = Join-Path $root 'scripts/verify-maple-june-disposable.ps1'
$juneSql = Join-Path $root 'tests/season/maple-2027-june.verify.sql'
$julySql = Join-Path $root 'tests/season/maple-2027-july.verify.sql'
$credentialHelperPath = Join-Path $root 'scripts/maple-season-credential.ps1'

. $credentialHelperPath

# This does not set time, patch a row, replace a product function, or weaken a
# constraint.  An external, governed disposable-stack clock seam must make
# Postgres itself report this exact instant before the continuous chain starts.
$clockPreflightSql = @'
select (
  current_date = date '2027-07-09'
  and date_trunc('second', clock_timestamp()) = timestamptz '2027-07-09 21:10:00+00'
  and date_trunc('second', statement_timestamp()) = timestamptz '2027-07-09 21:10:00+00'
)::text;
'@
$junePreconditionSql = @'
select (
  (select count(*) from public.repository_write_receipts where farm_id='27010000-0000-4000-8000-000000000001' and user_id='27000000-0000-4000-8000-000000000001')=9
  and (select count(*) from public.application_records)=2
  and (select count(*) from public.application_products)=1
  and (select count(*) from public.farm_tasks)=0
  and (select count(*) from public.scouting_notes)=0
  and (select count(*) from public.scouting_photos)=0
  and (select count(*) from public.notifications)=0
  and (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000001' and product_id='27040000-0000-4000-8000-000000000000')=90.0000
)::text;
'@
$scoutingSnapshotSql = @'
create temporary table season_july_scouting_snapshot(table_name text primary key, state jsonb);
do $snapshot$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public'
    and tablename not in ('scouting_notes','repository_write_receipts') order by tablename
  loop
    execute format('insert into season_july_scouting_snapshot select %L, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from public.%I t', r.tablename, r.tablename);
  end loop;
end
$snapshot$;
insert into season_july_scouting_snapshot
select 'scouting_notes:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb)
from public.scouting_notes t where id <> '27060000-0000-4000-8000-000000000001';
insert into season_july_scouting_snapshot
select 'repository_write_receipts:prior', coalesce(jsonb_agg(to_jsonb(t) order by farm_id, operation_id), '[]'::jsonb)
from public.repository_write_receipts t where not (farm_id='27010000-0000-4000-8000-000000000001' and operation_id='27ff0000-0000-4000-8000-000000000007');
select jsonb_object_agg(table_name,state order by table_name)::text from season_july_scouting_snapshot;
'@
$taskSnapshotSql = @'
create temporary table season_july_task_snapshot(table_name text primary key, state jsonb);
do $snapshot$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public' and tablename <> 'farm_tasks' order by tablename
  loop
    execute format('insert into season_july_task_snapshot select %L, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from public.%I t', r.tablename, r.tablename);
  end loop;
end
$snapshot$;
insert into season_july_task_snapshot
select 'farm_tasks:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by id), '[]'::jsonb)
from public.farm_tasks t where id <> '27061000-0000-4000-8000-000000000001';
select jsonb_object_agg(table_name,state order by table_name)::text from season_july_task_snapshot;
'@
$postScoutingSql = @'
select (
  (select count(*) from public.scouting_notes)=1
  and (select count(*) from public.scouting_photos)=0
  and (select count(*) from public.farm_tasks)=0
  and (select count(*) from public.notifications)=0
  and exists (select 1 from public.scouting_notes where id='27060000-0000-4000-8000-000000000001' and farm_id='27010000-0000-4000-8000-000000000001'
    and field_id='27020000-0000-4000-8000-000000000001' and observed_on=date '2027-07-09' and category='weed'
    and note='Synthetic waterhemp at south gate' and latitude is null and longitude is null and created_by='27000000-0000-4000-8000-000000000001')
)::text;
'@

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the Maple July proof.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js/npm with npx is required for the Maple July browser proof.' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }
$boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $expectedProjectId -ExpectedContainer $expectedContainer

Push-Location $root
try {
  Enter-MapleSeasonCredential
  $running = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $running -notcontains $expectedContainer) { throw "Refusing July proof: expected disposable database container $expectedContainer is not running." }
  $clock = $clockPreflightSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($clock -join '') -cne 'true') {
    throw 'MAPLE_2027_JULY_BLOCKED: configure the governed disposable database-clock seam so Postgres current_date, statement_timestamp(), and clock_timestamp() are exactly 2027-07-09 / 2027-07-09T21:10:00Z before any browser mutation. This runner will not patch output rows or replace production database behavior.'
  }

  # June invokes May through January. January remains the sole reset owner.
  & powershell -NoProfile -ExecutionPolicy Bypass -File $juneProof
  if ($LASTEXITCODE -ne 0) { throw 'Continuous Maple January-June prerequisite failed.' }
  if (-not (Invoke-MapleSeasonSqlFile -Path $juneSql -ExpectedContainer $expectedContainer)) { throw 'June database proof did not pass immediately before July.' }
  $pre = $junePreconditionSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($pre -join '') -cne 'true') { throw "July prerequisite state is not exact: $($pre -join '')" }

  $env:DO_NOT_TRACK='1'; $oldPreference=$ErrorActionPreference; $ErrorActionPreference='Continue'
  try { $statusLines=@(& $supabase --profile supabase status -o env 2>$null); $statusExit=$LASTEXITCODE } finally { $ErrorActionPreference=$oldPreference }
  if ($statusExit -ne 0) { throw 'Could not read disposable local Supabase browser configuration.' }
  $status=@{}; foreach($line in $statusLines){ if($line -match '^([A-Z0-9_]+)="?(.*?)"?$'){ $status[$matches[1]]=$matches[2] } }
  if ($status['API_URL'] -ne 'http://127.0.0.1:55321') { throw 'Refusing July proof: local API URL is not the expected loopback endpoint.' }
  if (-not $status['PUBLISHABLE_KEY'] -or $status['PUBLISHABLE_KEY'] -notmatch '^sb_publishable_') { throw 'Refusing July proof: no browser-safe local publishable key was found.' }
  $env:VITE_LOCAL_SUPABASE_PROJECT_REF='farmrxlocalsimplicity2027'; $env:VITE_LOCAL_SUPABASE_URL=$status['API_URL']; $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY=$status['PUBLISHABLE_KEY']

  $beforeScouting = $scoutingSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $beforeScouting) { throw 'Could not capture the pre-scouting canonical snapshot.' }
  npx playwright test --config playwright.season-july.config.ts --grep '@july-scouting-write'
  if ($LASTEXITCODE -ne 0) { throw 'Maple July scouting browser scenario failed.' }
  $afterScouting = $scoutingSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($beforeScouting -join "`n") -cne ($afterScouting -join "`n")) { throw 'Maple July scouting changed a row outside its exact note and receipt allowance.' }
  $scoutingPost = $postScoutingSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($scoutingPost -join '') -cne 'true') { throw 'Maple July scouting post-action state is not exact.' }

  $beforeTask = $taskSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $beforeTask) { throw 'Could not capture the pre-task canonical snapshot.' }
  npx playwright test --config playwright.season-july.config.ts --grep '@july-task-write'
  if ($LASTEXITCODE -ne 0) { throw 'Maple July task browser scenario failed.' }
  $afterTask = $taskSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($beforeTask -join "`n") -cne ($afterTask -join "`n")) { throw 'Maple July task changed a row outside its exact manual-task allowance.' }
  if (-not (Invoke-MapleSeasonSqlFile -Path $julySql -ExpectedContainer $expectedContainer)) { throw 'Maple July post-browser database assertions failed.' }

  $beforePhone = $taskSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $beforePhone) { throw 'Could not capture the pre-phone canonical snapshot.' }
  npx playwright test --config playwright.season-july.config.ts --grep '@july-read-only'
  if ($LASTEXITCODE -ne 0) { throw 'Maple July phone read-only scenario failed.' }
  $afterPhone = $taskSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($beforePhone -join "`n") -cne ($afterPhone -join "`n")) { throw 'Maple July phone read-only check changed canonical database state.' }
  Write-Output 'MAPLE_2027_JULY_DISPOSABLE_PASS'
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  $boundary = $null
  Pop-Location
}
