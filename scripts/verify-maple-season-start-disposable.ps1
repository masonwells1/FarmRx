$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$expectedGatewayContainer = "supabase_kong_$expectedProjectId"
$expectedAuthHealthUri = 'http://127.0.0.1:55321/auth/v1/health'
$fixturePath = Join-Path $root 'tests/season/maple-2027-start.sql'
$proofPath = Join-Path $root 'tests/season/maple-2027-start.verify.sql'
$staticVerifierPath = Join-Path $root 'scripts/verify-maple-season-start.mjs'
$credentialHelperPath = Join-Path $root 'scripts/maple-season-credential.ps1'
$credentialRegressionPath = Join-Path $root 'scripts/maple-season-credential.regression.ps1'
$requestClassifierRegressionPath = Join-Path $root 'tests/e2e/season/season-request-classifier.regression.ts'

. $credentialHelperPath

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the Maple season-start proof.'
}

$supabase = if ($env:SUPABASE_GO_BINARY) {
  $env:SUPABASE_GO_BINARY
} else {
  (Get-Command supabase -ErrorAction Stop).Source
}

$boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $expectedProjectId -ExpectedContainer $expectedContainer

Push-Location $root
try {
  node $staticVerifierPath
  if ($LASTEXITCODE -ne 0) { throw 'Maple season-start static contract failed.' }

  & powershell -NoProfile -ExecutionPolicy Bypass -File $credentialRegressionPath
  if ($LASTEXITCODE -ne 0) { throw 'Maple season credential regression failed.' }

  npx tsx $requestClassifierRegressionPath
  if ($LASTEXITCODE -ne 0) { throw 'Season request classifier regression failed.' }

  Enter-MapleSeasonCredential

  $env:DO_NOT_TRACK = '1'
  $resetSucceeded = $false
  for ($resetAttempt = 1; $resetAttempt -le 2 -and -not $resetSucceeded; $resetAttempt += 1) {
    & $supabase --profile supabase db reset --local --no-seed --yes
    $resetSucceeded = $LASTEXITCODE -eq 0
    if (-not $resetSucceeded -and $resetAttempt -lt 2) { Start-Sleep -Seconds 3 }
  }
  if (-not $resetSucceeded) { throw 'Disposable local Supabase reset failed after one bounded retry.' }

  # db reset recreates Auth while leaving the local gateway running. Refresh the
  # exact disposable gateway so it cannot retain Auth's former container address.
  $runningContainers = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $expectedGatewayContainer) {
    throw "Refusing readiness repair: expected disposable gateway $expectedGatewayContainer is not running."
  }
  docker restart $expectedGatewayContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not refresh the disposable local Supabase gateway after reset.' }

  $authReady = $false
  for ($healthAttempt = 1; $healthAttempt -le 15 -and -not $authReady; $healthAttempt += 1) {
    try {
      $health = Invoke-WebRequest -UseBasicParsing -Uri $expectedAuthHealthUri -TimeoutSec 2
      $authReady = $health.StatusCode -eq 200 -and $health.Content -match '"name"\s*:\s*"GoTrue"'
    } catch {
      $authReady = $false
    }
    if (-not $authReady -and $healthAttempt -lt 15) { Start-Sleep -Seconds 1 }
  }
  if (-not $authReady) { throw 'Disposable local Supabase Auth did not become healthy after the bounded gateway refresh.' }

  $fixtureApplied = Invoke-MapleSeasonSqlFile -Path $fixturePath -ExpectedContainer $expectedContainer
  if (-not $fixtureApplied) { throw 'Maple January fixture failed to apply.' }

  $proofApplied = Invoke-MapleSeasonSqlFile -Path $proofPath -ExpectedContainer $expectedContainer
  if (-not $proofApplied) { throw 'Maple January database assertions failed.' }

  Write-Output 'MAPLE_2027_START_DISPOSABLE_PASS'
} finally {
  Exit-MapleSeasonCredential
  $boundary = $null
  Pop-Location
}
