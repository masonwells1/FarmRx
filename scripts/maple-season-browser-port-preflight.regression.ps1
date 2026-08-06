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

  # Clear-MapleSeasonBrowserPort itself, executed. Everything above proves the preflight REFUSES; this
  # is the other function, the one that actually terminates a listener, and until now no regression ran
  # it at all - the force kill it performs was covered by reading its source. Both directions are
  # exercised against a real listening process: the owned direction must terminate it and release the
  # port, and the foreign direction must throw and leave it untouched.
  foreach ($clearCase in @(
    @{ Name = 'owned listener'; Root = $tempRoot; MustTerminate = $true }
    # A root that names a real tree this listener does not live in. The refusal is the safety-critical
    # direction: this function's kill is unconditional once the predicate says yes.
    @{ Name = 'foreign listener'; Root = (Join-Path ([IO.Path]::GetTempPath()) ("farmrx-not-this-tree-{0}" -f $suffix)); MustTerminate = $false }
  )) {
    $listenerScript = Join-Path $tempRoot 'listener.js'
    $readyFile = Join-Path $tempRoot 'listener-ready.txt'
    Set-Content -LiteralPath $listenerScript -Value $listenerSource -Encoding Ascii -NoNewline
    Remove-Item -LiteralPath $readyFile -ErrorAction SilentlyContinue
    $env:FARMRX_PREFLIGHT_READY_FILE = $readyFile
    $env:FARMRX_PREFLIGHT_BIND_ADDRESS = '127.0.0.1'
    $listenerProcess = Start-Process -FilePath $node -ArgumentList @("`"$listenerScript`"") -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $readyFile) -and -not $listenerProcess.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    Assert-True (Test-Path -LiteralPath $readyFile) "Cleanup regression listener for the $($clearCase.Name) case did not begin listening on port $port within twenty seconds."

    $clearFailure = $null
    try {
      Clear-MapleSeasonBrowserPort -Port $port -Root $clearCase.Root -Scenario $scenario
    } catch {
      $clearFailure = $_.Exception.Message
    }

    if ($clearCase.MustTerminate) {
      Assert-True ($null -eq $clearFailure) "Cleanup refused to terminate an owned listener on port $port. Got: $clearFailure"
      Assert-True $listenerProcess.HasExited "Cleanup reported success without terminating the owned listener on port $port."
      Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) "Cleanup left governed port $port listening after terminating its owned listener."
    } else {
      Assert-True ($clearFailure -ceq "$scenario found an unrecognized listener on governed port $port; refusing to terminate it.") "Cleanup did not refuse a foreign listener on port $port with the exact message. Got: $clearFailure"
      # The decisive assertion. A refusal that still killed the process would be the exact failure this
      # predicate exists to prevent, and an exception message alone would not reveal it.
      Assert-True (-not $listenerProcess.HasExited) "Cleanup terminated a foreign listener on port $port while reporting that it refused to."
      Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 1) "Cleanup disturbed a foreign listener on port $port."
      Stop-Process -Id $listenerProcess.Id -Force -ErrorAction SilentlyContinue
      $listenerProcess.WaitForExit(10000) | Out-Null
    }
    $released = [DateTime]::UtcNow.AddSeconds(10)
    while (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -ne 0 -and [DateTime]::UtcNow -lt $released) { Start-Sleep -Milliseconds 100 }
    Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) "Cleanup regression could not release port $port after the $($clearCase.Name) case."
    $listenerProcess = $null
  }

  # ONE port, TWO listeners - one owned, one foreign. This is the case the two cases above cannot reach,
  # because each of them puts a single listener on the port and the previous cleanup validated and killed
  # one listener at a time. MEASURED against the previous version: it terminated the OWNED listener and
  # then threw "refusing to terminate it" about the foreign one, so its refusal had already stopped a
  # process. The repair validates every listener before terminating any, and this case is what proves it.
  #
  # A port really can hold two listeners: one bound to 127.0.0.1 and one to ::1 are separate sockets, and
  # Get-NetTCPConnection returns both rows. The owned one binds ::1 because that is the row Windows was
  # measured to enumerate FIRST, and enumeration order is not creation order. The order is checked at run
  # time below rather than assumed: if the owned row is not first, the previous version would have refused
  # on the foreign row before reaching its defect, so the case would pass on broken code. It says so
  # instead of passing quietly.
  # A local starter rather than a pipeline: `Where-Object` to pick the two processes back out of a list
  # would put a shadowable cmdlet on the path of a safety-critical assertion, which is the shape this suite
  # spent two reviews removing. Two named variables need no selection step at all.
  function Start-MixedListener {
    param([Parameter(Mandatory)][string]$Script, [Parameter(Mandatory)][string]$Ready, [Parameter(Mandatory)][string]$Bind, [Parameter(Mandatory)][string]$Label)
    Set-Content -LiteralPath $Script -Value $listenerSource -Encoding Ascii -NoNewline
    Remove-Item -LiteralPath $Ready -ErrorAction SilentlyContinue
    $env:FARMRX_PREFLIGHT_READY_FILE = $Ready
    $env:FARMRX_PREFLIGHT_BIND_ADDRESS = $Bind
    $started = Start-Process -FilePath $node -ArgumentList @("`"$Script`"") -PassThru -WindowStyle Hidden
    $mixedProcesses.Add($started)
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $Ready) -and -not $started.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    Assert-True (Test-Path -LiteralPath $Ready) "Mixed-listener cleanup case could not start its $Label listener on port $port within twenty seconds."
    return $started
  }
  $mixedOwned = Start-MixedListener -Script (Join-Path $tempRoot 'mixed-owned-listener.js') -Ready (Join-Path $tempRoot 'mixed-owned-ready.txt') -Bind '::1' -Label 'owned'
  $mixedForeign = Start-MixedListener -Script (Join-Path $squatterRoot 'mixed-foreign-listener.js') -Ready (Join-Path $squatterRoot 'mixed-foreign-ready.txt') -Bind '127.0.0.1' -Label 'foreign'
  $mixedRows = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  Assert-True ($mixedRows.Count -eq 2) "Mixed-listener cleanup case needs one port held by two listeners; the listener table returned $($mixedRows.Count) rows, so it cannot tell a two-pass cleanup from a one-pass one."
  Assert-True ([int]$mixedRows[0].OwningProcess -eq $mixedOwned.Id) "Mixed-listener cleanup case requires the OWNED listener to be enumerated first, or a one-pass cleanup would refuse before reaching its defect and this case would pass on broken code. Windows returned pid $($mixedRows[0].OwningProcess) first and the owned listener is pid $($mixedOwned.Id); swap which address family each listener binds and re-run."

  $mixedFailure = $null
  try {
    Clear-MapleSeasonBrowserPort -Port $port -Root $tempRoot -Scenario $scenario
  } catch {
    $mixedFailure = $_.Exception.Message
  }
  Assert-True ($mixedFailure -ceq "$scenario found an unrecognized listener on governed port $port; refusing to terminate it.") "Mixed-listener cleanup did not refuse a port shared with a foreign listener using the exact message. Got: $mixedFailure"
  # The two decisive assertions. Either one failing is the F15 defect: a refusal that terminated something.
  Assert-True (-not $mixedOwned.HasExited) "Mixed-listener cleanup terminated its OWN listener on port $port and then reported that it refused to terminate anything; a refusal must validate every listener before terminating any."
  Assert-True (-not $mixedForeign.HasExited) "Mixed-listener cleanup terminated a FOREIGN listener on port $port while reporting that it refused to."
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 2) "Mixed-listener cleanup disturbed one of the two listeners on port $port."

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
  # a sibling directory that merely shares the root's name prefix. Test-MapleSeasonBrowserPortOwned
  # gates the force kill in Clear-MapleSeasonBrowserPort - `TerminateProcess` through an OS handle opened
  # before this check runs - so a true answer here would terminate somebody else's server.
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
  # rejecting only the empty root was not enough to catch that. True here authorizes the force kill.
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
  if ($null -eq $priorPort) { Remove-Item Env:FARMRX_SEASON_JANUARY_PORT -ErrorAction SilentlyContinue } else { $env:FARMRX_SEASON_JANUARY_PORT = $priorPort }
  if ($null -eq $priorReadyFile) { Remove-Item Env:FARMRX_PREFLIGHT_READY_FILE -ErrorAction SilentlyContinue } else { $env:FARMRX_PREFLIGHT_READY_FILE = $priorReadyFile }
  if ($null -eq $priorStartedFile) { Remove-Item Env:FARMRX_PREFLIGHT_STARTED_FILE -ErrorAction SilentlyContinue } else { $env:FARMRX_PREFLIGHT_STARTED_FILE = $priorStartedFile }
  if ($null -eq $priorBindAddress) { Remove-Item Env:FARMRX_PREFLIGHT_BIND_ADDRESS -ErrorAction SilentlyContinue } else { $env:FARMRX_PREFLIGHT_BIND_ADDRESS = $priorBindAddress }
  # Only ever stop the listeners this regression started itself.
  if ($null -ne $listenerProcess -and -not $listenerProcess.HasExited) {
    Stop-Process -Id $listenerProcess.Id -Force -ErrorAction SilentlyContinue
    $listenerProcess.WaitForExit(10000) | Out-Null
  }
  # The mixed-listener case holds two at once, and it is the one case that can fail with BOTH still
  # running - that is the property it asserts - so leaving them behind would occupy the port for whatever
  # ran next. Emptied on the success path, so this only fires when an assertion threw.
  foreach ($orphan in $mixedProcesses) {
    if ($null -eq $orphan -or $orphan.HasExited) { continue }
    Stop-Process -Id $orphan.Id -Force -ErrorAction SilentlyContinue
    $orphan.WaitForExit(10000) | Out-Null
  }
  foreach ($doomed in @($tempRoot, $squatterRoot)) {
    if (-not (Test-Path -LiteralPath $doomed)) { continue }
    $resolvedTemp = [IO.Path]::GetFullPath($doomed)
    $resolvedBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing port-preflight cleanup outside the temporary directory.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
