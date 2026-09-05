$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$cedarPath = Join-Path $root 'scripts/verify-cedar-creek-disposable.ps1'
$cedarSource = Get-Content -Raw -Encoding UTF8 -LiteralPath $cedarPath

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Assert-CedarNativeCapture([string]$Source) {
  $orderedNeedles = @(
    '$priorErrorActionPreference = $ErrorActionPreference',
    'try {',
    '$ErrorActionPreference = ''Continue''',
    '$browserOutput = @(& npx playwright test --config playwright.cedar-creek.config.ts 2>&1)',
    '$browserExit = $LASTEXITCODE',
    '} finally {',
    '$ErrorActionPreference = $priorErrorActionPreference',
    '$browserOutput | Out-Host',
    '$browserText = [string]::Join("`n", [string[]]$browserOutput)',
    'if ($browserExit -ne 0 -or $browserText -match ''(?m)^\s*\d+ failed\s*$'') {'
  )

  $cursor = -1
  foreach ($needle in $orderedNeedles) {
    $next = $Source.IndexOf($needle, $cursor + 1, [StringComparison]::Ordinal)
    Assert-True ($next -gt $cursor) "CEDAR_NATIVE_CAPTURE_ORDER_MISSING:$needle"
    $cursor = $next
  }

  $continueCount = [regex]::Matches(
    $Source,
    [regex]::Escape('$ErrorActionPreference = ''Continue''')
  ).Count
  Assert-True ($continueCount -eq 1) "CEDAR_NATIVE_CAPTURE_CONTINUE_SCOPE_COUNT:$continueCount"
}

function Assert-MutationRejected(
  [string]$Name,
  [string]$Before,
  [string]$After
) {
  $mutant = $cedarSource.Replace($Before, $After)
  Assert-True ($mutant -ne $cedarSource) "CEDAR_NATIVE_CAPTURE_MUTATION_NOT_APPLIED:$Name"

  $rejected = $false
  try {
    Assert-CedarNativeCapture $mutant
  } catch {
    $rejected = $true
  }
  Assert-True $rejected "CEDAR_NATIVE_CAPTURE_MUTATION_SURVIVED:$Name"
}

function Invoke-NativeCaptureProbe([int]$ExitCode, [string]$Summary) {
  $priorErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $nativeCommand = "[Console]::Error.WriteLine('routine-native-stderr'); [Console]::Out.WriteLine('$Summary'); exit $ExitCode"
    $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
    $browserOutput = @(& $pwsh -NoProfile -Command $nativeCommand 2>&1)
    $browserExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $priorErrorActionPreference
  }

  $browserText = [string]::Join("`n", [string[]]$browserOutput)
  if ($browserExit -ne 0 -or $browserText -match '(?m)^\s*\d+ failed\s*$') {
    throw "CEDAR_NATIVE_CAPTURE_PROBE_FAILED:exit=$browserExit"
  }
  [pscustomobject]@{ ExitCode = $browserExit; Output = $browserText }
}

Assert-CedarNativeCapture $cedarSource

Assert-MutationRejected 'no-saved-preference' `
  '$priorErrorActionPreference = $ErrorActionPreference' `
  '$priorErrorActionPreference = ''Continue'''
Assert-MutationRejected 'stop-instead-of-continue' `
  '$ErrorActionPreference = ''Continue''' `
  '$ErrorActionPreference = ''Stop'''
Assert-MutationRejected 'falsified-exit-capture' `
  '$browserExit = $LASTEXITCODE' `
  '$browserExit = 0'
Assert-MutationRejected 'no-restore' `
  '$ErrorActionPreference = $priorErrorActionPreference' `
  '$null = $priorErrorActionPreference'
Assert-MutationRejected 'removed-nonzero-guard' `
  'if ($browserExit -ne 0 -or $browserText -match ''(?m)^\s*\d+ failed\s*$'') {' `
  'if ($browserText -match ''(?m)^\s*\d+ failed\s*$'') {'
Assert-MutationRejected 'removed-failed-summary-guard' `
  'if ($browserExit -ne 0 -or $browserText -match ''(?m)^\s*\d+ failed\s*$'') {' `
  'if ($browserExit -ne 0) {'

$routine = Invoke-NativeCaptureProbe 0 '1 passed'
Assert-True ($routine.ExitCode -eq 0) 'CEDAR_NATIVE_CAPTURE_ROUTINE_EXIT_NOT_ZERO'
Assert-True ($routine.Output -match 'routine-native-stderr') 'CEDAR_NATIVE_CAPTURE_ROUTINE_STDERR_NOT_RETAINED'
Assert-True ($routine.Output -match '(?m)^\s*1 passed\s*$') 'CEDAR_NATIVE_CAPTURE_ROUTINE_STDOUT_NOT_RETAINED'

$nonzeroRejected = $false
try { $null = Invoke-NativeCaptureProbe 9 '1 passed' } catch { $nonzeroRejected = $true }
Assert-True $nonzeroRejected 'CEDAR_NATIVE_CAPTURE_NONZERO_NOT_REJECTED'

$failedSummaryRejected = $false
try { $null = Invoke-NativeCaptureProbe 0 '1 failed' } catch { $failedSummaryRejected = $true }
Assert-True $failedSummaryRejected 'CEDAR_NATIVE_CAPTURE_FAILED_SUMMARY_NOT_REJECTED'

Write-Output 'CEDAR_NATIVE_STDERR_REGRESSION_PASS'
