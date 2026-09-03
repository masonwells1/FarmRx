[CmdletBinding()]
param(
  [string]$EvidenceRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'foundation-native-lane.ps1')

function Get-SoilRxCaptureShell {
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    return (Join-Path $PSHOME 'powershell.exe')
  }
  if ($IsWindows) {
    return (Join-Path $PSHOME 'pwsh.exe')
  }
  return (Join-Path $PSHOME 'pwsh')
}

function Assert-SoilRxCapture([bool]$Condition, [string]$Failure) {
  if (-not $Condition) { throw $Failure }
}

if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
  $localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if ([string]::IsNullOrWhiteSpace($localData)) { throw 'Soil Rx disposable capture cannot resolve its durable local evidence root.' }
  $EvidenceRoot = Join-Path $localData 'FarmRx\soil-rx-disposable-capture'
}

$rawProof = Join-Path $PSScriptRoot 'verify-soil-rx-disposable.ps1'
Assert-SoilRxCapture (Test-Path -LiteralPath $rawProof -PathType Leaf) "Soil Rx disposable capture cannot find raw proof: $rawProof"

$runDirectory = Join-Path $EvidenceRoot ([Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($runDirectory) | Out-Null
$captureShell = Get-SoilRxCaptureShell

Invoke-FoundationNativeLane -Lane 'soil-rx-disposable' -Executable $captureShell -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $rawProof) -Failure 'Disposable Soil Rx capture failed.' -LogRoot $runDirectory | Out-Null

$logs = @(Get-ChildItem -LiteralPath $runDirectory -File -Filter '*.log')
Assert-SoilRxCapture ($logs.Count -eq 1) "Soil Rx disposable capture expected exactly one durable log, observed $($logs.Count): $runDirectory"
$logPath = $logs[0].FullName
$logLines = @(Get-Content -LiteralPath $logPath -Encoding UTF8)
$passMarkers = @($logLines | Where-Object { $_ -ceq 'SOIL_RX_DISPOSABLE_RLS_STORAGE_PASS' })
Assert-SoilRxCapture ($passMarkers.Count -eq 1) "Soil Rx disposable capture requires exactly one PASS marker, observed $($passMarkers.Count): $logPath"
$exitMarkers = @($logLines | Where-Object { $_ -ceq 'exitCode=0' })
Assert-SoilRxCapture ($exitMarkers.Count -eq 1) "Soil Rx disposable capture requires exactly one zero exit receipt, observed $($exitMarkers.Count): $logPath"
$causeMarkers = @($logLines | Where-Object { $_ -ceq 'cause=success' })
Assert-SoilRxCapture ($causeMarkers.Count -eq 1) "Soil Rx disposable capture requires exactly one successful capture receipt, observed $($causeMarkers.Count): $logPath"

$receiptPath = Join-Path $runDirectory 'soil-rx-disposable-capture.receipt'
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllLines($receiptPath, @(
  'schema=farm-rx-soil-rx-disposable-capture-v1',
  "capturedLogPath=$logPath",
  "capturedLogSha256=$((Get-FileHash -LiteralPath $logPath -Algorithm SHA256).Hash.ToLowerInvariant())",
  'requiredMarker=SOIL_RX_DISPOSABLE_RLS_STORAGE_PASS',
  "requiredMarkerCount=$($passMarkers.Count)",
  'capturedExitCode=0',
  'capturedCause=success',
  "completedAtUtc=$([DateTime]::UtcNow.ToString('o'))"
), $utf8)

Write-Output 'SOIL_RX_DISPOSABLE_CAPTURE_PASS'
Write-Output "SOIL_RX_DISPOSABLE_CAPTURE_LOG:$logPath"
Write-Output "SOIL_RX_DISPOSABLE_CAPTURE_RECEIPT:$receiptPath"
