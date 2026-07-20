$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$configPath = Join-Path $root 'supabase/config.toml'
$fixturePath = Join-Path $root 'tests/season/maple-2027-start.sql'
$proofPath = Join-Path $root 'tests/season/maple-2027-start.verify.sql'
$staticVerifierPath = Join-Path $root 'scripts/verify-maple-season-start.mjs'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the Maple season-start proof.'
}

$supabase = if ($env:SUPABASE_GO_BINARY) {
  $env:SUPABASE_GO_BINARY
} else {
  (Get-Command supabase -ErrorAction Stop).Source
}

$config = Get-Content -Raw -LiteralPath $configPath
if ($config -notmatch ('(?m)^project_id\s*=\s*"' + [regex]::Escape($expectedProjectId) + '"\s*$')) {
  throw "Refusing reset: supabase/config.toml is not the expected disposable project $expectedProjectId."
}

$runningContainers = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker containers.' }
if ($runningContainers -notcontains $expectedContainer) {
  throw "Refusing reset: expected disposable database container $expectedContainer is not running."
}

Push-Location $root
try {
  node $staticVerifierPath
  if ($LASTEXITCODE -ne 0) { throw 'Maple season-start static contract failed.' }

  $env:DO_NOT_TRACK = '1'
  & $supabase --profile supabase db reset --local --no-seed --yes
  if ($LASTEXITCODE -ne 0) { throw 'Disposable local Supabase reset failed.' }

  Get-Content -Raw -LiteralPath $fixturePath |
    docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw 'Maple January fixture failed to apply.' }

  Get-Content -Raw -LiteralPath $proofPath |
    docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off
  if ($LASTEXITCODE -ne 0) { throw 'Maple January database assertions failed.' }

  Write-Output 'MAPLE_2027_START_DISPOSABLE_PASS'
} finally {
  Pop-Location
}
