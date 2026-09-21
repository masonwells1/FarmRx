$ErrorActionPreference = 'Stop'
$name = "farmrx-fs-persist-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the disposable Friction Sweep persistence proof but is not available on PATH.'
}

function Invoke-Probe([string]$sql, [string]$failure) {
  $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw $failure }
}

function Invoke-ProbeExpecting([string]$sql, [string]$token, [string]$failure) {
  $output = $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable 2>&1
  if ($LASTEXITCODE -ne 0 -or (($output -join "`n") -notmatch [regex]::Escape($token))) { throw $failure }
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Disposable postgres:17 did not become ready.' }

  Invoke-Probe "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;" 'Disposable Friction Sweep persistence bootstrap failed.'

  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' |
    Sort-Object Name |
    ForEach-Object {
      Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)"
    }

  # The assertions live in one SQL file shared with scripts/verify-fs-persist-disposable.sh (Linux twin).
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/fs-persist-disposable-assertions.sql')) 'FS_PERSIST_DISPOSABLE_PASS' 'Friction Sweep persistence assertions failed.'
  # Initiative FD-1 (Today) reads only existing rows; this asserts the row-level rules Today depends on, in the same database.
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/fd-today-role-assertions.sql')) 'FD_TODAY_DISPOSABLE_PASS' 'Today role assertions failed.'
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/gl1-mars-feed-assertions.sql')) 'GL1_MARS_FEED_DISPOSABLE_PASS' 'GL-1 MARS feed assertions failed.'
  # Initiative GL-2 (alert truth): crop-year eligibility and the feed's one permitted effect.
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/gl2-alert-eligibility-assertions.sql')) 'GL2_ALERT_ELIGIBILITY_DISPOSABLE_PASS' 'GL-2 alert eligibility assertions failed.'
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/gl3-contract-edit-delete-assertions.sql')) 'GL3_CONTRACT_EDIT_DELETE_DISPOSABLE_PASS' 'GL-3b contract edit/delete assertions failed.'
  # Initiative LD-1 (the load record): the ticket, its one write path, and the void that keeps it.
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/ld1-grain-loads-assertions.sql')) 'LD1_GRAIN_LOADS_DISPOSABLE_PASS' 'LD-1 grain loads assertions failed.'
  # Migration 0040's rules, ported so a development machine checks them too. Running the same file
  # here keeps CI enforcing the three rules the port added that verify-0040-disposable.ps1 lacks:
  # the live storage guard (0040's own copy is dead code), the one client-updatable table whose
  # farm_id is not blocked by prevent_farm_move, and the pin that it stays the only one.
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/epoch-fencing-assertions.sql')) 'EPOCH_FENCING_DISPOSABLE_PASS' '0040 epoch fencing assertions failed.'
  # Migration 0033's rules, ported the same way and for the same reason.
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/bin-and-contract-truth-assertions.sql')) 'BIN_CONTRACT_TRUTH_DISPOSABLE_PASS' '0033 bin and contract truth assertions failed.'
  # Initiative LD-2 (load effects): each effect happens only when the farmer confirmed it, the
  # save is all-or-nothing, the negative-balance guard now holds at the lot, and a void the bin
  # cannot take changes nothing at all.
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/ld2-load-effects-assertions.sql')) 'LD2_LOAD_EFFECTS_DISPOSABLE_PASS' 'LD-2 load effects assertions failed.'
  # Initiative LD-3 (committed vs free): the database's own answer for the same fixture the browser
  # derivation uses, and the proof that a "free" bushel is one the bin will actually let go.
  Invoke-ProbeExpecting (Get-Content -Raw (Join-Path $root 'scripts/sql/ld3-committed-free-assertions.sql')) 'LD3_COMMITTED_FREE_DISPOSABLE_PASS' 'LD-3 committed vs free assertions failed.'

  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}

if ($passed) { Write-Output 'PROBE Friction Sweep persistence (grain sale limits, carry settings, carry grids, cost-line badge) and Today role rules: PASS' }
