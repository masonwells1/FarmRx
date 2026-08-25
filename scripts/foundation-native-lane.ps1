function Invoke-FoundationNativeLane {
  param(
    [Parameter(Mandatory)][string]$Lane,
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Failure,
    [string]$LogRoot
  )

  if ([string]::IsNullOrWhiteSpace($LogRoot)) {
    $localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrWhiteSpace($localData)) {
      throw 'Foundation native lane cannot resolve its durable local evidence root.'
    }
    $LogRoot = Join-Path $localData 'FarmRx\foundation-native-lanes'
  }
  [IO.Directory]::CreateDirectory($LogRoot) | Out-Null
  $safeLane = [regex]::Replace($Lane, '[^a-zA-Z0-9_-]', '-')
  $logPath = Join-Path $LogRoot ("{0}-{1}-{2}.log" -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), $safeLane, [Guid]::NewGuid().ToString('N'))
  $utf8 = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllLines($logPath, @(
    'schema=farm-rx-foundation-native-lane-v1',
    "lane=$Lane",
    "startedAtUtc=$([DateTime]::UtcNow.ToString('o'))",
    "executable=$Executable",
    "arguments=$([string]::Join(' ', $Arguments))",
    'outputBegin'
  ), $utf8)

  $priorErrorActionPreference = $ErrorActionPreference
  $output = @()
  $exitCode = $null
  $captureFailure = $null
  try {
    $ErrorActionPreference = 'Continue'
    try {
      $global:LASTEXITCODE = $null
      $output = @(& $Executable @Arguments 2>&1)
      if ($null -ne $LASTEXITCODE) { $exitCode = [int]$LASTEXITCODE }
    } catch {
      $captureFailure = $_.Exception
      if ($null -ne $LASTEXITCODE) { $exitCode = [int]$LASTEXITCODE }
    }
  } finally {
    $ErrorActionPreference = $priorErrorActionPreference
  }

  $cause = if ($null -ne $captureFailure) {
    "capture-exception:$($captureFailure.GetType().FullName):$($captureFailure.Message)"
  } elseif ($null -eq $exitCode) {
    'missing-native-exit-code'
  } elseif ([int]$exitCode -ne 0) {
    "native-exit-$exitCode"
  } else {
    'success'
  }
  $durableLines = New-Object System.Collections.Generic.List[string]
  foreach ($item in $output) { $durableLines.Add([string]$item) }
  $durableLines.Add('outputEnd')
  $durableLines.Add("outputCount=$($output.Count)")
  $durableLines.Add("exitCode=$(if($null -eq $exitCode){'<missing>'}else{[string]$exitCode})")
  $durableLines.Add("cause=$cause")
  $durableLines.Add("endedAtUtc=$([DateTime]::UtcNow.ToString('o'))")
  [IO.File]::AppendAllLines($logPath, $durableLines, $utf8)

  foreach ($line in $output) { ([string]$line) | Out-Host }
  "FOUNDATION_NATIVE_LANE_EXIT:${Lane}:$(if($null -eq $exitCode){'<missing>'}else{[string]$exitCode})" | Out-Host
  "FOUNDATION_NATIVE_LANE_LOG:${Lane}:$logPath" | Out-Host

  if ($null -ne $captureFailure) {
    throw [AggregateException]::new(
      "$Failure Native capture failed; durable log: $logPath",
      [Exception[]]@($captureFailure))
  }
  if ($null -eq $exitCode) {
    throw "$Failure Native process ended without an exit code; durable log: $logPath"
  }
  if ([int]$exitCode -ne 0) {
    throw "$Failure Native exit code $exitCode; durable log: $logPath"
  }
  return $true
}
