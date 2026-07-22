$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'maple-season-browser.ps1')

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

$port = 4288
$priorPath = $env:PATH
$priorPort = $env:FARMRX_SEASON_JANUARY_PORT
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-maple-browser-timeout-{0}" -f [Guid]::NewGuid().ToString('N'))
$fakeNpx = Join-Path $tempRoot 'npx.cmd'
$readyFile = Join-Path $tempRoot 'listener-ready.txt'
$node = (Get-Command node.exe -ErrorAction Stop).Source

try {
  if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -ne 0) {
    throw "Timeout regression requires unused loopback port $port."
  }
  New-Item -ItemType Directory -Path $tempRoot -ErrorAction Stop | Out-Null
  $batch = @"
@echo off
"$node" -e "const fs=require('fs'),net=require('net');const server=net.createServer();server.listen(Number(process.argv[1]),'127.0.0.1',()=>fs.writeFileSync(process.argv[2],'ready'));setInterval(()=>{},1000)" $port "$readyFile" "$root"
"@
  Set-Content -LiteralPath $fakeNpx -Value $batch -Encoding Ascii -NoNewline
  $env:PATH = "$tempRoot;$priorPath"
  $env:FARMRX_SEASON_JANUARY_PORT = [string]$port

  $started = [Diagnostics.Stopwatch]::StartNew()
  $timedOut = $false
  try {
    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple timeout regression' -TimeoutMilliseconds 3000
  } catch {
    $timedOut = $_.Exception.Message -ceq 'Maple timeout regression browser scenario exceeded its bounded process limit after verified cleanup.'
  }
  $started.Stop()

  Assert-True $timedOut 'Browser timeout regression did not reach the verified-timeout result.'
  Assert-True (Test-Path -LiteralPath $readyFile) 'Browser timeout regression never created its child listener.'
  Assert-True ($started.Elapsed.TotalSeconds -lt 20) 'Browser timeout cleanup exceeded its bounded regression window.'
  Assert-True (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) 'Browser timeout cleanup left its governed port listening.'
  Write-Output 'MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_PASS'
} finally {
  $env:PATH = $priorPath
  if ($null -eq $priorPort) { Remove-Item Env:FARMRX_SEASON_JANUARY_PORT -ErrorAction SilentlyContinue } else { $env:FARMRX_SEASON_JANUARY_PORT = $priorPort }
  if (Test-Path -LiteralPath $tempRoot) {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $resolvedBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing timeout-regression cleanup outside the temporary directory.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
