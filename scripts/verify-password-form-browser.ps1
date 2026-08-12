$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$priorFlag = $env:VITE_PASSWORD_EMAIL_DELIVERY_ENABLED
$priorReport = $env:FARMRX_PASSWORD_FORM_REPORT
$reportPath = Join-Path ([IO.Path]::GetTempPath()) "farmrx-password-form-$PID-$([guid]::NewGuid().ToString('N')).json"

Push-Location $root
try {
  $env:VITE_PASSWORD_EMAIL_DELIVERY_ENABLED = 'true'
  $env:FARMRX_PASSWORD_FORM_REPORT = $reportPath
  & node scripts/verify-password-form-report.regression.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Password-form report verifier regression failed.' }
  & npx playwright test --config=playwright.password-form.config.ts
  $playwrightExit = $LASTEXITCODE
  & node scripts/verify-password-form-report.mjs $reportPath
  if ($LASTEXITCODE -ne 0) { throw 'Password-form browser result counts were not proven.' }
  if ($playwrightExit -ne 0) { throw 'Password-form browser isolation proof failed.' }
  Write-Output 'Password-form browser isolation proof: PASS'
} finally {
  Remove-Item -LiteralPath $reportPath -ErrorAction SilentlyContinue
  if ($null -eq $priorFlag) {
    Remove-Item Env:VITE_PASSWORD_EMAIL_DELIVERY_ENABLED -ErrorAction SilentlyContinue
  } else {
    $env:VITE_PASSWORD_EMAIL_DELIVERY_ENABLED = $priorFlag
  }
  if ($null -eq $priorReport) {
    Remove-Item Env:FARMRX_PASSWORD_FORM_REPORT -ErrorAction SilentlyContinue
  } else {
    $env:FARMRX_PASSWORD_FORM_REPORT = $priorReport
  }
  Pop-Location
}
