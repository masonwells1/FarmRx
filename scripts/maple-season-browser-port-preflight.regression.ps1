$ErrorActionPreference = 'Stop'

# Governed-port preflight regression.
#
# Playwright runs every season config with reuseExistingServer:false, so a governed port that is
# already listening cannot be shared. Without a preflight the scenario launches anyway, waits out
# Playwright's 120s webServer timeout, and then dies inside the post-run cleanup refusal - which
# reads as if the scenario leaked the listener when something else held the port first.
#
# This regression proves Invoke-MapleSeasonBrowserProof refuses before it starts anything, and
# proves all three properties the refusal depends on:
#   1. a foreign loopback listener is reported as foreign, naming the redirect variable
#   2. a wildcard (0.0.0.0) listener still fails closed - the check must not narrow to 127.0.0.1
#   3. a Farm Rx-owned listener is diagnosed as Farm Rx's own, not as a foreign squatter
# In every case the listener must be left running: the preflight refuses, it never terminates.

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'maple-season-browser.ps1')

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

# Probe for a free high port instead of hardcoding one: this regression must stay runnable on the
# kind of busy machine that motivated the preflight in the first place.
$port = 0
foreach ($candidate in 4289..4319) {
  if (@(Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue).Count -eq 0) {
    $port = $candidate
    break
  }
}

$priorPort = $env:FARMRX_SEASON_JANUARY_PORT
$priorReadyFile = $env:FARMRX_PREFLIGHT_READY_FILE
$priorStartedFile = $env:FARMRX_PREFLIGHT_STARTED_FILE
$priorBindAddress = $env:FARMRX_PREFLIGHT_BIND_ADDRESS
$suffix = [Guid]::NewGuid().ToString('N')
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-maple-port-preflight-{0}" -f $suffix)
# A foreign listener must live outside the owned marker. If it sat inside $tempRoot its command
# line would satisfy the ownership test, and a regressed preflight would quietly terminate it
# instead of exposing the refusal. The leaked-server case deliberately does sit inside $tempRoot.
$squatterRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-foreign-listener-{0}" -f $suffix)
$fakeRunner = Join-Path $tempRoot 'fake-playwright.js'
$startedSentinel = Join-Path $tempRoot 'runner-started.txt'
$scenario = 'Maple preflight regression'
$listenerProcess = $null
# The mixed-listener case below holds TWO processes at once, so one variable cannot carry them to the
# cleanup in the finally.
$mixedProcesses = [Collections.Generic.List[object]]::new()
# Declared out here, ahead of the try, because the finally has to be able to release them on the failure
# path too. Closing a job handle is itself a kill - these jobs are created with KILL_ON_JOB_CLOSE - so this
# list is both the handle-leak cleanup and the last-resort teardown for any listener a failed assertion
# left running inside a job.
$clearJobs = [Collections.Generic.List[IntPtr]]::new()
$clearHandles = [Collections.Generic.List[IntPtr]]::new()

