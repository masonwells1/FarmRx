$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$expectedParkedContainer = "$expectedContainer-ordinary-parked"
$frozenInstant = '2027-07-09 21:10:00+00:00'
$mapleFarmId = '27010000-0000-4000-8000-000000000001'
$mapleFarmName = 'Maple Ridge'
$juneProof = Join-Path $root 'scripts/verify-maple-june-disposable.ps1'
$juneSql = Join-Path $root 'tests/season/maple-2027-june.verify.sql'
$julySql = Join-Path $root 'tests/season/maple-2027-july.verify.sql'
$credentialHelperPath = Join-Path $root 'scripts/maple-season-credential.ps1'

. $credentialHelperPath
Import-Module (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1') -Force

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
$scoutingFailureDiagnosticSql = @'
select count(*)::text||'|'||coalesce(string_agg(id::text||'|'||farm_id::text||'|'||field_id::text||'|'||observed_on::text||'|'||category||'|'||created_by::text, ',' order by id),'')
from public.scouting_notes;
'@

function Get-MapleJulyAccessToken([string]$PublishableKey) {
  $password = $env:FARMRX_SEASON_OWNER_PASSWORD
  $payload = $null
  $response = $null
  try {
    if ($password -notmatch '^[0-9a-f]{64}$') { throw 'missing synthetic credential' }
    $payload = @{ email = 'maple.owner@farmrx.local.test'; password = $password } | ConvertTo-Json -Compress
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:55321/auth/v1/token?grant_type=password' -Headers @{ apikey = $PublishableKey } -ContentType 'application/json' -Body $payload -TimeoutSec 10
    $token = ($response.Content | ConvertFrom-Json -ErrorAction Stop).access_token
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'missing access token' }
    return [string]$token
  } catch {
    throw 'Maple July could not obtain a synthetic loopback owner token.'
  } finally {
    $password = $null
    $payload = $null
    $response = $null
  }
}

function Assert-MapleJulyNoClockResidue {
  $priorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $ordinary = @(docker inspect --type container --format '{{.Id}}|{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{.HostConfig.RestartPolicy.Name}}' $expectedContainer 2>$null)
    $ordinaryExit = $LASTEXITCODE
    docker inspect --type container $expectedParkedContainer 2>$null | Out-Null
    $parkedExists = $LASTEXITCODE -eq 0
    $images = @(docker image ls --format '{{.Repository}}:{{.Tag}}' | Where-Object { $_ -match '^farmrx-(?:clock-snapshot|frozen-clock-swap):' })
  } finally {
    $ErrorActionPreference = $priorPreference
  }
  $journal = Join-Path ([IO.Path]::GetTempPath()) 'farmrx-harvest-ridge-clock-maple-july.json'
  if ($ordinaryExit -ne 0 -or $ordinary.Count -ne 1 -or $ordinary[0] -notmatch '^[0-9a-f]{64}\|sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770\|true\|healthy\|unless-stopped$' -or $parkedExists -or $images.Count -ne 0 -or [IO.File]::Exists($journal)) {
    throw 'MAPLE_2027_JULY_CLOCK_RECOVERY_INCOMPLETE: swapped, parked, image, journal, or restart-policy residue remains.'
  }
}

