$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'harvest-ridge-db-clock.psm1') -Force
$module=Get-Module harvest-ridge-db-clock
if($null-eq$module){throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: module was not loaded.'}
& $module {
  param($repoRoot)
  $db=Get-HrClockContainer $repoRoot 'supabase_db_farmrx-farmer-simplicity-2027-local'
  $rest=Get-HrClockContainer $repoRoot 'supabase_rest_farmrx-farmer-simplicity-2027-local'
  if($db.Id-notmatch'^[0-9a-f]{64}$'-or-not$db.Running-or$db.Health-cne'healthy'-or$null-eq$db.Healthcheck){throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: DB embedded-quote template did not round-trip.'}
  if($rest.Id-notmatch'^[0-9a-f]{64}$'-or-not$rest.Running-or[int]$rest.Pid-le0-or$null-ne$rest.Health-or$null-ne$rest.Healthcheck){throw 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_FAILED: Rest nullable embedded-quote template did not round-trip.'}
} $root
Write-Output 'HARVEST_RIDGE_CLOCK_PS5_REGRESSION_PASS'
