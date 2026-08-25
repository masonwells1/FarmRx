$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'foundation-native-lane.ps1')

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

function Get-FoundationNpmNativeCommand {
  if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) {
    return (Get-Command npm.cmd -ErrorAction Stop).Source
  }
  return (Get-Command npm -ErrorAction Stop).Source
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

function Assert-FoundationBrowserPortIsFree {
  $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 4173)
  try {
    $probe.Start()
  } catch {
    throw 'FOUNDATION_BROWSER_PORT_4173_OCCUPIED: refusing to reuse an existing server.'
  } finally {
    $probe.Stop()
  }
}

Push-Location $root
try {
  Assert-FoundationBrowserPortIsFree
  Assert-IntermediateLaneFailureIsFatal
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'foundation-native-lane.regression.ps1') } 'Foundation native-lane regression failed.'
  Invoke-FoundationLane { & npx tsc -b --force } 'Forced TypeScript failed.'
  Invoke-FoundationLane { & npm run regression } 'Fast regression suite failed.'
  Invoke-FoundationLane { & npm run build } 'Production build failed.'
  Invoke-FoundationLane { & npm audit --audit-level=high } 'Dependency audit failed.'
  Invoke-FoundationLane { & deno check --no-config --lock=deno.lock --frozen --node-modules-dir=none supabase/functions/send-push/index.ts } 'Frozen send-push Deno check failed.'
  Invoke-FoundationLane { & node scripts/foundation-static-guards.mjs } 'Foundation static guard failed.'
  Invoke-FoundationLane { & node scripts/verify-foundation-mutations.mjs } 'Foundation mutation drill failed.'
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
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-push-access-revocation-disposable.ps1') } 'Disposable push access revocation proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-push-access-concurrency-mutation.ps1') } 'Push access concurrency mutation proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-soil-rx-disposable.ps1') } 'Disposable Soil Rx proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-rls-role-matrix.ps1') } 'Disposable RLS role matrix failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-password-form-browser.ps1') } 'Password-form browser isolation proof failed.'
  $nativeNpm = Get-FoundationNpmNativeCommand
  Invoke-FoundationNativeLane -Lane 'built-browser' -Executable $nativeNpm -Arguments @('run','test:e2e') -Failure 'Built-browser foundation suite failed.' | Out-Null
  Write-Output 'Farm Rx foundation gate: PASS'
} finally {
  Pop-Location
}
