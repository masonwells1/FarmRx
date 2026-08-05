$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$configPath = Join-Path $root 'supabase/config.toml'
$fixturePath = Join-Path $root 'tests/season/maple-2027-start.sql'
$proofPath = Join-Path $root 'tests/season/program-assignment-identities.verify.sql'
$credentialHelperPath = Join-Path $root 'scripts/maple-season-credential.ps1'

# The starting fixture derives the season owner password from psql variable
# :'season_owner_password' rather than carrying a literal one. Only Invoke-MapleSeasonSqlFile
# supplies that variable, so this proof must apply the fixture through the same helper the
# Maple runners use.
. $credentialHelperPath

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the Programs identity proof.' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }
$config = Get-Content -Raw -LiteralPath $configPath
if ($config -notmatch ('(?m)^project_id\s*=\s*"' + [regex]::Escape($expectedProjectId) + '"\s*$')) {
  throw "Refusing reset: supabase/config.toml is not the expected disposable project $expectedProjectId."
}
$runningContainers = @(docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $expectedContainer) {
  throw "Refusing reset: expected disposable database container $expectedContainer is not running."
}

Push-Location $root
try {
  $env:DO_NOT_TRACK = '1'
  Enter-MapleSeasonCredential
  try {
    & $supabase --profile supabase db reset --local --no-seed --yes
    if ($LASTEXITCODE -ne 0) { throw 'Disposable local Supabase reset failed.' }
    # The fixture's own failure can only be named, not quoted: Invoke-MapleSeasonSqlFile throws the
    # captured psql output, and the fixture payload carries the generated season owner password, so
    # relaying it here could copy that credential into an evidence log.
    try { $null = Invoke-MapleSeasonSqlFile -Path $fixturePath -ExpectedContainer $expectedContainer }
    catch { throw 'Maple starting fixture failed to apply.' }
    # The assertion file is different: it contains no password, crypt call, or reference to
    # :'season_owner_password', so forwarding the database's own error carries no credential. A bare
    # label here would leave the operator with strictly less diagnosis than the raw psql pipe this
    # script used to have, which would make the repair a regression in everything but correctness.
    try { $null = Invoke-MapleSeasonSqlFile -Path $proofPath -ExpectedContainer $expectedContainer }
    catch { throw "Programs identity assertions failed: $($_.Exception.Message)" }
  } finally {
    Exit-MapleSeasonCredential
  }
  Write-Output 'PROGRAM_ASSIGNMENT_IDENTITIES_DISPOSABLE_PASS'
} finally {
  Pop-Location
}
