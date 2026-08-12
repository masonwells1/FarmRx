$ErrorActionPreference = 'Stop'
$detected = $false

try {
  & (Join-Path $PSScriptRoot 'verify-push-access-revocation-disposable.ps1') -MutateParentDeliveryLock
} catch {
  if ($_.Exception.Message -ne 'EXPECTED_PARENT_RECONCILIATION_MUTATION_DETECTED') { throw }
  $detected = $true
}

if (-not $detected) {
  throw 'Removing the parent-delivery lock did not reproduce the concurrent non-terminal parent.'
}

Write-Output 'PUSH ACCESS CONCURRENCY MUTATION: PASS (parent lock removal turned the real two-connection proof red)'
