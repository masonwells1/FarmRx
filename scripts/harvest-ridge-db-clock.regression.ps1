$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'harvest-ridge-db-clock.psm1') -Force
$module=Get-Module harvest-ridge-db-clock
if($null-eq$module){throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: module was not loaded.'}
& $module {
  param($repoRoot)
  $pine=Assert-HrClockPhaseInput 'http://127.0.0.1:55321' 'sb_publishable_test' 'synthetic-token' '27010000-0000-4000-8000-000000000006' 'Pine Hill' '2027-08-04 19:10:00+00:00'
  if($pine.ToString('o')-notmatch'^2027-08-04T19:10:00'){throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: Pine Hill synthetic proof identity was not accepted.'}
  try{Assert-HrClockPhaseInput 'http://127.0.0.1:55321' 'sb_publishable_test' 'synthetic-token' '27010000-0000-4000-8000-000000000006' 'Pine Ridge' '2027-08-04 19:10:00+00:00'|Out-Null;throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: mismatched Pine proof identity was accepted.'}catch{if($_.Exception.Message-notmatch'HARVEST_RIDGE_CLOCK_REFUSED'){throw}}
  $north=Assert-HrClockPhaseInput 'http://127.0.0.1:55321' 'sb_publishable_test' 'synthetic-token' '27010000-0000-4000-8000-000000000002' 'North Fork' '2027-02-09 14:15:00+00:00'
  if($north.ToString('o')-notmatch'^2027-02-09T14:15:00'){throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: North Fork synthetic proof identity was not accepted.'}
  try{Assert-HrClockPhaseInput 'http://127.0.0.1:55321' 'sb_publishable_test' 'synthetic-token' '27010000-0000-4000-8000-000000000002' 'North Field' '2027-02-09 14:15:00+00:00'|Out-Null;throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: mismatched North proof identity was accepted.'}catch{if($_.Exception.Message-notmatch'HARVEST_RIDGE_CLOCK_REFUSED'){throw}}
  $db=Get-HrClockContainer $repoRoot 'supabase_db_farmrx-farmer-simplicity-2027-local'
  $rest=Get-HrClockContainer $repoRoot 'supabase_rest_farmrx-farmer-simplicity-2027-local'
  if($db.Id-notmatch'^[0-9a-f]{64}$'-or-not$db.Running-or$db.Health-cne'healthy'-or$null-eq$db.Healthcheck){throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: DB embedded-quote template did not round-trip.'}
  if($rest.Id-notmatch'^[0-9a-f]{64}$'-or-not$rest.Running-or[int]$rest.Pid-le0-or$null-ne$rest.Health-or$null-ne$rest.Healthcheck){throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: Rest nullable embedded-quote template did not round-trip.'}
} $root
Write-Output 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_PASS'
