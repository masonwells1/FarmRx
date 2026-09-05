$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'maple-season-browser.ps1')

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

function Assert-MapleBrowserOwnershipContract([string]$PowerShellText, [string]$JobText) {
  $create = $JobText.IndexOf('if (!CreateProcess(')
  $assign = $JobText.IndexOf('if (!AssignProcessToJobObject(', $create)
  $verify = $JobText.IndexOf('if (!IsProcessInJob(', $assign)
  $resume = $JobText.IndexOf('if (ResumeThread(', $verify)
  Assert-True ($create -ge 0 -and $assign -gt $create -and $verify -gt $assign -and $resume -gt $verify) 'Browser root is not created suspended, assigned, verified, and resumed in exact order.'
  Assert-True $JobText.Contains('CreateSuspended | CreateNoWindow') 'Browser root no longer starts suspended.'
  Assert-True $JobText.Contains('limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;') 'Owned browser job lost its host-death cleanup backstop.'
  Assert-True $JobText.Contains('error != ErrorMoreData') 'Owned browser job PID enumeration no longer handles a full buffer fail-closed.'
  Assert-True ($JobText.Contains('private struct STARTUPINFOEX') -and $JobText.Contains('ProcThreadAttributeHandleList = new UIntPtr(0x00020002)')) 'Browser launch does not use the pointer-sized STARTUPINFOEX handle-list contract.'
  Assert-True ($JobText.Contains('InitializeProcThreadAttributeList(') -and $JobText.Contains('UpdateProcThreadAttribute(') -and $JobText.Contains('DeleteProcThreadAttributeList(attributeList)')) 'Browser launch does not initialize, update, and delete its exact process attribute list.'
  Assert-True ($JobText.Contains('Marshal.WriteIntPtr(inheritedHandleList, 0 * IntPtr.Size, stdinHandle)') -and $JobText.Contains('Marshal.WriteIntPtr(inheritedHandleList, 1 * IntPtr.Size, stdoutHandle)') -and $JobText.Contains('Marshal.WriteIntPtr(inheritedHandleList, 2 * IntPtr.Size, stderrHandle)') -and $JobText.Contains('new UIntPtr(checked((uint)inheritedHandleBytes))')) 'Browser handle list is not exactly stdin/stdout/stderr with pointer-sized storage.'
  Assert-True ($JobText.Contains('CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent') -and $JobText.Contains('ref STARTUPINFOEX startupInfo')) 'Browser launch does not pass STARTUPINFOEX with the mandatory extended creation flag.'
  Assert-True ($JobText.Contains('Marshal.FreeHGlobal(inheritedHandleList)') -and $JobText.Contains('Marshal.FreeHGlobal(attributeList)')) 'Browser launch does not free every unmanaged handle-list allocation.'
  Assert-True ($JobText.Contains('GetSuspendedProcessCleanupFailure(') -and $JobText.Contains('if (!terminate(process, 125))') -and $JobText.Contains('if (waitResult == WaitFailed)') -and $JobText.Contains('if (waitResult == WaitTimeout)')) 'A failed suspended launch can lose termination or wait failure evidence.'
  Assert-True $JobText.Contains('new Exception[] { primaryFailure, cleanupFailure }') 'Assignment failure and suspended-root cleanup failure are not preserved together.'

  $graceful = $PowerShellText.IndexOf('$gracefulDeadline = [DateTime]::UtcNow.AddMilliseconds($GracefulMilliseconds)')
  $identity = $PowerShellText.IndexOf('$identitySnapshot = @(Get-MapleSeasonJobIdentitySnapshot', $graceful)
  $recheck = $PowerShellText.IndexOf('Assert-MapleSeasonJobIdentitySnapshot', $identity)
  $terminate = $PowerShellText.IndexOf('$Job.Terminate(125)', $recheck)
  $port = $PowerShellText.IndexOf('$portDeadline = [DateTime]::UtcNow.AddMilliseconds($ForcedMilliseconds)', $terminate)
  Assert-True ($graceful -ge 0 -and $identity -gt $graceful -and $recheck -gt $identity -and $terminate -gt $recheck -and $port -gt $terminate) 'Browser cleanup does not wait, capture identity, re-check, terminate, and prove port release in exact order.'
  Assert-True ($PowerShellText.Contains('Get-NetTCPConnection -State Listen -ErrorAction Stop') -and $PowerShellText.Contains('[int]$_.LocalPort -eq $Port')) 'Browser cleanup no longer scopes its fail-closed port proof to the exact live LISTEN state.'
  $listenerStart = $PowerShellText.IndexOf('function Get-MapleSeasonBrowserListeners')
  $cleanupStart = $PowerShellText.IndexOf('function Stop-MapleSeasonOwnedBrowserJob', $listenerStart)
  $listenerBody = if ($listenerStart -ge 0 -and $cleanupStart -gt $listenerStart) { $PowerShellText.Substring($listenerStart,$cleanupStart-$listenerStart) } else { '' }
  Assert-True ($listenerBody.Contains('-ErrorAction Stop') -and $listenerBody.Contains('throw [InvalidOperationException]::new(') -and $listenerBody.Contains('Maple browser listener inspection failed for governed port $Port.')) 'Browser listener inspection does not fail closed on provider/query errors.'
  Assert-True (-not $listenerBody.Contains('SilentlyContinue')) 'Browser listener inspection suppresses provider/query errors.'
  Assert-True $PowerShellText.Contains('Stop-MapleSeasonOwnedBrowserJob -Job $job -Port $port -Scenario $Scenario') 'Browser execution no longer invokes exact cleanup from its finally path.'
  Assert-True $PowerShellText.Contains('$job.Dispose()') 'Browser execution no longer closes its run-owned job in finally.'
  $transcriptStart = $PowerShellText.IndexOf('function Write-MapleSeasonBrowserTranscript')
  $invokeStart = $PowerShellText.IndexOf('function Invoke-MapleSeasonBrowserProof', $transcriptStart)
  $transcriptBody = if ($transcriptStart -ge 0 -and $invokeStart -gt $transcriptStart) { $PowerShellText.Substring($transcriptStart,$invokeStart-$transcriptStart) } else { '' }
  Assert-True ($transcriptBody.Contains('[IO.File]::ReadAllLines($Path)') -and $transcriptBody.Contains('$line | Out-Host')) 'Browser transcript is not retained and replayed through the Host stream.'
  Assert-True (-not $transcriptBody.Contains('Write-Output')) 'Browser transcript reintroduced success-pipeline output.'
  $exitGuard = $PowerShellText.IndexOf('if ([int]$exitCode -ne 0)', $invokeStart)
  $success = $PowerShellText.IndexOf('return $true', $exitGuard)
  $outerFinally = $PowerShellText.IndexOf('} finally {', $success)
  Assert-True ($exitGuard -ge 0 -and $success -gt $exitGuard -and $outerFinally -gt $success) 'Browser success path does not return exactly one scalar true after every failure guard.'
  Assert-True (-not $PowerShellText.Contains('taskkill.exe')) 'Browser cleanup reintroduced broad taskkill tree termination.'
  Assert-True (-not $PowerShellText.Contains('Stop-Process')) 'Browser cleanup reintroduced PID/name-based Stop-Process termination.'
}

