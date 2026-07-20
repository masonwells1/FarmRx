$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$januaryProof = Join-Path $root 'scripts/verify-maple-january-disposable.ps1'
$februarySql = Join-Path $root 'tests/season/maple-2027-february.verify.sql'

if (-not $env:FARMRX_SEASON_OWNER_PASSWORD) {
  throw 'FARMRX_SEASON_OWNER_PASSWORD is required and must contain only the synthetic local fixture password.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the Maple February proof.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js/npm with npx is required for the Maple February browser proof.' }

$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }

Push-Location $root
try {
  # January owns the one reset. Its completed local database is intentionally retained for February.
  & powershell -NoProfile -ExecutionPolicy Bypass -File $januaryProof
  if ($LASTEXITCODE -ne 0) { throw 'Continuous Maple January prerequisite failed.' }

  $runningContainers = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $expectedContainer) {
    throw "Refusing February proof: expected disposable database container $expectedContainer is not running."
  }

  $env:DO_NOT_TRACK = '1'
  $previousErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $statusLines = @(& $supabase --profile supabase status -o env 2>$null)
    $statusExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorPreference }
  if ($statusExitCode -ne 0) { throw 'Could not read disposable local Supabase browser configuration.' }
  $status = @{}
  foreach ($line in $statusLines) {
    if ($line -match '^([A-Z0-9_]+)="?(.*?)"?$') { $status[$matches[1]] = $matches[2] }
  }
  if ($status['API_URL'] -ne 'http://127.0.0.1:55321') { throw 'Refusing February proof: local API URL is not the expected loopback endpoint.' }
  if (-not $status['PUBLISHABLE_KEY'] -or $status['PUBLISHABLE_KEY'] -notmatch '^sb_publishable_') {
    throw 'Refusing February proof: no browser-safe local publishable key was found.'
  }

  $env:VITE_LOCAL_SUPABASE_PROJECT_REF = 'farmrxlocalsimplicity2027'
  $env:VITE_LOCAL_SUPABASE_URL = $status['API_URL']
  $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY = $status['PUBLISHABLE_KEY']

  npx playwright test --config playwright.season-february.config.ts
  if ($LASTEXITCODE -ne 0) { throw 'Maple February browser scenario failed.' }

  Get-Content -Raw -LiteralPath $februarySql |
    docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off
  if ($LASTEXITCODE -ne 0) { throw 'Maple February post-browser database assertions failed.' }

  Write-Output 'MAPLE_2027_FEBRUARY_DISPOSABLE_PASS'
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Pop-Location
}
