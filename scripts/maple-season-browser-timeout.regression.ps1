$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'maple-season-browser.ps1')

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

$port = 4288
$priorPath = $env:PATH
$priorPort = $env:FARMRX_SEASON_JANUARY_PORT
$priorReadyFile = $env:FARMRX_MAPLE_TIMEOUT_READY_FILE
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-maple-browser-timeout-{0}" -f [Guid]::NewGuid().ToString('N'))
$fakeRunner = Join-Path $tempRoot 'fake-playwright.js'
$readyFile = Join-Path $tempRoot 'listener-ready.txt'

try {
  if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -ne 0) {
    throw "Timeout regression requires unused loopback port $port."
  }
  New-Item -ItemType Directory -Path $tempRoot -ErrorAction Stop | Out-Null
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
