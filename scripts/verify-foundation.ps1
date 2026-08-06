$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-FoundationLane([scriptblock]$Command, [string]$Failure) {
  $global:LASTEXITCODE = 0
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Get-FoundationProbeShell {
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    return (Join-Path $PSHOME 'powershell.exe')
  }
  if ($IsWindows) {
    return (Join-Path $PSHOME 'pwsh.exe')
  }
  return (Join-Path $PSHOME 'pwsh')
}

function Assert-IntermediateLaneFailureIsFatal {
  $expected = 'Controlled intermediate foundation lane failed.'
  $detected = $false
  $probeShell = Get-FoundationProbeShell
  try {
    Invoke-FoundationLane { & $probeShell -NoProfile -Command 'exit 23' } $expected
  } catch {
    if ($_.Exception.Message -ne $expected) { throw }
    $detected = $true
  }
  if (-not $detected) { throw 'Foundation orchestrator ignored a controlled intermediate failure.' }
  Write-Output 'Foundation orchestrator intermediate-failure probe: PASS'
}

function Invoke-FoundationWindowsExecutionLane {
  # Every guard the repository holds over the governed-port preflight reads it as text. Nothing
  # executed the ownership predicate that gates the Stop-Process in Clear-MapleSeasonBrowserPort: the
  # regression chain that does exercise it sat in scripts/ with no caller at all, so a defect in it
  # would have surfaced only when a season month either refused to clean up its own server or
  # terminated a process the proof does not own.
  #
  # This lane belongs here and not in scripts/verify-season.ps1. That file is itself reachable only
  # when an operator types `npm run verify:season` by hand - .github/workflows/foundation.yml runs this
  # script, and this script calls the two season node gates directly - so wiring the chain there would
  # have left it exactly as orphaned as it started, behind one more layer.
  #
  # The chain is Windows-only by necessity: Get-NetTCPConnection, node.exe, and a hidden Start-Process
  # have no portable equivalent. On any other platform it records a skip and claims no credit rather
  # than reporting a pass it did not earn. The CI runner is ubuntu-latest, so CI takes that skip: on CI
  # the ownership predicate is covered by static text assertions only, and this lane is real execution
  # coverage only on the Windows workstation where the season proofs actually run.
  if (-not ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows)) {
    Write-Output 'Foundation Windows execution lane: SKIPPED (Windows-only cmdlets; no credit claimed)'
    return
  }
  # This one file chains the forced-timeout cleanup regression and the governed-port preflight
  # regression, so a single lane reaches all three.
  $wiring = Join-Path $PSScriptRoot 'maple-july-db-clock-wiring.regression.ps1'
  $script:windowsExecutionOutput = @()
  try {
    Invoke-FoundationLane { $script:windowsExecutionOutput = @(& (Get-FoundationProbeShell) -NoProfile -ExecutionPolicy Bypass -File $wiring 2>&1) } 'Windows season execution regressions failed.'
  } finally {
    # Relay the child's output either way. Invoke-FoundationLane throws on a non-zero exit, so without
    # the finally a failure would report the lane name and discard the only lines saying what broke.
    $script:windowsExecutionOutput | ForEach-Object { Write-Output $_ }
  }
  # Require the chain's own completion marker, not just exit 0. A child that dies before its last line,
  # or that is replaced by something which exits cleanly without running anything, satisfies an
  # exit-code check while proving nothing.
  if (($script:windowsExecutionOutput -join "`n") -cnotmatch 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS') {
    throw 'Windows season execution regressions did not print their completion marker.'
  }
}

Push-Location $root
try {
  Assert-IntermediateLaneFailureIsFatal
  Invoke-FoundationLane { & npx tsc -b --force } 'Forced TypeScript failed.'
  Invoke-FoundationLane { & npm run regression } 'Fast regression suite failed.'
  Invoke-FoundationLane { & npm run build } 'Production build failed.'
  Invoke-FoundationLane { & npm audit --audit-level=high } 'Dependency audit failed.'
  Invoke-FoundationLane { & node scripts/foundation-static-guards.mjs } 'Foundation static guard failed.'
  Invoke-FoundationLane { & node scripts/verify-foundation-mutations.mjs } 'Foundation mutation drill failed.'
  # The season contract gate was reachable only when an operator typed `npm run verify:season` by
  # hand - no workflow and no hook ran it - so the structural guards it holds, including the
  # governed-port preflight checks, could regress without anything failing. Both are pure node with
  # no platform dependencies, so they run on the ubuntu foundation job as well as here.
  Invoke-FoundationLane { & node scripts/verify-season-contract.mjs } 'Season contract gate failed.'
  Invoke-FoundationLane { & node scripts/verify-season-contract.regression.mjs } 'Season contract mutation drill failed.'
  Invoke-FoundationWindowsExecutionLane
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0033-disposable.ps1') } 'Disposable 0033 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0034-disposable.ps1') } 'Disposable 0034 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0035-disposable.ps1') } 'Disposable 0035 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0036-disposable.ps1') } 'Disposable 0036 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0037-disposable.ps1') } 'Disposable 0037 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0039-disposable.ps1') } 'Disposable 0039 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0040-disposable.ps1') } 'Disposable 0040 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0041-disposable.ps1') } 'Disposable 0041 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0042-disposable.ps1') } 'Disposable 0042 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0043-disposable.ps1') } 'Disposable 0043 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-rls-role-matrix.ps1') } 'Disposable RLS role matrix failed.'
  Invoke-FoundationLane { & npm run test:e2e } 'Built-browser foundation suite failed.'
  Write-Output 'Farm Rx foundation gate: PASS'
} finally {
  Pop-Location
}
