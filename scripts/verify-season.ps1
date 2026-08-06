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

Push-Location $root
try {
  Assert-IntermediateLaneFailureIsFatal
  Invoke-SeasonLane { & node scripts/verify-season-contract.mjs } 'Season fixture contract validation failed.'
  Invoke-SeasonLane { & node scripts/verify-season-contract.regression.mjs } 'Season fixture contract regression failed.'
  Write-Output 'Farm Rx season contract gate: PASS (contract/isolation only; disposable-backend and browser workflow proof not yet run)'
} finally {
  Pop-Location
}
