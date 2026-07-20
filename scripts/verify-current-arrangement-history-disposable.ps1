$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$configPath = Join-Path $root 'supabase/config.toml'
$startProof = Join-Path $root 'scripts/verify-maple-season-start-disposable.ps1'
$historyProof = Join-Path $root 'tests/season/current-arrangement-history.verify.sql'

$config = Get-Content -Raw -LiteralPath $configPath
if ($config -notmatch ('(?m)^project_id\s*=\s*"' + [regex]::Escape($expectedProjectId) + '"\s*$')) {
  throw "Refusing reset: supabase/config.toml is not the expected disposable project $expectedProjectId."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the agreement-history proof.'
}
$runningContainers = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $expectedContainer) {
  throw "Refusing reset: expected disposable database container $expectedContainer is not running."
}

Push-Location $root
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $startProof
  if ($LASTEXITCODE -ne 0) { throw 'Canonical Maple start proof failed.' }

  Get-Content -Raw -LiteralPath $historyProof |
    docker exec -i $expectedContainer psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off
  if ($LASTEXITCODE -ne 0) { throw 'Current agreement history assertions failed.' }

  Write-Output 'CURRENT_ARRANGEMENT_HISTORY_DISPOSABLE_PASS'
} finally {
  Pop-Location
}
