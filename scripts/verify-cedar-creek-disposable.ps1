param([switch]$StaticOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = 'farmrx-farmer-simplicity-2027-local'; $db = "supabase_db_$project"; $gateway = "supabase_kong_$project"
$manifestPath = Join-Path $root 'tests/season/season-2027.manifest.json'; $contractPath = Join-Path $root 'docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md'
$fixture = Join-Path $root 'tests/season/cedar-creek-2027-start.sql'; $verify = Join-Path $root 'tests/season/cedar-creek-2027.verify.sql'
$migration = '20260813133808_connect_workflows_program_inventory.sql'; $migrationBlob = '6e37cfb47456ed28e9b259f7e5520f5a1697708e'
$fkIndexMigration = '20260820135357_add_program_inventory_match_fk_indexes.sql'; $fkIndexMigrationSha256 = 'bf6fbc84c5389e1122ce7ccf63c37dacb2dfc21d881216bbbb5241b203fa5589'
. (Join-Path $root 'scripts/maple-season-credential.ps1')
Import-Module (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1') -Force

function Assert-CedarContract {
  $required = @($manifestPath,$contractPath,$fixture,$verify,(Join-Path $root 'tests/e2e/season/cedar-creek.spec.ts'),(Join-Path $root 'playwright.cedar-creek.config.ts'))
  if (@($required | Where-Object { -not (Test-Path -LiteralPath $_) }).Count) { throw 'CEDAR_CREEK_PACKET_MISSING_REQUIRED_FILE' }
  $migrationPath = Join-Path $root "supabase/migrations/$migration"
  if (-not (Test-Path -LiteralPath $migrationPath)) { throw "CEDAR_CREEK_REQUIRED_MIGRATION_MISSING:$migration" }
  $head = (Get-ChildItem (Join-Path $root 'supabase/migrations') -File | Sort-Object Name | Select-Object -Last 1).Name
  if ($head -cne $fkIndexMigration) { throw "CEDAR_CREEK_MIGRATION_HEAD_MISMATCH:$head" }
  $actualBlob = (& git -C $root hash-object (Join-Path $root "supabase/migrations/$migration")).Trim()
  if ($actualBlob -cne $migrationBlob) { throw 'CEDAR_CREEK_MIGRATION_BLOB_MISMATCH' }
  if ((Get-FileHash -LiteralPath (Join-Path $root "supabase/migrations/$fkIndexMigration") -Algorithm SHA256).Hash.ToLowerInvariant() -cne $fkIndexMigrationSha256) { throw 'CEDAR_CREEK_FK_INDEX_MIGRATION_HASH_MISMATCH' }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $operation = @($manifest.fixtures | Where-Object { $_.label -ceq 'Cedar scouting save operation' -and $_.uuid -ceq '27094000-0000-4000-8000-000000000005' })
  if ($operation.Count -ne 1) { throw 'CEDAR_CREEK_MANIFEST_OPERATION_IDENTITY_MISMATCH' }
  $contract = Get-Content -Raw -LiteralPath $contractPath
  if ($contract -notmatch [regex]::Escape('| Cedar scouting save operation | `27094000-0000-4000-8000-000000000005` |')) { throw 'CEDAR_CREEK_CONTRACT_OPERATION_IDENTITY_MISMATCH' }
  $spec = Get-Content -Raw -LiteralPath (Join-Path $root 'tests/e2e/season/cedar-creek.spec.ts')
  foreach ($needle in @('2027-07-07T13:20:00-05:00','farm-rx-weather:v1:38.210:-89.120','save_inventory_application_bundle','save_scouting_note','Cedar scouting save operation')) { if ($spec -notmatch [regex]::Escape($needle)) { throw "CEDAR_CREEK_STATIC_CONTRACT_MISSING:$needle" } }
  Write-Output 'CEDAR_CREEK_2027_STATIC_CONTRACT_PASS'
}

function Invoke-CedarSql([string]$Sql) { $out = @($Sql | docker exec -i $db psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1); if ($LASTEXITCODE -ne 0) { throw "CEDAR_CREEK_SQL_FAILED:$([string]::Join("`n",[string[]]$out))" }; [string]::Join("`n",[string[]]$out) }
function Wait-CedarAuth { for ($attempt = 1; $attempt -le 30; $attempt++) { try { $health = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:55321/auth/v1/health' -TimeoutSec 2; if ($health.StatusCode -eq 200 -and $health.Content -match '"name"\s*:\s*"GoTrue"') { return } } catch {}; if ($attempt -lt 30) { Start-Sleep -Milliseconds 500 } }; throw 'CEDAR_CREEK_AUTH_NOT_HEALTHY' }
function Reset-Cedar([string]$Supabase) { & $Supabase --profile supabase db reset --local --no-seed --yes; if ($LASTEXITCODE -ne 0) { throw 'CEDAR_CREEK_LOCAL_RESET_FAILED' }; docker restart $gateway | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'CEDAR_CREEK_GATEWAY_REFRESH_FAILED' }; Wait-CedarAuth; if (-not (Invoke-MapleSeasonSqlFile -Path $fixture -ExpectedContainer $db)) { throw 'CEDAR_CREEK_FIXTURE_FAILED' } }
function Get-CedarAccessToken([string]$PublishableKey) {
  $password = $env:FARMRX_SEASON_OWNER_PASSWORD
  if ($password -notmatch '^[0-9a-f]{64}$') { throw 'CEDAR_CREEK_SYNTHETIC_CREDENTIAL_UNAVAILABLE' }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:55321/auth/v1/token?grant_type=password' -Headers @{ apikey = $PublishableKey } -ContentType 'application/json' -Body (@{ email = 'cedar.owner@farmrx.local.test'; password = $password } | ConvertTo-Json -Compress) -TimeoutSec 10
    $token = ($response.Content | ConvertFrom-Json -ErrorAction Stop).access_token
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'missing token' }
    return [string]$token
  } catch { throw 'CEDAR_CREEK_SYNTHETIC_TOKEN_UNAVAILABLE' }
  finally { $password = $null }
}
function Assert-CedarDeniedActor {
  $result = Invoke-CedarSql @'
begin; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000006',true);
select set_config('request.headers','{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000006","x-farm-rx-access-epochs":"{}"}',true);
select count(*) from public.scouting_notes where farm_id='27010000-0000-4000-8000-000000000005'; rollback;
'@
  if (($result -split "`r?`n" | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1) -ne '0') { throw 'CEDAR_CREEK_RLS_DENIED_ACTOR_READ_FAILED' }
}

Assert-CedarContract
if ($StaticOnly) { exit 0 }
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -or -not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'CEDAR_CREEK_DISPOSABLE_REQUIRES_DOCKER_AND_NPX' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }
Push-Location $root
try {
  if (@(docker ps --format '{{.Names}}') -notcontains $db) { & $supabase --profile supabase start; if ($LASTEXITCODE -ne 0) { throw 'CEDAR_CREEK_LOCAL_START_FAILED' } }
  $boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $project -ExpectedContainer $db
  Enter-MapleSeasonCredential
  foreach ($viewport in @('desktop','phone')) {
    Reset-Cedar $supabase
    $env:VITE_LOCAL_SUPABASE_PROJECT_REF='farmrxlocalsimplicity2027'; $env:VITE_LOCAL_SUPABASE_URL=$boundary.ApiUrl; $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY=$boundary.PublishableKey; $env:FARMRX_CC_VIEWPORT=$viewport; $env:FARMRX_CC_CLIENT_INSTANT='2027-07-07T13:20:00-05:00'
    $token = Get-CedarAccessToken $boundary.PublishableKey
    $verifySql = Get-Content -Raw -Encoding UTF8 -LiteralPath $verify
    $action = {
      $priorErrorActionPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $browserOutput = @(& npx playwright test --config playwright.cedar-creek.config.ts 2>&1)
        $browserExit = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $priorErrorActionPreference
      }
      $browserOutput | Out-Host
      $browserText = [string]::Join("`n", [string[]]$browserOutput)
      if ($browserExit -ne 0 -or $browserText -match '(?m)^\s*\d+ failed\s*$') {
        docker logs $db --tail 80 2>&1 | Out-Host
        throw "CEDAR_CREEK_BROWSER_FAILED:$viewport:exit=$browserExit"
      }
      Write-Host "CEDAR_CREEK_PLAYWRIGHT_EXIT:${viewport}:$browserExit"
      $verifyOutput = @($verifySql | docker exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off 2>&1)
      if ($LASTEXITCODE -ne 0 -or [string]::Join("`n", [string[]]$verifyOutput) -notmatch 'CEDAR_CREEK_2027_VERIFY_PASS') { throw "CEDAR_CREEK_VERIFY_FAILED:$viewport" }
      return $true
    }.GetNewClosure()
    $clockResult = @(Invoke-HarvestRidgeClockPhase -Root $root -Phase "cedar-$viewport" -FrozenInstant '2027-07-07 18:20:00+00:00' -ApiUrl $boundary.ApiUrl -PublishableKey $boundary.PublishableKey -AccessToken $token -ProofFarmId '27010000-0000-4000-8000-000000000005' -ProofFarmName 'Cedar Creek' -Action $action)
    if ($clockResult[-1] -ne $true) { throw "CEDAR_CREEK_CLOCK_PHASE_FAILED:$viewport" }
    Assert-CedarDeniedActor
  }
  Write-Output 'CEDAR_CREEK_2027_DISPOSABLE_PASS'
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue; Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue; Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue; Remove-Item Env:FARMRX_CC_VIEWPORT -ErrorAction SilentlyContinue; Remove-Item Env:FARMRX_CC_CLIENT_INSTANT -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  Pop-Location
}