$helperText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'maple-season-browser.ps1')
$jobText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'maple-season-browser-job.cs')
Assert-MapleBrowserOwnershipContract $helperText $jobText
$mutations = @(
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('CreateSuspended | CreateNoWindow','CreateNoWindow') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('if (!AssignProcessToJobObject(','if (false && !AssignProcessToJobObject(') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('if (!IsProcessInJob(','if (false && !IsProcessInJob(') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;','limits.BasicLimitInformation.LimitFlags = 0;') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('error != ErrorMoreData','false') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('private struct STARTUPINFOEX','private struct LEGACY_STARTUPINFO') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('ProcThreadAttributeHandleList = new UIntPtr(0x00020002)','ProcThreadAttributeHandleList = UIntPtr.Zero') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('UpdateProcThreadAttribute(','UpdateProcThreadAttributeRemoved(') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('DeleteProcThreadAttributeList(attributeList)','$null = attributeList') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('Marshal.WriteIntPtr(inheritedHandleList, 2 * IntPtr.Size, stderrHandle)','Marshal.WriteIntPtr(inheritedHandleList, 2 * IntPtr.Size, stdoutHandle)') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent','CreateSuspended | CreateNoWindow') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('ref STARTUPINFOEX startupInfo','ref STARTUPINFO startupInfo') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('Marshal.FreeHGlobal(inheritedHandleList)','$null = inheritedHandleList') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('if (!terminate(process, 125))','if (false)') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('if (waitResult == WaitFailed)','if (false)') },
  [pscustomobject]@{ PowerShell=$helperText; Job=$jobText.Replace('if (waitResult == WaitTimeout)','if (false)') },
  [pscustomobject]@{ PowerShell=$helperText.Replace('-ErrorAction Stop','-ErrorAction SilentlyContinue'); Job=$jobText },
  [pscustomobject]@{ PowerShell=$helperText.Replace('throw [InvalidOperationException]::new(','return @(); <#'); Job=$jobText },
  [pscustomobject]@{ PowerShell=$helperText.Replace('Assert-MapleSeasonJobIdentitySnapshot -Job $Job -Expected $identitySnapshot -Scenario $Scenario','$true | Out-Null'); Job=$jobText },
  [pscustomobject]@{ PowerShell=$helperText.Replace('$Job.Terminate(125)','$null = $Job'); Job=$jobText },
  [pscustomobject]@{ PowerShell=$helperText.Replace('Get-NetTCPConnection -State Listen -ErrorAction Stop','Get-NetTCPConnection -ErrorAction Stop'); Job=$jobText },
  [pscustomobject]@{ PowerShell=$helperText.Replace('Stop-MapleSeasonOwnedBrowserJob -Job $job -Port $port -Scenario $Scenario','$null = $job'); Job=$jobText },
  [pscustomobject]@{ PowerShell=$helperText.Replace('$job.Dispose()','$null = $job'); Job=$jobText },
  [pscustomobject]@{ PowerShell=$helperText.Replace('$line | Out-Host','Write-Output $line'); Job=$jobText },
  [pscustomobject]@{ PowerShell=$helperText.Replace('$line | Out-Host','$null = $line'); Job=$jobText },
  [pscustomobject]@{ PowerShell=$helperText.Replace('return $true','return'); Job=$jobText }
)
$mutationIndex = 0
foreach ($mutation in $mutations) {
  $mutationIndex++
  Assert-True ($mutation.PowerShell -cne $helperText -or $mutation.Job -cne $jobText) 'Browser ownership mutation did not alter the contract source.'
  $rejected = $false
  try { Assert-MapleBrowserOwnershipContract $mutation.PowerShell $mutation.Job } catch { $rejected = $true }
  Assert-True $rejected "Browser ownership/cleanup mutation $mutationIndex survived the contract guard."
}

