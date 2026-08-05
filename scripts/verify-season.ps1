$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-SeasonLane([scriptblock]$Command, [string]$Failure) {
  $global:LASTEXITCODE = 0
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Get-SeasonProbeShell {
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    return (Join-Path $PSHOME 'powershell.exe')
  }
  if ($IsWindows) {
    return (Join-Path $PSHOME 'pwsh.exe')
  }
  return (Join-Path $PSHOME 'pwsh')
}

function Assert-IntermediateLaneFailureIsFatal {
  $expected = 'Controlled intermediate season contract lane failed.'
  $detected = $false
  $probeShell = Get-SeasonProbeShell
  try {
    Invoke-SeasonLane { & $probeShell -NoProfile -Command 'exit 23' } $expected
  } catch {
    if ($_.Exception.Message -ne $expected) { throw }
    $detected = $true
  }
  if (-not $detected) { throw 'Season orchestrator ignored a controlled intermediate failure.' }
  Write-Output 'Season orchestrator intermediate-failure probe: PASS'
}

function Invoke-SeasonWindowsExecutionLane {
  # The two Node lanes below check the browser helper by reading its text. They cannot run the
  # ownership predicate that gates Stop-Process, and nothing else ran it either: this chain sat in
  # scripts/ with no caller, so a regression in it would have gone unnoticed until a season month
  # either refused to clean up its own server or terminated somebody else's. Executing the guard is
  # the only thing that proves it still holds.
  #
  # It is Windows-only by necessity - Get-NetTCPConnection, node.exe, and a hidden Start-Process have
  # no portable equivalent - so on any other platform this lane records a skip and claims no credit
  # rather than reporting a pass it did not earn. The repository's CI runner is Linux, so the skip
  # branch is the one CI takes; this lane is real coverage only on the Windows workstation where the
  # season proofs actually run.
  if (-not ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows)) {
    Write-Output 'Season Windows execution lane: SKIPPED (Windows-only cmdlets; no credit claimed)'
    return
  }
  # This one file chains the forced-timeout cleanup regression and the governed-port preflight
  # regression, so a single lane reaches all three.
  $wiring = Join-Path $PSScriptRoot 'maple-july-db-clock-wiring.regression.ps1'
  Invoke-SeasonLane { & (Get-SeasonProbeShell) -NoProfile -ExecutionPolicy Bypass -File $wiring } 'Season Windows execution regressions failed.'
}

Push-Location $root
try {
  Assert-IntermediateLaneFailureIsFatal
  Invoke-SeasonLane { & node scripts/verify-season-contract.mjs } 'Season fixture contract validation failed.'
  Invoke-SeasonLane { & node scripts/verify-season-contract.regression.mjs } 'Season fixture contract regression failed.'
  Invoke-SeasonWindowsExecutionLane
  Write-Output 'Farm Rx season contract gate: PASS (contract/isolation only; disposable-backend and browser workflow proof not yet run)'
} finally {
  Pop-Location
}
