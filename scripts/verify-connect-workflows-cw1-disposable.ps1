param([switch]$StaticOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = 'farmrx-farmer-simplicity-2027-local'
$db = "supabase_db_$project"
$gateway = "supabase_kong_$project"
$manifestPath = Join-Path $root 'tests/season/season-2027.manifest.json'
$contractPath = Join-Path $root 'docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md'
$fixture = Join-Path $root 'tests/season/cedar-creek-2027-start.sql'
$verify = Join-Path $root 'tests/season/connect-workflows-cw1.verify.sql'
$specPath = Join-Path $root 'tests/e2e/season/cedar-creek.spec.ts'
$configPath = Join-Path $root 'playwright.connect-workflows-cw1.config.ts'
$migration = '20260725213142_pine_hill_removed_farm_epoch.sql'
$migrationBlob = '89f432cdfc9a2cd6c6379309e0eb1bd283500686'
$migrationHead = '20260820135357_add_program_inventory_match_fk_indexes.sql'
$migrationHeadSha256 = 'bf6fbc84c5389e1122ce7ccf63c37dacb2dfc21d881216bbbb5241b203fa5589'
. (Join-Path $root 'scripts/maple-season-credential.ps1')
Import-Module (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1') -Force

function Assert-Cw1Contract {
  $required = @(
    $manifestPath,
    $contractPath,
    $fixture,
    $verify,
    $specPath,
    $configPath,
    (Join-Path $root 'src/WeatherModule.tsx'),
    (Join-Path $root 'src/InventoryModule.tsx'),
    (Join-Path $root 'src/data/weatherSprayHandoff.ts'),
    (Join-Path $root 'scripts/maple-season-credential.ps1'),
    (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1')
  )
  if (@($required | Where-Object { -not (Test-Path -LiteralPath $_) }).Count) { throw 'CONNECT_WORKFLOWS_CW1_PACKET_MISSING_REQUIRED_FILE' }
  if (-not (Test-Path -LiteralPath (Join-Path $root "supabase/migrations/$migrationHead"))) { throw "CONNECT_WORKFLOWS_CW1_MIGRATION_MISSING:$migrationHead" }
  if ((Get-FileHash -LiteralPath (Join-Path $root "supabase/migrations/$migrationHead") -Algorithm SHA256).Hash.ToLowerInvariant() -cne $migrationHeadSha256) { throw 'CONNECT_WORKFLOWS_CW1_MIGRATION_HASH_MISMATCH' }
  $actualBlob = (& git -C $root hash-object (Join-Path $root "supabase/migrations/$migration")).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualBlob -cne $migrationBlob) { throw 'CONNECT_WORKFLOWS_CW1_MIGRATION_BLOB_MISMATCH' }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  foreach ($identity in @(
    @{ Label = 'Cedar completed application record'; Uuid = '27043000-0000-4000-8000-000000000005' },
    @{ Label = 'Cedar completed application product'; Uuid = '27044000-0000-4000-8000-000000000005' }
  )) {
    if (@($manifest.fixtures | Where-Object { $_.label -ceq $identity.Label -and $_.uuid -ceq $identity.Uuid }).Count -ne 1) { throw "CONNECT_WORKFLOWS_CW1_MANIFEST_IDENTITY_MISMATCH:$($identity.Label)" }
  }
  $contract = Get-Content -Raw -LiteralPath $contractPath
  foreach ($needle in @(
    '| Cedar completed application record | `27043000-0000-4000-8000-000000000005` |',
    '| Cedar completed application product | `27044000-0000-4000-8000-000000000005` |'
  )) {
    if ($contract -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW1_SCENARIO_IDENTITY_MISMATCH:$needle" }
  }
  $spec = Get-Content -Raw -LiteralPath $specPath
  foreach ($needle in @(
    "test('@connect-workflows-cw1 weather prefill stays local until the farmer saves'",
    'Start spray record with this weather',
    'save_inventory_application_bundle',
    'await page.evaluate(() => window.__cedarArmInventory?.())',
    "await spray.getByLabel('Wind mph').fill('9')",
    "await spray.getByLabel('Wind direction').selectOption('W')",
    "await spray.getByLabel('Temperature °F').fill('75')",
    'await page.reload()',
    "['4186','4187','55321'].includes(url.port)"
  )) {
    if ($spec -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW1_STATIC_CONTRACT_MISSING:$needle" }
  }
  $config = Get-Content -Raw -LiteralPath $configPath
  foreach ($needle in @('grep: /@connect-workflows-cw1/','workers: 1',"serviceWorkers: 'block'",'127.0.0.1:4187','FARMRX_CW1_VIEWPORT','width: 390, height: 844','width: 1440, height: 900')) {
    if ($config -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW1_CONFIG_CONTRACT_MISSING:$needle" }
  }
  Write-Output 'CONNECT_WORKFLOWS_CW1_STATIC_CONTRACT_PASS'
}

function Invoke-Cw1Sql([string]$Sql) {
  $out = @($Sql | docker exec -i $db psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "CONNECT_WORKFLOWS_CW1_SQL_FAILED:$([string]::Join("`n", [string[]]$out))" }
  [string]::Join("`n", [string[]]$out)
}

function Wait-Cw1Auth {
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
      $health = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:55321/auth/v1/health' -TimeoutSec 2
      if ($health.StatusCode -eq 200 -and $health.Content -match '"name"\s*:\s*"GoTrue"') { return }
    } catch {}
    if ($attempt -lt 30) { Start-Sleep -Milliseconds 500 }
  }
  throw 'CONNECT_WORKFLOWS_CW1_AUTH_NOT_HEALTHY'
}

function Reset-Cw1([string]$Supabase) {
  & $Supabase --profile supabase db reset --local --no-seed --yes
  if ($LASTEXITCODE -ne 0) { throw 'CONNECT_WORKFLOWS_CW1_LOCAL_RESET_FAILED' }
  $running = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $running -notcontains $gateway) { throw "CONNECT_WORKFLOWS_CW1_GATEWAY_NOT_EXACT:$gateway" }
  docker restart $gateway | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'CONNECT_WORKFLOWS_CW1_GATEWAY_REFRESH_FAILED' }
  Wait-Cw1Auth
  if (-not (Invoke-MapleSeasonSqlFile -Path $fixture -ExpectedContainer $db)) { throw 'CONNECT_WORKFLOWS_CW1_FIXTURE_FAILED' }
}

function Get-Cw1AccessToken([string]$PublishableKey) {
  $password = $env:FARMRX_SEASON_OWNER_PASSWORD
  if ($password -notmatch '^[0-9a-f]{64}$') { throw 'CONNECT_WORKFLOWS_CW1_SYNTHETIC_CREDENTIAL_UNAVAILABLE' }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:55321/auth/v1/token?grant_type=password' -Headers @{ apikey = $PublishableKey } -ContentType 'application/json' -Body (@{ email = 'cedar.owner@farmrx.local.test'; password = $password } | ConvertTo-Json -Compress) -TimeoutSec 10
    $token = ($response.Content | ConvertFrom-Json -ErrorAction Stop).access_token
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'missing token' }
    return [string]$token
  } catch {
    throw 'CONNECT_WORKFLOWS_CW1_SYNTHETIC_TOKEN_UNAVAILABLE'
  } finally {
    $password = $null
  }
}

