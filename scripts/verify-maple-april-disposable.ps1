$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$expectedProjectId = 'farmrx-farmer-simplicity-2027-local'
$expectedContainer = "supabase_db_$expectedProjectId"
$marchProof = Join-Path $root 'scripts/verify-maple-march-disposable.ps1'
$aprilSql = Join-Path $root 'tests/season/maple-2027-april.verify.sql'
$credentialHelperPath = Join-Path $root 'scripts/maple-season-credential.ps1'

. $credentialHelperPath
$cropSnapshotSql = @'
select to_jsonb(c)::text
from public.crop_assignments c
where c.id = '27030000-0000-4000-8000-000000000001';
'@
$scenarioSnapshotSql = @'
select jsonb_build_object(
  'farms', jsonb_build_object('count', (select count(*) from public.farms), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.farms t), '[]'::jsonb)),
  'farm_memberships', jsonb_build_object('count', (select count(*) from public.farm_memberships), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by farm_id, user_id) from public.farm_memberships t), '[]'::jsonb)),
  'farm_rep_access', jsonb_build_object('count', (select count(*) from public.farm_rep_access), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by farm_id, rep_user_id) from public.farm_rep_access t), '[]'::jsonb)),
  'farm_access_epochs', jsonb_build_object('count', (select count(*) from public.farm_access_epochs), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by farm_id, user_id) from public.farm_access_epochs t), '[]'::jsonb)),
  'entities', jsonb_build_object('count', (select count(*) from public.entities), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.entities t), '[]'::jsonb)),
  'fields', jsonb_build_object('count', (select count(*) from public.fields), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.fields t), '[]'::jsonb)),
  'arrangements', jsonb_build_object('count', (select count(*) from public.arrangements), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.arrangements t), '[]'::jsonb)),
  'crop_assignments', jsonb_build_object('count', (select count(*) from public.crop_assignments), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.crop_assignments t), '[]'::jsonb)),
  'programs', jsonb_build_object('count', (select count(*) from public.programs), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.programs t), '[]'::jsonb)),
  'program_passes', jsonb_build_object('count', (select count(*) from public.program_passes), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.program_passes t), '[]'::jsonb)),
  'program_pass_products', jsonb_build_object('count', (select count(*) from public.program_pass_products), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.program_pass_products t), '[]'::jsonb)),
  'program_assignments', jsonb_build_object('count', (select count(*) from public.program_assignments), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.program_assignments t), '[]'::jsonb)),
  'assigned_program_passes', jsonb_build_object('count', (select count(*) from public.assigned_program_passes), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.assigned_program_passes t), '[]'::jsonb)),
  'assigned_program_pass_products', jsonb_build_object('count', (select count(*) from public.assigned_program_pass_products), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.assigned_program_pass_products t), '[]'::jsonb)),
  'inventory_products', jsonb_build_object('count', (select count(*) from public.inventory_products), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.inventory_products t), '[]'::jsonb)),
  'inventory_receipts', jsonb_build_object('count', (select count(*) from public.inventory_receipts), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.inventory_receipts t), '[]'::jsonb)),
  'inventory_receipt_lines', jsonb_build_object('count', (select count(*) from public.inventory_receipt_lines), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.inventory_receipt_lines t), '[]'::jsonb)),
  'inventory_on_hand', jsonb_build_object('count', (select count(*) from public.inventory_on_hand), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by farm_id, product_id) from public.inventory_on_hand t), '[]'::jsonb)),
  'inventory_adjustments', jsonb_build_object('count', (select count(*) from public.inventory_adjustments), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.inventory_adjustments t), '[]'::jsonb)),
  'inventory_delivery_events', jsonb_build_object('count', (select count(*) from public.inventory_delivery_events), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.inventory_delivery_events t), '[]'::jsonb)),
  'application_records', jsonb_build_object('count', (select count(*) from public.application_records), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.application_records t), '[]'::jsonb)),
  'application_products', jsonb_build_object('count', (select count(*) from public.application_products), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.application_products t), '[]'::jsonb)),
  'program_application_products', jsonb_build_object('count', (select count(*) from public.program_application_products), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by assigned_product_id) from public.program_application_products t), '[]'::jsonb)),
  'scouting_notes', jsonb_build_object('count', (select count(*) from public.scouting_notes), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.scouting_notes t), '[]'::jsonb)),
  'scouting_photos', jsonb_build_object('count', (select count(*) from public.scouting_photos), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.scouting_photos t), '[]'::jsonb)),
  'field_log_entries', jsonb_build_object('count', (select count(*) from public.field_log_entries), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.field_log_entries t), '[]'::jsonb)),
  'farm_tasks', jsonb_build_object('count', (select count(*) from public.farm_tasks), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.farm_tasks t), '[]'::jsonb)),
  'notifications', jsonb_build_object('count', (select count(*) from public.notifications), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.notifications t), '[]'::jsonb)),
  'production_estimates', jsonb_build_object('count', (select count(*) from public.production_estimates), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.production_estimates t), '[]'::jsonb)),
  'grain_contracts', jsonb_build_object('count', (select count(*) from public.grain_contracts), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.grain_contracts t), '[]'::jsonb)),
  'grain_contract_deliveries', jsonb_build_object('count', (select count(*) from public.grain_contract_deliveries), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.grain_contract_deliveries t), '[]'::jsonb)),
  'marketing_plan_targets', jsonb_build_object('count', (select count(*) from public.marketing_plan_targets), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.marketing_plan_targets t), '[]'::jsonb)),
  'insurance_units', jsonb_build_object('count', (select count(*) from public.insurance_units), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.insurance_units t), '[]'::jsonb)),
  'grain_bins', jsonb_build_object('count', (select count(*) from public.grain_bins), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.grain_bins t), '[]'::jsonb)),
  'bin_inventory', jsonb_build_object('count', (select count(*) from public.bin_inventory), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.bin_inventory t), '[]'::jsonb)),
  'bin_transactions', jsonb_build_object('count', (select count(*) from public.bin_transactions), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.bin_transactions t), '[]'::jsonb)),
  'cash_bids', jsonb_build_object('count', (select count(*) from public.cash_bids), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.cash_bids t), '[]'::jsonb)),
  'usda_report_dates', jsonb_build_object('count', (select count(*) from public.usda_report_dates), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.usda_report_dates t), '[]'::jsonb)),
  'grain_alert_settings', jsonb_build_object('count', (select count(*) from public.grain_alert_settings), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by farm_id) from public.grain_alert_settings t), '[]'::jsonb)),
  'marketing_alert_rules', jsonb_build_object('count', (select count(*) from public.marketing_alert_rules), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.marketing_alert_rules t), '[]'::jsonb)),
  'firm_offers', jsonb_build_object('count', (select count(*) from public.firm_offers), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.firm_offers t), '[]'::jsonb)),
  'repository_write_receipts', jsonb_build_object('count', (select count(*) from public.repository_write_receipts), 'state', coalesce((select jsonb_agg(to_jsonb(t) order by operation_id) from public.repository_write_receipts t), '[]'::jsonb))
)::text;
'@

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required for the Maple April proof.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js/npm with npx is required for the Maple April browser proof.' }

