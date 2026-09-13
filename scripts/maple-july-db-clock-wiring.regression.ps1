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
$replacementArtifactNeedles = @(
  'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365@sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302',
  'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365:synthetic',
  'sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302',
  "'farmrx.synthetic-bootstrap'-cne'b9ad08aeb66ed961e8426b2cce527365'",
  "'farmrx.synthetic-owner'-cne'maple-faketime-bootstrap'",
  "'farmrx.synthetic-role'-cne'faketime-artifacts'",
  "'farmrx.source-digest'-cne'debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818'",
  "'farmrx.package-contract'-cne'libfaketime=0.9.10-2.1;gcc;libc6-dev'"
)
Assert-True ($replacementArtifactNeedles.Count -eq 8 -and @($replacementArtifactNeedles | Where-Object { -not $clockModule.Contains($_) }).Count -eq 0 -and -not $clockModule.Contains('225c197c34164c90b08a4c8b6b10e6c7') -and -not $clockModule.Contains('sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746')) 'Harvest Ridge clock module does not retain the exact replacement artifact identity and five-label refusal contract.'
$portRegression = @(& npx tsx (Join-Path $root 'tests/e2e/season/season-loopback-port.regression.ts'))
Assert-True ($LASTEXITCODE -eq 0 -and ($portRegression -join "`n") -ceq 'SEASON_LOOPBACK_PORT_REGRESSION_PASS') 'Season loopback-port regression did not pass.'
foreach ($config in @('playwright.season.config.ts','playwright.season-february.config.ts','playwright.season-march.config.ts','playwright.season-april.config.ts','playwright.season-may.config.ts','playwright.season-june.config.ts','playwright.season-july.config.ts')) {
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $config)
  Assert-True ($source.Contains('seasonLoopback') -and $source.Contains('127.0.0.1')) "Season config does not retain dynamic loopback-only port handling: $config"
}
$browserHelper = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'scripts/maple-season-browser.ps1')
$browserJob = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'scripts/maple-season-browser-job.cs')
Assert-True ($browserHelper.Contains('Get-Command node.exe') -and $browserHelper.Contains("node_modules/@playwright/test/cli.js") -and $browserHelper.Contains('[MapleSeasonOwnedJob]::Start($node, $arguments, $Root, $stdoutPath, $stderrPath)') -and $browserHelper.Contains('$completed = $job.WaitForExit($TimeoutMilliseconds)') -and $browserHelper.Contains('$exitCode = $job.GetExitCode()')) 'Continuous browser helper does not use the repository Playwright CLI in a bounded exact-job process with a readable exit code.'
Assert-True ($browserJob.Contains('CreateSuspended | CreateNoWindow') -and $browserJob.Contains('AssignProcessToJobObject') -and $browserJob.Contains('IsProcessInJob') -and $browserJob.Contains('JobObjectLimitKillOnJobClose')) 'Continuous browser helper does not assign its suspended root to an exact kernel-owned job before resume.'
Assert-True ($browserJob.Contains('private struct STARTUPINFOEX') -and $browserJob.Contains('ProcThreadAttributeHandleList = new UIntPtr(0x00020002)') -and $browserJob.Contains('UpdateProcThreadAttribute(') -and $browserJob.Contains('CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent') -and $browserJob.Contains('DeleteProcThreadAttributeList(attributeList)')) 'Continuous browser helper does not whitelist exact inherited std handles through a fully cleaned STARTUPINFOEX attribute list.'
Assert-True ($browserJob.Contains('if (!terminate(process, 125))') -and $browserJob.Contains('if (waitResult == WaitFailed)') -and $browserJob.Contains('if (waitResult == WaitTimeout)') -and $browserJob.Contains('new Exception[] { primaryFailure, cleanupFailure }')) 'Continuous browser helper does not preserve assignment plus suspended-root cleanup failures.'
Assert-True ($browserHelper.Contains('Get-NetTCPConnection -State Listen -ErrorAction Stop') -and $browserHelper.Contains('[int]$_.LocalPort -eq $Port') -and $browserHelper.Contains('Assert-MapleSeasonJobIdentitySnapshot') -and $browserHelper.Contains('$Job.Terminate(125)') -and $browserHelper.Contains('browser server cleanup did not release governed port') -and -not $browserHelper.Contains('taskkill.exe') -and -not $browserHelper.Contains('Stop-Process')) 'Continuous browser helper does not identity-check, terminate, and verify only its exact proof-owned browser job.'
Assert-True ($browserHelper.Contains('-ErrorAction Stop') -and $browserHelper.Contains('Maple browser listener inspection failed for governed port $Port.')) 'Continuous browser helper does not fail closed when exact LISTEN-port inspection fails.'
Assert-True ($browserHelper.Contains('$line | Out-Host') -and -not $browserHelper.Contains('Write-Output $line') -and $browserHelper.Contains('return $true')) 'Continuous browser helper does not preserve transcript visibility while returning exact scalar success.'
foreach ($month in @('january','february','march','april','may','june')) {
  $runner = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root "scripts/verify-maple-$month-disposable.ps1")
  Assert-True ($runner.Contains('maple-season-browser.ps1') -and $runner.Contains('Invoke-MapleSeasonBrowserProof')) "Maple $month runner bypasses the deterministic browser process helper."
}
Assert-True ($july.Contains('FARMRX_SEASON_JANUARY_PORT') -and $july.Contains("'4274'") -and $july.Contains('Assert-MapleJulySeasonPortsAvailable')) 'July does not reserve and restore its isolated nested-chain ports.'
Assert-True ($july.Contains('Get-NetTCPConnection -LocalPort $port -State Listen') -and -not $july.Contains("Get-NetTCPConnection -LocalAddress '127.0.0.1'")) 'July port preflight does not fail closed for wildcard or IPv6 listeners.'
$timeoutRegression = @(& (Join-Path $root 'scripts/maple-season-browser-timeout.regression.ps1'))
Assert-True ($LASTEXITCODE -eq 0 -and ($timeoutRegression -join "`n") -ceq 'MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_PASS') 'Browser forced-timeout cleanup regression did not pass.'
Write-Output 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS'
