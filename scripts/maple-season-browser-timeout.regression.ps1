$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'maple-season-browser.ps1')

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

$port = 4288
$successPort = 4289
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
  if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -ne 0) {
    throw "Timeout regression requires unused loopback port $port."
  }
  if (@(Get-NetTCPConnection -LocalPort $successPort -State Listen -ErrorAction SilentlyContinue).Count -ne 0) {
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
  Assert-True (@(Get-NetTCPConnection -LocalPort $successPort -State Listen -ErrorAction SilentlyContinue).Count -eq 0) 'Browser launch regression left its governed port listening after a clean exit.'

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
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) 'Browser timeout cleanup left its governed port listening.'

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
  $orphanPort = 4290
  if (@(Get-NetTCPConnection -LocalPort $orphanPort -State Listen -ErrorAction SilentlyContinue).Count -ne 0) {
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
  if (-not $orphanSource.Contains($orphanNeedle)) {
    throw 'Browser orphan drill could not find the wait it injects its failure at; its needle is stale and the drill would prove nothing.'
  }
  $orphanInjection = @(
    '    [void]$process.WaitForExit(30000)',
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
  Assert-True (@(Get-NetTCPConnection -LocalPort $orphanPort -State Listen -ErrorAction SilentlyContinue).Count -eq 0) 'Browser orphan drill left a detached dev server holding its governed port after a launch failure that landed with the parent already exited.'
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
  foreach ($stranded in @(Get-NetTCPConnection -LocalPort 4290 -State Listen -ErrorAction SilentlyContinue)) {
    $strandedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$stranded.OwningProcess)" -ErrorAction SilentlyContinue
    if ($null -eq $strandedProcess) { continue }
    if (([string]$strandedProcess.CommandLine).Contains($tempRoot)) {
      Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED pid $($strandedProcess.ProcessId)"
      Stop-Process -Id ([int]$strandedProcess.ProcessId) -Force -ErrorAction SilentlyContinue
    }
  }
  if (Test-Path -LiteralPath $tempRoot) {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $resolvedBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing timeout-regression cleanup outside the temporary directory.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