try {
  Assert-True ($port -ne 0) 'Port preflight regression could not find a free loopback port in 4289-4319.'
  New-Item -ItemType Directory -Path $tempRoot -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $squatterRoot -ErrorAction Stop | Out-Null

  $listenerSource = @"
const fs = require('fs')
const net = require('net')
const server = net.createServer()
server.listen($port, process.env.FARMRX_PREFLIGHT_BIND_ADDRESS, () => fs.writeFileSync(process.env.FARMRX_PREFLIGHT_READY_FILE, 'ready'))
setInterval(() => {}, 1000)
"@
  # If the preflight ever regresses, this runner starts and leaves a sentinel behind.
  $runnerSource = @"
const fs = require('fs')
fs.writeFileSync(process.env.FARMRX_PREFLIGHT_STARTED_FILE, 'started')
"@
  Set-Content -LiteralPath $fakeRunner -Value $runnerSource -Encoding Ascii -NoNewline

  # Resolve node the same way the helper under test does. A bare 'node' from PATH can be a
  # version-manager shim that re-execs a child, which would make the listening PID differ from
  # the PID this regression started and turn an exact-message check into a false negative.
  $node = (Get-Command node.exe -ErrorAction Stop).Source

  $cases = @(
    @{
      Name = 'foreign loopback listener'
      Directory = $squatterRoot
      BindAddress = '127.0.0.1'
      Expected = "$scenario cannot start: governed port $port was already in use by {0} before this scenario ran, and no listener there belongs to Farm Rx. Free that port or set FARMRX_SEASON_JANUARY_PORT to an unused port."
    }
    @{
      Name = 'foreign wildcard listener'
      Directory = $squatterRoot
      BindAddress = '0.0.0.0'
      Expected = "$scenario cannot start: governed port $port was already in use by {0} before this scenario ran, and no listener there belongs to Farm Rx. Free that port or set FARMRX_SEASON_JANUARY_PORT to an unused port."
    }
    @{
      Name = 'Farm Rx-owned listener'
      Directory = $tempRoot
      BindAddress = '127.0.0.1'
      Expected = "$scenario cannot start: governed port $port was already held by a Farm Rx dev or season server ({0}) before this scenario ran. An earlier proof that never released the port is the usual cause, but a development server started by hand in this tree looks the same; stop that server or investigate the proof that left it behind. Free that port or set FARMRX_SEASON_JANUARY_PORT to an unused port."
    }
  )

  foreach ($case in $cases) {
    $listenerScript = Join-Path $case.Directory 'listener.js'
    $readyFile = Join-Path $case.Directory 'listener-ready.txt'
    Set-Content -LiteralPath $listenerScript -Value $listenerSource -Encoding Ascii -NoNewline
    Remove-Item -LiteralPath $readyFile -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $startedSentinel -ErrorAction SilentlyContinue

    $env:FARMRX_PREFLIGHT_READY_FILE = $readyFile
    $env:FARMRX_PREFLIGHT_STARTED_FILE = $startedSentinel
    $env:FARMRX_PREFLIGHT_BIND_ADDRESS = $case.BindAddress
    # Quote the script path: Start-Process joins ArgumentList with spaces and adds no quotes, so
    # an unquoted temp path containing a space would reach node truncated.
    $listenerProcess = Start-Process -FilePath $node -ArgumentList @("`"$listenerScript`"") -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $readyFile) -and -not $listenerProcess.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    # Two different failures used to arrive here as one message. The port was free when this
    # regression probed for it, but nothing reserves it in between, so another process can take it
    # first and node dies on EADDRINUSE - that exits, it does not hang. Separate the two so the
    # operator is not sent looking for a broken helper when the machine simply raced them.
    if (-not (Test-Path -LiteralPath $readyFile) -and $listenerProcess.HasExited) {
      throw "Port preflight regression listener for the $($case.Name) case exited before it began listening on port $port; another process most likely claimed that port after this regression probed it as free."
    }
    Assert-True (Test-Path -LiteralPath $readyFile) "Port preflight regression listener for the $($case.Name) case did not begin listening on port $port within twenty seconds."

    $env:FARMRX_SEASON_JANUARY_PORT = [string]$port
    $expected = $case.Expected -f "node.exe (PID $($listenerProcess.Id))"

    $message = $null
    try {
      Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario $scenario -RunnerFile $fakeRunner -OwnedCommandMarker $tempRoot
    } catch {
      $message = $_.Exception.Message
    }

    Assert-True ($message -ceq $expected) "Port preflight did not report the $($case.Name) case accurately. Got: $message"
    # The sentinel is the decisive proof that nothing launched: the fake runner writes it the
    # moment it executes, so its absence means the refusal happened before any process started.
    Assert-True (-not (Test-Path -LiteralPath $startedSentinel)) "Port preflight started the browser runner despite the $($case.Name) case."
    # The refusal must never escalate into terminating a listener this scenario did not create.
    Assert-True (-not $listenerProcess.HasExited) "Port preflight terminated the listener in the $($case.Name) case instead of refusing."
    Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 1) "Port preflight disturbed the listener in the $($case.Name) case."

    Stop-Process -Id $listenerProcess.Id -Force -ErrorAction SilentlyContinue
    $listenerProcess.WaitForExit(10000) | Out-Null
    $released = [DateTime]::UtcNow.AddSeconds(10)
    while (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -ne 0 -and [DateTime]::UtcNow -lt $released) { Start-Sleep -Milliseconds 100 }
    # Assert the release instead of only waiting for it. An unreleased port used to surface one case
    # later as the next case's listener failing to start, which named the wrong case and the wrong
    # cause.
    Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) "Port preflight regression could not release port $port after the $($case.Name) case."
    $listenerProcess = $null
  }

  # THE UNREADABLE HOLDER, executed rather than reasoned about. Every case above has a holder this preflight can
  # read. This is the one where it cannot, and until now that state was recorded as a STRANGER: the process
  # lookup ran with -ErrorAction SilentlyContinue, $null went to the ownership predicate, the predicate answered
  # "not ours", and the refusal told the operator as a flat fact that no listener on that port belonged to Farm
  # Rx. The likeliest real cause is the opposite of that sentence - a leaked Farm Rx server the operator now has
  # no reason to go looking for.
  #
  # An access-denied CIM read cannot be produced on demand from an unprivileged shell, so the failure is
  # INJECTED into a COPY of the helper - the technique the orphan case uses - and only the single statement that
  # reads the process is replaced. The bucketing, the sentence and the refusal under test are the real ones.
  # The listener sits in $squatterRoot, OUTSIDE the owned marker, deliberately: if the injection ever stopped
  # taking effect the holder would be readable and foreign, and this case would fail with the foreign message
  # rather than pass on a mutation that no longer applies.
  $cimHelper = Join-Path $tempRoot 'injected-cim-failure-helper.ps1'
  $cimRunner = Join-Path $tempRoot 'injected-cim-failure-case.ps1'
  $cimMessageFile = Join-Path $tempRoot 'injected-cim-failure-message.txt'
  $cimNeedle = '      $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction Stop'
  $cimSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'maple-season-browser.ps1') -Raw
  # EXACTLY ONE occurrence, because .Replace patches every match: a second copy of that statement would be
  # silently neutered too, and the case would still pass while covering less than it claims.
  Assert-True (($cimSource.Split([string[]]@($cimNeedle), [StringSplitOptions]::None).Count - 1) -eq 1) 'Port preflight regression could not find exactly one process-lookup statement to inject a failure into; its needle is stale and the drill would prove nothing.'
  [IO.File]::WriteAllText($cimHelper, $cimSource.Replace($cimNeedle, "      throw 'the process table could not be read (injected)'"), [Text.UTF8Encoding]::new($false))
  # Every value below is baked into the generated child rather than passed as an argument, because $scenario
  # contains spaces and native-argument quoting is not identical across the two hosts this suite runs on - a
  # split argument would arrive as a different scenario name and fail this case for the wrong reason. Single
  # quotes are the delimiter, so a quote inside any of these values would end the literal early and generate
  # something other than the intended probe; asserted rather than assumed.
  foreach ($baked in @($cimHelper, $cimMessageFile, $scenario, $tempRoot)) {
    Assert-True (-not $baked.Contains("'")) "Port preflight regression cannot bake the value '$baked' into its injected-failure probe because it contains a single quote."
  }
  $cimRunnerSource = @"
`$ErrorActionPreference = 'Stop'
. '$cimHelper'
`$message = 'NO_REFUSAL_AT_ALL'
try {
  Assert-MapleSeasonBrowserPortFree -Port $port -Scenario '$scenario' -PortVariable 'FARMRX_SEASON_JANUARY_PORT' -Root '$tempRoot'
} catch {
  `$message = `$_.Exception.Message
}
Set-Content -LiteralPath '$cimMessageFile' -Value `$message -Encoding Ascii -NoNewline
"@
  Set-Content -LiteralPath $cimRunner -Value $cimRunnerSource -Encoding Ascii -NoNewline

  $cimListenerScript = Join-Path $squatterRoot 'cim-failure-listener.js'
  $cimReadyFile = Join-Path $squatterRoot 'cim-failure-ready.txt'
  Set-Content -LiteralPath $cimListenerScript -Value $listenerSource -Encoding Ascii -NoNewline
  Remove-Item -LiteralPath $cimReadyFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $cimMessageFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $startedSentinel -ErrorAction SilentlyContinue
  $env:FARMRX_PREFLIGHT_READY_FILE = $cimReadyFile
  $env:FARMRX_PREFLIGHT_BIND_ADDRESS = '127.0.0.1'
  $listenerProcess = Start-Process -FilePath $node -ArgumentList @("`"$cimListenerScript`"") -PassThru -WindowStyle Hidden
  $cimDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath $cimReadyFile) -and -not $listenerProcess.HasExited -and [DateTime]::UtcNow -lt $cimDeadline) { Start-Sleep -Milliseconds 100 }
  Assert-True (Test-Path -LiteralPath $cimReadyFile) "Port preflight regression's unreadable-holder listener did not begin listening on port $port within twenty seconds."

  # The SAME engine this file is running under, so this case cannot pass on one host while going untested on
  # the other - which is what a hardcoded 'pwsh' would have done under Windows PowerShell 5.1.
  $cimProbeShell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  & $cimProbeShell -NoProfile -ExecutionPolicy Bypass -File $cimRunner | Out-Null
  Assert-True (Test-Path -LiteralPath $cimMessageFile) 'Port preflight regression could not read back a refusal from its injected-CIM-failure child shell, so the probe did not run.'
  $cimMessage = Get-Content -LiteralPath $cimMessageFile -Raw
  $cimExpected = "$scenario cannot start: governed port $port was already in use before this scenario ran, and this preflight could not identify a single listener on it, so it will not guess whether the holder is Farm Rx or not: PID $($listenerProcess.Id) (could not be identified: the process table could not be read (injected)). Check those PIDs from an elevated shell. Free that port or set FARMRX_SEASON_JANUARY_PORT to an unused port."
  Assert-True ($cimMessage -ceq $cimExpected) "Port preflight did not refuse an unreadable holder honestly. Got: $cimMessage"
  # It still has to be a REFUSAL, not just an honest sentence: a port whose holder cannot be identified is
  # exactly the port a scenario must not launch onto.
  Assert-True (-not (Test-Path -LiteralPath $startedSentinel)) 'Port preflight started the browser runner despite being unable to identify the holder of the governed port.'
  Assert-True (-not $listenerProcess.HasExited) 'Port preflight terminated a listener it could not even identify instead of refusing.'
  # AND STILL LISTENING, which is the assertion that actually matters and which `-not $listenerProcess.HasExited`
  # does not make. A fresh-context review was right about this. A live process proves only that nothing killed a
  # process; the claim under test is that the preflight left the PORT alone, and those two facts come apart - a
  # listener can close its socket and keep running, so a refusal that drained the port first and refused second
  # would satisfy the liveness check while doing the one thing this case exists to forbid. Asked by OWNING PID
  # rather than "is anything listening", so a stranger that arrived on the port cannot stand in for the listener
  # that was supposed to survive.
  $cimSurvivors = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -eq $listenerProcess.Id })
  Assert-True ($cimSurvivors.Count -gt 0) "Port preflight refused, but governed port $port is no longer held by the unidentifiable listener (pid $($listenerProcess.Id)) that was supposed to survive the refusal, so it did more than refuse."

  Stop-Process -Id $listenerProcess.Id -Force -ErrorAction SilentlyContinue
  $listenerProcess.WaitForExit(10000) | Out-Null
  $cimReleased = [DateTime]::UtcNow.AddSeconds(10)
  while (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -ne 0 -and [DateTime]::UtcNow -lt $cimReleased) { Start-Sleep -Milliseconds 100 }
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) "Port preflight regression could not release port $port after the unreadable-holder case."
  $listenerProcess = $null

  # Clear-MapleSeasonBrowserPort itself, executed. Everything above proves the preflight REFUSES; this is
  # the other function, the one that actually terminates a listener, and its authority changed completely.
  # It no longer asks whether a listener's command line sits under the owned root. That question was
  # MEASURED wrong in both directions on this workstation - a developer's own repository-rooted node process
  # answered "ours" and would have been force-killed, and a genuine descendant that bound the port late
  # answered "not ours" and was left holding it - so authority moved to the only record that cannot be
  # imitated by text: the kernel's own list of which processes this scenario launched, a Job Object.
  #
  # These cases exercise that record against real listening processes, in the four directions that decide
  # whether the change is actually safe:
  #   1. a listener created INSIDE the job is terminated and the port is released
  #   2. a DETACHED GRANDCHILD of the launch is terminated too. This is the direction the retired predicate
  #      got wrong, and the reason the rewrite happened at all: in a real season run the process holding the
  #      governed port is a dev server the launch never named.
  #   3. a listener created OUTSIDE the job survives, is named, and the call throws. Its DIRECTORY is
  #      irrelevant now - it would be foreign even sitting inside the owned root, which is precisely the
  #      distinction the old design could not express.
  #   4. a caller that supplies no job is refused before anything is terminated.
  Initialize-MapleSeasonProcessInterop

  $spawnerSource = @'
const fs = require("fs")
const { spawn } = require("child_process")
// Binds NOTHING itself. It spawns a detached, unreferenced grandchild that binds the governed port and
// writes the ready file, so the process holding the port is not the process the launch created. Detached
// and unref'd on purpose: that is the process the retired command-line predicate left alive.
const child = spawn(process.execPath, [process.env.FARMRX_PREFLIGHT_CHILD_SCRIPT], {
  detached: true,
  stdio: "ignore",
})
child.unref()
fs.writeFileSync(process.env.FARMRX_PREFLIGHT_SPAWNED_FILE, String(child.pid))
setInterval(() => {}, 1000)
'@

  function New-ProbeJob {
    $createError = 0
    $createStage = ''
    $created = [MapleSeasonProcessInterop]::CreateKillOnCloseJob([ref]$createError, [ref]$createStage)
    Assert-True ($created -ne [IntPtr]::Zero) "Cleanup regression could not create a job object to own its listener (failed at the $createStage stage, Windows error $createError)."
    $clearJobs.Add($created)
    return $created
  }

  function Test-ProbeExited {
    param([Parameter(Mandatory)][IntPtr]$Handle)
    # "Has this process ended", asked of the HANDLE rather than of a process id, so it cannot be answered
    # about some later process that inherited the id. `.HasExited` is not available for these: they were
    # created by CreateProcessW rather than Start-Process, which is the whole point - only a launch that can
    # be assigned to a job before its first instruction runs can be governed by one.
    return ([MapleSeasonProcessInterop]::WaitForSingleObject($Handle, [uint32]0) -eq [MapleSeasonProcessInterop]::WAIT_OBJECT_0)
  }

  function Start-JobListener {
    param(
      [Parameter(Mandatory)][IntPtr]$Job,
      [Parameter(Mandatory)][string]$Script,
      [Parameter(Mandatory)][string]$Ready,
      [Parameter(Mandatory)][string]$Bind,
      [Parameter(Mandatory)][string]$Label
    )
    Remove-Item -LiteralPath $Ready -ErrorAction SilentlyContinue
    $env:FARMRX_PREFLIGHT_READY_FILE = $Ready
    $env:FARMRX_PREFLIGHT_BIND_ADDRESS = $Bind
    $handle = [IntPtr]::Zero
    $launchedId = [uint32]0
    $launchError = 0
    $launchStage = ''
    # No environment block is passed, so the launched process inherits this one - which is how the listener
    # learns its ready file and bind address, and how a GRANDCHILD inherits them in turn. If that
    # inheritance ever broke, the ready-file assertion below is what would say so.
    $started = [MapleSeasonProcessInterop]::StartInJob(
      $Job, $node, ('"{0}" "{1}"' -f $node, $Script), $tempRoot,
      [ref]$handle, [ref]$launchedId, [ref]$launchError, [ref]$launchStage)
    Assert-True $started "Cleanup regression could not start its $Label listener inside a job object (failed at the $launchStage stage, Windows error $launchError)."
    $clearHandles.Add($handle)
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $Ready) -and -not (Test-ProbeExited -Handle $handle) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    Assert-True (Test-Path -LiteralPath $Ready) "Cleanup regression's $Label listener did not begin listening on port $port within twenty seconds."
    return [pscustomobject]@{ Handle = $handle; Id = [int]$launchedId }
  }

  # 1. A listener the launch created itself.
  $ownedJob = New-ProbeJob
  $ownedScript = Join-Path $tempRoot 'clear-owned-listener.js'
  Set-Content -LiteralPath $ownedScript -Value $listenerSource -Encoding Ascii -NoNewline
  $ownedListener = Start-JobListener -Job $ownedJob -Script $ownedScript -Ready (Join-Path $tempRoot 'clear-owned-ready.txt') -Bind '127.0.0.1' -Label 'owned'
  $ownedFailure = $null
  try {
    Clear-MapleSeasonBrowserPort -Port $port -Job $ownedJob -Scenario $scenario
  } catch {
    $ownedFailure = $_.Exception.Message
  }
  Assert-True ($null -eq $ownedFailure) "Cleanup refused to terminate the listener it launched itself on port $port. Got: $ownedFailure"
  Assert-True (Test-ProbeExited -Handle $ownedListener.Handle) "Cleanup returned without terminating the listener it launched on port $port."
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) "Cleanup left governed port $port listening after terminating the listener it launched."

  # 2. A DETACHED GRANDCHILD of the launch, which is the case that motivated the whole rewrite.
  $grandchildJob = New-ProbeJob
  $grandchildScript = Join-Path $tempRoot 'clear-grandchild-listener.js'
  $spawnerScript = Join-Path $tempRoot 'clear-grandchild-spawner.js'
  $spawnedFile = Join-Path $tempRoot 'clear-grandchild-spawned.txt'
  Set-Content -LiteralPath $grandchildScript -Value $listenerSource -Encoding Ascii -NoNewline
  Set-Content -LiteralPath $spawnerScript -Value $spawnerSource -Encoding Ascii -NoNewline
  Remove-Item -LiteralPath $spawnedFile -ErrorAction SilentlyContinue
  $env:FARMRX_PREFLIGHT_CHILD_SCRIPT = $grandchildScript
  $env:FARMRX_PREFLIGHT_SPAWNED_FILE = $spawnedFile
  $spawnerListener = Start-JobListener -Job $grandchildJob -Script $spawnerScript -Ready (Join-Path $tempRoot 'clear-grandchild-ready.txt') -Bind '127.0.0.1' -Label 'detached grandchild'
  $grandchildRows = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  Assert-True ($grandchildRows.Count -eq 1) "Detached-grandchild cleanup case needs exactly one listener on port $port; the listener table returned $($grandchildRows.Count) rows."
  # Checked at run time rather than assumed. If the port were held by the launched process itself this case
  # would be case 1 again wearing a different name, and it would pass without ever proving anything about a
  # descendant - so it says so instead of passing quietly.
  Assert-True ([int]$grandchildRows[0].OwningProcess -ne $spawnerListener.Id) "Detached-grandchild cleanup case requires governed port $port to be held by a process the launch did not create, or it proves nothing about descendants. The port is held by pid $($grandchildRows[0].OwningProcess) and the launched process is pid $($spawnerListener.Id)."
  $grandchildFailure = $null
  try {
    Clear-MapleSeasonBrowserPort -Port $port -Job $grandchildJob -Scenario $scenario
  } catch {
    $grandchildFailure = $_.Exception.Message
  }
  Assert-True ($null -eq $grandchildFailure) "Cleanup refused to terminate a detached grandchild of its own launch on port $port - the exact process the retired command-line predicate left alive. Got: $grandchildFailure"
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) "Cleanup left governed port $port held by a detached grandchild of its own launch."

  # 3 and 4, against one listener started deliberately OUTSIDE any job.
  $foreignJob = New-ProbeJob
  $foreignScript = Join-Path $squatterRoot 'clear-foreign-listener.js'
  $foreignReady = Join-Path $squatterRoot 'clear-foreign-ready.txt'
  Set-Content -LiteralPath $foreignScript -Value $listenerSource -Encoding Ascii -NoNewline
  Remove-Item -LiteralPath $foreignReady -ErrorAction SilentlyContinue
  $env:FARMRX_PREFLIGHT_READY_FILE = $foreignReady
  $env:FARMRX_PREFLIGHT_BIND_ADDRESS = '127.0.0.1'
  # Start-Process, not StartInJob: being outside the job is the entire definition of foreign now.
  $listenerProcess = Start-Process -FilePath $node -ArgumentList @("`"$foreignScript`"") -PassThru -WindowStyle Hidden
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath $foreignReady) -and -not $listenerProcess.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  Assert-True (Test-Path -LiteralPath $foreignReady) "Cleanup regression's foreign listener did not begin listening on port $port within twenty seconds."

  # 4 first, while a live listener is on the port: a caller with no job must be refused, and the refusal
  # must happen before anything is terminated. An IntPtr::Zero job would otherwise reach TerminateJobObject.
  $noJobFailure = $null
  try {
    Clear-MapleSeasonBrowserPort -Port $port -Job ([IntPtr]::Zero) -Scenario $scenario
  } catch {
    $noJobFailure = $_.Exception.Message
  }
  Assert-True ($noJobFailure -ceq "$scenario was asked to release governed port $port without the job that owns its browser tree; refusing to terminate anything.") "Cleanup did not refuse a caller that supplied no job with the exact message. Got: $noJobFailure"
  Assert-True (-not $listenerProcess.HasExited) "Cleanup terminated a listener even though it was given no job to authorize terminating anything."

  # 3. The safety-critical direction.
  $foreignFailure = $null
  try {
    Clear-MapleSeasonBrowserPort -Port $port -Job $foreignJob -Scenario $scenario
  } catch {
    $foreignFailure = $_.Exception.Message
  }
  Assert-True ($foreignFailure -ceq "$scenario terminated its own browser tree, but pid $($listenerProcess.Id) is not in that job and still holds governed port $port, so it is not a process this scenario launched and it refused to terminate it.") "Cleanup did not refuse a listener outside its job with the exact message, naming the process. Got: $foreignFailure"
  # The decisive assertion. A refusal that still killed the process is the exact failure the rewrite exists
  # to prevent, and an exception message alone would not reveal it.
  Assert-True (-not $listenerProcess.HasExited) "Cleanup terminated a listener outside its job while reporting that it refused to."
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 1) "Cleanup disturbed a listener outside its job on port $port."
  Stop-Process -Id $listenerProcess.Id -Force -ErrorAction SilentlyContinue
  $listenerProcess.WaitForExit(10000) | Out-Null
  $released = [DateTime]::UtcNow.AddSeconds(10)
  while (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -ne 0 -and [DateTime]::UtcNow -lt $released) { Start-Sleep -Milliseconds 100 }
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) "Cleanup regression could not release port $port after the foreign-listener case."
  $listenerProcess = $null

  # ONE port, TWO listeners - one a job member, one not. This is the case none of the four above can reach,
  # because each of them puts the port entirely inside or entirely outside the job, and it asks the question
  # that decides whether a wholesale TerminateJobObject is safe at all: when the kill names no process id
  # and reaches every member at once, can it spill onto a process sharing the same port?
  #
  # It cannot, and that is what this asserts. The member IS terminated - it is ours, and needing to keep it
  # alive was an artifact of the old design, which killed one listener at a time and therefore had to
  # validate them all before starting. Job membership is decided before any process runs, so there is
  # nothing left to validate at kill time. The non-member survives untouched and is named in the throw.
  #
  # A port really can hold two listeners: one bound to 127.0.0.1 and one to ::1 are separate sockets, and
  # Get-NetTCPConnection returns both rows. Enumeration ORDER used to matter here and deliberately no longer
  # does - the kill is atomic over the job rather than a walk down the listener table - so this case no
  # longer pins which row Windows returns first.
  $mixedJob = New-ProbeJob
  $mixedOwnedScript = Join-Path $tempRoot 'mixed-owned-listener.js'
  Set-Content -LiteralPath $mixedOwnedScript -Value $listenerSource -Encoding Ascii -NoNewline
  $mixedOwned = Start-JobListener -Job $mixedJob -Script $mixedOwnedScript -Ready (Join-Path $tempRoot 'mixed-owned-ready.txt') -Bind '::1' -Label 'mixed-case job member'
  $mixedForeignScript = Join-Path $squatterRoot 'mixed-foreign-listener.js'
  $mixedForeignReady = Join-Path $squatterRoot 'mixed-foreign-ready.txt'
  Set-Content -LiteralPath $mixedForeignScript -Value $listenerSource -Encoding Ascii -NoNewline
  Remove-Item -LiteralPath $mixedForeignReady -ErrorAction SilentlyContinue
  $env:FARMRX_PREFLIGHT_READY_FILE = $mixedForeignReady
  $env:FARMRX_PREFLIGHT_BIND_ADDRESS = '127.0.0.1'
  $mixedForeign = Start-Process -FilePath $node -ArgumentList @("`"$mixedForeignScript`"") -PassThru -WindowStyle Hidden
  $mixedProcesses.Add($mixedForeign)
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath $mixedForeignReady) -and -not $mixedForeign.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  Assert-True (Test-Path -LiteralPath $mixedForeignReady) "Mixed-listener cleanup case could not start its non-member listener on port $port within twenty seconds."
  $mixedRows = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  Assert-True ($mixedRows.Count -eq 2) "Mixed-listener cleanup case needs one port held by two listeners; the listener table returned $($mixedRows.Count) rows, so it cannot tell a job-scoped kill from an indiscriminate one."

  $mixedFailure = $null
  try {
    Clear-MapleSeasonBrowserPort -Port $port -Job $mixedJob -Scenario $scenario
  } catch {
    $mixedFailure = $_.Exception.Message
  }
  Assert-True ($mixedFailure -ceq "$scenario terminated its own browser tree, but pid $($mixedForeign.Id) is not in that job and still holds governed port $port, so it is not a process this scenario launched and it refused to terminate it.") "Mixed-listener cleanup did not report a port shared with a non-member using the exact message, naming the process. Got: $mixedFailure"
  # The decisive assertion: the kill reached exactly the job and stopped there. A failure here means
  # TerminateJobObject took a process off this port that this scenario never launched.
  Assert-True (-not $mixedForeign.HasExited) "Mixed-listener cleanup terminated a NON-MEMBER listener on port $port while reporting that it refused to."
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 1) "Mixed-listener cleanup left $(@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count) listeners on port $port; exactly the non-member should remain."
  # And the other half of the same fact: the member really was terminated, so this case is not passing
  # merely because the kill did nothing at all.
  Assert-True (Test-ProbeExited -Handle $mixedOwned.Handle) "Mixed-listener cleanup left its own job member running on port $port, so the throw about the non-member may simply be a kill that never happened."

  foreach ($mixed in $mixedProcesses) {
    if (-not $mixed.HasExited) { Stop-Process -Id $mixed.Id -Force -ErrorAction SilentlyContinue }
    $mixed.WaitForExit(10000) | Out-Null
  }
  $mixedProcesses.Clear()
  $released = [DateTime]::UtcNow.AddSeconds(10)
  while (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -ne 0 -and [DateTime]::UtcNow -lt $released) { Start-Sleep -Milliseconds 100 }
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) "Cleanup regression could not release port $port after the mixed-listener case."

  # The listener probe must fail CLOSED. Every caller reads an empty list as "nothing is listening", so a
  # query that FAILED used to report the port clean - the cleanup then reported done and the preflight let
  # a scenario launch into an occupied port. Get-MapleSeasonPortListener now swallows exactly one error,
  # the measured "nothing is listening" one, and throws on anything else. Drilled by handing it a port
  # number Get-NetTCPConnection cannot accept: the failure must surface, not read as a free port.
  $probeFailure = $null
  try {
    Get-MapleSeasonPortListener -Port 70000 -Scenario $scenario | Out-Null
  } catch {
    $probeFailure = $_.Exception.Message
  }
  Assert-True ($null -ne $probeFailure) 'The listener probe answered an unusable port number instead of throwing, so a broken listener query still reads as a free port.'
  Assert-True ($probeFailure -clike "*could not read the listener table for governed port 70000*") "The listener probe threw, but not with its own fail-closed diagnosis, so the message an operator reads would not name the cause. Got: $probeFailure"
  # And the other direction, which is what makes the refusal above a fail-CLOSED probe rather than a probe
  # that refuses everything: a genuinely free port must still answer empty.
  Assert-True (@(Get-MapleSeasonPortListener -Port $port -Scenario $scenario).Count -eq 0) 'The listener probe reported listeners on a free port; a probe that refuses every port would fail every cleanup instead of proving anything.'

  # Ownership boundary, asserted directly. The listener cases above can only put a process clearly
  # inside the owned root or clearly outside it, so they cannot reach the case that matters most:
  # a sibling directory that merely shares the root's name prefix.
  #
  # WHAT A TRUE ANSWER NOW COSTS, stated honestly, because this comment used to claim more. This predicate
  # NO LONGER GATES ANY KILL. Kill authority is Job Object membership, and its one surviving caller is the
  # preflight, which refuses to launch either way and terminates nothing. A wrong answer here therefore
  # mislabels a refusal message - it says "a Farm Rx dev or season server" where it should say "a foreign
  # listener", or the reverse - and it sends an operator looking in the wrong place. That is worth these
  # cases and no more. They are kept, in full, for two reasons: the message an operator reads is still the
  # only thing that tells them what to stop, and every case below records a defect this predicate actually
  # had, which is evidence about how text-matching fails and should not be discarded with the kill.
  $ownedRoot = 'C:\FarmRx'
  # ImageName is part of each case because the predicate tests the process image, not the command
  # line, for the node/npm/npx condition - an argument that merely mentions node_modules must not be
  # able to satisfy it.
  $ownershipCases = @(
    @{ Name = 'sibling directory sharing the root prefix'; ImageName = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx2\node_modules\vite\bin\vite.js"'; Owned = $false }
    # The space-suffixed sibling is the case the first version of this predicate got wrong: a space
    # was accepted as a path boundary, so root C:\FarmRx claimed a server in C:\FarmRx Backup and
    # would have terminated it. Directory names may contain spaces, so a space ends nothing.
    @{ Name = 'sibling directory whose name adds a space'; ImageName = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx Backup\node_modules\vite\bin\vite.js"'; Owned = $false }
    # The apostrophe sibling is the same defect as the space, and it survived the first repair: the
    # boundary set still listed an apostrophe, which is legal in a Windows directory name, so root
    # C:\FarmRx claimed a server in C:\FarmRx's Backup and would have terminated it. A double quote is
    # the only quote character Windows forbids in a path, so it is the only one that can end a name.
    @{ Name = 'sibling directory whose name adds an apostrophe'; ImageName = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx''s Backup\node_modules\vite\bin\vite.js"'; Owned = $false }
    @{ Name = 'listener inside the owned root'; ImageName = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx\node_modules\vite\bin\vite.js"'; Owned = $true }
    @{ Name = 'owned root spelled with forward slashes'; ImageName = 'node.exe'; CommandLine = 'node.exe "C:/FarmRx/node_modules/vite/bin/vite.js"'; Owned = $true }
    @{ Name = 'owned root at the end of the command line'; ImageName = 'node.exe'; CommandLine = 'node.exe C:\FarmRx'; Owned = $true }
    @{ Name = 'owned root inside closing quotes'; ImageName = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx"'; Owned = $true }
    # A prefix-sharing sibling appearing BEFORE the real owned path used to mask it: the search
    # stopped at the first occurrence, found a bad boundary, and declared our own server foreign,
    # which failed the month at cleanup with a wrong diagnosis.
    @{ Name = 'prefix-sharing sibling ahead of the owned path'; ImageName = 'node.exe'; CommandLine = 'node.exe --require C:\FarmRx2\hook.js "C:\FarmRx\node_modules\vite\bin\vite.js"'; Owned = $true }
    @{ Name = 'owned root but not a node process'; ImageName = 'ruby.exe'; CommandLine = 'ruby.exe C:\FarmRx\serve.rb'; Owned = $false }
    # A non-node process whose arguments mention node_modules must not qualify. The predecessor
    # matched '(vite|npm|node)' anywhere in the command line, so this returned true.
    @{ Name = 'non-node process whose arguments mention node_modules'; ImageName = 'ruby.exe'; CommandLine = 'ruby.exe C:\FarmRx\node_modules\tool\serve.rb'; Owned = $false }
  )
  foreach ($ownershipCase in $ownershipCases) {
    $probe = [pscustomobject]@{ Name = $ownershipCase.ImageName; CommandLine = $ownershipCase.CommandLine }
    $actual = Test-MapleSeasonBrowserPortOwned -ListenerProcess $probe -Root $ownedRoot
    Assert-True ($actual -eq $ownershipCase.Owned) "Ownership test answered $actual for the $($ownershipCase.Name) case; expected $($ownershipCase.Owned)."
  }
  # Fail closed when this session cannot inspect the holder at all.
  Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $null -Root $ownedRoot)) 'Ownership test did not fail closed for an uninspectable process.'
  Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess ([pscustomobject]@{ Name = 'node.exe'; CommandLine = $null }) -Root $ownedRoot)) 'Ownership test did not fail closed for a null command line.'
  # A missing or degenerate root must not claim every listener. TrimEnd empties a root of '\', and
  # IndexOf('') succeeds at every position, so this is the difference between "not ours" and "kill
  # anything on this port".
  $anyListener = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx\node_modules\vite\bin\vite.js"' }
  Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $anyListener)) 'Ownership test did not fail closed for a missing root.'
  Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $anyListener -Root '\')) 'Ownership test did not fail closed for a degenerate root.'
  # A root that does not name a directory under a drive or share is too broad to identify one tree, and
  # rejecting only the empty root was not enough to catch that. True here no longer authorizes anything -
  # see the note above - but a root this broad would call every node process on the machine Farm Rx's own.
  #
  # Be exact about which of these are regressions, because an earlier version of this comment claimed
  # all of them were and that was wrong. Measured against the predicate at 599818e using the very
  # $unrelatedListener defined below: 'C:\', 'C:', 'C:/', and a lone space each answered TRUE and are
  # genuine regressions - 'C:\' trims to 'C:', which every absolute path on that drive continues with a
  # separator, a legal boundary, so it claimed every node process on the machine; a lone space matched
  # the space present in nearly any command line. The other three - '.', 'FarmRx', and a bare share root
  # - answered FALSE against that listener already; they are invariant guards against a future widening,
  # not regressions of anything. (Root '.' does answer TRUE against command line `node .`, which is why
  # the old comment sounded right, but that input is not the one asserted here.)
  $unrelatedListener = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\Other\app.js"' }
  foreach ($overBroadRoot in @('C:\', 'C:', 'C:/', '.', ' ', 'FarmRx', '\\server\share')) {
    Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $unrelatedListener -Root $overBroadRoot)) "Ownership test did not fail closed for the over-broad root '$overBroadRoot'."
  }
  # Root '.' against the command line it actually matches, so the case the comment above describes is
  # asserted rather than merely mentioned.
  Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess ([pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node .' }) -Root '.')) 'Ownership test did not fail closed for a relative root against a bare relative command line.'
  # Roots that ARE the drive root under another spelling, or that navigate back to it. Each of these
  # satisfied the first version of the shape check - which only demanded one character after 'C:\', and
  # '.', '..', a space, and a tab are all one character - and each then claimed a listener in an
  # unrelated tree. A device or extended-length prefix is rejected for a different reason: it aliases a
  # path this predicate may already hold under its normal name, so the same tree could be matched two
  # ways and only one of them was ever tested.
  foreach ($case in @(
    @{ Root = 'C:\.'; CommandLine = 'node.exe "C:\.\app.js"' }
    @{ Root = 'C:\..'; CommandLine = 'node.exe "C:\..\app.js"' }
    @{ Root = 'C:\FarmRx\..'; CommandLine = 'node.exe "C:\FarmRx\..\Other\app.js"' }
    @{ Root = 'C:\ '; CommandLine = 'node.exe "C:\ \app.js"' }
    @{ Root = "C:\`t"; CommandLine = "node.exe `"C:\`t\app.js`"" }
    @{ Root = '\\.\C:\FarmRx'; CommandLine = 'node.exe "\\.\C:\FarmRx\app.js"' }
    @{ Root = '\\?\C:\FarmRx'; CommandLine = 'node.exe "\\?\C:\FarmRx\app.js"' }
  )) {
    $aliasListener = [pscustomobject]@{ Name = 'node.exe'; CommandLine = $case.CommandLine }
    Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $aliasListener -Root $case.Root)) "Ownership test did not fail closed for the drive-root alias '$($case.Root)'."
  }
  # The mirror: a legitimate directory whose name merely BEGINS with a dot must still be recognized.
  # This repository's own governed root is C:\FarmRx\.claude\worktrees\<branch>, so a segment check that
  # rejected every leading dot instead of only '.' and '..' would refuse the real tree.
  $dotSegmentOwned = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx\.claude\worktrees\b\node_modules\vite\bin\vite.js"' }
  Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $dotSegmentOwned -Root 'C:\FarmRx\.claude\worktrees\b') 'Ownership test refused an owned root containing a dot-prefixed directory segment.'
  # A VALID root plus a traversing command line. The cases above reject a root that navigates back to
  # the drive; these reject the mirror image, where the root is exactly this repository and the
  # LISTENER's path walks back out of it. Measured against the predicate before this repair, root
  # C:\FarmRx against `node.exe "C:\FarmRx\..\Other\scripts\factory-board.mjs" --port 4177` answered
  # True: the root text was found at a real separator, so the sole gate on the force kill
  # authorized terminating a process running one directory over, outside the repository entirely.
  # Matching the root text does not establish that the path stays inside the tree the root names.
  foreach ($case in @(
    @{ Label = 'quoted traversal out of the root'; CommandLine = 'node.exe "C:\FarmRx\..\Other\scripts\factory-board.mjs" --port 4177' }
    @{ Label = 'unquoted traversal out of the root'; CommandLine = 'node.exe C:\FarmRx\..\Other\scripts\factory-board.mjs' }
    @{ Label = 'traversal deeper in the same token'; CommandLine = 'node.exe C:\FarmRx\app\..\..\Other\app.js' }
    @{ Label = 'traversal at the end of the command line'; CommandLine = 'node.exe C:\FarmRx\..' }
    @{ Label = 'traversal ending at a closing quote'; CommandLine = 'node.exe "C:\FarmRx\.."' }
    # The five cases above all place '..' as a whole token that ends at a quote or at the end of the
    # string. The traversal walk originally scanned to the next double quote only, which means an
    # UNQUOTED traversal followed by another argument left the tail '\.. --port 4177'. That is not the
    # exact segment '..', so the refusal missed it and the predicate claimed the parent directory.
    # Measured True before this repair. An unquoted argument ends at whitespace.
    @{ Label = 'unquoted traversal followed by another argument'; CommandLine = 'node.exe C:\FarmRx\.. --port 4177' }
    # Win32 strips trailing dots and spaces from each path component, so '.. ' reaches the parent exactly
    # as '..' does and '... ' is not a directory name at all. Both measured True before this repair.
    @{ Label = 'traversal spelled with a trailing space'; CommandLine = 'node.exe "C:\FarmRx\.. \Other\x.js"' }
    @{ Label = 'component built only of dots and a space'; CommandLine = 'node.exe "C:\FarmRx\... \Other\x.js"' }
    # A double quote is not automatically a closing quote. With an even number of quotes ahead of it the
    # match sits OUTSIDE any quoted argument, so a quote at the boundary OPENS a fragment that continues
    # the same name - and the name Windows then builds is the sibling 'C:\FarmRx Backup'. Measured True
    # before the quote-parity test, which is the whole reason the predicate now counts quotes.
    @{ Label = 'sibling reached by opening a quoted fragment'; CommandLine = 'node.exe C:\FarmRx" Backup"\scripts\factory-board.mjs' }
    # The same sibling by the doubled-quote spelling. This is now refused earlier and for a stronger
    # reason than its own tokenization: ANY command line carrying a doubled quote is refused, because
    # Windows has two argument grammars and this predicate cannot know which one built the process it is
    # judging. See the doubled-quote cases below.
    @{ Label = 'sibling reached by a doubled-quote concatenation'; CommandLine = 'node.exe "C:\FarmRx"" Backup"\x.js' }
    # A quoted space belongs to the directory name, but it must not hide a traversal that follows it.
    @{ Label = 'traversal out of a space-bearing segment'; CommandLine = 'node.exe "C:\FarmRx\my app\..\..\Other\x.js"' }
  )) {
    $traversingListener = [pscustomobject]@{ Name = 'node.exe'; CommandLine = $case.CommandLine }
    Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $traversingListener -Root 'C:\FarmRx')) "Ownership test did not fail closed for a $($case.Label)."
  }
  # A traversing occurrence must not mask a legitimate one later in the same command line, for the same
  # reason the scan does not stop at the first match: declaring our own server foreign fails the month
  # at cleanup with a wrong diagnosis.
  $traversalThenOwned = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe --require C:\FarmRx\..\Other\hook.js C:\FarmRx\app\server.mjs' }
  Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $traversalThenOwned -Root 'C:\FarmRx') 'Ownership test let a traversing argument mask an owned path later in the same command line.'
  # A non-string root must fail closed rather than throw. Dropping the [string] cast from the
  # parameter sent an integer straight into .Replace() and raised a method-not-found error, which is
  # the one answer the callers cannot use - they depend on this function returning false.
  Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $unrelatedListener -Root 4174)) 'Ownership test did not fail closed for a non-string root.'
  # The three assertions below are guards against an over-strict future repair, not regressions: all
  # three answer the same way against the predicate at 599818e as they do now. They are here so that a
  # narrowing fix cannot pass the false-TRUE cases above by refusing legitimate trees as well.
  #
  # The mirror of the apostrophe case: removing the apostrophe from the boundary set must not stop a
  # genuinely owned tree from being recognized when the owned path itself contains one. Without this,
  # a repair that simply refused every apostrophe would pass the case above and still fail the month.
  $apostropheOwned = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\Mason''s FarmRx\node_modules\vite\bin\vite.js"' }
  Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $apostropheOwned -Root 'C:\Mason''s FarmRx') 'Ownership test refused an owned root whose own name contains an apostrophe.'
  # A UNC root names a real tree and must still be recognized, and its sibling must not be.
  $uncOwned = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "\\server\share\FarmRx\node_modules\vite\bin\vite.js"' }
  Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $uncOwned -Root '\\server\share\FarmRx') 'Ownership test refused an owned UNC root.'
  $uncSibling = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "\\server\share\FarmRx2\node_modules\vite\bin\vite.js"' }
  Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $uncSibling -Root '\\server\share\FarmRx')) 'Ownership test claimed a UNC sibling that shares the root prefix.'
  # Mirrors of the traversal repair, and the same kind of over-strictness guard: a segment that merely
  # begins with dots is a real directory name, and this repository's own root already depends on one
  # ('.claude'), so a repair that refused every dot-bearing segment would refuse the tree the season
  # proofs actually run in.
  $dotsOwned = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx\...odd\server.mjs"' }
  Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $dotsOwned -Root 'C:\FarmRx') 'Ownership test refused an owned path whose segment merely begins with dots.'
  # QUOTED, deliberately. The unquoted spelling of this assertion proved nothing: an unquoted argument
  # ends at whitespace, so the predicate only ever saw 'C:\FarmRx\my' and answered TRUE without the
  # space-bearing segment mattering. A listener genuinely running from a path with a space in it quotes
  # that path, which is the case this now pins.
  $spaceSegmentOwned = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx\my app\server.mjs"' }
  Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $spaceSegmentOwned -Root 'C:\FarmRx') 'Ownership test refused an owned path containing a space-bearing directory segment.'
  # The exact root as a bare final-or-followed argument is a legitimately owned spelling, and the first
  # version of the quote-parity repair refused it: whitespace ends an unquoted argument, so the root
  # ending right at that whitespace ends at the token's end and is a match. Measured FALSE before this
  # assertion existed, which is fail-closed but still a wrong cleanup diagnosis.
  $bareRootThenFlag = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\FarmRx --port 4177' }
  Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $bareRootThenFlag -Root 'C:\FarmRx') 'Ownership test refused the exact owned root followed by another argument.'
  # A space-bearing root cannot appear in an UNQUOTED argument at all, because Windows splits there. This
  # corrects SR-064, which reported root 'C:\Mason FarmRx' against `node C:\Mason FarmRx` answering TRUE
  # and offered it as a match: what that command line really passes is 'C:\Mason' and then 'FarmRx', so
  # our root is absent and TRUE was wrong rather than merely conservative.
  $spaceRootUnquoted = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\Mason FarmRx' }
  Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $spaceRootUnquoted -Root 'C:\Mason FarmRx')) 'Ownership test claimed a space-bearing root spanning two unquoted arguments.'
  # ...and the quoted spelling of the same root must still be recognized, so the rule above cannot be
  # satisfied by refusing every space-bearing root.
  $spaceRootQuoted = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\Mason FarmRx\node_modules\vite\bin\vite.js"' }
  Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $spaceRootQuoted -Root 'C:\Mason FarmRx') 'Ownership test refused a quoted owned root whose own name contains a space.'

  # Windows has TWO argument grammars, and this file has MEASURED them disagreeing about one construct: the
  # doubled quote inside a quoted argument. "Exactly one" was the earlier wording and is withdrawn - nothing
  # here enumerated the grammars exhaustively, so the honest claim is the disagreement that was observed, not
  # a count of all disagreements that exist. CommandLineToArgvW,
  # which the table below checks this tokenizer against, is what shell32 and PowerShell use; node.exe
  # enters at wmain and is parsed by the Microsoft C runtime, where a doubled quote inside a quoted
  # argument yields one literal quote and does NOT leave quoted mode. Measured with the real API on the
  # first line below: shell32 produces the two arguments `C:\Other"` and `C:\FarmRx\safe`, so the second
  # half of a label reads as a path inside our tree, whereas under the C runtime rule the label stays one
  # argument that names nothing of ours. The predicate cannot know which grammar built the process it is
  # judging, and picking the wrong one authorizes a kill, so it refuses any command line carrying '""'.
  foreach ($doubledQuote in @(
    'node.exe C:\Other\server.js --label "C:\Other"" C:\FarmRx\safe"'
    'node.exe "C:\FarmRx"" Backup"\x.js'
    'node.exe C:\Other\server.js --label "a""C:\FarmRx\x.js"'
  )) {
    $ambiguousListener = [pscustomobject]@{ Name = 'node.exe'; CommandLine = $doubledQuote }
    Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $ambiguousListener -Root 'C:\FarmRx')) "Ownership test answered a command line whose meaning depends on which Windows argument grammar parsed it: '$doubledQuote'."
  }
  # The over-strictness mirror. A SINGLE quote pair is unambiguous - both grammars agree - so refusing
  # every quoted command line would pass the three cases above and refuse the real listener, whose path
  # contains '.claude\worktrees' and is quoted precisely because paths like it can contain spaces.
  $singleQuotedOwned = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\FarmRx\.claude\worktrees\b\node_modules\vite\bin\vite.js" --port 4177' }
  Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $singleQuotedOwned -Root 'C:\FarmRx\.claude\worktrees\b') 'Ownership test refused an ordinary singly-quoted owned path; the doubled-quote refusal must not reject every quoted command line.'

  # Containment is decided by the platform's own path resolver, not by a hand-written walk over the text.
  # These are the spellings that decision changed, in both directions, and each was measured.
  #
  # ACCEPTED before and wrong: an argument that starts with our root at a real separator and yet cannot
  # name a file inside the tree. `NUL` is a reserved device - GetFullPath turns it into `\\.\NUL`, which
  # leaves the tree entirely - and a colon past the drive letter names an alternate data stream.
  foreach ($case in @(
    @{ Label = 'reserved device name below the root'; CommandLine = 'node.exe C:\Other\server.js --label C:\FarmRx\NUL' }
    @{ Label = 'reserved device name with an extension'; CommandLine = 'node.exe C:\Other\server.js --label C:\FarmRx\COM1.txt' }
    @{ Label = 'alternate data stream below the root'; CommandLine = 'node.exe C:\Other\server.js --label C:\FarmRx\file:stream' }
    @{ Label = 'drive-relative path that depends on shell state'; CommandLine = 'node.exe C:FarmRx\server.js' }
  )) {
    $unresolvableListener = [pscustomobject]@{ Name = 'node.exe'; CommandLine = $case.CommandLine }
    Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $unresolvableListener -Root 'C:\FarmRx')) "Ownership test did not fail closed for a $($case.Label)."
  }
  # REFUSED before and wrong, which is the direction that fails a proof month with a false diagnosis:
  # every one of these genuinely IS the owned tree, spelled a way the hand-written walk did not accept.
  foreach ($case in @(
    @{ Label = 'extended-length prefix'; CommandLine = 'node.exe "\\?\C:\FarmRx\node_modules\vite\bin\vite.js"' }
    @{ Label = 'a no-op current-directory segment'; CommandLine = 'node.exe C:\FarmRx\.\server.mjs' }
    @{ Label = 'a traversal that stays inside the tree'; CommandLine = 'node.exe C:\FarmRx\sub\..\server.mjs' }
    @{ Label = 'a doubled separator'; CommandLine = 'node.exe C:\FarmRx\\server.mjs' }
  )) {
    $spelledListener = [pscustomobject]@{ Name = 'node.exe'; CommandLine = $case.CommandLine }
    Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess $spelledListener -Root 'C:\FarmRx') "Ownership test refused an owned path spelled with $($case.Label), which would declare our own listener foreign."
  }

  # The tokenizer must not be able to STALL. Its two loops - the skip between arguments and the scan within
  # one - have to agree on what separates arguments, because a scan that stops at a character the skip will
  # not consume makes no progress and the parse never returns. That is worse than a wrong answer: the
  # callers are built to survive a false, but nothing survives a hang. Measured on this workstation - with
  # the two tests written separately and one of them widened to [char]::IsWhiteSpace, this regression ran
  # for four minutes and printed nothing before it was killed. The separator rule is now defined once, and
  # the stall guard below refuses to answer at all if an iteration consumed nothing. It THROWS rather than
  # breaking out with what it has: the earlier version broke, and breaking was measured to be a false-TRUE
  # of its own. On the sibling line below the drifted parse produces `node.exe`, `C:\FarmRx`, `` - and the
  # bare exact root is itself a containment match, so the truncated list authorized killing the sibling's
  # listener. Truncating a parse this predicate then answers from is not fail-closed; refusing is. This
  # drills the guard by re-introducing the drift on a COPY of the function and requiring that refusal.
  $tokenizerSource = Get-Content -Raw (Join-Path $PSScriptRoot 'maple-season-browser.ps1')
  $tokenizerSource = $tokenizerSource.Substring(0, $tokenizerSource.IndexOf('function Test-MapleSeasonPathComponentIsRealName'))
  $driftNeedle = 'if ((-not $inQuotes) -and (Test-MapleSeasonCommandLineSeparator -Character $character)) { break }'
  Assert-True ($tokenizerSource.Contains($driftNeedle)) 'The stall drill could not find the shared separator test to drift; its needle is stale and the drill would prove nothing.'
  $driftedSource = $tokenizerSource.Replace($driftNeedle, 'if ((-not $inQuotes) -and [char]::IsWhiteSpace($character)) { break }')
  $stallJob = Start-Job -ScriptBlock {
    param([string]$FunctionSource, [string]$Line)
    Invoke-Expression $FunctionSource
    try { @(Split-MapleSeasonCommandLineArguments -CommandLine $Line).Count }
    catch { "THREW: $($_.Exception.Message)" }
  } -ArgumentList $driftedSource, ("node.exe C:\FarmRx{0}Backup\server.js" -f ([char]0x00A0))
  try {
    # Wait-Job returns a job OBJECT, and a job object is truthy even when its State is Failed or Stopped.
    # Measured: a job whose body was `throw 'copy failed'` returned a truthy PSRemotingJob with
    # State = Failed. Casting that return to [bool] is therefore not a test of anything, and this drill
    # would have gone green on a job that never ran the tokenizer at all. Require the state explicitly.
    $stallWaited = Wait-Job $stallJob -Timeout 30
    Assert-True ($null -ne $stallWaited) 'A drifted separator test made the command-line parse stall: it never returned, which hangs a proof month instead of failing it.'
    Assert-True ($stallJob.State -eq 'Completed') "The stall drill's job ended in state '$($stallJob.State)' rather than Completed, so it proved nothing about the stall guard."
    # ...and the value has to be the refusal, not merely SOME value. A drill that accepts any completion
    # would pass on the truncated argument list that was the previous, unsafe behaviour.
    $stallOutcome = [string](@(Receive-Job $stallJob) | Select-Object -Last 1)
    Assert-True ($stallOutcome -like 'THREW: Split-MapleSeasonCommandLineArguments made no progress*') "A drifted separator test returned '$stallOutcome' instead of refusing to answer; a partial parse that still yields arguments can authorize killing a foreign process."
  } finally {
    Remove-Job $stallJob -Force -ErrorAction SilentlyContinue
  }

  # The ownership predicate now decides containment by comparing whole ARGUMENTS, so every case above
  # rests on Split-MapleSeasonCommandLineArguments splitting a command line the way Windows does. Three
  # consecutive reviews each found a different false-TRUE in the hand-written scan that preceded it, and
  # all three were the same mistake: deciding what a character means without tokenizing. Checking the
  # rules against my reading of the documentation is what produced those three rounds, so check them
  # against the real parser instead - CommandLineToArgvW, the function Windows itself uses to build argv
  # for a process. If the two disagree on any entry below, this regression fails.
  $onWindows = ($null -eq $IsWindows) -or $IsWindows
  # A RUNTIME RECEIPT for the table below, declared here and consumed after the branch closes - deliberately
  # outside the block it measures. The static guard pins all 33 rows of that table and pairs every one of them
  # against the portable ownership table, and a fresh-context review defeated the whole of that by wrapping the
  # `foreach` in `if ($false) { ... }`: every row was still present in the file, still spelled exactly as
  # pinned, still paired in both directions, and not one command line was ever handed to CommandLineToArgvW.
  # Reproduced before this counter. A static guard proves statements EXIST; only a count proves they EXECUTED.
  # DISTINCT lines are counted separately because the total alone is satisfied by duplicating one row and
  # dropping another - the row count stays 33 and the case the dropped row covered is simply gone. Ordinal
  # comparison, because the default hashtable/HashSet comparer is case-insensitive and two rows that differ
  # only in case are two rows.
  $tokenizerComparisons = 0
  $tokenizerTokens = 0
  $tokenizerLinesCompared = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  if (-not $onWindows) {
    Write-Output 'Tokenizer equivalence table skipped: CommandLineToArgvW is a Windows API.'
  } else {
    if (-not ('MapleSeasonArgv' -as [type])) {
      Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MapleSeasonArgv {
  [DllImport("shell32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string lpCmdLine, out int pNumArgs);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr hMem);
  public static string[] Parse(string commandLine) {
    int count;
    IntPtr block = CommandLineToArgvW(commandLine, out count);
    if (block == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    try {
      string[] parsed = new string[count];
      for (int i = 0; i < count; i++) { parsed[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(block, i * IntPtr.Size)); }
      return parsed;
    } finally { LocalFree(block); }
  }
}
'@ | Out-Null
    }
    # ReadOnly, because pinning this line's TEXT says nothing about the character the variable carries, and a
    # fresh-context review confirmed that `${script:nonBreakingSpace} = [char]0x20` written after it silently
    # turned the one row that distinguishes Windows' separators from [char]::IsWhiteSpace into a row about an
    # ordinary space. PowerShell refuses a second write at RUNTIME, which no guard regex can be relied on to
    # do: variable names here are case-insensitive and spellable several ways.
    Set-Variable -Name nonBreakingSpace -Option ReadOnly -Value ([char]0x00A0)
    foreach ($commandLine in @(
      # Ordinary spellings, including the tab separator and the quoted program path that argv[0]'s own
      # rule exists for.
      'node.exe C:\FarmRx\x.js'
      'node.exe   C:\FarmRx\x.js   --port   4177'
      "node.exe`tC:\FarmRx\x.js`t--port`t4177"
      '"C:\Program Files\nodejs\node.exe" scripts\factory-board.mjs --port 4177'
      'node.exe "C:\Mason FarmRx\x.js"'
      # The three command lines that defeated the hand-written scan, each measured TRUE before the
      # rewrite: a backslash-escaped quote that is data rather than a delimiter, a quote that OPENS a
      # continuing fragment, and a non-breaking space that is a legal file-name character rather than a
      # separator.
      'node.exe C:\Other\server.js --label "C:\FarmRx\safe\" --port 4177"'
      'node.exe C:\FarmRx" Backup"\scripts\factory-board.mjs'
      ("node.exe C:\FarmRx{0}Backup\server.js" -f $nonBreakingSpace)
      # The 2n / 2n+1 backslash rule at every parity, and the doubled-quote quirk that belongs to
      # CommandLineToArgvW and NOT to the C runtime: inside a quoted argument '""' yields one literal
      # quote and leaves quoted mode.
      'node.exe a\\"b c'
      'node.exe a\\\"b c'
      'node.exe a\\\\"b c" d'
      'node.exe "C:\FarmRx"" Backup"\x.js'
      'node.exe "a""b"'
      'node.exe "a""b c"'
      'node.exe ab"c"d"e"f'
      # An EVEN backslash run followed immediately by TWO quotes. This is where the two rules meet, and the
      # first version of this tokenizer decided the first quote inside the backslash branch, which had no
      # way to know a delimiter quote can also be the first half of a doubled quote. Measured: Windows
      # builds `C:\FarmRx\safe\"`, which the forbidden-character test then refuses, while the buggy version
      # built `C:\FarmRx\safe\ --port 4177` and the predicate answered TRUE on a command line whose actual
      # script was C:\Other\server.js. There is now exactly one place that decides what a quote means.
      'node.exe C:\Other\server.js --label "C:\FarmRx\safe\\"" --port 4177'
      'node.exe C:\Other\server.js --label "C:\Other"" C:\FarmRx\safe"'
      'node.exe a\\""b c'
      'node.exe "a\\""b" c'
      # Malformed and degenerate spellings. A predicate that throws here answers neither TRUE nor FALSE,
      # which is the one answer its callers cannot use.
      'node.exe ""'
      'node.exe """"'
      'node.exe """"""'
      'node.exe \\'
      'node.exe "'
      '"node.exe'
      'node.exe one"'
      'node.exe "C:\FarmRx\..\Other\x.js'
      # An UNQUOTED traversal followed by another argument. This was the one vector the portable ownership
      # regression asserted as a hard-coded literal without any table ever re-deriving it from the real API -
      # measured by diffing the two tables, one line out of twenty-nine. It matters because it is the shape
      # the predicate must refuse: `C:\FarmRx\..` resolves to the drive root, so a listener spelled this way
      # is not inside the tree, and the portable suite asserts exactly that refusal.
      'node.exe C:\FarmRx\.. --port 4177'
      # Leading whitespace: Windows begins argv[0] at the first character, so this yields an EMPTY argv[0]
      # and then parses the rest normally. Skipping the whitespace instead parsed the program path under
      # the general rule, which is where its backslashes would have gone somewhere else.
      '   node.exe   one'
      # Spellings the containment walk depends on downstream.
      'node.exe C:/FarmRx/x.js'
      'node.exe "C:\FarmRx\my app\x.js" --port 4177'
      'node.exe "C:\FarmRx\.. .\Other\x.js"'
      "node.exe `"C:\FarmRx\`t\Other\x.js`""
    )) {
      # Cleared FIRST - all THREE of them - so nothing from the previous row can authorize the receipt
      # below. Clearing $agrees alone was not enough, and a fresh-context review said so: with the two
      # parses wrapped in `if ($false) { … }` and `$agrees = $true` forced, $expected still held the
      # PREVIOUS row's argument array, so `$tokenizerTokens += $expected.Count` credited this row with a
      # count Windows produced for a different command line. Two rows in this table parse to the same
      # number of arguments, so the carried value is not even necessarily wrong-looking. Clearing both
      # arrays and requiring $expected to have been produced in THIS iteration is what makes the token
      # total a per-row receipt rather than a plausible sum.
      $agrees = $null
      $expected = $null
      $actual = $null
      $expected = @([MapleSeasonArgv]::Parse($commandLine))
      $actual = @(Split-MapleSeasonCommandLineArguments -CommandLine $commandLine)
      $agrees = $expected.Count -eq $actual.Count
      if ($agrees) {
        for ($position = 0; $position -lt $expected.Count; $position++) {
          if ($expected[$position] -cne $actual[$position]) { $agrees = $false; break }
        }
      }
      $rendered = "expected [$(($expected | ForEach-Object { "<$_>" }) -join ' ')] but produced [$(($actual | ForEach-Object { "<$_>" }) -join ' ')]"
      Assert-True $agrees "Split-MapleSeasonCommandLineArguments disagreed with CommandLineToArgvW on '$commandLine': $rendered."
      # RECORDED AFTER the comparison, and gated on the comparison's own result rather than being a bare tick
      # at the top of the loop. That is where these two lines used to sit, and a fresh-context review wrapped
      # only the comparison in `if ($false) { ... }`: the receipt still read `comparisons=33 distinct=33`,
      # every string the static guard pins was still present, and this file printed PASS with not one command
      # line handed to CommandLineToArgvW. Reproduced before this move. Wrapping the comparison now leaves
      # $agrees at $null, so nothing is recorded and the receipt falls short of the full table.
      # And the receipt carries a QUANTITY THE PARSE PRODUCED, not only the fact that $agrees was truthy. A
      # fresh-context review defeated the gating-on-$agrees version by writing `$agrees = $true` immediately
      # after the $null clear and then wrapping the two parses and the comparison: $agrees is truthy without a
      # single call to CommandLineToArgvW, and every count above still reaches its expected total. Windows'
      # own token count for each row cannot be produced without calling Windows. That last clause used to read
      # "and an unset $expected counts zero", which was FALSE at the time it was written: only $agrees was
      # cleared per iteration, so a wrapped parse left $expected holding the PREVIOUS row's array and the sum
      # was carried forward rather than short. A fresh-context review found it. The clear above and the
      # assertion below are what make the sentence true.
      if ($agrees) {
        # AFFIRMATIVE, not just cleared. Clearing $expected makes a wrapped parse under-count; this makes it
        # SAY SO. Without this line the shortfall only surfaced two hundred lines later as a receipt that did
        # not reconcile, which names the wrong thing: the message would be about a total, not about the row
        # that never reached Windows. Windows never answers a command line with zero arguments - even the
        # empty line yields the asking process's own path - so a zero here means this iteration recorded a
        # count it did not obtain.
        Assert-True ($null -ne $expected -and $expected.Count -gt 0) "The tokenizer comparison recorded a receipt for '$commandLine' without a parse from CommandLineToArgvW in this iteration; a token total assembled from carried-over or absent parses is not evidence that Windows was consulted."
        $tokenizerComparisons++
        $tokenizerTokens += $expected.Count
        [void]$tokenizerLinesCompared.Add($commandLine)
      }
    }
    # The EMPTY command line is the one case where equivalence is not wanted, and it is asserted here
    # rather than quietly left out of the table above. CommandLineToArgvW('') answers with the path of the
    # process that ASKED - a fact about the caller, not about the listener being judged - so zero arguments
    # is the fail-closed answer. Both halves are pinned so a future edit cannot make this an accidental
    # divergence in either direction: Windows must still invent that self-naming answer, and we must still
    # return none.
    #
    # Assert the CONTENT, not the count. The count was pinned at 1 and that was host-dependent, because
    # Windows tokenizes the path it invents: MEASURED, under Windows PowerShell 5.1 the host is
    # C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe and the answer is 1 argument, while under
    # PowerShell 7 it is C:\Program Files\PowerShell\7\pwsh.exe and the answer is 2 - 'C:\Program' and
    # 'Files\PowerShell\7\pwsh.exe'. Get-FoundationProbeShell hands this chain pwsh.exe whenever the
    # orchestrator itself runs on PowerShell 7, so the count pin failed the whole foundation gate with a
    # message about CommandLineToArgvW changing behaviour when nothing had changed except which shell
    # started it - the false-FALSE, wrong-diagnosis failure this suite exists to prevent. Rejoining the
    # arguments with single spaces reconstructs the host path on both hosts, and it still proves the point:
    # the answer is built from the caller and owes nothing to the input.
    $emptyFromWindows = @([MapleSeasonArgv]::Parse(''))
    $askingProcessPath = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    Assert-True ($emptyFromWindows.Count -ge 1) 'CommandLineToArgvW answered an empty command line with no arguments at all; the deliberate divergence below was justified by it inventing the caller path instead, so it needs re-deciding rather than re-asserting.'
    Assert-True (($emptyFromWindows -join ' ') -ceq $askingProcessPath) "CommandLineToArgvW no longer answers an empty command line with the path of the process asking; it returned '$($emptyFromWindows -join ' ')' where this process is '$askingProcessPath', so the deliberate divergence below needs re-deciding rather than re-asserting."
    Assert-True (@(Split-MapleSeasonCommandLineArguments -CommandLine '').Count -eq 0) 'Split-MapleSeasonCommandLineArguments answered an empty command line with arguments; the only safe answer is none, because Windows answers it with the path of the process asking.'
  }

  # The receipt is consumed HERE, outside the branch above, and it is published as well as asserted so a
  # caller can hold the expectation independently instead of trusting this file's own PASS marker.
  $tokenizerExpectedComparisons = if ($onWindows) { 33 } else { 0 }
  # `tokens` is the only field here that Windows itself had to produce. The other two can be reached by an
  # extra `$agrees = $true`; this one cannot, because it sums the argument counts CommandLineToArgvW returned.
  # 90 across the 33 rows, measured from this workstation's CommandLineToArgvW rather than reasoned about.
  $tokenizerExpectedTokens = if ($onWindows) { 90 } else { 0 }
  Write-Output "TOKENIZER_RECEIPT comparisons=$tokenizerComparisons distinct=$($tokenizerLinesCompared.Count) tokens=$tokenizerTokens windows=$($onWindows.ToString().ToLowerInvariant())"
  Assert-True ($tokenizerComparisons -eq $tokenizerExpectedComparisons) "The tokenizer equivalence table handed $tokenizerComparisons command lines to CommandLineToArgvW instead of $tokenizerExpectedComparisons, so the rows this file's static guard pins did not all execute."
  Assert-True ($tokenizerTokens -eq $tokenizerExpectedTokens) "The tokenizer equivalence table accumulated $tokenizerTokens argument tokens from CommandLineToArgvW instead of $tokenizerExpectedTokens, so at least one row's parse did not run even though the row was counted as agreeing."
  Assert-True ($tokenizerLinesCompared.Count -eq $tokenizerExpectedComparisons) "The tokenizer equivalence table compared $($tokenizerLinesCompared.Count) DISTINCT command lines instead of $tokenizerExpectedComparisons, so at least one row duplicates another and whatever case the duplicate displaced was never checked."
  Write-Output 'MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_PASS'
  exit 0
} catch {
  Write-Output "MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_FAIL $($_.Exception.Message)"
  exit 1
} finally {
  # EVERY TEARDOWN FAILURE IS OBSERVABLE AND CHANGES THE VERDICT, which a fresh-context review found this block
  # doing for none of them. The previous version was a wall of `-ErrorAction SilentlyContinue`: a Stop-Process
  # that failed, a handle that would not close, a job that stayed open, a temp tree that could not be deleted -
  # every one of those left the workstation dirty and the run still printed
  # MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_PASS and exited 0. For a file whose entire subject is
  # processes left holding a governed port, a silent cleanup is the one failure mode it must not have.
  #
  # The shape is the one the timeout regression already proves on this workstation, and it depends on two
  # MEASURED facts about PowerShell rather than on assumptions about it. First: an explicit `exit` inside a
  # finally overrides the pending `exit 0` from the try, so the report below can fail a run whose assertions all
  # passed. Second: a THROW inside a finally ends the run at exit 1 having skipped every statement after it -
  # so an unguarded failure here would not merely be unreported, it would suppress the report of everything
  # below it. That is why every statement in this block is inside its own try, including the ones that look
  # incapable of failing, and why the directory-refusal below records a problem instead of throwing.
  $teardownProblems = [Collections.Generic.List[string]]::new()
  foreach ($restore in @(
    @{ Name = 'FARMRX_SEASON_JANUARY_PORT'; Value = $priorPort },
    @{ Name = 'FARMRX_PREFLIGHT_READY_FILE'; Value = $priorReadyFile },
    @{ Name = 'FARMRX_PREFLIGHT_STARTED_FILE'; Value = $priorStartedFile },
    @{ Name = 'FARMRX_PREFLIGHT_BIND_ADDRESS'; Value = $priorBindAddress }
  )) {
    # A LOOP, so one failed restore cannot skip the other three. Written as four sequential statements before,
    # which meant a throw on the first left three of this session's environment variables pointing at a deleted
    # temporary directory for whatever ran next in the same shell.
    try {
      if ($null -eq $restore.Value) { Remove-Item -LiteralPath "Env:$($restore.Name)" -ErrorAction SilentlyContinue }
      else { Set-Item -LiteralPath "Env:$($restore.Name)" -Value $restore.Value }
    } catch {
      $teardownProblems.Add("could not restore environment variable $($restore.Name): $($_.Exception.Message)")
    }
  }
  # Only ever stop the listeners this regression started itself.
  try {
    if ($null -ne $listenerProcess -and -not $listenerProcess.HasExited) {
      Stop-Process -Id $listenerProcess.Id -Force -ErrorAction Stop
      if (-not $listenerProcess.WaitForExit(10000)) {
        $teardownProblems.Add("listener pid $($listenerProcess.Id) did not exit within ten seconds of being stopped, so it may still hold port $port")
      }
    }
  } catch {
    # A RACED EXIT IS NOT A TEARDOWN FAILURE, and telling them apart matters because this block can now fail an
    # otherwise passing run. The listener is a node process that may exit on its own between the HasExited check
    # above and the Stop-Process below, and -ErrorAction Stop turns that into a terminating error. Asking
    # .HasExited in the catch settles it: MEASURED on this workstation, reading .HasExited on an already-exited
    # process does not throw, so this is a safe question to ask here.
    if ($null -eq $listenerProcess -or -not $listenerProcess.HasExited) {
      $teardownProblems.Add("could not stop the listener this regression started: $($_.Exception.Message)")
    }
  }
  # The mixed-listener case asserts that its NON-MEMBER listener is still running, so on both the success
  # and the failure path there is a live process here to stop; leaving it behind would occupy the port for
  # whatever ran next. Emptied on the success path, so this only fires when an assertion threw.
  foreach ($orphan in $mixedProcesses) {
    try {
      if ($null -eq $orphan -or $orphan.HasExited) { continue }
      Stop-Process -Id $orphan.Id -Force -ErrorAction Stop
      if (-not $orphan.WaitForExit(10000)) {
        $teardownProblems.Add("non-member listener pid $($orphan.Id) did not exit within ten seconds of being stopped, so it may still hold port $port")
      }
    } catch {
      # Same raced-exit discrimination as the listener above, for the same reason.
      if ($null -eq $orphan -or -not $orphan.HasExited) {
        $teardownProblems.Add("could not stop a non-member listener this regression started: $($_.Exception.Message)")
      }
    }
  }
  # Handles first, then jobs. A process handle is only a handle - closing it terminates nothing - whereas
  # closing a job handle created with KILL_ON_JOB_CLOSE makes the kernel reap every member that is still
  # alive. So the job close is simultaneously the handle-leak fix and the one teardown that cannot be
  # skipped: it needs no listener table, no process id, and no cooperation from the processes themselves,
  # which is why it also protects a run that failed an assertion halfway through a case.
  #
  # `[void]` USED TO DISCARD THE ANSWER. CloseHandle returns a bool, and on the job handles that bool is the
  # difference between "the kernel reaped every member of this job" and "a listener this regression created is
  # still on the port and nothing will ever collect it". Reported now, per handle, by name.
  foreach ($openHandle in $clearHandles) {
    try {
      if ($openHandle -ne [IntPtr]::Zero -and -not [MapleSeasonProcessInterop]::CloseHandle($openHandle)) {
        $teardownProblems.Add("could not close a process handle this regression opened (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so that process id stays reserved for the life of this session")
      }
    } catch {
      $teardownProblems.Add("could not close a process handle this regression opened: $($_.Exception.Message)")
    }
  }
  foreach ($openJob in $clearJobs) {
    try {
      if ($openJob -ne [IntPtr]::Zero -and -not [MapleSeasonProcessInterop]::CloseHandle($openJob)) {
        $teardownProblems.Add("could not close a job object this regression created (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so the kernel did not reap its surviving members and they may still hold port $port")
      }
    } catch {
      $teardownProblems.Add("could not close a job object this regression created: $($_.Exception.Message)")
    }
  }
  # THE TEMPORARY TREES ARE KEPT WHEN ANYTHING ELSE WENT WRONG, deliberately. If a listener or a job survived
  # this teardown, the scripts and sentinel files that describe what was running are the only evidence of what
  # is still on the workstation, and deleting them to keep the temp directory tidy destroys exactly the record
  # a human needs. On a clean teardown they go, as before.
  if ($teardownProblems.Count -gt 0) {
    $teardownProblems.Add("kept $tempRoot and $squatterRoot for inspection because this teardown reported a problem")
  } else {
    foreach ($doomed in @($tempRoot, $squatterRoot)) {
      try {
        if (-not (Test-Path -LiteralPath $doomed)) { continue }
        $resolvedTemp = [IO.Path]::GetFullPath($doomed)
        $resolvedBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        # RECORDED, NOT THROWN. A throw here is a throw inside a finally: it ends the run at exit 1 and skips
        # the report below, so the one path that most needs to say what it refused to delete would say nothing.
        if (-not $resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) {
          $teardownProblems.Add("refused to delete $resolvedTemp because it is not under $resolvedBase, so it was left in place")
          continue
        }
        # BOUNDED RETRY, because the processes that were holding files under this tree were stopped seconds ago
        # and Windows releases their file handles asynchronously. Without the retry, -ErrorAction Stop would
        # turn an ordinary handle-release delay into a reported teardown failure - a flaky red, which is its own
        # kind of dishonesty. Ten attempts over two seconds, and then it really is a failure worth reporting.
        $deleteError = $null
        for ($attempt = 1; $attempt -le 10; $attempt++) {
          try { Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction Stop; $deleteError = $null; break }
          catch { $deleteError = $_; Start-Sleep -Milliseconds 200 }
        }
        if ($null -ne $deleteError -and (Test-Path -LiteralPath $resolvedTemp)) {
          $teardownProblems.Add("could not delete the temporary directory $resolvedTemp after ten attempts over two seconds: $($deleteError.Exception.Message)")
        }
      } catch {
        $teardownProblems.Add("could not delete the temporary directory $doomed`: $($_.Exception.Message)")
      }
    }
  }
  # THE MARKER AND THE EXIT CODE, which this block previously had neither of. The harness reads the marker line
  # and the exit code, so a teardown problem has to produce both or it produces nothing.
  if ($teardownProblems.Count -gt 0) {
    Write-Output "MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_FAIL teardown left this workstation dirty: $($teardownProblems -join '; ')."
    exit 1
  }
}
