param(
  [switch]$SkipOwnerIntegration,
  [ValidatePattern('^[A-Za-z0-9]*$')][string]$StubSuffix = '',
  [switch]$InjectPrimaryFailure,
  [ValidateSet('none','first','second','both')][string]$InjectCleanupFailure = 'none'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'foundation-native-lane.ps1')

function Assert-FoundationNative([bool]$Value,[string]$Message) {
  if (-not $Value) { throw $Message }
}

function Invoke-FoundationRegressionOwnerLane([scriptblock]$Command,[string]$Failure) {
  $global:LASTEXITCODE = 0
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Get-FoundationVisibleFunctionState([string]$Name) {
  if ($Name -cnotmatch '^Invoke-Foundation(?:MissingExit|CaptureFailure)Stub[A-Za-z0-9]*$') { throw "Invalid owned global function name: $Name" }
  $path = "Function:\$Name"
  $item = Get-Command -Name $Name -CommandType Function -ErrorAction SilentlyContinue
  if ($null -eq $item) {
    return [pscustomobject]@{ Exists = $false; Path = $path; ScriptBlock = $null; Definition = $null; Options = $null }
  }
  return [pscustomobject]@{ Exists = $true; Path = $path; ScriptBlock = $item.ScriptBlock; Definition = $item.ScriptBlock.ToString(); Options = $item.Options }
}

function Set-FoundationScriptFunction([string]$Name,[scriptblock]$ScriptBlock) {
  if ($Name -cnotmatch '^Invoke-Foundation(?:MissingExit|CaptureFailure)Stub[A-Za-z0-9]*$') { throw "Invalid owned global function name: $Name" }
  $definition = [scriptblock]::Create("function script:$Name {`n$($ScriptBlock.ToString())`n}")
  & $definition
  $installed = Get-FoundationVisibleFunctionState $Name
  if (-not $installed.Exists -or $installed.Definition.Trim() -cne $ScriptBlock.ToString().Trim()) { throw "FOUNDATION_NATIVE_STUB_INSTALL_MISMATCH:$Name" }
  return $installed
}

function Assert-FoundationNativeSource([string]$Source) {
  $uniqueLogAssignment = '$logPath = Join-Path $LogRoot ("{0}-{1}-{2}.log" -f [DateTime]::UtcNow.ToString(''yyyyMMddTHHmmssfffZ''), $safeLane, [Guid]::NewGuid().ToString(''N''))'
  $uniqueLog = $Source.IndexOf($uniqueLogAssignment)
  $continue = $Source.IndexOf("`$ErrorActionPreference = 'Continue'")
  $invoke = $Source.IndexOf('$output = @(& $Executable @Arguments 2>&1)', $continue)
  $exit = $Source.IndexOf('$exitCode = [int]$LASTEXITCODE', $invoke)
  $finally = $Source.IndexOf('} finally {', $exit)
  $restore = $Source.IndexOf('$ErrorActionPreference = $priorErrorActionPreference', $finally)
  $durable = $Source.IndexOf('[IO.File]::AppendAllLines($logPath, $durableLines, $utf8)', $restore)
  $hostReplay = $Source.IndexOf('([string]$line) | Out-Host', $durable)
  $captureGuard = $Source.IndexOf('if ($null -ne $captureFailure) {', $hostReplay)
  $captureRefusal = $Source.IndexOf('[Exception[]]@($captureFailure))', $captureGuard)
  $missingExitGuard = $Source.IndexOf('if ($null -eq $exitCode) {', $captureRefusal)
  $missingExitRefusal = $Source.IndexOf('throw "$Failure Native process ended without an exit code; durable log: $logPath"', $missingExitGuard)
  $guard = $Source.IndexOf('if ([int]$exitCode -ne 0) {', $missingExitRefusal)
  $success = $Source.IndexOf('return $true', $guard)
  Assert-FoundationNative ($uniqueLog -ge 0 -and $continue -gt $uniqueLog -and $invoke -gt $continue -and $exit -gt $invoke -and $finally -gt $exit -and $restore -gt $finally -and $durable -gt $restore -and $hostReplay -gt $durable -and $captureGuard -gt $hostReplay -and $captureRefusal -gt $captureGuard -and $missingExitGuard -gt $captureRefusal -and $missingExitRefusal -gt $missingExitGuard -and $guard -gt $missingExitRefusal -and $success -gt $guard) 'Foundation native lane does not bind unique evidence, capture, restore, persist, replay, refuse capture/missing/nonzero exits, and return scalar success in exact order.'
  Assert-FoundationNative ([regex]::Matches($Source,[regex]::Escape($uniqueLogAssignment)).Count -eq 1) 'Foundation native lane log assignment is not exactly one unique timestamp-plus-GUID path.'
  Assert-FoundationNative ($Source.Contains('FOUNDATION_NATIVE_LANE_EXIT:${Lane}:') -and $Source.Contains('FOUNDATION_NATIVE_LANE_LOG:${Lane}:$logPath')) 'Foundation native lane does not report exact exit and log identity.'
  Assert-FoundationNative ($Source.Contains("'missing-native-exit-code'") -and $Source.Contains('outputCount=$($output.Count)') -and $Source.Contains('cause=$cause')) 'Foundation native lane does not preserve the no-output/missing-exit cause.'
  Assert-FoundationNative (-not $Source.Contains('playwright-report') -and -not $Source.Contains('report.stats')) 'Foundation native lane can infer success from a report instead of the native exit.'
  Assert-FoundationNative (-not $Source.Contains('Write-Output $line')) 'Foundation native transcript replay pollutes the success stream.'
}

$helperPath = Join-Path $PSScriptRoot 'foundation-native-lane.ps1'
$helper = Get-Content -Raw -Encoding UTF8 -LiteralPath $helperPath
Assert-FoundationNativeSource $helper
$mutations = @(
  $helper.Replace("`$ErrorActionPreference = 'Continue'", "`$ErrorActionPreference = 'Stop'"),
  $helper.Replace('$exitCode = [int]$LASTEXITCODE', '$exitCode = 0'),
  $helper.Replace('} finally {', '} if ($true) {'),
  $helper.Replace('$ErrorActionPreference = $priorErrorActionPreference', "`$ErrorActionPreference = 'Continue'"),
  $helper.Replace('[IO.File]::AppendAllLines($logPath, $durableLines, $utf8)', '$null = $durableLines'),
  $helper.Replace('([string]$line) | Out-Host', 'Write-Output $line'),
  $helper.Replace('if ([int]$exitCode -ne 0) {', 'if ($false) {'),
  $helper.Replace('if ([int]$exitCode -ne 0) {', "if ([int]`$exitCode -ne 0 -and -not (Test-Path 'playwright-report/index.html')) {"),
  $helper.Replace("[Guid]::NewGuid().ToString('N')", "'shared'"),
  $helper.Replace('$logPath = Join-Path $LogRoot ("{0}-{1}-{2}.log" -f [DateTime]::UtcNow.ToString(''yyyyMMddTHHmmssfffZ''), $safeLane, [Guid]::NewGuid().ToString(''N''))', "`$unusedUnique = [Guid]::NewGuid().ToString('N')`n  `$logPath = Join-Path `$LogRoot (`"{0}-{1}.log`" -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), `$safeLane)"),
  $helper.Replace('if ($null -eq $exitCode) {', 'if ($false) {'),
  $helper.Replace('if ($null -ne $captureFailure) {', 'if ($false) {')
)
$mutationIndex = 0
foreach ($mutation in $mutations) {
  $mutationIndex++
  Assert-FoundationNative ($mutation -cne $helper) "Foundation native mutation $mutationIndex did not alter source."
  $rejected = $false
  try { Assert-FoundationNativeSource $mutation } catch { $rejected = $true }
  Assert-FoundationNative $rejected "Foundation native mutation $mutationIndex survived."
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-foundation-native-lane-{0}" -f [Guid]::NewGuid().ToString('N'))
$logRoot = Join-Path $tempRoot 'logs'
$successStub = Join-Path $tempRoot 'success.ps1'
$failureStub = Join-Path $tempRoot 'failure.ps1'
$noOutputStub = Join-Path $tempRoot 'no-output.ps1'
$hostTranscript = Join-Path $tempRoot 'host.txt'
$sentinelProbe = Join-Path $tempRoot 'sentinel-probe.ps1'
$probeShell = if ($PSVersionTable.PSEdition -eq 'Desktop') { Join-Path $PSHOME 'powershell.exe' } elseif ($IsWindows) { Join-Path $PSHOME 'pwsh.exe' } else { Join-Path $PSHOME 'pwsh' }
$priorPreference = $ErrorActionPreference
$missingExitStubName = "Invoke-FoundationMissingExitStub$StubSuffix"
$captureFailureStubName = "Invoke-FoundationCaptureFailureStub$StubSuffix"
$stubDefinitions = [ordered]@{
  $missingExitStubName = { Write-Output 'FOUNDATION_NATIVE_MISSING_EXIT_PASS' }
  $captureFailureStubName = { throw 'FOUNDATION_NATIVE_CAPTURE_STUB_FAIL' }
}
$stubStates = [ordered]@{}
$ownedStubStates = [ordered]@{}
$installedStubNames = [Collections.Generic.List[string]]::new()
$cleanupFailures = [Collections.Generic.List[Exception]]::new()
$primaryFailure = $null
$cleanupFailureInjected = [Collections.Generic.List[int]]::new()

try {
  foreach ($stubName in $stubDefinitions.Keys) {
    $priorState = Get-FoundationVisibleFunctionState $stubName
    $stubStates[$stubName] = $priorState
    $ownedStubStates[$stubName] = Set-FoundationScriptFunction $stubName $stubDefinitions[$stubName]
    $installedStubNames.Add($stubName)
  }
  if ($InjectPrimaryFailure) { throw 'FOUNDATION_NATIVE_PRIMARY_STUB_FAIL' }

  [IO.Directory]::CreateDirectory($tempRoot) | Out-Null
  Set-Content -LiteralPath $successStub -Encoding UTF8 -NoNewline -Value "[Console]::Out.WriteLine('FOUNDATION_NATIVE_STDOUT_PASS')`n[Console]::Error.WriteLine('FOUNDATION_NATIVE_STDERR_PASS')`nexit 0"
  Set-Content -LiteralPath $failureStub -Encoding UTF8 -NoNewline -Value "[Console]::Error.WriteLine('FOUNDATION_NATIVE_STDERR_FAIL')`nexit 37"
  Set-Content -LiteralPath $noOutputStub -Encoding UTF8 -NoNewline -Value 'exit 29'
  Set-Content -LiteralPath $sentinelProbe -Encoding UTF8 -NoNewline -Value @'
param(
  [Parameter(Mandatory=$true)][string]$RegressionPath,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9]+$')][string]$Suffix,
  [Parameter(Mandatory=$true)][ValidateSet('success','primary','first','second','both','primary-first','primary-second','primary-both')][string]$Mode
)

$ErrorActionPreference = 'Stop'

function Assert-SentinelProbe([bool]$Value,[string]$Message) {
  if (-not $Value) { throw $Message }
}

function Get-SentinelState([string]$Name) {
  if ($Name -cnotmatch '^Invoke-Foundation(?:MissingExit|CaptureFailure)Stub[A-Za-z0-9]+$') { throw "Invalid sentinel name: $Name" }
  $path = "Function:\$Name"
  $item = Get-Command -Name $Name -CommandType Function -ErrorAction SilentlyContinue
  if ($null -eq $item) { return [pscustomobject]@{ Exists=$false; Path=$path; Definition=$null; Options=$null } }
  return [pscustomobject]@{ Exists=$true; Path=$path; Definition=$item.ScriptBlock.ToString(); Options=$item.Options }
}

function Install-OwnedSentinel([string]$Name,[scriptblock]$Body) {
  $prior = Get-SentinelState $Name
  if ($prior.Exists) { throw "FOUNDATION_SENTINEL_COLLISION_REFUSED:$Name" }
  $definition = [scriptblock]::Create("function global:$Name {`n$($Body.ToString())`n}")
  & $definition
  $owned = Get-SentinelState $Name
  if (-not $owned.Exists -or $owned.Definition.Trim() -cne $Body.ToString().Trim()) { throw "FOUNDATION_SENTINEL_INSTALL_MISMATCH:$Name" }
  return [pscustomobject]@{ Name=$Name; Prior=$prior; Owned=$owned }
}

function Invoke-SentinelCustodyCase([string]$CaseMode) {
  $missingName = "Invoke-FoundationMissingExitStub$Suffix"
  $captureName = "Invoke-FoundationCaptureFailureStub$Suffix"
  $ownedSentinels = [Collections.Generic.List[object]]::new()
  $sentinelCleanupFailures = [Collections.Generic.List[Exception]]::new()
  $sentinelCleanupAttempts = [Collections.Generic.List[int]]::new()
  $sentinelPrimaryFailure = $null
  $cleanupMode = if ($CaseMode -like 'primary-*') { $CaseMode.Substring(8) } elseif ($CaseMode -in @('first','second','both')) { $CaseMode } else { 'none' }

  try {
    $ownedSentinels.Add((Install-OwnedSentinel $missingName { 'FOUNDATION_OWNER_SENTINEL_MISSING' }))
    $ownedSentinels.Add((Install-OwnedSentinel $captureName { 'FOUNDATION_OWNER_SENTINEL_CAPTURE' }))

    $collisionState = Get-SentinelState $missingName
    $collisionRefused = $false
    try { Install-OwnedSentinel $missingName { 'FOUNDATION_UNRELATED_COLLISION' } | Out-Null } catch { $collisionRefused = $_.Exception.Message -ceq "FOUNDATION_SENTINEL_COLLISION_REFUSED:$missingName" }
    $afterCollision = Get-SentinelState $missingName
    Assert-SentinelProbe ($collisionRefused -and $afterCollision.Definition -ceq $collisionState.Definition -and $afterCollision.Options -eq $collisionState.Options) 'Sentinel collision was not refused without changing the owned definition.'

    $invokeParameters = @{ SkipOwnerIntegration=$true; StubSuffix=$Suffix }
    if ($CaseMode -like 'primary*') { $invokeParameters.InjectPrimaryFailure = $true }
    $output = @(& $RegressionPath @invokeParameters)
    Assert-SentinelProbe ($output.Count -eq 1 -and $output[0] -ceq 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS' -and $LASTEXITCODE -eq 0) "Sentinel nested owner did not return exact PASS and exit zero: mode=$CaseMode output=$($output -join '|') exit=$LASTEXITCODE"
  } catch {
    $sentinelPrimaryFailure = $_.Exception
  } finally {
    for ($sentinelIndex=$ownedSentinels.Count-1; $sentinelIndex -ge 0; $sentinelIndex--) {
      $sentinel = $ownedSentinels[$sentinelIndex]
      $sentinelCleanupOrdinal = $ownedSentinels.Count - $sentinelIndex
      $sentinelCleanupAttempts.Add($sentinelCleanupOrdinal)
      try {
        $current = Get-SentinelState $sentinel.Name
        if (-not $current.Exists -or $current.Definition -cne $sentinel.Owned.Definition -or $current.Options -ne $sentinel.Owned.Options) { throw "FOUNDATION_SENTINEL_OWNERSHIP_LOST:$($sentinel.Name)" }
        $injectSentinelCleanup = $cleanupMode -ceq 'both' -or ($cleanupMode -ceq 'first' -and $sentinelCleanupOrdinal -eq 1) -or ($cleanupMode -ceq 'second' -and $sentinelCleanupOrdinal -eq 2)
        if ($injectSentinelCleanup) {
          try { throw "FOUNDATION_SENTINEL_INJECTED_CLEANUP_$($sentinelCleanupOrdinal)_FAILURE" } catch { $sentinelCleanupFailures.Add($_.Exception) }
        }
        Remove-Item -LiteralPath $sentinel.Prior.Path -Force -ErrorAction Stop
        $after = Get-SentinelState $sentinel.Name
        if ($sentinel.Prior.Exists) {
          if (-not $after.Exists -or $after.Definition -cne $sentinel.Prior.Definition -or $after.Options -ne $sentinel.Prior.Options) { throw "FOUNDATION_SENTINEL_RESTORE_MISMATCH:$($sentinel.Name)" }
        } elseif ($after.Exists) { throw "FOUNDATION_SENTINEL_REMOVE_MISMATCH:$($sentinel.Name)" }
      } catch { $sentinelCleanupFailures.Add($_.Exception) }
    }
    if ($sentinelCleanupAttempts.Count -ne 2 -or $sentinelCleanupAttempts[0] -ne 1 -or $sentinelCleanupAttempts[1] -ne 2) {
      $sentinelCleanupFailures.Add([InvalidOperationException]::new("FOUNDATION_SENTINEL_CLEANUP_ATTEMPT_ORDER:$($sentinelCleanupAttempts -join ',')"))
    }
  }

  if ($sentinelPrimaryFailure -and $sentinelCleanupFailures.Count) { throw [AggregateException]::new('Sentinel probe primary and cleanup failures.',[Exception[]]@($sentinelPrimaryFailure) + [Exception[]]$sentinelCleanupFailures.ToArray()) }
  if ($sentinelCleanupFailures.Count) { throw [AggregateException]::new('Sentinel probe cleanup failed.',[Exception[]]$sentinelCleanupFailures.ToArray()) }
  if ($sentinelPrimaryFailure) { throw $sentinelPrimaryFailure }
  Write-Output 'FOUNDATION_SENTINEL_CUSTODY_CASE_PASS'
}

$missingName = "Invoke-FoundationMissingExitStub$Suffix"
$captureName = "Invoke-FoundationCaptureFailureStub$Suffix"
$caught = $null
$caseOutput = @()
try { $caseOutput = @(Invoke-SentinelCustodyCase $Mode) } catch { $caught = $_.Exception }

$cleanupMode = if ($Mode -like 'primary-*') { $Mode.Substring(8) } elseif ($Mode -in @('first','second','both')) { $Mode } else { 'none' }
$expectedCleanup = switch ($cleanupMode) { 'first' { 1 } 'second' { 1 } 'both' { 2 } default { 0 } }
$expectsPrimary = $Mode -like 'primary*'
if (-not $expectsPrimary -and $expectedCleanup -eq 0) {
  Assert-SentinelProbe ($null -eq $caught -and $caseOutput.Count -eq 1 -and $caseOutput[0] -ceq 'FOUNDATION_SENTINEL_CUSTODY_CASE_PASS') 'Sentinel success did not return exact custody PASS.'
} else {
  Assert-SentinelProbe ($null -ne $caught) "Sentinel mode $Mode did not fail closed."
  if ($expectsPrimary -and $expectedCleanup -eq 0) {
    Assert-SentinelProbe ($caught.Message -ceq 'FOUNDATION_NATIVE_PRIMARY_STUB_FAIL') 'Sentinel primary-only failure changed.'
  } else {
    Assert-SentinelProbe ($caught -is [AggregateException]) "Sentinel mode $Mode did not return an aggregate failure."
    $expectedMessages = [Collections.Generic.List[string]]::new()
    if ($expectsPrimary) { $expectedMessages.Add('FOUNDATION_NATIVE_PRIMARY_STUB_FAIL') }
    if ($cleanupMode -in @('first','both')) { $expectedMessages.Add('FOUNDATION_SENTINEL_INJECTED_CLEANUP_1_FAILURE') }
    if ($cleanupMode -in @('second','both')) { $expectedMessages.Add('FOUNDATION_SENTINEL_INJECTED_CLEANUP_2_FAILURE') }
    Assert-SentinelProbe ($caught.InnerExceptions.Count -eq $expectedMessages.Count) "Sentinel mode $Mode returned the wrong number of causes."
    for ($causeIndex=0; $causeIndex -lt $expectedMessages.Count; $causeIndex++) {
      Assert-SentinelProbe ($caught.InnerExceptions[$causeIndex].Message -ceq $expectedMessages[$causeIndex]) "Sentinel mode $Mode changed deterministic cause order at $causeIndex."
    }
  }
}

Assert-SentinelProbe ($null -eq (Get-Command -Name $missingName -CommandType Function -ErrorAction SilentlyContinue) -and $null -eq (Get-Command -Name $captureName -CommandType Function -ErrorAction SilentlyContinue)) 'Sentinel globals remained after the custody case.'
$global:LASTEXITCODE = 0
Write-Output "FOUNDATION_NATIVE_SENTINEL_PROBE_PASS:$Mode"
'@

  $missingExitRefused = $false
  try {
    Invoke-FoundationNativeLane -Lane 'missing-exit-stub' -Executable $missingExitStubName -Arguments @('probe') -Failure 'Missing-exit stub refused.' -LogRoot $logRoot
  } catch {
    $missingExitRefused = $_.Exception.Message -match '^Missing-exit stub refused\. Native process ended without an exit code; durable log: .+missing-exit-stub-.+\.log$'
  }
  Assert-FoundationNative $missingExitRefused 'A completed command with no native exit code did not fail closed with exact log identity.'
  Assert-FoundationNative ($ErrorActionPreference -ceq $priorPreference) 'Missing-exit path did not restore ErrorActionPreference.'

  $captureFailureRefused = $false
  try {
    Invoke-FoundationNativeLane -Lane 'capture-exception-stub' -Executable $captureFailureStubName -Arguments @('probe') -Failure 'Capture-failure stub refused.' -LogRoot $logRoot
  } catch {
    $captureFailureRefused = $_.Exception -is [AggregateException] -and $_.Exception.Message -match '^Capture-failure stub refused\. Native capture failed; durable log: .+capture-exception-stub-.+\.log' -and $_.Exception.InnerExceptions.Count -eq 1 -and $_.Exception.InnerExceptions[0].Message -eq 'FOUNDATION_NATIVE_CAPTURE_STUB_FAIL'
  }
  Assert-FoundationNative $captureFailureRefused 'A capture exception did not retain its primary failure and exact durable log identity.'
  Assert-FoundationNative ($ErrorActionPreference -ceq $priorPreference) 'Capture-failure path did not restore ErrorActionPreference.'

  Start-Transcript -LiteralPath $hostTranscript -Force | Out-Null
  try {
    $success = @(Invoke-FoundationNativeLane -Lane 'success-stub' -Executable $probeShell -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',$successStub) -Failure 'Success stub failed.' -LogRoot $logRoot)
  } finally {
    Stop-Transcript | Out-Null
  }
  Assert-FoundationNative ($success.Count -eq 1 -and $success[0] -is [bool] -and $success[0] -eq $true) 'Routine native stderr with exit zero did not return exactly one scalar true.'
  Assert-FoundationNative ($ErrorActionPreference -ceq $priorPreference) 'Success path did not restore ErrorActionPreference.'
  $hostTranscriptText = [IO.File]::ReadAllText($hostTranscript)
  Assert-FoundationNative ($hostTranscriptText.Contains('FOUNDATION_NATIVE_STDOUT_PASS') -and $hostTranscriptText.Contains('FOUNDATION_NATIVE_STDERR_PASS') -and $hostTranscriptText.Contains('FOUNDATION_NATIVE_LANE_EXIT:success-stub:0') -and $hostTranscriptText.Contains('FOUNDATION_NATIVE_LANE_LOG:success-stub:')) 'Host replay or exact success identity was lost.'

  $failureRefused = $false
  try {
    Invoke-FoundationNativeLane -Lane 'failure-stub' -Executable $probeShell -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',$failureStub) -Failure 'Failure stub refused.' -LogRoot $logRoot
  } catch {
    $failureRefused = $_.Exception.Message -match '^Failure stub refused\. Native exit code 37; durable log: .+failure-stub-.+\.log$'
  }
  Assert-FoundationNative $failureRefused 'Native stderr plus nonzero exit did not fail closed with exact exit/log identity.'
  Assert-FoundationNative ($ErrorActionPreference -ceq $priorPreference) 'Failure path did not restore ErrorActionPreference.'

  $noOutputRefused = $false
  try {
    Invoke-FoundationNativeLane -Lane 'no-output-stub' -Executable $probeShell -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File',$noOutputStub) -Failure 'No-output stub refused.' -LogRoot $logRoot
  } catch {
    $noOutputRefused = $_.Exception.Message -match '^No-output stub refused\. Native exit code 29; durable log: .+no-output-stub-.+\.log$'
  }
  Assert-FoundationNative $noOutputRefused 'No-output native finalization did not fail closed with exact exit/log identity.'
  Assert-FoundationNative ($ErrorActionPreference -ceq $priorPreference) 'No-output path did not restore ErrorActionPreference.'

  $logs = @(Get-ChildItem -LiteralPath $logRoot -File -Filter '*.log' -ErrorAction Stop)
  Assert-FoundationNative ($logs.Count -eq 5 -and @($logs.Name | Sort-Object -Unique).Count -eq 5) 'Native lane did not create five unique durable logs.'
  $successLog = Get-Content -Raw -LiteralPath ($logs | Where-Object Name -like '*success-stub*').FullName
  $failureLog = Get-Content -Raw -LiteralPath ($logs | Where-Object Name -like '*failure-stub*').FullName
  $noOutputLog = Get-Content -Raw -LiteralPath ($logs | Where-Object Name -like '*no-output-stub*').FullName
  $missingExitLog = Get-Content -Raw -LiteralPath ($logs | Where-Object Name -like '*missing-exit-stub*').FullName
  $captureFailureLog = Get-Content -Raw -LiteralPath ($logs | Where-Object Name -like '*capture-exception-stub*').FullName
  Assert-FoundationNative ($successLog.Contains('FOUNDATION_NATIVE_STDOUT_PASS') -and $successLog.Contains('FOUNDATION_NATIVE_STDERR_PASS') -and $successLog.Contains('exitCode=0') -and $successLog.Contains('cause=success')) 'Success durable native log is incomplete.'
  Assert-FoundationNative ($failureLog.Contains('FOUNDATION_NATIVE_STDERR_FAIL') -and $failureLog.Contains('exitCode=37') -and $failureLog.Contains('cause=native-exit-37')) 'Nonzero durable native log lost output, exit, or cause.'
  Assert-FoundationNative ($noOutputLog.Contains('outputCount=0') -and $noOutputLog.Contains('exitCode=29') -and $noOutputLog.Contains('cause=native-exit-29')) 'No-output durable native log lost exit or cause.'
  Assert-FoundationNative ($missingExitLog.Contains('FOUNDATION_NATIVE_MISSING_EXIT_PASS') -and $missingExitLog.Contains('exitCode=<missing>') -and $missingExitLog.Contains('cause=missing-native-exit-code')) 'Missing-exit durable native log lost output, missing exit, or cause.'
  Assert-FoundationNative ($captureFailureLog.Contains('exitCode=<missing>') -and $captureFailureLog.Contains('cause=capture-exception:') -and $captureFailureLog.Contains('FOUNDATION_NATIVE_CAPTURE_STUB_FAIL')) 'Capture-failure durable native log lost the exception, missing exit, or cause.'

  if (-not $SkipOwnerIntegration) {
    $ownerFailureRefused = $false
    try {
      Invoke-FoundationRegressionOwnerLane { & $probeShell -NoProfile -Command 'exit 41' } 'Controlled owner child failure.'
    } catch {
      $ownerFailureRefused = $_.Exception.Message -ceq 'Controlled owner child failure.' -and $LASTEXITCODE -eq 41
    }
    Assert-FoundationNative $ownerFailureRefused 'Owner integration masked a genuine child failure.'

    $ownerOutput = @(Invoke-FoundationRegressionOwnerLane { & $PSCommandPath -SkipOwnerIntegration -StubSuffix 'OwnerNoPrior' } 'Owner integration regression failed.')
    Assert-FoundationNative ($ownerOutput.Count -eq 1 -and $ownerOutput[0] -ceq 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS') 'Owner integration did not receive exactly one regression PASS marker.'
    Assert-FoundationNative ($LASTEXITCODE -eq 0) 'Owner integration regression poisoned caller-visible LASTEXITCODE.'

    foreach ($name in @('Invoke-FoundationMissingExitStubOwnerNoPrior','Invoke-FoundationCaptureFailureStubOwnerNoPrior')) {
      Assert-FoundationNative ($null -eq (Get-Command -Name $name -CommandType Function -ErrorAction SilentlyContinue)) 'Owner success left a no-prior scoped stub behind.'
    }

    $failureThrew = $false
    try { & $PSCommandPath -SkipOwnerIntegration -StubSuffix 'OwnerFailure' -InjectPrimaryFailure } catch { $failureThrew = $_.Exception.Message -ceq 'FOUNDATION_NATIVE_PRIMARY_STUB_FAIL' }
    Assert-FoundationNative $failureThrew 'Owner primary-failure probe did not retain its exact failure.'
    foreach ($name in @('Invoke-FoundationMissingExitStubOwnerFailure','Invoke-FoundationCaptureFailureStubOwnerFailure')) {
      Assert-FoundationNative ($null -eq (Get-Command -Name $name -CommandType Function -ErrorAction SilentlyContinue)) 'Owner failure left a no-prior scoped stub behind.'
    }

    $scopedCleanupRefused = $false
    try { & $PSCommandPath -SkipOwnerIntegration -StubSuffix 'OwnerScopedCleanup' -InjectPrimaryFailure -InjectCleanupFailure both } catch {
      $scopedCleanupRefused = $_.Exception -is [AggregateException] -and $_.Exception.InnerExceptions.Count -eq 3 -and $_.Exception.InnerExceptions[0].Message -ceq 'FOUNDATION_NATIVE_PRIMARY_STUB_FAIL' -and $_.Exception.InnerExceptions[1].Message -ceq 'FOUNDATION_NATIVE_INJECTED_CLEANUP_1_FAILURE' -and $_.Exception.InnerExceptions[2].Message -ceq 'FOUNDATION_NATIVE_INJECTED_CLEANUP_2_FAILURE'
    }
    Assert-FoundationNative $scopedCleanupRefused 'Script-scoped cleanup aggregation changed while repairing sentinel custody.'
    foreach ($name in @('Invoke-FoundationMissingExitStubOwnerScopedCleanup','Invoke-FoundationCaptureFailureStubOwnerScopedCleanup')) {
      Assert-FoundationNative ($null -eq (Get-Command -Name $name -CommandType Function -ErrorAction SilentlyContinue)) 'Script-scoped cleanup probe left a no-prior stub behind.'
    }

    $sentinelSuffix = "Owner$([Guid]::NewGuid().ToString('N'))"
    foreach ($sentinelMode in @('success','primary','first','second','both','primary-first','primary-second','primary-both')) {
      $probeOutput = @(& $probeShell -NoProfile -ExecutionPolicy Bypass -File $sentinelProbe -RegressionPath $PSCommandPath -Suffix $sentinelSuffix -Mode $sentinelMode 2>&1)
      $probeExit = $LASTEXITCODE
      $probeMarkers = @($probeOutput | Where-Object { [string]$_ -ceq "FOUNDATION_NATIVE_SENTINEL_PROBE_PASS:$sentinelMode" })
      Assert-FoundationNative ($probeExit -eq 0 -and $probeMarkers.Count -eq 1) "Sentinel probe failed for mode ${sentinelMode}: exit=$probeExit output=$($probeOutput -join ' | ')"
    }
  }
} catch {
  $primaryFailure = $_.Exception
} finally {
  for ($stubIndex = $installedStubNames.Count - 1; $stubIndex -ge 0; $stubIndex--) {
    $stubName = $installedStubNames[$stubIndex]
    $priorState = $stubStates[$stubName]
    try {
      $current = Get-FoundationVisibleFunctionState $stubName
      if (-not $current.Exists -or $current.Definition -cne $ownedStubStates[$stubName].Definition -or $current.Options -ne $ownedStubStates[$stubName].Options) { throw "FOUNDATION_NATIVE_STUB_OWNERSHIP_LOST:$stubName" }
      $cleanupOrdinal = $installedStubNames.Count - $stubIndex
      $injectThisCleanup = $InjectCleanupFailure -ceq 'both' -or ($InjectCleanupFailure -ceq 'first' -and $cleanupOrdinal -eq 1) -or ($InjectCleanupFailure -ceq 'second' -and $cleanupOrdinal -eq 2)
      if ($injectThisCleanup) {
        $cleanupFailureInjected.Add($cleanupOrdinal)
        try { throw "FOUNDATION_NATIVE_INJECTED_CLEANUP_$($cleanupOrdinal)_FAILURE" } catch { $cleanupFailures.Add($_.Exception) }
      }
      Remove-Item -LiteralPath $priorState.Path -Force -ErrorAction Stop
      $after = Get-FoundationVisibleFunctionState $stubName
      if ($priorState.Exists) {
        if (-not $after.Exists -or $after.Definition -cne $priorState.Definition -or $after.Options -ne $priorState.Options) { throw "FOUNDATION_NATIVE_STUB_RESTORE_MISMATCH:$stubName" }
      } elseif ($after.Exists) {
        throw "FOUNDATION_NATIVE_STUB_REMOVE_MISMATCH:$stubName"
      }
    } catch {
      $cleanupFailures.Add($_.Exception)
    }
  }
  if (Test-Path -LiteralPath $tempRoot) {
    try {
      $resolved = [IO.Path]::GetFullPath($tempRoot)
      $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
      if (-not $resolved.StartsWith($tempBase,[StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing foundation native regression cleanup outside temp.' }
      Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
    } catch {
      $cleanupFailures.Add($_.Exception)
    }
  }
}

if ($primaryFailure -and $cleanupFailures.Count) {
  throw [AggregateException]::new('Foundation native regression primary and cleanup failures.',[Exception[]]@($primaryFailure) + [Exception[]]$cleanupFailures.ToArray())
}
if ($cleanupFailures.Count) { throw [AggregateException]::new('Foundation native regression cleanup failed.',[Exception[]]$cleanupFailures.ToArray()) }
if ($primaryFailure) { throw $primaryFailure }
$expectedInjectedCleanupCount = if ($InjectCleanupFailure -ceq 'both') { 2 } elseif ($InjectCleanupFailure -ceq 'none') { 0 } else { 1 }
if ($cleanupFailureInjected.Count -ne $expectedInjectedCleanupCount) { throw "Requested cleanup failure was not exercised exactly: $InjectCleanupFailure" }
$global:LASTEXITCODE = 0
Write-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'