function Assert-Cw1DeniedActor {
  $result = Invoke-Cw1Sql @'
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000006',true);
select set_config('request.headers','{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000006","x-farm-rx-access-epochs":"{}"}',true);
select count(*) from public.application_records where farm_id='27010000-0000-4000-8000-000000000005';
select count(*) from public.application_products where farm_id='27010000-0000-4000-8000-000000000005';
rollback;
'@
  $counts = @($result -split "`r?`n" | Where-Object { $_ -match '^\d+$' })
  if ($counts.Count -lt 2 -or $counts[-2] -ne '0' -or $counts[-1] -ne '0') { throw 'CONNECT_WORKFLOWS_CW1_RLS_DENIED_ACTOR_READ_FAILED' }
}

$snapshotSql = @'
create temporary table cw1_snapshot(table_name text primary key, state jsonb);
do $snapshot$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public'
    and tablename not in ('application_records','application_products','inventory_on_hand') order by tablename
  loop
    execute format('insert into cw1_snapshot select %L, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from public.%I t', r.tablename, r.tablename);
  end loop;
end
$snapshot$;
insert into cw1_snapshot select 'application_records:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
from public.application_records t where id <> '27043000-0000-4000-8000-000000000005';
insert into cw1_snapshot select 'application_products:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
from public.application_products t where id <> '27044000-0000-4000-8000-000000000005';
insert into cw1_snapshot select 'inventory_on_hand:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)
from public.inventory_on_hand t where not (farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005');
insert into cw1_snapshot select 'inventory_on_hand:target-normalized', coalesce(jsonb_agg(to_jsonb(t)-array['used_quantity','on_hand_quantity'] order by product_id),'[]'::jsonb)
from public.inventory_on_hand t where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005';
select jsonb_object_agg(table_name,state order by table_name)::text from cw1_snapshot;
'@

Assert-Cw1Contract
if ($StaticOnly) { exit 0 }
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -or -not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'CONNECT_WORKFLOWS_CW1_DISPOSABLE_REQUIRES_DOCKER_AND_NPX' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }

Push-Location $root
try {
  if (@(docker ps --format '{{.Names}}') -notcontains $db) {
    & $supabase --profile supabase start
    if ($LASTEXITCODE -ne 0) { throw 'CONNECT_WORKFLOWS_CW1_LOCAL_START_FAILED' }
  }
  Enter-MapleSeasonCredential
  foreach ($viewport in @('desktop','phone')) {
    Reset-Cw1 $supabase
    $boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $project -ExpectedContainer $db
    $before = Invoke-Cw1Sql $snapshotSql
    if ([string]::IsNullOrWhiteSpace($before)) { throw "CONNECT_WORKFLOWS_CW1_BEFORE_SNAPSHOT_FAILED:$viewport" }
    $env:VITE_LOCAL_SUPABASE_PROJECT_REF = 'farmrxlocalsimplicity2027'
    $env:VITE_LOCAL_SUPABASE_URL = $boundary.ApiUrl
    $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY = $boundary.PublishableKey
    $env:FARMRX_CW1_VIEWPORT = $viewport
    $env:FARMRX_CC_CLIENT_INSTANT = '2027-07-07T13:20:00-05:00'
    $token = Get-Cw1AccessToken $boundary.PublishableKey
    $action = {
      $stage = 'browser'
      try {
        Write-Host "CONNECT_WORKFLOWS_CW1_ACTION_STAGE:${viewport}:$stage"
        $priorErrorActionPreference = $ErrorActionPreference
        try {
          $ErrorActionPreference = 'Continue'
          $browserOutput = @(& npx playwright test --config playwright.connect-workflows-cw1.config.ts 2>&1)
          $browserExit = $LASTEXITCODE
        } finally {
          $ErrorActionPreference = $priorErrorActionPreference
        }
        $browserOutput | Out-Host
        $browserText = [string]::Join("`n", [string[]]$browserOutput)
        if ($browserExit -ne 0 -or $browserText -match '(?m)^\s*\d+ failed\s*$') {
          docker logs $db --tail 80 2>&1 | Out-Host
          throw "CONNECT_WORKFLOWS_CW1_BROWSER_FAILED:$viewport`:exit=$browserExit"
        }
        Write-Host "CONNECT_WORKFLOWS_CW1_PLAYWRIGHT_EXIT:${viewport}:$browserExit"
        $stage = 'after-snapshot'
        Write-Host "CONNECT_WORKFLOWS_CW1_ACTION_STAGE:${viewport}:$stage"
        $after = Invoke-Cw1Sql $snapshotSql
        if ([string]::IsNullOrWhiteSpace($after)) { throw "CONNECT_WORKFLOWS_CW1_AFTER_SNAPSHOT_FAILED:$viewport" }
        $stage = 'no-unexpected-writes'
        Write-Host "CONNECT_WORKFLOWS_CW1_ACTION_STAGE:${viewport}:$stage"
        if ($before -cne $after) { throw "CONNECT_WORKFLOWS_CW1_UNEXPECTED_WRITE:$viewport" }
        $stage = 'focused-sql'
        Write-Host "CONNECT_WORKFLOWS_CW1_ACTION_STAGE:${viewport}:$stage"
        if (-not (Invoke-MapleSeasonSqlFile -Path $verify -ExpectedContainer $db)) { throw "CONNECT_WORKFLOWS_CW1_VERIFY_FAILED:$viewport" }
        return $true
      } catch {
        throw "CONNECT_WORKFLOWS_CW1_ACTION_FAILED:$viewport`:$stage"
      }
    }.GetNewClosure()
    $clockResult = @(Invoke-HarvestRidgeClockPhase -Root $root -Phase "cw1-$viewport" -FrozenInstant '2027-07-07 18:20:00+00:00' -ApiUrl $boundary.ApiUrl -PublishableKey $boundary.PublishableKey -AccessToken $token -ProofFarmId '27010000-0000-4000-8000-000000000005' -ProofFarmName 'Cedar Creek' -Action $action)
    if ($clockResult[-1] -ne $true) { throw "CONNECT_WORKFLOWS_CW1_CLOCK_PHASE_FAILED:$viewport" }
    Assert-Cw1DeniedActor
    $token = $null
    $boundary = $null
  }
  Write-Output 'CONNECT_WORKFLOWS_CW1_DISPOSABLE_PASS'
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:FARMRX_CW1_VIEWPORT -ErrorAction SilentlyContinue
  Remove-Item Env:FARMRX_CC_CLIENT_INSTANT -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  $token = $null
  $boundary = $null
  Pop-Location
}
