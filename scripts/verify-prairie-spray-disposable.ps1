$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$expectedGatewayContainer = "supabase_kong_$expectedProjectId"
$expectedAuthHealthUri = 'http://127.0.0.1:55321/auth/v1/health'
$fixturePath = Join-Path $root 'tests/season/prairie-spray-2027-start.sql'
$proofPath = Join-Path $root 'tests/season/prairie-spray-2027.verify.sql'
$credentialHelperPath = Join-Path $root 'scripts/maple-season-credential.ps1'

. $credentialHelperPath

$snapshotSql = @'
create temporary table prairie_snapshot(table_name text primary key, state jsonb);
do $snapshot$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname='public'
    and tablename not in ('application_records','application_products','inventory_on_hand') order by tablename
  loop
    execute format('insert into prairie_snapshot select %L, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from public.%I t', r.tablename, r.tablename);
  end loop;
end
$snapshot$;
insert into prairie_snapshot select 'application_records:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.application_records t where id <> '27043000-0000-4000-8000-000000000001';
insert into prairie_snapshot select 'application_products:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.application_products t where id <> '27044000-0000-4000-8000-000000000001';
insert into prairie_snapshot select 'inventory_on_hand:unrelated', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.inventory_on_hand t where not (farm_id='27010000-0000-4000-8000-000000000003' and product_id='27040000-0000-4000-8000-000000000001');
insert into prairie_snapshot select 'inventory_on_hand:target-normalized', coalesce(jsonb_agg(to_jsonb(t)-array['used_quantity','on_hand_quantity'] order by product_id),'[]'::jsonb) from public.inventory_on_hand t where farm_id='27010000-0000-4000-8000-000000000003' and product_id='27040000-0000-4000-8000-000000000001';
select jsonb_object_agg(table_name,state order by table_name)::text from prairie_snapshot;
'@

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the Prairie Spray proof.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js/npm with npx is required for the Prairie Spray browser proof.' }
$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }

Push-Location $root
try {
  $running = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the disposable local Docker stack.' }
  if ($running -notcontains $expectedContainer) {
    $started = $false
    for ($attempt = 1; $attempt -le 2 -and -not $started; $attempt += 1) {
      & $supabase --profile supabase start
      $started = $LASTEXITCODE -eq 0
      if (-not $started -and $attempt -lt 2) { Start-Sleep -Seconds 3 }
    }
    if (-not $started) { throw 'Disposable local Supabase start failed after one bounded retry.' }
  }
  $boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $expectedProjectId -ExpectedContainer $expectedContainer
  Enter-MapleSeasonCredential
  $env:DO_NOT_TRACK = '1'
  $resetSucceeded = $false
  for ($attempt = 1; $attempt -le 2 -and -not $resetSucceeded; $attempt += 1) {
    & $supabase --profile supabase db reset --local --no-seed --yes
    $resetSucceeded = $LASTEXITCODE -eq 0
    if (-not $resetSucceeded -and $attempt -lt 2) { Start-Sleep -Seconds 3 }
  }
  if (-not $resetSucceeded) { throw 'Disposable local Supabase reset failed after one bounded retry.' }

  $running = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $running -notcontains $expectedGatewayContainer) { throw "Refusing gateway refresh: expected $expectedGatewayContainer is not running." }
  docker restart $expectedGatewayContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not refresh the disposable local gateway after reset.' }
  $authReady = $false
  for ($attempt = 1; $attempt -le 15 -and -not $authReady; $attempt += 1) {
    try { $health = Invoke-WebRequest -UseBasicParsing -Uri $expectedAuthHealthUri -TimeoutSec 2; $authReady = $health.StatusCode -eq 200 -and $health.Content -match '"name"\s*:\s*"GoTrue"' } catch { $authReady = $false }
    if (-not $authReady -and $attempt -lt 15) { Start-Sleep -Seconds 1 }
  }
  if (-not $authReady) { throw 'Disposable local Supabase Auth did not become healthy after the bounded gateway refresh.' }
  if (-not (Invoke-MapleSeasonSqlFile -Path $fixturePath -ExpectedContainer $expectedContainer)) { throw 'Prairie fixture failed to apply.' }
  $before = $snapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $before) { throw 'Could not take the Prairie pre-browser non-write snapshot.' }

  $oldPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $statusLines = @(& $supabase --profile supabase status -o env 2>$null); $statusExit = $LASTEXITCODE } finally { $ErrorActionPreference = $oldPreference }
  if ($statusExit -ne 0) { throw 'Could not read disposable local Supabase browser configuration.' }
  $status = @{}; foreach ($line in $statusLines) { if ($line -match '^([A-Z0-9_]+)="?(.*?)"?$') { $status[$matches[1]] = $matches[2] } }
  if ($status['API_URL'] -ne 'http://127.0.0.1:55321') { throw 'Refusing Prairie proof: local API URL is not the expected loopback endpoint.' }
  if (-not $status['PUBLISHABLE_KEY'] -or $status['PUBLISHABLE_KEY'] -notmatch '^sb_publishable_') { throw 'Refusing Prairie proof: no browser-safe local publishable key was found.' }
  $env:VITE_LOCAL_SUPABASE_PROJECT_REF = 'farmrxlocalsimplicity2027'; $env:VITE_LOCAL_SUPABASE_URL = $status['API_URL']; $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY = $status['PUBLISHABLE_KEY']
  npx playwright test --config playwright.prairie-spray.config.ts
  if ($LASTEXITCODE -ne 0) { throw 'Prairie Spray browser scenario failed.' }
  $after = $snapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $after) { throw 'Could not take the Prairie post-browser non-write snapshot.' }
  if (($before -join "`n") -cne ($after -join "`n")) { throw 'Prairie proof changed a row outside the exact application, application-product, or derived on-hand allowance.' }
  if (-not (Invoke-MapleSeasonSqlFile -Path $proofPath -ExpectedContainer $expectedContainer)) { throw 'Prairie post-browser database assertions failed.' }
  Write-Output 'PRAIRIE_SPRAY_2027_DISPOSABLE_PASS'
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  $boundary = $null
  Pop-Location
}
