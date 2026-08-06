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

  # Ownership boundary, asserted directly. The listener cases above can only put a process clearly
  # inside the owned root or clearly outside it, so they cannot reach the case that matters most:
  # a sibling directory that merely shares the root's name prefix. Test-MapleSeasonBrowserPortOwned
  # gates the Stop-Process in Clear-MapleSeasonBrowserPort, so a true answer here would terminate
  # somebody else's server.
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
  # A root that does not name a directory under a drive or share is too broad to identify one tree,
  # and rejecting only the empty root was not enough to catch that. Each of these answered true
  # against an unrelated listener before the root-shape check existed, and true here authorizes
  # Stop-Process: 'C:\' trims to 'C:', which every absolute path on that drive continues with a
  # separator - a legal boundary - so it claimed every node process on the machine; '.' matched the
  # dot in `node .`; a lone space matched the space in nearly any command line.
  $unrelatedListener = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\Other\app.js"' }
  foreach ($overBroadRoot in @('C:\', 'C:', 'C:/', '.', ' ', 'FarmRx', '\\server\share')) {
    Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $unrelatedListener -Root $overBroadRoot)) "Ownership test did not fail closed for the over-broad root '$overBroadRoot'."
  }
  # A non-string root must fail closed rather than throw. Dropping the [string] cast from the
  # parameter sent an integer straight into .Replace() and raised a method-not-found error, which is
  # the one answer the callers cannot use - they depend on this function returning false.
  Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $unrelatedListener -Root 4174)) 'Ownership test did not fail closed for a non-string root.'
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

  Write-Output 'MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_PASS'
  exit 0
} catch {
  Write-Output "MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_FAIL $($_.Exception.Message)"
  exit 1
} finally {
  if ($null -eq $priorPort) { Remove-Item Env:FARMRX_SEASON_JANUARY_PORT -ErrorAction SilentlyContinue } else { $env:FARMRX_SEASON_JANUARY_PORT = $priorPort }
  if ($null -eq $priorReadyFile) { Remove-Item Env:FARMRX_PREFLIGHT_READY_FILE -ErrorAction SilentlyContinue } else { $env:FARMRX_PREFLIGHT_READY_FILE = $priorReadyFile }
  if ($null -eq $priorStartedFile) { Remove-Item Env:FARMRX_PREFLIGHT_STARTED_FILE -ErrorAction SilentlyContinue } else { $env:FARMRX_PREFLIGHT_STARTED_FILE = $priorStartedFile }
  if ($null -eq $priorBindAddress) { Remove-Item Env:FARMRX_PREFLIGHT_BIND_ADDRESS -ErrorAction SilentlyContinue } else { $env:FARMRX_PREFLIGHT_BIND_ADDRESS = $priorBindAddress }
  # Only ever stop the listener this regression started itself.
  if ($null -ne $listenerProcess -and -not $listenerProcess.HasExited) {
    Stop-Process -Id $listenerProcess.Id -Force -ErrorAction SilentlyContinue
    $listenerProcess.WaitForExit(10000) | Out-Null
  }
  foreach ($doomed in @($tempRoot, $squatterRoot)) {
    if (-not (Test-Path -LiteralPath $doomed)) { continue }
    $resolvedTemp = [IO.Path]::GetFullPath($doomed)
    $resolvedBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing port-preflight cleanup outside the temporary directory.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