$cleanupFaults = @{
  'terminate-false' = 'TerminateProcess failed while cleaning a suspended browser root.'
  'wait-failed' = 'WaitForSingleObject failed while cleaning a suspended browser root.'
  'wait-timeout' = 'Timed out waiting for a suspended browser root to terminate.'
}
foreach ($fault in $cleanupFaults.Keys) {
  $aggregate = $null
  try {
    [MapleSeasonOwnedJob]::ProbeAssignmentFailureCleanupForTest($fault)
  } catch {
    $candidate = $_.Exception
    while ($null -ne $candidate -and $candidate -isnot [AggregateException]) { $candidate = $candidate.InnerException }
    if ($candidate -is [AggregateException]) { $aggregate = $candidate }
  }
  Assert-True ($aggregate -is [AggregateException]) "Assignment cleanup fault $fault did not fail with preserved primary and cleanup evidence."
  Assert-True ($aggregate.InnerExceptions.Count -eq 2) "Assignment cleanup fault $fault did not preserve exactly two failures."
  Assert-True ($aggregate.InnerExceptions[0].Message -ceq 'AssignProcessToJobObject failed.') "Assignment cleanup fault $fault lost the primary assignment failure."
  Assert-True ($aggregate.InnerExceptions[1].Message -ceq $cleanupFaults[$fault]) "Assignment cleanup fault $fault lost its exact cleanup failure."
}

