$ErrorActionPreference = 'Stop'

function Assert-SoilRxCaptureRegression([bool]$Condition, [string]$Failure) {
  if (-not $Condition) { throw $Failure }
}

function Assert-SoilRxCaptureShape([string]$Source) {
  $orderedNeedles = @(
    ". (Join-Path `$PSScriptRoot 'foundation-native-lane.ps1')",
    'function Assert-SoilRxCapture([bool]$Condition, [string]$Failure) {',
    'if (-not $Condition) { throw $Failure }',
    "`$runDirectory = Join-Path `$EvidenceRoot ([Guid]::NewGuid().ToString('N'))",
    "Invoke-FoundationNativeLane -Lane 'soil-rx-disposable'",
    '-LogRoot $runDirectory | Out-Null',
    'Assert-SoilRxCapture ($logs.Count -eq 1)',
    "`$passMarkers = @(`$logLines | Where-Object { `$_ -ceq 'SOIL_RX_DISPOSABLE_RLS_STORAGE_PASS' })",
    'Assert-SoilRxCapture ($passMarkers.Count -eq 1)',
    "`$exitMarkers = @(`$logLines | Where-Object { `$_ -ceq 'exitCode=0' })",
    'Assert-SoilRxCapture ($exitMarkers.Count -eq 1)',
    "`$causeMarkers = @(`$logLines | Where-Object { `$_ -ceq 'cause=success' })",
    'Assert-SoilRxCapture ($causeMarkers.Count -eq 1)',
    '[IO.File]::WriteAllLines($receiptPath, @(',
    "Write-Output 'SOIL_RX_DISPOSABLE_CAPTURE_PASS'"
  )
  $cursor = -1
  foreach ($needle in $orderedNeedles) {
    $next = $Source.IndexOf($needle, $cursor + 1, [StringComparison]::Ordinal)
    Assert-SoilRxCaptureRegression ($next -gt $cursor) "SOIL_RX_DISPOSABLE_CAPTURE_ORDER_MISSING:$needle"
    $cursor = $next
  }
  Assert-SoilRxCaptureRegression ([regex]::Matches($Source, [regex]::Escape("Invoke-FoundationNativeLane -Lane 'soil-rx-disposable'")).Count -eq 1) 'SOIL_RX_DISPOSABLE_CAPTURE_NATIVE_INVOCATION_COUNT'
  Assert-SoilRxCaptureRegression ([regex]::Matches($Source, [regex]::Escape("SOIL_RX_DISPOSABLE_RLS_STORAGE_PASS")).Count -eq 2) 'SOIL_RX_DISPOSABLE_CAPTURE_MARKER_CUSTODY_COUNT'
  Assert-SoilRxCaptureRegression ([regex]::Matches($Source, [regex]::Escape('if (-not $Condition) { throw $Failure }')).Count -eq 1) 'SOIL_RX_DISPOSABLE_CAPTURE_ASSERTION_BODY_COUNT'
  Assert-SoilRxCaptureRegression ([regex]::Matches($Source, [regex]::Escape("`$runDirectory = Join-Path `$EvidenceRoot ([Guid]::NewGuid().ToString('N'))")).Count -eq 1) 'SOIL_RX_DISPOSABLE_CAPTURE_UNIQUE_DIRECTORY_COUNT'
}

$capturePath = Join-Path $PSScriptRoot 'verify-soil-rx-disposable-capture.ps1'
$capture = Get-Content -Raw -Encoding UTF8 -LiteralPath $capturePath
Assert-SoilRxCaptureShape $capture

$mutations = @(
  @{ Name = 'duplicate-log-acceptance'; Before = '($logs.Count -eq 1)'; After = '($logs.Count -ge 1)' },
  @{ Name = 'missing-pass-marker-acceptance'; Before = '($passMarkers.Count -eq 1)'; After = '($passMarkers.Count -ge 0)' },
  @{ Name = 'nonzero-exit-acceptance'; Before = "`$_ -ceq 'exitCode=0'"; After = "`$_ -like 'exitCode=*'" },
  @{ Name = 'failed-capture-acceptance'; Before = "`$_ -ceq 'cause=success'"; After = "`$_ -like 'cause=*'" },
  @{ Name = 'durable-receipt-removal'; Before = '[IO.File]::WriteAllLines($receiptPath, @('; After = '$null = $receiptPath' },
  @{ Name = 'assertion-failure-bypass'; Before = 'if (-not $Condition) { throw $Failure }'; After = 'if ($false) { throw $Failure }' },
  @{ Name = 'unique-run-directory-removal'; Before = "`$runDirectory = Join-Path `$EvidenceRoot ([Guid]::NewGuid().ToString('N'))"; After = "`$runDirectory = Join-Path `$EvidenceRoot 'shared'" }
)

foreach ($mutation in $mutations) {
  $mutant = $capture.Replace($mutation.Before, $mutation.After)
  Assert-SoilRxCaptureRegression ($mutant -cne $capture) "SOIL_RX_DISPOSABLE_CAPTURE_MUTATION_NOT_APPLIED:$($mutation.Name)"
  $rejected = $false
  try { Assert-SoilRxCaptureShape $mutant } catch { $rejected = $true }
  Assert-SoilRxCaptureRegression $rejected "SOIL_RX_DISPOSABLE_CAPTURE_MUTATION_SURVIVED:$($mutation.Name)"
}

Write-Output 'SOIL_RX_DISPOSABLE_CAPTURE_REGRESSION_PASS'
