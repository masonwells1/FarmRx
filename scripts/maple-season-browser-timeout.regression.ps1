$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'maple-season-browser.ps1')

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

$port = 4288
$successPort = 4289
# DECLARED HERE, WITH THE OTHER PORTS, because the cleanup in the finally has to name the same port the orphan
# case used. It was assigned inside the try and the safety net hard-coded 4290 alongside it, so changing the
# case's port alone would have left the safety net watching a port nothing ran on while every pin stayed green.
# A fresh-context review found that. One declaration, read by both.
$orphanPort = 4290
# Whether the safety net had to report anything. The suite prints PASS and exits 0 from inside the try, and the
# markers below are output only, so a run that stranded a process could announce success with the marker sitting
# in the same output. MEASURED on this workstation: `exit` inside a finally overrides an exit code already on its
# way out (a probe exiting 0 in the try and 3 in the finally exits 3), which is what makes the override below real.
$strandedReported = $false
$priorPath = $env:PATH
$priorPort = $env:FARMRX_SEASON_JANUARY_PORT
$priorReadyFile = $env:FARMRX_MAPLE_TIMEOUT_READY_FILE
$priorOrphanReady = $env:FARMRX_MAPLE_ORPHAN_READY_FILE
$priorOrphanChild = $env:FARMRX_MAPLE_ORPHAN_CHILD
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-maple-browser-timeout-{0}" -f [Guid]::NewGuid().ToString('N'))
$fakeRunner = Join-Path $tempRoot 'fake-playwright.js'
$readyFile = Join-Path $tempRoot 'listener-ready.txt'
$successRunner = Join-Path $tempRoot 'fake-playwright-success.js'
$successReadyFile = Join-Path $tempRoot 'success-ready.txt'