$listenerInspectionRefused = $false
try {
  Get-MapleSeasonBrowserListeners -Port 4288 -Query { param($port) throw "INJECTED_LISTENER_QUERY_FAILURE:$port" }
} catch {
  $listenerInspectionRefused = $_.Exception.Message -ceq 'Maple browser listener inspection failed for governed port 4288.' -and
    $null -ne $_.Exception.InnerException -and
    $_.Exception.InnerException.Message -ceq 'INJECTED_LISTENER_QUERY_FAILURE:4288'
}
Assert-True $listenerInspectionRefused 'Injected listener-provider failure was accepted as a free governed port.'

$timeoutPort = 4288
$unrelatedPort = 4289
$orphanPort = 4290
$priorPort = $env:FARMRX_SEASON_JANUARY_PORT
$priorTimeoutReady = $env:FARMRX_MAPLE_TIMEOUT_READY_FILE
$priorOrphanChild = $env:FARMRX_MAPLE_ORPHAN_CHILD
$priorOrphanReady = $env:FARMRX_MAPLE_ORPHAN_READY_FILE
$priorUnrelatedPort = $env:FARMRX_MAPLE_UNRELATED_PORT
$priorUnrelatedReady = $env:FARMRX_MAPLE_UNRELATED_READY_FILE
$priorOuterEvidence = $env:FARMRX_MAPLE_OUTER_EVIDENCE
$priorOuterExit = $env:FARMRX_MAPLE_OUTER_EXIT
$priorHelperRoot = $env:FARMRX_MAPLE_HELPER_ROOT
$priorOrphanRoot = $env:FARMRX_MAPLE_ORPHAN_ROOT
$priorSentinelHandle = $env:FARMRX_MAPLE_SENTINEL_HANDLE
$priorSentinelPath = $env:FARMRX_MAPLE_SENTINEL_PATH
$priorSentinelResult = $env:FARMRX_MAPLE_SENTINEL_RESULT
$priorSentinelProbe = $env:FARMRX_MAPLE_SENTINEL_PROBE_CS
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-maple-browser-ownership-{0}" -f [Guid]::NewGuid().ToString('N'))
$timeoutRunner = Join-Path $tempRoot 'timeout-root.js'
$timeoutReady = Join-Path $tempRoot 'timeout-ready.txt'
$orphanRoot = Join-Path $tempRoot 'orphan-root.js'
$orphanChild = Join-Path $tempRoot 'orphan-child.js'
$orphanReady = Join-Path $tempRoot 'orphan-ready.txt'
$unrelatedRunner = Join-Path $tempRoot 'unrelated.js'
$unrelatedReady = Join-Path $tempRoot 'unrelated-ready.txt'
$outerProbe = Join-Path $tempRoot 'outer-probe.ps1'
$outerEvidence = Join-Path $tempRoot 'outer-evidence.json'
$outerExit = Join-Path $tempRoot 'outer-exit.txt'
$hostTranscript = Join-Path $tempRoot 'host-transcript.txt'
$sentinelPath = Join-Path $tempRoot 'unrelated-inheritable-sentinel.txt'
$sentinelProbeCs = Join-Path $tempRoot 'sentinel-handle-probe.cs'
$sentinelChild = Join-Path $tempRoot 'sentinel-child.ps1'
$sentinelResult = Join-Path $tempRoot 'sentinel-result.txt'
$sentinelStdout = Join-Path $tempRoot 'sentinel-stdout.log'
$sentinelStderr = Join-Path $tempRoot 'sentinel-stderr.log'
$unrelatedProcess = $null
$outerProcess = $null
$sentinelStream = $null
$sentinelJob = $null