$supabase = if ($env:SUPABASE_GO_BINARY) { $env:SUPABASE_GO_BINARY } else { (Get-Command supabase -ErrorAction Stop).Source }
$boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $expectedProjectId -ExpectedContainer $expectedContainer

Push-Location $root
try {
  Enter-MapleSeasonCredential
  # March invokes February, which invokes January. January remains the sole reset owner.
  & powershell -NoProfile -ExecutionPolicy Bypass -File $marchProof
  if ($LASTEXITCODE -ne 0) { throw 'Continuous Maple January-March prerequisite failed.' }

  $runningContainers = @(docker ps --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $expectedContainer) {
    throw "Refusing April proof: expected disposable database container $expectedContainer is not running."
  }

  $cropBefore = $cropSnapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $cropBefore) { throw 'Could not capture the authoritative pre-April crop row.' }
  $scenarioBefore = $scenarioSnapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or -not $scenarioBefore) { throw 'Could not capture the pre-April scenario table snapshot.' }

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
  if ($status['API_URL'] -ne 'http://127.0.0.1:55321') { throw 'Refusing April proof: local API URL is not the expected loopback endpoint.' }
  if (-not $status['PUBLISHABLE_KEY'] -or $status['PUBLISHABLE_KEY'] -notmatch '^sb_publishable_') {
    throw 'Refusing April proof: no browser-safe local publishable key was found.'
  }

  $env:VITE_LOCAL_SUPABASE_PROJECT_REF = 'farmrxlocalsimplicity2027'
  $env:VITE_LOCAL_SUPABASE_URL = $status['API_URL']
  $env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY = $status['PUBLISHABLE_KEY']

  npx playwright test --config playwright.season-april.config.ts
  if ($LASTEXITCODE -ne 0) { throw 'Maple April browser scenario failed.' }

  $cropAfter = $cropSnapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($cropBefore -join "`n") -cne ($cropAfter -join "`n")) {
    throw 'Maple April changed the authoritative canonical crop row.'
  }
  $scenarioAfter = $scenarioSnapshotSql | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At
  if ($LASTEXITCODE -ne 0 -or ($scenarioBefore -join "`n") -cne ($scenarioAfter -join "`n")) {
    throw 'Maple April changed scenario table counts or canonical state.'
  }

  if (-not (Invoke-MapleSeasonSqlFile -Path $aprilSql -ExpectedContainer $expectedContainer)) { throw 'Maple April post-browser database assertions failed.' }

  Write-Output 'MAPLE_2027_APRIL_DISPOSABLE_PASS'
} finally {
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  $boundary = $null
  Pop-Location
}
