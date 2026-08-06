$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'harvest-ridge-db-clock.psm1') -Force
$module = Get-Module harvest-ridge-db-clock
if ($null -eq $module) { throw 'MAPLE_JULY_CLOCK_WIRING_REGRESSION_FAILED: clock module did not load.' }

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

function Get-MapleRedactedChildDetail([string[]]$Lines) {
  # Child regressions catch their own exceptions and report through a marker plus a native exit
  # code, so their output is the only failure detail this caller has - carry it through rather than
  # replacing it with a fixed string. Redact the profile directory AND the temp directory before
  # doing so: their diagnostics name paths built from [IO.Path]::GetTempPath(), which follows %TEMP%
  # and is not always inside the profile, and this text is written into season evidence logs.
  $detail = ($Lines -join ' | ')
  foreach ($machinePath in @([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile), [IO.Path]::GetTempPath())) {
    if (-not [string]::IsNullOrEmpty($machinePath)) { $detail = $detail.Replace($machinePath.TrimEnd('\'), '<redacted-path>') }
  }
  return $detail
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
# The launch needles here named a .NET ProcessStartInfo - FileName, CreateNoWindow, WaitForExit, ExitCode - and
# every one of them went stale when the launch was rewritten onto CreateProcessW inside a Windows Job Object.
# That is the safe direction for a stale needle to fail in: this assertion went red and named itself rather
# than passing over a launch it no longer describes. The replacements name the four things that now carry the
# guarantee - the job is created before the process, the child is created SUSPENDED so it cannot spawn the dev
# server outside the job, the wait is on the HANDLE CreateProcessW returned rather than on a re-resolved id,
# and the exit code is read from that same handle.
Assert-True ($browserHelper.Contains('Get-Command node.exe') -and $browserHelper.Contains("node_modules/@playwright/test/cli.js") -and $browserHelper.Contains('[MapleSeasonProcessInterop]::CreateKillOnCloseJob([ref]$jobError, [ref]$jobStage)') -and $browserHelper.Contains('CREATE_SUSPENDED | CREATE_NO_WINDOW') -and $browserHelper.Contains('[MapleSeasonProcessInterop]::StartInJob($job, $node, $commandLine, $Root,') -and $browserHelper.Contains('[MapleSeasonProcessInterop]::WaitForSingleObject($launchedHandle, [uint32]$TimeoutMilliseconds)') -and $browserHelper.Contains('[MapleSeasonProcessInterop]::GetExitCodeProcess($launchedHandle, [ref]$exitCode)')) 'Continuous browser helper does not use the repository Playwright CLI in a bounded, job-owned, suspended-then-assigned Node process with an exact native exit code.'
# The kill needle here was '$ownedProcess.Kill()', then a TerminateProcess through a validated handle, and both
# went stale as the ownership question moved. It is why this caller is worth keeping alongside the static guard:
# it runs inside the foundation gate's Windows lane, so it fails a gate run rather than only a hand-run check.
# The question it now pins is a different one. Every earlier version asked "does this command line look like
# ours?" and answered from text; measured, that predicate returned True for a genuinely foreign node process
# started by hand inside this repository. Job membership is kernel state bound to a HANDLE rather than to a
# reusable number, so the cleanup kills a JOB - naming no process id at all - and then classifies whatever
# survives by asking the kernel, not by reading a string.
Assert-True ($browserHelper.Contains('Get-NetTCPConnection -LocalPort $Port -State Listen') -and $browserHelper.Contains('[MapleSeasonProcessInterop]::OpenProcess(') -and $browserHelper.Contains('[MapleSeasonProcessInterop]::TerminateJobObject($Job, 1)') -and $browserHelper.Contains('[MapleSeasonProcessInterop]::IsProcessInJob($handle, $Job, [ref]$inJob)') -and $browserHelper.Contains('is not in that job and still holds governed port') -and $browserHelper.Contains('browser server cleanup did not release governed port')) 'Continuous browser helper does not terminate its own job and classify surviving listeners by kernel job membership.'
foreach ($month in @('january','february','march','april','may','june')) {
  $runner = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root "scripts/verify-maple-$month-disposable.ps1")
  Assert-True ($runner.Contains('maple-season-browser.ps1') -and $runner.Contains('Invoke-MapleSeasonBrowserProof')) "Maple $month runner bypasses the deterministic browser process helper."
}
Assert-True ($july.Contains('FARMRX_SEASON_JANUARY_PORT') -and $july.Contains("'4274'") -and $july.Contains('Assert-MapleJulySeasonPortsAvailable')) 'July does not reserve and restore its isolated nested-chain ports.'
Assert-True ($july.Contains('Get-NetTCPConnection -LocalPort $port -State Listen') -and -not $july.Contains("Get-NetTCPConnection -LocalAddress '127.0.0.1'")) 'July port preflight does not fail closed for wildcard or IPv6 listeners.'
$timeoutRegression = @(& (Join-Path $root 'scripts/maple-season-browser-timeout.regression.ps1'))
Assert-True ($LASTEXITCODE -eq 0 -and ($timeoutRegression -join "`n") -ceq 'MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_PASS') "Browser forced-timeout cleanup regression did not pass: $(Get-MapleRedactedChildDetail $timeoutRegression)"
# July already reserves its own isolated nested-chain ports. Every other month reaches the
# shared helper on its default governed port, so the helper itself must refuse before it
# launches into a port a foreign process already holds.
Assert-True ($browserHelper.Contains('Assert-MapleSeasonBrowserPortFree') -and $browserHelper.Contains('was already in use by')) 'Continuous browser helper does not preflight its governed port before launching.'
Assert-True (-not $browserHelper.Contains("Get-NetTCPConnection -LocalAddress")) 'Browser helper port checks do not fail closed for wildcard or IPv6 listeners.'
Assert-True ($browserHelper.Contains('Farm Rx dev or season server')) 'Browser helper preflight does not distinguish a Farm Rx-owned listener from a foreign one.'
$preflightRegression = @(& (Join-Path $root 'scripts/maple-season-browser-port-preflight.regression.ps1'))
# The tokenizer receipt is held HERE, longhand, as well as inside the child. The child asserts its own table
# ran, and a child that asserts things about itself is the exact shape of defeat this chain keeps finding, so
# this caller states the number it requires independently. `windows=true` is not incidental: this lane is
# Windows-only - off Windows the child prints a skip line instead, which this exact match already refused - and
# a receipt reading windows=false, or a lower count, would mean the equivalence table did not run.
$preflightExpected = @(
  'TOKENIZER_RECEIPT comparisons=33 distinct=33 tokens=90 windows=true'
  'MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_PASS'
) -join "`n"
Assert-True ($LASTEXITCODE -eq 0 -and ($preflightRegression -join "`n") -ceq $preflightExpected) "Browser governed-port preflight regression did not pass: $(Get-MapleRedactedChildDetail $preflightRegression)"
Write-Output 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS'
