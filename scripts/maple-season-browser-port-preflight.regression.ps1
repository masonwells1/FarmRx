$ErrorActionPreference = 'Stop'

# Governed-port preflight regression.
#
# Playwright runs every season config with reuseExistingServer:false, so a governed port that
# is already listening cannot be shared. Without a preflight the scenario launches anyway,
# burns its whole bounded timeout, and then dies inside the post-run cleanup refusal - which
# reads as if the scenario leaked the listener when a foreign process held the port first.
# This regression proves Invoke-MapleSeasonBrowserProof refuses before it starts anything,
# names the port variable that redirects it, and leaves the foreign listener alone.

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'maple-season-browser.ps1')

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

$port = 4289
$priorPort = $env:FARMRX_SEASON_JANUARY_PORT
$priorReadyFile = $env:FARMRX_PREFLIGHT_READY_FILE
$suffix = [Guid]::NewGuid().ToString('N')
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-maple-port-preflight-{0}" -f $suffix)
# The foreign listener lives outside the owned marker on purpose. If it sat inside $tempRoot
# its command line would satisfy the cleanup ownership test, and a regressed preflight would
# quietly terminate it instead of exposing the refusal.
$squatterRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-foreign-listener-{0}" -f $suffix)
$squatter = Join-Path $squatterRoot 'squatter.js'
$fakeRunner = Join-Path $tempRoot 'fake-playwright.js'
$readyFile = Join-Path $squatterRoot 'listener-ready.txt'
$startedSentinel = Join-Path $tempRoot 'runner-started.txt'
$squatterProcess = $null

try {
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) "Port preflight regression requires unused loopback port $port."
  New-Item -ItemType Directory -Path $tempRoot -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $squatterRoot -ErrorAction Stop | Out-Null

  # A listener Farm Rx does not own: it runs from its own directory, so its command line
  # contains neither the repository root nor the owned marker the cleanup test looks for.
  $squatterSource = @"
const fs = require('fs')
const net = require('net')
const server = net.createServer()
server.listen($port, '127.0.0.1', () => fs.writeFileSync(process.env.FARMRX_PREFLIGHT_READY_FILE, 'ready'))
setInterval(() => {}, 1000)
"@
  Set-Content -LiteralPath $squatter -Value $squatterSource -Encoding Ascii -NoNewline

  # If the preflight ever regresses, this runner starts and leaves a sentinel behind.
  $runnerSource = @"
const fs = require('fs')
fs.writeFileSync(process.env.FARMRX_PREFLIGHT_STARTED_FILE, 'started')
"@
  Set-Content -LiteralPath $fakeRunner -Value $runnerSource -Encoding Ascii -NoNewline

  $env:FARMRX_PREFLIGHT_READY_FILE = $readyFile
  $env:FARMRX_PREFLIGHT_STARTED_FILE = $startedSentinel
  $squatterProcess = Start-Process -FilePath 'node' -ArgumentList @($squatter) -PassThru -WindowStyle Hidden
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath $readyFile) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  Assert-True (Test-Path -LiteralPath $readyFile) 'Port preflight regression never established its foreign listener.'

  $env:FARMRX_SEASON_JANUARY_PORT = [string]$port
  $expected = "Maple preflight regression cannot start: governed port $port was already in use by node.exe (PID $($squatterProcess.Id)) before this scenario ran. Free that port or set FARMRX_SEASON_JANUARY_PORT to an unused port."

  $watch = [Diagnostics.Stopwatch]::StartNew()
  $message = $null
  try {
    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple preflight regression' -RunnerFile $fakeRunner -OwnedCommandMarker $tempRoot
  } catch {
    $message = $_.Exception.Message
  }
  $watch.Stop()

  Assert-True ($message -ceq $expected) "Port preflight did not report the occupied governed port accurately. Got: $message"
  # Fast means it never waited on the bounded browser timeout.
  Assert-True ($watch.Elapsed.TotalSeconds -lt 20) 'Port preflight did not fail before launching the browser scenario.'
  Assert-True (-not (Test-Path -LiteralPath $startedSentinel)) 'Port preflight started the browser runner despite an occupied governed port.'
  # The refusal must never escalate into terminating a process Farm Rx does not own.
  Assert-True (-not $squatterProcess.HasExited) 'Port preflight terminated a foreign listener it does not own.'
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 1) 'Port preflight disturbed the foreign listener on the governed port.'

  Write-Output 'MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_PASS'
  exit 0
} catch {
  Write-Output "MAPLE_SEASON_BROWSER_PORT_PREFLIGHT_REGRESSION_FAIL $($_.Exception.Message)"
  exit 1
} finally {
  if ($null -eq $priorPort) { Remove-Item Env:FARMRX_SEASON_JANUARY_PORT -ErrorAction SilentlyContinue } else { $env:FARMRX_SEASON_JANUARY_PORT = $priorPort }
  if ($null -eq $priorReadyFile) { Remove-Item Env:FARMRX_PREFLIGHT_READY_FILE -ErrorAction SilentlyContinue } else { $env:FARMRX_PREFLIGHT_READY_FILE = $priorReadyFile }
  Remove-Item Env:FARMRX_PREFLIGHT_STARTED_FILE -ErrorAction SilentlyContinue
  # Only ever stop the listener this regression started itself.
  if ($null -ne $squatterProcess -and -not $squatterProcess.HasExited) {
    Stop-Process -Id $squatterProcess.Id -Force -ErrorAction SilentlyContinue
    $squatterProcess.WaitForExit(10000) | Out-Null
  }
  foreach ($doomed in @($tempRoot, $squatterRoot)) {
    if (-not (Test-Path -LiteralPath $doomed)) { continue }
    $resolvedTemp = [IO.Path]::GetFullPath($doomed)
    $resolvedBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing port-preflight cleanup outside the temporary directory.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
