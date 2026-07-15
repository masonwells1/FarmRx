$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  & npx tsc -b --force
  if ($LASTEXITCODE -ne 0) { throw 'Forced TypeScript failed.' }
  & npm run regression
  if ($LASTEXITCODE -ne 0) { throw 'Fast regression suite failed.' }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
  & npm audit --audit-level=high
  if ($LASTEXITCODE -ne 0) { throw 'Dependency audit failed.' }
  & node scripts/foundation-static-guards.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Foundation static guard failed.' }
  & node scripts/verify-foundation-mutations.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Foundation mutation drill failed.' }
  & (Join-Path $PSScriptRoot 'verify-0033-disposable.ps1')
  & (Join-Path $PSScriptRoot 'verify-0034-disposable.ps1')
  & (Join-Path $PSScriptRoot 'verify-0035-disposable.ps1')
  & (Join-Path $PSScriptRoot 'verify-0036-disposable.ps1')
  & (Join-Path $PSScriptRoot 'verify-0037-disposable.ps1')
  & (Join-Path $PSScriptRoot 'verify-rls-role-matrix.ps1')
  & npm run test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'Built-browser foundation suite failed.' }
  Write-Output 'Farm Rx foundation gate: PASS'
} finally {
  Pop-Location
}
