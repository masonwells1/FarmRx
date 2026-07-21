$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$februaryProof = Join-Path $root 'scripts/verify-maple-february-disposable.ps1'
$marchSql = Join-Path $root 'tests/season/maple-2027-march.verify.sql'
$credentialHelperPath = Join-Path $root 'scripts/maple-season-credential.ps1'

. $credentialHelperPath
$retainedSnapshotSql = @'
select jsonb_build_object(
  'farms', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.farms t), '[]'::jsonb),
  'farm_memberships', coalesce((select jsonb_agg(to_jsonb(t) order by farm_id, user_id) from public.farm_memberships t), '[]'::jsonb),
  'farm_rep_access', coalesce((select jsonb_agg(to_jsonb(t) order by farm_id, rep_user_id) from public.farm_rep_access t), '[]'::jsonb),
  'farm_access_epochs', coalesce((select jsonb_agg(to_jsonb(t) order by farm_id, user_id) from public.farm_access_epochs t), '[]'::jsonb),
  'entities', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.entities t), '[]'::jsonb),
  'fields', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.fields t), '[]'::jsonb),
  'arrangements', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.arrangements t), '[]'::jsonb),
  'crop_assignments', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.crop_assignments t), '[]'::jsonb),
  'programs', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.programs t), '[]'::jsonb),
  'program_passes', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.program_passes t), '[]'::jsonb),
  'program_pass_products', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.program_pass_products t), '[]'::jsonb),
  'program_assignments', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.program_assignments t), '[]'::jsonb),
  'assigned_program_passes', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.assigned_program_passes t), '[]'::jsonb),
  'assigned_program_pass_products', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.assigned_program_pass_products t), '[]'::jsonb),
  'inventory_products', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.inventory_products t), '[]'::jsonb),
  'scouting_notes', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.scouting_notes t), '[]'::jsonb),
  'scouting_photos', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.scouting_photos t), '[]'::jsonb),
  'repository_write_receipts', coalesce((select jsonb_agg(to_jsonb(t) order by operation_id) from public.repository_write_receipts t), '[]'::jsonb),
  'production_estimates', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.production_estimates t), '[]'::jsonb),
  'grain_contracts', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.grain_contracts t), '[]'::jsonb),
  'grain_contract_deliveries', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.grain_contract_deliveries t), '[]'::jsonb),
  'marketing_plan_targets', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.marketing_plan_targets t), '[]'::jsonb),
  'insurance_units', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.insurance_units t), '[]'::jsonb),
  'grain_bins', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.grain_bins t), '[]'::jsonb),
  'bin_inventory', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.bin_inventory t), '[]'::jsonb),
  'bin_transactions', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.bin_transactions t), '[]'::jsonb),
  'cash_bids', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.cash_bids t), '[]'::jsonb),
  'usda_report_dates', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.usda_report_dates t), '[]'::jsonb),
  'grain_alert_settings', coalesce((select jsonb_agg(to_jsonb(t) order by farm_id) from public.grain_alert_settings t), '[]'::jsonb),
  'marketing_alert_rules', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.marketing_alert_rules t), '[]'::jsonb),
  'firm_offers', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.firm_offers t), '[]'::jsonb)
)::text;
'@

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the Maple March proof.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js/npm with npx is required for the Maple March browser proof.' }

$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }
$boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $expectedProjectId -ExpectedContainer $expectedContainer

Push-Location $root
try {
  Enter-MapleSeasonCredential
  # February invokes January, which owns the continuous-year database's only reset.
  & powershell -NoProfile -ExecutionPolicy Bypass -File $februaryProof
  if ($LASTEXITCODE -ne 0) { throw 'Continuous Maple January-February prerequisite failed.' }

  $runningContainers = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $expectedContainer) {
    throw "Refusing March proof: expected disposable database container $expectedContainer is not running."
  }

  # Full canonical rows make the retained-state comparison cover timestamps,
  # revisions, ownership, provenance, nullable columns, and exact cash-bid data.
  $retainedBefore = $retainedSnapshotSql |
    docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $retainedBefore) { throw 'Could not capture the January-February retained-state baseline.' }

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
  if ($status['API_URL'] -ne 'http://127.0.0.1:55321') { throw 'Refusing March proof: local API URL is not the expected loopback endpoint.' }
  if (-not $status['PUBLISHABLE_KEY'] -or $status['PUBLISHABLE_KEY'] -notmatch '^sb_publishable_') {
    throw 'Refusing March proof: no browser-safe local publishable key was found.'
  }

  $env:VITE_LOCAL_SUPABASE_PROJECT_REF = 'farmrxlocalsimplicity2027'
  $env:VITE_LOCAL_SUPABASE_URL = $status['API_URL']
  $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY = $status['PUBLISHABLE_KEY']

  npx playwright test --config playwright.season-march.config.ts
  if ($LASTEXITCODE -ne 0) { throw 'Maple March browser scenario failed.' }

  $retainedAfter = $retainedSnapshotSql |
    docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0) { throw 'Could not capture the post-March retained-state snapshot.' }
  if (($retainedBefore -join "`n") -cne ($retainedAfter -join "`n")) {
    throw 'Maple March changed canonical January-February rows (full-row retained-state snapshot mismatch).'
  }

  if (-not (Invoke-MapleSeasonSqlFile -Path $marchSql -ExpectedContainer $expectedContainer)) { throw 'Maple March post-browser database assertions failed.' }

  Write-Output 'MAPLE_2027_MARCH_DISPOSABLE_PASS'
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  $boundary = $null
  Pop-Location
}
