$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = 'farmrx-farmer-simplicity-2027-local'
$db = "supabase_db_$project"
$july = Join-Path $root 'scripts/verify-maple-july-disposable.ps1'
$julySql = Join-Path $root 'tests/season/maple-2027-july.verify.sql'
$credential = Join-Path $root 'scripts/maple-season-credential.ps1'
. $credential
Import-Module (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1') -Force
. (Join-Path $root 'scripts/maple-season-browser.ps1')

function Get-MapleToken([string]$PublishableKey) {
  $password = $env:FARMRX_SEASON_OWNER_PASSWORD; $body = $null; $response = $null
  try {
    if ($password -notmatch '^[0-9a-f]{64}$') { throw 'missing synthetic credential' }
    $body = @{ email = 'maple.owner@farmrx.local.test'; password = $password } | ConvertTo-Json -Compress
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:55321/auth/v1/token?grant_type=password' -Headers @{ apikey = $PublishableKey } -ContentType 'application/json' -Body $body -TimeoutSec 10
    $token = ($response.Content | ConvertFrom-Json -ErrorAction Stop).access_token
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'missing token' }; return [string]$token
  } catch { throw 'Maple August-December could not obtain a local synthetic owner token.' }
  finally { $password = $null; $body = $null; $response = $null }
}
function Invoke-MapleSql([string]$Path) { if (-not (Invoke-MapleSeasonSqlFile -Path $Path -ExpectedContainer $db)) { throw "Maple SQL verifier failed: $Path" } }
function Assert-MapleNovemberStep([string]$Step, [string]$Sql) {
  $result = @($Sql | docker exec -i $db psql -X -q -At -U postgres -d postgres -v ON_ERROR_STOP=1)
  if ($LASTEXITCODE -ne 0 -or ($result -join '') -cne 't') { throw "Maple November canonical SQL fence failed after $Step." }
}
function Get-MapleCanonicalSnapshot([string]$Phase = 'none') {
  if ($Phase -notin @('none','august','september','october','november-bin','november-in','november-contract','november-out','november-delivery')) { throw "Unknown Maple snapshot phase: $Phase" }
  $sql = @"
create temporary table maple_december_snapshot(table_name text primary key, state text);
do `$snapshot`$
declare r record; projection text; predicate text;
begin
  for r in select tablename from pg_tables where schemaname='public' order by tablename loop
    projection := 'to_jsonb(t)'; predicate := '';
    if '$Phase' = 'august' and r.tablename = 'farm_tasks' then projection := 'to_jsonb(t) - array[''status'',''completed_by'',''completed_at'',''updated_at'']'; end if;
    if '$Phase' = 'september' and r.tablename = 'crop_assignments' then projection := 'to_jsonb(t) - array[''harvested_bushels'',''harvest_date'',''actual_price_per_bu'',''version'',''updated_at'']'; end if;
    if '$Phase' = 'september' and r.tablename = 'repository_write_receipts' then predicate := 'where operation_id <> ''27030000-0000-4000-8000-000000000001'''; end if;
    if '$Phase' = 'october' and r.tablename = 'production_estimates' then predicate := 'where id <> ''27070000-0000-4000-8000-000000000001'''; end if;
    if '$Phase' = 'november-bin' and r.tablename = 'grain_bins' then predicate := 'where id <> ''27073000-0000-4000-8000-000000000001'''; end if;
    if '$Phase' = 'november-in' and r.tablename = 'bin_transactions' then predicate := 'where id <> ''27074000-0000-4000-8000-000000000000'''; end if;
    if '$Phase' = 'november-contract' and r.tablename = 'grain_contracts' then predicate := 'where id <> ''27071000-0000-4000-8000-000000000001'''; end if;
    if '$Phase' = 'november-out' and r.tablename = 'bin_transactions' then predicate := 'where id <> ''27074000-0000-4000-8000-000000000001'''; end if;
    if '$Phase' = 'november-delivery' and r.tablename = 'grain_contract_deliveries' then predicate := 'where id <> ''27072000-0000-4000-8000-000000000001'''; end if;
    execute format('insert into maple_december_snapshot select %L, coalesce(jsonb_agg(%s order by (%s)::text), ''[]''::jsonb)::text from public.%I t %s', r.tablename, projection, projection, r.tablename, predicate);
  end loop;
end
`$snapshot`$;
select coalesce(string_agg(table_name || '|' || state, E'\n' order by table_name), '') from maple_december_snapshot;
"@
  $result = @($sql | docker exec -i $db psql -X -q -At -U postgres -d postgres -v ON_ERROR_STOP=1)
  if ($LASTEXITCODE -ne 0) { throw 'Could not capture Maple canonical read-only snapshot.' }; return ($result -join "`n")
}
function Assert-MapleSnapshot([string]$Expected, [string]$Phase, [string]$Step) {
  $actual = Get-MapleCanonicalSnapshot $Phase
  if ($Expected -cne $actual) {
    $before = @{}; $after = @{}
    foreach ($line in ($Expected -split "`n")) { $separator = $line.IndexOf('|'); if ($separator -gt 0) { $before[$line.Substring(0,$separator)] = $line.Substring($separator + 1) } }
    foreach ($line in ($actual -split "`n")) { $separator = $line.IndexOf('|'); if ($separator -gt 0) { $after[$line.Substring(0,$separator)] = $line.Substring($separator + 1) } }
    $changed = @($before.Keys + $after.Keys | Sort-Object -Unique | Where-Object { $before[$_] -cne $after[$_] })
    throw "Maple $Phase changed canonical state outside the allowed row delta after $Step. Changed tables: $($changed -join ', ')."
  }
}
function Assert-MaplePortFree {
  $listeners = @(Get-NetTCPConnection -LocalPort 4280 -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -ne 0) { throw 'Maple August-December governed loopback port 4280 is already listening.' }
}
function Invoke-MaplePhase([string]$Name, [string]$FrozenUtc, [string]$ClientInstant, [string]$WriteTag, [string]$PhoneTag, [string]$SqlPath, [bool]$ReadOnly) {
  Assert-MaplePortFree
  $action = {
    $before = Get-MapleCanonicalSnapshot $Name
    $prior = [Environment]::GetEnvironmentVariable('FARMRX_MAPLE_CLIENT_INSTANT', [EnvironmentVariableTarget]::Process)
    try {
      [Environment]::SetEnvironmentVariable('FARMRX_MAPLE_CLIENT_INSTANT', $ClientInstant, [EnvironmentVariableTarget]::Process)
      if (-not $ReadOnly) { Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-august-december.config.ts' -Scenario "Maple $Name desktop" -Grep $WriteTag }
      if ($SqlPath) { Invoke-MapleSql $SqlPath }
      if ($PhoneTag) { Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-august-december.config.ts' -Scenario "Maple $Name phone" -Grep $PhoneTag }
      if ($SqlPath) { Invoke-MapleSql $SqlPath }
      Assert-MapleSnapshot $before $Name 'desktop, SQL, and phone proof'
      $true
    } finally { [Environment]::SetEnvironmentVariable('FARMRX_MAPLE_CLIENT_INSTANT', $prior, [EnvironmentVariableTarget]::Process) }
  }.GetNewClosure()
  $result = @(Invoke-HarvestRidgeClockPhase -Root $root -Phase "maple-$Name" -FrozenInstant $FrozenUtc -ApiUrl $boundary.ApiUrl -PublishableKey $boundary.PublishableKey -AccessToken $token -ProofFarmId '27010000-0000-4000-8000-000000000001' -ProofFarmName 'Maple Ridge' -Action $action)
  foreach ($line in @($result | Where-Object { $_ -is [string] })) { Write-Output $line }
  if ($result[-1] -ne $true) { throw "Maple $Name clock phase did not return exact success." }
  Assert-MaplePortFree
}
function Invoke-MapleNovemberPhase {
  Assert-MaplePortFree
  $action = {
    $prior = [Environment]::GetEnvironmentVariable('FARMRX_MAPLE_CLIENT_INSTANT', [EnvironmentVariableTarget]::Process)
    try {
      [Environment]::SetEnvironmentVariable('FARMRX_MAPLE_CLIENT_INSTANT', '2027-11-10T11:25:00-06:00', [EnvironmentVariableTarget]::Process)
      $before = Get-MapleCanonicalSnapshot 'november-bin'
      Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-august-december.config.ts' -Scenario 'Maple November bin' -Grep '@maple-november-bin'
      Assert-MapleNovemberStep 'bin' "select (select count(*) from public.grain_bins where id='27073000-0000-4000-8000-000000000001' and name='Maple North Bin' and capacity_bu=40000 and location_type='on_farm' and location_name='Maple Ridge')=1 and not exists(select 1 from public.bin_transactions) and not exists(select 1 from public.grain_contracts);"
      Assert-MapleSnapshot $before 'november-bin' 'bin'
      $before = Get-MapleCanonicalSnapshot 'november-in'
      Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-august-december.config.ts' -Scenario 'Maple November inbound' -Grep '@maple-november-in'
      Assert-MapleNovemberStep 'in' "select (select count(*) from public.bin_transactions where id='27074000-0000-4000-8000-000000000000' and direction='in' and bushels=30800)=1 and not exists(select 1 from public.grain_contracts) and not exists(select 1 from public.grain_contract_deliveries);"
      Assert-MapleSnapshot $before 'november-in' 'inbound movement'
      $before = Get-MapleCanonicalSnapshot 'november-contract'
      Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-august-december.config.ts' -Scenario 'Maple November contract' -Grep '@maple-november-contract'
      Assert-MapleNovemberStep 'contract' "select (select count(*) from public.grain_contracts where id='27071000-0000-4000-8000-000000000001' and contract_type='cash_spot' and buyer='Synthetic Elevator' and bushels=5000 and cash_price=4.25 and delivery_start='2027-11-10' and delivery_end='2027-12-15' and contract_number='MR-2027-001' and premium_cents_per_bu=0 and notes is null)=1 and (select count(*) from public.bin_transactions)=1 and not exists(select 1 from public.grain_contract_deliveries);"
      Assert-MapleSnapshot $before 'november-contract' 'contract'
      $before = Get-MapleCanonicalSnapshot 'november-out'
      Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-august-december.config.ts' -Scenario 'Maple November outbound' -Grep '@maple-november-out'
      Assert-MapleNovemberStep 'out' "select (select count(*) from public.bin_transactions where grain_bin_id='27073000-0000-4000-8000-000000000001')=2 and (select coalesce(sum(case direction when 'in' then bushels else -bushels end),0) from public.bin_transactions where grain_bin_id='27073000-0000-4000-8000-000000000001')=25800 and not exists(select 1 from public.grain_contract_deliveries);"
      Assert-MapleSnapshot $before 'november-out' 'outbound movement'
      $before = Get-MapleCanonicalSnapshot 'november-delivery'
      Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-august-december.config.ts' -Scenario 'Maple November delivery' -Grep '@maple-november-delivery'
      Invoke-MapleSql (Join-Path $root 'tests/season/maple-2027-november.verify.sql')
      Assert-MapleSnapshot $before 'november-delivery' 'contract delivery'
      $before = Get-MapleCanonicalSnapshot
      Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-august-december.config.ts' -Scenario 'Maple November phone' -Grep '@maple-november-phone'
      Invoke-MapleSql (Join-Path $root 'tests/season/maple-2027-november.verify.sql')
      Assert-MapleSnapshot $before 'none' 'phone proof'
      $true
    } finally { [Environment]::SetEnvironmentVariable('FARMRX_MAPLE_CLIENT_INSTANT', $prior, [EnvironmentVariableTarget]::Process) }
  }.GetNewClosure()
  $result = @(Invoke-HarvestRidgeClockPhase -Root $root -Phase 'maple-november' -FrozenInstant '2027-11-10 17:25:00+00:00' -ApiUrl $boundary.ApiUrl -PublishableKey $boundary.PublishableKey -AccessToken $token -ProofFarmId '27010000-0000-4000-8000-000000000001' -ProofFarmName 'Maple Ridge' -Action $action)
  foreach ($line in @($result | Where-Object { $_ -is [string] })) { Write-Output $line }
  if ($result[-1] -ne $true) { throw 'Maple November clock phase did not return exact success.' }
  Assert-MaplePortFree
}
function Invoke-MapleDecemberPhase {
  Assert-MaplePortFree
  $action = {
    $prior = [Environment]::GetEnvironmentVariable('FARMRX_MAPLE_CLIENT_INSTANT', [EnvironmentVariableTarget]::Process)
    try {
      [Environment]::SetEnvironmentVariable('FARMRX_MAPLE_CLIENT_INSTANT', '2027-12-15T09:30:00-06:00', [EnvironmentVariableTarget]::Process)
      $before = Get-MapleCanonicalSnapshot
      Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season-august-december.config.ts' -Scenario 'Maple December continuous reconciliation' -Grep '@maple-december-continuous'
      Invoke-MapleSql (Join-Path $root 'tests/season/maple-2027-december.verify.sql')
      $after = Get-MapleCanonicalSnapshot
      if ($before -cne $after) { throw 'Maple December continuous reconciliation changed canonical database state.' }
      $true
    } finally { [Environment]::SetEnvironmentVariable('FARMRX_MAPLE_CLIENT_INSTANT', $prior, [EnvironmentVariableTarget]::Process) }
  }.GetNewClosure()
  $result = @(Invoke-HarvestRidgeClockPhase -Root $root -Phase 'maple-december' -FrozenInstant '2027-12-15 15:30:00+00:00' -ApiUrl $boundary.ApiUrl -PublishableKey $boundary.PublishableKey -AccessToken $token -ProofFarmId '27010000-0000-4000-8000-000000000001' -ProofFarmName 'Maple Ridge' -Action $action)
  foreach ($line in @($result | Where-Object { $_ -is [string] })) { Write-Output $line }
  if ($result[-1] -ne $true) { throw 'Maple December clock phase did not return exact success.' }
  Assert-MaplePortFree
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for Maple August-December proof.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js/npm with npx is required for Maple August-December proof.' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }
$boundary = $null; $token = $null
Push-Location $root
try {
  Enter-MapleSeasonCredential
  & powershell -NoProfile -ExecutionPolicy Bypass -File $july
  if ($LASTEXITCODE -ne 0) { throw 'Accepted Maple July continuity prerequisite failed.' }
  $boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $project -ExpectedContainer $db
  Invoke-MapleSql $julySql
  $token = Get-MapleToken $boundary.PublishableKey
  $env:VITE_LOCAL_SUPABASE_PROJECT_REF = 'farmrxlocalsimplicity2027'; $env:VITE_LOCAL_SUPABASE_URL = $boundary.ApiUrl; $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY = $boundary.PublishableKey
  Invoke-MaplePhase 'august' '2027-08-17 18:00:00+00:00' '2027-08-17T13:00:00-05:00' '@maple-august-write' '@maple-august-phone' (Join-Path $root 'tests/season/maple-2027-august.verify.sql') $false
  Invoke-MaplePhase 'september' '2027-09-28 23:05:00+00:00' '2027-09-28T18:05:00-05:00' '@maple-september-write' '@maple-september-phone' (Join-Path $root 'tests/season/maple-2027-september.verify.sql') $false
  Invoke-MaplePhase 'october' '2027-10-19 13:40:00+00:00' '2027-10-19T08:40:00-05:00' '@maple-october-write' '@maple-october-phone' (Join-Path $root 'tests/season/maple-2027-october.verify.sql') $false
  Invoke-MapleNovemberPhase
  Invoke-MapleDecemberPhase
  Write-Output 'MAPLE_2027_AUGUST_DECEMBER_DISPOSABLE_PASS'
} finally {
  $token = $null; Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue; Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue; Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue; Remove-Item Env:FARMRX_MAPLE_CLIENT_INSTANT -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential; $boundary = $null; Pop-Location
}
