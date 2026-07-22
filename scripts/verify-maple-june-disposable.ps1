$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$mayProof = Join-Path $root 'scripts/verify-maple-may-disposable.ps1'
$maySql = Join-Path $root 'tests/season/maple-2027-may.verify.sql'
$juneSql = Join-Path $root 'tests/season/maple-2027-june.verify.sql'
$credentialHelperPath = Join-Path $root 'scripts/maple-season-credential.ps1'

. $credentialHelperPath
$snapshotSql = @'
create temporary table season_june_snapshot(table_name text primary key, state jsonb);
do $snapshot$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public'
    and tablename not in ('application_records','application_products','inventory_on_hand') order by tablename
  loop
    execute format('insert into season_june_snapshot select %L, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from public.%I t', r.tablename, r.tablename);
  end loop;
end
$snapshot$;
insert into season_june_snapshot select 'application_records:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
from public.application_records t where id <> '27043000-0000-4000-8000-000000000000';
insert into season_june_snapshot select 'application_products:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
from public.application_products t where id <> '27044000-0000-4000-8000-000000000000';
insert into season_june_snapshot select 'inventory_on_hand:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
from public.inventory_on_hand t where not (farm_id='27010000-0000-4000-8000-000000000001' and product_id='27040000-0000-4000-8000-000000000000');
insert into season_june_snapshot select 'inventory_on_hand:target-normalized', coalesce(jsonb_agg(to_jsonb(t)-array['used_quantity','on_hand_quantity'] order by product_id),'[]'::jsonb)
from public.inventory_on_hand t where farm_id='27010000-0000-4000-8000-000000000001' and product_id='27040000-0000-4000-8000-000000000000';
select jsonb_object_agg(table_name,state order by table_name)::text from season_june_snapshot;
'@
$preconditionSql = @'
select (
  (select count(*) from public.repository_write_receipts where farm_id='27010000-0000-4000-8000-000000000001' and user_id='27000000-0000-4000-8000-000000000001')=9
  and (select count(*) from public.application_records)=1
  and (select count(*) from public.application_products)=0
  and (select status from public.application_records where id='27054000-0000-4000-8000-000000000001')='draft'
  and (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000001' and product_id='27040000-0000-4000-8000-000000000000')=100.0000
)::text;
'@

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the Maple June proof.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js/npm with npx is required for the Maple June browser proof.' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }
$boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $expectedProjectId -ExpectedContainer $expectedContainer

Push-Location $root
try {
  Enter-MapleSeasonCredential
  # May invokes April -> March -> February -> January. January remains the sole reset owner.
  & powershell -NoProfile -ExecutionPolicy Bypass -File $mayProof
  if ($LASTEXITCODE -ne 0) { throw 'Continuous Maple January-May prerequisite failed.' }
  $running = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $running -notcontains $expectedContainer) { throw "Refusing June proof: expected disposable database container $expectedContainer is not running." }
  if (-not (Invoke-MapleSeasonSqlFile -Path $maySql -ExpectedContainer $expectedContainer)) { throw 'May database proof did not pass immediately before June.' }
  $pre = $preconditionSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($pre -join '') -cne 'true') { throw "June prerequisite state is not exact: $($pre -join '')" }
  $before = $snapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $before) { throw 'Could not execute the pre-June full unrelated-state snapshot.' }

  $env:DO_NOT_TRACK='1'; $oldPreference=$ErrorActionPreference; $ErrorActionPreference='Continue'
  try { $statusLines=@(& $supabase --profile supabase status -o env 2>$null); $statusExit=$LASTEXITCODE } finally { $ErrorActionPreference=$oldPreference }
  if ($statusExit -ne 0) { throw 'Could not read disposable local Supabase browser configuration.' }
  $status=@{}; foreach($line in $statusLines){ if($line -match '^([A-Z0-9_]+)="?(.*?)"?$'){ $status[$matches[1]]=$matches[2] } }
  if ($status['API_URL'] -ne 'http://127.0.0.1:55321') { throw 'Refusing June proof: local API URL is not the expected loopback endpoint.' }
  if (-not $status['PUBLISHABLE_KEY'] -or $status['PUBLISHABLE_KEY'] -notmatch '^sb_publishable_') { throw 'Refusing June proof: no browser-safe local publishable key was found.' }
  $env:VITE_LOCAL_SUPABASE_PROJECT_REF='farmrxlocalsimplicity2027'; $env:VITE_LOCAL_SUPABASE_URL=$status['API_URL']; $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY=$status['PUBLISHABLE_KEY']
  npx playwright test --config playwright.season-june.config.ts
  if ($LASTEXITCODE -ne 0) { throw 'Maple June browser scenario failed.' }

  $after = $snapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $after) { throw 'Could not execute the post-June full unrelated-state snapshot.' }
  if (($before -join "`n") -cne ($after -join "`n")) { throw 'Maple June changed a row outside the exact application, application product, or derived on-hand allowance.' }
  if (-not (Invoke-MapleSeasonSqlFile -Path $juneSql -ExpectedContainer $expectedContainer)) { throw 'Maple June post-browser database assertions failed.' }
  Write-Output 'MAPLE_2027_JUNE_DISPOSABLE_PASS'
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  $boundary = $null
  Pop-Location
}
