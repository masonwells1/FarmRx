$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$priorFlag = $env:VITE_PASSWORD_EMAIL_DELIVERY_ENABLED

Push-Location $root
try {
  $env:VITE_PASSWORD_EMAIL_DELIVERY_ENABLED = 'true'
  & npx playwright test --config=playwright.password-form.config.ts
  if ($LASTEXITCODE -ne 0) { throw 'Password-form browser isolation proof failed.' }
  Write-Output 'Password-form browser isolation proof: PASS'
} finally {
  if ($null -eq $priorFlag) {
    Remove-Item Env:VITE_PASSWORD_EMAIL_DELIVERY_ENABLED -ErrorAction SilentlyContinue
  } else {
    $env:VITE_PASSWORD_EMAIL_DELIVERY_ENABLED = $priorFlag
  }
  Pop-Location
}
