$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'harvest-ridge-db-clock.psm1') -Force
$module = Get-Module harvest-ridge-db-clock
if ($null -eq $module) { throw 'MAPLE_JULY_CLOCK_WIRING_REGRESSION_FAILED: clock module did not load.' }

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

& $module {
  function Assert-ModuleTrue([bool]$Value, [string]$Message) {
    if (-not $Value) { throw $Message }
  }

  function Assert-Refused([scriptblock]$Probe, [string]$Message) {
    $refused = $false
    try { & $Probe | Out-Null } catch { $refused = $_.Exception.Message -ceq 'HARVEST_RIDGE_CLOCK_REFUSED: local API credentials/boundary are not exact.' -or $_.Exception.Message -ceq 'HARVEST_RIDGE_CLOCK_REFUSED: proof farm identity is not an approved synthetic fixture.' -or $_.Exception.Message -ceq 'HARVEST_RIDGE_CLOCK_REFUSED: phase instant is not exact UTC.' }
    Assert-ModuleTrue $refused $Message
  }

  $valid = @{ ApiUrl = 'http://127.0.0.1:55321'; PublishableKey = 'sb_publishable_test'; AccessToken = 'synthetic-loopback-token'; FrozenInstant = '2027-07-09 21:10:00+00:00' }
  $mapleInstant = Assert-HrClockPhaseInput $valid.ApiUrl $valid.PublishableKey $valid.AccessToken $script:MapleFarmId $script:MapleFarmName $valid.FrozenInstant
  Assert-ModuleTrue ($mapleInstant.ToString('yyyy-MM-dd HH:mm:sszzz') -ceq $valid.FrozenInstant) 'exact Maple fixture input was rejected'
  $harvestInstant = Assert-HrClockPhaseInput $valid.ApiUrl $valid.PublishableKey $valid.AccessToken $script:HrFarmId $script:HrFarmName $valid.FrozenInstant
  Assert-ModuleTrue ($harvestInstant.ToString('yyyy-MM-dd HH:mm:sszzz') -ceq $valid.FrozenInstant) 'Harvest Ridge compatible fixture input was rejected'

  Assert-Refused { Assert-HrClockPhaseInput 'http://localhost:55321' $valid.PublishableKey $valid.AccessToken $script:MapleFarmId $script:MapleFarmName $valid.FrozenInstant } 'non-exact loopback boundary was accepted'
  Assert-Refused { Assert-HrClockPhaseInput $valid.ApiUrl $valid.PublishableKey $valid.AccessToken $script:HrFarmId $script:MapleFarmName $valid.FrozenInstant } 'wrong farm/name pair was accepted'
  Assert-Refused { Assert-HrClockPhaseInput $valid.ApiUrl $valid.PublishableKey $valid.AccessToken '27010000-0000-4000-8000-000000000099' $script:MapleFarmName $valid.FrozenInstant } 'unknown farm was accepted'
  Assert-Refused { Assert-HrClockPhaseInput $valid.ApiUrl $valid.PublishableKey $valid.AccessToken $script:MapleFarmId $script:MapleFarmName '2027-07-09T21:10:00Z' } 'non-canonical instant was accepted'
  Assert-Refused { Assert-HrClockPhaseInput $valid.ApiUrl $valid.PublishableKey $valid.AccessToken $script:MapleFarmId $script:MapleFarmName '2027-07-09 21:10:00-05:00' } 'non-UTC instant was accepted'
}

