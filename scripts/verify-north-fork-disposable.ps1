param([ValidateSet('all','desktop','phone')][string]$Only = 'all')

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = 'farmrx-farmer-simplicity-2027-local'
$db = "supabase_db_$project"
$gateway = "supabase_kong_$project"
$parked = "$db-ordinary-parked"
$apiUrl = 'http://127.0.0.1:55321'
$authHealthUri = "$apiUrl/auth/v1/health"
$fixture = Join-Path $root 'tests/season/north-fork-2027-start.sql'
$verify = Join-Path $root 'tests/season/north-fork-2027.verify.sql'
$playwrightCli = Join-Path $root 'node_modules/@playwright/test/cli.js'
$northFarm = '27010000-0000-4000-8000-000000000002'
$owner = '27000000-0000-4000-8000-000000000001'
$manager = '27000000-0000-4000-8000-000000000002'
$worker = '27000000-0000-4000-8000-000000000003'
$rep = '27000000-0000-4000-8000-000000000005'
$task = '27061000-0000-4000-8000-000000000002'

. (Join-Path $root 'scripts/maple-season-credential.ps1')
Import-Module (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1') -Force

function Wait-NorthForkAuth {
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    try {
      $health = Invoke-WebRequest -UseBasicParsing -Uri $authHealthUri -TimeoutSec 2
      if ($health.StatusCode -eq 200 -and $health.Content -match '"name"\s*:\s*"GoTrue"') { return }
    } catch {}
    if ($attempt -lt 30) { Start-Sleep -Milliseconds 500 }
  }
  throw 'North Fork disposable Auth did not become healthy.'
}

function Invoke-NorthForkSql([string]$Sql) {
  $output = @($Sql | docker exec -i $db psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "North Fork focused SQL failed.`n$([string]::Join("`n", [string[]]$output))"
  }
  return [string]::Join("`n", [string[]]$output)
}

function Get-NorthForkAccessToken([string]$PublishableKey) {
  $password = $env:FARMRX_SEASON_OWNER_PASSWORD
  $payload = $null
  $response = $null
  if ($password -notmatch '^[0-9a-f]{64}$') { throw 'North Fork synthetic credential is unavailable.' }
  try {
    $payload = @{ email = 'north.owner@farmrx.local.test'; password = $password } | ConvertTo-Json -Compress
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$apiUrl/auth/v1/token?grant_type=password" -Headers @{ apikey = $PublishableKey } -ContentType 'application/json' -Body $payload -TimeoutSec 10
    $token = ($response.Content | ConvertFrom-Json -ErrorAction Stop).access_token
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'missing token' }
    return [string]$token
  } catch {
    throw 'North Fork could not obtain a synthetic loopback access token.'
  } finally {
    $password = $null
    $payload = $null
    $response = $null
  }
}