try {
  if (@(Get-MapleSeasonPortListener -Port $port -Scenario 'Maple timeout regression preflight').Count -ne 0) {
    throw "Timeout regression requires unused loopback port $port."
  }
  if (@(Get-MapleSeasonPortListener -Port $successPort -Scenario 'Maple launch success regression preflight').Count -ne 0) {
    throw "Timeout regression requires unused loopback port $successPort."
  }
  New-Item -ItemType Directory -Path $tempRoot -ErrorAction Stop | Out-Null

  # CASE ONE, and it is here because it was MISSING. The timeout branch below is the dramatic one, and it was
  # the only branch of Invoke-MapleSeasonBrowserProof executed anywhere in this repository - the branch every
  # one of the twelve Maple scenarios actually takes, where the child exits 0 and the function returns, was
  # carried by inspection alone. That branch has since been wrapped in a try/finally holding an OS handle
  # opened to reserve the launched process id, which is exactly the shape of change that can break a success
  # path while every static pin stays green. So drive it: a child that binds the governed port, releases it,
  # and exits 0 must leave this function returning quietly, with the port free and no handle-leak warning.
  $successChild = @"
const fs = require('fs')
const net = require('net')
const server = net.createServer()
server.listen(Number(process.env.FARMRX_SEASON_JANUARY_PORT), '127.0.0.1', () => {
  fs.writeFileSync(process.env.FARMRX_MAPLE_TIMEOUT_READY_FILE, 'ready')
  server.close(() => process.exit(0))
})
"@
  Set-Content -LiteralPath $successRunner -Value $successChild -Encoding Ascii -NoNewline
  $env:FARMRX_SEASON_JANUARY_PORT = [string]$successPort
  $env:FARMRX_MAPLE_TIMEOUT_READY_FILE = $successReadyFile
  $successFailure = $null
  $successWarnings = @()
  try {
    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple launch success regression' -TimeoutMilliseconds 30000 -RunnerFile $successRunner -OwnedCommandMarker $tempRoot -WarningVariable successWarnings
  } catch {
    $successFailure = $_.Exception.Message
  }
  Assert-True ($null -eq $successFailure) "Browser launch regression failed a scenario whose child exited zero: $successFailure"
  Assert-True (Test-Path -LiteralPath $successReadyFile) 'Browser launch regression never created its child listener.'
  # A leaked launch handle keeps the kernel reserving that process id for the life of the session, and the
  # only way it is ever reported is a warning. Silence here is the assertion.
  Assert-True ($successWarnings.Count -eq 0) "Browser launch regression leaked the handle pinning its child: $($successWarnings -join '; ')"
  Assert-True (@(Get-MapleSeasonPortListener -Port $successPort -Scenario 'Maple launch success regression').Count -eq 0) 'Browser launch regression left its governed port listening after a clean exit.'

  # CASE TWO: the bounded timeout, its force kill, and the verified cleanup that must follow.
  $runner = @"
const fs = require('fs')
const net = require('net')
const server = net.createServer()
server.listen(Number(process.env.FARMRX_SEASON_JANUARY_PORT), '127.0.0.1', () => fs.writeFileSync(process.env.FARMRX_MAPLE_TIMEOUT_READY_FILE, 'ready'))
setInterval(() => {}, 1000)
"@
  Set-Content -LiteralPath $fakeRunner -Value $runner -Encoding Ascii -NoNewline
  $env:FARMRX_SEASON_JANUARY_PORT = [string]$port
  $env:FARMRX_MAPLE_TIMEOUT_READY_FILE = $readyFile

  $started = [Diagnostics.Stopwatch]::StartNew()
  $timedOut = $false
  try {
    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple timeout regression' -TimeoutMilliseconds 3000 -RunnerFile $fakeRunner -OwnedCommandMarker $tempRoot
  } catch {
    $timedOut = $_.Exception.Message -ceq 'Maple timeout regression browser scenario exceeded its bounded process limit after verified cleanup.'
  }
  $started.Stop()

  Assert-True $timedOut 'Browser timeout regression did not reach the verified-timeout result.'
  Assert-True (Test-Path -LiteralPath $readyFile) 'Browser timeout regression never created its child listener.'
  Assert-True ($started.Elapsed.TotalSeconds -lt 20) 'Browser timeout cleanup exceeded its bounded regression window.'
  Assert-True (@(Get-MapleSeasonPortListener -Port $port -Scenario 'Maple timeout regression').Count -eq 0) 'Browser timeout cleanup left its governed port listening.'

  # CASE THREE: THE ORPHAN. This is the one case where the governed port outlives the process this function
  # launched, and a fresh-context review found that the salvage in the launch finally could not reach it. The
  # port release lived inside `if (-not $process.HasExited)`, which asks whether the PARENT is alive - a
  # different question from whether the port is held, because the parent is a node runner that SPAWNS the dev
  # server that does the listening. So a launch-side failure landing after the parent exited found HasExited
  # true, released nothing, and left a live listener on the governed port; every later scenario on that port
  # then refused to start and blamed the wrong thing.
  #
  # Reaching that state on purpose needs a launch-side failure AFTER the parent is gone, and no environment
  # knob produces one, so the failure is INJECTED into a copy of the helper - the same technique the ownership
  # regression uses to gut its predicate. The injection replaces the wait with a wait-then-throw, which makes
  # the ordering deterministic rather than a race: the throw cannot happen until the parent has exited, and the
  # parent does not exit until its detached grandchild has the governed port bound and has said so in a file.
  if (@(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill preflight').Count -ne 0) {
    throw "Timeout regression requires unused loopback port $orphanPort."
  }
  $orphanRunner = Join-Path $tempRoot 'fake-playwright-orphan.js'
  $orphanListener = Join-Path $tempRoot 'orphan-listener.js'
  $orphanReadyFile = Join-Path $tempRoot 'orphan-ready.txt'
  $orphanScript = Join-Path $tempRoot 'maple-season-browser-orphan-drill.ps1'
  # The grandchild: binds the governed port, announces it, and stays up. Its command line names a path inside
  # the owned marker and its image is node, so the port cleanup must claim it - that is what is being tested.
  $orphanListenerSource = @"
const fs = require('fs')
const net = require('net')
const server = net.createServer()
server.listen(Number(process.env.FARMRX_SEASON_JANUARY_PORT), '127.0.0.1', () => {
  fs.writeFileSync(process.env.FARMRX_MAPLE_ORPHAN_READY_FILE, 'ready')
})
setInterval(() => {}, 1000)
"@
  # The parent: spawns the grandchild DETACHED and unreferenced so it survives, waits until the port is
  # actually bound, then exits zero and leaves it behind.
  $orphanRunnerSource = @"
const fs = require('fs')
const cp = require('child_process')
const child = cp.spawn(process.execPath, [process.env.FARMRX_MAPLE_ORPHAN_CHILD], { detached: true, stdio: 'ignore' })
child.unref()
const settle = () => {
  if (fs.existsSync(process.env.FARMRX_MAPLE_ORPHAN_READY_FILE)) { process.exit(0) }
  setTimeout(settle, 25)
}
settle()
"@
  Set-Content -LiteralPath $orphanListener -Value $orphanListenerSource -Encoding Ascii -NoNewline
  Set-Content -LiteralPath $orphanRunner -Value $orphanRunnerSource -Encoding Ascii -NoNewline
  $orphanSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'maple-season-browser.ps1') -Raw
  $orphanNeedle = '    $completed = $process.WaitForExit($TimeoutMilliseconds)'
  # EXACTLY ONE OCCURRENCE, not at least one. Contains() was the whole check, and .Replace() patches EVERY match,
  # so a second occurrence anywhere in the helper would have injected this throw into a path this case never
  # reasons about while the case still printed PASS. A fresh-context review found it. The count is the refusal:
  # nought means the needle went stale and the copy under test is the unmodified helper, more than one means the
  # injection is not the single one described below, and neither may be reported as a proof of anything.
  $orphanNeedleCount = ([regex]::Matches($orphanSource, [regex]::Escape($orphanNeedle))).Count
  if ($orphanNeedleCount -ne 1) {
    throw "Browser orphan drill needs exactly one occurrence of the wait it injects its failure at and found $orphanNeedleCount; its needle is stale and the drill would prove nothing."
  }
  # THE WAIT'S BOOLEAN IS READ, not discarded. [void] threw it away, so the injected message could announce
  # "after the parent exited" having waited out thirty seconds with the parent still running - and the premise
  # this entire case rests on was carried by a sentence that could not fail. A fresh-context review found it. A
  # wait that does not complete now throws a DIFFERENT message, which the injected-failure assertion below
  # rejects by name, so the case fails instead of passing on an unproven premise.
  $orphanInjection = @(
    '    if (-not $process.WaitForExit(30000)) { throw "$Scenario launch drill could not confirm its parent exited, so it proves nothing." }',
    '    throw "$Scenario launch drill failed on purpose after the parent exited."'
  ) -join "`n"
  Set-Content -LiteralPath $orphanScript -Value $orphanSource.Replace($orphanNeedle, $orphanInjection) -Encoding UTF8
  . $orphanScript
  $env:FARMRX_SEASON_JANUARY_PORT = [string]$orphanPort
  $env:FARMRX_MAPLE_ORPHAN_READY_FILE = $orphanReadyFile
  $env:FARMRX_MAPLE_ORPHAN_CHILD = $orphanListener
  $orphanFailure = $null
  $orphanWarnings = @()
  try {
    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple orphan drill' -TimeoutMilliseconds 30000 -RunnerFile $orphanRunner -OwnedCommandMarker $tempRoot -WarningVariable orphanWarnings
  } catch {
    $orphanFailure = $_.Exception.Message
  }
  Assert-True (Test-Path -LiteralPath $orphanReadyFile) 'Browser orphan drill never got its detached listener onto the governed port, so it proved nothing.'
  # Assert the INJECTED failure came out, not some other one. Without this the case passes on any early throw -
  # including one raised before the parent exited, which is not the state being tested.
  Assert-True ($orphanFailure -ceq 'Maple orphan drill launch drill failed on purpose after the parent exited.') "Browser orphan drill did not reach its injected launch failure: $orphanFailure"
  # THE ASSERTION THIS CASE EXISTS FOR. The parent is gone and the launch path failed; the governed port must
  # still have been released, because the thing holding it was never the parent.
  Assert-True (@(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill').Count -eq 0) 'Browser orphan drill left a detached dev server holding its governed port after a launch failure that landed with the parent already exited.'
  # Silence again: a salvage that could not release the port reports it only as a footnote, so a warning here
  # means the release was attempted and failed, which is a different defect from never attempting it.
  Assert-True ($orphanWarnings.Count -eq 0) "Browser orphan drill could not complete its salvage: $($orphanWarnings -join '; ')"

  Write-Output 'MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_PASS'
  exit 0
} catch {
  # Report through a marker and a native exit code, the same way the port-preflight regression does.
  # This regression used to throw instead, which made its caller's $LASTEXITCODE check vacuous - it
  # was reading whatever native command ran before this one.
  Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_FAIL $($_.Exception.Message)"
  exit 1
} finally {
  $env:PATH = $priorPath
  if ($null -eq $priorPort) { Remove-Item Env:FARMRX_SEASON_JANUARY_PORT -ErrorAction SilentlyContinue } else { $env:FARMRX_SEASON_JANUARY_PORT = $priorPort }
  if ($null -eq $priorReadyFile) { Remove-Item Env:FARMRX_MAPLE_TIMEOUT_READY_FILE -ErrorAction SilentlyContinue } else { $env:FARMRX_MAPLE_TIMEOUT_READY_FILE = $priorReadyFile }
  if ($null -eq $priorOrphanReady) { Remove-Item Env:FARMRX_MAPLE_ORPHAN_READY_FILE -ErrorAction SilentlyContinue } else { $env:FARMRX_MAPLE_ORPHAN_READY_FILE = $priorOrphanReady }
  if ($null -eq $priorOrphanChild) { Remove-Item Env:FARMRX_MAPLE_ORPHAN_CHILD -ErrorAction SilentlyContinue } else { $env:FARMRX_MAPLE_ORPHAN_CHILD = $priorOrphanChild }
  # THE ORPHAN DRILL DELIBERATELY CREATES A PROCESS THAT SURVIVES ITS PARENT, so this suite owes the
  # workstation a guarantee that a FAILING run does not leave one behind - including a run that failed because
  # the repair under test is absent. Terminate only a listener whose command line names a path inside this
  # suite's own temporary directory: this is a last resort in a test, not a second ownership predicate, so it
  # refuses anything it cannot positively tie to a file it created itself.
  # FAIL CLOSED EVEN HERE. Every listener read in this file used -ErrorAction SilentlyContinue, so a listener
  # table that could not be queried answered "nothing is listening" - and three of those reads were the
  # ASSERTIONS that prove the repairs, which means a broken query could have reported the orphan case clean while
  # a dev server held the port. Get-MapleSeasonPortListener is the fail-closed probe the helper already carries
  # and returns empty only for the one measured not-found error. In this finally its throw must not escape and
  # replace the run's verdict, so it is caught and reported as its own marker.
  $strandedListeners = @()
  try { $strandedListeners = @(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill cleanup') }
  catch {
    $strandedReported = $true
    Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED_UNREADABLE ${orphanPort}: $($_.Exception.Message)"
  }
  foreach ($stranded in $strandedListeners) {
    $strandedId = [int]$stranded.OwningProcess
    # A PROCESS ID IS NOT DURABLE, and this branch force kills by one. The CIM read that AUTHORIZED the kill and
    # the Stop-Process that performed it were two separate lookups of the same number, so the owner could exit
    # between them and Windows could reissue that number to a process this suite never created - the exact hazard
    # the helper under test was hardened against, reintroduced inside the test that guards it.
    #
    # The first repair said "Get-Process returns an object holding an OS handle" and a fresh-context review was
    # right that it does not - this repository had already MEASURED the opposite in the helper under test, and it
    # was measured again here: haveProcessHandle is False after Get-Process -Id and still False after reading
    # .HasExited, so .Kill() re-resolves the id at call time and the reservation the comment claimed never
    # existed. Reading .Handle is what opens one, measured True immediately afterwards, and the kernel reserves
    # the id until that handle closes. A handle that cannot be opened means this refuses to kill at all rather
    # than killing by a bare number.
    $strandedHandle = $null
    try {
      $strandedHandle = Get-Process -Id $strandedId -ErrorAction Stop
      $null = $strandedHandle.Handle
    } catch { $strandedHandle = $null }
    if ($null -eq $strandedHandle) { continue }
    $strandedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $strandedId" -ErrorAction SilentlyContinue
    if ($null -eq $strandedProcess) { continue }
    # A PATH BOUNDARY, NOT A SUBSTRING. .Contains($tempRoot) also accepted any sibling directory whose name
    # merely BEGINS with this one's - `farmrx-maple-browser-timeout-<guid>-foreign\runner.js` contains
    # `farmrx-maple-browser-timeout-<guid>` - so an unrelated process could be classified as this suite's own and
    # force-killed. A fresh-context review found it. The marker is the directory plus its separator, which no
    # sibling name can satisfy.
    $ownedPrefix = $tempRoot + [IO.Path]::DirectorySeparatorChar
    if (-not ([string]$strandedProcess.CommandLine).Contains($ownedPrefix)) { continue }
    $strandedReported = $true
    Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED pid $strandedId"
    # THE KILL IS VERIFIED, not merely attempted. -ErrorAction SilentlyContinue with no wait and no re-read let
    # this announce a kill it had not performed, then delete the temporary directory that was the only thing
    # tying the survivor to this suite, and exit as though the workstation were clean.
    try { $strandedHandle.Kill(); [void]$strandedHandle.WaitForExit(10000) }
    catch { Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED_KILL_FAILED pid ${strandedId}: $($_.Exception.Message)" }
    if (-not $strandedHandle.HasExited) { Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED_ALIVE pid $strandedId" }
  }
  # The port, read last and independently of the loop above, and named by the SAME variable the case used. A
  # survivor this suite refused to claim still leaves the port held, and the next run needs to be told that by
  # this run rather than discovering it as a preflight refusal it cannot explain.
  $strandedPortStillHeld = $true
  try { $strandedPortStillHeld = @(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill cleanup').Count -ne 0 }
  catch { $strandedPortStillHeld = $true }
  if ($strandedPortStillHeld) {
    $strandedReported = $true
    Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED_PORT_STILL_HELD $orphanPort"
  }
  if (Test-Path -LiteralPath $tempRoot) {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $resolvedBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing timeout-regression cleanup outside the temporary directory.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
  # THE MARKERS HAVE TO BE ABLE TO FAIL THE RUN. Every line above is output only, and the success path prints PASS
  # and `exit 0` inside the try, BEFORE this finally runs - so a run that stranded a live dev server on the
  # workstation could announce PASS, exit 0, and leave the evidence sitting in the same output for a caller that
  # only reads the exit code. A fresh-context review found that. MEASURED on this workstation: a script printing
  # PASS and `exit 0` in its try and `exit 3` in its finally exits 3, so an exit here does override the code
  # already on its way out. Last statement in the block, after the temporary directory is gone.
  if ($strandedReported) {
    Write-Output 'MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_FAIL the orphan drill safety net had to report a stranded process or a port it could not clear, so this run did not leave the workstation clean.'
    exit 1
  }
}
