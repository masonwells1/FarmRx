param([switch]$StaticOnly,[switch]$DiagnosticSelfTest,[switch]$Proof005Child,[switch]$BaselineResetOnly,[string]$Proof005RepositoryRoot)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if(-not[string]::IsNullOrWhiteSpace($Proof005RepositoryRoot)){
  if(-not$Proof005Child-or-not[IO.Path]::IsPathRooted($Proof005RepositoryRoot)){throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_REPOSITORY_ROOT_REFUSED'}
  $root=[IO.Path]::GetFullPath($Proof005RepositoryRoot)
}
$runnerPath = $PSCommandPath
$project = 'farmrx-farmer-simplicity-2027-local'
$db = "supabase_db_$project"
$gateway = "supabase_kong_$project"
$ordinaryPostgresImage = 'public.ecr.aws/supabase/postgres:17.6.1.134'
$ordinaryPostgresImageId = 'sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770'
$baseFixture = Join-Path $root 'tests/season/cedar-creek-2027-start.sql'
$cw2Fixture = Join-Path $root 'tests/season/connect-workflows-cw2.fixture.sql'
$verify = Join-Path $root 'tests/season/connect-workflows-cw2.verify.sql'
$concurrencyFixtureVerify = Join-Path $root 'tests/season/connect-workflows-cw2.concurrency-fixture.sql'
$concurrencyFixtureVerifySha256 = '7ea2b40ef74afd510e1a2a24184b30fb2a8d4bb345d800b9e378c4e579d7f184'
$concurrencyVerify = Join-Path $root 'tests/season/connect-workflows-cw2.concurrency.sql'
  $concurrencyVerifySha256 = '871acee6a34b2c413c606fab9b2a9699589a202a6af9690fefea64f4b5ce7d1d'
$specPath = Join-Path $root 'tests/e2e/season/cedar-creek.spec.ts'
$configPath = Join-Path $root 'playwright.connect-workflows-cw2.config.ts'
$migration = '20260811133808_connect_workflows_program_inventory.sql'
$migrationPath = Join-Path $root "supabase/migrations/$migration"
$migrationBlob = '88b392f66de876b2b5dd53f0438bbe641cc434fa'
$fkIndexMigration = '20260820135357_add_program_inventory_match_fk_indexes.sql'
$fkIndexMigrationPath = Join-Path $root "supabase/migrations/$fkIndexMigration"
$fkIndexMigrationSha256 = 'bf6fbc84c5389e1122ce7ccf63c37dacb2dfc21d881216bbbb5241b203fa5589'
$diagnosticRoot = Join-Path $root '.playwright-local/connect-workflows-cw2-diagnostics'
$seasonScenarioCommands = @(
  'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-maple-august-december-disposable.ps1',
  'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-north-fork-disposable.ps1',
  'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-prairie-spray-disposable.ps1',
  'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-harvest-ridge-disposable.ps1',
  'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-cedar-creek-disposable.ps1',
  'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-pine-hill-disposable.ps1'
)
. (Join-Path $root 'scripts/maple-season-credential.ps1')
Import-Module (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1') -Force

function Write-Cw2DiagnosticRecord([string]$LogPath,[hashtable]$Record) {
  if ([string]::IsNullOrWhiteSpace($LogPath) -or -not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { throw 'CONNECT_WORKFLOWS_CW2_DURABLE_LOG_MISSING' }
  $json = $Record | ConvertTo-Json -Compress -Depth 8
  [IO.File]::AppendAllText($LogPath,$json + [Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  if ((Get-Item -LiteralPath $LogPath).Length -le 0) { throw 'CONNECT_WORKFLOWS_CW2_DURABLE_LOG_EMPTY' }
}

function New-Cw2DiagnosticLog([string]$Purpose) {
  [void](New-Item -ItemType Directory -Path $diagnosticRoot -Force)
  $path = Join-Path $diagnosticRoot ("cw2-{0}-{1}.jsonl" -f $Purpose,[guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllText($path,'',[Text.UTF8Encoding]::new($false))
  Write-Cw2DiagnosticRecord -LogPath $path -Record ([ordered]@{ event='run_started'; purpose=$Purpose; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); log_path=$path })
  $path
}

function Get-Cw2Sha256([byte[]]$Bytes) {
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { ([BitConverter]::ToString($hasher.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
  finally { $hasher.Dispose() }
}

function Invoke-Cw2CapturedProcess([string]$Stage,[string]$LogPath,[string]$Executable,[string]$Arguments,[byte[]]$StdinBytes,[int]$TimeoutMilliseconds=120000,[int]$DrainTimeoutMilliseconds=30000,[string]$WorkingDirectory='') {
  if ([string]::IsNullOrWhiteSpace($Stage)) { throw 'CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_STAGE_REQUIRED' }
  if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { throw 'CONNECT_WORKFLOWS_CW2_DURABLE_LOG_MISSING' }
  if ([string]::IsNullOrWhiteSpace($Executable)) { throw 'CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_EXECUTABLE_REQUIRED' }
  $resolvedWorkingDirectory = $null
  if (-not [string]::IsNullOrWhiteSpace($WorkingDirectory)) {
    $resolvedWorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)
    if (-not (Test-Path -LiteralPath $resolvedWorkingDirectory -PathType Container)) { throw 'CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_WORKING_DIRECTORY_MISSING' }
  }
  $evidenceDirectory = Split-Path -Parent $LogPath
  $captureId = [guid]::NewGuid().ToString('N')
  $stdoutPath = Join-Path $evidenceDirectory "cw2-$captureId.stdout.bin"
  $stderrPath = Join-Path $evidenceDirectory "cw2-$captureId.stderr.bin"
  if ($stdoutPath -ceq $stderrPath -or (Test-Path -LiteralPath $stdoutPath) -or (Test-Path -LiteralPath $stderrPath)) { throw 'CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_STREAM_PATH_COLLISION' }
  $stdoutStream = [IO.FileStream]::new($stdoutPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,[IO.FileOptions]::WriteThrough)
  $stderrStream = [IO.FileStream]::new($stderrPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,[IO.FileOptions]::WriteThrough)
  $started = [DateTimeOffset]::UtcNow.ToString('o')
  $safeArguments = $Arguments
  $stdinSha256 = Get-Cw2Sha256 $StdinBytes
  Write-Cw2DiagnosticRecord -LogPath $LogPath -Record ([ordered]@{
    event='native_started'; stage=$Stage; timestamp_utc=$started; executable=$Executable; safe_arguments=$safeArguments
    stdin_length=$StdinBytes.Length; stdin_sha256=$stdinSha256; working_directory=$resolvedWorkingDirectory; stdout_path=$stdoutPath; stderr_path=$stderrPath
  })
  $process = $null
  $stdoutTask = $null
  $stderrTask = $null
  $nativeExitCode = $null
  $nativeProcessId = $null
  $timeoutAtUtc = $null
  $killRequested = $false
  $finalizationCompleted = $false
  $postKillExitCode = $null
  $primaryException = $null
  $cause = 'not_started'
  $priorErrorActionPreference = $ErrorActionPreference
  $priorConsoleInputEncoding = [Console]::InputEncoding
  try {
    $ErrorActionPreference = 'Continue'
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
    try {
      $startInfo = [Diagnostics.ProcessStartInfo]::new()
      $startInfo.FileName = $Executable
      $startInfo.Arguments = $Arguments
      $startInfo.UseShellExecute = $false
      $startInfo.CreateNoWindow = $true
      $startInfo.RedirectStandardInput = $true
      $startInfo.RedirectStandardOutput = $true
      $startInfo.RedirectStandardError = $true
      if ($null -ne $resolvedWorkingDirectory) { $startInfo.WorkingDirectory = $resolvedWorkingDirectory }
      $process = [Diagnostics.Process]::new()
      $process.StartInfo = $startInfo
      if (-not $process.Start()) { throw 'CONNECT_WORKFLOWS_CW2_NATIVE_START_RETURNED_FALSE' }
      $nativeProcessId = $process.Id
      Write-Cw2DiagnosticRecord -LogPath $LogPath -Record ([ordered]@{
        event='native_process_started'; stage=$Stage; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); native_process_id=$nativeProcessId
      })
      $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($stdoutStream)
      $stderrTask = $process.StandardError.BaseStream.CopyToAsync($stderrStream)
      $process.StandardInput.BaseStream.Write($StdinBytes,0,$StdinBytes.Length)
      $process.StandardInput.BaseStream.Flush()
      $process.StandardInput.Close()
      if (-not $process.WaitForExit($TimeoutMilliseconds)) {
        $cause = 'timeout'
        $timeoutAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
        Write-Cw2DiagnosticRecord -LogPath $LogPath -Record ([ordered]@{
          event='native_timeout'; stage=$Stage; timestamp_utc=$timeoutAtUtc; native_process_id=$nativeProcessId; timeout_milliseconds=$TimeoutMilliseconds
        })
        $killRequested = $true
        try { $process.Kill() }
        catch { $primaryException = $_.Exception.ToString() }
        $finalizationCompleted = $process.WaitForExit(5000)
        if ($finalizationCompleted) { $postKillExitCode = $process.ExitCode }
        Write-Cw2DiagnosticRecord -LogPath $LogPath -Record ([ordered]@{
          event='native_timeout_finalized'; stage=$Stage; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); native_process_id=$nativeProcessId
          kill_requested=$killRequested; finalization_completed=$finalizationCompleted; finalization_wait_milliseconds=5000; post_kill_exit_code=$postKillExitCode
        })
      } else {
        $nativeExitCode = $process.ExitCode
        $finalizationCompleted = $true
        $cause = if ($nativeExitCode -eq 0) { 'completed' } else { 'nonzero_exit' }
      }
      if ($null -ne $stdoutTask -and $null -ne $stderrTask) {
        if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdoutTask,$stderrTask),$DrainTimeoutMilliseconds)) {
          if ($cause -eq 'completed') { $nativeExitCode = $null }
          $cause = 'drain_timeout'
        }
      }
    } catch {
      $primaryException = $_.Exception.ToString()
      if ($cause -eq 'not_started') { $cause = 'start_failure' } else { $cause = 'capture_failure' }
      if ($null -ne $process -and -not $process.HasExited) { try { $process.Kill(); [void]$process.WaitForExit(5000) } catch {} }
    }
  } finally {
    $ErrorActionPreference = $priorErrorActionPreference
    [Console]::InputEncoding = $priorConsoleInputEncoding
    if ($null -ne $process) { try { $process.StandardInput.Close() } catch {}; $process.Dispose() }
    $stdoutStream.Flush(); $stdoutStream.Dispose()
    $stderrStream.Flush(); $stderrStream.Dispose()
  }
  $finished = [DateTimeOffset]::UtcNow.ToString('o')
  $stdoutBytes = [IO.File]::ReadAllBytes($stdoutPath)
  $stderrBytes = [IO.File]::ReadAllBytes($stderrPath)
  $finishedRecord = [ordered]@{
    event='native_finished'; stage=$Stage; started_at_utc=$started; finished_at_utc=$finished; cause=$cause
    native_process_id=$nativeProcessId; native_exit_code=$nativeExitCode; primary_exception=$primaryException
    timeout_at_utc=$timeoutAtUtc; kill_requested=$killRequested; finalization_completed=$finalizationCompleted; post_kill_exit_code=$postKillExitCode
    stdin_length=$StdinBytes.Length; stdin_sha256=$stdinSha256; working_directory=$resolvedWorkingDirectory
    stdout_path=$stdoutPath; stdout_length=$stdoutBytes.Length; stdout_sha256=(Get-Cw2Sha256 $stdoutBytes)
    stderr_path=$stderrPath; stderr_length=$stderrBytes.Length; stderr_sha256=(Get-Cw2Sha256 $stderrBytes)
  }
  try { Write-Cw2DiagnosticRecord -LogPath $LogPath -Record $finishedRecord }
  catch {
    $logFailure = $_.Exception.ToString()
    $nativeText = [Text.Encoding]::UTF8.GetString($stderrBytes)
    throw [Exception]::new("CONNECT_WORKFLOWS_CW2_DURABLE_LOG_WRITE_FAILED:$Stage`nCAUSE:$cause`nPRIMARY_EXCEPTION:$primaryException`nSTDERR:$nativeText`nLOG_EXCEPTION:$logFailure",$_.Exception)
  }
  [pscustomobject]@{
    Stage=$Stage; StartedAtUtc=$started; FinishedAtUtc=$finished; Cause=$cause; NativeExitCode=$nativeExitCode
    NativeProcessId=$nativeProcessId; TimeoutAtUtc=$timeoutAtUtc; KillRequested=$killRequested; FinalizationCompleted=$finalizationCompleted; PostKillExitCode=$postKillExitCode
    PrimaryException=$primaryException; StdinLength=$StdinBytes.Length; StdinSha256=$stdinSha256
    StdoutPath=$stdoutPath; StderrPath=$stderrPath; StdoutBytes=$stdoutBytes; StderrBytes=$stderrBytes
    StdoutText=[Text.Encoding]::UTF8.GetString($stdoutBytes); StderrText=[Text.Encoding]::UTF8.GetString($stderrBytes)
  }
}

function Write-Cw2CaptureReplay($Capture) {
  if (-not [string]::IsNullOrEmpty($Capture.StdoutText)) { Write-Host -NoNewline $Capture.StdoutText }
  if (-not [string]::IsNullOrEmpty($Capture.StderrText)) { Write-Warning $Capture.StderrText }
}

# CW2-CREDENTIAL-HANDOFF capture guard begin.
function Assert-Cw2CaptureSuccess($Capture,[string]$RequiredMarker) {
  $markerPattern = '(?m)^' + [regex]::Escape($RequiredMarker) + "`r?$"
  $stderrMarkerIndex = $Capture.StderrText.IndexOf($RequiredMarker,[StringComparison]::Ordinal)
  if ($Capture.Cause -cne 'completed' -or $null -ne $Capture.PrimaryException -or $null -eq $Capture.NativeExitCode -or $Capture.NativeExitCode -ne 0 -or $Capture.StdoutText -cnotmatch $markerPattern -or $stderrMarkerIndex -ge 0) {
    $exitText = if ($null -eq $Capture.NativeExitCode) { 'MISSING' } else { [string]$Capture.NativeExitCode }
    throw [Exception]::new("CONNECT_WORKFLOWS_CW2_CAPTURE_FAILED:$($Capture.Stage):cause=$($Capture.Cause):exit=$exitText`nEVIDENCE_STDOUT:$($Capture.StdoutPath)`nEVIDENCE_STDERR:$($Capture.StderrPath)`nPRIMARY_EXCEPTION:$($Capture.PrimaryException)`nSTDERR:`n$($Capture.StderrText)`nSTDOUT:`n$($Capture.StdoutText)")
  }
  return $true
}

# CW2-CREDENTIAL-HANDOFF capture guard end.

function Assert-Cw2CaptureExitZero($Capture,[string]$FailureCode) {
  if ([string]::IsNullOrWhiteSpace($FailureCode)) { throw 'CONNECT_WORKFLOWS_CW2_CAPTURE_FAILURE_CODE_REQUIRED' }
  if ($Capture.Cause -cne 'completed' -or $null -ne $Capture.PrimaryException -or $null -eq $Capture.NativeExitCode -or $Capture.NativeExitCode -ne 0) {
    $exitText = if ($null -eq $Capture.NativeExitCode) { 'MISSING' } else { [string]$Capture.NativeExitCode }
    throw [Exception]::new("${FailureCode}:cause=$($Capture.Cause):exit=$exitText`nEVIDENCE_STDOUT:$($Capture.StdoutPath)`nEVIDENCE_STDERR:$($Capture.StderrPath)`nPRIMARY_EXCEPTION:$($Capture.PrimaryException)`nSTDERR:`n$($Capture.StderrText)`nSTDOUT:`n$($Capture.StdoutText)")
  }
  return $true
}

function Assert-Cw2SelfTestThrows([scriptblock]$Action,[string[]]$Needles) {
  try { & $Action; throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_EXPECTED_FAILURE_MISSING' }
  catch {
    $text = $_.Exception.ToString()
    if ($text -match 'CONNECT_WORKFLOWS_CW2_SELFTEST_EXPECTED_FAILURE_MISSING') { throw }
    foreach ($needle in $Needles) { if (-not $text.Contains($needle)) { throw "CONNECT_WORKFLOWS_CW2_SELFTEST_DIAGNOSTIC_MISSING:$needle" } }
  }
}

function Invoke-Cw2BaselineRecoveryEvidenceSelfTest {
  $capture = [pscustomobject]@{ Stage='selftest-baseline-reset'; Cause='nonzero_exit'; NativeExitCode=1; PrimaryException=$null; StdoutPath='selftest-reset.stdout.bin'; StderrPath='selftest-reset.stderr.bin'; StdoutText=''; StderrText='selftest reset stderr' }
  $preIdentity = [pscustomobject]@{ ObservedInspect='pre-reset-identity'; ObservedReady='pre-reset-ready' }
  $postIdentity = [pscustomobject]@{ ObservedInspect='post-reset-identity'; ObservedReady='post-reset-ready' }
  $failureCode = 'CONNECT_WORKFLOWS_CW2_SELFTEST_BASELINE_RESET_FAILED'
  $primaryFailure = $null
  try { [void](Assert-Cw2CaptureExitZero $capture $failureCode) }
  catch { $primaryFailure = $_.Exception }
  if ($null -eq $primaryFailure -or $primaryFailure.ToString() -cnotmatch ([regex]::Escape($failureCode) + ':cause=nonzero_exit:exit=1')) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_BASELINE_FAILURE_CODE_MASKED' }
  $recordLog = New-Cw2DiagnosticLog 'baseline-recovery-record'
  $recordRethrow = $null
  try {
    [void](Invoke-Cw2BaselineResetFailure -ResetFailed $true -PrimaryFailure $primaryFailure -LogPath $recordLog -Reason 'SELFTEST_RESET_NONZERO' -PreIdentity $preIdentity -PostIdentity $postIdentity -Capture $capture -PostIdentityFailure '')
  } catch { $recordRethrow = $_.Exception }
  if ($null -eq $recordRethrow -or -not [object]::ReferenceEquals($recordRethrow,$primaryFailure) -or $recordRethrow.ToString() -cnotmatch [regex]::Escape($failureCode)) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_BASELINE_ORIGINAL_RETHROW_LOST' }
  $recordRows = @(Get-Content -LiteralPath $recordLog | ForEach-Object { $_ | ConvertFrom-Json })
  $recoveryRows = @($recordRows | Where-Object { $_.event -ceq 'baseline_archived_reset_recovery_required' })
  if ($recoveryRows.Count -ne 1 -or $recoveryRows[0].status -cne 'RECOVERY_REQUIRED' -or
      $recoveryRows[0].reason -cne 'SELFTEST_RESET_NONZERO' -or $recoveryRows[0].primary_failure -cnotmatch $failureCode -or
      $recoveryRows[0].post_identity_failure -cne 'UNKNOWN' -or $recoveryRows[0].reset_cause -cne 'nonzero_exit' -or
      $recoveryRows[0].reset_exit_code -ne 1 -or $recoveryRows[0].reset_stdout -cne 'selftest-reset.stdout.bin' -or
      $recoveryRows[0].reset_stderr -cne 'selftest-reset.stderr.bin') { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_BASELINE_RECOVERY_RECORD_MISSING' }

  $unknownLog = New-Cw2DiagnosticLog 'baseline-recovery-post-identity-failure'
  Assert-Cw2SelfTestThrows {
    Invoke-Cw2BaselineResetFailure -ResetFailed $true -PrimaryFailure $primaryFailure -LogPath $unknownLog -Reason 'SELFTEST_POST_IDENTITY_FAILURE' -PreIdentity $preIdentity -PostIdentity $null -Capture $capture -PostIdentityFailure 'CW2_SELFTEST_POST_IDENTITY_FAILURE'
  } @($failureCode)
  $unknownRows = @(Get-Content -LiteralPath $unknownLog | ForEach-Object { $_ | ConvertFrom-Json })
  $unknownRecoveryRows = @($unknownRows | Where-Object { $_.event -ceq 'baseline_archived_reset_recovery_required' })
  if ($unknownRecoveryRows.Count -ne 1 -or $unknownRecoveryRows[0].post_stack_identity -cne 'UNKNOWN' -or
      $unknownRecoveryRows[0].post_pg_isready -cne 'UNKNOWN' -or $unknownRecoveryRows[0].post_identity_failure -cne 'CW2_SELFTEST_POST_IDENTITY_FAILURE') { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_POST_IDENTITY_RECOVERY_UNKNOWN_MISSING' }

  $missingLog = Join-Path $diagnosticRoot ('missing-baseline-recovery-' + [guid]::NewGuid().ToString('N') + '.jsonl')
  $aggregationFailure = $null
  try {
    [void](Invoke-Cw2BaselineResetFailure -ResetFailed $true -PrimaryFailure $primaryFailure -LogPath $missingLog -Reason 'SELFTEST_RECOVERY_WRITE_FAILURE' -PreIdentity $preIdentity -PostIdentity $postIdentity -Capture $capture -PostIdentityFailure '')
  } catch { $aggregationFailure = $_.Exception }
  $aggregationText = if ($null -eq $aggregationFailure) { '' } else { $aggregationFailure.ToString() }
  $primaryIndex = $aggregationText.IndexOf("PRIMARY_FAILURE:$($primaryFailure.ToString())",[StringComparison]::Ordinal)
  $postIdentityIndex = $aggregationText.IndexOf('POST_IDENTITY_FAILURE:',[StringComparison]::Ordinal)
  $recoveryIndex = $aggregationText.IndexOf('RECOVERY_FAILURE:',[StringComparison]::Ordinal)
  if ($null -eq $aggregationFailure -or $aggregationText.IndexOf('CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_EVIDENCE_FAILED',[StringComparison]::Ordinal) -lt 0 -or
      $primaryIndex -lt 0 -or $postIdentityIndex -le $primaryIndex -or $recoveryIndex -le $postIdentityIndex -or $aggregationText.IndexOf('CONNECT_WORKFLOWS_CW2_DURABLE_LOG_MISSING',[StringComparison]::Ordinal) -lt 0 -or
      -not [object]::ReferenceEquals($aggregationFailure.InnerException,$primaryFailure)) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_RECOVERY_AGGREGATION_ORDER_OR_INNER_LOST' }

  $successLog = New-Cw2DiagnosticLog 'baseline-reset-success'
  $success = Invoke-Cw2BaselineResetFailure -ResetFailed $false -PrimaryFailure $null -LogPath $successLog -Reason 'SELFTEST_RESET_SUCCESS' -PreIdentity $preIdentity -PostIdentity $postIdentity -Capture $capture
  $successRows = @(Get-Content -LiteralPath $successLog | ForEach-Object { $_ | ConvertFrom-Json })
  if ($success -isnot [bool] -or -not $success -or @($successRows | Where-Object { $_.event -ceq 'baseline_archived_reset_recovery_required' }).Count -ne 0) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_FALSE_RECOVERY_RECORD_ON_SUCCESS' }
  Write-Output 'CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_SELFTEST_PASS'
}

function Invoke-Cw2DiagnosticSelfTest {
  $log = New-Cw2DiagnosticLog 'selftest'
  $marker = 'CONNECT_WORKFLOWS_CW2_SELFTEST_SQL_PASS'
  $nodeExe = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
  function New-Cw2NodeArguments([string]$Script) { $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Script)); "-e `"eval(Buffer.from('$encoded','base64').toString('utf8'))`"" }
  $stdinBytes = [byte[]](0x61,0x6c,0x70,0x68,0x61,0x0d,0x0a,0xce,0xb2,0x65,0x74,0x61,0x0d,0x0a)
  $successScript = "const fs=require('fs');const input=fs.readFileSync(0);process.stdout.write(input);process.stdout.write(Buffer.from('$marker\n'));process.stderr.write('routine stderr');"
  $success = Invoke-Cw2CapturedProcess -Stage 'byte-exact-concurrent-zero' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments $successScript) -StdinBytes $stdinBytes -TimeoutMilliseconds 5000
  $successValues = @(Assert-Cw2CaptureSuccess $success $marker)
  if ($successValues.Count -ne 1 -or $successValues[0] -isnot [bool] -or -not $successValues[0]) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_SUCCESS_NOT_EXACT_BOOLEAN_TRUE' }
  $expectedStdout = [byte[]]::new($stdinBytes.Length + [Text.Encoding]::UTF8.GetByteCount("$marker`n")); [Array]::Copy($stdinBytes,$expectedStdout,$stdinBytes.Length); [Array]::Copy([Text.Encoding]::UTF8.GetBytes("$marker`n"),0,$expectedStdout,$stdinBytes.Length,[Text.Encoding]::UTF8.GetByteCount("$marker`n"))
  if (([Convert]::ToBase64String($success.StdoutBytes)) -cne ([Convert]::ToBase64String($expectedStdout)) -or $success.StderrText -cne 'routine stderr' -or $success.StdinSha256 -cne (Get-Cw2Sha256 $stdinBytes)) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_EXACT_STREAMS_OR_STDIN_DRIFTED' }
  if (@(Write-Cw2CaptureReplay $success).Count -ne 0) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_HOST_REPLAY_POLLUTED_SUCCESS_STREAM' }

  $workingDirectory = Join-Path $diagnosticRoot ('cwd-' + [guid]::NewGuid().ToString('N'))
  [void](New-Item -ItemType Directory -Path $workingDirectory)
  try {
    $workingDirectoryCapture = Invoke-Cw2CapturedProcess -Stage 'explicit-working-directory' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments "process.stdout.write(process.cwd()+'\n');process.stdout.write('$marker\n')") -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000 -WorkingDirectory $workingDirectory
    [void](Assert-Cw2CaptureSuccess $workingDirectoryCapture $marker)
    if ($workingDirectoryCapture.StdoutText -cnotmatch ('(?m)^' + [regex]::Escape([IO.Path]::GetFullPath($workingDirectory)) + "`r?`n")) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_WORKING_DIRECTORY_NOT_APPLIED' }
  } finally {
    if (Test-Path -LiteralPath $workingDirectory) { Remove-Item -LiteralPath $workingDirectory -Force }
  }

  $stderrFailureScript = "process.stderr.write('exact stderr failure');process.exit(7)"
  $stderrFailure = Invoke-Cw2CapturedProcess -Stage 'stderr-nonzero' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments $stderrFailureScript) -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $stderrFailure $marker } @('stderr-nonzero','exit=7','exact stderr failure')
  $emptyFailure = Invoke-Cw2CapturedProcess -Stage 'empty-nonzero' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments 'process.exit(8)') -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $emptyFailure $marker } @('empty-nonzero','exit=8')
  $noMarker = Invoke-Cw2CapturedProcess -Stage 'zero-no-marker' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments "process.stdout.write('report says pass')") -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $noMarker $marker } @('zero-no-marker','report says pass')
  $stderrMarker = Invoke-Cw2CapturedProcess -Stage 'stderr-marker-only' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments "process.stderr.write('$marker')") -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $stderrMarker $marker } @('stderr-marker-only',$marker)
  $dualMarker = Invoke-Cw2CapturedProcess -Stage 'stdout-and-stderr-marker' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments "process.stdout.write('$marker\n');process.stderr.write('$marker\n')") -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $dualMarker $marker } @('stdout-and-stderr-marker',$marker)
  $embeddedStderrMarker = Invoke-Cw2CapturedProcess -Stage 'embedded-stderr-marker' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments "process.stdout.write('$marker\n');process.stderr.write('prefix-$marker-suffix')") -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $embeddedStderrMarker $marker } @('embedded-stderr-marker',$marker)
  $lowercaseMarker = Invoke-Cw2CapturedProcess -Stage 'lowercase-stdout-marker' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments "process.stdout.write('$($marker.ToLowerInvariant())\n')") -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $lowercaseMarker $marker } @('lowercase-stdout-marker')
  $markerOnly = Invoke-Cw2CapturedProcess -Stage 'marker-only-nonzero' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments "process.stdout.write('$marker\n');process.exit(9)") -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $markerOnly $marker } @('marker-only-nonzero','exit=9',$marker)
  $startFailure = Invoke-Cw2CapturedProcess -Stage 'start-failure' -LogPath $log -Executable (Join-Path $diagnosticRoot 'missing-cw2.exe') -Arguments '' -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $startFailure $marker } @('start-failure','PRIMARY_EXCEPTION')
  $timeout = Invoke-Cw2CapturedProcess -Stage 'timeout-missing-exit' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments 'setTimeout(()=>process.exit(0),5000)') -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 100
  Assert-Cw2SelfTestThrows { Assert-Cw2CaptureSuccess $timeout $marker } @('timeout-missing-exit','cause=timeout','exit=MISSING')
  if ($timeout.NativeProcessId -le 0 -or -not $timeout.KillRequested -or -not $timeout.FinalizationCompleted -or $null -eq $timeout.PostKillExitCode -or [string]::IsNullOrWhiteSpace($timeout.TimeoutAtUtc)) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_TIMEOUT_FINALIZATION_EVIDENCE_MISSING' }
  $timeoutRecords = @(Get-Content -LiteralPath $log | ForEach-Object { $_ | ConvertFrom-Json })
  if (@($timeoutRecords | Where-Object { $_.event -ceq 'native_process_started' -and $_.stage -ceq 'timeout-missing-exit' -and $_.native_process_id -eq $timeout.NativeProcessId }).Count -ne 1 -or
      @($timeoutRecords | Where-Object { $_.event -ceq 'native_timeout_finalized' -and $_.stage -ceq 'timeout-missing-exit' -and $_.native_process_id -eq $timeout.NativeProcessId -and $_.kill_requested -eq $true -and $_.finalization_completed -eq $true }).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_DURABLE_PID_FINALIZATION_RECORD_MISSING' }
  if ($success.StdoutPath -ceq $stderrFailure.StdoutPath -or $success.StdoutPath -ceq $success.StderrPath) { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_STREAM_PATHS_NOT_UNIQUE' }
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Stop'
    [void](Invoke-Cw2CapturedProcess -Stage 'finally-restore' -LogPath $log -Executable $nodeExe -Arguments (New-Cw2NodeArguments 'process.exit(0)') -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000)
    if ($ErrorActionPreference -cne 'Stop') { throw 'CONNECT_WORKFLOWS_CW2_SELFTEST_FINALLY_RESTORE_LOST' }
  } finally { $ErrorActionPreference = $savedPreference }
  Assert-Cw2SelfTestThrows { Invoke-Cw2CapturedProcess -Stage '' -LogPath $log -Executable $nodeExe -Arguments '' -StdinBytes ([byte[]]@()) } @('CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_STAGE_REQUIRED')
  $aggregateLog = New-Cw2DiagnosticLog 'aggregate-failure'
  $aggregateLogJson = $aggregateLog | ConvertTo-Json -Compress
  $aggregateScript = "require('fs').unlinkSync($aggregateLogJson);process.stderr.write('native aggregate primary');process.exit(7)"
  Assert-Cw2SelfTestThrows { Invoke-Cw2CapturedProcess -Stage 'evidence-native-aggregate' -LogPath $aggregateLog -Executable $nodeExe -Arguments (New-Cw2NodeArguments $aggregateScript) -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 5000 } @('CONNECT_WORKFLOWS_CW2_DURABLE_LOG_WRITE_FAILED','native aggregate primary','LOG_EXCEPTION')
  Invoke-Cw2BaselineRecoveryEvidenceSelfTest
  Write-Cw2DiagnosticRecord -LogPath $log -Record ([ordered]@{ event='run_finished'; status='pass'; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o') })
  Write-Output 'CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_SELFTEST_PASS'
}

# CW2_PROOF_005_STATIC_GUARD_BEGIN
function ConvertTo-Cw2PostgresTokens([string]$Source) {
  $tokens = [Collections.Generic.List[object]]::new(); $i = 0
  while ($i -lt $Source.Length) {
    $ch = $Source[$i]; $next = if ($i + 1 -lt $Source.Length) { $Source[$i + 1] } else { [char]0 }
    if ([char]::IsWhiteSpace($ch)) { $i += 1; continue }
    if ($ch -eq '-' -and $next -eq '-') {
      $i += 2
      while ($i -lt $Source.Length -and $Source[$i] -ne "`n" -and $Source[$i] -ne "`r") { $i += 1 }
      continue
    }
    if ($ch -eq '/' -and $next -eq '*') {
      $i += 2; $depth = 1
      while ($i -lt $Source.Length -and $depth -gt 0) {
        $commentNext = if ($i + 1 -lt $Source.Length) { $Source[$i + 1] } else { [char]0 }
        if ($Source[$i] -eq '/' -and $commentNext -eq '*') { $depth += 1; $i += 2; continue }
        if ($Source[$i] -eq '*' -and $commentNext -eq '/') { $depth -= 1; $i += 2; continue }
        $i += 1
      }
      if ($depth -ne 0) { throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_UNTERMINATED:block-comment' }
      continue
    }
    $prefixedKind = $null; $prefixedDelimiter = [char]0; $prefixLength = 0
    if (($ch -eq 'e' -or $ch -eq 'E') -and $next -eq "'") { $prefixedKind='escape-string'; $prefixedDelimiter="'"; $prefixLength=2 }
    elseif (($ch -eq 'b' -or $ch -eq 'B') -and $next -eq "'") { $prefixedKind='bit-string'; $prefixedDelimiter="'"; $prefixLength=2 }
    elseif (($ch -eq 'x' -or $ch -eq 'X') -and $next -eq "'") { $prefixedKind='hex-string'; $prefixedDelimiter="'"; $prefixLength=2 }
    elseif (($ch -eq 'n' -or $ch -eq 'N') -and $next -eq "'") { $prefixedKind='national-string'; $prefixedDelimiter="'"; $prefixLength=2 }
    elseif (($ch -eq 'u' -or $ch -eq 'U') -and $next -eq '&' -and $i + 2 -lt $Source.Length -and ($Source[$i + 2] -eq "'" -or $Source[$i + 2] -eq '"')) {
      $prefixedDelimiter=$Source[$i + 2]; $prefixedKind=if($prefixedDelimiter -eq "'"){'unicode-string'}else{'unicode-quoted-identifier'}; $prefixLength=3
    }
    if ($null -ne $prefixedKind) {
      $value=[Text.StringBuilder]::new(); $i += $prefixLength; $closed=$false
      while ($i -lt $Source.Length) {
        $current=$Source[$i]
        if ($current -eq $prefixedDelimiter) {
          if ($i + 1 -lt $Source.Length -and $Source[$i + 1] -eq $prefixedDelimiter) { [void]$value.Append($prefixedDelimiter); $i += 2; continue }
          $i += 1; $closed=$true; break
        }
        if ($current -eq [char]0) { throw "CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_ESCAPE:$prefixedKind" }
        if ($prefixedKind -eq 'escape-string' -and $current -eq '\') {
          if ($i + 1 -ge $Source.Length) { throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_ESCAPE:escape-string' }
          $escape=$Source[$i + 1]
          if ($escape -eq 'x') {
            $j=$i+2; while($j -lt $Source.Length -and [Uri]::IsHexDigit($Source[$j])){$j+=1}
            if($j -eq $i+2){throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_ESCAPE:hex'}; $i=$j; continue
          }
          if ($escape -eq 'u' -or $escape -eq 'U') {
            $digits=if($escape -eq 'u'){4}else{8}; if($i+2+$digits -gt $Source.Length){throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_ESCAPE:unicode'}
            for($j=$i+2;$j -lt $i+2+$digits;$j+=1){if(-not [Uri]::IsHexDigit($Source[$j])){throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_ESCAPE:unicode'}}
            $i += 2+$digits; continue
          }
          if ($escape -ge '0' -and $escape -le '7') {
            $j=$i+1; $count=0; while($j -lt $Source.Length -and $count -lt 3 -and $Source[$j] -ge '0' -and $Source[$j] -le '7'){$j+=1;$count+=1}; $i=$j; continue
          }
          $i += 2; continue
        }
        if (($prefixedKind -eq 'unicode-string' -or $prefixedKind -eq 'unicode-quoted-identifier') -and $current -eq '\') {
          if ($i + 1 -ge $Source.Length) { throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_ESCAPE:unicode' }
          if ($Source[$i + 1] -eq '\') { $i += 2; continue }
          $plus=$Source[$i + 1] -eq '+'; $digits=if($plus){6}else{4}; $digitStart=if($plus){$i+2}else{$i+1}
          if($digitStart+$digits -gt $Source.Length){throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_ESCAPE:unicode'}
          for($j=$digitStart;$j -lt $digitStart+$digits;$j+=1){if(-not [Uri]::IsHexDigit($Source[$j])){throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_ESCAPE:unicode'}}
          $i=$digitStart+$digits; continue
        }
        [void]$value.Append($current); $i += 1
      }
      if(-not $closed){throw "CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_UNTERMINATED:$prefixedKind"}
      $literalValue=$value.ToString()
      if($prefixedKind -eq 'bit-string' -and $literalValue -notmatch '^[01]*$'){throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_LITERAL:bit-string'}
      if($prefixedKind -eq 'hex-string' -and $literalValue -notmatch '^[0-9A-Fa-f]*$'){throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_INVALID_LITERAL:hex-string'}
      $tokens.Add([pscustomobject]@{Kind=$prefixedKind;Value=$literalValue}); continue
    }
    if ($ch -eq "'") {
      $value = [Text.StringBuilder]::new(); $i += 1; $closed = $false
      while ($i -lt $Source.Length) {
        if ($Source[$i] -eq "'") {
          if ($i + 1 -lt $Source.Length -and $Source[$i + 1] -eq "'") { [void]$value.Append("'"); $i += 2; continue }
          $i += 1; $closed = $true; break
        }
        [void]$value.Append($Source[$i]); $i += 1
      }
      if (-not $closed) { throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_UNTERMINATED:single-string' }
      $tokens.Add([pscustomobject]@{Kind='single-string';Value=$value.ToString()}); continue
    }
    if ($ch -eq '"') {
      $value = [Text.StringBuilder]::new(); $i += 1; $closed = $false
      while ($i -lt $Source.Length) {
        if ($Source[$i] -eq '"') {
          if ($i + 1 -lt $Source.Length -and $Source[$i + 1] -eq '"') { [void]$value.Append('"'); $i += 2; continue }
          $i += 1; $closed = $true; break
        }
        [void]$value.Append($Source[$i]); $i += 1
      }
      if (-not $closed) { throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_UNTERMINATED:quoted-identifier' }
      $tokens.Add([pscustomobject]@{Kind='quoted-identifier';Value=$value.ToString()}); continue
    }
    if ($ch -eq '$') {
      $tagMatch = [regex]::Match($Source.Substring($i),'^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$',[Text.RegularExpressions.RegexOptions]::CultureInvariant)
      if (-not $tagMatch.Success) { throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_UNSUPPORTED:dollar' }
      $tag = $tagMatch.Value; $contentStart = $i + $tag.Length
      $contentEnd = $Source.IndexOf($tag,$contentStart,[StringComparison]::Ordinal)
      if ($contentEnd -lt 0) { throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_UNTERMINATED:dollar-string' }
      $tokens.Add([pscustomobject]@{Kind='dollar-string';Value=$Source.Substring($contentStart,$contentEnd-$contentStart)})
      $i = $contentEnd + $tag.Length; continue
    }
    if ([char]::IsLetter($ch) -or $ch -eq '_') {
      $start = $i; $i += 1
      while ($i -lt $Source.Length -and ([char]::IsLetterOrDigit($Source[$i]) -or $Source[$i] -eq '_' -or $Source[$i] -eq '$')) { $i += 1 }
      $tokens.Add([pscustomobject]@{Kind='word';Value=$Source.Substring($start,$i-$start).ToLowerInvariant()}); continue
    }
    if ([char]::IsDigit($ch) -or ($ch -eq '.' -and [char]::IsDigit($next))) {
      $numberMatch = [regex]::Match($Source.Substring($i),'^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?',[Text.RegularExpressions.RegexOptions]::CultureInvariant)
      if (-not $numberMatch.Success) { throw 'CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_MALFORMED:number' }
      $tokens.Add([pscustomobject]@{Kind='number';Value=$numberMatch.Value}); $i += $numberMatch.Length; continue
    }
    if ('()[],.;'.IndexOf([string]$ch,[StringComparison]::Ordinal) -ge 0) {
      $tokens.Add([pscustomobject]@{Kind='punctuation';Value=[string]$ch}); $i += 1; continue
    }
    if ('+-*/<>=~!@#%^&|?:'.IndexOf([string]$ch,[StringComparison]::Ordinal) -ge 0) {
      $start = $i; $i += 1
      while ($i -lt $Source.Length -and '+-*/<>=~!@#%^&|?:'.IndexOf([string]$Source[$i],[StringComparison]::Ordinal) -ge 0) { $i += 1 }
      $tokens.Add([pscustomobject]@{Kind='operator';Value=$Source.Substring($start,$i-$start)}); continue
    }
    throw "CONNECT_WORKFLOWS_CW2_SQL_TOKENIZER_UNSUPPORTED:$([int][char]$ch)"
  }
  $tokens.ToArray()
}

function Get-Cw2Proof005SqlBlock([string]$SqlSource) {
  $startMarker = '-- CW2 stale-unit database denial with exact zero-public-state proof.'
  $endMarker = "perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000061'"
  if ([regex]::Matches($SqlSource,[regex]::Escape($startMarker)).Count -ne 1 -or [regex]::Matches($SqlSource,[regex]::Escape($endMarker)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_SQL_BOUNDARY_AMBIGUOUS' }
  $start = $SqlSource.IndexOf($startMarker,[StringComparison]::Ordinal)
  $end = $SqlSource.IndexOf($endMarker,[StringComparison]::Ordinal)
  if ($start -lt 0 -or $end -le $start) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_SQL_BOUNDARY_ORDER' }
  $SqlSource.Substring($start,$end-$start)
}

function Test-Cw2Proof006PredicateTokens([string]$SqlBody) {
  try { $tokens = @(ConvertTo-Cw2PostgresTokens $SqlBody) } catch { return $false }
  $expected = @(
    [pscustomobject]@{Kind='word';Value='or'},[pscustomobject]@{Kind='word';Value='exists'},
    [pscustomobject]@{Kind='punctuation';Value='('},[pscustomobject]@{Kind='word';Value='select'},
    [pscustomobject]@{Kind='number';Value='1'},[pscustomobject]@{Kind='word';Value='from'},
    [pscustomobject]@{Kind='word';Value='public'},[pscustomobject]@{Kind='punctuation';Value='.'},
    [pscustomobject]@{Kind='word';Value='application_products'},[pscustomobject]@{Kind='word';Value='where'},
    [pscustomobject]@{Kind='word';Value='application_id'},[pscustomobject]@{Kind='operator';Value='='},
    [pscustomobject]@{Kind='single-string';Value='c2200000-0000-4000-8000-000000000073'},
    [pscustomobject]@{Kind='punctuation';Value=')'}
  )
  $matches = 0
  for ($start = 0; $start -le $tokens.Count - $expected.Count; $start += 1) {
    $equal = $true
    for ($offset = 0; $offset -lt $expected.Count; $offset += 1) {
      if ($tokens[$start + $offset].Kind -cne $expected[$offset].Kind -or $tokens[$start + $offset].Value -cne $expected[$offset].Value) { $equal = $false; break }
    }
    if ($equal) { $matches += 1 }
  }
  $matches -eq 1
}

function Test-Cw2Proof005StaticContract([string]$SqlSource) {
  try { $body = Get-Cw2Proof005SqlBlock $SqlSource } catch { return $false }
  Test-Cw2Proof006PredicateTokens $body
}

function Assert-Cw2Proof006LexerSelfTest {
  $predicate = "or exists(select 1 from public.application_products where application_id='c2200000-0000-4000-8000-000000000073')"
  $validSql = @'
perform 'valid ''single'' string';
perform $$valid untagged dollar body$$;
perform $valid_tag$valid tagged dollar body$valid_tag$;
perform "valid""quoted identifier";
perform E'valid \\ backslash \' quote '' doubled \x41 \u0041';
perform U&'d\0061t';
perform U&"d\0061t";
perform B'0101';
perform X'DEAD';
perform N'valid ''national'' string';
if true or exists(select 1 from public.application_products where application_id='c2200000-0000-4000-8000-000000000073') then null; end if;
'@
  if (-not (Test-Cw2Proof006PredicateTokens $validSql)) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_006_VALID_SQL_REJECTED' }
  $escapedPredicate = $predicate.Replace("'","''")
  $escapeStringPredicate = $predicate.Replace("'","\'")
  $hidden = @(
    "or false; perform '$escapedPredicate'",
    "or false; perform E'$escapeStringPredicate'",
    "or false; perform U&'$escapedPredicate'",
    ('or false or U&"{0}" is null' -f $predicate),
    "or false; perform N'$escapedPredicate'",
    ('or false; perform $cw2${0}$cw2$' -f $predicate),
    ('or false; perform $${0}$$' -f $predicate),
    ('or false or "{0}" is null' -f $predicate),
    "or false -- $predicate`n",
    "or false /* outer /* nested $predicate */ comment */"
  )
  foreach ($source in $hidden) { if (Test-Cw2Proof006PredicateTokens $source) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_006_OPAQUE_TOKEN_FALSE_POSITIVE' } }
  $literalTokens = @(ConvertTo-Cw2PostgresTokens "perform E'one\\two'; perform U&'d\0061t'; perform U&`"d\0061t`"; perform B'0101'; perform X'DEAD'; perform N'national';")
  foreach ($kind in @('escape-string','unicode-string','unicode-quoted-identifier','bit-string','hex-string','national-string')) {
    if (@($literalTokens | Where-Object Kind -ceq $kind).Count -ne 1) { throw "CONNECT_WORKFLOWS_CW2_PROOF_006_PREFIX_TOKEN_MISSING:$kind" }
  }
  $quotedPolicyCases = @(
    'perform "set_config"(''role'',''service_role'',true);',
    'perform U&"s\0065t_config"(''role'',''service_role'',true);'
  )
  foreach ($quotedPolicyCase in $quotedPolicyCases) {
    $quotedPolicyTokens = @(ConvertTo-Cw2PostgresTokens $quotedPolicyCase)
    if (Test-Cw2Fixture004ExecutablePolicy $quotedPolicyTokens @()) { throw 'CONNECT_WORKFLOWS_CW2_FIXTURE_005_QUOTED_IDENTIFIER_POLICY_ACCEPTED' }
  }
  foreach ($malformed in @(
    ([string][char]39 + 'unterminated'),([string][char]34 + 'unterminated'),'$tag$unterminated','/* unterminated',
    "E'unterminated\", "E'bad\x'", "E'bad\u12'", "U&'bad\12'", "U&`"bad\+12`"", "B'012'", "X'XYZ'",
    ("B'" + $predicate.Replace("'","''") + "'"),("X'" + $predicate.Replace("'","''") + "'")
  )) {
    $rejected = $false; try { [void]@(ConvertTo-Cw2PostgresTokens $malformed) } catch { $rejected = $true }
    if (-not $rejected) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_006_MALFORMED_TOKEN_ACCEPTED' }
  }
  Write-Output 'CONNECT_WORKFLOWS_CW2_PROOF_006_LEXER_SELFTEST_PASS'
}

function Get-Cw2Fixture002SqlBlock([string]$SqlSource) {
  $startMarker = '-- CW2-FIXTURE-002 foreign authenticated context begin.'
  $endMarker = '-- CW2-FIXTURE-002 foreign authenticated context end.'
  if ([regex]::Matches($SqlSource,[regex]::Escape($startMarker)).Count -ne 1 -or [regex]::Matches($SqlSource,[regex]::Escape($endMarker)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_FIXTURE_002_BOUNDARY_AMBIGUOUS' }
  $start = $SqlSource.IndexOf($startMarker,[StringComparison]::Ordinal); $end = $SqlSource.IndexOf($endMarker,[StringComparison]::Ordinal)
  if ($start -lt 0 -or $end -le $start) { throw 'CONNECT_WORKFLOWS_CW2_FIXTURE_002_BOUNDARY_ORDER' }
  $SqlSource.Substring($start,$end + $endMarker.Length - $start)
}

function Get-Cw2ExactTokenSequenceMatches([object[]]$Tokens,[object[]]$Expected) {
  $matches = [Collections.Generic.List[int]]::new()
  if ($Expected.Count -eq 0 -or $Tokens.Count -lt $Expected.Count) { return $matches.ToArray() }
  for ($start = 0; $start -le $Tokens.Count - $Expected.Count; $start += 1) {
    $equal = $true
    for ($offset = 0; $offset -lt $Expected.Count; $offset += 1) {
      if ($Tokens[$start + $offset].Kind -cne $Expected[$offset].Kind -or $Tokens[$start + $offset].Value -cne $Expected[$offset].Value) { $equal = $false; break }
    }
    if ($equal) { $matches.Add($start) }
  }
  $matches.ToArray()
}

function Test-Cw2Fixture004ExecutablePolicy([object[]]$Tokens,[int[]]$AllowedSetConfigIndexes) {
  $observedSetConfig = [Collections.Generic.List[int]]::new()
  for($i=0;$i -lt $Tokens.Count;$i+=1) {
    $token=$Tokens[$i]
    if (@('quoted-identifier','unicode-quoted-identifier') -ccontains $token.Kind) { return $false }
    if ($token.Kind -ceq 'word' -and @('set','reset','execute','alter','disable','enable') -ccontains $token.Value) { return $false }
    if ($token.Kind -ceq 'word' -and $token.Value -ceq 'set_config') { $observedSetConfig.Add($i) }
  }
  if($observedSetConfig.Count -ne $AllowedSetConfigIndexes.Count){return $false}
  for($i=0;$i -lt $observedSetConfig.Count;$i+=1){if($observedSetConfig[$i] -ne $AllowedSetConfigIndexes[$i]){return $false}}
  $true
}

function Test-Cw2Fixture002StaticContract([string]$SqlSource) {
  try {
    $block = Get-Cw2Fixture002SqlBlock $SqlSource
    $tokens = @(ConvertTo-Cw2PostgresTokens $block)
  } catch { return $false }
  $requiredInOrder = @(
    [pscustomobject]@{Name='foreign request context';Source=@'
perform set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs',jsonb_build_object('c2290000-0000-4000-8000-000000000001',1)::text
  )::text,
  true
);
'@},
    [pscustomobject]@{Name='foreign farm bootstrap';Source=@'
insert into public.farms (id,name,share_with_rep,created_by,time_zone)
values ('c2290000-0000-4000-8000-000000000001','CW2 foreign farm',false,'27000000-0000-4000-8000-000000000001','America/Chicago');
'@},
    [pscustomobject]@{Name='foreign authenticated boundary';Source=@'
if auth.uid() <> '27000000-0000-4000-8000-000000000001'
   or public.current_request_expected_user_id() <> '27000000-0000-4000-8000-000000000001'
   or public.current_request_farm_access_epoch('c2290000-0000-4000-8000-000000000001') <> 1
   or public.current_request_farm_access_epoch('27010000-0000-4000-8000-000000000005') is not null
   or not public.can_access_farm('c2290000-0000-4000-8000-000000000001')
   or not exists (
     select 1 from public.farm_memberships
     where farm_id='c2290000-0000-4000-8000-000000000001'
       and user_id='27000000-0000-4000-8000-000000000001'
       and role='owner' and status='active'
   )
   or not exists (
     select 1 from public.farm_access_epochs
     where farm_id='c2290000-0000-4000-8000-000000000001'
       and user_id='27000000-0000-4000-8000-000000000001'
       and access_epoch=1
   ) then
  raise exception 'CW2 foreign fixture did not establish exact authenticated owner epoch one';
end if;
'@},
    [pscustomobject]@{Name='foreign Inventory product';Source=@'
insert into public.inventory_products (id,farm_id,product_kind,name,inventory_unit,is_active)
values ('c2290000-0000-4000-8000-000000000002','c2290000-0000-4000-8000-000000000001','chemical','Synthetic Cedar Herbicide 41','gal',true);
'@},
    [pscustomobject]@{Name='Cedar request context restore';Source=@'
perform set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs',jsonb_build_object('27010000-0000-4000-8000-000000000005',1)::text
  )::text,
  true
);
'@},
    [pscustomobject]@{Name='Cedar authenticated boundary';Source=@'
if auth.uid() <> '27000000-0000-4000-8000-000000000001'
   or public.current_request_expected_user_id() <> '27000000-0000-4000-8000-000000000001'
   or public.current_request_farm_access_epoch('27010000-0000-4000-8000-000000000005') <> 1
   or public.current_request_farm_access_epoch('c2290000-0000-4000-8000-000000000001') is not null
   or not public.can_access_farm('27010000-0000-4000-8000-000000000005') then
  raise exception 'CW2 did not restore the exact Cedar operation context before foreign denial';
end if;
'@},
    [pscustomobject]@{Name='assigned pass clone';Source=@'
perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000041','c2200000-0000-4000-8000-000000000042',116);
'@},
    [pscustomobject]@{Name='foreign row before snapshot';Source=@'
select to_jsonb(product) into strict v_foreign_product_before
from public.inventory_products product where product.id='c2290000-0000-4000-8000-000000000002';
'@},
    [pscustomobject]@{Name='whole public before snapshot';Source=@'
select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'hash',row_hash,'rows',rows) order by table_name)
  into strict v_before_public from cw2_proof.public_snapshot();
'@},
    [pscustomobject]@{Name='RPC rejection initialization';Source=@'
v_rejected := false; v_error := null;
'@},
    [pscustomobject]@{Name='foreign product RPC under Cedar';Source=@'
begin
  perform public.mark_program_pass_applied('27010000-0000-4000-8000-000000000005','c2200000-0000-4000-8000-000000000043','c2200000-0000-4000-8000-000000000041','2027-07-07',40,pg_temp.cw2_actual('c2200000-0000-4000-8000-000000000042','Synthetic Cedar Herbicide 41','c2290000-0000-4000-8000-000000000002',0.001,'gal'),null,false);
exception when others then v_rejected := true; v_error := sqlerrm;
end;
'@},
    [pscustomobject]@{Name='exact denial and zero public change';Source=@'
if not v_rejected
   or v_error <> 'confirmed inventory product is inactive, foreign, stale, or not the exact name match'
   or public.current_request_farm_access_epoch('27010000-0000-4000-8000-000000000005') <> 1
   or public.current_request_farm_access_epoch('c2290000-0000-4000-8000-000000000001') is not null
   or not exists (
     select 1 from public.assigned_program_passes
     where id='c2200000-0000-4000-8000-000000000041' and status='planned'
       and applied_on is null and applied_acres is null and application_record_id is null
   )
   or not exists (
     select 1 from public.assigned_program_pass_products
     where id='c2200000-0000-4000-8000-000000000042'
       and actual_product_name is null and actual_rate_text is null
       and actual_unit_text is null and actual_cost_per_acre is null
   )
   or exists(select 1 from public.program_inventory_matches where assigned_product_id='c2200000-0000-4000-8000-000000000042')
   or exists(select 1 from public.repository_write_receipts where operation_id='c2200000-0000-4000-8000-000000000043')
   or exists(select 1 from public.application_records where id='c2200000-0000-4000-8000-000000000043')
   or exists(select 1 from public.application_products where application_id='c2200000-0000-4000-8000-000000000043')
   or (select to_jsonb(product) from public.inventory_products product where product.id='c2290000-0000-4000-8000-000000000002') <> v_foreign_product_before
   or (select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'hash',row_hash,'rows',rows) order by table_name) from cw2_proof.public_snapshot()) <> v_before_public then
  raise exception 'CW2 foreign Inventory product did not fail at the exact RPC farm boundary with zero public change';
end if;
'@}
  )
  $cursor = 0
  $allowedSetConfigIndexes=[Collections.Generic.List[int]]::new()
  foreach ($required in $requiredInOrder) {
    try { $expected = @(ConvertTo-Cw2PostgresTokens ([string]$required.Source)) } catch { return $false }
    $matches = @(Get-Cw2ExactTokenSequenceMatches $tokens $expected)
    if ($matches.Count -ne 1 -or $matches[0] -lt $cursor) { return $false }
    if($required.Name -ceq 'foreign request context' -or $required.Name -ceq 'Cedar request context restore') {
      $offset=-1; for($i=0;$i -lt $expected.Count;$i+=1){if($expected[$i].Kind -ceq 'word' -and $expected[$i].Value -ceq 'set_config'){$offset=$i;break}}
      if($offset -lt 0){return $false}; $allowedSetConfigIndexes.Add($matches[0]+$offset)
    }
    $cursor = $matches[0] + $expected.Count
  }
  Test-Cw2Fixture004ExecutablePolicy $tokens $allowedSetConfigIndexes.ToArray()
}

function Get-Cw2CredentialHandoffSqlBlock([string]$SqlSource) {
  $startMarker='-- CW2-CREDENTIAL-HANDOFF concurrency boundary begin.'; $endMarker='-- CW2-CREDENTIAL-HANDOFF concurrency boundary end.'
  if ([regex]::Matches($SqlSource,[regex]::Escape($startMarker)).Count -ne 1 -or [regex]::Matches($SqlSource,[regex]::Escape($endMarker)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_CREDENTIAL_SQL_BOUNDARY_AMBIGUOUS' }
  $start=$SqlSource.IndexOf($startMarker,[StringComparison]::Ordinal); $end=$SqlSource.IndexOf($endMarker,[StringComparison]::Ordinal)
  if($start -lt 0 -or $end -le $start){throw 'CONNECT_WORKFLOWS_CW2_CREDENTIAL_SQL_BOUNDARY_ORDER'}
  $SqlSource.Substring($start,$end+$endMarker.Length-$start)
}

function Get-Cw2CredentialNativeSpan([string]$RunnerSource) {
  Get-Cw2UniqueSourceSpan $RunnerSource ('# CW2-CREDENTIAL-HANDOFF native ' + 'verify begin.') ('# CW2-CREDENTIAL-HANDOFF native ' + 'verify end.')
}

function Get-Cw2CredentialBaseNativeSpan([string]$RunnerSource) {
  Get-Cw2UniqueSourceSpan $RunnerSource ('# CW2-CREDENTIAL-HANDOFF native base ' + 'verify begin.') ('# CW2-CREDENTIAL-HANDOFF native base ' + 'verify end.')
}

function Get-Cw2CredentialFixtureNativeSpan([string]$RunnerSource) {
  Get-Cw2UniqueSourceSpan $RunnerSource ('# CW2-CREDENTIAL-HANDOFF native fixture ' + 'verify begin.') ('# CW2-CREDENTIAL-HANDOFF native fixture ' + 'verify end.')
}

function ConvertTo-Cw2RecursivePostgresTokens([string]$Source,[int]$Depth=0) {
  if($Depth -gt 8){throw 'CONNECT_WORKFLOWS_CW2_CREDENTIAL_SQL_RECURSION_LIMIT'}
  $flat=[Collections.Generic.List[object]]::new()
  foreach($token in @(ConvertTo-Cw2PostgresTokens $Source)){
    if($token.Kind -ceq 'dollar-string'){
      foreach($nested in @(ConvertTo-Cw2RecursivePostgresTokens ([string]$token.Value) ($Depth+1))){$flat.Add($nested)}
    } else {$flat.Add($token)}
  }
  $flat.ToArray()
}

function Test-Cw2TokenSequenceCount([object[]]$Tokens,[string[]]$Values,[int]$ExpectedCount) {
  $count=0
  for($i=0;$i -le $Tokens.Count-$Values.Count;$i+=1){
    $equal=$true
    for($j=0;$j -lt $Values.Count;$j+=1){if($Tokens[$i+$j].Value -cne $Values[$j]){$equal=$false;break}}
    if($equal){$count+=1}
  }
  $count -eq $ExpectedCount
}

function Get-Cw2CredentialCallNames([object[]]$Tokens) {
  $calls=[Collections.Generic.List[string]]::new()
  for($i=0;$i -lt $Tokens.Count;$i+=1){
    if($Tokens[$i].Value -cne '('){continue}
    $callKinds=@('word','quoted-identifier')
    if($i -ge 3 -and $callKinds -ccontains $Tokens[$i-1].Kind -and $Tokens[$i-2].Value -ceq '.' -and $callKinds -ccontains $Tokens[$i-3].Kind){
      $calls.Add(('{0}.{1}' -f $Tokens[$i-3].Value,$Tokens[$i-1].Value))
    } elseif($i -ge 1 -and $callKinds -ccontains $Tokens[$i-1].Kind){$calls.Add([string]$Tokens[$i-1].Value)}
  }
  $calls.ToArray()
}

function Test-Cw2CredentialExactCalls([object[]]$Tokens,[string[]]$Expected) {
  $actual=@(Get-Cw2CredentialCallNames $Tokens)
  $actual.Count -eq $Expected.Count -and [string]::Join('|',$actual) -ceq [string]::Join('|',$Expected)
}

function Test-Cw2CredentialNoDynamicControls([object[]]$Tokens) {
  @($Tokens | Where-Object {
    ($_.Kind -ceq 'word' -or $_.Kind -match 'quoted-identifier') -and
    @('execute','format','set_config') -ccontains ([string]$_.Value).ToLowerInvariant()
  }).Count -eq 0
}

function Test-Cw2CredentialQuotedIdentifiers([object[]]$Tokens,[string[]]$Expected) {
  if(@($Tokens | Where-Object {$_.Kind -ceq 'unicode-quoted-identifier'}).Count -ne 0){return $false}
  $actual=@($Tokens | Where-Object {$_.Kind -ceq 'quoted-identifier'} | ForEach-Object {[string]$_.Value})
  $actual.Count -eq $Expected.Count -and [string]::Join('|',$actual) -ceq [string]::Join('|',$Expected)
}

function Test-Cw2CredentialNoOpaqueProceduralBodies([object[]]$Tokens) {
  $opaqueKinds=@('single-string','escape-string','unicode-string','national-string','bit-string','hex-string')
  $languageNameKinds=@('word','quoted-identifier','unicode-quoted-identifier','single-string')
  for($i=0;$i -lt $Tokens.Count;$i+=1){
    if($Tokens[$i].Kind -cne 'word' -or $Tokens[$i].Value -cne 'do'){continue}
    $bodyIndex=$i+1
    if($bodyIndex -ge $Tokens.Count){return $false}
    if($Tokens[$bodyIndex].Kind -ceq 'word' -and $Tokens[$bodyIndex].Value -ceq 'language'){
      $languageIndex=$bodyIndex+1; $bodyIndex+=2
      if($bodyIndex -ge $Tokens.Count -or $languageNameKinds -cnotcontains $Tokens[$languageIndex].Kind -or
         ($Tokens[$bodyIndex].Kind -ceq 'word' -and $Tokens[$bodyIndex].Value -ceq 'language')){return $false}
    }
    if($opaqueKinds -ccontains $Tokens[$bodyIndex].Kind){return $false}
    if($Tokens[$bodyIndex].Kind -cne 'word' -or @('begin','declare') -cnotcontains $Tokens[$bodyIndex].Value){return $false}
  }
  $true
}

function Test-Cw2CredentialExactTokenShape([object[]]$Tokens,[string[]]$ExpectedTokens) {
  if($Tokens.Count -ne $ExpectedTokens.Count){return $false}
  $utf8=[Text.UTF8Encoding]::new($false)
  for($i=0;$i -lt $Tokens.Count;$i+=1){
    $actual=[Convert]::ToBase64String($utf8.GetBytes(('{0}{1}{2}' -f $Tokens[$i].Kind,[char]0,$Tokens[$i].Value)))
    if($actual -cne $ExpectedTokens[$i]){return $false}
  }
  $true
}

function Test-Cw2CredentialExactExecutableShapes([object[]]$OuterTokens,[object[]]$RemoteTokens) {
  $expectedShapes=@(
    [pscustomobject]@{Name='outer';Tokens=[string[]]@(
      'd29yZABiZWdpbg==',
      'd29yZABpZg==',
      'd29yZABjdXJyZW50X3VzZXI=',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwBzdXBhYmFzZV9hZG1pbg==',
      'd29yZABvcg==',
      'd29yZABzZXNzaW9uX3VzZXI=',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwBzdXBhYmFzZV9hZG1pbg==',
      'd29yZABvcg==',
      'd29yZABjdXJyZW50X2RhdGFiYXNl',
      'cHVuY3R1YXRpb24AKA==',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwBwb3N0Z3Jlcw==',
      'd29yZABvcg==',
      'd29yZABpbmV0X2NsaWVudF9hZGRy',
      'cHVuY3R1YXRpb24AKA==',
      'cHVuY3R1YXRpb24AKQ==',
      'd29yZABpcw==',
      'd29yZABub3Q=',
      'd29yZABudWxs',
      'd29yZABvcg==',
      'd29yZABpbmV0X3NlcnZlcl9hZGRy',
      'cHVuY3R1YXRpb24AKA==',
      'cHVuY3R1YXRpb24AKQ==',
      'd29yZABpcw==',
      'd29yZABub3Q=',
      'd29yZABudWxs',
      'd29yZAB0aGVu',
      'd29yZAByYWlzZQ==',
      'd29yZABleGNlcHRpb24=',
      'c2luZ2xlLXN0cmluZwBDVzIgY29uY3VycmVuY3kgcHJvb2YgZGlkIG5vdCBlbnRlciB0aHJvdWdoIHRoZSBleGFjdCBsb2NhbCBzdXBhYmFzZV9hZG1pbiBib3VuZGFyeQ==',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABlbmQ=',
      'd29yZABpZg==',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABlbmQ='
    )},
    [pscustomobject]@{Name='apply-auth';Tokens=[string[]]@(
      'd29yZABzZXQ=',
      'd29yZAByb2xl',
      'd29yZABhdXRoZW50aWNhdGVk',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABzZXQ=',
      'cXVvdGVkLWlkZW50aWZpZXIAcmVxdWVzdC5qd3QuY2xhaW1z',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwB7InN1YiI6IjI3MDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0=',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABzZXQ=',
      'cXVvdGVkLWlkZW50aWZpZXIAcmVxdWVzdC5qd3QuY2xhaW0uc3Vi',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwAyNzAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDE=',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABzZXQ=',
      'cXVvdGVkLWlkZW50aWZpZXIAcmVxdWVzdC5oZWFkZXJz',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwB7IngtZmFybS1yeC1leHBlY3RlZC11c2VyLWlkIjoiMjcwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwieC1mYXJtLXJ4LWFjY2Vzcy1lcG9jaHMiOiJ7XCIyNzAxMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDVcIjoxfSJ9',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABkbw==',
      'd29yZABiZWdpbg==',
      'd29yZABpZg==',
      'd29yZABjdXJyZW50X3VzZXI=',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwBhdXRoZW50aWNhdGVk',
      'd29yZABvcg==',
      'd29yZABzZXNzaW9uX3VzZXI=',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwBzdXBhYmFzZV9hZG1pbg==',
      'd29yZABvcg==',
      'd29yZABjdXJyZW50X2RhdGFiYXNl',
      'cHVuY3R1YXRpb24AKA==',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwBwb3N0Z3Jlcw==',
      'd29yZABvcg==',
      'd29yZABpbmV0X2NsaWVudF9hZGRy',
      'cHVuY3R1YXRpb24AKA==',
      'cHVuY3R1YXRpb24AKQ==',
      'd29yZABpcw==',
      'd29yZABub3Q=',
      'd29yZABudWxs',
      'd29yZABvcg==',
      'd29yZABub3Q=',
      'd29yZABleGlzdHM=',
      'cHVuY3R1YXRpb24AKA==',
      'd29yZABzZWxlY3Q=',
      'bnVtYmVyADE=',
      'd29yZABmcm9t',
      'd29yZABwZ19jYXRhbG9n',
      'cHVuY3R1YXRpb24ALg==',
      'd29yZABwZ19yb2xlcw==',
      'd29yZAB3aGVyZQ==',
      'd29yZAByb2xuYW1l',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwBhdXRoZW50aWNhdGVk',
      'd29yZABhbmQ=',
      'd29yZABub3Q=',
      'd29yZAByb2xzdXBlcg==',
      'd29yZABhbmQ=',
      'd29yZABub3Q=',
      'd29yZAByb2xieXBhc3NybHM=',
      'cHVuY3R1YXRpb24AKQ==',
      'd29yZABvcg==',
      'd29yZABjdXJyZW50X3NldHRpbmc=',
      'cHVuY3R1YXRpb24AKA==',
      'c2luZ2xlLXN0cmluZwByZXF1ZXN0Lmp3dC5jbGFpbXM=',
      'cHVuY3R1YXRpb24ALA==',
      'd29yZAB0cnVl',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAOjo=',
      'd29yZABqc29uYg==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwB7InN1YiI6IjI3MDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0=',
      'b3BlcmF0b3IAOjo=',
      'd29yZABqc29uYg==',
      'd29yZABvcg==',
      'd29yZABjdXJyZW50X3NldHRpbmc=',
      'cHVuY3R1YXRpb24AKA==',
      'c2luZ2xlLXN0cmluZwByZXF1ZXN0Lmp3dC5jbGFpbS5zdWI=',
      'cHVuY3R1YXRpb24ALA==',
      'd29yZAB0cnVl',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwAyNzAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDE=',
      'd29yZABvcg==',
      'd29yZABjdXJyZW50X3NldHRpbmc=',
      'cHVuY3R1YXRpb24AKA==',
      'c2luZ2xlLXN0cmluZwByZXF1ZXN0LmhlYWRlcnM=',
      'cHVuY3R1YXRpb24ALA==',
      'd29yZAB0cnVl',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAOjo=',
      'd29yZABqc29uYg==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwB7IngtZmFybS1yeC1leHBlY3RlZC11c2VyLWlkIjoiMjcwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwieC1mYXJtLXJ4LWFjY2Vzcy1lcG9jaHMiOiJ7XCIyNzAxMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDVcIjoxfSJ9',
      'b3BlcmF0b3IAOjo=',
      'd29yZABqc29uYg==',
      'd29yZAB0aGVu',
      'd29yZAByYWlzZQ==',
      'd29yZABleGNlcHRpb24=',
      'c2luZ2xlLXN0cmluZwBDVzIgY2F0YWxvZyBhcHBseSBzZXNzaW9uIGRpZCBub3QgZW50ZXIgdGhlIGV4YWN0IGF1dGhlbnRpY2F0ZWQgbG9jYWwgYm91bmRhcnk=',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABlbmQ=',
      'd29yZABpZg==',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABlbmQ='
    )},
    [pscustomobject]@{Name='writer-auth';Tokens=[string[]]@(
      'd29yZABzZXQ=',
      'd29yZAByb2xl',
      'd29yZABhdXRoZW50aWNhdGVk',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABzZXQ=',
      'cXVvdGVkLWlkZW50aWZpZXIAcmVxdWVzdC5qd3QuY2xhaW1z',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwB7InN1YiI6IjI3MDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0=',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABzZXQ=',
      'cXVvdGVkLWlkZW50aWZpZXIAcmVxdWVzdC5qd3QuY2xhaW0uc3Vi',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwAyNzAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDE=',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABzZXQ=',
      'cXVvdGVkLWlkZW50aWZpZXIAcmVxdWVzdC5oZWFkZXJz',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwB7IngtZmFybS1yeC1leHBlY3RlZC11c2VyLWlkIjoiMjcwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwieC1mYXJtLXJ4LWFjY2Vzcy1lcG9jaHMiOiJ7XCIyNzAxMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDVcIjoxfSJ9',
      'cHVuY3R1YXRpb24AOw==',
       'd29yZABzZXQ=',
       'd29yZABsb2NhbA==',
       'd29yZABsb2NrX3RpbWVvdXQ=',
       'b3BlcmF0b3IAPQ==',
       'c2luZ2xlLXN0cmluZwA1MDBtcw==',
       'cHVuY3R1YXRpb24AOw==',
      'd29yZABkbw==',
      'd29yZABiZWdpbg==',
      'd29yZABpZg==',
      'd29yZABjdXJyZW50X3VzZXI=',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwBhdXRoZW50aWNhdGVk',
      'd29yZABvcg==',
      'd29yZABzZXNzaW9uX3VzZXI=',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwBzdXBhYmFzZV9hZG1pbg==',
      'd29yZABvcg==',
      'd29yZABjdXJyZW50X2RhdGFiYXNl',
      'cHVuY3R1YXRpb24AKA==',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwBwb3N0Z3Jlcw==',
      'd29yZABvcg==',
      'd29yZABpbmV0X2NsaWVudF9hZGRy',
      'cHVuY3R1YXRpb24AKA==',
      'cHVuY3R1YXRpb24AKQ==',
      'd29yZABpcw==',
      'd29yZABub3Q=',
      'd29yZABudWxs',
      'd29yZABvcg==',
      'd29yZABub3Q=',
      'd29yZABleGlzdHM=',
      'cHVuY3R1YXRpb24AKA==',
      'd29yZABzZWxlY3Q=',
      'bnVtYmVyADE=',
      'd29yZABmcm9t',
      'd29yZABwZ19jYXRhbG9n',
      'cHVuY3R1YXRpb24ALg==',
      'd29yZABwZ19yb2xlcw==',
      'd29yZAB3aGVyZQ==',
      'd29yZAByb2xuYW1l',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwBhdXRoZW50aWNhdGVk',
      'd29yZABhbmQ=',
      'd29yZABub3Q=',
      'd29yZAByb2xzdXBlcg==',
      'd29yZABhbmQ=',
       'd29yZABub3Q=',
       'd29yZAByb2xieXBhc3NybHM=',
       'cHVuY3R1YXRpb24AKQ==',
       'd29yZABvcg==',
       'd29yZABjdXJyZW50X3NldHRpbmc=',
       'cHVuY3R1YXRpb24AKA==',
       'c2luZ2xlLXN0cmluZwBsb2NrX3RpbWVvdXQ=',
       'cHVuY3R1YXRpb24ALA==',
       'd29yZAB0cnVl',
       'cHVuY3R1YXRpb24AKQ==',
       'b3BlcmF0b3IAPD4=',
       'c2luZ2xlLXN0cmluZwA1MDBtcw==',
       'd29yZABvcg==',
      'd29yZABjdXJyZW50X3NldHRpbmc=',
      'cHVuY3R1YXRpb24AKA==',
      'c2luZ2xlLXN0cmluZwByZXF1ZXN0Lmp3dC5jbGFpbXM=',
      'cHVuY3R1YXRpb24ALA==',
      'd29yZAB0cnVl',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAOjo=',
      'd29yZABqc29uYg==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwB7InN1YiI6IjI3MDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0=',
      'b3BlcmF0b3IAOjo=',
      'd29yZABqc29uYg==',
      'd29yZABvcg==',
      'd29yZABjdXJyZW50X3NldHRpbmc=',
      'cHVuY3R1YXRpb24AKA==',
      'c2luZ2xlLXN0cmluZwByZXF1ZXN0Lmp3dC5jbGFpbS5zdWI=',
      'cHVuY3R1YXRpb24ALA==',
      'd29yZAB0cnVl',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwAyNzAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDE=',
      'd29yZABvcg==',
      'd29yZABjdXJyZW50X3NldHRpbmc=',
      'cHVuY3R1YXRpb24AKA==',
      'c2luZ2xlLXN0cmluZwByZXF1ZXN0LmhlYWRlcnM=',
      'cHVuY3R1YXRpb24ALA==',
      'd29yZAB0cnVl',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAOjo=',
      'd29yZABqc29uYg==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwB7IngtZmFybS1yeC1leHBlY3RlZC11c2VyLWlkIjoiMjcwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwieC1mYXJtLXJ4LWFjY2Vzcy1lcG9jaHMiOiJ7XCIyNzAxMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDVcIjoxfSJ9',
      'b3BlcmF0b3IAOjo=',
      'd29yZABqc29uYg==',
      'd29yZAB0aGVu',
      'd29yZAByYWlzZQ==',
      'd29yZABleGNlcHRpb24=',
      'c2luZ2xlLXN0cmluZwBDVzIgY2F0YWxvZyB3cml0ZXIgc2Vzc2lvbiBkaWQgbm90IGVudGVyIHRoZSBleGFjdCBhdXRoZW50aWNhdGVkIGxvY2FsIGJvdW5kYXJ5',
      'cHVuY3R1YXRpb24AOw==',
       'd29yZABlbmQ=',
       'd29yZABpZg==',
       'cHVuY3R1YXRpb24AOw==',
       'd29yZABlbmQ=',
       'cHVuY3R1YXRpb24AOw=='
    )},
    [pscustomobject]@{Name='apply-action';Tokens=[string[]]@(
      'd29yZABzZWxlY3Q=',
      'd29yZABwdWJsaWM=',
      'cHVuY3R1YXRpb24ALg==',
      'd29yZABtYXJrX3Byb2dyYW1fcGFzc19hcHBsaWVk',
      'cHVuY3R1YXRpb24AKA==',
      'c2luZ2xlLXN0cmluZwAyNzAxMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDU=',
      'cHVuY3R1YXRpb24ALA==',
      'c2luZ2xlLXN0cmluZwBjMjUwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDM=',
      'cHVuY3R1YXRpb24ALA==',
      'c2luZ2xlLXN0cmluZwBjMjUwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDE=',
      'cHVuY3R1YXRpb24ALA==',
      'c2luZ2xlLXN0cmluZwAyMDI3LTA3LTA3',
      'cHVuY3R1YXRpb24ALA==',
      'bnVtYmVyADQw',
      'cHVuY3R1YXRpb24ALA==',
      'c2luZ2xlLXN0cmluZwBbeyJpZCI6ImMyNTAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMiIsImFjdHVhbF9wcm9kdWN0X25hbWUiOiJTeW50aGV0aWMgQ2VkYXIgSGVyYmljaWRlIDQxIiwiYWN0dWFsX3JhdGVfdGV4dCI6IjAuMDAxIiwiYWN0dWFsX3VuaXRfdGV4dCI6ImdhbCB0b3RhbCIsImFjdHVhbF9jb3N0X3Blcl9hY3JlIjowLjAxLCJpbnZlbnRvcnlfbWF0Y2giOnsiaW52ZW50b3J5X3Byb2R1Y3RfaWQiOiIyNzA0MDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDUiLCJxdWFudGl0eV9pbl9pbnZlbnRvcnlfdW5pdCI6MC4wMDEsImludmVudG9yeV91bml0IjoiZ2FsIn19XQ==',
      'b3BlcmF0b3IAOjo=',
      'd29yZABqc29uYg==',
      'cHVuY3R1YXRpb24ALA==',
      'd29yZABudWxs',
      'cHVuY3R1YXRpb24ALA==',
      'd29yZABmYWxzZQ==',
      'cHVuY3R1YXRpb24AKQ=='
    )},
    [pscustomobject]@{Name='writer-timeout';Tokens=[string[]]@(
      'd29yZABzZXQ=',
      'd29yZABsb2NhbA==',
      'd29yZABsb2NrX3RpbWVvdXQ=',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwA1MDBtcw==',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABkbw==',
      'd29yZABiZWdpbg==',
      'd29yZABpZg==',
      'd29yZABjdXJyZW50X3NldHRpbmc=',
      'cHVuY3R1YXRpb24AKA==',
      'c2luZ2xlLXN0cmluZwBsb2NrX3RpbWVvdXQ=',
      'cHVuY3R1YXRpb24ALA==',
      'd29yZAB0cnVl',
      'cHVuY3R1YXRpb24AKQ==',
      'b3BlcmF0b3IAPD4=',
      'c2luZ2xlLXN0cmluZwA1MDBtcw==',
      'd29yZAB0aGVu',
      'd29yZAByYWlzZQ==',
      'd29yZABleGNlcHRpb24=',
      'c2luZ2xlLXN0cmluZwBDVzIgY2F0YWxvZyB3cml0ZXIgYWN0aW9uIGRpZCBub3QgYWN0aXZhdGUgdGhlIGV4YWN0IHRyYW5zYWN0aW9uLWxvY2FsIHRpbWVvdXQ=',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABlbmQ=',
      'd29yZABpZg==',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZABlbmQ=',
      'cHVuY3R1YXRpb24AOw==',
      'd29yZAB1cGRhdGU=',
      'd29yZABwdWJsaWM=',
      'cHVuY3R1YXRpb24ALg==',
      'd29yZABpbnZlbnRvcnlfcHJvZHVjdHM=',
      'd29yZABzZXQ=',
      'd29yZABuYW1l',
      'b3BlcmF0b3IAPQ==',
      'd29yZABuYW1l',
      'd29yZAB3aGVyZQ==',
      'd29yZABpZA==',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwAyNzA0MDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDU=',
      'd29yZABhbmQ=',
      'd29yZABmYXJtX2lk',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwAyNzAxMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDU='
    )},
    [pscustomobject]@{Name='writer-released';Tokens=[string[]]@(
      'd29yZAB1cGRhdGU=',
      'd29yZABwdWJsaWM=',
      'cHVuY3R1YXRpb24ALg==',
      'd29yZABpbnZlbnRvcnlfcHJvZHVjdHM=',
      'd29yZABzZXQ=',
      'd29yZABuYW1l',
      'b3BlcmF0b3IAPQ==',
      'd29yZABuYW1l',
      'd29yZAB3aGVyZQ==',
      'd29yZABpZA==',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwAyNzA0MDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDU=',
      'd29yZABhbmQ=',
      'd29yZABmYXJtX2lk',
      'b3BlcmF0b3IAPQ==',
      'c2luZ2xlLXN0cmluZwAyNzAxMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDU='
    )}
  )
  $expectedShapes[5].Tokens=[string[]]@($expectedShapes[2].Tokens+$expectedShapes[5].Tokens)
  $actualShapes=@(
    [pscustomobject]@{Name='outer';Tokens=[object[]]$OuterTokens},
    [pscustomobject]@{Name='apply-auth';Tokens=[object[]]$RemoteTokens[0]},
    [pscustomobject]@{Name='writer-auth';Tokens=[object[]]$RemoteTokens[1]},
    [pscustomobject]@{Name='apply-action';Tokens=[object[]]$RemoteTokens[2]},
    [pscustomobject]@{Name='writer-timeout';Tokens=[object[]]$RemoteTokens[3]},
    [pscustomobject]@{Name='writer-released';Tokens=[object[]]$RemoteTokens[4]}
  )
  if($expectedShapes.Count -ne 6 -or $actualShapes.Count -ne $expectedShapes.Count){return $false}
  for($i=0;$i -lt $expectedShapes.Count;$i+=1){
    if($actualShapes[$i].Name -cne $expectedShapes[$i].Name -or -not (Test-Cw2CredentialExactTokenShape $actualShapes[$i].Tokens $expectedShapes[$i].Tokens)){return $false}
  }
  $true
}

function Test-Cw2CredentialExecutableBodies([string]$Block) {
  try {
    $outer=[regex]::Matches($Block,'(?s)do \$cw2_outer_boundary\$(.*?)\$cw2_outer_boundary\$;')
    $remote=[regex]::Matches($Block,'(?s)\$remote\$(.*?)\$remote\$')
    if($outer.Count -ne 1 -or $remote.Count -ne 5){return $false}
    $outerTokens=@(ConvertTo-Cw2RecursivePostgresTokens $outer[0].Groups[1].Value)
    $remoteTokens=@($remote | ForEach-Object {,@(ConvertTo-Cw2RecursivePostgresTokens $_.Groups[1].Value)})
  } catch {return $false}
  if(-not (Test-Cw2CredentialExactExecutableShapes $outerTokens $remoteTokens)){return $false}
  if(-not (Test-Cw2CredentialNoDynamicControls $outerTokens) -or -not (Test-Cw2CredentialNoOpaqueProceduralBodies $outerTokens) -or -not (Test-Cw2CredentialQuotedIdentifiers $outerTokens @()) -or
     -not (Test-Cw2CredentialExactCalls $outerTokens @('current_database','inet_client_addr','inet_server_addr')) -or
     @($outerTokens | Where-Object {$_.Kind -ceq 'word' -and @('set','reset','insert','update','delete','merge','call','mark_program_pass_applied') -ccontains $_.Value}).Count -ne 0){return $false}
  foreach($index in 0,1,4){
    $tokens=@($remoteTokens[$index])
    $expectedBoundaryCalls=@('current_database','inet_client_addr','exists','current_setting','current_setting','current_setting')
    if($index -eq 1 -or $index -eq 4){$expectedBoundaryCalls+=@('current_setting')}
    $forbiddenBoundaryWords=@('reset','insert','delete','merge','call','mark_program_pass_applied','supabase_admin','postgres','service_role')
    if($index -ne 4){$forbiddenBoundaryWords+=@('update')}
    if($tokens.Count -lt 4 -or $tokens[0].Value -cne 'set' -or $tokens[1].Value -cne 'role' -or $tokens[2].Value -cne 'authenticated' -or $tokens[3].Value -cne ';'){return $false}
    if(-not (Test-Cw2TokenSequenceCount $tokens @('set','role') 1) -or
       -not (Test-Cw2TokenSequenceCount $tokens @('set','local','lock_timeout') $(if($index -eq 1 -or $index -eq 4){1}else{0}))){return $false}
    if(-not (Test-Cw2CredentialNoDynamicControls $tokens) -or -not (Test-Cw2CredentialNoOpaqueProceduralBodies $tokens) -or
       -not (Test-Cw2CredentialQuotedIdentifiers $tokens @('request.jwt.claims','request.jwt.claim.sub','request.headers')) -or
       -not (Test-Cw2CredentialExactCalls $tokens $expectedBoundaryCalls) -or
       @($tokens | Where-Object {$_.Kind -ceq 'word' -and $forbiddenBoundaryWords -ccontains $_.Value}).Count -ne 0){return $false}
  }
  foreach($index in 2,3){
    $tokens=@($remoteTokens[$index])
    if(-not (Test-Cw2CredentialNoDynamicControls $tokens) -or -not (Test-Cw2CredentialNoOpaqueProceduralBodies $tokens) -or -not (Test-Cw2CredentialQuotedIdentifiers $tokens @()) -or
       (Test-Cw2TokenSequenceCount $tokens @('set','role') 1) -or
       @($tokens | Where-Object {$_.Kind -ceq 'word' -and @('reset','alter','disable','enable','merge','call','supabase_admin','postgres','service_role') -ccontains $_.Value}).Count -ne 0){return $false}
  }
  $apply=@($remoteTokens[2]); if(-not (Test-Cw2TokenSequenceCount $apply @('public','.','mark_program_pass_applied') 1) -or
     -not (Test-Cw2CredentialExactCalls $apply @('public.mark_program_pass_applied')) -or
     @($apply | Where-Object {$_.Kind -ceq 'word' -and @('insert','update','delete','merge','call') -ccontains $_.Value}).Count -ne 0){return $false}
  foreach($index in 3,4){
    $writer=@($remoteTokens[$index])
    $expectedWriterCalls=[string[]]@()
    if($index -eq 3){$expectedWriterCalls=[string[]]@('current_setting')}
    if($index -eq 4){$expectedWriterCalls=[string[]]@('current_database','inet_client_addr','exists','current_setting','current_setting','current_setting','current_setting')}
    if(-not (Test-Cw2TokenSequenceCount $writer @('update','public','.','inventory_products') 1) -or
       -not (Test-Cw2CredentialExactCalls $writer $expectedWriterCalls) -or
       @($writer | Where-Object {$_.Kind -ceq 'word' -and @('insert','delete','merge','call','mark_program_pass_applied') -ccontains $_.Value}).Count -ne 0){return $false}
  }
  $true
}

function Test-Cw2CredentialHandoffStaticContract([string]$RunnerSource,[string]$FixtureSource,[string]$SqlSource) {
  try {
    $native=Get-Cw2CredentialNativeSpan $RunnerSource; $baseNative=Get-Cw2CredentialBaseNativeSpan $RunnerSource; $fixtureNative=Get-Cw2CredentialFixtureNativeSpan $RunnerSource
    $captureGuard=Get-Cw2UniqueSourceSpan $RunnerSource ('# CW2-CREDENTIAL-HANDOFF capture ' + 'guard begin.') ('# CW2-CREDENTIAL-HANDOFF capture ' + 'guard end.')
    $block=Get-Cw2CredentialHandoffSqlBlock $SqlSource
  } catch { return $false }
  $postCatalogGuardBegin='# CW2_POST_CATALOG_STATIC_GUARD_'+'BEGIN'; $postCatalogGuardEnd='# CW2_POST_CATALOG_STATIC_GUARD_'+'END'
  $postCatalogGuardStart=$RunnerSource.LastIndexOf($postCatalogGuardBegin,[StringComparison]::Ordinal); $postCatalogGuardFinish=$RunnerSource.LastIndexOf($postCatalogGuardEnd,[StringComparison]::Ordinal)
  if($postCatalogGuardStart -lt 0 -or $postCatalogGuardFinish -le $postCatalogGuardStart){return $false}
  $postCatalogOrderingGuard='if(' + '$cw2RequestLockIndex -lt 0' + ' -or ' + '$cw2CatalogShareLockIndex -le $cw2RequestLockIndex' + ' -or ' + '$cw2AssignedProductUpdateIndex -le $cw2CatalogShareLockIndex'
  if($RunnerSource.Substring($postCatalogGuardStart,$postCatalogGuardFinish-$postCatalogGuardStart).IndexOf($postCatalogOrderingGuard,[StringComparison]::Ordinal) -lt 0){return $false}
  $clockPhaseCallMarker='$clockResult=@(Invoke-'+'HarvestRidgeClockPhase'
  $clockPhaseCallIndex=$RunnerSource.IndexOf($clockPhaseCallMarker,[StringComparison]::Ordinal)
  if($clockPhaseCallIndex -lt 0){return $false}
  $clockPhaseGuard='if ($clockResult[-1] -ne $true) { throw '+'"CONNECT_WORKFLOWS_CW2_CLOCK_PHASE_FAILED:$viewport" }'
  $clockPhaseGuardIndex=$RunnerSource.IndexOf($clockPhaseGuard,$clockPhaseCallIndex,[StringComparison]::Ordinal)
  if($clockPhaseGuardIndex -le $clockPhaseCallIndex){return $false}
  $nativeMarker='# CW2-CREDENTIAL-HANDOFF native '+'verify begin.'
  $nativeStartIndex=$RunnerSource.IndexOf($nativeMarker,$clockPhaseGuardIndex,[StringComparison]::Ordinal)
  if($nativeStartIndex -le $clockPhaseGuardIndex){return $false}
  $nativeRequired=@(
    '$safeDockerArguments = "exec -i $db psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -P pager=off"',
    ('Invoke-Cw2CapturedProcess -Stage "${viewport}:ordinary-clock:'+'concurrency" -LogPath $diagnosticLog -Executable $dockerExe -Arguments $safeDockerArguments -StdinBytes $concurrencyBytes -TimeoutMilliseconds 120000'),
    'Write-Cw2CaptureReplay $capture',
    "[void](Assert-Cw2CaptureSuccess `$capture 'CONNECT_WORKFLOWS_CW2_SQL_PASS')"
  )
  foreach($required in $nativeRequired){if([regex]::Matches($native,[regex]::Escape($required)).Count -ne 1){return $false}}
  foreach($required in @(
    '$baseDockerArguments = "exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off"',
    "[void](Assert-Cw2CaptureSuccess `$baseCapture 'CONNECT_WORKFLOWS_CW2_BASE_SQL_PASS')"
  )){if([regex]::Matches($baseNative,[regex]::Escape($required)).Count -ne 1){return $false}}
  foreach($required in @(
    '$fixtureDockerArguments = "exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off"',
    'Invoke-Cw2CapturedProcess -Stage "${viewport}:$stage`:fixture" -LogPath $diagnosticLog -Executable $dockerExe -Arguments $fixtureDockerArguments -StdinBytes $fixtureBytes -TimeoutMilliseconds 120000',
    "[void](Assert-Cw2CaptureSuccess `$fixtureCapture 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_BOUNDARY_PASS')",
    "[void](Assert-Cw2CaptureSuccess `$fixtureCapture 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_PASS')"
  )){if([regex]::Matches($fixtureNative,[regex]::Escape($required)).Count -ne 1){return $false}}
  foreach($required in @('$Capture.NativeExitCode -ne 0','$Capture.StdoutText -cnotmatch $markerPattern','$stderrMarkerIndex -ge 0')){if($captureGuard -notmatch [regex]::Escape($required)){return $false}}
  if($native -match '(?i)(PGPASSWORD|password\s*=|passfile\s*=|host(?:addr)?\s*=|dblink_connect_u|service_role|session_replication_role)' -or
     [regex]::Matches($native,'(?i)(?:^|\s)-U\s+').Count -ne 1){return $false}
  $fixtureRequired=@('begin;',"select set_config('request.jwt.claims','{`"sub`":`"27000000-0000-4000-8000-000000000001`",`"role`":`"authenticated`"}',true);","select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);","select set_config('request.headers','{`"x-farm-rx-expected-user-id`":`"27000000-0000-4000-8000-000000000001`",`"x-farm-rx-access-epochs`":`"{\`"27010000-0000-4000-8000-000000000005\`":1}`"}',true);",'do $cw2_fixture_boundary$',"if current_user <> 'postgres'","or session_user <> 'postgres'","or auth.uid() <> '27000000-0000-4000-8000-000000000001'","or current_setting('request.headers',true)::jsonb <> '{`"x-farm-rx-expected-user-id`":`"27000000-0000-4000-8000-000000000001`",`"x-farm-rx-access-epochs`":`"{\`"27010000-0000-4000-8000-000000000005\`":1}`"}'::jsonb then","raise exception 'CW2 concurrency fixture did not enter the exact local Cedar postgres boundary'",'\echo CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_BOUNDARY_PASS','insert into public.assigned_program_passes (','insert into public.assigned_program_pass_products (','commit;','begin;','create function public.cw2_catalog_probe_pause()','perform pg_catalog.pg_advisory_xact_lock(25000,2);','create trigger cw2_catalog_probe_pause before update on public.assigned_program_pass_products','commit;','\echo CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_PASS')
  $fixtureCursor=0
  foreach($required in $fixtureRequired){$index=$FixtureSource.IndexOf($required,$fixtureCursor,[StringComparison]::Ordinal);if($index -lt 0){return $false};$fixtureCursor=$index+$required.Length}
  if($FixtureSource -match '(?i)(\bset\s+(?:local\s+)?role\b|service_role|session_replication_role|disable\s+trigger|enable\s+trigger|password\s*=|host(?:addr)?\s*=)'){return $false}
  $boundaryIndex=$SqlSource.IndexOf('-- CW2-CREDENTIAL-HANDOFF concurrency boundary begin.',[StringComparison]::Ordinal)
  if($boundaryIndex -lt 0){return $false}
  $preBoundary=$SqlSource.Substring(0,$boundaryIndex)
  if($preBoundary -match '(?i)(insert\s+into\s+public\.|update\s+public\.|delete\s+from\s+public\.|assigned_program_passes|assigned_program_pass_products|cw2_catalog_probe_pause)'){return $false}
  $requiredInOrder=@(
    "if current_user <> 'supabase_admin'",
    'or inet_server_addr() is not null',
    "raise exception 'CW2 concurrency proof did not enter through the exact local supabase_admin boundary'",
    '\echo CONNECT_WORKFLOWS_CW2_LOCAL_SUPABASE_ADMIN_BOUNDARY_PASS',
    'select pg_advisory_lock(25000,2);',
    "select dblink_connect('cw2_catalog_apply','dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000'' application_name=cw2_catalog_apply');",
    "select dblink_connect('cw2_catalog_writer','dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000 -clock_timeout=500'' application_name=cw2_catalog_writer');",
    'create temporary table cw2_catalog_apply_backend(pid integer primary key);',
    "select pid from dblink('cw2_catalog_apply','select pg_backend_pid()') as apply_backend(pid integer);",
    "raise exception 'CW2 catalog apply session did not enter the exact authenticated local boundary'",
    "select dblink_exec('cw2_catalog_writer','begin');`nselect dblink_exec('cw2_catalog_writer',`$remote`$`nset role authenticated;",
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_BEGIN',
    "select dblink_send_query('cw2_catalog_apply'",
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_PASS',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_WAIT_BEGIN',
    "begin;`nset local statement_timeout='10000ms';`n\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_BEGIN`n\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVE_STAGE_BEGIN",
    'do $wait$',
    "for i in 1..100 loop`n    select`n      exists(",
    'from pg_catalog.pg_locks waiting',
    'join cw2_catalog_apply_backend apply_backend on apply_backend.pid=waiting.pid',
    "where waiting.locktype='advisory'",
    'and waiting.database=(select oid from pg_catalog.pg_database where datname=current_database())',
    'and waiting.objsubid=2',
    "and waiting.mode='ExclusiveLock'",
    'and not waiting.granted',
    'and exists(',
    'from pg_catalog.pg_locks held',
    'where held.pid=pg_backend_pid()',
    'and held.locktype=waiting.locktype',
    'and held.database=waiting.database',
    'and held.classid=waiting.classid',
    'and held.objid=waiting.objid',
    'and held.objsubid=waiting.objsubid',
    'and held.mode=waiting.mode',
    'and held.granted',
    'create temporary table cw2_catalog_apply_recovery_state(',
    'create temporary table cw2_catalog_apply_recovery_stages(',
    "raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_TIMEOUT_BEGIN';",
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVE_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_STAGE_BEGIN',
    "select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;",
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_STAGE_BEGIN',
    'select pg_advisory_unlock(25000,2) into v_unlocked;',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_BUSY_STAGE_BEGIN',
    "select dblink_is_busy('cw2_catalog_apply') into v_busy;",
    'exit when v_busy=0;',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_BUSY_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_TERMINATE_STAGE_BEGIN',
    'select pg_terminate_backend(pid,5000) from cw2_catalog_apply_backend into v_terminated;',
    'select not exists(select 1 from pg_catalog.pg_stat_activity where pid=(select apply_pid from cw2_catalog_apply_recovery_state)) into strict v_terminated;',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_TERMINATE_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_BEGIN',
    "dblink_get_result('cw2_catalog_apply',false) as cleanup_primary",
    "dblink_get_result('cw2_catalog_apply',false) as cleanup_terminal",
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_STAGE_BEGIN',
    "select dblink_disconnect('cw2_catalog_apply') into v_disconnect;",
    "not coalesce('cw2_catalog_apply'=any(dblink_get_connections()),false)",
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_ROLLBACK_STAGE_BEGIN',
    "select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;",
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_ROLLBACK_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_DISCONNECT_STAGE_BEGIN',
    "select dblink_disconnect('cw2_catalog_writer') into v_disconnect;",
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_DISCONNECT_STAGE_END',
    "raise exception 'CW2 catalog apply readiness recovery required: %',coalesce(v_failures,'UNKNOWN_RECOVERY_FAILURE');",
    "raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVED_PASS';",
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_PASS',
    'commit;',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS',
    "select dblink_send_query('cw2_catalog_writer',`$remote`$",
    "raise exception 'CW2 catalog writer action did not activate the exact transaction-local timeout'",
    "select dblink_is_busy('cw2_catalog_writer')=0 into v_done;",
    "perform dblink_cancel_query('cw2_catalog_writer');",
    "raise exception 'CW2 catalog writer did not finish inside the exact asynchronous wait bound';",
    "select status from dblink_get_result('cw2_catalog_writer') as setup(status text);",
    "select status from dblink_get_result('cw2_catalog_writer') as attestation(status text);",
    'result_count integer check(result_count=0)',
    "select count(status) from dblink_get_result('cw2_catalog_writer',false) as failed_action(status text);",
    "update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');",
    '(select message from cw2_catalog_writer_result) is null',
    'writer_terminal_results integer check(writer_terminal_results=0)',
    "select count(*) from dblink_get_result('cw2_catalog_writer') as terminal(status text);",
    '\echo CONNECT_WORKFLOWS_CW2_WRITER_ASYNC_RESULT_DRAIN_PASS',
    "!~ '^ERROR:  canceling statement due to lock timeout'",
    '\echo CONNECT_WORKFLOWS_CW2_WRITER_LOCK_TIMEOUT_PASS',
    '\echo CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS',
    '\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN',
    "insert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);",
    'terminal_results integer check(terminal_results=0)',
    "select count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);",
    '\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_DRAIN_PASS',
    "select dblink_exec('cw2_catalog_writer','begin');`ncreate temporary table cw2_catalog_writer_released(status text);`ninsert into cw2_catalog_writer_released`nselect dblink_exec('cw2_catalog_writer',`$remote`$`nset role authenticated;",
    "select dblink_disconnect('cw2_catalog_apply');",
    "select dblink_disconnect('cw2_catalog_writer');",
    "(select status from cw2_catalog_writer_released) <> 'UPDATE 1'",
    "or not exists(select 1 from public.program_inventory_matches where assigned_product_id='c2500000-0000-4000-8000-000000000002' and quantity_in_inventory_unit=0.001)",
    "or not exists(select 1 from public.assigned_program_passes where id='c2500000-0000-4000-8000-000000000001' and status='applied' and application_record_id is null)",
    "or exists(select 1 from public.application_records where notes like 'Created from Programs pass c2500000%')",
    'or exists(select 1 from public.application_products)',
    "or (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005') <> 19.998",
    "raise exception 'CW2 concurrent catalog proof did not preserve one exact no-record draw'"
  )
  $requiredInOrder=@(
    "if current_user <> 'supabase_admin'",'\echo CONNECT_WORKFLOWS_CW2_LOCAL_SUPABASE_ADMIN_BOUNDARY_PASS','select pg_advisory_lock(25000,2);',
    "select dblink_connect('cw2_catalog_apply'","select dblink_connect('cw2_catalog_writer'",'create temporary table cw2_catalog_apply_backend(pid integer primary key);',
    "select pid from dblink('cw2_catalog_apply','select pg_backend_pid()') as apply_backend(pid integer);",
    "raise exception 'CW2 catalog apply session did not enter the exact authenticated local boundary'",'\echo CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_BEGIN',
    "select dblink_send_query('cw2_catalog_apply'",'\echo CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_PASS','\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_WAIT_BEGIN',
    "set local statement_timeout='10000ms';",'\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_BEGIN','\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVE_STAGE_BEGIN',
    'from pg_catalog.pg_locks waiting','join cw2_catalog_apply_backend apply_backend on apply_backend.pid=waiting.pid',"where waiting.locktype='advisory'",'and waiting.database=(select oid from pg_catalog.pg_database where datname=current_database())','and waiting.objsubid=2',"and waiting.mode='ExclusiveLock'",'and not waiting.granted','and exists(','from pg_catalog.pg_locks held','where held.pid=pg_backend_pid()','and held.locktype=waiting.locktype','and held.database=waiting.database','and held.classid=waiting.classid','and held.objid=waiting.objid','and held.objsubid=waiting.objsubid','and held.mode=waiting.mode','and held.granted',"raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_TIMEOUT_BEGIN';",'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVED_PASS','CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_REQUEST_BEGIN','CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_REQUEST_PASS','CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_PASS','CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_PASS','CONNECT_WORKFLOWS_CW2_APPLY_BUSY_POLL_BEGIN','CONNECT_WORKFLOWS_CW2_APPLY_BUSY_CLEAR_PASS','CONNECT_WORKFLOWS_CW2_APPLY_BUSY_TIMEOUT_BEGIN','CONNECT_WORKFLOWS_CW2_APPLY_RESULT_DRAIN_BEGIN','if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then','CONNECT_WORKFLOWS_CW2_APPLY_RESULT_DRAIN_PASS','CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_PASS','CONNECT_WORKFLOWS_CW2_APPLY_BUSY_TIMEOUT_DISCONNECT_PASS','\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_PASS','\echo CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS',
    "select dblink_send_query('cw2_catalog_writer'","select status from dblink_get_result('cw2_catalog_writer') as setup(status text);","select status from dblink_get_result('cw2_catalog_writer') as attestation(status text);","select count(status) from dblink_get_result('cw2_catalog_writer',false) as failed_action(status text);","update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');",'(select message from cw2_catalog_writer_result) is null',"!~ '^ERROR:  canceling statement due to lock timeout'",'writer_terminal_results integer check(writer_terminal_results=0)',"select count(*) from dblink_get_result('cw2_catalog_writer') as terminal(status text);",'\echo CONNECT_WORKFLOWS_CW2_WRITER_ASYNC_RESULT_DRAIN_PASS','\echo CONNECT_WORKFLOWS_CW2_WRITER_LOCK_TIMEOUT_PASS','\echo CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS','\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN',
    "insert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);",'terminal_results integer check(terminal_results=0)',"select count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);",'\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_DRAIN_PASS','create temporary table cw2_catalog_writer_released(status text);',"(select status from cw2_catalog_writer_released) <> 'UPDATE 1'","or not exists(select 1 from public.program_inventory_matches where assigned_product_id='c2500000-0000-4000-8000-000000000002' and quantity_in_inventory_unit=0.001)","or exists(select 1 from public.application_records where notes like 'Created from Programs pass c2500000%')","raise exception 'CW2 concurrent catalog proof did not preserve one exact no-record draw'"
  )
  $cursor=0
  foreach($required in $requiredInOrder){$matches=[regex]::Matches($block,[regex]::Escape($required)); if($matches.Count -ne 1 -or $matches[0].Index -lt $cursor){return $false}; $cursor=$matches[0].Index+$matches[0].Length}
  if([regex]::Matches($block,[regex]::Escape('set role authenticated;')).Count -ne 3 -or
     [regex]::Matches($block,[regex]::Escape("set local statement_timeout='10000ms';")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("dblink_get_result('cw2_catalog_apply'")).Count -ne 4 -or
     [regex]::Matches($block,"dblink_get_result\('cw2_catalog_writer'(?:,false)?\)").Count -ne 4 -or
     [regex]::Matches($block,[regex]::Escape("select dblink_send_query('cw2_catalog_writer'")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("select dblink_exec('cw2_catalog_writer','begin');")).Count -ne 2 -or
     [regex]::Matches($block,[regex]::Escape("dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000'' application_name=cw2_catalog_apply")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000 -clock_timeout=500'' application_name=cw2_catalog_writer")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("select dblink_is_busy('cw2_catalog_writer')=0 into v_done;")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("perform dblink_cancel_query('cw2_catalog_writer');")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("raise exception 'CW2 catalog writer did not finish inside the exact asynchronous wait bound';")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("select status from dblink_get_result('cw2_catalog_writer') as setup(status text);")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("select status from dblink_get_result('cw2_catalog_writer') as attestation(status text);")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('result_count integer check(result_count=0)')).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('(select result_count from cw2_catalog_writer_result) <> 0')).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('(select message from cw2_catalog_writer_result) is null')).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("select count(status) from dblink_get_result('cw2_catalog_writer',false) as failed_action(status text);")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('writer_terminal_results integer check(writer_terminal_results=0)')).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('CONNECT_WORKFLOWS_CW2_WRITER_ASYNC_RESULT_DRAIN_PASS')).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("select dblink_disconnect('cw2_catalog_apply');")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("select dblink_disconnect('cw2_catalog_writer');")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('select pg_cancel_backend(pid)')).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('from cw2_catalog_apply_backend')).Count -ne 3 -or
     [regex]::Matches($block,[regex]::Escape("select dblink_cancel_query('cw2_catalog_apply')")).Count -ne 0 -or
     [regex]::Matches($block,[regex]::Escape("select dblink_is_busy('cw2_catalog_apply') into v_busy;")).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('select pg_terminate_backend(pid,5000)')).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('select pg_advisory_unlock(25000,2)')).Count -ne 2 -or
     [regex]::Matches($block,[regex]::Escape("set local statement_timeout='5000ms';")).Count -ne 8 -or
     [regex]::Matches($block,[regex]::Escape("current_setting('statement_timeout',true) <> '5s'")).Count -ne 8 -or
     [regex]::Matches($block,'(?is)when\s+others\s+then\s+null').Count -ne 0 -or
     [regex]::Matches($block,[regex]::Escape('held.classid=waiting.classid')).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('held.objid=waiting.objid')).Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape('select not exists(select 1 from pg_catalog.pg_stat_activity where pid=(select apply_pid from cw2_catalog_apply_recovery_state)) into strict v_terminated;')).Count -ne 1 -or
     [regex]::Matches($block,'\bpg_stat_activity\b').Count -ne 1 -or
     [regex]::Matches($block,[regex]::Escape("or session_user <> 'supabase_admin'")).Count -ne 4 -or
     [regex]::Matches($block,[regex]::Escape("or current_database() <> 'postgres'")).Count -ne 4 -or
     [regex]::Matches($block,[regex]::Escape('or inet_client_addr() is not null')).Count -ne 4 -or
     [regex]::Matches($block,[regex]::Escape("not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated' and not rolsuper and not rolbypassrls)")).Count -ne 3 -or
     [regex]::Matches($block,[regex]::Escape("current_setting('lock_timeout',true) <> '500ms'")).Count -ne 3 -or
     [regex]::Matches($block,[regex]::Escape("current_setting('request.jwt.claims',true)::jsonb <> '{`"sub`":`"27000000-0000-4000-8000-000000000001`",`"role`":`"authenticated`"}'::jsonb")).Count -ne 3 -or
     $block -match '(?i)(password\s*=|passfile\s*=|host(?:addr)?\s*=|dblink_connect_u|service_role|session_replication_role|session\s+authorization|row_security\s*=\s*off|disable\s+trigger|enable\s+trigger|\breset\s+role\b)'){return $false}
  $tokenizableBlock=[regex]::Replace($block,'(?m)^\\echo[^\r\n]*(?:\r?\n|$)','')
  try{$topLevelTokens=@(ConvertTo-Cw2PostgresTokens $tokenizableBlock)}catch{return $false}
  for($i=0;$i -lt $topLevelTokens.Count-2;$i+=1){
    if($topLevelTokens[$i].Kind -cne 'word'){continue}
    if($topLevelTokens[$i].Value -ceq 'update' -and $topLevelTokens[$i+1].Kind -ceq 'word' -and $topLevelTokens[$i+1].Value -ceq 'public'){return $false}
    if($topLevelTokens[$i].Value -ceq 'insert' -and $topLevelTokens[$i+1].Value -ceq 'into' -and $topLevelTokens[$i+2].Value -ceq 'public'){return $false}
    if($topLevelTokens[$i].Value -ceq 'delete' -and $topLevelTokens[$i+1].Value -ceq 'from' -and $topLevelTokens[$i+2].Value -ceq 'public'){return $false}
  }
  if(@($topLevelTokens | Where-Object {$_.Kind -ceq 'word' -and $_.Value -ceq 'mark_program_pass_applied'}).Count -ne 0){return $false}
  if(-not (Test-Cw2ApplyRecoveryStaticContract $block)){return $false}
  if(-not (Test-Cw2CredentialExecutableBodies $block)){return $false}
  $true
}

function Test-Cw2ApplyRecoveryStaticContract([string]$Block) {
  $ordered=@(
    "set local statement_timeout='10000ms';",'\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_BEGIN','\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVE_STAGE_BEGIN',"current_setting('statement_timeout',true) <> '10s'",'CW2R0','APPLY_READINESS_NOT_OBSERVED',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVE_STAGE_END','\echo CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_STAGE_BEGIN',"set local statement_timeout='5000ms';",'cancel-apply',"current_setting('statement_timeout',true) <> '5s'",'pg_cancel_backend(pid)','\echo CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_STAGE_BEGIN','unlock-advisory','pg_advisory_unlock(25000,2)','\echo CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_BUSY_STAGE_BEGIN','busy-poll',"dblink_is_busy('cw2_catalog_apply')",'exit when v_busy=0;','\echo CONNECT_WORKFLOWS_CW2_APPLY_BUSY_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_TERMINATE_STAGE_BEGIN','terminate-apply','pg_terminate_backend(pid,5000)','pg_stat_activity where pid=(select apply_pid from cw2_catalog_apply_recovery_state)','\echo CONNECT_WORKFLOWS_CW2_APPLY_TERMINATE_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_BEGIN','drain-apply',"CW2 catalog apply was still busy before result drain","dblink_get_result('cw2_catalog_apply',false)",'\echo CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_STAGE_BEGIN','disconnect-apply',"dblink_disconnect('cw2_catalog_apply')",'connection_absent','\echo CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_ROLLBACK_STAGE_BEGIN','rollback-writer',"dblink_exec('cw2_catalog_writer','rollback')",'\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_ROLLBACK_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_DISCONNECT_STAGE_BEGIN','disconnect-writer',"dblink_disconnect('cw2_catalog_writer')",'\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_DISCONNECT_STAGE_END',
    '\echo CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_BEGIN','CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_STAGE:','order by stage_order;','\echo CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_END','string_agg(stage||'':''||timeout_setting','order by stage_order) into v_failures','CW2 catalog apply readiness recovery required'
  )
  $cursor=0
  foreach($required in $ordered){$index=$Block.IndexOf($required,$cursor,[StringComparison]::Ordinal);if($index -lt 0){return $false};$cursor=$index+$required.Length}
  $readinessRecord="insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('readiness-observe',1,clock_timestamp(),current_setting('statement_timeout',true));"
  $readinessRecordIndex=$Block.IndexOf($readinessRecord,[StringComparison]::Ordinal);$readinessStartIndex=$Block.IndexOf('do $wait$',[StringComparison]::Ordinal);$readinessEndIndex=$Block.IndexOf('$wait$;',$readinessStartIndex,[StringComparison]::Ordinal)
  if($readinessRecordIndex -lt 0 -or $readinessRecordIndex -ge $readinessStartIndex -or [regex]::Matches($Block,[regex]::Escape($readinessRecord)).Count -ne 1 -or $readinessEndIndex -le $readinessStartIndex){return $false}
  $readinessBlock=$Block.Substring($readinessStartIndex,$readinessEndIndex+'$wait$;'.Length-$readinessStartIndex)
  $readinessBoundIndex=$readinessBlock.IndexOf("current_setting('statement_timeout',true) <> '10s'",[StringComparison]::Ordinal);$readinessActionIndex=$readinessBlock.IndexOf('for i in 1..100 loop',$readinessBoundIndex,[StringComparison]::Ordinal)
  $readinessCatch="exception when query_canceled or others then`n  get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;`n  update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='readiness-observe';"
  if($readinessBoundIndex -lt 0 -or $readinessActionIndex -le $readinessBoundIndex -or $readinessBlock.IndexOf($readinessCatch,$readinessActionIndex,[StringComparison]::Ordinal) -le $readinessActionIndex){return $false}
  $boundedStages=@(
    [pscustomobject]@{Name='cancel-apply';Start='do $cancel$';End='$cancel$;';Action='select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;';Order=2},
    [pscustomobject]@{Name='unlock-advisory';Start='do $unlock$';End='$unlock$;';Action='select pg_advisory_unlock(25000,2) into v_unlocked;';Order=3},
    [pscustomobject]@{Name='busy-poll';Start='do $busy$';End='$busy$;';Action="for i in 1..100 loop select dblink_is_busy('cw2_catalog_apply') into v_busy;";Order=4},
    [pscustomobject]@{Name='terminate-apply';Start='do $terminate$';End='$terminate$;';Action='select pg_terminate_backend(pid,5000) from cw2_catalog_apply_backend into v_terminated;';Order=5},
    [pscustomobject]@{Name='drain-apply';Start='do $drain$';End='$drain$;';Action="dblink_get_result('cw2_catalog_apply',false) as cleanup_primary";Order=6},
    [pscustomobject]@{Name='disconnect-apply';Start='do $disconnect$';End='$disconnect$;';Action="select dblink_disconnect('cw2_catalog_apply') into v_disconnect;";Order=7},
    [pscustomobject]@{Name='rollback-writer';Start='do $writer_rollback$';End='$writer_rollback$;';Action="select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;";Order=8},
    [pscustomobject]@{Name='disconnect-writer';Start='do $writer_disconnect$';End='$writer_disconnect$;';Action="select dblink_disconnect('cw2_catalog_writer') into v_disconnect;";Order=9}
  )
  foreach($stage in $boundedStages){
    $startIndex=$Block.IndexOf($stage.Start,[StringComparison]::Ordinal);$endIndex=$Block.IndexOf($stage.End,$startIndex,[StringComparison]::Ordinal)
    if($startIndex -lt 0 -or $endIndex -le $startIndex){return $false}
    $stageBlock=$Block.Substring($startIndex,$endIndex+$stage.End.Length-$startIndex)
    $record="values ('$($stage.Name)',$($stage.Order),clock_timestamp(),current_setting('statement_timeout',true))"
    $recordIndex=$stageBlock.IndexOf($record,[StringComparison]::Ordinal);$boundIndex=$stageBlock.IndexOf("current_setting('statement_timeout',true) <> '5s'",$recordIndex,[StringComparison]::Ordinal);$actionIndex=$stageBlock.IndexOf($stage.Action,$boundIndex,[StringComparison]::Ordinal)
    $boundedAction="begin`n    if current_setting('statement_timeout',true) <> '5s' then raise exception"
    $catch="exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='$($stage.Name)'; end;"
    $catchIndex=$stageBlock.IndexOf($catch,[StringComparison]::Ordinal)
    if($recordIndex -lt 0 -or $boundIndex -le $recordIndex -or $actionIndex -le $boundIndex -or $stageBlock.IndexOf($boundedAction,[StringComparison]::Ordinal) -lt 0 -or $catchIndex -le $actionIndex){return $false}
  }
  if([regex]::Matches($Block,[regex]::Escape("set local statement_timeout='10000ms';")).Count -ne 1 -or
     [regex]::Matches($Block,[regex]::Escape("set local statement_timeout='5000ms';")).Count -ne 8 -or
     [regex]::Matches($Block,[regex]::Escape("for i in 1..100 loop`n    select`n      exists(")).Count -ne 1 -or
      [regex]::Matches($Block,[regex]::Escape("current_setting('statement_timeout',true) <> '5s'")).Count -ne 8 -or
      [regex]::Matches($Block,[regex]::Escape('set finished_at=clock_timestamp(),succeeded=v_ready,')).Count -ne 1 -or
      [regex]::Matches($Block,'(?is)when\s+others\s+then\s+null').Count -ne 0 -or
      [regex]::Matches($Block,'(?i)exception\s+when\s+query_canceled\s+or\s+others\s+then').Count -ne 9 -or
      [regex]::Matches($Block,[regex]::Escape('get stacked diagnostics')).Count -ne 9 -or
     [regex]::Matches($Block,[regex]::Escape('select not exists(select 1 from pg_catalog.pg_stat_activity where pid=(select apply_pid from cw2_catalog_apply_recovery_state)) into strict v_terminated;')).Count -ne 1 -or
     [regex]::Matches($Block,'\bpg_stat_activity\b').Count -ne 1 -or
     [regex]::Matches($Block,[regex]::Escape("dblink_get_result('cw2_catalog_apply',false)")).Count -ne 2 -or
     [regex]::Matches($Block,[regex]::Escape('do $writer_rollback$')).Count -ne 1 -or
     [regex]::Matches($Block,[regex]::Escape('do $writer_disconnect$')).Count -ne 1){return $false}
  $true
}
# CW2_PROOF_005_STATIC_GUARD_END

function Get-Cw2UniqueSourceSpan([string]$Source,[string]$StartMarker,[string]$EndMarker) {
  if ([regex]::Matches($Source,[regex]::Escape($StartMarker)).Count -ne 1 -or [regex]::Matches($Source,[regex]::Escape($EndMarker)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_SOURCE_SPAN_AMBIGUOUS' }
  $start = $Source.IndexOf($StartMarker,[StringComparison]::Ordinal); $end = $Source.IndexOf($EndMarker,[StringComparison]::Ordinal)
  if ($start -lt 0 -or $end -lt $start) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_SOURCE_SPAN_ORDER' }
  $Source.Substring($start,$end + $EndMarker.Length - $start)
}

function Get-Cw2Proof005TextSha256([string]$Source) { Get-Cw2Sha256 ([Text.UTF8Encoding]::new($false).GetBytes($Source)) }

# CW2_FK_INDEX_STATIC_GUARD_BEGIN
function Test-Cw2FkIndexMigrationContract([string]$Source) {
  $assigned = '(?ms)^\s*create\s+index\s+program_inventory_matches_assigned_product_farm_idx\s*\r?\n\s*on\s+public\.program_inventory_matches\s*\(\s*assigned_product_id\s*,\s*farm_id\s*\)\s*;'
  $inventory = '(?ms)^\s*create\s+index\s+program_inventory_matches_inventory_product_farm_idx\s*\r?\n\s*on\s+public\.program_inventory_matches\s*\(\s*inventory_product_id\s*,\s*farm_id\s*\)\s*;'
  $assignedMatch = [regex]::Match($Source,$assigned)
  $inventoryMatch = [regex]::Match($Source,$inventory)
  return $assignedMatch.Success -and $inventoryMatch.Success -and
    [regex]::Matches($Source,$assigned).Count -eq 1 -and [regex]::Matches($Source,$inventory).Count -eq 1 -and
    $assignedMatch.Index -lt $inventoryMatch.Index
}
# CW2_FK_INDEX_STATIC_GUARD_END

# CW2_FK_INDEX_EXECUTABLE_MATRIX_BEGIN
function New-Cw2FkIndexSemanticMutation([string]$Name,[string]$MutationSource) {
  [pscustomobject]@{
    Name=$Name
    Source=$MutationSource
    ExpectedSha256=(Get-Cw2Sha256 ([Text.UTF8Encoding]::new($false).GetBytes($MutationSource)))
  }
}

function Invoke-Cw2FkIndexMigrationMutationProof([string]$Source) {
  $assigned = "create index program_inventory_matches_assigned_product_farm_idx`n  on public.program_inventory_matches (assigned_product_id, farm_id);"
  $inventory = "create index program_inventory_matches_inventory_product_farm_idx`n  on public.program_inventory_matches (inventory_product_id, farm_id);"
  if ([regex]::Matches($Source,[regex]::Escape($assigned)).Count -ne 1 -or [regex]::Matches($Source,[regex]::Escape($inventory)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_MUTATION_TARGET_INVALID' }
  $mutations = @(
    (New-Cw2FkIndexSemanticMutation 'assigned index removed' $Source.Replace($assigned,"-- $assigned")),
    (New-Cw2FkIndexSemanticMutation 'assigned index columns reordered' $Source.Replace('(assigned_product_id, farm_id)','(farm_id, assigned_product_id)')),
    (New-Cw2FkIndexSemanticMutation 'assigned index renamed' $Source.Replace('program_inventory_matches_assigned_product_farm_idx','program_inventory_matches_assigned_product_wrong_idx')),
    (New-Cw2FkIndexSemanticMutation 'assigned index misdirected' $Source.Replace('on public.program_inventory_matches (assigned_product_id, farm_id);','on public.assigned_program_pass_products (id, farm_id);')),
    (New-Cw2FkIndexSemanticMutation 'assigned partial predicate added' $Source.Replace('(assigned_product_id, farm_id);','(assigned_product_id, farm_id) where farm_id is not null;')),
    (New-Cw2FkIndexSemanticMutation 'assigned wider index added' $Source.Replace('(assigned_product_id, farm_id);','(assigned_product_id, farm_id, confirmed_at);')),
    (New-Cw2FkIndexSemanticMutation 'inventory index removed' $Source.Replace($inventory,"-- $inventory")),
    (New-Cw2FkIndexSemanticMutation 'inventory index columns reordered' $Source.Replace('(inventory_product_id, farm_id)','(farm_id, inventory_product_id)')),
    (New-Cw2FkIndexSemanticMutation 'inventory index renamed' $Source.Replace('program_inventory_matches_inventory_product_farm_idx','program_inventory_matches_inventory_product_wrong_idx')),
    (New-Cw2FkIndexSemanticMutation 'inventory index misdirected' $Source.Replace('on public.program_inventory_matches (inventory_product_id, farm_id);','on public.inventory_products (id, farm_id);')),
    (New-Cw2FkIndexSemanticMutation 'inventory partial predicate added' $Source.Replace('(inventory_product_id, farm_id);','(inventory_product_id, farm_id) where farm_id is not null;')),
    (New-Cw2FkIndexSemanticMutation 'inventory wider index added' $Source.Replace('(inventory_product_id, farm_id);','(inventory_product_id, farm_id, confirmed_at);')),
    (New-Cw2FkIndexSemanticMutation 'follow-up migration omitted' ''),
    (New-Cw2FkIndexSemanticMutation 'foreign-key index order swapped' $Source.Replace($assigned,'CW2_ASSIGNED_INDEX_TEMP').Replace($inventory,$assigned).Replace('CW2_ASSIGNED_INDEX_TEMP',$inventory)),
    [pscustomobject]@{Name='follow-up migration hash drift';Source=$Source;ExpectedSha256='0000000000000000000000000000000000000000000000000000000000000000'}
  )
  $expectedNames = @('assigned index removed','assigned index columns reordered','assigned index renamed','assigned index misdirected','assigned partial predicate added','assigned wider index added','inventory index removed','inventory index columns reordered','inventory index renamed','inventory index misdirected','inventory partial predicate added','inventory wider index added','follow-up migration omitted','foreign-key index order swapped','follow-up migration hash drift')
  if ($mutations.Count -ne 15 -or [string]::Join('|',[string[]]$mutations.Name) -cne [string]::Join('|',$expectedNames)) { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_MUTATION_MATRIX_INVALID' }
  $executed = 0
  foreach ($mutation in $mutations) {
    $mutationBytes=[Text.UTF8Encoding]::new($false).GetBytes([string]$mutation.Source)
    if ((Test-Cw2FkIndexMigrationContract $mutation.Source) -and (Get-Cw2Sha256 $mutationBytes) -ceq $mutation.ExpectedSha256) { throw "CONNECT_WORKFLOWS_CW2_FK_INDEX_MUTATION_SURVIVED:$($mutation.Name)" }
    $executed += 1
  }
  if ($executed -ne $mutations.Count) { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_MUTATION_EXECUTION_INCOMPLETE' }
}
# CW2_FK_INDEX_EXECUTABLE_MATRIX_END

# CW2_ARTIFACT_MANIFEST_FOCUSED_STATIC_GUARD_BEGIN
function Test-Cw2ArtifactManifestFocusedMatrix([string]$Source) {
  try {
    $start='// CW2_ARTIFACT_MANIFEST_DISCOVERY_'+'MATRIX_BEGIN';$end='// CW2_ARTIFACT_MANIFEST_DISCOVERY_'+'MATRIX_END'
    $span=Get-Cw2UniqueSourceSpan $Source $start $end
    $childStart='// CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_'+'BEGIN';$childEnd='// CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_'+'END'
    $childSpan=Get-Cw2UniqueSourceSpan $Source $childStart $childEnd
    return (Get-Cw2Proof005TextSha256 $span)-ceq'b2a744acd29d74885fcc28031dd22b6d5d57fad290d286abe3f4d6003a434782'-and(Get-Cw2Proof005TextSha256 $childSpan)-ceq'01551b9dad86fafa82b99224c2f2317d699be3a08edd1863cd9467a7b9dae092'
  } catch { return $false }
}
# CW2_ARTIFACT_MANIFEST_FOCUSED_STATIC_GUARD_END

# CW2_ARTIFACT_MANIFEST_FOCUSED_OUTER_MATRIX_BEGIN
function Invoke-Cw2ArtifactManifestFocusedMatrixProof([string]$Source) {
  $start='// CW2_ARTIFACT_MANIFEST_DISCOVERY_'+'MATRIX_BEGIN';$end='// CW2_ARTIFACT_MANIFEST_DISCOVERY_'+'MATRIX_END'
  $span=Get-Cw2UniqueSourceSpan $Source $start $end
  $omitted=$Source.Replace($span,"$start`n$end")
  if($omitted-ceq$Source-or-not(Test-Cw2ArtifactManifestFocusedMatrix $Source)-or(Test-Cw2ArtifactManifestFocusedMatrix $omitted)){throw 'CONNECT_WORKFLOWS_CW2_ARTIFACT_MANIFEST_FOCUSED_MATRIX_OMISSION_PROOF_FAILED'}
  Write-Output 'CONNECT_WORKFLOWS_CW2_ARTIFACT_MANIFEST_FOCUSED_MATRIX_OMISSION_PASS'
}
# CW2_ARTIFACT_MANIFEST_FOCUSED_OUTER_MATRIX_END

# CW2_ARTIFACT_MANIFEST_OUTER_SELFTEST_BEGIN
function Invoke-Cw2Proof005OuterSelfTest([string]$RunnerSource) {
  $guardStart = '# CW2_PROOF_005_' + 'STATIC_GUARD_BEGIN'; $guardEnd = '# CW2_PROOF_005_' + 'STATIC_GUARD_END'
  $matrixStart = '# CW2_PROOF_005_' + 'EXECUTABLE_MATRIX_BEGIN'; $matrixEnd = '# CW2_PROOF_005_' + 'EXECUTABLE_MATRIX_END'
  $credentialMatrixStart='# CW2_CREDENTIAL_HANDOFF_' + 'MUTATION_BEGIN'; $credentialMatrixEnd='# CW2_CREDENTIAL_HANDOFF_' + 'MUTATION_END'
  $guardSpan = Get-Cw2UniqueSourceSpan $RunnerSource $guardStart $guardEnd; $matrixSpan = Get-Cw2UniqueSourceSpan $RunnerSource $matrixStart $matrixEnd
  $credentialMatrixSpan=Get-Cw2UniqueSourceSpan $RunnerSource $credentialMatrixStart $credentialMatrixEnd
  $credentialFixtureNativeSpan=Get-Cw2CredentialFixtureNativeSpan $RunnerSource
  $fkIndexGuardStart='# CW2_FK_INDEX_' + 'STATIC_GUARD_BEGIN'; $fkIndexGuardEnd='# CW2_FK_INDEX_' + 'STATIC_GUARD_END'
  $fkIndexMatrixStart='# CW2_FK_INDEX_' + 'EXECUTABLE_MATRIX_BEGIN'; $fkIndexMatrixEnd='# CW2_FK_INDEX_' + 'EXECUTABLE_MATRIX_END'
  $fkIndexGuardSpan=Get-Cw2UniqueSourceSpan $RunnerSource $fkIndexGuardStart $fkIndexGuardEnd
  $fkIndexMatrixSpan=Get-Cw2UniqueSourceSpan $RunnerSource $fkIndexMatrixStart $fkIndexMatrixEnd
  $artifactFocusedGuardStart='# CW2_ARTIFACT_MANIFEST_FOCUSED_'+'STATIC_GUARD_BEGIN';$artifactFocusedGuardEnd='# CW2_ARTIFACT_MANIFEST_FOCUSED_'+'STATIC_GUARD_END'
  $artifactFocusedMatrixStart='# CW2_ARTIFACT_MANIFEST_FOCUSED_'+'OUTER_MATRIX_BEGIN';$artifactFocusedMatrixEnd='# CW2_ARTIFACT_MANIFEST_FOCUSED_'+'OUTER_MATRIX_END'
  $artifactFocusedGuardSpan=Get-Cw2UniqueSourceSpan $RunnerSource $artifactFocusedGuardStart $artifactFocusedGuardEnd
  $artifactFocusedMatrixSpan=Get-Cw2UniqueSourceSpan $RunnerSource $artifactFocusedMatrixStart $artifactFocusedMatrixEnd
  $fkIndexInvocation='  Invoke-Cw2FkIndexMigrationMutation' + 'Proof ([Text.UTF8Encoding]::new($false).GetString($fkIndexMigrationBytes))'
  if ([regex]::Matches($RunnerSource,[regex]::Escape($fkIndexInvocation)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_MATRIX_INVOCATION_AMBIGUOUS' }
  $cases = @(
    [pscustomobject]@{Name='baseline';Source=$RunnerSource;ExpectedExit=0},
    [pscustomobject]@{Name='matrix-only deletion';Source=$RunnerSource.Replace($matrixSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='credential-matrix-only deletion';Source=$RunnerSource.Replace($credentialMatrixSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='credential-fixture-native deletion';Source=$RunnerSource.Replace($credentialFixtureNativeSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='fk-index-matrix-only deletion';Source=$RunnerSource.Replace($fkIndexMatrixSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='fk-index-matrix-invocation deletion';Source=$RunnerSource.Replace($fkIndexInvocation,'');ExpectedExit=1},
    [pscustomobject]@{Name='fk-index-guard-only deletion';Source=$RunnerSource.Replace($fkIndexGuardSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='fk-index-guard-and-matrix deletion';Source=$RunnerSource.Replace($fkIndexGuardSpan,'').Replace($fkIndexMatrixSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='artifact-focused-matrix-only deletion';Source=$RunnerSource.Replace($artifactFocusedMatrixSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='artifact-focused-guard-only deletion';Source=$RunnerSource.Replace($artifactFocusedGuardSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='artifact-focused-guard-and-matrix deletion';Source=$RunnerSource.Replace($artifactFocusedGuardSpan,'').Replace($artifactFocusedMatrixSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='guard-only deletion';Source=$RunnerSource.Replace($guardSpan,'');ExpectedExit=1},
    [pscustomobject]@{Name='guard-and-matrix deletion';Source=$RunnerSource.Replace($guardSpan,'').Replace($matrixSpan,'');ExpectedExit=1}
  )
  $expectedCaseNames=@('baseline','matrix-only deletion','credential-matrix-only deletion','credential-fixture-native deletion','fk-index-matrix-only deletion','fk-index-matrix-invocation deletion','fk-index-guard-only deletion','fk-index-guard-and-matrix deletion','artifact-focused-matrix-only deletion','artifact-focused-guard-only deletion','artifact-focused-guard-and-matrix deletion','guard-only deletion','guard-and-matrix deletion')
  if ($cases.Count -ne 13 -or [string]::Join('|',[string[]]$cases.Name) -cne [string]::Join('|',$expectedCaseNames)) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_OUTER_CASES_INVALID' }
  $powershellExe = (Get-Command powershell.exe -CommandType Application -ErrorAction Stop).Source
  $tempRoot=Join-Path ([IO.Path]::GetTempPath())("farmrx-cw2-proof005-$([guid]::NewGuid().ToString('N'))")
  [void][IO.Directory]::CreateDirectory($tempRoot)
  $paths = [Collections.Generic.List[string]]::new();$primary=$null;$cleanupErrors=[Collections.Generic.List[Exception]]::new()
  try {
    foreach ($case in $cases) {
      $path = Join-Path $tempRoot ("cw2-proof005-$([guid]::NewGuid().ToString('N')).ps1"); $paths.Add($path)
      [IO.File]::WriteAllText($path,$case.Source,[Text.UTF8Encoding]::new($false))
      $savedPreference = $ErrorActionPreference
      try { $ErrorActionPreference='Continue'; $output=@(& $powershellExe -NoProfile -ExecutionPolicy Bypass -File $path -StaticOnly -Proof005Child -Proof005RepositoryRoot $root 2>&1); $exitCode=$LASTEXITCODE }
      finally { $ErrorActionPreference=$savedPreference }
      if ($case.ExpectedExit -eq 0) {
        if ($exitCode -ne 0 -or ([string]::Join("`n",[string[]]$output)) -notmatch '(?m)^CONNECT_WORKFLOWS_CW2_STATIC_CONTRACT_PASS$') { throw "CONNECT_WORKFLOWS_CW2_PROOF_005_BASELINE_FAILED:$exitCode" }
      } elseif ($exitCode -eq 0) { throw "CONNECT_WORKFLOWS_CW2_PROOF_005_OUTER_MUTATION_SURVIVED:$($case.Name)" }
    }
  } catch { $primary=$_.Exception }
  finally {
    foreach($path in $paths){try{if([IO.File]::Exists($path)){[IO.File]::Delete($path)};if([IO.File]::Exists($path)){throw "CONNECT_WORKFLOWS_CW2_PROOF_005_TEMP_REMAINS:$path"}}catch{$cleanupErrors.Add($_.Exception)}}
    try{if([IO.Directory]::Exists($tempRoot)){[IO.Directory]::Delete($tempRoot,$false)};if([IO.Directory]::Exists($tempRoot)){throw "CONNECT_WORKFLOWS_CW2_PROOF_005_TEMP_ROOT_REMAINS:$tempRoot"}}catch{$cleanupErrors.Add($_.Exception)}
  }
  if($null-ne$primary-and$cleanupErrors.Count-gt0){throw[AggregateException]::new('CONNECT_WORKFLOWS_CW2_PROOF_005_PRIMARY_AND_CLEANUP_FAILED',[Exception[]]@($primary)+[Exception[]]$cleanupErrors.ToArray())}
  if($null-ne$primary){throw$primary}
  if($cleanupErrors.Count-gt0){throw[AggregateException]::new('CONNECT_WORKFLOWS_CW2_PROOF_005_CLEANUP_FAILED',[Exception[]]$cleanupErrors.ToArray())}
  Write-Output 'CONNECT_WORKFLOWS_CW2_PROOF_005_OUTER_SELFTEST_PASS'
}
# CW2_ARTIFACT_MANIFEST_OUTER_SELFTEST_END

function Assert-Cw2Contract {
  $runnerSource = Get-Content -Raw -LiteralPath $runnerPath
  $artifactOuterSelfTestStart='# CW2_ARTIFACT_MANIFEST_'+'OUTER_SELFTEST_BEGIN';$artifactOuterSelfTestEnd='# CW2_ARTIFACT_MANIFEST_'+'OUTER_SELFTEST_END'
  $artifactOuterSelfTestSpan=Get-Cw2UniqueSourceSpan $runnerSource $artifactOuterSelfTestStart $artifactOuterSelfTestEnd
  if((Get-Cw2Proof005TextSha256 $artifactOuterSelfTestSpan)-cne'e5be35dee0e81bcced54e752eb15b2ffa039c2d6b7cfdec4f5a55a6ec4457ea9'){throw 'CONNECT_WORKFLOWS_CW2_ARTIFACT_MANIFEST_OUTER_SELFTEST_PIN_MISMATCH'}
  $required = @(
    $baseFixture,$cw2Fixture,$verify,$concurrencyFixtureVerify,$concurrencyVerify,$specPath,$configPath,$migrationPath,$fkIndexMigrationPath,
    (Join-Path $root 'src/ProgramsModule.tsx'),
    (Join-Path $root 'src/InventoryModule.tsx'),
    (Join-Path $root 'src/data/programs.ts'),
    (Join-Path $root 'src/data/programsDataCache.ts'),
    (Join-Path $root 'src/data/programInventoryCW2.regression.ts'),
    (Join-Path $root 'src/data/SupabaseProgramsRepository.regression.ts'),
    (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1'),
    (Join-Path $root 'scripts/maple-season-db-clock-docker-adapter.psm1'),
    (Join-Path $root 'scripts/maple-season-db-clock-docker-adapter.regression.ps1'),
    (Join-Path $root 'scripts/maple-synthetic-docker-topology-plan.ps1'),
    (Join-Path $root 'scripts/maple-synthetic-docker-topology-plan.regression.ps1'),
    (Join-Path $root 'scripts/faketime-artifact-replacement-manifest.regression.ps1'),
    (Join-Path $root 'scripts/verify-maple-season-db-clock-spike.ps1'),
    (Join-Path $root 'docs/season-readiness/FAKETIME-ARTIFACT-EVIDENCE.md'),
    (Join-Path $root 'docs/season-readiness/FROZEN-OFFLINE-BUILD-EVIDENCE.md'),
    (Join-Path $root 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json')
  )
  if (@($required | Where-Object { -not (Test-Path -LiteralPath $_) }).Count) { throw 'CONNECT_WORKFLOWS_CW2_PACKET_MISSING_REQUIRED_FILE' }
  $head = (Get-ChildItem (Join-Path $root 'supabase/migrations') -File | Sort-Object Name | Select-Object -Last 1).Name
  if ($head -cne $fkIndexMigration) { throw "CONNECT_WORKFLOWS_CW2_MIGRATION_HEAD_MISMATCH:$head" }
  $actualBlob = (& git -C $root hash-object $migrationPath).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualBlob -cne $migrationBlob) { throw 'CONNECT_WORKFLOWS_CW2_MIGRATION_BLOB_MISMATCH' }
  $fkIndexMigrationBytes = [IO.File]::ReadAllBytes($fkIndexMigrationPath)
  if ((Get-Cw2Sha256 $fkIndexMigrationBytes) -cne $fkIndexMigrationSha256 -or -not (Test-Cw2FkIndexMigrationContract ([Text.UTF8Encoding]::new($false).GetString($fkIndexMigrationBytes)))) { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_MIGRATION_CONTRACT_MISMATCH' }
  $fkIndexGuardStart = '# CW2_FK_INDEX_' + 'STATIC_GUARD_BEGIN'; $fkIndexGuardEnd = '# CW2_FK_INDEX_' + 'STATIC_GUARD_END'
  $fkIndexMatrixStart = '# CW2_FK_INDEX_' + 'EXECUTABLE_MATRIX_BEGIN'; $fkIndexMatrixEnd = '# CW2_FK_INDEX_' + 'EXECUTABLE_MATRIX_END'
  $fkIndexGuardSpan = Get-Cw2UniqueSourceSpan $runnerSource $fkIndexGuardStart $fkIndexGuardEnd
  $fkIndexMatrixSpan = Get-Cw2UniqueSourceSpan $runnerSource $fkIndexMatrixStart $fkIndexMatrixEnd
  if ((Get-Cw2Proof005TextSha256 $fkIndexMatrixSpan) -cne '5f56216c66e4e28a1d49b25d8d2596d00524ca4c7b9c2b22f6915541e522ef82') { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_MUTATION_MATRIX_PIN_MISMATCH' }
  $fkIndexInvocation='  Invoke-Cw2FkIndexMigrationMutation' + 'Proof ([Text.UTF8Encoding]::new($false).GetString($fkIndexMigrationBytes))'
  if ([regex]::Matches($runnerSource,[regex]::Escape($fkIndexInvocation)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_MATRIX_INVOCATION_MISSING' }
  Invoke-Cw2FkIndexMigrationMutationProof ([Text.UTF8Encoding]::new($false).GetString($fkIndexMigrationBytes))

  $package = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json')
  foreach ($lane in @('tsx src/data/SupabaseInventoryRepository.regression.ts','tsx src/data/SupabaseProgramsRepository.regression.ts','tsx src/data/programInventoryCW2.regression.ts','tsx src/data/programsChunk5.regression.ts','scripts/maple-season-db-clock-docker-adapter.regression.ps1','scripts/maple-synthetic-docker-topology-plan.regression.ps1','scripts/faketime-artifact-replacement-manifest.regression.ps1')) {
    if ($package -notmatch [regex]::Escape($lane)) { throw "CONNECT_WORKFLOWS_CW2_REGRESSION_LANE_MISSING:$lane" }
  }
  $replacementArtifactRef = 'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365@sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302'
  $replacementArtifactId = 'sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302'
  $replacementArtifactTag = 'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365:synthetic'
  $replacementArtifactToken = 'b9ad08aeb66ed961e8426b2cce527365'
  $retiredArtifact = '4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746'
  $harvestClockSource = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1')
  $clockAdapterSource = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/maple-season-db-clock-docker-adapter.psm1')
  $clockAdapterRegressionSource = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/maple-season-db-clock-docker-adapter.regression.ps1')
  $topologyPlanSource = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/maple-synthetic-docker-topology-plan.ps1')
  $topologyPlanRegressionSource = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/maple-synthetic-docker-topology-plan.regression.ps1')
  $clockSpikeRunnerSource = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/verify-maple-season-db-clock-spike.ps1')
  $artifactEvidenceSource = Get-Content -Raw -LiteralPath (Join-Path $root 'docs/season-readiness/FAKETIME-ARTIFACT-EVIDENCE.md')
  $frozenArtifactEvidenceSource = Get-Content -Raw -LiteralPath (Join-Path $root 'docs/season-readiness/FROZEN-OFFLINE-BUILD-EVIDENCE.md')
  $artifactEvidenceManifestPath = Join-Path $root 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json'
  try { $artifactEvidenceManifest = Get-Content -Raw -LiteralPath $artifactEvidenceManifestPath | ConvertFrom-Json } catch { throw 'CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_EVIDENCE_MANIFEST_MALFORMED' }
  $liveArtifactSources = @($harvestClockSource,$clockAdapterSource,$clockAdapterRegressionSource,$topologyPlanSource,$topologyPlanRegressionSource,$clockSpikeRunnerSource)
  if (@($liveArtifactSources | Where-Object { $_ -match [regex]::Escape($retiredArtifact) -or $_ -match 'maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7' }).Count -ne 0) { throw 'CONNECT_WORKFLOWS_CW2_RETIRED_FAKETIME_ARTIFACT_LIVE_REFERENCE' }
  foreach ($source in @($harvestClockSource,$clockAdapterSource,$clockAdapterRegressionSource,$topologyPlanSource,$topologyPlanRegressionSource)) {
    if ($source -notmatch [regex]::Escape($replacementArtifactId) -or $source -notmatch [regex]::Escape($replacementArtifactToken)) { throw 'CONNECT_WORKFLOWS_CW2_REPLACEMENT_FAKETIME_ARTIFACT_IDENTITY_MISSING' }
  }
  if ($harvestClockSource -notmatch [regex]::Escape($replacementArtifactRef) -or $clockAdapterSource -notmatch [regex]::Escape($replacementArtifactRef) -or $clockAdapterRegressionSource -notmatch [regex]::Escape($replacementArtifactRef) -or $topologyPlanSource -notmatch [regex]::Escape($replacementArtifactRef) -or $topologyPlanRegressionSource -notmatch [regex]::Escape($replacementArtifactRef) -or $clockSpikeRunnerSource -notmatch [regex]::Escape($replacementArtifactTag) -or $clockSpikeRunnerSource -notmatch [regex]::Escape($replacementArtifactRef) -or $clockSpikeRunnerSource -notmatch [regex]::Escape($replacementArtifactId) -or $clockSpikeRunnerSource -notmatch [regex]::Escape('function Assert-ExactReusableArtifact')) { throw 'CONNECT_WORKFLOWS_CW2_REPLACEMENT_FAKETIME_ARTIFACT_REF_MISSING' }
  $cleanupBlock = [regex]::Match($clockAdapterSource,'(?s)\$adapter\.RemoveDerivedImageIfOwned\s*=\s*\{.*?\n\s*return \$adapter').Value
  $cleanupTargets = @([regex]::Matches($cleanupBlock,[regex]::Escape("@('image','rm',")+'([^\)]+)\)') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $_ })
  if ($clockAdapterSource -notmatch [regex]::Escape('$artifactByRef=& $inspectImage $artifactRef') -or $clockAdapterSource -notmatch [regex]::Escape('$artifactByTag=& $inspectImage $artifactLocalTag') -or $cleanupTargets.Count -ne 2 -or @($cleanupTargets | Where-Object {$_ -cne '$Inventory.derived_tag' -and $_ -cne '$Inventory.snapshot_tag'}).Count -ne 0 -or $cleanupBlock -match '(?i)(artifactLocalTag|artifactRef|artifactId|image\s+prune|system\s+prune)') { throw 'CONNECT_WORKFLOWS_CW2_REUSABLE_FAKETIME_ARTIFACT_CLEANUP_OR_INSPECT_DRIFTED' }
  $expectedArtifactEvidenceFiles = [ordered]@{'artifact-identity.json'='d8b95bfa5a83c56b3236a5579ad33043456e0fb5b09d1f93005efb1ec48e4276';'build-input-completeness.json'='97cbbca788a38b14b11e7780fdeb00b6852a224bf39076174ef626f7411e29de';'build-input.json'='5ee6803f958a960c0ee11b423e63b81d6bcfb1f5301afe99f8fa86531eaeff48';'build.jsonl'='9ecb1ceb867d28184bd21187901c909e9901a71b7cf86f2c3cadcf332bf1bed8';'stderr.log'='9f1400fc2b3dcf6a9454551e827bfcc58883e730772771583f2f466c92babc4e';'stdout.log'='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
  $expectedArtifactLabels=[ordered]@{'farmrx.synthetic-bootstrap'=$replacementArtifactToken;'farmrx.synthetic-owner'='maple-faketime-bootstrap';'farmrx.synthetic-role'='faketime-artifacts';'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev'}
  if ($artifactEvidenceManifest.schema -cne 'farmrx.faketime-artifact-replacement.v1' -or $artifactEvidenceManifest.artifact.ref -cne $replacementArtifactRef -or $artifactEvidenceManifest.artifact.id -cne $replacementArtifactId -or $artifactEvidenceManifest.artifact.tag -cne $replacementArtifactTag -or $artifactEvidenceManifest.artifact.bootstrap_token -cne $replacementArtifactToken -or $artifactEvidenceManifest.evidence.combined_sha256 -cne 'aed05d2f6937223d8bbd53ea79a3043ce79a4436ce7e29d7569c04c66d77dbf2' -or $artifactEvidenceManifest.combined_source_artifact_identity_recipe -notmatch 'canonical NUL-delimited dirty tracked, staged, and untracked existing source path\|sha256' -or $artifactEvidenceManifest.combined_source_artifact_identity_recipe -notmatch 'refusing missing/deleted paths' -or $artifactEvidenceManifest.combined_source_artifact_identity_recipe -notmatch 'previous-commit HEAD\^\.\.HEAD') { throw 'CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_EVIDENCE_MANIFEST_DRIFT' }
  foreach($key in $expectedArtifactLabels.Keys){if($artifactEvidenceManifest.artifact.labels.PSObject.Properties[$key].Value-cne$expectedArtifactLabels[$key]){throw "CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_EVIDENCE_MANIFEST_LABEL_DRIFT:$key"}}
  foreach($key in $expectedArtifactEvidenceFiles.Keys){if($artifactEvidenceManifest.evidence.files.PSObject.Properties[$key].Value-cne$expectedArtifactEvidenceFiles[$key]){throw "CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_EVIDENCE_MANIFEST_FILE_DRIFT:$key"}}
  if(@($artifactEvidenceManifest.evidence.files.PSObject.Properties).Count-ne$expectedArtifactEvidenceFiles.Count-or$artifactEvidenceManifest.evidence.files.'build-input-completeness.json'-cne'97cbbca788a38b14b11e7780fdeb00b6852a224bf39076174ef626f7411e29de'){throw 'CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_EVIDENCE_MANIFEST_FILESET_DRIFT'}
  $artifactEvidenceRoot = Join-Path $root $artifactEvidenceManifest.evidence.relative_directory
  $buildInputCompletenessPath=Join-Path $artifactEvidenceRoot 'build-input-completeness.json';try{$buildInputCompleteness=Get-Content -Raw -LiteralPath $buildInputCompletenessPath|ConvertFrom-Json}catch{throw 'CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_BUILD_INPUT_COMPLETENESS_MALFORMED'}
  if($buildInputCompleteness.artifact_id-cne$replacementArtifactId-or$buildInputCompleteness.dockerfile.path-cne'tests/season/faketime-artifacts.Dockerfile'-or$buildInputCompleteness.dockerfile.sha256-cne'26eded17061445add0e3c4b43ad0c8dd8552d6745d6d615969372f9dfbc696a3'-or$buildInputCompleteness.copied_local_inputs.'tests/season/clear-ld-preload.c'-cne'b6d9b439ccbfdf88f87b9c2f2d89b560d2370964074759373949c2bbb67cd66e'-or$artifactEvidenceManifest.build_inputs.dockerfile.path-cne$buildInputCompleteness.dockerfile.path-or$artifactEvidenceManifest.build_inputs.dockerfile.sha256-cne$buildInputCompleteness.dockerfile.sha256-or$artifactEvidenceManifest.build_inputs.copied_local_inputs.'tests/season/clear-ld-preload.c'-cne$buildInputCompleteness.copied_local_inputs.'tests/season/clear-ld-preload.c'){throw 'CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_BUILD_INPUT_COMPLETENESS_DRIFT'}
  $dockerfileInputHash = Get-Cw2Sha256 ([IO.File]::ReadAllBytes((Join-Path $root $buildInputCompleteness.dockerfile.path)))
  $preloadInputHash = Get-Cw2Sha256 ([IO.File]::ReadAllBytes((Join-Path $root 'tests/season/clear-ld-preload.c')))
  if ($dockerfileInputHash -cne $buildInputCompleteness.dockerfile.sha256 -or $preloadInputHash -cne $buildInputCompleteness.copied_local_inputs.'tests/season/clear-ld-preload.c') { throw 'CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_BUILD_INPUT_SOURCE_HASH_DRIFT' }
  $evidenceLines=[Collections.Generic.List[string]]::new()
  foreach($key in $expectedArtifactEvidenceFiles.Keys){$path=Join-Path $artifactEvidenceRoot $key;if(-not(Test-Path -LiteralPath $path)){throw "CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_EVIDENCE_FILE_MISSING:$key"};$hash=Get-Cw2Sha256 ([IO.File]::ReadAllBytes($path));if($hash-cne$expectedArtifactEvidenceFiles[$key]){throw "CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_EVIDENCE_FILE_HASH_DRIFT:$key"};[void]$evidenceLines.Add("$key|$hash")}
  $evidenceLines.Sort([StringComparer]::Ordinal);$evidenceBytes=[Text.UTF8Encoding]::new($false).GetBytes(([string]::Join("`n",$evidenceLines)+"`n"));$actualEvidenceCombined=Get-Cw2Sha256 $evidenceBytes
  if($actualEvidenceCombined-cne$artifactEvidenceManifest.evidence.combined_sha256){throw 'CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_EVIDENCE_COMBINED_HASH_DRIFT'}
  $expectedDerivedEvidence=[ordered]@{'build-input.json'='236d7d011d2302a937ff6d7fca2724832c06712c158c41c8a3113e2388a7ed16';'build.jsonl'='8e71f38b8357d0bf7afcda8ec541fac0e49d4dedea764365a18ed45b8c4cf75d';'result.json'='bd373487d083e13562e35d9497529dfe47842e0519ab573d86b6ed82d993e438';'stderr.log'='99c55516d457c8a08362e6018dade4b1bd534661adc509839242b7a743e11820';'stdout.log'='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
  $derivedProof=$artifactEvidenceManifest.derived_image_proof
  if($derivedProof.token-cne'0ba1615005224ec79d44fcdb3998021d'-or$derivedProof.tag-cne'farmrx-cw2-derived-proof-0ba1615005224ec79d44fcdb3998021d:synthetic'-or$derivedProof.image_id-cne'sha256:ac2901f891cd4a96d70cde28c9dd9f1db6ca518f4d9e5db821518ecb518a0f74'-or$derivedProof.combined_sha256-cne'eb43ca8c6035e8125e9ddbd7498f3bea8674a5a34c164c4e7ac4a1d1c9fc06d1'){throw 'CONNECT_WORKFLOWS_CW2_DERIVED_IMAGE_PROOF_MANIFEST_DRIFT'}
  foreach($key in $expectedDerivedEvidence.Keys){if($derivedProof.files.PSObject.Properties[$key].Value-cne$expectedDerivedEvidence[$key]){throw "CONNECT_WORKFLOWS_CW2_DERIVED_IMAGE_PROOF_FILESET_DRIFT:$key"}}
  if(@($derivedProof.files.PSObject.Properties).Count-ne$expectedDerivedEvidence.Count){throw 'CONNECT_WORKFLOWS_CW2_DERIVED_IMAGE_PROOF_FILESET_COUNT_DRIFT'}
  $derivedRoot=Join-Path $root $derivedProof.relative_directory;$derivedLines=[Collections.Generic.List[string]]::new()
  foreach($key in $expectedDerivedEvidence.Keys){$path=Join-Path $derivedRoot $key;if(-not(Test-Path -LiteralPath $path)){throw "CONNECT_WORKFLOWS_CW2_DERIVED_IMAGE_PROOF_FILE_MISSING:$key"};$hash=Get-Cw2Sha256 ([IO.File]::ReadAllBytes($path));if($hash-cne$expectedDerivedEvidence[$key]){throw "CONNECT_WORKFLOWS_CW2_DERIVED_IMAGE_PROOF_FILE_HASH_DRIFT:$key"};[void]$derivedLines.Add("$key|$hash")}
  $derivedLines.Sort([StringComparer]::Ordinal);$derivedCombined=Get-Cw2Sha256 ([Text.UTF8Encoding]::new($false).GetBytes(([string]::Join("`n",$derivedLines)+"`n")))
  if($derivedCombined-cne$derivedProof.combined_sha256){throw 'CONNECT_WORKFLOWS_CW2_DERIVED_IMAGE_PROOF_COMBINED_HASH_DRIFT'}
  $derivedResult=Get-Content -Raw -LiteralPath (Join-Path $derivedRoot 'result.json')|ConvertFrom-Json
  if($derivedResult.exit_code-ne0-or$derivedResult.derived_image_id-cne$derivedProof.image_id-or$derivedResult.zero_container_references-ne$true-or$derivedResult.cleanup-cne'exact owned derived image removed and absence re-attested'-or$derivedResult.ordinary_db_before-cne$derivedResult.ordinary_db_after){throw 'CONNECT_WORKFLOWS_CW2_DERIVED_IMAGE_PROOF_RESULT_DRIFT'}
  $expectedPostcleanupEvidence=[ordered]@{'input.json'='ee9f2040529fcf479502ebc76102f1fb0889306f8435193ddd3130701d4c8b63';'inspection.jsonl'='620864573e9161eb682234a0d0053ef817af7a1c5224fbaf4c35f3c8bf327f26';'result.json'='efd709072eb35f838fcf5b81c22da204baadf3f54e016f5dfa64e4735d073163';'stderr.log'='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';'stdout.log'='c0b4b4fb26c1008595b7023db1f7f864f7f7a15b2bc2e45765aa78488f7bc6b7'}
  $postcleanupProof=$artifactEvidenceManifest.reusable_postcleanup_attestation
  if($postcleanupProof.derived_proof_token-cne$derivedProof.token-or$postcleanupProof.reusable_id-cne$replacementArtifactId-or$postcleanupProof.combined_sha256-cne'5469560cee6b3f5f863ea84aaab8376a38b3a909d2b2145e03671a32e5578eb5'){throw 'CONNECT_WORKFLOWS_CW2_REUSABLE_POSTCLEANUP_MANIFEST_DRIFT'}
  foreach($key in $expectedPostcleanupEvidence.Keys){if($postcleanupProof.files.PSObject.Properties[$key].Value-cne$expectedPostcleanupEvidence[$key]){throw "CONNECT_WORKFLOWS_CW2_REUSABLE_POSTCLEANUP_FILESET_DRIFT:$key"}}
  if(@($postcleanupProof.files.PSObject.Properties).Count-ne$expectedPostcleanupEvidence.Count){throw 'CONNECT_WORKFLOWS_CW2_REUSABLE_POSTCLEANUP_FILESET_COUNT_DRIFT'}
  $postcleanupRoot=Join-Path $root $postcleanupProof.relative_directory;$postcleanupLines=[Collections.Generic.List[string]]::new()
  foreach($key in $expectedPostcleanupEvidence.Keys){$path=Join-Path $postcleanupRoot $key;if(-not(Test-Path -LiteralPath $path)){throw "CONNECT_WORKFLOWS_CW2_REUSABLE_POSTCLEANUP_FILE_MISSING:$key"};$hash=Get-Cw2Sha256 ([IO.File]::ReadAllBytes($path));if($hash-cne$expectedPostcleanupEvidence[$key]){throw "CONNECT_WORKFLOWS_CW2_REUSABLE_POSTCLEANUP_FILE_HASH_DRIFT:$key"};[void]$postcleanupLines.Add("$key|$hash")}
  $postcleanupLines.Sort([StringComparer]::Ordinal);$postcleanupCombined=Get-Cw2Sha256 ([Text.UTF8Encoding]::new($false).GetBytes(([string]::Join("`n",$postcleanupLines)+"`n")))
  if($postcleanupCombined-cne$postcleanupProof.combined_sha256){throw 'CONNECT_WORKFLOWS_CW2_REUSABLE_POSTCLEANUP_COMBINED_HASH_DRIFT'}
  $postcleanupResult=Get-Content -Raw -LiteralPath (Join-Path $postcleanupRoot 'result.json')|ConvertFrom-Json
  if($postcleanupResult.exit_code-ne0-or$postcleanupResult.reusable_ref_id-cne$replacementArtifactId-or$postcleanupResult.reusable_tag_id-cne$replacementArtifactId-or$postcleanupResult.zero_container_references-ne$true-or$postcleanupResult.ordinary_db_ready-ne$true-or$postcleanupResult.ordinary_db_before-cne$postcleanupResult.ordinary_db_after){throw 'CONNECT_WORKFLOWS_CW2_REUSABLE_POSTCLEANUP_RESULT_DRIFT'}
  foreach($key in $expectedArtifactLabels.Keys){if($postcleanupResult.reusable_labels.PSObject.Properties[$key].Value-cne$expectedArtifactLabels[$key]){throw "CONNECT_WORKFLOWS_CW2_REUSABLE_POSTCLEANUP_LABEL_DRIFT:$key"}}
  if ($artifactEvidenceSource -notmatch [regex]::Escape($retiredArtifact) -or $artifactEvidenceSource -notmatch [regex]::Escape($replacementArtifactRef) -or $frozenArtifactEvidenceSource -notmatch [regex]::Escape('Replacement relationship') -or $frozenArtifactEvidenceSource -notmatch [regex]::Escape($replacementArtifactTag)) { throw 'CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_HISTORY_OR_REPLACEMENT_EVIDENCE_MISSING' }
  $artifactRegressionSource = Get-Content -Raw -LiteralPath (Join-Path $root 'src/data/programInventoryCW2.regression.ts')
  if(-not(Test-Cw2ArtifactManifestFocusedMatrix $artifactRegressionSource)){throw 'CONNECT_WORKFLOWS_CW2_ARTIFACT_MANIFEST_FOCUSED_MATRIX_PIN_MISMATCH'}
  Invoke-Cw2ArtifactManifestFocusedMatrixProof $artifactRegressionSource
  foreach ($needle in @('const replacementArtifact = {','const retiredArtifact = {','const completeFaketimeArtifactReplacementContract =','const canonicalManifestDiscoveryContract =','const canonicalManifestDiscoveryMutations = [','canonicalManifestDiscoveryMutations.length === 34','for (const mutation of canonicalManifestDiscoveryMutations)','staged manifest discovery omitted','clean fallback replaced with working diff','forced clean fallback proof omitted','git failure interpolation malformed','forced git failure invocation omitted','forced git failure refusal bypassed','git error scope restore removed','git error capture broadened beyond helper','forced git call dead with synthetic result','forced git synthetic result injected','forced git AST contract bypassed','forced git AST child proof omitted','forced git AST child cleanup weakened','forced git trace observation bypassed','NUL delimiter parsing weakened','dirty path accumulation removed','staged path accumulation removed','untracked path accumulation removed','previous commit path accumulation removed','dirty missing path refusal removed','staged missing path refusal removed','untracked missing path refusal removed','previous commit missing path refusal removed','path dedup comparator weakened','manifest path sort removed','focused child proof omitted','focused child temp location moved into repository','focused child source override removed','focused child file cleanup removed','focused child directory cleanup removed','CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_BEGIN','CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_END','Program Inventory CW2 manifest matrix outer proof passed','const artifactReplacementMutations = [','artifactReplacementMutations.length === 19','for (const mutation of artifactReplacementMutations)','canonical comparator weakened','manifest discovery recipe weakened','derived image proof identity removed','reusable postcleanup attestation removed','reusable artifact ref cleanup added','reusable artifact ID cleanup added','broad image cleanup added','durable artifact evidence manifest removed','copied preload source provenance removed','spike runner reusable inspection invocation removed')) {
    if ($artifactRegressionSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_ARTIFACT_REPLACEMENT_MUTATION_BLOCK_MISSING:$needle" }
  }
  $artifactManifestRegressionSource=Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/faketime-artifact-replacement-manifest.regression.ps1')
  $artifactDirtyDiscovery=$artifactManifestRegressionSource.IndexOf("Invoke-Cw2ArtifactGitPathList @('diff','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_DIRTY_DIFF_GIT_FAILED'")
  $artifactUntrackedDiscovery=$artifactManifestRegressionSource.IndexOf("Invoke-Cw2ArtifactGitPathList @('ls-files','--others','--exclude-standard','-z') 'FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_GIT_FAILED'")
  $artifactPreviousCommitFallback=$artifactManifestRegressionSource.IndexOf("Invoke-Cw2ArtifactGitPathList @('diff-tree','--no-commit-id','--name-only','-r','-z','HEAD^','HEAD') 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_GIT_FAILED'")
  $artifactFallbackEmptyRefusal=$artifactManifestRegressionSource.IndexOf("if(`$paths.Count-eq0){throw 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY'}")
  $artifactForcedCleanFallback=$artifactManifestRegressionSource.IndexOf('$cleanFallback=Get-Cw2ArtifactCanonicalManifest -ForceCleanFallback')
  $artifactForcedCleanRefusal=$artifactManifestRegressionSource.IndexOf('FAKETIME_ARTIFACT_MANIFEST_CLEAN_FALLBACK_PROOF_FAILED')
  $artifactForcedGitInvocation=$artifactManifestRegressionSource.IndexOf("try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',`$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}")
  $artifactForcedGitRefusal=$artifactManifestRegressionSource.IndexOf('FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_CAPTURE_PROOF_FAILED')
  $artifactForcedGitEapRefusal=$artifactManifestRegressionSource.IndexOf('FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_EAP_RESTORE_FAILED')
  $artifactForcedGitTracePass=$artifactManifestRegressionSource.IndexOf("Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_TRACE_OBSERVATION_PASS'")
  $artifactForcedGitEapPass=$artifactManifestRegressionSource.IndexOf("Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_EAP_RESTORE_PASS'")
  $artifactForcedGitPass=$artifactManifestRegressionSource.IndexOf("Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_FAILURE_CAPTURE_PASS'")
  $artifactStagedDiscovery=$artifactManifestRegressionSource.IndexOf("Invoke-Cw2ArtifactGitPathList @('diff','--cached','--name-only','-z')")
  if($artifactManifestRegressionSource-notmatch[regex]::Escape('function Invoke-Cw2ArtifactGitPathList([string[]]$Arguments,[string]$FailureMarker)')-or$artifactManifestRegressionSource-notmatch[regex]::Escape('$previousErrorActionPreference=$ErrorActionPreference')-or$artifactManifestRegressionSource-notmatch[regex]::Escape("try{`$ErrorActionPreference='Continue';`$output=@(& `$gitExe -C `$root @Arguments 2>&1);`$exitCode=`$LASTEXITCODE}finally{`$ErrorActionPreference=`$previousErrorActionPreference}")-or$artifactManifestRegressionSource-notmatch[regex]::Escape('throw "${FailureMarker}:exit=${exitCode}:detail=${detail}"')-or$artifactManifestRegressionSource-notmatch[regex]::Escape('$gitExe=[IO.Path]::GetFullPath($gitCommands[0].Source)')-or$artifactManifestRegressionSource-notmatch[regex]::Escape("@('rev-parse','--verify',`$forcedGitMissingRef)")-or$artifactManifestRegressionSource-notmatch[regex]::Escape('$matchingStarts.Count-ne1-or$matchingExits.Count-ne1')-or$artifactManifestRegressionSource-notmatch[regex]::Escape('farmrx-cw2-artifact-git-ast-')-or$artifactManifestRegressionSource-notmatch[regex]::Escape('-RepositoryRoot $root -InitialErrorActionPreference $case.Preference')-or$artifactManifestRegressionSource-notmatch[regex]::Escape('if($exitCode-ne0){$detail=')-or$artifactManifestRegressionSource-notmatch[regex]::Escape('FAKETIME_ARTIFACT_MANIFEST_GIT_SUCCESS_EAP_RESTORE_FAILED')-or$artifactManifestRegressionSource-notmatch[regex]::Escape('if(-not$ForceCleanFallback){')-or$artifactDirtyDiscovery-lt0-or$artifactStagedDiscovery-le$artifactDirtyDiscovery-or$artifactUntrackedDiscovery-le$artifactStagedDiscovery-or$artifactPreviousCommitFallback-le$artifactUntrackedDiscovery-or$artifactFallbackEmptyRefusal-le$artifactPreviousCommitFallback-or$artifactForcedCleanFallback-le$artifactFallbackEmptyRefusal-or$artifactForcedCleanRefusal-le$artifactForcedCleanFallback-or$artifactForcedGitInvocation-le$artifactForcedCleanRefusal-or$artifactForcedGitRefusal-le$artifactForcedGitInvocation-or$artifactForcedGitEapRefusal-le$artifactForcedGitRefusal-or$artifactForcedGitTracePass-le$artifactForcedGitEapRefusal-or$artifactForcedGitEapPass-le$artifactForcedGitTracePass-or$artifactForcedGitPass-le$artifactForcedGitEapPass){throw 'CONNECT_WORKFLOWS_CW2_ARTIFACT_MANIFEST_CLEAN_FALLBACK_STATIC_DRIFT'}
  $artifactPathCustodyNeedles=@(
    '@($joined.Split([char[]]@([char]0),[StringSplitOptions]::RemoveEmptyEntries))',
    '$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal);$paths=[Collections.Generic.List[string]]::new()',
    'if(-not(Test-Path -LiteralPath (Join-Path $root $dirtyPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_DIRTY_PATH_MISSING:$dirtyPath"}',
    'if($seen.Add($dirtyNormalized)){[void]$paths.Add($dirtyNormalized)}',
    'if(-not(Test-Path -LiteralPath (Join-Path $root $stagedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_STAGED_PATH_MISSING:$stagedPath"}',
    'if($seen.Add($stagedNormalized)){[void]$paths.Add($stagedNormalized)}',
    'if(-not(Test-Path -LiteralPath (Join-Path $root $untrackedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_PATH_MISSING:$untrackedPath"}',
    'if($seen.Add($untrackedNormalized)){[void]$paths.Add($untrackedNormalized)}',
    'if(-not(Test-Path -LiteralPath (Join-Path $root $previousPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_PATH_MISSING:$previousPath"}',
    'if($seen.Add($previousNormalized)){[void]$paths.Add($previousNormalized)}',
    '$paths.Sort([StringComparer]::Ordinal)'
  )
  foreach($needle in $artifactPathCustodyNeedles){if([regex]::Matches($artifactManifestRegressionSource,[regex]::Escape($needle)).Count-ne1){throw "CONNECT_WORKFLOWS_CW2_ARTIFACT_MANIFEST_PATH_CUSTODY_STATIC_DRIFT:$needle"}}
  $spec = Get-Content -Raw -LiteralPath $specPath
  foreach ($needle in @(
    "test('@connect-workflows-cw2 exact Program match changes Inventory only after explicit no-record confirmation'",
    "await recordChoice.selectOption('none')",
    'Confirm exact Inventory product: Synthetic Cedar Herbicide 41',
    "fill('0.001')",
    "toEqual(['mark_program_pass_applied'])",
    "toHaveText('19.999 gal')",
    'Free-typed Cedar product',
    "await recordChoice.selectOption('create')",
    "const productName = form.getByLabel('Product', { exact: true })",
    "['4186','4187','55321'].includes(url.port)"
  )) { if ($spec -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_BROWSER_CONTRACT_MISSING:$needle" } }
  if ([regex]::Matches($spec,[regex]::Escape("const network = await fence(page, ['mark_program_pass_applied'])")).Count -ne 1 -or
      $spec -notmatch [regex]::Escape('createSeasonRequestClassifier({ targetMutationRpcs, blockUnexpectedNonReadRequests: true })') -or
      $spec -match 'generate_due_program_items_v2') { throw 'CONNECT_WORKFLOWS_CW2_STRICT_STARTUP_WRITE_FENCE_CHANGED' }
  $config = Get-Content -Raw -LiteralPath $configPath
  foreach ($needle in @('grep: /@connect-workflows-cw2/','workers: 1',"serviceWorkers: 'block'",'127.0.0.1:4187','FARMRX_CW2_VIEWPORT','width: 390, height: 844','width: 1440, height: 900')) {
    if ($config -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_CONFIG_CONTRACT_MISSING:$needle" }
  }
  $sql = Get-Content -Raw -LiteralPath $verify
  foreach ($needle in @(
    'CONNECT_WORKFLOWS_CW2_BASE_SQL_PASS','CW2 browser positive wrote application records or products',
    'CW2 browser changed a public table outside the exact four-table whitelist',
    'CW2 stored fingerprint does not match the independent complete request oracle',
    'CW2 exact or conflicting replay changed public state','CW2 accepted-bound isolation rollback',
    'CW2 legacy fingerprint-less receipt confirmed a match or wrote state','CW2 legacy create/link behavior changed Inventory',
    'CW2 late failure did not roll back the atomic transaction','CW2 API role directly wrote the match ledger',
    'CW2 denied actor read match history',
    '0.00000001::numeric','0.001::numeric','9999999.99999999::numeric','10000000::numeric',
    '-- CW2 stale-unit database denial with exact zero-public-state proof.',
    'CW2 stale Inventory unit did not fail with exact zero public state change',
    "'c2200000-0000-4000-8000-000000000072','Synthetic Cedar Herbicide 41','27040000-0000-4000-8000-000000000005',0.001,'qt'",
    'v_before_public from cw2_proof.public_snapshot()','from cw2_proof.public_snapshot()) <> v_before_public'
  )) { if ($sql -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_SQL_CONTRACT_MISSING:$needle" } }
  if([regex]::Matches($sql,[regex]::Escape('\echo CONNECT_WORKFLOWS_CW2_BASE_SQL_PASS')).Count -ne 1 -or
     $sql -match 'CW2-CREDENTIAL-HANDOFF'){throw 'CONNECT_WORKFLOWS_CW2_BASE_SQL_PRIVILEGE_BOUNDARY_CHANGED'}
  $concurrencySql=Get-Content -Raw -LiteralPath $concurrencyVerify
  $concurrencyFixtureSql=Get-Content -Raw -LiteralPath $concurrencyFixtureVerify
  if((Get-Cw2Sha256 ([IO.File]::ReadAllBytes($concurrencyFixtureVerify))) -cne $concurrencyFixtureVerifySha256){throw 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_SQL_BYTES_CHANGED'}
  if((Get-Cw2Sha256 ([IO.File]::ReadAllBytes($concurrencyVerify))) -cne $concurrencyVerifySha256){throw 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_SQL_BYTES_CHANGED'}
  foreach($needle in @('cw2_catalog_writer','set local lock_timeout=''500ms''','current_setting(''lock_timeout'',true) <> ''500ms''','canceling statement due to lock timeout','UPDATE 1','CONNECT_WORKFLOWS_CW2_SQL_PASS')){
    if($concurrencySql -notmatch [regex]::Escape($needle)){throw "CONNECT_WORKFLOWS_CW2_CONCURRENCY_SQL_CONTRACT_MISSING:$needle"}
  }
  $runnerSource = Get-Content -Raw -LiteralPath $runnerPath
  $matrixStart = '# CW2_PROOF_005_' + 'EXECUTABLE_MATRIX_BEGIN'; $matrixEnd = '# CW2_PROOF_005_' + 'EXECUTABLE_MATRIX_END'
  $matrixSpan = Get-Cw2UniqueSourceSpan $runnerSource $matrixStart $matrixEnd
  if ((Get-Cw2Proof005TextSha256 $matrixSpan) -cne 'ab394c801381a1d0fe4241dff7d47650a5b6b5e3589066aeebd622c86d1321e3') { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_MATRIX_BYTES_CHANGED' }
  Assert-Cw2Proof006LexerSelfTest
  if (-not (Test-Cw2CredentialHandoffStaticContract $runnerSource $concurrencyFixtureSql $concurrencySql)) { throw 'CONNECT_WORKFLOWS_CW2_CREDENTIAL_HANDOFF_STATIC_CONTRACT_MISSING' }
  if (-not (Test-Cw2Proof005StaticContract $sql)) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_STATIC_CONTRACT_MISSING' }
  # CW2_PROOF_005_EXECUTABLE_MATRIX_BEGIN
  $cw2Proof005Predicate = "or exists(select 1 from public.application_products where application_id='c2200000-0000-4000-8000-000000000073')"
  $cw2Proof005BaseBlock = Get-Cw2Proof005SqlBlock $sql
  if ([regex]::Matches($cw2Proof005BaseBlock,[regex]::Escape($cw2Proof005Predicate)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_RAW_PREDICATE_NOT_UNIQUE' }
  if ([regex]::Matches($sql,[regex]::Escape($cw2Proof005BaseBlock)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_006_BOUNDED_BLOCK_NOT_UNIQUE' }
  $cw2Proof006SingleQuoted = $cw2Proof005Predicate.Replace("'","''")
  $cw2Proof005Mutations = @(
    [pscustomobject]@{Name='remove exists';Replacement='or false'},
    [pscustomobject]@{Name='invert exists';Replacement=$cw2Proof005Predicate.Replace('or exists(','or not exists(')},
    [pscustomobject]@{Name='single-quoted hide';Replacement="or false; perform '$cw2Proof006SingleQuoted'"},
    [pscustomobject]@{Name='tagged dollar-quoted hide';Replacement=('or false; perform $cw2${0}$cw2$' -f $cw2Proof005Predicate)},
    [pscustomobject]@{Name='untagged dollar-quoted hide';Replacement=('or false; perform $${0}$$' -f $cw2Proof005Predicate)},
    [pscustomobject]@{Name='double-quoted identifier hide';Replacement=('or false or "{0}" is null' -f $cw2Proof005Predicate)},
    [pscustomobject]@{Name='line-comment hide';Replacement="or false -- $cw2Proof005Predicate`n"},
    [pscustomobject]@{Name='block-comment hide';Replacement="or false /* $cw2Proof005Predicate */"},
    [pscustomobject]@{Name='remove public qualification';Replacement=$cw2Proof005Predicate.Replace('public.application_products','application_products')},
    [pscustomobject]@{Name='alter relation';Replacement=$cw2Proof005Predicate.Replace('public.application_products','public.application_records')},
    [pscustomobject]@{Name='alter column';Replacement=$cw2Proof005Predicate.Replace('application_id=','application_record_id=')},
    [pscustomobject]@{Name='alter sentinel';Replacement=$cw2Proof005Predicate.Replace('000000000073','000000000074')},
    [pscustomobject]@{Name='duplicate predicate';Replacement="$cw2Proof005Predicate $cw2Proof005Predicate"}
  )
  $cw2Proof005ExpectedNames = @('remove exists','invert exists','single-quoted hide','tagged dollar-quoted hide','untagged dollar-quoted hide','double-quoted identifier hide','line-comment hide','block-comment hide','remove public qualification','alter relation','alter column','alter sentinel','duplicate predicate')
  if ($cw2Proof005Mutations.Count -ne 13 -or [string]::Join('|',[string[]]$cw2Proof005Mutations.Name) -cne [string]::Join('|',[string[]]$cw2Proof005ExpectedNames)) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_MUTATION_MATRIX_INVALID' }
  $cw2Proof006TargetIndex = $cw2Proof005BaseBlock.IndexOf($cw2Proof005Predicate,[StringComparison]::Ordinal)
  if ($cw2Proof006TargetIndex -lt 0) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_006_TARGET_INDEX_MISSING' }
  $executedCw2Proof005Mutations = 0
  foreach ($mutation in $cw2Proof005Mutations) {
    $replacement = [string]$mutation.Replacement
    $mutatedBlock = $cw2Proof005BaseBlock.Substring(0,$cw2Proof006TargetIndex) + $replacement + $cw2Proof005BaseBlock.Substring($cw2Proof006TargetIndex + $cw2Proof005Predicate.Length)
    $restoredBlock = $mutatedBlock.Substring(0,$cw2Proof006TargetIndex) + $cw2Proof005Predicate + $mutatedBlock.Substring($cw2Proof006TargetIndex + $replacement.Length)
    if ($mutatedBlock -ceq $cw2Proof005BaseBlock -or $restoredBlock -cne $cw2Proof005BaseBlock) { throw "CONNECT_WORKFLOWS_CW2_PROOF_005_MUTATION_NOT_EXACT:$($mutation.Name)" }
    $mutatedSql = $sql.Substring(0,$sql.IndexOf($cw2Proof005BaseBlock,[StringComparison]::Ordinal)) + $mutatedBlock + $sql.Substring($sql.IndexOf($cw2Proof005BaseBlock,[StringComparison]::Ordinal) + $cw2Proof005BaseBlock.Length)
    if ((Get-Cw2Proof005SqlBlock $mutatedSql) -cne $mutatedBlock) { throw "CONNECT_WORKFLOWS_CW2_PROOF_006_MUTATION_ESCAPED_BLOCK:$($mutation.Name)" }
    if (Test-Cw2Proof005StaticContract $mutatedSql) { throw "CONNECT_WORKFLOWS_CW2_PROOF_005_MUTATION_SURVIVED:$($mutation.Name)" }
    $executedCw2Proof005Mutations += 1
  }
  if ($executedCw2Proof005Mutations -ne $cw2Proof005Mutations.Count) { throw 'CONNECT_WORKFLOWS_CW2_PROOF_005_MUTATION_EXECUTION_INCOMPLETE' }
  Write-Output 'CONNECT_WORKFLOWS_CW2_PROOF_006_MATRIX_PASS count=13'

  if (-not (Test-Cw2Fixture002StaticContract $sql)) { throw 'CONNECT_WORKFLOWS_CW2_FIXTURE_002_STATIC_CONTRACT_MISSING' }
  $cw2Fixture002Block = Get-Cw2Fixture002SqlBlock $sql
  $foreignContextStart = $cw2Fixture002Block.IndexOf('  perform set_config(',[StringComparison]::Ordinal)
  $foreignFarmInsertStart = $cw2Fixture002Block.IndexOf('  insert into public.farms (id,name,share_with_rep,created_by,time_zone)',[StringComparison]::Ordinal)
  $foreignVerificationStart = $cw2Fixture002Block.IndexOf('  if auth.uid() <> ',[StringComparison]::Ordinal)
  $foreignProductInsertStart = $cw2Fixture002Block.IndexOf('  insert into public.inventory_products (id,farm_id,product_kind,name,inventory_unit,is_active)',[StringComparison]::Ordinal)
  $cedarContextStart = $cw2Fixture002Block.IndexOf('  perform set_config(',$foreignProductInsertStart,[StringComparison]::Ordinal)
  $cedarVerificationStart = $cw2Fixture002Block.IndexOf('  if auth.uid() <> ',$foreignVerificationStart + 1,[StringComparison]::Ordinal)
  $cloneStart = $cw2Fixture002Block.IndexOf("  perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000041'",[StringComparison]::Ordinal)
  $snapshotStart = $cw2Fixture002Block.IndexOf('  select jsonb_object_agg(table_name,',$cloneStart,[StringComparison]::Ordinal)
  $attemptStart = $cw2Fixture002Block.IndexOf('  v_rejected := false; v_error := null;',$snapshotStart,[StringComparison]::Ordinal)
  if (@($foreignContextStart,$foreignFarmInsertStart,$foreignVerificationStart,$foreignProductInsertStart,$cedarContextStart,$cedarVerificationStart,$cloneStart,$snapshotStart,$attemptStart | Where-Object { $_ -lt 0 }).Count) { throw 'CONNECT_WORKFLOWS_CW2_FIXTURE_002_MUTATION_BOUNDARY_MISSING' }
  $foreignContext = $cw2Fixture002Block.Substring($foreignContextStart,$foreignFarmInsertStart-$foreignContextStart)
  $foreignFarmInsert = $cw2Fixture002Block.Substring($foreignFarmInsertStart,$foreignVerificationStart-$foreignFarmInsertStart)
  $foreignVerification = $cw2Fixture002Block.Substring($foreignVerificationStart,$foreignProductInsertStart-$foreignVerificationStart)
  $cedarContext = $cw2Fixture002Block.Substring($cedarContextStart,$cedarVerificationStart-$cedarContextStart)
  $cedarVerification = $cw2Fixture002Block.Substring($cedarVerificationStart,$cloneStart-$cedarVerificationStart)
  $cloneSpan = $cw2Fixture002Block.Substring($cloneStart,$snapshotStart-$cloneStart)
  $snapshotSpan = $cw2Fixture002Block.Substring($snapshotStart,$attemptStart-$snapshotStart)
  $rpcDenialCondition = "v_error <> 'confirmed inventory product is inactive, foreign, stale, or not the exact name match'"
  $wholePublicEquality = "or (select jsonb_object_agg(table_name,jsonb_build_object('count',row_count,'hash',row_hash,'rows',rows) order by table_name) from cw2_proof.public_snapshot()) <> v_before_public"
  function New-Cw2Fixture002HiddenReplacement([string]$Target,[string]$Mode,[bool]$Condition) {
    $oneLine = (($Target -replace '\r?\n',' ') -replace '\s+',' ').Trim()
    $single = $Target.Replace("'","''"); $escape=$Target.Replace('\','\\').Replace("'","\'"); $quoted = $Target.Replace('"','""')
    if ($Condition) {
      switch ($Mode) {
        'line-comment' { return "false -- $oneLine`n" }
        'nested-block-comment' { return "false /* outer /* $Target */ inner */" }
        'single-string' { return "false or '$single' is null" }
        'tagged-dollar-string' { return 'false or $cw2_fixture$' + $Target + '$cw2_fixture$ is null' }
        'untagged-dollar-string' { return 'false or $$' + $Target + '$$ is null' }
        'quoted-identifier' { return 'false or "' + $quoted + '" is null' }
        'escape-string' { return "false or E'$escape' is null" }
        'unicode-string' { return "false or U&'$single' is null" }
        'national-string' { return "false or N'$single' is null" }
        'bit-string' { return "false or B'0101' is null or '$single' is null" }
        'hex-string' { return "false or X'DEAD' is null or '$single' is null" }
      }
    } else {
      switch ($Mode) {
        'line-comment' { return "  -- $oneLine`n" }
        'nested-block-comment' { return "  /* outer /* $Target */ inner */`n" }
        'single-string' { return "  perform '$single';`n" }
        'tagged-dollar-string' { return '  perform $cw2_fixture$' + $Target + '$cw2_fixture$;' + "`n" }
        'untagged-dollar-string' { return '  perform $$' + $Target + '$$;' + "`n" }
        'quoted-identifier' { return '  perform "' + $quoted + '";' + "`n" }
        'escape-string' { return "  perform E'$escape';`n" }
        'unicode-string' { return "  perform U&'$single';`n" }
        'national-string' { return "  perform N'$single';`n" }
        'bit-string' { return "  perform B'0101'; perform '$single';`n" }
        'hex-string' { return "  perform X'DEAD'; perform '$single';`n" }
      }
    }
    throw "CONNECT_WORKFLOWS_CW2_FIXTURE_003_UNKNOWN_HIDE_MODE:$Mode"
  }
  $fixture002Mutations = @(
    [pscustomobject]@{Name='remove foreign context';Old=$foreignContext;New=''},
    [pscustomobject]@{Name='change foreign epoch';Old="jsonb_build_object('c2290000-0000-4000-8000-000000000001',1)::text";New="jsonb_build_object('c2290000-0000-4000-8000-000000000001',2)::text"},
    [pscustomobject]@{Name='reorder foreign context after farm insert';Old=($foreignContext+$foreignFarmInsert);New=($foreignFarmInsert+$foreignContext)},
    [pscustomobject]@{Name='remove foreign boundary verification';Old=$foreignVerification;New=''},
    [pscustomobject]@{Name='remove Cedar restore';Old=$cedarContext;New=''},
    [pscustomobject]@{Name='change Cedar epoch';Old="jsonb_build_object('27010000-0000-4000-8000-000000000005',1)::text";New="jsonb_build_object('27010000-0000-4000-8000-000000000005',2)::text"},
    [pscustomobject]@{Name='reorder Cedar restore after clone';Old=($cedarContext+$cedarVerification+$cloneSpan);New=($cedarVerification+$cloneSpan+$cedarContext)},
    [pscustomobject]@{Name='remove Cedar boundary verification';Old=$cedarVerification;New=''},
    [pscustomobject]@{Name='remove pre-denial public snapshot';Old=$snapshotSpan;New="  v_before_public := null;`n"},
    [pscustomobject]@{Name='weaken exact RPC denial';Old=$rpcDenialCondition;New='v_error is null'},
    [pscustomobject]@{Name='remove foreign row nonwrite';Old="or (select to_jsonb(product) from public.inventory_products product where product.id='c2290000-0000-4000-8000-000000000002') <> v_foreign_product_before";New='or false'},
    [pscustomobject]@{Name='remove all-public nonwrite';Old=$wholePublicEquality;New='or false'},
    [pscustomobject]@{Name='inject service role weakening';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  set local role service_role;"},
    [pscustomobject]@{Name='inject trigger bypass';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  set local session_replication_role='replica';"},
    [pscustomobject]@{Name='foreign context line-comment hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'line-comment' $false)},
    [pscustomobject]@{Name='foreign context nested-block-comment hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'nested-block-comment' $false)},
    [pscustomobject]@{Name='foreign context single-string hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'single-string' $false)},
    [pscustomobject]@{Name='foreign context tagged-dollar-string hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'tagged-dollar-string' $false)},
    [pscustomobject]@{Name='foreign context untagged-dollar-string hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'untagged-dollar-string' $false)},
    [pscustomobject]@{Name='foreign context quoted-identifier hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'quoted-identifier' $false)},
    [pscustomobject]@{Name='Cedar restore line-comment hide';Old=$cedarContext;New=(New-Cw2Fixture002HiddenReplacement $cedarContext 'line-comment' $false)},
    [pscustomobject]@{Name='Cedar restore nested-block-comment hide';Old=$cedarContext;New=(New-Cw2Fixture002HiddenReplacement $cedarContext 'nested-block-comment' $false)},
    [pscustomobject]@{Name='Cedar restore single-string hide';Old=$cedarContext;New=(New-Cw2Fixture002HiddenReplacement $cedarContext 'single-string' $false)},
    [pscustomobject]@{Name='Cedar restore tagged-dollar-string hide';Old=$cedarContext;New=(New-Cw2Fixture002HiddenReplacement $cedarContext 'tagged-dollar-string' $false)},
    [pscustomobject]@{Name='Cedar restore untagged-dollar-string hide';Old=$cedarContext;New=(New-Cw2Fixture002HiddenReplacement $cedarContext 'untagged-dollar-string' $false)},
    [pscustomobject]@{Name='Cedar restore quoted-identifier hide';Old=$cedarContext;New=(New-Cw2Fixture002HiddenReplacement $cedarContext 'quoted-identifier' $false)},
    [pscustomobject]@{Name='RPC denial line-comment hide';Old=$rpcDenialCondition;New=(New-Cw2Fixture002HiddenReplacement $rpcDenialCondition 'line-comment' $true)},
    [pscustomobject]@{Name='RPC denial nested-block-comment hide';Old=$rpcDenialCondition;New=(New-Cw2Fixture002HiddenReplacement $rpcDenialCondition 'nested-block-comment' $true)},
    [pscustomobject]@{Name='RPC denial single-string hide';Old=$rpcDenialCondition;New=(New-Cw2Fixture002HiddenReplacement $rpcDenialCondition 'single-string' $true)},
    [pscustomobject]@{Name='RPC denial tagged-dollar-string hide';Old=$rpcDenialCondition;New=(New-Cw2Fixture002HiddenReplacement $rpcDenialCondition 'tagged-dollar-string' $true)},
    [pscustomobject]@{Name='RPC denial untagged-dollar-string hide';Old=$rpcDenialCondition;New=(New-Cw2Fixture002HiddenReplacement $rpcDenialCondition 'untagged-dollar-string' $true)},
    [pscustomobject]@{Name='RPC denial quoted-identifier hide';Old=$rpcDenialCondition;New=(New-Cw2Fixture002HiddenReplacement $rpcDenialCondition 'quoted-identifier' $true)},
    [pscustomobject]@{Name='whole-public equality line-comment hide';Old=$wholePublicEquality;New=(New-Cw2Fixture002HiddenReplacement $wholePublicEquality 'line-comment' $true)},
    [pscustomobject]@{Name='whole-public equality nested-block-comment hide';Old=$wholePublicEquality;New=(New-Cw2Fixture002HiddenReplacement $wholePublicEquality 'nested-block-comment' $true)},
    [pscustomobject]@{Name='whole-public equality single-string hide';Old=$wholePublicEquality;New=(New-Cw2Fixture002HiddenReplacement $wholePublicEquality 'single-string' $true)},
    [pscustomobject]@{Name='whole-public equality tagged-dollar-string hide';Old=$wholePublicEquality;New=(New-Cw2Fixture002HiddenReplacement $wholePublicEquality 'tagged-dollar-string' $true)},
    [pscustomobject]@{Name='whole-public equality untagged-dollar-string hide';Old=$wholePublicEquality;New=(New-Cw2Fixture002HiddenReplacement $wholePublicEquality 'untagged-dollar-string' $true)},
    [pscustomobject]@{Name='whole-public equality quoted-identifier hide';Old=$wholePublicEquality;New=(New-Cw2Fixture002HiddenReplacement $wholePublicEquality 'quoted-identifier' $true)},
    [pscustomobject]@{Name='foreign context escape-string hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'escape-string' $false)},
    [pscustomobject]@{Name='foreign context unicode-string hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'unicode-string' $false)},
    [pscustomobject]@{Name='foreign context national-string hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'national-string' $false)},
    [pscustomobject]@{Name='foreign context bit-string companion hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'bit-string' $false)},
    [pscustomobject]@{Name='foreign context hex-string companion hide';Old=$foreignContext;New=(New-Cw2Fixture002HiddenReplacement $foreignContext 'hex-string' $false)},
    [pscustomobject]@{Name='set role';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  set role service_role;"},
    [pscustomobject]@{Name='set local quoted role mixed case';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  SeT LoCaL RoLe `"service_role`";"},
    [pscustomobject]@{Name='set session role';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  set session role service_role;"},
    [pscustomobject]@{Name='reset role';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  reset role;"},
    [pscustomobject]@{Name='set session authorization';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  set session authorization postgres;"},
    [pscustomobject]@{Name='reset session authorization';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  reset session authorization;"},
    [pscustomobject]@{Name='set replication equals';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  set session_replication_role = replica;"},
    [pscustomobject]@{Name='set local replication to quoted';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  set local session_replication_role to 'replica';"},
    [pscustomobject]@{Name='set session replication mixed case';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  SET SESSION SESSION_REPLICATION_ROLE TO replica;"},
    [pscustomobject]@{Name='set_config role direct';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  perform set_config('role','service_role',true);"},
    [pscustomobject]@{Name='set_config session authorization';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  perform pg_catalog.set_config('session_authorization','postgres',true);"},
    [pscustomobject]@{Name='set_config replication direct';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  perform set_config('session_replication_role','replica',true);"},
    [pscustomobject]@{Name='set_config row security';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  perform set_config('row_security','off',true);"},
    [pscustomobject]@{Name='set_config dynamic role key';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  perform set_config('ro'||'le','service_role',true);"},
    [pscustomobject]@{Name='set_config dynamic replication key';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  perform set_config('session_'||'replication_role','replica',true);"},
    [pscustomobject]@{Name='alter table disable trigger';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  alter table public.inventory_products disable trigger all;"},
    [pscustomobject]@{Name='alter quoted table enable trigger';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  ALTER TABLE public.`"inventory_products`" ENABLE TRIGGER `"fixture_trigger`";"},
    [pscustomobject]@{Name='dynamic execute trigger bypass';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New="-- CW2-FIXTURE-002 foreign authenticated context begin.`n  execute 'alter table public.inventory_products disable trigger all';"},
    [pscustomobject]@{Name='unicode quoted set_config uppercase prefix';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  perform U&`"s\0065t_config`"('role','service_role',true);"},
    [pscustomobject]@{Name='unicode quoted set_config lowercase prefix';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  perform u&`"s\0065t_config`"('role','service_role',true);"},
    [pscustomobject]@{Name='unicode quoted set_config six-digit escape';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  perform U&`"s\+000065t_config`"('role','service_role',true);"},
    [pscustomobject]@{Name='ordinary quoted set_config';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  perform `"set_config`"('role','service_role',true);"},
    [pscustomobject]@{Name='quoted SET identifier';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  perform `"SET`"();"},
    [pscustomobject]@{Name='quoted ALTER identifier';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  perform `"ALTER`"();"},
    [pscustomobject]@{Name='quoted EXECUTE identifier';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  perform `"EXECUTE`"();"},
    [pscustomobject]@{Name='harmless quoted identifier';Old='-- CW2-FIXTURE-002 foreign authenticated context begin.';New='-- CW2-FIXTURE-002 foreign authenticated context begin.'+"`n  perform `"harmless_fixture_identifier`"();"}
  )
  $fixture002ExpectedNames = @(
    'remove foreign context','change foreign epoch','reorder foreign context after farm insert','remove foreign boundary verification',
    'remove Cedar restore','change Cedar epoch','reorder Cedar restore after clone','remove Cedar boundary verification',
    'remove pre-denial public snapshot','weaken exact RPC denial','remove foreign row nonwrite','remove all-public nonwrite',
    'inject service role weakening','inject trigger bypass',
    'foreign context line-comment hide','foreign context nested-block-comment hide','foreign context single-string hide','foreign context tagged-dollar-string hide','foreign context untagged-dollar-string hide','foreign context quoted-identifier hide',
    'Cedar restore line-comment hide','Cedar restore nested-block-comment hide','Cedar restore single-string hide','Cedar restore tagged-dollar-string hide','Cedar restore untagged-dollar-string hide','Cedar restore quoted-identifier hide',
    'RPC denial line-comment hide','RPC denial nested-block-comment hide','RPC denial single-string hide','RPC denial tagged-dollar-string hide','RPC denial untagged-dollar-string hide','RPC denial quoted-identifier hide',
    'whole-public equality line-comment hide','whole-public equality nested-block-comment hide','whole-public equality single-string hide','whole-public equality tagged-dollar-string hide','whole-public equality untagged-dollar-string hide','whole-public equality quoted-identifier hide',
    'foreign context escape-string hide','foreign context unicode-string hide','foreign context national-string hide','foreign context bit-string companion hide','foreign context hex-string companion hide',
    'set role','set local quoted role mixed case','set session role','reset role','set session authorization','reset session authorization',
    'set replication equals','set local replication to quoted','set session replication mixed case',
    'set_config role direct','set_config session authorization','set_config replication direct','set_config row security','set_config dynamic role key','set_config dynamic replication key',
    'alter table disable trigger','alter quoted table enable trigger','dynamic execute trigger bypass',
    'unicode quoted set_config uppercase prefix','unicode quoted set_config lowercase prefix','unicode quoted set_config six-digit escape','ordinary quoted set_config',
    'quoted SET identifier','quoted ALTER identifier','quoted EXECUTE identifier','harmless quoted identifier'
  )
  if ($fixture002Mutations.Count -ne 69 -or [string]::Join('|',[string[]]$fixture002Mutations.Name) -cne [string]::Join('|',[string[]]$fixture002ExpectedNames)) { throw 'CONNECT_WORKFLOWS_CW2_FIXTURE_002_MUTATION_MATRIX_INVALID' }
  $executedFixture002Mutations = 0
  $fixture002BlockIndex = $sql.IndexOf($cw2Fixture002Block,[StringComparison]::Ordinal)
  if ($fixture002BlockIndex -lt 0 -or [regex]::Matches($sql,[regex]::Escape($cw2Fixture002Block)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_FIXTURE_002_BLOCK_NOT_UNIQUE' }
  foreach ($mutation in $fixture002Mutations) {
    $old = [string]$mutation.Old; $new = [string]$mutation.New
    $targetIndex = $cw2Fixture002Block.IndexOf($old,[StringComparison]::Ordinal)
    if ($targetIndex -lt 0 -or [regex]::Matches($cw2Fixture002Block,[regex]::Escape($old)).Count -ne 1) { throw "CONNECT_WORKFLOWS_CW2_FIXTURE_002_MUTATION_TARGET_INVALID:$($mutation.Name)" }
    $mutatedBlock = $cw2Fixture002Block.Substring(0,$targetIndex) + $new + $cw2Fixture002Block.Substring($targetIndex+$old.Length)
    $restoredBlock = $mutatedBlock.Substring(0,$targetIndex) + $old + $mutatedBlock.Substring($targetIndex+$new.Length)
    if ($mutatedBlock -ceq $cw2Fixture002Block -or $restoredBlock -cne $cw2Fixture002Block) { throw "CONNECT_WORKFLOWS_CW2_FIXTURE_002_MUTATION_NOT_EXACT:$($mutation.Name)" }
    $mutatedSql = $sql.Substring(0,$fixture002BlockIndex) + $mutatedBlock + $sql.Substring($fixture002BlockIndex+$cw2Fixture002Block.Length)
    if ((Get-Cw2Fixture002SqlBlock $mutatedSql) -cne $mutatedBlock) { throw "CONNECT_WORKFLOWS_CW2_FIXTURE_002_MUTATION_ESCAPED_BLOCK:$($mutation.Name)" }
    if (Test-Cw2Fixture002StaticContract $mutatedSql) { throw "CONNECT_WORKFLOWS_CW2_FIXTURE_002_MUTATION_SURVIVED:$($mutation.Name)" }
    $executedFixture002Mutations += 1
  }
  if ($executedFixture002Mutations -ne $fixture002Mutations.Count) { throw 'CONNECT_WORKFLOWS_CW2_FIXTURE_002_MUTATION_EXECUTION_INCOMPLETE' }
  Write-Output 'CONNECT_WORKFLOWS_CW2_FIXTURE_005_STATIC_PASS count=69'
  # CW2_CREDENTIAL_HANDOFF_MUTATION_BEGIN
  $credentialRunnerUser='-U supabase_admin -d postgres'
  $credentialApplyConnect="select dblink_connect('cw2_catalog_apply','dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000'' application_name=cw2_catalog_apply');"
  $credentialWriterConnect="select dblink_connect('cw2_catalog_writer','dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000 -clock_timeout=500'' application_name=cw2_catalog_writer');"
  $credentialApplyRole="select dblink_exec('cw2_catalog_apply',`$remote`$`nset role authenticated;"
  $credentialWriterRole="select dblink_exec('cw2_catalog_writer',`$remote`$`nset role authenticated;"
  $credentialWriterTransactionBoundary="select dblink_exec('cw2_catalog_writer','begin');`nselect dblink_exec('cw2_catalog_writer',`$remote`$`nset role authenticated;"
  $credentialReleasedWriterBoundary="select dblink_exec('cw2_catalog_writer','begin');`ncreate temporary table cw2_catalog_writer_released(status text);`ninsert into cw2_catalog_writer_released`nselect dblink_exec('cw2_catalog_writer',`$remote`$`nset role authenticated;"
  $credentialWriterTimeout="set local lock_timeout='500ms';"
  $credentialWriterTimeoutAttestation="or current_setting('lock_timeout',true) <> '500ms'"
  $credentialWriterActionTimeoutAttestation="if current_setting('lock_timeout',true) <> '500ms' then"
  $credentialWriterActionTimeoutFailure="raise exception 'CW2 catalog writer action did not activate the exact transaction-local timeout'"
  $credentialWriterAsyncSend="select dblink_send_query('cw2_catalog_writer',`$remote`$"
  $credentialWriterBusyPoll="select dblink_is_busy('cw2_catalog_writer')=0 into v_done;"
  $credentialWriterCancel="perform dblink_cancel_query('cw2_catalog_writer');"
  $credentialWriterWaitFailure="raise exception 'CW2 catalog writer did not finish inside the exact asynchronous wait bound';"
  $credentialWriterPrimaryResult="dblink_get_result('cw2_catalog_writer',false)"
  $credentialWriterSetupResult="select status from dblink_get_result('cw2_catalog_writer') as setup(status text);"
  $credentialWriterAttestationResult="select status from dblink_get_result('cw2_catalog_writer') as attestation(status text);"
  $credentialWriterResultCountGuard='result_count integer check(result_count=0)'
  $credentialWriterNullSentinelCount="select count(status) from dblink_get_result('cw2_catalog_writer',false)"
  $credentialWriterTerminalDrain="select count(*) from dblink_get_result('cw2_catalog_writer') as terminal(status text);"
  $credentialWriterDrainMarker='\echo CONNECT_WORKFLOWS_CW2_WRITER_ASYNC_RESULT_DRAIN_PASS'
  $credentialApplyProbeMarker='\echo CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS'
  $credentialApplyPidCapture="create temporary table cw2_catalog_apply_backend(pid integer primary key);`ninsert into cw2_catalog_apply_backend`nselect pid from dblink('cw2_catalog_apply','select pg_backend_pid()') as apply_backend(pid integer);"
  $credentialApplyWaitWaitingRelation='from pg_catalog.pg_locks waiting'
  $credentialApplyWaitPidBinding='join cw2_catalog_apply_backend apply_backend on apply_backend.pid=waiting.pid'
  $credentialApplyWaitWaitingLockType="where waiting.locktype='advisory'"
  $credentialApplyWaitWaitingDatabase='and waiting.database=(select oid from pg_catalog.pg_database where datname=current_database())'
  $credentialApplyWaitWaitingObjsubid='and waiting.objsubid=2'
  $credentialApplyWaitWaitingMode="and waiting.mode='ExclusiveLock'"
  $credentialApplyWaitUngranted='and not waiting.granted'
  $credentialApplyWaitHeldRelation='from pg_catalog.pg_locks held'
  $credentialOuterLockType='and held.locktype=waiting.locktype'
  $credentialOuterLockDatabase='and held.database=waiting.database'
  $credentialOuterLockClassid='and held.classid=waiting.classid'
  $credentialOuterLockObjid='and held.objid=waiting.objid'
  $credentialOuterLockObjsubid='and held.objsubid=waiting.objsubid'
  $credentialOuterLockMode='and held.mode=waiting.mode'
  $credentialOuterLockGranted='and held.granted'
  $credentialApplyWaitBound="for i in 1..100 loop`n    select`n      exists("
  $credentialWriterAfterReadiness="\echo CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS`nselect dblink_send_query('cw2_catalog_writer',`$remote`$"
  $credentialApplyCleanupCancel='select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;'
  $credentialAdvisoryLock='select pg_advisory_lock(25000,2);'
  $credentialCleanupUnlock='select pg_advisory_unlock(25000,2) into v_unlocked;'
  $credentialNormalUnlock='select pg_advisory_unlock(25000,2);'
  $credentialApplyCleanupDisconnect="select dblink_disconnect('cw2_catalog_apply') into v_disconnect;"
  $credentialWriterCleanupRollback="select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;"
  $credentialWriterCleanupDisconnect="select dblink_disconnect('cw2_catalog_writer') into v_disconnect;"
  $credentialApplyDispatchBegin='\echo CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_BEGIN'
  $credentialApplyDispatchPass='\echo CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_PASS'
  $credentialApplyReadinessWaitBegin='\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_WAIT_BEGIN'
  $credentialApplyReadinessServerTimeout="set local statement_timeout='10000ms';"
  $credentialApplyReadinessServerBoundBegin='\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_BEGIN'
  $credentialApplyReadinessServerBoundPass='\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_PASS'
  $credentialApplyReadinessTimeoutMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_TIMEOUT_BEGIN';"
  $credentialApplyCancelRequestBeginMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_REQUEST_BEGIN';"
  $credentialApplyCancelRequestPassMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_REQUEST_PASS';"
  $credentialApplyCancelMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_PASS';"
  $credentialApplyUnlockMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_PASS';"
  $credentialApplyBusyPollMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_BUSY_POLL_BEGIN';"
  $credentialApplyBusyPoll="select dblink_is_busy('cw2_catalog_apply') into v_busy;"
  $credentialApplyBusyPollBound="for i in 1..100 loop select dblink_is_busy('cw2_catalog_apply') into v_busy;"
  $credentialApplyBusyPolarity='exit when v_busy=0;'
  $credentialApplyBusyTimeout="if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then"
  $credentialApplyTerminate="select pg_terminate_backend(pid,5000) from cw2_catalog_apply_backend into v_terminated;"
  $credentialTimeoutWriterRollback="select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;"
  $credentialTimeoutWriterDisconnect="select dblink_disconnect('cw2_catalog_writer') into v_disconnect;"
  $credentialApplyBusyTimeoutDisconnectMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_BUSY_TIMEOUT_DISCONNECT_PASS';"
  $credentialApplyBusyClearMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_BUSY_CLEAR_PASS';"
  $credentialApplyDrainBeginMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_RESULT_DRAIN_BEGIN';"
  $credentialApplyDrainAfterBusy="if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then raise exception 'CW2 catalog apply was still busy before result drain'; end if;`n   select count(*) from dblink_get_result('cw2_catalog_apply',false) as cleanup_primary(result jsonb) into v_primary;"
  $credentialApplyDrainPassMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_RESULT_DRAIN_PASS';"
  $credentialApplyDisconnectMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_PASS';"
  $credentialApplyReadinessObservedMarker="raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVED_PASS';"
  $credentialReadinessRecord="insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('readiness-observe',1,clock_timestamp(),current_setting('statement_timeout',true));"
  $credentialClockPhaseGuard='if ($clockResult[-1] -ne $true) { throw '+'"CONNECT_WORKFLOWS_CW2_CLOCK_PHASE_FAILED:$viewport" }'
  $credentialOrdinaryClockStage='Invoke-Cw2CapturedProcess -Stage "${viewport}:ordinary-clock:'+'concurrency"'
  $credentialApplyResultAfterRelease="$credentialNormalUnlock`n\echo CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS`n\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN`ncreate temporary table cw2_catalog_apply_result(result jsonb);`ninsert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);"
  $credentialWriterTimeoutMarker='\echo CONNECT_WORKFLOWS_CW2_WRITER_LOCK_TIMEOUT_PASS'
  $credentialCatalogReleaseMarker='\echo CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS'
  $credentialAsyncCollectionMarker='\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN'
  $credentialApplyTerminalDrain="select count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);"
  $credentialApplyTerminalDrainGuard='terminal_results integer check(terminal_results=0)'
  $credentialApplyTerminalDrainMarker='\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_DRAIN_PASS'
  $credentialWriterMessageCapture="update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');"
  $credentialWriterTerminalBeforeMessageSql=$concurrencySql.Replace($credentialWriterTerminalDrain,'').Replace($credentialWriterMessageCapture,"$credentialWriterTerminalDrain`n$credentialWriterMessageCapture")
  $credentialWriterNullMessageDenial='or (select message from cw2_catalog_writer_result) is null'
  $credentialWriterMessageMovedSql=$concurrencySql.Replace($credentialWriterMessageCapture,'').Replace($credentialWriterNullMessageDenial,"$credentialWriterNullMessageDenial`n$credentialWriterMessageCapture")
  $credentialWriterPrimaryValueCount="select count(status) from dblink_get_result('cw2_catalog_writer',false) as failed_action(status text);"
  $credentialWriterMessageBeforePrimarySql=$concurrencySql.Replace($credentialWriterMessageCapture,'').Replace($credentialWriterPrimaryValueCount,"$credentialWriterMessageCapture`n$credentialWriterPrimaryValueCount")
  $credentialFixtureJwtSub="select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);"
  $credentialFixtureTransactionStart="begin;`nselect set_config('request.jwt.claims','{`"sub`":`"27000000-0000-4000-8000-000000000001`",`"role`":`"authenticated`"}',true);"
  $credentialFixtureHeaders="select set_config('request.headers','{`"x-farm-rx-expected-user-id`":`"27000000-0000-4000-8000-000000000001`",`"x-farm-rx-access-epochs`":`"{\`"27010000-0000-4000-8000-000000000005\`":1}`"}',true);"
  $credentialFixtureBoundary='\echo CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_BOUNDARY_PASS'
  $credentialMutations=@(
    [pscustomobject]@{Name='outer user changed';Target='runner-native';Old=$credentialRunnerUser;New='-U postgres -d postgres'},
    [pscustomobject]@{Name='base verifier elevated';Target='runner-base';Old='-U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off';New='-U supabase_admin -d postgres -v ON_ERROR_STOP=1 -P pager=off'},
    [pscustomobject]@{Name='fixture verifier elevated';Target='runner-fixture';Old='-U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off';New='-U supabase_admin -d postgres -v ON_ERROR_STOP=1 -P pager=off'},
    [pscustomobject]@{Name='fixture assigned pass removed';Target='fixture-sql';Old='insert into public.assigned_program_passes (';New='select true; -- removed fixture pass insert ('},
    [pscustomobject]@{Name='fixture user context removed';Target='fixture-sql';Old=$credentialFixtureJwtSub;New='select true; -- removed fixture user context'},
    [pscustomobject]@{Name='fixture context transaction removed';Target='fixture-sql';Old=$credentialFixtureTransactionStart;New=$credentialFixtureTransactionStart.Replace('begin;', 'select true; -- removed fixture context transaction')},
    [pscustomobject]@{Name='fixture epoch changed';Target='fixture-sql';Old=$credentialFixtureHeaders;New=$credentialFixtureHeaders.Replace(':1}',':2}')},
    [pscustomobject]@{Name='fixture boundary marker removed';Target='fixture-sql';Old=$credentialFixtureBoundary;New='\echo CW2_REMOVED_FIXTURE_BOUNDARY'},
    [pscustomobject]@{Name='fixture boundary moved after insert';Target='fixture-sql';Old="$credentialFixtureBoundary`n`ninsert into public.assigned_program_passes (";New="insert into public.assigned_program_passes (`n$credentialFixtureBoundary"},
    [pscustomobject]@{Name='fixture post-catalog probe key changed';Target='fixture-sql';Old='perform pg_catalog.pg_advisory_xact_lock(25000,2);';New='perform pg_catalog.pg_advisory_xact_lock(25000,3);'},
    [pscustomobject]@{Name='fixture post-catalog trigger target changed';Target='fixture-sql';Old='create trigger cw2_catalog_probe_pause before update on public.assigned_program_pass_products';New='create trigger cw2_catalog_probe_pause before update on public.inventory_products'},
    [pscustomobject]@{Name='post-catalog ordering static guard weakened';Target='runner-post-catalog';Old='-or $cw2AssignedProductUpdateIndex -le $cw2CatalogShareLockIndex';New='-or $false'},
    [pscustomobject]@{Name='password added';Target='sql';Old=$credentialApplyConnect;New=$credentialApplyConnect.Replace(' application_name',' password=secret application_name')},
    [pscustomobject]@{Name='passfile added';Target='sql';Old=$credentialApplyConnect;New=$credentialApplyConnect.Replace(' application_name',' passfile=/tmp/pass application_name')},
    [pscustomobject]@{Name='host added';Target='sql';Old=$credentialApplyConnect;New=$credentialApplyConnect.Replace(' application_name',' host=remote.invalid application_name')},
    [pscustomobject]@{Name='dblink connect u';Target='sql';Old="dblink_connect('cw2_catalog_apply'";New="dblink_connect_u('cw2_catalog_apply'"},
    [pscustomobject]@{Name='service role added';Target='sql';Old=$credentialApplyRole;New=$credentialApplyRole+"`nset role service_role;"},
    [pscustomobject]@{Name='boundary marker removed';Target='sql';Old='\echo CONNECT_WORKFLOWS_CW2_LOCAL_SUPABASE_ADMIN_BOUNDARY_PASS';New='\echo CW2_REMOVED_LOCAL_BOUNDARY'},
    [pscustomobject]@{Name='outer current user weakened';Target='sql';Old="if current_user <> 'supabase_admin'";New='if false'},
    [pscustomobject]@{Name='outer database weakened';Target='sql-outer';Old="or current_database() <> 'postgres'";New='or false'},
    [pscustomobject]@{Name='outer network weakened';Target='sql-outer';Old='or inet_client_addr() is not null';New='or false'},
    [pscustomobject]@{Name='boundary moved after lock';Target='sql';Old="\echo CONNECT_WORKFLOWS_CW2_LOCAL_SUPABASE_ADMIN_BOUNDARY_PASS`n`n$credentialAdvisoryLock";New="$credentialAdvisoryLock`n`n\echo CONNECT_WORKFLOWS_CW2_LOCAL_SUPABASE_ADMIN_BOUNDARY_PASS"},
    [pscustomobject]@{Name='apply authenticated downgrade removed';Target='sql';Old=$credentialApplyRole;New=$credentialApplyRole.Replace("`nset role authenticated;",'')},
    [pscustomobject]@{Name='writer authenticated downgrade removed';Target='sql-writer-auth';Old=$credentialWriterRole;New=$credentialWriterRole.Replace("`nset role authenticated;",'')},
    [pscustomobject]@{Name='apply attestation removed';Target='sql';Old="raise exception 'CW2 catalog apply session did not enter the exact authenticated local boundary'";New="raise exception 'CW2 apply attestation removed'"},
    [pscustomobject]@{Name='writer attestation removed';Target='sql-writer-auth';Old="raise exception 'CW2 catalog writer session did not enter the exact authenticated local boundary'";New="raise exception 'CW2 writer attestation removed'"},
    [pscustomobject]@{Name='writer dedicated transaction boundary removed';Target='sql';Old=$credentialWriterTransactionBoundary;New=$credentialWriterTransactionBoundary.Replace("select dblink_exec('cw2_catalog_writer','begin');`n",'')},
    [pscustomobject]@{Name='writer setup moved before transaction boundary';Target='sql';Old=$credentialWriterTransactionBoundary;New="select dblink_exec('cw2_catalog_writer',`$remote`$`nset role authenticated;`nbegin;"},
    [pscustomobject]@{Name='writer transaction-local timeout removed';Target='sql-writer-auth';Old=$credentialWriterTimeout;New=$credentialWriterTimeout.Replace("set local lock_timeout='500ms';",'select true; -- removed transaction-local timeout')},
    [pscustomobject]@{Name='writer timeout attestation weakened';Target='sql-writer-auth';Old=$credentialWriterTimeoutAttestation;New='or false'},
    [pscustomobject]@{Name='writer action-local timeout removed';Target='sql-writer-timeout';Old=$credentialWriterTimeout;New='select true; -- removed action-local timeout'},
    [pscustomobject]@{Name='writer action-local timeout attestation weakened';Target='sql-writer-timeout';Old=$credentialWriterActionTimeoutAttestation;New='if false then'},
    [pscustomobject]@{Name='writer synchronous action restored';Target='sql-writer-timeout';Old=$credentialWriterAsyncSend;New="select dblink_exec('cw2_catalog_writer',`$remote`$"},
    [pscustomobject]@{Name='writer asynchronous busy poll removed';Target='sql-writer-timeout';Old=$credentialWriterBusyPoll;New='select false into v_done;'},
    [pscustomobject]@{Name='writer asynchronous cancel removed';Target='sql-writer-timeout';Old=$credentialWriterCancel;New='perform false; -- removed writer cancellation'},
    [pscustomobject]@{Name='writer asynchronous bound failure removed';Target='sql-writer-timeout';Old=$credentialWriterWaitFailure;New='perform false; -- removed writer wait failure'},
    [pscustomobject]@{Name='writer primary result error capture weakened';Target='sql-writer-timeout';Old=$credentialWriterPrimaryResult;New="dblink_get_result('cw2_catalog_writer',true)"},
    [pscustomobject]@{Name='writer setup result removed';Target='sql-writer-timeout';Old=$credentialWriterSetupResult;New="select 'SET'; -- removed writer setup result"},
    [pscustomobject]@{Name='writer attestation result removed';Target='sql-writer-timeout';Old=$credentialWriterAttestationResult;New="select 'DO'; -- removed writer attestation result"},
    [pscustomobject]@{Name='writer primary result count guard weakened';Target='sql-writer-timeout';Old=$credentialWriterResultCountGuard;New='result_count integer'},
    [pscustomobject]@{Name='writer primary null sentinel counted as a row';Target='sql-writer-timeout';Old=$credentialWriterNullSentinelCount;New="select count(*) from dblink_get_result('cw2_catalog_writer',false)"},
    [pscustomobject]@{Name='writer terminal result drain removed';Target='sql-writer-timeout';Old=$credentialWriterTerminalDrain;New='select 0; -- removed writer terminal drain'},
    [pscustomobject]@{Name='writer terminal result drain moved before message attestation';Target='sql';Old=$concurrencySql;New=$credentialWriterTerminalBeforeMessageSql},
    [pscustomobject]@{Name='writer asynchronous drain marker removed';Target='sql-writer-timeout';Old=$credentialWriterDrainMarker;New='\echo CW2_REMOVED_WRITER_ASYNC_RESULT_DRAIN'},
    [pscustomobject]@{Name='apply connection statement timeout removed';Target='sql';Old=$credentialApplyConnect;New=$credentialApplyConnect.Replace("options=''-csearch_path= -cstatement_timeout=15000''","options=-csearch_path=")},
    [pscustomobject]@{Name='writer connection bounds removed';Target='sql';Old=$credentialWriterConnect;New=$credentialWriterConnect.Replace("options=''-csearch_path= -cstatement_timeout=15000 -clock_timeout=500''","options=-csearch_path=")},
    [pscustomobject]@{Name='apply backend pid capture removed';Target='sql';Old=$credentialApplyPidCapture;New='select true; -- removed apply backend PID capture'},
    [pscustomobject]@{Name='apply readiness waiting lock relation changed';Target='sql-apply-wait';Old=$credentialApplyWaitWaitingRelation;New='from pg_catalog.pg_locks held'},
    [pscustomobject]@{Name='apply readiness pid binding removed';Target='sql-apply-wait';Old=$credentialApplyWaitPidBinding;New='join cw2_catalog_apply_backend apply_backend on true'},
    [pscustomobject]@{Name='apply readiness waiting lock type changed';Target='sql-apply-wait';Old=$credentialApplyWaitWaitingLockType;New="where waiting.locktype='relation'"},
    [pscustomobject]@{Name='apply readiness waiting database binding removed';Target='sql-apply-wait';Old=$credentialApplyWaitWaitingDatabase;New='and true -- removed waiting database binding'},
    [pscustomobject]@{Name='apply readiness first advisory key changed';Target='sql';Old=$credentialAdvisoryLock;New='select pg_advisory_lock(25001,2);'},
    [pscustomobject]@{Name='apply readiness second advisory key changed';Target='sql';Old=$credentialAdvisoryLock;New='select pg_advisory_lock(25000,3);'},
    [pscustomobject]@{Name='apply readiness waiting advisory key kind changed';Target='sql-apply-wait';Old=$credentialApplyWaitWaitingObjsubid;New='and waiting.objsubid=1'},
    [pscustomobject]@{Name='apply readiness waiting lock mode changed';Target='sql-apply-wait';Old=$credentialApplyWaitWaitingMode;New="and waiting.mode='ShareLock'"},
    [pscustomobject]@{Name='apply readiness waiting polarity inverted';Target='sql-apply-wait';Old=$credentialApplyWaitUngranted;New='and waiting.granted'},
    [pscustomobject]@{Name='apply readiness held lock relation changed';Target='sql-apply-wait';Old=$credentialApplyWaitHeldRelation;New='from pg_catalog.pg_locks waiting'},
    [pscustomobject]@{Name='apply readiness held lock type changed';Target='sql-apply-wait';Old=$credentialOuterLockType;New="and held.locktype='relation'"},
    [pscustomobject]@{Name='apply readiness held database binding removed';Target='sql-apply-wait';Old=$credentialOuterLockDatabase;New='and true -- removed held database binding'},
    [pscustomobject]@{Name='apply readiness held first key correlation removed';Target='sql-apply-wait';Old=$credentialOuterLockClassid;New='and held.classid=0'},
    [pscustomobject]@{Name='apply readiness held second key correlation removed';Target='sql-apply-wait';Old=$credentialOuterLockObjid;New='and held.objid=0'},
    [pscustomobject]@{Name='apply readiness held advisory key kind changed';Target='sql-apply-wait';Old=$credentialOuterLockObjsubid;New='and held.objsubid=1'},
    [pscustomobject]@{Name='apply readiness held lock mode changed';Target='sql-apply-wait';Old=$credentialOuterLockMode;New="and held.mode='ShareLock'"},
    [pscustomobject]@{Name='apply readiness owner polarity inverted';Target='sql-apply-wait';Old=$credentialOuterLockGranted;New='and not held.granted'},
    [pscustomobject]@{Name='apply readiness poll bound weakened';Target='sql-apply-wait';Old=$credentialApplyWaitBound;New="begin`n  for i in 1..1000000 loop`n    select`n      exists("},
    [pscustomobject]@{Name='writer dispatched before apply readiness';Target='sql';Old=$credentialWriterAfterReadiness;New="select dblink_send_query('cw2_catalog_writer','select true');`n$credentialWriterAfterReadiness"},
    [pscustomobject]@{Name='apply readiness cleanup cancellation removed';Target='sql-apply-wait';Old=$credentialApplyCleanupCancel;New='select false into v_cleanup_cancelled; -- removed exact apply cancellation'},
    [pscustomobject]@{Name='apply readiness blocking dblink cancellation restored';Target='sql-apply-wait';Old=$credentialApplyCleanupCancel;New="select dblink_cancel_query('cw2_catalog_apply') into v_cancel;"},
    [pscustomobject]@{Name='apply readiness cancellation pid binding weakened';Target='sql-apply-wait';Old=$credentialApplyCleanupCancel;New='select pg_cancel_backend(pg_backend_pid()) into v_cleanup_cancelled;'},
    [pscustomobject]@{Name='apply readiness cleanup unlock moved after drain';Target='sql-apply-wait';Old=$credentialCleanupUnlock;New="select count(*) from dblink_get_result('cw2_catalog_apply',false) as premature(result jsonb) into v_primary;`n   $credentialCleanupUnlock"},
    [pscustomobject]@{Name='apply readiness cleanup disconnect removed';Target='sql-apply-wait';Old=$credentialApplyCleanupDisconnect;New='select ''ERROR'' into v_cleanup_apply_disconnect; -- removed apply disconnect'},
    [pscustomobject]@{Name='apply readiness cleanup writer rollback removed';Target='sql-apply-wait';Old=$credentialWriterCleanupRollback;New="select 'ERROR' into v_cleanup_writer_rollback; -- removed writer rollback"},
    [pscustomobject]@{Name='apply readiness cleanup writer disconnect removed';Target='sql-apply-wait';Old=$credentialWriterCleanupDisconnect;New="select 'ERROR' into v_cleanup_writer_disconnect; -- removed writer disconnect"},
    [pscustomobject]@{Name='apply result collected before advisory release';Target='sql';Old=$credentialApplyResultAfterRelease;New="create temporary table cw2_catalog_apply_result(result jsonb);`ninsert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);`n$credentialNormalUnlock`n\echo CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS`n\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN"},
    [pscustomobject]@{Name='apply probe marker removed';Target='sql';Old=$credentialApplyProbeMarker;New='\echo CW2_REMOVED_APPLY_PROBE'},
    [pscustomobject]@{Name='writer timeout marker removed';Target='sql';Old=$credentialWriterTimeoutMarker;New='\echo CW2_REMOVED_WRITER_TIMEOUT'},
    [pscustomobject]@{Name='catalog release marker removed';Target='sql';Old=$credentialCatalogReleaseMarker;New='\echo CW2_REMOVED_CATALOG_RELEASE'},
    [pscustomobject]@{Name='async collection marker removed';Target='sql';Old=$credentialAsyncCollectionMarker;New='\echo CW2_REMOVED_ASYNC_COLLECTION'},
    [pscustomobject]@{Name='released writer authenticated downgrade removed';Target='sql-released-auth';Old='set role authenticated;';New='select true; -- removed released writer role;'},
    [pscustomobject]@{Name='released writer attestation removed';Target='sql-released-auth';Old="raise exception 'CW2 catalog writer session did not enter the exact authenticated local boundary'";New="raise exception 'CW2 released writer attestation removed'"},
    [pscustomobject]@{Name='terminal async drain removed';Target='sql';Old=$credentialApplyTerminalDrain;New='select 0; -- removed terminal dblink drain'},
    [pscustomobject]@{Name='terminal async drain moved before primary result';Target='sql';Old="insert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);`ncreate temporary table cw2_catalog_apply_terminal_drain(`n  terminal_results integer check(terminal_results=0)`n);`ninsert into cw2_catalog_apply_terminal_drain`nselect count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);";New="create temporary table cw2_catalog_apply_terminal_drain(`n  terminal_results integer check(terminal_results=0)`n);`ninsert into cw2_catalog_apply_terminal_drain`nselect count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);`n-- moved before primary result`ninsert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);"},
    [pscustomobject]@{Name='terminal async drain nonempty guard weakened';Target='sql';Old=$credentialApplyTerminalDrainGuard;New='terminal_results integer'},
    [pscustomobject]@{Name='terminal async drain marker removed';Target='sql';Old=$credentialApplyTerminalDrainMarker;New='\echo CW2_REMOVED_ASYNC_RESULT_DRAIN'},
    [pscustomobject]@{Name='authenticated role flags weakened';Target='sql-apply';Old="not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated' and not rolsuper and not rolbypassrls)";New='false'},
    [pscustomobject]@{Name='outer public write injected';Target='sql';Old='-- CW2-CREDENTIAL-HANDOFF concurrency boundary begin.';New="-- CW2-CREDENTIAL-HANDOFF concurrency boundary begin.`nupdate public.inventory_products set name=name;"},
    [pscustomobject]@{Name='outer dollar-body public write injected';Target='sql';Old="begin`n  if current_user <> 'supabase_admin'";New="begin`n  update public.inventory_products set name=name;`n  if current_user <> 'supabase_admin'"},
    [pscustomobject]@{Name='worker post-attestation elevation injected';Target='sql-apply';Old="end`n`$cw2_remote_auth`$";New="end`n`$cw2_remote_auth`$;`nset role supabase_admin"},
    [pscustomobject]@{Name='outer dynamic admin write injected';Target='sql-outer';Old="begin`n  if current_user <> 'supabase_admin'";New="begin`n  execute 'update public.inventory_products set name=name';`n  if current_user <> 'supabase_admin'"},
    [pscustomobject]@{Name='outer dynamic format injected';Target='sql-outer';Old="begin`n  if current_user <> 'supabase_admin'";New="begin`n  perform pg_catalog.format('noop');`n  if current_user <> 'supabase_admin'"},
    [pscustomobject]@{Name='outer alternate rpc injected';Target='sql-outer';Old="begin`n  if current_user <> 'supabase_admin'";New="begin`n  perform public.unapproved_rpc();`n  if current_user <> 'supabase_admin'"},
    [pscustomobject]@{Name='worker dynamic role elevation injected';Target='sql-apply';Old="end`n`$cw2_remote_auth`$";New="end`n`$cw2_remote_auth`$;`nselect pg_catalog.set_config('role','supabase_'||'admin',false)"},
    [pscustomobject]@{Name='extra apply rpc injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`nselect public.unapproved_rpc()`n`$remote`$);"},
    [pscustomobject]@{Name='extra writer rpc injected';Target='sql-writer-timeout';Old="  and farm_id='27010000-0000-4000-8000-000000000005'`n`$remote`$);";New="  and farm_id='27010000-0000-4000-8000-000000000005';`nselect public.unapproved_rpc()`n`$remote`$);"},
    [pscustomobject]@{Name='unicode quoted role elevation injected';Target='sql-apply';Old="end`n`$cw2_remote_auth`$";New="end`n`$cw2_remote_auth`$;`nset U&`"ro\006ce`"='supabase_admin'"},
    [pscustomobject]@{Name='unicode quoted set config injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`nselect pg_catalog.U&`"set\005fconfig`"('role','supabase_admin',false)`n`$remote`$);"},
    [pscustomobject]@{Name='ordinary quoted rpc injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`nselect public.`"unapproved_rpc`"()`n`$remote`$);"},
    [pscustomobject]@{Name='single string do body injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ndo 'begin perform public.unapproved_rpc(); end' language plpgsql`n`$remote`$);"},
    [pscustomobject]@{Name='escape string do body injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ndo E'begin perform public.unapproved_rpc(); end' language plpgsql`n`$remote`$);"},
    [pscustomobject]@{Name='language before single do body injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ndo language plpgsql 'begin perform public.unapproved_rpc(); end'`n`$remote`$);"},
    [pscustomobject]@{Name='language before escape do body injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ndo language plpgsql E'begin perform public.unapproved_rpc(); end'`n`$remote`$);"},
    [pscustomobject]@{Name='language before unicode do body injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ndo language plpgsql U&'begin perform public.unapproved_rpc(); end'`n`$remote`$);"},
    [pscustomobject]@{Name='language before national do body injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ndo language plpgsql N'begin perform public.unapproved_rpc(); end'`n`$remote`$);"},
    [pscustomobject]@{Name='outer alter role createdb injected';Target='sql-outer';Old="begin`n  if current_user <> 'supabase_admin'";New="begin`n  alter role authenticated createdb;`n  if current_user <> 'supabase_admin'"},
    [pscustomobject]@{Name='outer grant truncate injected';Target='sql-outer';Old="begin`n  if current_user <> 'supabase_admin'";New="begin`n  grant truncate on public.inventory_products to authenticated;`n  if current_user <> 'supabase_admin'"},
    [pscustomobject]@{Name='worker truncate injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ntruncate table public.inventory_products`n`$remote`$);"},
    [pscustomobject]@{Name='worker create injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ncreate table public.cw2_unapproved(id integer)`n`$remote`$);"},
    [pscustomobject]@{Name='worker drop injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ndrop table public.inventory_products`n`$remote`$);"},
    [pscustomobject]@{Name='worker copy injected';Target='sql-apply-action';Old=")`n`$remote`$);";New=");`ncopy public.inventory_products to stdout`n`$remote`$);"},
    [pscustomobject]@{Name='reset role injected';Target='sql';Old=$credentialApplyRole;New=$credentialApplyRole+"`nreset role;"},
    [pscustomobject]@{Name='row security disabled';Target='sql';Old=$credentialApplyRole;New=$credentialApplyRole+"`nset row_security=off;"},
    [pscustomobject]@{Name='replication role injected';Target='sql';Old=$credentialApplyRole;New=$credentialApplyRole+"`nset session_replication_role=replica;"},
    [pscustomobject]@{Name='trigger bypass injected';Target='sql';Old=$credentialApplyRole;New=$credentialApplyRole+"`nalter table public.inventory_products disable trigger all;"},
    [pscustomobject]@{Name='native exit guard weakened';Target='runner-capture';Old='$Capture.NativeExitCode -ne 0';New='$false'},
    [pscustomobject]@{Name='native marker guard weakened';Target='runner-capture';Old='$Capture.StdoutText -cnotmatch $markerPattern';New='$false'},
    [pscustomobject]@{Name='apply disconnect removed';Target='sql';Old="select dblink_disconnect('cw2_catalog_apply');";New="select true; -- removed apply disconnect"},
    [pscustomobject]@{Name='writer disconnect removed';Target='sql';Old="select dblink_disconnect('cw2_catalog_writer');";New="select true; -- removed writer disconnect"},
    [pscustomobject]@{Name='lock timeout cause weakened';Target='sql';Old="!~ '^ERROR:  canceling statement due to lock timeout'";New='is null'},
    [pscustomobject]@{Name='released writer proof weakened';Target='sql';Old="(select status from cw2_catalog_writer_released) <> 'UPDATE 1'";New='false'},
    [pscustomobject]@{Name='final match write proof weakened';Target='sql';Old="or not exists(select 1 from public.program_inventory_matches where assigned_product_id='c2500000-0000-4000-8000-000000000002' and quantity_in_inventory_unit=0.001)";New='or false'},
    [pscustomobject]@{Name='final application nonwrite weakened';Target='sql';Old="or exists(select 1 from public.application_records where notes like 'Created from Programs pass c2500000%')";New='or false'},
    [pscustomobject]@{Name='apply dispatch begin marker removed';Target='sql';Old=$credentialApplyDispatchBegin;New='\echo CW2_REMOVED_APPLY_DISPATCH_BEGIN'},
    [pscustomobject]@{Name='apply dispatch pass marker removed';Target='sql';Old=$credentialApplyDispatchPass;New='\echo CW2_REMOVED_APPLY_DISPATCH_PASS'},
    [pscustomobject]@{Name='apply readiness wait marker removed';Target='sql';Old=$credentialApplyReadinessWaitBegin;New='\echo CW2_REMOVED_APPLY_READINESS_WAIT_BEGIN'},
    [pscustomobject]@{Name='apply readiness server timeout removed';Target='sql';Old=$credentialApplyReadinessServerTimeout;New='select true; -- removed readiness server timeout'},
    [pscustomobject]@{Name='apply readiness server bound begin marker removed';Target='sql';Old=$credentialApplyReadinessServerBoundBegin;New='\echo CW2_REMOVED_APPLY_READINESS_SERVER_BOUND_BEGIN'},
    [pscustomobject]@{Name='apply readiness server bound pass marker removed';Target='sql-apply-wait';Old=$credentialApplyReadinessServerBoundPass;New='\echo CW2_REMOVED_APPLY_READINESS_SERVER_BOUND_PASS'},
    [pscustomobject]@{Name='apply readiness timeout marker removed';Target='sql-apply-wait';Old=$credentialApplyReadinessTimeoutMarker;New="raise notice 'CW2_REMOVED_APPLY_READINESS_TIMEOUT';"},
    [pscustomobject]@{Name='apply cancellation request begin marker removed';Target='sql-apply-wait';Old=$credentialApplyCancelRequestBeginMarker;New="raise notice 'CW2_REMOVED_APPLY_CANCEL_REQUEST_BEGIN';"},
    [pscustomobject]@{Name='apply cancellation request pass marker removed';Target='sql-apply-wait';Old=$credentialApplyCancelRequestPassMarker;New="raise notice 'CW2_REMOVED_APPLY_CANCEL_REQUEST_PASS';"},
    [pscustomobject]@{Name='apply cancellation marker removed';Target='sql-apply-wait';Old=$credentialApplyCancelMarker;New="raise notice 'CW2_REMOVED_APPLY_CANCEL';"},
    [pscustomobject]@{Name='apply unlock marker removed';Target='sql-apply-wait';Old=$credentialApplyUnlockMarker;New="raise notice 'CW2_REMOVED_APPLY_UNLOCK';"},
    [pscustomobject]@{Name='apply busy poll marker removed';Target='sql-apply-wait';Old=$credentialApplyBusyPollMarker;New="raise notice 'CW2_REMOVED_APPLY_BUSY_POLL';"},
    [pscustomobject]@{Name='apply busy poll removed';Target='sql-apply-wait';Old=$credentialApplyBusyPoll;New='select 1 into v_busy; -- removed exact busy poll'},
    [pscustomobject]@{Name='apply busy poll bound weakened';Target='sql-apply-wait';Old=$credentialApplyBusyPollBound;New=$credentialApplyBusyPollBound.Replace('1..100','1..1000000')},
    [pscustomobject]@{Name='apply busy polarity inverted';Target='sql-apply-wait';Old=$credentialApplyBusyPolarity;New='exit when v_busy=1;'},
    [pscustomobject]@{Name='apply busy timeout false success';Target='sql-apply-wait';Old=$credentialApplyBusyTimeout;New='if false then'},
    [pscustomobject]@{Name='apply exact backend termination removed';Target='sql-apply-wait';Old=$credentialApplyTerminate;New='select false into v_terminated; -- removed exact backend termination'},
    [pscustomobject]@{Name='apply termination pid binding weakened';Target='sql-apply-wait';Old=$credentialApplyTerminate;New='select pg_terminate_backend(pg_backend_pid(),5000) into v_terminated;'},
    [pscustomobject]@{Name='apply busy timeout writer rollback removed';Target='sql-apply-wait';Old=$credentialTimeoutWriterRollback;New="select 'ERROR' into v_rollback; -- removed timeout writer rollback"},
    [pscustomobject]@{Name='apply busy timeout writer disconnect removed';Target='sql-apply-wait';Old=$credentialTimeoutWriterDisconnect;New="select 'ERROR' into v_disconnect; -- removed timeout writer disconnect"},
    [pscustomobject]@{Name='apply busy timeout disconnect marker removed';Target='sql-apply-wait';Old=$credentialApplyBusyTimeoutDisconnectMarker;New="raise notice 'CW2_REMOVED_BUSY_TIMEOUT_DISCONNECT';"},
    [pscustomobject]@{Name='apply busy clear marker removed';Target='sql-apply-wait';Old=$credentialApplyBusyClearMarker;New="raise notice 'CW2_REMOVED_BUSY_CLEAR';"},
    [pscustomobject]@{Name='apply result drain begin marker removed';Target='sql-apply-wait';Old=$credentialApplyDrainBeginMarker;New="raise notice 'CW2_REMOVED_RESULT_DRAIN_BEGIN';"},
    [pscustomobject]@{Name='apply result drain moved before busy clear';Target='sql-apply-wait';Old=$credentialApplyDrainAfterBusy;New="select count(*) from dblink_get_result('cw2_catalog_apply',false) as premature(result jsonb) into v_primary;`n   if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then raise exception 'CW2 catalog apply was still busy before result drain'; end if;"},
    [pscustomobject]@{Name='apply result drain pass marker removed';Target='sql-apply-wait';Old=$credentialApplyDrainPassMarker;New="raise notice 'CW2_REMOVED_RESULT_DRAIN_PASS';"},
    [pscustomobject]@{Name='apply disconnect marker removed';Target='sql-apply-wait';Old=$credentialApplyDisconnectMarker;New="raise notice 'CW2_REMOVED_APPLY_DISCONNECT';"},
    [pscustomobject]@{Name='apply readiness observed marker removed';Target='sql-apply-wait';Old=$credentialApplyReadinessObservedMarker;New="raise notice 'CW2_REMOVED_READINESS_OBSERVED';"},
    [pscustomobject]@{Name='apply readiness no-ready primary code removed';Target='sql-apply-wait';Old="'CW2R0'";New="'CW2REMOVED'"},
    [pscustomobject]@{Name='apply readiness no-ready primary cause removed';Target='sql-apply-wait';Old="'APPLY_READINESS_NOT_OBSERVED'";New="'CW2_REMOVED_READINESS_CAUSE'"},
    [pscustomobject]@{Name='apply readiness no-ready false success injected';Target='sql-apply-wait';Old='succeeded=v_ready,';New='succeeded=true,'},
    [pscustomobject]@{Name='ordinary clock restoration guard removed';Target='runner-clock-order';Old=$credentialClockPhaseGuard;New='if ($false) { throw "CW2_REMOVED_CLOCK_PHASE_GUARD" }'},
    [pscustomobject]@{Name='ordinary clock diagnostic provenance changed';Target='runner-native';Old=$credentialOrdinaryClockStage;New='Invoke-Cw2CapturedProcess -Stage "${viewport}:frozen-clock:concurrency"'},
    [pscustomobject]@{Name='readiness stage record moved into caught block';Target='sql';Old="$credentialReadinessRecord`ndo `$wait`$`ndeclare`n  v_ready boolean := false;`n  v_state text;`n  v_message text;`nbegin";New="do `$wait`$`ndeclare`n  v_ready boolean := false;`n  v_state text;`n  v_message text;`nbegin`n  $credentialReadinessRecord"},
    [pscustomobject]@{Name='readiness stage failure retained on wrong row';Target='sql-apply-wait';Old="where stage='readiness-observe';`nend`n`$wait`$;";New="where stage='cancel-apply';`nend`n`$wait`$;"},
    [pscustomobject]@{Name='apply recovery record query removed';Target='sql-apply-wait';Old="from cw2_catalog_apply_recovery_stages`norder by stage_order;";New='from cw2_catalog_apply_recovery_state'},
    [pscustomobject]@{Name='apply recovery records moved after failure';Target='sql-apply-wait';Old='\echo CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_BEGIN';New='\echo CW2_REMOVED_RECOVERY_RECORDS_BEGIN'},
    [pscustomobject]@{Name='apply busy zero-before-drain guard removed';Target='sql-apply-wait';Old="if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then raise exception 'CW2 catalog apply was still busy before result drain'; end if;";New='select true; -- removed busy zero-before-drain guard'},
    [pscustomobject]@{Name='apply absence custody wrong pid';Target='sql-apply-wait';Old='where pid=(select apply_pid from cw2_catalog_apply_recovery_state)';New='where pid=pg_backend_pid()'},
    [pscustomobject]@{Name='apply absence custody broadened';Target='sql-apply-wait';Old='where pid=(select apply_pid from cw2_catalog_apply_recovery_state)';New='where true'},
    [pscustomobject]@{Name='apply cancellation forced error action';Target='sql-apply-wait';Old=$credentialApplyCleanupCancel;New="raise exception 'CW2 forced cancel failure';"},
    [pscustomobject]@{Name='apply unlock forced error action';Target='sql-apply-wait';Old=$credentialCleanupUnlock;New="raise exception 'CW2 forced unlock failure';"},
    [pscustomobject]@{Name='apply busy poll forced hang action';Target='sql-apply-wait';Old=$credentialApplyBusyPollBound;New=$credentialApplyBusyPollBound.Replace('1..100','1..1000000').Replace("dblink_is_busy('cw2_catalog_apply')",'1')},
    [pscustomobject]@{Name='apply terminate forced error action';Target='sql-apply-wait';Old=$credentialApplyTerminate;New="raise exception 'CW2 forced terminate failure';"},
    [pscustomobject]@{Name='apply drain forced error action';Target='sql-apply-wait';Old="dblink_get_result('cw2_catalog_apply',false) as cleanup_primary";New="dblink_get_result('cw2_catalog_writer',false) as cleanup_primary"},
    [pscustomobject]@{Name='apply disconnect forced error action';Target='sql-apply-wait';Old=$credentialApplyCleanupDisconnect;New="raise exception 'CW2 forced apply disconnect failure';"},
    [pscustomobject]@{Name='writer rollback failure skips independent stage';Target='sql-apply-wait';Old='do $writer_rollback$';New='do $writer_cleanup$'},
    [pscustomobject]@{Name='writer rollback forced error still requires disconnect stage';Target='sql-apply-wait';Old=$credentialWriterCleanupRollback;New="raise exception 'CW2 forced writer rollback failure';"},
    [pscustomobject]@{Name='writer disconnect forced error retention';Target='sql-apply-wait';Old=$credentialWriterCleanupDisconnect;New="raise exception 'CW2 forced writer disconnect failure';"},
    [pscustomobject]@{Name='recovery timeout equality assertion weakened';Target='sql-apply-wait';Old="if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 cancel stage did not retain exact five-second timeout'; end if;";New='if false then raise exception ''CW2 cancel stage did not retain exact five-second timeout''; end if;'},
    [pscustomobject]@{Name='recovery timeout mismatch escapes staged retention';Target='sql-apply-wait';Old="begin`n    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 cancel stage did not retain exact five-second timeout'; end if;";New="if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 cancel stage did not retain exact five-second timeout'; end if;`n   begin"},
    [pscustomobject]@{Name='recovery stage failure retained on wrong row';Target='sql-apply-wait';Old="where stage='disconnect-writer'; end;";New="where stage='rollback-writer'; end;"},
    [pscustomobject]@{Name='recovery query canceled handler removed';Target='sql-apply-wait';Old="exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='cancel-apply'; end;";New="exception when others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='cancel-apply'; end;"},
    [pscustomobject]@{Name='recovery cleanup error diagnostics swallowed';Target='sql-apply-wait';Old="exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='cancel-apply'; end;";New="exception when query_canceled or others then null; -- swallowed cancellation cleanup diagnostics"},
    [pscustomobject]@{Name='writer primary result row count set to one';Target='sql-writer-timeout';Old='result_count integer check(result_count=0)';New='result_count integer check(result_count=1)'},
    [pscustomobject]@{Name='writer primary result attestation set to one';Target='sql';Old='(select result_count from cw2_catalog_writer_result) <> 0';New='(select result_count from cw2_catalog_writer_result) <> 1'},
    [pscustomobject]@{Name='writer primary error message capture removed';Target='sql';Old="update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');";New='select true; -- removed writer primary error message capture'},
    [pscustomobject]@{Name='writer primary null message denial removed';Target='sql';Old='or (select message from cw2_catalog_writer_result) is null';New='or false'},
    [pscustomobject]@{Name='writer primary message capture moved after attestation';Target='sql';Old=$concurrencySql;New=$credentialWriterMessageMovedSql},
    [pscustomobject]@{Name='writer primary error message read from wrong connection';Target='sql';Old="message=dblink_error_message('cw2_catalog_writer')";New="message=dblink_error_message('cw2_catalog_apply')"},
    [pscustomobject]@{Name='writer primary message capture moved before primary result';Target='sql';Old=$concurrencySql;New=$credentialWriterMessageBeforePrimarySql}
  )
  $credentialExpectedNames=@('outer user changed','base verifier elevated','fixture verifier elevated','fixture assigned pass removed','fixture user context removed','fixture context transaction removed','fixture epoch changed','fixture boundary marker removed','fixture boundary moved after insert','fixture post-catalog probe key changed','fixture post-catalog trigger target changed','post-catalog ordering static guard weakened','password added','passfile added','host added','dblink connect u','service role added','boundary marker removed','outer current user weakened','outer database weakened','outer network weakened','boundary moved after lock','apply authenticated downgrade removed','writer authenticated downgrade removed','apply attestation removed','writer attestation removed','terminal async drain removed','terminal async drain moved before primary result','terminal async drain nonempty guard weakened','terminal async drain marker removed','authenticated role flags weakened','outer public write injected','outer dollar-body public write injected','worker post-attestation elevation injected','outer dynamic admin write injected','outer dynamic format injected','outer alternate rpc injected','worker dynamic role elevation injected','extra apply rpc injected','extra writer rpc injected','unicode quoted role elevation injected','unicode quoted set config injected','ordinary quoted rpc injected','single string do body injected','escape string do body injected','language before single do body injected','language before escape do body injected','language before unicode do body injected','language before national do body injected','outer alter role createdb injected','outer grant truncate injected','worker truncate injected','worker create injected','worker drop injected','worker copy injected','reset role injected','row security disabled','replication role injected','trigger bypass injected','native exit guard weakened','native marker guard weakened','apply disconnect removed','writer disconnect removed','lock timeout cause weakened','released writer proof weakened','final match write proof weakened','final application nonwrite weakened')
  $credentialExpectedNames=[string[]]@($credentialExpectedNames[0..25]+@('writer dedicated transaction boundary removed','writer setup moved before transaction boundary','writer transaction-local timeout removed','writer timeout attestation weakened','writer action-local timeout removed','writer action-local timeout attestation weakened','writer synchronous action restored','writer asynchronous busy poll removed','writer asynchronous cancel removed','writer asynchronous bound failure removed','writer primary result error capture weakened','writer setup result removed','writer attestation result removed','writer primary result count guard weakened','writer terminal result drain removed','writer terminal result drain moved before message attestation','writer asynchronous drain marker removed','apply connection statement timeout removed','writer connection bounds removed','apply backend pid capture removed','apply readiness waiting lock relation changed','apply readiness pid binding removed','apply readiness waiting lock type changed','apply readiness waiting database binding removed','apply readiness first advisory key changed','apply readiness second advisory key changed','apply readiness waiting advisory key kind changed','apply readiness waiting lock mode changed','apply readiness waiting polarity inverted','apply readiness held lock relation changed','apply readiness held lock type changed','apply readiness held database binding removed','apply readiness held first key correlation removed','apply readiness held second key correlation removed','apply readiness held advisory key kind changed','apply readiness held lock mode changed','apply readiness owner polarity inverted','apply readiness poll bound weakened','writer dispatched before apply readiness','apply readiness cleanup cancellation removed','apply readiness blocking dblink cancellation restored','apply readiness cancellation pid binding weakened','apply readiness cleanup unlock moved after drain','apply readiness cleanup disconnect removed','apply readiness cleanup writer rollback removed','apply readiness cleanup writer disconnect removed','apply result collected before advisory release','apply probe marker removed','writer timeout marker removed','catalog release marker removed','async collection marker removed','released writer authenticated downgrade removed','released writer attestation removed')+$credentialExpectedNames[26..($credentialExpectedNames.Count-1)])
  $credentialExpectedNames=[string[]]@($credentialExpectedNames+@('apply dispatch begin marker removed','apply dispatch pass marker removed','apply readiness wait marker removed','apply readiness server timeout removed','apply readiness server bound begin marker removed','apply readiness server bound pass marker removed','apply readiness timeout marker removed','apply cancellation request begin marker removed','apply cancellation request pass marker removed','apply cancellation marker removed','apply unlock marker removed','apply busy poll marker removed','apply busy poll removed','apply busy poll bound weakened','apply busy polarity inverted','apply busy timeout false success','apply exact backend termination removed','apply termination pid binding weakened','apply busy timeout writer rollback removed','apply busy timeout writer disconnect removed','apply busy timeout disconnect marker removed','apply busy clear marker removed','apply result drain begin marker removed','apply result drain moved before busy clear','apply result drain pass marker removed','apply disconnect marker removed','apply readiness observed marker removed','apply readiness no-ready primary code removed','apply readiness no-ready primary cause removed','apply readiness no-ready false success injected','ordinary clock restoration guard removed','ordinary clock diagnostic provenance changed','readiness stage record moved into caught block','readiness stage failure retained on wrong row','apply recovery record query removed','apply recovery records moved after failure','apply busy zero-before-drain guard removed','apply absence custody wrong pid','apply absence custody broadened','apply cancellation forced error action','apply unlock forced error action','apply busy poll forced hang action','apply terminate forced error action','apply drain forced error action','apply disconnect forced error action','writer rollback failure skips independent stage','writer rollback forced error still requires disconnect stage','writer disconnect forced error retention','recovery timeout equality assertion weakened','recovery timeout mismatch escapes staged retention','recovery stage failure retained on wrong row','recovery query canceled handler removed','recovery cleanup error diagnostics swallowed'))
  $credentialExpectedNames=[string[]]@($credentialExpectedNames[0..39]+@('writer primary null sentinel counted as a row')+$credentialExpectedNames[40..($credentialExpectedNames.Count-1)])
  $credentialExpectedNames=[string[]]@($credentialExpectedNames+@('writer primary result row count set to one','writer primary result attestation set to one'))
  $credentialExpectedNames=[string[]]@($credentialExpectedNames+@('writer primary error message capture removed','writer primary null message denial removed','writer primary message capture moved after attestation'))
  $credentialExpectedNames=[string[]]@($credentialExpectedNames+@('writer primary error message read from wrong connection'))
  $credentialExpectedNames=[string[]]@($credentialExpectedNames+@('writer primary message capture moved before primary result'))
  if($credentialMutations.Count -ne 181 -or [string]::Join('|',[string[]]$credentialMutations.Name) -cne [string]::Join('|',$credentialExpectedNames)){throw 'CONNECT_WORKFLOWS_CW2_CREDENTIAL_MUTATION_MATRIX_INVALID'}
  $executedCredentialMutations=0
  foreach($mutation in $credentialMutations){
    try {
      $source=switch($mutation.Target){
        'runner-native'{Get-Cw2CredentialNativeSpan $runnerSource}
        'runner-base'{Get-Cw2CredentialBaseNativeSpan $runnerSource}
        'runner-fixture'{Get-Cw2CredentialFixtureNativeSpan $runnerSource}
        'runner-capture'{Get-Cw2UniqueSourceSpan $runnerSource ('# CW2-CREDENTIAL-HANDOFF capture ' + 'guard begin.') ('# CW2-CREDENTIAL-HANDOFF capture ' + 'guard end.')}
        'runner-clock-order'{Get-Cw2UniqueSourceSpan $runnerSource ('$clockResult=@(Invoke-'+'HarvestRidgeClockPhase') ('# CW2-CREDENTIAL-HANDOFF native '+'verify begin.')}
        'runner-post-catalog'{
          $postCatalogMutationBegin='# CW2_POST_CATALOG_STATIC_GUARD_'+'BEGIN'; $postCatalogMutationEnd='# CW2_POST_CATALOG_STATIC_GUARD_'+'END'
          $postCatalogMutationStart=$runnerSource.LastIndexOf($postCatalogMutationBegin,[StringComparison]::Ordinal); $postCatalogMutationFinish=$runnerSource.LastIndexOf($postCatalogMutationEnd,[StringComparison]::Ordinal)
          if($postCatalogMutationStart -lt 0 -or $postCatalogMutationFinish -le $postCatalogMutationStart){throw 'POST_CATALOG_STATIC_GUARD_SPAN_INVALID'}
          $runnerSource.Substring($postCatalogMutationStart,$postCatalogMutationFinish+$postCatalogMutationEnd.Length-$postCatalogMutationStart)
        }
        'fixture-sql'{$concurrencyFixtureSql}
        'sql-outer'{Get-Cw2UniqueSourceSpan $concurrencySql '-- CW2-CREDENTIAL-HANDOFF concurrency boundary begin.' '\echo CONNECT_WORKFLOWS_CW2_LOCAL_SUPABASE_ADMIN_BOUNDARY_PASS'}
        'sql-apply'{Get-Cw2UniqueSourceSpan $concurrencySql "select dblink_exec('cw2_catalog_apply',`$remote`$`nset role authenticated;" $credentialWriterTransactionBoundary}
        'sql-writer-auth'{Get-Cw2UniqueSourceSpan $concurrencySql $credentialWriterTransactionBoundary "select dblink_send_query('cw2_catalog_apply',`$remote`$"}
        'sql-apply-action'{Get-Cw2UniqueSourceSpan $concurrencySql "select dblink_send_query('cw2_catalog_apply',`$remote`$" 'do $wait$'}
        'sql-apply-wait'{Get-Cw2UniqueSourceSpan $concurrencySql 'do $wait$' '\echo CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS'}
        'sql-writer-timeout'{Get-Cw2UniqueSourceSpan $concurrencySql "select dblink_send_query('cw2_catalog_writer',`$remote`$" '\echo CONNECT_WORKFLOWS_CW2_WRITER_ASYNC_RESULT_DRAIN_PASS'}
        'sql-released-auth'{Get-Cw2UniqueSourceSpan $concurrencySql $credentialReleasedWriterBoundary "select dblink_disconnect('cw2_catalog_apply');"}
        default{$concurrencySql}
      }
    } catch {
      throw "CONNECT_WORKFLOWS_CW2_CREDENTIAL_MUTATION_SOURCE_ERROR:$($mutation.Name):$($_.Exception.Message)"
    }
    $old=[string]$mutation.Old; $new=[string]$mutation.New
    if([regex]::Matches($source,[regex]::Escape($old)).Count -ne 1){throw "CONNECT_WORKFLOWS_CW2_CREDENTIAL_MUTATION_TARGET_INVALID:$($mutation.Name)"}
    $mutatedSpan=$source.Replace($old,$new)
    if($mutatedSpan -ceq $source){throw "CONNECT_WORKFLOWS_CW2_CREDENTIAL_MUTATION_NOT_EXACT:$($mutation.Name)"}
    $mutatedFixtureSql=$concurrencyFixtureSql
    if($mutation.Target -like 'runner-*'){$mutatedRunner=$runnerSource.Replace($source,$mutatedSpan);$mutatedSql=$concurrencySql}
    elseif($mutation.Target -eq 'fixture-sql'){$mutatedRunner=$runnerSource;$mutatedSql=$concurrencySql;$mutatedFixtureSql=$mutatedSpan}
    elseif($mutation.Target -like 'sql-*'){$mutatedRunner=$runnerSource;$mutatedSql=$concurrencySql.Replace($source,$mutatedSpan)}
    else{$mutatedRunner=$runnerSource;$mutatedSql=$mutatedSpan}
    try {
      if(Test-Cw2CredentialHandoffStaticContract $mutatedRunner $mutatedFixtureSql $mutatedSql){throw "CONNECT_WORKFLOWS_CW2_CREDENTIAL_MUTATION_SURVIVED:$($mutation.Name)"}
    } catch {
      throw "CONNECT_WORKFLOWS_CW2_CREDENTIAL_MUTATION_EXECUTION_ERROR:$($mutation.Name):$($_.Exception.Message)"
    }
    $executedCredentialMutations+=1
  }
  if($executedCredentialMutations -ne $credentialMutations.Count){throw 'CONNECT_WORKFLOWS_CW2_CREDENTIAL_MUTATION_EXECUTION_INCOMPLETE'}
  Write-Output 'CONNECT_WORKFLOWS_CW2_CREDENTIAL_HANDOFF_STATIC_PASS count=181'
  # CW2_CREDENTIAL_HANDOFF_MUTATION_END
  # CW2_PROOF_005_EXECUTABLE_MATRIX_END
  $fixture = Get-Content -Raw -LiteralPath $cw2Fixture
  foreach ($needle in @('Cedar CW-2 exact Inventory program','c2000000-0000-4000-8000-000000000005','Synthetic Cedar Herbicide 41','CW2 fixture did not begin at 20 gal','cw2_proof.public_snapshot','class.relkind in (''r'',''p'')','insert into cw2_proof.browser_baseline')) {
    if ($fixture -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_FIXTURE_CONTRACT_MISSING:$needle" }
  }
  $futurePassDate = "1, 'CW-2 confirmed draw-down pass', 'post', 'spray', '2027-07-08', 0,"
  $futureDueDate = "'2027-07-08', 'template_date', false, 'planned',"
  if ([regex]::Matches($fixture,[regex]::Escape($futurePassDate)).Count -ne 2 -or
      [regex]::Matches($fixture,[regex]::Escape($futureDueDate)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_FIXTURE_DUE_AFTER_FROZEN_DAY_REQUIRED' }
  $normalizedFixture = $fixture -replace "`r`n?", "`n"
  $trackerAssertion = @'
  if (select count(*) from public.program_assignment_tracker
      where farm_id='27010000-0000-4000-8000-000000000005'
        and assignment_id='c2000000-0000-4000-8000-000000000004'
        and passes @> '[{"id":"c2000000-0000-4000-8000-000000000005","status":"planned"}]'::jsonb) <> 1 then
    raise exception 'CW2 fixture did not expose one planned Program pass';
  end if;
'@
  if ([regex]::Matches($normalizedFixture,[regex]::Escape($trackerAssertion)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_TRACKER_FIXTURE_CONTRACT_MISMATCH' }
  $trackerBlock = [regex]::Match($normalizedFixture,"(?s)from public\.program_assignment_tracker.*?raise exception 'CW2 fixture did not expose one planned Program pass';").Value
  if ([string]::IsNullOrWhiteSpace($trackerBlock) -or $trackerBlock -match "(?m)^\s*and\s+status\s*=\s*'planned'") { throw 'CONNECT_WORKFLOWS_CW2_TRACKER_FIXTURE_TOP_LEVEL_STATUS_REFUSED' }
  $regressionSource = Get-Content -Raw -LiteralPath (Join-Path $root 'src/data/programInventoryCW2.regression.ts')
  try { $fkIndexFocusedProofSpan=Get-Cw2UniqueSourceSpan $regressionSource '// CW2_FK_INDEX_FOCUSED_PROOF_BEGIN' '// CW2_FK_INDEX_FOCUSED_PROOF_END' }
  catch { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_FOCUSED_PROOF_SPAN_MISSING' }
  if ((Get-Cw2Proof005TextSha256 $fkIndexFocusedProofSpan) -cne '7b51b5f44a977ba0c810d521817a2094474a9de9289e2aac443701be99bca569' -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('fkIndexMigrationMutations.length === 15') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('for (const mutation of fkIndexMigrationMutations)') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('assigned partial predicate added') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('assigned wider index added') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('inventory partial predicate added') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('inventory wider index added') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('follow-up migration omitted') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('foreign-key index order swapped') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('archivedBaselineMutations.length === 4') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('follow-up archived migration removal omitted') -or
      $fkIndexFocusedProofSpan -notmatch [regex]::Escape('archived migration attestation narrowed')) { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_FOCUSED_PROOF_CONTRACT_MISSING' }
  $withoutFkIndexFocusedProof=$regressionSource.Replace($fkIndexFocusedProofSpan,'')
  if($withoutFkIndexFocusedProof -match [regex]::Escape('// CW2_FK_INDEX_FOCUSED_PROOF_BEGIN') -or $withoutFkIndexFocusedProof -match [regex]::Escape('fkIndexMigrationMutations.length === 15')) { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_FOCUSED_PROOF_OMISSION_GUARD_WEAKENED' }
  foreach ($needle in @(
    'const trackerFixtureMutations = [','trackerFixtureMutations.length === 7',
    'top-level planned status','changed nested pass ID','changed nested pass status',
    'missing nested pass ID','missing nested pass status','wrong tracker relation',
    'whole tracker proof omission','for (const mutation of trackerFixtureMutations)',
    'exactTrackerPassProof(mutation.source)'
  )) { if ($regressionSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_TRACKER_MUTATION_BLOCK_MISSING:$needle" } }
  foreach ($needle in @(
    'const fkIndexPinMutations = [','fkIndexPinMutations.length === 6',
    'focused follow-up migration guard removed','Cedar follow-up migration guard removed',
    'for (const mutation of fkIndexPinMutations)'
  )) { if ($regressionSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_FK_INDEX_PIN_MUTATION_BLOCK_MISSING:$needle" } }
  foreach ($needle in @(
    'const futureDueFixtureMutations = [','futureDueFixtureMutations.length === 3',
    'restore all CW-2 pass dates to the frozen day','restore template target to the frozen day','restore assigned due date to the frozen day',
    'const noDueStartupMutations = [','noDueStartupMutations.length === 5',
    'omit pre-browser no-due call','weaken has_due false assertion','replace status RPC with startup writer',
    'allowlist startup writer','disable strict non-read fence'
  )) { if ($regressionSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_RUNTIME_001_MUTATION_BLOCK_MISSING:$needle" } }
  foreach ($needle in @(
    'const exactProgramProductLocator =','const exactProductTextboxLocator =','const productLocatorMutations = [',
    'remove exact Product accessible-name match','productLocatorMutations.length === 1',
    'exactProductTextboxLocator(mutation.source)'
  )) { if ($regressionSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_RUNTIME_002_MUTATION_BLOCK_MISSING:$needle" } }
  foreach ($needle in @(
    'function Assert-Cw2NoDueStartupWrite',
    '/rest/v1/rpc/program_due_generation_status',
    "'x-farm-rx-expected-user-id' = '27000000-0000-4000-8000-000000000001'",
    '''x-farm-rx-access-epochs'' = ''{"27010000-0000-4000-8000-000000000005":1}''',
    "(`$keys -join '|') -cne 'has_due|local_date|notification_needed|task_needed'",
    "`$status.has_due -isnot [bool] -or `$status.has_due -ne `$false",
    "`$status.task_needed -isnot [bool] -or `$status.task_needed -ne `$false",
    "`$status.notification_needed -isnot [bool] -or `$status.notification_needed -ne `$false",
    "`$status.local_date -cne '2027-07-07'",
    'CONNECT_WORKFLOWS_CW2_NO_DUE_STARTUP_WRITE_PASS',
    'Assert-Cw2NoDueStartupWrite -ApiUrl $boundary.ApiUrl -PublishableKey $boundary.PublishableKey -AccessToken $token -Viewport $viewport'
  )) { if ($runnerSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_NO_DUE_ASSERTION_MISSING:$needle" } }
  foreach ($needle in @(
    'function Invoke-Cw2CapturedProcess','function Assert-Cw2CaptureSuccess','function Invoke-Cw2DiagnosticSelfTest',
    '[Diagnostics.ProcessStartInfo]::new()','$startInfo.UseShellExecute = $false',
    '$nativeProcessId = $process.Id','$process.WaitForExit(5000)',
    '$startInfo.RedirectStandardInput = $true','$startInfo.RedirectStandardOutput = $true','$startInfo.RedirectStandardError = $true',
    '$resolvedWorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)','$startInfo.WorkingDirectory = $resolvedWorkingDirectory','explicit-working-directory','CONNECT_WORKFLOWS_CW2_SELFTEST_WORKING_DIRECTORY_NOT_APPLIED',
    '$process.StandardInput.BaseStream.Write($StdinBytes,0,$StdinBytes.Length)',
    '$process.StandardOutput.BaseStream.CopyToAsync($stdoutStream)','$process.StandardError.BaseStream.CopyToAsync($stderrStream)',
    '[IO.FileStream]::new($stdoutPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,[IO.FileOptions]::WriteThrough)',
    '[IO.FileStream]::new($stderrPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,[IO.FileOptions]::WriteThrough)',
    "event='native_started'","event='native_process_started'","event='native_timeout'","event='native_timeout_finalized'","event='native_finished'",
    'native_process_id','kill_requested','finalization_completed','post_kill_exit_code','stdin_sha256','stdout_sha256','stderr_sha256',
    'byte-exact-concurrent-zero','stderr-nonzero','empty-nonzero','zero-no-marker','stderr-marker-only','stdout-and-stderr-marker','embedded-stderr-marker','lowercase-stdout-marker',
    'start-failure','timeout-missing-exit','CONNECT_WORKFLOWS_CW2_SELFTEST_TIMEOUT_FINALIZATION_EVIDENCE_MISSING','CONNECT_WORKFLOWS_CW2_SELFTEST_DURABLE_PID_FINALIZATION_RECORD_MISSING','finally-restore','evidence-native-aggregate','marker-only-nonzero',
    '$ErrorActionPreference = ''Continue''','$ErrorActionPreference = $priorErrorActionPreference','return $true',
    '$priorConsoleInputEncoding = [Console]::InputEncoding','[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)','[Console]::InputEncoding = $priorConsoleInputEncoding',
    'CONNECT_WORKFLOWS_CW2_DURABLE_LOG_WRITE_FAILED','CONNECT_WORKFLOWS_CW2_CAPTURE_FAILED',
    'function Assert-Cw2CaptureExitZero','baseline_archived_stack_identity','baseline_archived_migration_attestation','baseline_archived_reset_recovery_required','RECOVERY_REQUIRED','baseline_archived_reset_pass','CONNECT_WORKFLOWS_CW2_BASELINE_ARCHIVED_RESET_CAPTURE_PASS','CONNECT_WORKFLOWS_CW2_BASELINE_RESET_FAILED','CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_EVIDENCE_FAILED','CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_RECORD_READBACK_FAILED','CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_SELFTEST_PASS','CONNECT_WORKFLOWS_CW2_SELFTEST_BASELINE_RECOVERY_RECORD_MISSING','CONNECT_WORKFLOWS_CW2_SELFTEST_POST_IDENTITY_RECOVERY_UNKNOWN_MISSING','CONNECT_WORKFLOWS_CW2_SELFTEST_BASELINE_FAILURE_CODE_MASKED','CONNECT_WORKFLOWS_CW2_SELFTEST_BASELINE_ORIGINAL_RETHROW_LOST','CONNECT_WORKFLOWS_CW2_SELFTEST_RECOVERY_AGGREGATION_ORDER_OR_INNER_LOST','CONNECT_WORKFLOWS_CW2_SELFTEST_FALSE_RECOVERY_RECORD_ON_SUCCESS','CW2_BASELINE_RESET_FAILURE_PATH_BEGIN','CW2_BASELINE_RESET_FAILURE_PATH_END','CW2_BASELINE_RESET_CAPTURE_BEGIN','CW2_BASELINE_RESET_CAPTURE_END','CW2_BASELINE_RESET_ONLY_BEGIN','CW2_BASELINE_RESET_ONLY_END','baseline_archived_reset_only_started','baseline_archived_reset_only_pass','CONNECT_WORKFLOWS_CW2_BASELINE_RESET_ONLY_PASS','public.ecr.aws/supabase/postgres:17.6.1.134','sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770',
    'CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_SELFTEST_PASS'
  )) { if ($runnerSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_HARNESS_MISSING:$needle" } }
  $captureExitStart=$runnerSource.IndexOf('function Assert-Cw2CaptureExitZero',[StringComparison]::Ordinal)
  $captureExitEnd=$runnerSource.IndexOf('function Assert-Cw2SelfTestThrows',$captureExitStart,[StringComparison]::Ordinal)
  $captureExitSource=if($captureExitStart -ge 0 -and $captureExitEnd -gt $captureExitStart){$runnerSource.Substring($captureExitStart,$captureExitEnd-$captureExitStart)}else{''}
  if($captureExitSource.IndexOf('${FailureCode}:cause=',[StringComparison]::Ordinal) -lt 0 -or $captureExitSource.IndexOf('$FailureCode:cause=',[StringComparison]::Ordinal) -ge 0){throw 'CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_FAILURE_CODE_INTERPOLATION_MISSING'}
  foreach ($needle in @(
    'const diagnosticHarnessMarkers = [','const diagnosticHarnessMutations = [',
    'diagnosticHarnessMutations.length === 58','for (const mutation of diagnosticHarnessMutations)',
    'archived reset capture removed','archived reset exact argv changed','archived reset cwd removed','archived reset exit guard removed','baseline recovery required removed','baseline pass marker removed','failed reset recovery invocation removed','failed reset recovery moved before post identity','failed reset false clean release claim added','failed reset primary recovery aggregation removed','baseline reset-only mode omitted','baseline reset-only reset omitted','baseline reset-only continuation allowed','baseline recovery inline command-position if restored','baseline recovery durable readback removed','baseline recovery primary cause omitted','baseline recovery post identity cause omitted','baseline recovery helper log guard removed','baseline recovery helper failure simulation removed','baseline reset success false recovery guard removed','baseline reset failure code interpolation masked','baseline recovery aggregation order inverted','baseline recovery post identity ordering removed','baseline recovery original inner exception removed',
    'CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_SELFTEST_PASS'
  )) { if ($regressionSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_MUTATION_BLOCK_MISSING:$needle" } }
  foreach ($needle in @(
    'const exhaustiveSignatureFieldPaths = [','exhaustiveSignatureFieldPaths.length === 74',
    'completeExhaustiveSignatureMutationProof','signatureFieldMutations.length === 74','expectedSignatureFieldPaths.size === 74',
    'for (const [index, path] of signatureFieldMutations.entries())','executedSignatureCases === signatureFieldMutations.length',
    'for (const path of exhaustiveSignatureFieldPaths)','Removing exhaustive signature case',
    'const staleUnitMigrationMutations = [','staleUnitMigrationMutations.length === 4','for (const mutation of staleUnitMigrationMutations)',
    'remove exact stale-unit guard','accept equal instead of distinct unit','compare stale unit to actual line unit','remove stale-unit denial exception',
    'const staleUnitSqlMarkers = [','completeStaleUnitSqlProof','for (const marker of staleUnitSqlMarkers)',
    'const staleUnitApplicationProductMutations = [','staleUnitApplicationProductMutations.length === 5',
    'remove exact application_products non-write predicate','change application_products relation','change application_id column',
    'weaken application_products existence predicate','change application identifier sentinel',
    'for (const mutation of staleUnitApplicationProductMutations)',
    'executedStaleUnitApplicationProductMutations === staleUnitApplicationProductMutations.length',
    'staleUnitApplicationProductMutationStart','staleUnitApplicationProductMutationEnd',
    'staleUnitApplicationProductMutationBlock','completeStaleUnitApplicationProductMutationProof'
  )) { if ($regressionSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_PROOF_001_002_MUTATION_BLOCK_MISSING:$needle" } }
  $programsRegressionSource = Get-Content -Raw -LiteralPath (Join-Path $root 'src/data/SupabaseProgramsRepository.regression.ts')
  foreach ($needle in @(
    'const signatureFieldMutations = [','signatureFieldMutations.length === 74','expectedSignatureFieldPaths.size === 74',
    'for (const [index, path] of signatureFieldMutations.entries())',
    'canonicalProgramInventorySnapshot(changedContext, changedAssignments, changedMatches) !== stableSignature',
    'executedSignatureCases === signatureFieldMutations.length','match.farm_id'
  )) { if ($programsRegressionSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_EXHAUSTIVE_SIGNATURE_PROOF_MISSING:$needle" } }
  $migrationSource = Get-Content -Raw -LiteralPath $migrationPath
  foreach ($needle in @(
    'create table public.program_inventory_matches','lock table public.inventory_products in share mode;',
    'and (p_application_record_id is not null or p_create_application_record)',
    'and assigned_pass.application_record_id is null',
    '''user_id'', v_caller','''access_epoch'', v_access_epoch',
    'quantity_in_inventory_unit <= 10000000','quantity_in_inventory_unit = round(quantity_in_inventory_unit, 8)',
    'if v_inventory_unit::text is distinct from','(v_item #>> ''{inventory_match,inventory_unit}'')',
    'confirmed inventory unit is stale'
  )) { if ($migrationSource -notmatch [regex]::Escape($needle)) { throw "CONNECT_WORKFLOWS_CW2_MIGRATION_CONTRACT_MISSING:$needle" } }
  # CW2_POST_CATALOG_STATIC_GUARD_BEGIN
  $cw2RequestSerializationLock='perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text));'
  $cw2CatalogShareLock='lock table public.inventory_products in share mode;'
  $cw2AssignedProductUpdate='update public.assigned_program_pass_products assigned_product'
  $cw2FixtureProbeLock='perform pg_catalog.pg_advisory_xact_lock(25000,2);'
  $cw2FixtureProbeTrigger='create trigger cw2_catalog_probe_pause before update on public.assigned_program_pass_products'
  $cw2RequestLockIndex=$migrationSource.IndexOf($cw2RequestSerializationLock,[StringComparison]::Ordinal)
  $cw2CatalogShareLockIndex=$migrationSource.IndexOf($cw2CatalogShareLock,[StringComparison]::Ordinal)
  $cw2AssignedProductUpdateIndex=$migrationSource.IndexOf($cw2AssignedProductUpdate,[StringComparison]::Ordinal)
  $cw2FixtureProbeCount=[regex]::Matches($concurrencyFixtureSql,[regex]::Escape($cw2FixtureProbeLock)).Count
  $cw2FixtureProbeTriggerCount=[regex]::Matches($concurrencyFixtureSql,[regex]::Escape($cw2FixtureProbeTrigger)).Count
  if($cw2RequestLockIndex -lt 0 -or $cw2CatalogShareLockIndex -le $cw2RequestLockIndex -or $cw2AssignedProductUpdateIndex -le $cw2CatalogShareLockIndex -or $cw2FixtureProbeCount -ne 1 -or $cw2FixtureProbeTriggerCount -ne 1){throw 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_POST_CATALOG_PROBE_CONTRACT_MISSING'}
  # CW2_POST_CATALOG_STATIC_GUARD_END

  $cw1Source = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/verify-connect-workflows-cw1-disposable.ps1')
  if ($cw1Source -notmatch [regex]::Escape("`$migration = '20260725213142_pine_hill_removed_farm_epoch.sql'")) { throw 'CONNECT_WORKFLOWS_CW2_CW1_HISTORICAL_HEAD_GUARD_CHANGED' }
  if ($cw1Source -notmatch [regex]::Escape("`$migrationBlob = '89f432cdfc9a2cd6c6379309e0eb1bd283500686'")) { throw 'CONNECT_WORKFLOWS_CW2_CW1_HISTORICAL_BLOB_GUARD_CHANGED' }
  $cedarSource = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/verify-cedar-creek-disposable.ps1')
  $cedarFkIndexGuard = '  if ((Get-FileHash -LiteralPath (Join-Path $root "supabase/migrations/$fkIndexMigration") -Algorithm SHA256).Hash.ToLowerInvariant() -cne $fkIndexMigrationSha256) { throw ''CEDAR_CREEK_FK_INDEX_MIGRATION_HASH_MISMATCH'' }'
  if ($cedarSource -notmatch [regex]::Escape("`$migration = '$migration'") -or
      $cedarSource -notmatch [regex]::Escape("`$migrationBlob = '$migrationBlob'") -or
      $cedarSource -notmatch [regex]::Escape("`$fkIndexMigration = '$fkIndexMigration'") -or
      $cedarSource -notmatch [regex]::Escape("`$fkIndexMigrationSha256 = '$fkIndexMigrationSha256'") -or
      [regex]::Matches($cedarSource,[regex]::Escape($cedarFkIndexGuard)).Count -ne 1) { throw 'CONNECT_WORKFLOWS_CW2_CEDAR_HEAD_GUARD_STALE' }
  if ($seasonScenarioCommands.Count -ne 6 -or ($seasonScenarioCommands -join "`n") -match 'verify:season') { throw 'CONNECT_WORKFLOWS_CW2_SCENARIO_SEQUENCE_INVALID' }
  Write-Output 'CONNECT_WORKFLOWS_CW2_STATIC_CONTRACT_PASS'
}

function Invoke-Cw2Sql([string]$Sql) {
  $out = @($Sql | docker exec -i $db psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "CONNECT_WORKFLOWS_CW2_SQL_FAILED:$([string]::Join("`n",[string[]]$out))" }
  [string]::Join("`n",[string[]]$out)
}

function Wait-Cw2Auth {
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    try { $health = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:55321/auth/v1/health' -TimeoutSec 2; if ($health.StatusCode -eq 200 -and $health.Content -match '"name"\s*:\s*"GoTrue"') { return } } catch {}
    if ($attempt -lt 30) { Start-Sleep -Milliseconds 500 }
  }
  throw 'CONNECT_WORKFLOWS_CW2_AUTH_NOT_HEALTHY'
}

function Reset-Cw2([string]$Supabase) {
  & $Supabase --profile supabase db reset --local --no-seed --yes
  if ($LASTEXITCODE -ne 0) { throw 'CONNECT_WORKFLOWS_CW2_LOCAL_RESET_FAILED' }
  $running = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $running -notcontains $gateway) { throw "CONNECT_WORKFLOWS_CW2_GATEWAY_NOT_EXACT:$gateway" }
  docker restart $gateway | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'CONNECT_WORKFLOWS_CW2_GATEWAY_REFRESH_FAILED' }
  Wait-Cw2Auth
  if (-not (Invoke-MapleSeasonSqlFile -Path $baseFixture -ExpectedContainer $db)) { throw 'CONNECT_WORKFLOWS_CW2_BASE_FIXTURE_FAILED' }
  if (-not (Invoke-MapleSeasonSqlFile -Path $cw2Fixture -ExpectedContainer $db)) { throw 'CONNECT_WORKFLOWS_CW2_DELTA_FIXTURE_FAILED' }
}

function Get-Cw2BaselineStackIdentity([string]$Phase,[string]$LogPath,[string]$DockerExecutable,[string]$WorkingDirectory) {
  $inspectArguments = "inspect --format `"{{.Name}}|{{.Config.Image}}|{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{.HostConfig.RestartPolicy.Name}}`" $db"
  $readyArguments = "exec $db pg_isready -h /run/postgresql -p 5432"
  $inspectCapture = $null
  $readyCapture = $null
  $inspectFailure = $null
  $readyFailure = $null
  try { $inspectCapture = Invoke-Cw2CapturedProcess -Stage "baseline-reset:$Phase`:stack-identity" -LogPath $LogPath -Executable $DockerExecutable -Arguments $inspectArguments -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 30000 -WorkingDirectory $WorkingDirectory }
  catch { $inspectFailure = $_.Exception.ToString() }
  try { $readyCapture = Invoke-Cw2CapturedProcess -Stage "baseline-reset:$Phase`:pg-isready" -LogPath $LogPath -Executable $DockerExecutable -Arguments $readyArguments -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 30000 -WorkingDirectory $WorkingDirectory }
  catch { $readyFailure = $_.Exception.ToString() }
  $expectedInspect = "/$db|$ordinaryPostgresImage|$ordinaryPostgresImageId|true|healthy|unless-stopped"
  $observedInspect = if ($null -eq $inspectCapture) { 'UNKNOWN' } else { $inspectCapture.StdoutText.Trim() }
  $observedReady = if ($null -eq $readyCapture) { 'UNKNOWN' } else { $readyCapture.StdoutText.Trim() }
  $inspectExit = if ($null -eq $inspectCapture) { $null } else { $inspectCapture.NativeExitCode }
  $readyExit = if ($null -eq $readyCapture) { $null } else { $readyCapture.NativeExitCode }
  $valid = $null -eq $inspectFailure -and $null -eq $readyFailure -and
    $null -ne $inspectCapture -and $null -ne $readyCapture -and
    $inspectCapture.Cause -ceq 'completed' -and $readyCapture.Cause -ceq 'completed' -and
    $null -ne $inspectExit -and $null -ne $readyExit -and $inspectExit -eq 0 -and $readyExit -eq 0 -and
    $observedInspect -ceq $expectedInspect -and $observedReady -ceq '/run/postgresql:5432 - accepting connections'
  $identity = [pscustomobject]@{ Phase=$Phase; ExpectedInspect=$expectedInspect; ObservedInspect=$observedInspect; ObservedReady=$observedReady; InspectExit=$inspectExit; ReadyExit=$readyExit; Valid=$valid; InspectFailure=$inspectFailure; ReadyFailure=$readyFailure }
  Write-Cw2DiagnosticRecord -LogPath $LogPath -Record ([ordered]@{ event='baseline_archived_stack_identity'; phase=$Phase; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); expected_project_id=$project; expected_container=$db; expected_postgres_image=$ordinaryPostgresImage; expected_postgres_image_id=$ordinaryPostgresImageId; expected_inspect=$expectedInspect; observed_inspect=$observedInspect; observed_pg_isready=$observedReady; inspect_exit_code=$inspectExit; pg_isready_exit_code=$readyExit; inspect_failure=$inspectFailure; pg_isready_failure=$readyFailure; valid=$valid })
  $identity
}

function Assert-Cw2BaselineArchiveAttestation([string]$ArchiveRoot,[string[]]$ArchivedMigrations,[string]$LogPath) {
  $archiveConfig = Join-Path $ArchiveRoot 'supabase/config.toml'
  $configValid = Test-Path -LiteralPath $archiveConfig -PathType Leaf
  if ($configValid) { $configValid = (Get-Content -Raw -Encoding UTF8 -LiteralPath $archiveConfig) -match ('(?m)^project_id\s*=\s*"' + [regex]::Escape($project) + '"\s*$') }
  if ($ArchivedMigrations.Count -ne 2) { throw 'CONNECT_WORKFLOWS_CW2_BASELINE_ARCHIVE_MIGRATION_SET_INVALID' }
  $presentMigrations = @($ArchivedMigrations | Where-Object { Test-Path -LiteralPath $_ })
  Write-Cw2DiagnosticRecord -LogPath $LogPath -Record ([ordered]@{ event='baseline_archived_migration_attestation'; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); archived_working_directory=$ArchiveRoot; expected_project_id=$project; archived_config=$archiveConfig; archived_config_valid=$configValid; migration_paths=$ArchivedMigrations; migration_present_paths=$presentMigrations; migration_baseline='ABSENT' })
  if (-not $configValid -or $presentMigrations.Count -ne 0) { throw 'CONNECT_WORKFLOWS_CW2_BASELINE_ARCHIVE_ATTESTATION_FAILED' }
}

function Write-Cw2BaselineRecoveryRequired([string]$LogPath,[string]$Reason,$PreIdentity,$PostIdentity,$Capture,[string]$PrimaryFailureText='UNKNOWN',[string]$PostIdentityFailureText='UNKNOWN') {
  if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { throw 'CONNECT_WORKFLOWS_CW2_DURABLE_LOG_MISSING' }
  $preStackIdentity = if ($null -eq $PreIdentity) { 'UNKNOWN' } else { [string]$PreIdentity.ObservedInspect }
  $postStackIdentity = if ($null -eq $PostIdentity) { 'UNKNOWN' } else { [string]$PostIdentity.ObservedInspect }
  $postPgIsReady = if ($null -eq $PostIdentity) { 'UNKNOWN' } else { [string]$PostIdentity.ObservedReady }
  $resetCause = if ($null -eq $Capture) { 'UNKNOWN' } else { [string]$Capture.Cause }
  $resetExitCode = if ($null -eq $Capture) { $null } else { $Capture.NativeExitCode }
  $resetStdout = if ($null -eq $Capture) { 'UNKNOWN' } else { [string]$Capture.StdoutPath }
  $resetStderr = if ($null -eq $Capture) { 'UNKNOWN' } else { [string]$Capture.StderrPath }
  $primaryFailure = if ([string]::IsNullOrWhiteSpace($PrimaryFailureText)) { 'UNKNOWN' } else { $PrimaryFailureText }
  $postIdentityFailure = if ([string]::IsNullOrWhiteSpace($PostIdentityFailureText)) { 'UNKNOWN' } else { $PostIdentityFailureText }
  $priorLineCount = @(Get-Content -LiteralPath $LogPath).Count
  Write-Cw2DiagnosticRecord -LogPath $LogPath -Record ([ordered]@{
    event='baseline_archived_reset_recovery_required'; status='RECOVERY_REQUIRED'; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o')
    reason=$Reason; expected_project_id=$project; expected_container=$db; pre_stack_identity=$preStackIdentity
    post_stack_identity=$postStackIdentity; post_pg_isready=$postPgIsReady; reset_cause=$resetCause
    reset_exit_code=$resetExitCode; reset_stdout=$resetStdout; reset_stderr=$resetStderr; primary_failure=$primaryFailure
    post_identity_failure=$postIdentityFailure
  })
  $records = @(Get-Content -LiteralPath $LogPath | ForEach-Object { $_ | ConvertFrom-Json })
  $recoveryRecords = @($records | Where-Object { $_.event -ceq 'baseline_archived_reset_recovery_required' })
  $record = if ($recoveryRecords.Count -eq 1) { $recoveryRecords[0] } else { $null }
  if ($records.Count -ne ($priorLineCount + 1) -or $null -eq $record -or
      $record.status -cne 'RECOVERY_REQUIRED' -or $record.reason -cne $Reason -or
      $record.pre_stack_identity -cne $preStackIdentity -or $record.post_stack_identity -cne $postStackIdentity -or
      $record.post_pg_isready -cne $postPgIsReady -or $record.reset_cause -cne $resetCause -or
      $record.reset_exit_code -ne $resetExitCode -or $record.reset_stdout -cne $resetStdout -or
      $record.reset_stderr -cne $resetStderr -or $record.primary_failure -cne $primaryFailure -or
      $record.post_identity_failure -cne $postIdentityFailure) { throw 'CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_RECORD_READBACK_FAILED' }
  return $true
}

function Invoke-Cw2BaselineResetFailure([bool]$ResetFailed,[Exception]$PrimaryFailure,[string]$LogPath,[string]$Reason,$PreIdentity,$PostIdentity,$Capture,[string]$PostIdentityFailure='') {
  if (-not $ResetFailed) { return $true }
  if ($null -eq $PrimaryFailure) { throw 'CONNECT_WORKFLOWS_CW2_BASELINE_PRIMARY_FAILURE_REQUIRED' }
  try {
    [void](Write-Cw2BaselineRecoveryRequired -LogPath $LogPath -Reason $Reason -PreIdentity $PreIdentity -PostIdentity $PostIdentity -Capture $Capture -PrimaryFailureText $PrimaryFailure.ToString() -PostIdentityFailureText $PostIdentityFailure)
  } catch {
    throw [Exception]::new("CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_EVIDENCE_FAILED`nPRIMARY_FAILURE:$($PrimaryFailure.ToString())`nPOST_IDENTITY_FAILURE:$PostIdentityFailure`nRECOVERY_FAILURE:$($_.Exception.ToString())",$PrimaryFailure)
  }
  throw $PrimaryFailure
}

function Get-Cw2AccessToken([string]$PublishableKey) {
  $password = $env:FARMRX_SEASON_OWNER_PASSWORD
  if ($password -notmatch '^[0-9a-f]{64}$') { throw 'CONNECT_WORKFLOWS_CW2_SYNTHETIC_CREDENTIAL_UNAVAILABLE' }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:55321/auth/v1/token?grant_type=password' -Headers @{ apikey = $PublishableKey } -ContentType 'application/json' -Body (@{ email='cedar.owner@farmrx.local.test'; password=$password } | ConvertTo-Json -Compress) -TimeoutSec 10
    $token = ($response.Content | ConvertFrom-Json -ErrorAction Stop).access_token
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'missing token' }
    [string]$token
  } catch { throw 'CONNECT_WORKFLOWS_CW2_SYNTHETIC_TOKEN_UNAVAILABLE' }
  finally { $password = $null }
}

function Assert-Cw2NoDueStartupWrite {
  param(
    [Parameter(Mandatory)][string]$ApiUrl,
    [Parameter(Mandatory)][string]$PublishableKey,
    [Parameter(Mandatory)][string]$AccessToken,
    [Parameter(Mandatory)][ValidateSet('desktop','phone')][string]$Viewport
  )
  $farmId = '27010000-0000-4000-8000-000000000005'
  $headers = @{
    apikey = $PublishableKey
    Authorization = "Bearer $AccessToken"
    'Content-Profile' = 'public'
    'x-farm-rx-expected-user-id' = '27000000-0000-4000-8000-000000000001'
    'x-farm-rx-access-epochs' = '{"27010000-0000-4000-8000-000000000005":1}'
  }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$ApiUrl/rest/v1/rpc/program_due_generation_status" -Headers $headers -ContentType 'application/json' -Body (@{ p_farm_id = $farmId } | ConvertTo-Json -Compress) -TimeoutSec 10
    $status = $response.Content | ConvertFrom-Json -ErrorAction Stop
  } catch { throw "CONNECT_WORKFLOWS_CW2_NO_DUE_STATUS_UNAVAILABLE:$Viewport" }
  $keys = @($status.PSObject.Properties.Name | Sort-Object)
  if ($response.StatusCode -ne 200 -or
      ($keys -join '|') -cne 'has_due|local_date|notification_needed|task_needed' -or
      $status.has_due -isnot [bool] -or $status.has_due -ne $false -or
      $status.task_needed -isnot [bool] -or $status.task_needed -ne $false -or
      $status.notification_needed -isnot [bool] -or $status.notification_needed -ne $false -or
      $status.local_date -cne '2027-07-07') { throw "CONNECT_WORKFLOWS_CW2_STARTUP_WRITE_WOULD_BE_DUE:$Viewport" }
  Write-Host "CONNECT_WORKFLOWS_CW2_NO_DUE_STARTUP_WRITE_PASS:$Viewport"
}

function Assert-Cw2MigrationRollback([string]$Supabase,[string]$DockerExecutable,[string]$LogPath) {
  $taskTemp = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-cw2-rollback-" + [guid]::NewGuid().ToString('N'))
  $archive = "$taskTemp.zip"
  $resolvedTemp = [IO.Path]::GetFullPath($taskTemp)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $resolvedTemp.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'CONNECT_WORKFLOWS_CW2_ROLLBACK_TEMP_PATH_REFUSED' }
  $preIdentity = $null
  $postIdentity = $null
  $resetCapture = $null
  try {
    & git -C $root archive --format=zip --output=$archive HEAD
    if ($LASTEXITCODE -ne 0) { throw 'CONNECT_WORKFLOWS_CW2_BASELINE_ARCHIVE_FAILED' }
    Expand-Archive -LiteralPath $archive -DestinationPath $taskTemp
    $archivedMigrations = @(
      (Join-Path $taskTemp "supabase/migrations/$migration"),
      (Join-Path $taskTemp "supabase/migrations/$fkIndexMigration")
    )
    foreach ($archivedMigration in $archivedMigrations) {
      if (Test-Path -LiteralPath $archivedMigration) { Remove-Item -LiteralPath $archivedMigration }
    }
    Assert-Cw2BaselineArchiveAttestation -ArchiveRoot $resolvedTemp -ArchivedMigrations $archivedMigrations -LogPath $LogPath
    $preIdentity = Get-Cw2BaselineStackIdentity -Phase 'pre-reset' -LogPath $LogPath -DockerExecutable $DockerExecutable -WorkingDirectory $resolvedTemp
    if (-not $preIdentity.Valid) {
      Write-Cw2BaselineRecoveryRequired -LogPath $LogPath -Reason 'PRE_RESET_STACK_IDENTITY_INVALID' -PreIdentity $preIdentity -PostIdentity $null -Capture $null
      throw 'CONNECT_WORKFLOWS_CW2_BASELINE_PRE_RESET_IDENTITY_FAILED'
    }
    # CW2_BASELINE_RESET_FAILURE_PATH_BEGIN
    try {
      # CW2_BASELINE_RESET_CAPTURE_BEGIN
      $resetCapture = Invoke-Cw2CapturedProcess -Stage 'baseline-archived-reset' -LogPath $LogPath -Executable $Supabase -Arguments '--profile supabase db reset --local --no-seed --yes' -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 300000 -DrainTimeoutMilliseconds 30000 -WorkingDirectory $resolvedTemp
      # CW2_BASELINE_RESET_CAPTURE_END
      Write-Cw2CaptureReplay $resetCapture
      [void](Assert-Cw2CaptureExitZero $resetCapture 'CONNECT_WORKFLOWS_CW2_BASELINE_RESET_FAILED')
    } catch {
      $primaryFailure = $_.Exception
      $postIdentityFailure = $null
      try { $postIdentity = Get-Cw2BaselineStackIdentity -Phase 'post-reset-failed' -LogPath $LogPath -DockerExecutable $DockerExecutable -WorkingDirectory $resolvedTemp }
      catch { $postIdentityFailure = $_.Exception.ToString() }
      [void](Invoke-Cw2BaselineResetFailure -ResetFailed $true -PrimaryFailure $primaryFailure -LogPath $LogPath -Reason 'BASELINE_RESET_NONZERO_OR_CAPTURE_FAILURE' -PreIdentity $preIdentity -PostIdentity $postIdentity -Capture $resetCapture -PostIdentityFailure $postIdentityFailure)
    }
    # CW2_BASELINE_RESET_FAILURE_PATH_END
    $postIdentity = Get-Cw2BaselineStackIdentity -Phase 'post-reset' -LogPath $LogPath -DockerExecutable $DockerExecutable -WorkingDirectory $resolvedTemp
    if (-not $postIdentity.Valid) {
      Write-Cw2BaselineRecoveryRequired -LogPath $LogPath -Reason 'POST_RESET_STACK_IDENTITY_INVALID' -PreIdentity $preIdentity -PostIdentity $postIdentity -Capture $resetCapture
      throw 'CONNECT_WORKFLOWS_CW2_BASELINE_POST_RESET_IDENTITY_FAILED'
    }
    Write-Cw2DiagnosticRecord -LogPath $LogPath -Record ([ordered]@{ event='baseline_archived_reset_pass'; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); stage='baseline-archived-reset'; expected_project_id=$project; expected_container=$db; reset_exit_code=$resetCapture.NativeExitCode; reset_stdout=$resetCapture.StdoutPath; reset_stderr=$resetCapture.StderrPath; pre_stack_identity=$preIdentity.ObservedInspect; post_stack_identity=$postIdentity.ObservedInspect; migration_baseline='ABSENT' })
    Write-Output 'CONNECT_WORKFLOWS_CW2_BASELINE_ARCHIVED_RESET_CAPTURE_PASS'
    $baseline = Invoke-Cw2Sql @'
select md5(
  pg_get_functiondef('public.mark_program_pass_applied(uuid,uuid,uuid,date,numeric,jsonb,uuid,boolean)'::regprocedure)
  || pg_get_functiondef('public.protect_inventory_product_unit()'::regprocedure)
  || pg_get_viewdef('public.inventory_on_hand'::regclass,true)
  || pg_get_viewdef('public.program_application_products'::regclass,true)
);
select coalesce(to_regclass('public.program_inventory_matches')::text,'ABSENT');
'@
    $migrationSql = Get-Content -Raw -Encoding UTF8 -LiteralPath $migrationPath
    $probe = "begin;`n$migrationSql`ndo `$cw2_apply`$ begin if to_regclass('public.program_inventory_matches') is null then raise exception 'CW2 migration table missing'; end if; end `$cw2_apply`$;`nrollback;"
    [void](Invoke-Cw2Sql $probe)
    $rolledBack = Invoke-Cw2Sql @'
select md5(
  pg_get_functiondef('public.mark_program_pass_applied(uuid,uuid,uuid,date,numeric,jsonb,uuid,boolean)'::regprocedure)
  || pg_get_functiondef('public.protect_inventory_product_unit()'::regprocedure)
  || pg_get_viewdef('public.inventory_on_hand'::regclass,true)
  || pg_get_viewdef('public.program_application_products'::regclass,true)
);
select coalesce(to_regclass('public.program_inventory_matches')::text,'ABSENT');
'@
    if ($baseline -cne $rolledBack -or $rolledBack -notmatch '(?m)^ABSENT$') { throw 'CONNECT_WORKFLOWS_CW2_MIGRATION_ROLLBACK_DRIFTED' }
    Write-Output 'CONNECT_WORKFLOWS_CW2_MIGRATION_ROLLBACK_PASS'
  } finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
    if (Test-Path -LiteralPath $resolvedTemp) { Remove-Item -LiteralPath $resolvedTemp -Recurse -Force }
  }
}

Assert-Cw2Contract
if ($DiagnosticSelfTest) { Invoke-Cw2DiagnosticSelfTest; exit 0 }
if ($StaticOnly) {
  if (-not $Proof005Child) { Invoke-Cw2Proof005OuterSelfTest (Get-Content -Raw -LiteralPath $runnerPath) }
  exit 0
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'CONNECT_WORKFLOWS_CW2_DISPOSABLE_REQUIRES_DOCKER' }
if (-not $BaselineResetOnly -and -not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'CONNECT_WORKFLOWS_CW2_DISPOSABLE_REQUIRES_NPX' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }
$dockerExe = (Get-Command docker.exe -CommandType Application -ErrorAction Stop).Source
$diagnosticLog = New-Cw2DiagnosticLog 'disposable'
Write-Host "CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_LOG:$diagnosticLog"
$runFailure = $null

Push-Location $root
try {
  # CW2_BASELINE_RESET_ONLY_BEGIN
  if ($BaselineResetOnly) {
    Write-Cw2DiagnosticRecord -LogPath $diagnosticLog -Record ([ordered]@{ event='baseline_archived_reset_only_started'; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); expected_project_id=$project; expected_container=$db })
    Assert-Cw2MigrationRollback $supabase $dockerExe $diagnosticLog
    Write-Cw2DiagnosticRecord -LogPath $diagnosticLog -Record ([ordered]@{ event='baseline_archived_reset_only_pass'; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); expected_project_id=$project; expected_container=$db })
    Write-Output 'CONNECT_WORKFLOWS_CW2_BASELINE_RESET_ONLY_PASS'
    return
  }
  # CW2_BASELINE_RESET_ONLY_END
  if (@(docker ps --format '{{.Names}}') -notcontains $db) { & $supabase --profile supabase start; if ($LASTEXITCODE -ne 0) { throw 'CONNECT_WORKFLOWS_CW2_LOCAL_START_FAILED' } }
  Assert-Cw2MigrationRollback $supabase $dockerExe $diagnosticLog
  Enter-MapleSeasonCredential
  foreach ($viewport in @('desktop','phone')) {
    Reset-Cw2 $supabase
    $boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $project -ExpectedContainer $db
    $env:VITE_LOCAL_SUPABASE_PROJECT_REF='farmrxlocalsimplicity2027'
    $env:VITE_LOCAL_SUPABASE_URL=$boundary.ApiUrl
    $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY=$boundary.PublishableKey
    $env:FARMRX_CW2_VIEWPORT=$viewport
    $env:FARMRX_CC_CLIENT_INSTANT='2027-07-07T13:20:00-05:00'
    $token = Get-Cw2AccessToken $boundary.PublishableKey
    $action = {
      $stage = 'no-due-startup-write'
      try {
        Assert-Cw2NoDueStartupWrite -ApiUrl $boundary.ApiUrl -PublishableKey $boundary.PublishableKey -AccessToken $token -Viewport $viewport
        $stage = 'browser'
        Write-Host "CONNECT_WORKFLOWS_CW2_ACTION_STAGE:${viewport}:$stage"
        $priorErrorActionPreference = $ErrorActionPreference
        try { $ErrorActionPreference='Continue'; $browserOutput=@(& npx playwright test --config playwright.connect-workflows-cw2.config.ts 2>&1); $browserExit=$LASTEXITCODE }
        finally { $ErrorActionPreference=$priorErrorActionPreference }
        $browserOutput | Out-Host
        $browserText = [string]::Join("`n",[string[]]$browserOutput)
        if ($browserExit -ne 0 -or $browserText -match '(?m)^\s*\d+ failed\s*$') { docker logs $db --tail 80 2>&1 | Out-Host; throw "CONNECT_WORKFLOWS_CW2_BROWSER_FAILED:$viewport`:exit=$browserExit" }
        Write-Host "CONNECT_WORKFLOWS_CW2_PLAYWRIGHT_EXIT:${viewport}:$browserExit"
        $stage='database-assertions'
        Write-Host "CONNECT_WORKFLOWS_CW2_ACTION_STAGE:${viewport}:$stage"
        # CW2-CREDENTIAL-HANDOFF native base verify begin.
        $verifyBytes = [IO.File]::ReadAllBytes($verify)
        $baseDockerArguments = "exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off"
        $baseCapture = Invoke-Cw2CapturedProcess -Stage "${viewport}:$stage`:base" -LogPath $diagnosticLog -Executable $dockerExe -Arguments $baseDockerArguments -StdinBytes $verifyBytes -TimeoutMilliseconds 120000
        Write-Cw2CaptureReplay $baseCapture
        [void](Assert-Cw2CaptureSuccess $baseCapture 'CONNECT_WORKFLOWS_CW2_BASE_SQL_PASS')
        # CW2-CREDENTIAL-HANDOFF native base verify end.
        # CW2-CREDENTIAL-HANDOFF native fixture verify begin.
        $fixtureBytes = [IO.File]::ReadAllBytes($concurrencyFixtureVerify)
        if((Get-Cw2Sha256 $fixtureBytes) -cne $concurrencyFixtureVerifySha256){throw 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_SQL_BYTES_CHANGED'}
        $fixtureDockerArguments = "exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off"
        $fixtureCapture = Invoke-Cw2CapturedProcess -Stage "${viewport}:$stage`:fixture" -LogPath $diagnosticLog -Executable $dockerExe -Arguments $fixtureDockerArguments -StdinBytes $fixtureBytes -TimeoutMilliseconds 120000
        Write-Cw2CaptureReplay $fixtureCapture
        [void](Assert-Cw2CaptureSuccess $fixtureCapture 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_BOUNDARY_PASS')
        [void](Assert-Cw2CaptureSuccess $fixtureCapture 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_PASS')
        # CW2-CREDENTIAL-HANDOFF native fixture verify end.
        return $true
      } catch {
        $primaryFailure = $_
        try { Write-Cw2DiagnosticRecord -LogPath $diagnosticLog -Record ([ordered]@{ event='action_failed'; stage="${viewport}:$stage"; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); primary_exception=$primaryFailure.Exception.ToString() }) }
        catch { throw [Exception]::new("CONNECT_WORKFLOWS_CW2_ACTION_LOG_FAILED:$viewport`:$stage`nPRIMARY_EXCEPTION:$($primaryFailure.Exception.ToString())`nLOG_EXCEPTION:$($_.Exception.ToString())",$primaryFailure.Exception) }
        throw [Exception]::new("CONNECT_WORKFLOWS_CW2_ACTION_FAILED:$viewport`:$stage`nPRIMARY_EXCEPTION:$($primaryFailure.Exception.ToString())",$primaryFailure.Exception)
      }
    }.GetNewClosure()
    $clockResult=@(Invoke-HarvestRidgeClockPhase -Root $root -Phase "cw2-$viewport" -FrozenInstant '2027-07-07 18:20:00+00:00' -ApiUrl $boundary.ApiUrl -PublishableKey $boundary.PublishableKey -AccessToken $token -ProofFarmId '27010000-0000-4000-8000-000000000005' -ProofFarmName 'Cedar Creek' -Action $action)
    if ($clockResult[-1] -ne $true) { throw "CONNECT_WORKFLOWS_CW2_CLOCK_PHASE_FAILED:$viewport" }
    # The concurrency proof uses PostgreSQL lock/statement timeouts and bounded
    # sleeps. Run it only after the fixed-clock phase restores the ordinary
    # database clock; the browser and business assertions above remain frozen.
    # CW2-CREDENTIAL-HANDOFF native verify begin.
    $concurrencyBytes = [IO.File]::ReadAllBytes($concurrencyVerify)
    if((Get-Cw2Sha256 $concurrencyBytes) -cne $concurrencyVerifySha256){throw 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_SQL_BYTES_CHANGED'}
    $safeDockerArguments = "exec -i $db psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -P pager=off"
    $capture = Invoke-Cw2CapturedProcess -Stage "${viewport}:ordinary-clock:concurrency" -LogPath $diagnosticLog -Executable $dockerExe -Arguments $safeDockerArguments -StdinBytes $concurrencyBytes -TimeoutMilliseconds 120000
    Write-Cw2CaptureReplay $capture
    [void](Assert-Cw2CaptureSuccess $capture 'CONNECT_WORKFLOWS_CW2_SQL_PASS')
    # CW2-CREDENTIAL-HANDOFF native verify end.
    $token=$null; $boundary=$null
  }
  Write-Output 'CONNECT_WORKFLOWS_CW2_DISPOSABLE_PASS'
} catch {
  $runFailure = $_
  throw
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:FARMRX_CW2_VIEWPORT -ErrorAction SilentlyContinue
  Remove-Item Env:FARMRX_CC_CLIENT_INSTANT -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  $token=$null; $boundary=$null
  Pop-Location
  $finalStatus = if ($null -eq $runFailure) { 'pass' } else { 'failed' }
  $finalException = if ($null -eq $runFailure) { $null } else { $runFailure.Exception.ToString() }
  try { Write-Cw2DiagnosticRecord -LogPath $diagnosticLog -Record ([ordered]@{ event='run_finished'; status=$finalStatus; timestamp_utc=[DateTimeOffset]::UtcNow.ToString('o'); primary_exception=$finalException }) }
  catch {
    if ($null -eq $runFailure) { throw }
    Write-Warning "CONNECT_WORKFLOWS_CW2_FINAL_LOG_FAILED`nPRIMARY_EXCEPTION:$finalException`nLOG_EXCEPTION:$($_.Exception.ToString())"
  }
}