function Get-NorthForkSnapshot([hashtable]$WhereOverrides = @{}) {
  $tables = @(
    (Invoke-NorthForkSql "select tablename from pg_catalog.pg_tables where schemaname='public' order by tablename;") -split "`r?`n" |
      Where-Object { $_ }
  )
  $lines = [Collections.Generic.List[string]]::new()
  foreach ($table in $tables) {
    if ($table -notmatch '^[a-z][a-z0-9_]*$') { throw 'North Fork snapshot found an unsafe public table name.' }
    $where = if ($WhereOverrides.ContainsKey($table)) { [string]$WhereOverrides[$table] } else { 'true' }
    if ($where -notmatch '^[a-z0-9_ <>=:''().-]+$') { throw 'North Fork snapshot override is unsafe.' }
    $json = Invoke-NorthForkSql "select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text from (select * from public.`"$table`" where $where) r;"
    $lines.Add("$table|$json")
  }
  $sequenceJson = Invoke-NorthForkSql "select coalesce(jsonb_agg(jsonb_build_object('name',sequencename,'last_value',last_value) order by sequencename),'[]'::jsonb)::text from pg_catalog.pg_sequences where schemaname='public';"
  $lines.Add("__public_sequences|$sequenceJson")
  return [string]::Join("`n", $lines)
}

function Invoke-NorthForkBrowser {
  param(
    [Parameter(Mandatory)][ValidateSet('nf1','nf2','nf3','nf4','nf5','nf6','nf7','nf8')][string]$Name,
    [Parameter(Mandatory)][string]$Instant,
    [Parameter(Mandatory)][ValidateSet('desktop','phone')][string]$Viewport
  )
  $priorInstant = $env:FARMRX_NF_CLIENT_INSTANT
  $priorViewport = $env:FARMRX_NF_VIEWPORT
  try {
    $env:FARMRX_NF_CLIENT_INSTANT = $Instant
    $env:FARMRX_NF_VIEWPORT = $Viewport
    & node $playwrightCli test --config playwright.north-fork.config.ts --grep "@north-fork-$Name" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "North Fork browser phase failed: $Name" }
  } finally {
    if ($null -eq $priorInstant) { Remove-Item Env:FARMRX_NF_CLIENT_INSTANT -ErrorAction SilentlyContinue } else { $env:FARMRX_NF_CLIENT_INSTANT = $priorInstant }
    if ($null -eq $priorViewport) { Remove-Item Env:FARMRX_NF_VIEWPORT -ErrorAction SilentlyContinue } else { $env:FARMRX_NF_VIEWPORT = $priorViewport }
  }
}

function Invoke-NorthForkZeroWriteBrowser {
  param([string]$Name, [string]$Instant, [string]$Viewport)
  $before = Get-NorthForkSnapshot
  Invoke-NorthForkBrowser $Name $Instant $Viewport
  $after = Get-NorthForkSnapshot
  if ($before -cne $after) { throw "North Fork phase changed public state unexpectedly: $Name" }
}

function Reset-NorthFork([string]$Supabase) {
  & $Supabase --profile supabase db reset --local --no-seed --yes
  if ($LASTEXITCODE -ne 0) { throw 'North Fork disposable reset failed.' }
  docker restart $gateway | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'North Fork gateway refresh failed.' }
  Wait-NorthForkAuth
  if (-not (Invoke-MapleSeasonSqlFile -Path $fixture -ExpectedContainer $db)) {
    throw 'North Fork synthetic fixture failed.'
  }
}