try {
  foreach ($port in @($timeoutPort,$unrelatedPort,$orphanPort)) {
    if (@(Get-MapleSeasonBrowserListeners -Port $port).Count -ne 0) {
      throw "Browser ownership regression requires unused loopback port $port."
    }
  }
  New-Item -ItemType Directory -Path $tempRoot -ErrorAction Stop | Out-Null
  Set-Content -LiteralPath $sentinelProbeCs -Encoding UTF8 -NoNewline -Value @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class MapleSeasonSentinelHandleProbe
{
    private const uint HandleFlagInherit = 0x00000001;

    public static void MakeInheritable(long rawHandle)
    {
        if (!SetHandleInformation(new IntPtr(rawHandle), HandleFlagInherit, HandleFlagInherit))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SetHandleInformation failed.");
    }

    public static bool IsExactFile(long rawHandle, string expectedPath)
    {
        var buffer = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(new IntPtr(rawHandle), buffer, (uint)buffer.Capacity, 0);
        if (length == 0 || length >= buffer.Capacity) return false;
        string actual = buffer.ToString();
        if (actual.StartsWith(@"\\?\", StringComparison.Ordinal)) actual = actual.Substring(4);
        return String.Equals(Path.GetFullPath(actual), Path.GetFullPath(expectedPath), StringComparison.OrdinalIgnoreCase);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint pathLength, uint flags);
}
'@
  Set-Content -LiteralPath $sentinelChild -Encoding UTF8 -NoNewline -Value @'
$ErrorActionPreference='Stop'
Add-Type -Path $env:FARMRX_MAPLE_SENTINEL_PROBE_CS -ErrorAction Stop
$inherited=[MapleSeasonSentinelHandleProbe]::IsExactFile([long]$env:FARMRX_MAPLE_SENTINEL_HANDLE,$env:FARMRX_MAPLE_SENTINEL_PATH)
[Console]::Out.WriteLine('MAPLE_SENTINEL_STDOUT_PASS')
[Console]::Error.WriteLine('MAPLE_SENTINEL_STDERR_PASS')
[IO.File]::WriteAllText($env:FARMRX_MAPLE_SENTINEL_RESULT, $(if($inherited){'inherited'}else{'not-inherited'}), [Text.UTF8Encoding]::new($false))
if($inherited){exit 41}
exit 0
'@
  Set-Content -LiteralPath $timeoutRunner -Encoding Ascii -NoNewline -Value @'
const fs = require('fs')
const net = require('net')
const server = net.createServer()
server.listen(Number(process.env.FARMRX_SEASON_JANUARY_PORT), '127.0.0.1', () => fs.writeFileSync(process.env.FARMRX_MAPLE_TIMEOUT_READY_FILE, 'ready'))
setInterval(() => {}, 1000)
'@
  Set-Content -LiteralPath $orphanChild -Encoding Ascii -NoNewline -Value @'
const fs = require('fs')
const net = require('net')
const server = net.createServer()
console.error('MAPLE_BROWSER_STDERR_RETAINED')
server.listen(Number(process.env.FARMRX_SEASON_JANUARY_PORT), '127.0.0.1', () => fs.writeFileSync(process.env.FARMRX_MAPLE_ORPHAN_READY_FILE, 'ready'))
setInterval(() => {}, 1000)
'@
  Set-Content -LiteralPath $orphanRoot -Encoding Ascii -NoNewline -Value @'
const fs = require('fs')
const { spawn } = require('child_process')
console.log('MAPLE_BROWSER_STDOUT_RETAINED')
const child = spawn(process.execPath, [process.env.FARMRX_MAPLE_ORPHAN_CHILD], { detached: true, stdio: 'inherit', env: process.env })
child.unref()
const deadline = Date.now() + 5000
const timer = setInterval(() => {
  if (fs.existsSync(process.env.FARMRX_MAPLE_ORPHAN_READY_FILE)) { clearInterval(timer); process.exit(0) }
  if (Date.now() > deadline) { clearInterval(timer); process.exit(31) }
}, 25)
'@
  Set-Content -LiteralPath $unrelatedRunner -Encoding Ascii -NoNewline -Value @'
const fs = require('fs')
const net = require('net')
const server = net.createServer()
server.listen(Number(process.env.FARMRX_MAPLE_UNRELATED_PORT), '127.0.0.1', () => fs.writeFileSync(process.env.FARMRX_MAPLE_UNRELATED_READY_FILE, 'ready'))
setInterval(() => {}, 1000)
'@
  Set-Content -LiteralPath $outerProbe -Encoding UTF8 -NoNewline -Value @'
$ErrorActionPreference='Stop'
$code=1
try {
  . (Join-Path $env:FARMRX_MAPLE_HELPER_ROOT 'scripts/maple-season-browser.ps1')
  $env:FARMRX_SEASON_JANUARY_PORT='4290'
  $result=@(Invoke-MapleSeasonBrowserProof -Root $env:FARMRX_MAPLE_HELPER_ROOT -Config 'playwright.season.config.ts' -Scenario 'Maple outer finalization regression' -TimeoutMilliseconds 15000 -RunnerFile $env:FARMRX_MAPLE_ORPHAN_ROOT)
  if($result.Count-ne 1-or$result[0]-isnot[bool]-or$result[0]-ne$true){throw 'Outer finalization browser result was not exact scalar true.'}
  [IO.File]::WriteAllText($env:FARMRX_MAPLE_OUTER_EVIDENCE,'{"status":"pass"}',[Text.UTF8Encoding]::new($false))
  $code=0
} finally {
  [IO.File]::WriteAllText($env:FARMRX_MAPLE_OUTER_EXIT,[string]$code,[Text.UTF8Encoding]::new($false))
}
exit $code
'@

  [IO.File]::WriteAllText($sentinelPath,'sentinel',[Text.UTF8Encoding]::new($false))
  Add-Type -Path $sentinelProbeCs -ErrorAction Stop
  $sentinelStream = [IO.File]::Open($sentinelPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  $sentinelRawHandle = $sentinelStream.SafeFileHandle.DangerousGetHandle()
  [MapleSeasonSentinelHandleProbe]::MakeInheritable($sentinelRawHandle.ToInt64())
  $env:FARMRX_MAPLE_SENTINEL_HANDLE = [string]$sentinelRawHandle.ToInt64()
  $env:FARMRX_MAPLE_SENTINEL_PATH = $sentinelPath
  $env:FARMRX_MAPLE_SENTINEL_RESULT = $sentinelResult
  $env:FARMRX_MAPLE_SENTINEL_PROBE_CS = $sentinelProbeCs
  $sentinelArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $sentinelChild
  $sentinelJob = [MapleSeasonOwnedJob]::Start(
    (Get-Command powershell.exe -ErrorAction Stop).Source,
    $sentinelArguments,
    $root,
    $sentinelStdout,
    $sentinelStderr)
  Assert-True ($sentinelJob.WaitForExit(30000)) 'Sentinel handle-list probe did not exit within its bounded limit.'
  Assert-True ($sentinelJob.GetExitCode() -eq 0) 'Sentinel handle-list probe inherited the unrelated sentinel or failed.'
  $sentinelJob.Dispose()
  $sentinelJob = $null
  Assert-True ((Get-Content -Raw -LiteralPath $sentinelResult) -ceq 'not-inherited') 'Child retained the exact unrelated inheritable sentinel handle.'
  Assert-True ((Get-Content -Raw -LiteralPath $sentinelStdout).Contains('MAPLE_SENTINEL_STDOUT_PASS')) 'Whitelisted child stdout handle was unavailable.'
  Assert-True ((Get-Content -Raw -LiteralPath $sentinelStderr).Contains('MAPLE_SENTINEL_STDERR_PASS')) 'Whitelisted child stderr handle was unavailable.'

  $env:FARMRX_MAPLE_UNRELATED_PORT = [string]$unrelatedPort
  $env:FARMRX_MAPLE_UNRELATED_READY_FILE = $unrelatedReady
  $unrelatedProcess = Start-Process -FilePath (Get-Command node.exe -ErrorAction Stop).Source -ArgumentList @($unrelatedRunner) -PassThru -WindowStyle Hidden
  $unrelatedDeadline = [DateTime]::UtcNow.AddSeconds(5)
  while (-not (Test-Path -LiteralPath $unrelatedReady) -and [DateTime]::UtcNow -lt $unrelatedDeadline) { Start-Sleep -Milliseconds 25 }
  Assert-True (Test-Path -LiteralPath $unrelatedReady) 'Unrelated-listener control process did not become ready.'

  $env:FARMRX_SEASON_JANUARY_PORT = [string]$timeoutPort
  $env:FARMRX_MAPLE_TIMEOUT_READY_FILE = $timeoutReady
  $started = [Diagnostics.Stopwatch]::StartNew()
  $timedOut = $false
  try {
    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple timeout regression' -TimeoutMilliseconds 3000 -RunnerFile $timeoutRunner
  } catch {
    $timedOut = $_.Exception.Message -ceq 'Maple timeout regression browser scenario exceeded its bounded process limit after verified cleanup.'
  }
  $started.Stop()
  Assert-True $timedOut 'Browser timeout regression did not reach the verified-timeout result.'
  Assert-True (Test-Path -LiteralPath $timeoutReady) 'Browser timeout regression never created its owned listener.'
  Assert-True ($started.Elapsed.TotalSeconds -lt 20) 'Browser timeout cleanup exceeded its bounded regression window.'
  Assert-True (@(Get-MapleSeasonBrowserListeners -Port $timeoutPort).Count -eq 0) 'Browser timeout cleanup left its governed port listening.'
  Assert-True (-not $unrelatedProcess.HasExited) 'Browser timeout cleanup terminated an unrelated process.'
  Assert-True (@(Get-MapleSeasonBrowserListeners -Port $unrelatedPort).Count -eq 1) 'Browser timeout cleanup disturbed the unrelated listener.'

  $env:FARMRX_SEASON_JANUARY_PORT = [string]$orphanPort
  $env:FARMRX_MAPLE_ORPHAN_CHILD = $orphanChild
  $env:FARMRX_MAPLE_ORPHAN_READY_FILE = $orphanReady
  $orphanStarted = [Diagnostics.Stopwatch]::StartNew()
  Start-Transcript -LiteralPath $hostTranscript -Force | Out-Null
  try {
    $orphanResult = @(Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple orphan descendant regression' -TimeoutMilliseconds 15000 -RunnerFile $orphanRoot)
  } finally {
    Stop-Transcript | Out-Null
  }
  $orphanStarted.Stop()
  Assert-True ($orphanResult.Count -eq 1 -and $orphanResult[0] -is [bool] -and $orphanResult[0] -eq $true) 'Browser success contributed anything other than exact scalar true to the success pipeline.'
  $retainedTranscript = [IO.File]::ReadAllText($hostTranscript)
  Assert-True ($retainedTranscript.Contains('MAPLE_BROWSER_STDOUT_RETAINED') -and $retainedTranscript.Contains('MAPLE_BROWSER_STDERR_RETAINED')) 'Browser stdout/stderr transcript content was suppressed or lost.'
  Assert-True (Test-Path -LiteralPath $orphanReady) 'Orphan regression never created the detached descendant listener.'
  Assert-True ($orphanStarted.Elapsed.TotalSeconds -lt 20) 'Detached-descendant cleanup exceeded its bounded regression window.'
  Assert-True (@(Get-MapleSeasonBrowserListeners -Port $orphanPort).Count -eq 0) 'Detached-descendant cleanup left its governed port listening.'
  Assert-True (-not $unrelatedProcess.HasExited) 'Detached-descendant cleanup terminated an unrelated process.'

  Remove-Item -LiteralPath $orphanReady -Force
  $env:FARMRX_MAPLE_HELPER_ROOT = $root
  $env:FARMRX_MAPLE_ORPHAN_ROOT = $orphanRoot
  $env:FARMRX_MAPLE_OUTER_EVIDENCE = $outerEvidence
  $env:FARMRX_MAPLE_OUTER_EXIT = $outerExit
  $outerStart = New-Object System.Diagnostics.ProcessStartInfo
  $outerStart.FileName = (Get-Command powershell.exe -ErrorAction Stop).Source
  $outerStart.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $outerProbe
  $outerStart.UseShellExecute = $false
  $outerStart.CreateNoWindow = $true
  $outerProcess = New-Object System.Diagnostics.Process
  $outerProcess.StartInfo = $outerStart
  Assert-True $outerProcess.Start() 'Outer finalization regression process did not start.'
  Assert-True ($outerProcess.WaitForExit(30000)) 'Outer finalization regression hung instead of writing evidence and exit state.'
  $outerNativeExit = [int]$outerProcess.ExitCode
  if ($outerNativeExit -ne 0) {
    $outerExitState = if (Test-Path -LiteralPath $outerExit) { [IO.File]::ReadAllText($outerExit) } else { '<missing exit file>' }
    throw "Outer finalization regression exited nonzero. native-exit=$outerNativeExit exit-file=$outerExitState"
  }
  Assert-True ((Get-Content -Raw -LiteralPath $outerEvidence) -ceq '{"status":"pass"}') 'Outer finalization regression did not write exact evidence.'
  Assert-True ((Get-Content -Raw -LiteralPath $outerExit) -ceq '0') 'Outer finalization regression did not write its exact exit file.'
  Assert-True (@(Get-MapleSeasonBrowserListeners -Port $orphanPort).Count -eq 0) 'Outer finalization regression left its governed port listening.'
  Assert-True (-not $unrelatedProcess.HasExited) 'Outer finalization regression terminated an unrelated process.'
  Write-Output 'MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_PASS'
} finally {
  foreach ($pair in @(
    @('FARMRX_SEASON_JANUARY_PORT',$priorPort),
    @('FARMRX_MAPLE_TIMEOUT_READY_FILE',$priorTimeoutReady),
    @('FARMRX_MAPLE_ORPHAN_CHILD',$priorOrphanChild),
    @('FARMRX_MAPLE_ORPHAN_READY_FILE',$priorOrphanReady),
    @('FARMRX_MAPLE_UNRELATED_PORT',$priorUnrelatedPort),
    @('FARMRX_MAPLE_UNRELATED_READY_FILE',$priorUnrelatedReady),
    @('FARMRX_MAPLE_OUTER_EVIDENCE',$priorOuterEvidence),
    @('FARMRX_MAPLE_OUTER_EXIT',$priorOuterExit),
    @('FARMRX_MAPLE_HELPER_ROOT',$priorHelperRoot),
    @('FARMRX_MAPLE_ORPHAN_ROOT',$priorOrphanRoot),
    @('FARMRX_MAPLE_SENTINEL_HANDLE',$priorSentinelHandle),
    @('FARMRX_MAPLE_SENTINEL_PATH',$priorSentinelPath),
    @('FARMRX_MAPLE_SENTINEL_RESULT',$priorSentinelResult),
    @('FARMRX_MAPLE_SENTINEL_PROBE_CS',$priorSentinelProbe)
  )) {
    if ($null -eq $pair[1]) { Remove-Item "Env:$($pair[0])" -ErrorAction SilentlyContinue } else { [Environment]::SetEnvironmentVariable($pair[0],[string]$pair[1],[EnvironmentVariableTarget]::Process) }
  }
  if ($null -ne $outerProcess -and -not $outerProcess.HasExited) { Stop-Process -Id $outerProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($null -ne $unrelatedProcess -and -not $unrelatedProcess.HasExited) { Stop-Process -Id $unrelatedProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($null -ne $sentinelJob) { $sentinelJob.Dispose() }
  if ($null -ne $sentinelStream) { $sentinelStream.Dispose() }
  if (Test-Path -LiteralPath $tempRoot) {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $resolvedBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing browser-ownership regression cleanup outside the temporary directory.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
