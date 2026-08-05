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
#   3. a leaked Farm Rx season server is diagnosed as a leak, not as a foreign squatter
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
      Name = 'leaked Farm Rx season server'
      Directory = $tempRoot
      BindAddress = '127.0.0.1'
      Expected = "$scenario cannot start: governed port $port was already held by a leaked Farm Rx season server ({0}) before this scenario ran. An earlier proof did not release it; stop that server and investigate the proof that left it behind."
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
    while (-not (Test-Path -LiteralPath $readyFile) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    Assert-True (Test-Path -LiteralPath $readyFile) "Port preflight regression never established its listener for the $($case.Name) case."

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
    $listenerProcess = $null
  }

  Write-Output 'MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_PASS'
  exit 0
} catch {
  Write-Output "MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_FAIL $($_.Exception.Message)"
  exit 1
} finally {
  if ($null -eq $priorPort) { Remove-Item Env:FARMRX_SEASON_JANUARY_PORT -ErrorAction SilentlyContinue } else { $env:FARMRX_SEASON_JANUARY_PORT = $priorPort }
  if ($null -eq $priorReadyFile) { Remove-Item Env:FARMRX_PREFLIGHT_READY_FILE -ErrorAction SilentlyContinue } else { $env:FARMRX_PREFLIGHT_READY_FILE = $priorReadyFile }
  if ($null -eq $priorStartedFile) { Remove-Item Env:FARMRX_PREFLIGHT_STARTED_FILE -ErrorAction SilentlyContinue } else { $env:FARMRX_PREFLIGHT_STARTED_FILE = $priorStartedFile }
  Remove-Item Env:FARMRX_PREFLIGHT_BIND_ADDRESS -ErrorAction SilentlyContinue
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