function Invoke-NorthForkClockBrowser {
  param(
    [string]$Phase,
    [string]$FrozenInstant,
    [string]$ClientInstant,
    [string]$Viewport,
    [string]$PublishableKey,
    [string]$AccessToken,
    [hashtable]$SnapshotOverrides,
    [scriptblock]$Proof
  )
  $action = {
    $before = Get-NorthForkSnapshot $SnapshotOverrides
    Invoke-NorthForkBrowser $Phase $ClientInstant $Viewport
    $after = Get-NorthForkSnapshot $SnapshotOverrides
    if ($before -cne $after) { throw "North Fork $Phase changed a row outside its exact allowance." }
    & $Proof
    return $true
  }.GetNewClosure()
  $result = @(
    Invoke-HarvestRidgeClockPhase `
      -Root $root `
      -Phase "$Viewport-$Phase" `
      -FrozenInstant $FrozenInstant `
      -ApiUrl $apiUrl `
      -PublishableKey $PublishableKey `
      -AccessToken $AccessToken `
      -ProofFarmId $northFarm `
      -ProofFarmName 'North Fork' `
      -Action $action
  )
  if ($result[-1] -ne $true) { throw "North Fork $Phase clock phase did not return exact success." }
}

function Invoke-NorthForkSequence {
  param([string]$Viewport, [string]$PublishableKey, [string]$AccessToken)

  Invoke-NorthForkZeroWriteBrowser nf1 '2027-02-09T08:00:00-06:00' $Viewport

  Invoke-NorthForkClockBrowser `
    -Phase nf2 `
    -FrozenInstant '2027-02-09 14:15:00+00:00' `
    -ClientInstant '2027-02-09T08:15:00-06:00' `
    -Viewport $Viewport `
    -PublishableKey $PublishableKey `
    -AccessToken $AccessToken `
    -SnapshotOverrides @{
      farms = "id <> '$northFarm'::uuid"
      farm_access_epochs = "not (farm_id='$northFarm'::uuid and user_id='$rep'::uuid)"
    } `
    -Proof {
      $proof = Invoke-NorthForkSql "select share_with_rep::text||'|'||updated_at::text||'|'||(select access_epoch from public.farm_access_epochs where farm_id='$northFarm' and user_id='$rep')||'|'||(select updated_at::text from public.farm_access_epochs where farm_id='$northFarm' and user_id='$rep') from public.farms where id='$northFarm';"
      if ($proof -cne 'true|2027-02-09 14:15:00+00|2|2027-02-09 14:15:00+00') { throw "North NF-2 exact sharing proof failed: $proof" }
    }

  Invoke-NorthForkZeroWriteBrowser nf3 '2027-02-09T08:30:00-06:00' $Viewport

  Invoke-NorthForkClockBrowser `
    -Phase nf4 `
    -FrozenInstant '2027-02-09 15:00:00+00:00' `
    -ClientInstant '2027-02-09T09:00:00-06:00' `
    -Viewport $Viewport `
    -PublishableKey $PublishableKey `
    -AccessToken $AccessToken `
    -SnapshotOverrides @{ farm_tasks = "id <> '$task'::uuid" } `
    -Proof {
      $proof = Invoke-NorthForkSql "select count(*)||'|'||min(created_at)::text||'|'||min(updated_at)::text||'|'||(select created_by::text from public.farm_tasks where id='$task') from public.farm_tasks where id='$task';"
      if ($proof -cne "1|2027-02-09 15:00:00+00|2027-02-09 15:00:00+00|$worker") { throw "North NF-4 exact task proof failed: $proof" }
    }

  Invoke-NorthForkZeroWriteBrowser nf5 '2027-02-09T09:20:00-06:00' $Viewport

  Invoke-NorthForkClockBrowser `
    -Phase nf6 `
    -FrozenInstant '2027-02-09 15:40:00+00:00' `
    -ClientInstant '2027-02-09T09:40:00-06:00' `
    -Viewport $Viewport `
    -PublishableKey $PublishableKey `
    -AccessToken $AccessToken `
    -SnapshotOverrides @{ farm_tasks = "id <> '$task'::uuid" } `
    -Proof {
      $proof = Invoke-NorthForkSql "select status||'|'||completed_by::text||'|'||completed_at::text||'|'||updated_at::text from public.farm_tasks where id='$task';"
      if ($proof -cne "done|$manager|2027-02-09 15:40:00+00|2027-02-09 15:40:00+00") { throw "North NF-6 exact completion proof failed: $proof" }
    }

  Invoke-NorthForkClockBrowser `
    -Phase nf7 `
    -FrozenInstant '2027-02-09 16:00:00+00:00' `
    -ClientInstant '2027-02-09T10:00:00-06:00' `
    -Viewport $Viewport `
    -PublishableKey $PublishableKey `
    -AccessToken $AccessToken `
    -SnapshotOverrides @{
      farms = "id <> '$northFarm'::uuid"
      farm_access_epochs = "not (farm_id='$northFarm'::uuid and user_id='$rep'::uuid)"
    } `
    -Proof {
      $proof = Invoke-NorthForkSql "select share_with_rep::text||'|'||updated_at::text||'|'||(select access_epoch from public.farm_access_epochs where farm_id='$northFarm' and user_id='$rep')||'|'||(select updated_at::text from public.farm_access_epochs where farm_id='$northFarm' and user_id='$rep') from public.farms where id='$northFarm';"
      if ($proof -cne 'false|2027-02-09 16:00:00+00|3|2027-02-09 16:00:00+00') { throw "North NF-7 exact revocation proof failed: $proof" }
    }

  Invoke-NorthForkZeroWriteBrowser nf8 '2027-02-09T10:20:00-06:00' $Viewport
  Get-Content -Raw -Encoding UTF8 -LiteralPath $verify |
    docker exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off
  if ($LASTEXITCODE -ne 0) { throw "North Fork final $Viewport SQL verification failed." }
}

function Assert-NorthForkNoClockResidue {
  $prior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $ordinary = @(docker inspect --type container --format '{{.Id}}|{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{.HostConfig.RestartPolicy.Name}}' $db 2>$null)
    $ordinaryExit = $LASTEXITCODE
    docker inspect --type container $parked 2>$null | Out-Null
    $parkedExists = $LASTEXITCODE -eq 0
    $images = @(docker image ls --format '{{.Repository}}:{{.Tag}}' | Where-Object { $_ -match '^farmrx-(?:clock-snapshot|frozen-clock-swap):' })
  } finally {
    $ErrorActionPreference = $prior
  }
  $journals = @(Get-ChildItem ([IO.Path]::GetTempPath()) -Filter 'farmrx-harvest-ridge-clock-*-nf*.json' -ErrorAction SilentlyContinue)
  if (
    $ordinaryExit -ne 0 `
      -or $ordinary.Count -ne 1 `
      -or $ordinary[0] -notmatch '^[0-9a-f]{64}\|sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770\|true\|healthy\|unless-stopped$' `
      -or $parkedExists `
      -or $images.Count -ne 0 `
      -or $journals.Count -ne 0
  ) {
    throw 'NORTH_FORK_CLOCK_RECOVERY_INCOMPLETE'
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for North Fork proof.' }
if (-not (Test-Path -LiteralPath $playwrightCli)) { throw 'Repository-pinned Playwright CLI is required for North Fork proof.' }

$supabase = (Get-Command supabase -ErrorAction Stop).Source
$boundary = $null
$token = $null
$runFailure = $null
$cleanupFailure = $null
$passMarker = $null

Push-Location $root
try {
  if (@(docker ps --format '{{.Names}}') -notcontains $db) {
    & $supabase --profile supabase start
    if ($LASTEXITCODE -ne 0) { throw 'Disposable local Supabase start failed.' }
  }
  $boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $project -ExpectedContainer $db
  Enter-MapleSeasonCredential
  $env:VITE_LOCAL_SUPABASE_PROJECT_REF = 'farmrxlocalsimplicity2027'
  $env:VITE_LOCAL_SUPABASE_URL = $boundary.ApiUrl
  $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY = $boundary.PublishableKey
  $env:FARMRX_NF_API_URL = $boundary.ApiUrl
  $env:FARMRX_NF_APP_URL = 'http://127.0.0.1:4182'
  $env:FARMRX_NF_PUBLISHABLE_KEY = $boundary.PublishableKey

  if ($Only -in @('all','desktop')) {
    Reset-NorthFork $supabase
    $token = Get-NorthForkAccessToken $boundary.PublishableKey
    Invoke-NorthForkSequence desktop $boundary.PublishableKey $token
  }

  if ($Only -in @('all','phone')) {
    Reset-NorthFork $supabase
    $token = Get-NorthForkAccessToken $boundary.PublishableKey
    Invoke-NorthForkSequence phone $boundary.PublishableKey $token
  }

  $passMarker = if ($Only -eq 'all') {
    'NORTH_FORK_2027_DISPOSABLE_PASS'
  } else {
    "NORTH_FORK_2027_$($Only.ToUpperInvariant())_DISPOSABLE_PASS"
  }
} catch {
  $runFailure = $_
} finally {
  $token = $null
  $boundary = $null
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:FARMRX_NF_API_URL -ErrorAction SilentlyContinue
  Remove-Item Env:FARMRX_NF_APP_URL -ErrorAction SilentlyContinue
  Remove-Item Env:FARMRX_NF_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  try {
    Assert-NorthForkNoClockResidue
  } catch {
    $cleanupFailure = $_
  } finally {
    Pop-Location
  }
}
if ($null -ne $runFailure) {
  if ($null -ne $cleanupFailure) {
    throw "NORTH_FORK_PRIMARY_FAILURE: $($runFailure.Exception.Message) CLEANUP_FAILURE: $($cleanupFailure.Exception.Message)"
  }
  throw $runFailure
}
if ($null -ne $cleanupFailure) { throw $cleanupFailure }
Write-Output $passMarker