function Assert-MapleJulySeasonPortsAvailable([hashtable]$Ports) {
  foreach ($name in $Ports.Keys) {
    $port = [int]$Ports[$name]
    $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 0) {
      throw "Maple July requires its isolated loopback port $port, but it is already listening."
    }
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the Maple July proof.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js/npm with npx is required for the Maple July browser proof.' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }
$boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $expectedProjectId -ExpectedContainer $expectedContainer
$clockPhaseStarted = $false
$token = $null
$seasonPorts = [ordered]@{
  FARMRX_SEASON_JANUARY_PORT = '4274'
  FARMRX_SEASON_MARCH_PORT = '4275'
  FARMRX_SEASON_APRIL_PORT = '4276'
  FARMRX_SEASON_MAY_PORT = '4277'
  FARMRX_SEASON_JUNE_PORT = '4278'
  FARMRX_SEASON_JULY_PORT = '4279'
}
$priorSeasonPorts = @{}

Push-Location $root
try {
  Assert-MapleJulySeasonPortsAvailable $seasonPorts
  foreach ($name in $seasonPorts.Keys) {
    $priorSeasonPorts[$name] = [Environment]::GetEnvironmentVariable($name, [EnvironmentVariableTarget]::Process)
    [Environment]::SetEnvironmentVariable($name, $seasonPorts[$name], [EnvironmentVariableTarget]::Process)
  }
  Enter-MapleSeasonCredential
  # June invokes May through January. January remains the sole reset owner;
  # the governed frozen clock must not begin until this ordinary-time chain passes.
  & powershell -NoProfile -ExecutionPolicy Bypass -File $juneProof
  if ($LASTEXITCODE -ne 0) { throw 'Continuous Maple January-June prerequisite failed.' }
  $running = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $running -notcontains $expectedContainer) { throw "Refusing July proof: expected disposable database container $expectedContainer is not running." }
  if (-not (Invoke-MapleSeasonSqlFile -Path $juneSql -ExpectedContainer $expectedContainer)) { throw 'June database proof did not pass immediately before July.' }
  $pre = $junePreconditionSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($pre -join '') -cne 'true') { throw "July prerequisite state is not exact: $($pre -join '')" }

  $env:DO_NOT_TRACK = '1'
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $statusLines = @(& $supabase --profile supabase status -o env 2>$null); $statusExit = $LASTEXITCODE } finally { $ErrorActionPreference = $oldPreference }
  if ($statusExit -ne 0) { throw 'Could not read disposable local Supabase browser configuration.' }
  $status = @{}
  foreach ($line in $statusLines) { if ($line -match '^([A-Z0-9_]+)="?(.*?)"?$') { $status[$matches[1]] = $matches[2] } }
  if ($status['API_URL'] -cne 'http://127.0.0.1:55321') { throw 'Refusing July proof: local API URL is not the expected loopback endpoint.' }
  if (-not $status['PUBLISHABLE_KEY'] -or $status['PUBLISHABLE_KEY'] -notmatch '^sb_publishable_') { throw 'Refusing July proof: no browser-safe local publishable key was found.' }
  $token = Get-MapleJulyAccessToken $status['PUBLISHABLE_KEY']
  $env:VITE_LOCAL_SUPABASE_PROJECT_REF = 'farmrxlocalsimplicity2027'
  $env:VITE_LOCAL_SUPABASE_URL = $status['API_URL']
  $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY = $status['PUBLISHABLE_KEY']

  $frozenAction = {
    . $credentialHelperPath
    . (Join-Path $root 'scripts/maple-season-browser.ps1')
    $beforeScouting = $scoutingSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
    if ($LASTEXITCODE -ne 0 -or -not $beforeScouting) { throw 'Could not capture the pre-scouting canonical snapshot.' }
    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-july.config.ts' -Scenario 'Maple July scouting' -Grep '@july-scouting-write'
    $afterScouting = $scoutingSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
    if ($LASTEXITCODE -ne 0 -or ($beforeScouting -join "`n") -cne ($afterScouting -join "`n")) { throw 'Maple July scouting changed a row outside its exact note and receipt allowance.' }
    $scoutingPost = $postScoutingSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
    if ($LASTEXITCODE -ne 0 -or ($scoutingPost -join '') -cne 'true') {
      $scoutingDiagnostic = $scoutingFailureDiagnosticSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
      if ($LASTEXITCODE -ne 0) { throw 'Maple July scouting post-action state is not exact and its bounded diagnostic could not run.' }
      throw "Maple July scouting post-action state is not exact: $($scoutingDiagnostic -join '')"
    }

    $beforeTask = $taskSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
    if ($LASTEXITCODE -ne 0 -or -not $beforeTask) { throw 'Could not capture the pre-task canonical snapshot.' }
    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-july.config.ts' -Scenario 'Maple July task' -Grep '@july-task-write'
    $afterTask = $taskSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
    if ($LASTEXITCODE -ne 0 -or ($beforeTask -join "`n") -cne ($afterTask -join "`n")) { throw 'Maple July task changed a row outside its exact manual-task allowance.' }
    if (-not (Invoke-MapleSeasonSqlFile -Path $julySql -ExpectedContainer $expectedContainer)) { throw 'Maple July post-browser database assertions failed.' }

    $beforePhone = $taskSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
    if ($LASTEXITCODE -ne 0 -or -not $beforePhone) { throw 'Could not capture the pre-phone canonical snapshot.' }
    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-july.config.ts' -Scenario 'Maple July phone read-only' -Grep '@july-read-only'
    $afterPhone = $taskSnapshotSql | docker exec -i $expectedContainer psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At
    if ($LASTEXITCODE -ne 0 -or ($beforePhone -join "`n") -cne ($afterPhone -join "`n")) { throw 'Maple July phone read-only check changed canonical database state.' }
    return $true
  }.GetNewClosure()

  $clockPhaseStarted = $true
  $result = @(Invoke-HarvestRidgeClockPhase -Root $root -Phase 'maple-july' -FrozenInstant $frozenInstant -ApiUrl $boundary.ApiUrl -PublishableKey $status['PUBLISHABLE_KEY'] -AccessToken $token -ProofFarmId $mapleFarmId -ProofFarmName $mapleFarmName -Action $frozenAction)
  foreach ($line in @($result | Where-Object { $_ -is [string] })) { Write-Output $line }
  if ($result[-1] -ne $true) { throw 'Maple July governed clock phase did not return exact success.' }
  Write-Output 'MAPLE_2027_JULY_DISPOSABLE_PASS'
} finally {
  $token = $null
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  foreach ($name in $seasonPorts.Keys) {
    [Environment]::SetEnvironmentVariable($name, $priorSeasonPorts[$name], [EnvironmentVariableTarget]::Process)
  }
  Exit-MapleSeasonCredential
  try {
    if ($clockPhaseStarted) { Assert-MapleJulyNoClockResidue }
  } finally {
    $boundary = $null
    Pop-Location
  }
}
