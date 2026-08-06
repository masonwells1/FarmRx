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
  if (Test-Path -LiteralPath $tempRoot) {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $resolvedBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing timeout-regression cleanup outside the temporary directory.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