$july = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'scripts/verify-maple-july-disposable.ps1')
$juneIndex = $july.IndexOf('& powershell -NoProfile -ExecutionPolicy Bypass -File $juneProof', [StringComparison]::Ordinal)
$freezeIndex = $july.IndexOf('Invoke-HarvestRidgeClockPhase', [StringComparison]::Ordinal)
Assert-True ($juneIndex -ge 0 -and $freezeIndex -gt $juneIndex) 'July freezes before the continuous January-June chain.'
foreach ($required in @(
  "-FrozenInstant `$frozenInstant",
  "-ProofFarmId `$mapleFarmId",
  "-ProofFarmName `$mapleFarmName",
  'Get-MapleJulyAccessToken',
  'Invoke-MapleSeasonBrowserProof',
  "-Grep '@july-scouting-write'",
  "-Grep '@july-task-write'",
  "-Grep '@july-read-only'",
  'scoutingFailureDiagnosticSql',
  'Invoke-MapleSeasonSqlFile -Path $julySql',
  'Assert-MapleJulyNoClockResidue'
)) {
  Assert-True ($july.Contains($required)) "July governed clock contract is missing: $required"
}
$clockModule = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1')
Assert-True ($clockModule.Contains('[string]$ProofFarmId=$script:HrFarmId') -and $clockModule.Contains('[string]$ProofFarmName=$script:HrFarmName')) 'Harvest Ridge default proof identity compatibility was removed.'
$portRegression = @(& npx tsx (Join-Path $root 'tests/e2e/season/season-loopback-port.regression.ts'))
Assert-True ($LASTEXITCODE -eq 0 -and ($portRegression -join "`n") -ceq 'SEASON_LOOPBACK_PORT_REGRESSION_PASS') 'Season loopback-port regression did not pass.'
foreach ($config in @('playwright.season.config.ts','playwright.season-february.config.ts','playwright.season-march.config.ts','playwright.season-april.config.ts','playwright.season-may.config.ts','playwright.season-june.config.ts','playwright.season-july.config.ts')) {
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $config)
  Assert-True ($source.Contains('seasonLoopback') -and $source.Contains('127.0.0.1')) "Season config does not retain dynamic loopback-only port handling: $config"
}
$browserHelper = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'scripts/maple-season-browser.ps1')
Assert-True ($browserHelper.Contains('Get-Command node.exe') -and $browserHelper.Contains("node_modules/@playwright/test/cli.js") -and $browserHelper.Contains('$startInfo.FileName = $node') -and $browserHelper.Contains('$startInfo.CreateNoWindow = $true') -and $browserHelper.Contains('System.Diagnostics.ProcessStartInfo') -and $browserHelper.Contains('$process.WaitForExit($TimeoutMilliseconds)') -and $browserHelper.Contains('$process.ExitCode')) 'Continuous browser helper does not use the repository Playwright CLI in a bounded direct Node process with an exact exit code.'
Assert-True ($browserHelper.Contains('Get-NetTCPConnection -LocalPort $Port -State Listen') -and $browserHelper.Contains('Stop-Process -Id $listener.OwningProcess') -and $browserHelper.Contains('$killExitCode = $LASTEXITCODE') -and $browserHelper.Contains('browser server cleanup did not release governed port')) 'Continuous browser helper does not terminate and verify its proof-owned browser server.'
foreach ($month in @('january','february','march','april','may','june')) {
  $runner = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root "scripts/verify-maple-$month-disposable.ps1")
  Assert-True ($runner.Contains('maple-season-browser.ps1') -and $runner.Contains('Invoke-MapleSeasonBrowserProof')) "Maple $month runner bypasses the deterministic browser process helper."
}
Assert-True ($july.Contains('FARMRX_SEASON_JANUARY_PORT') -and $july.Contains("'4274'") -and $july.Contains('Assert-MapleJulySeasonPortsAvailable')) 'July does not reserve and restore its isolated nested-chain ports.'
Assert-True ($july.Contains('Get-NetTCPConnection -LocalPort $port -State Listen') -and -not $july.Contains("Get-NetTCPConnection -LocalAddress '127.0.0.1'")) 'July port preflight does not fail closed for wildcard or IPv6 listeners.'
$timeoutRegression = @(& (Join-Path $root 'scripts/maple-season-browser-timeout.regression.ps1'))
Assert-True ($LASTEXITCODE -eq 0 -and ($timeoutRegression -join "`n") -ceq 'MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_PASS') 'Browser forced-timeout cleanup regression did not pass.'
# July already reserves its own isolated nested-chain ports. Every other month reaches the
# shared helper on its default governed port, so the helper itself must refuse before it
# launches into a port a foreign process already holds.
Assert-True ($browserHelper.Contains('Assert-MapleSeasonBrowserPortFree') -and $browserHelper.Contains('was already in use by')) 'Continuous browser helper does not preflight its governed port before launching.'
Assert-True (-not $browserHelper.Contains("Get-NetTCPConnection -LocalAddress")) 'Browser helper port checks do not fail closed for wildcard or IPv6 listeners.'
Assert-True ($browserHelper.Contains('leaked Farm Rx season server')) 'Browser helper preflight does not distinguish a leaked Farm Rx server from a foreign one.'
$preflightRegression = @(& (Join-Path $root 'scripts/maple-season-browser-port-preflight.regression.ps1'))
# Carry the child's own marker line through: it catches its exception and exits 1 rather than
# throwing, so without this the operator only learns that "something" failed.
Assert-True ($LASTEXITCODE -eq 0 -and ($preflightRegression -join "`n") -ceq 'MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_PASS') "Browser governed-port preflight regression did not pass: $($preflightRegression -join ' | ')"
Write-Output 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS'
