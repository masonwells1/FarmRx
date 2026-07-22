$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'maple-season-credential.ps1')

function Assert-SeasonCredential {
  param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
  if (-not $Condition) { throw $Message }
}

$names = @('FARMRX_SEASON_OWNER_PASSWORD', 'FARMRX_SEASON_CREDENTIAL_OWNER_PID', 'FARMRX_SEASON_CREDENTIAL_CHAIN', 'FARMRX_SEASON_CREDENTIAL_HANDSHAKE')
$original = @{}
foreach ($name in $names) { $original[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$first = $null
$chain = $null
$handshake = $null

try {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $output = @(Enter-MapleSeasonCredential)
  $first = $env:FARMRX_SEASON_OWNER_PASSWORD
  $chain = $env:FARMRX_SEASON_CREDENTIAL_CHAIN
  $handshake = $env:FARMRX_SEASON_CREDENTIAL_HANDSHAKE
  Assert-SeasonCredential ($output.Count -eq 0) 'Credential entry must produce no output.'
  Assert-SeasonCredential ($first -match '^[0-9a-f]{64}$' -and $chain -match '^[0-9a-f]{64}$' -and $first -cne $chain) 'Credential and chain marker must be independent 32-byte lowercase hexadecimal values.'
  Assert-SeasonCredential ($handshake -ceq "Local\FarmRxSeasonCredential-$chain") 'The owner must publish only the chain-bound named handshake marker.'
  Assert-SeasonCredential ($env:FARMRX_SEASON_CREDENTIAL_OWNER_PID -eq [string]$PID) 'The generating process must own cleanup.'

  $sameProcessOutput = @(Enter-MapleSeasonCredential)
  Assert-SeasonCredential ($sameProcessOutput.Count -eq 0 -and $env:FARMRX_SEASON_OWNER_PASSWORD -ceq $first) 'Script-owned same-process entry must be stable and silent.'

  $helper = (Join-Path $PSScriptRoot 'maple-season-credential.ps1').Replace("'", "''")
  $childCommand = ". '$helper'; `$before=`$env:FARMRX_SEASON_OWNER_PASSWORD; `$chain=`$env:FARMRX_SEASON_CREDENTIAL_CHAIN; `$handshake=`$env:FARMRX_SEASON_CREDENTIAL_HANDSHAKE; Enter-MapleSeasonCredential; if (`$env:FARMRX_SEASON_OWNER_PASSWORD -cne `$before -or `$env:FARMRX_SEASON_CREDENTIAL_CHAIN -cne `$chain -or `$env:FARMRX_SEASON_CREDENTIAL_HANDSHAKE -cne `$handshake) { exit 11 }; Exit-MapleSeasonCredential; if (`$env:FARMRX_SEASON_OWNER_PASSWORD -cne `$before) { exit 12 }; 'NESTED_CREDENTIAL_REUSE_PASS'"
  $childOutput = @(& powershell -NoProfile -ExecutionPolicy Bypass -Command $childCommand)
  Assert-SeasonCredential ($LASTEXITCODE -eq 0 -and ($childOutput -join '') -ceq 'NESTED_CREDENTIAL_REUSE_PASS') 'A child runner must accept only its live ancestor chain and must not clear it.'

  $heldHandshake = $handshake
  Exit-MapleSeasonCredential
  foreach ($name in $names) { Assert-SeasonCredential (-not [Environment]::GetEnvironmentVariable($name, 'Process')) 'The owning process must restore the prior empty environment.' }
  $ownerEventStillExists = $false
  $opened = $null
  try { $opened = [Threading.EventWaitHandle]::OpenExisting($heldHandshake); $ownerEventStillExists = $true } catch { } finally { if ($opened) { $opened.Dispose() } }
  Assert-SeasonCredential (-not $ownerEventStillExists) 'Owner exit must remove the named handshake object.'

  $spoofChain = 'c' * 64
  $env:FARMRX_SEASON_OWNER_PASSWORD = 'd' * 64
  $env:FARMRX_SEASON_CREDENTIAL_CHAIN = $spoofChain
  $env:FARMRX_SEASON_CREDENTIAL_OWNER_PID = [string]$PID
  $env:FARMRX_SEASON_CREDENTIAL_HANDSHAKE = "Local\FarmRxSeasonCredential-$spoofChain"
  $spoofCommand = ". '$helper'; try { Enter-MapleSeasonCredential; exit 21 } catch { 'LIVE_PARENT_SPOOF_REJECT_PASS' }"
  $spoofOutput = @(& powershell -NoProfile -ExecutionPolicy Bypass -Command $spoofCommand)
  Assert-SeasonCredential ($LASTEXITCODE -eq 0 -and ($spoofOutput -join '') -ceq 'LIVE_PARENT_SPOOF_REJECT_PASS') 'A real live parent with valid-looking environment but no kernel handshake must fail closed.'
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }

  foreach ($owner in @([string]$PID, '2147483646')) {
    $env:FARMRX_SEASON_OWNER_PASSWORD = ('a' * 64)
    $env:FARMRX_SEASON_CREDENTIAL_CHAIN = ('b' * 64)
    $env:FARMRX_SEASON_CREDENTIAL_OWNER_PID = $owner
    $env:FARMRX_SEASON_CREDENTIAL_HANDSHAKE = "Local\FarmRxSeasonCredential-$('b' * 64)"
    $refused = $false
    try { Enter-MapleSeasonCredential } catch { $refused = $true }
    Assert-SeasonCredential $refused 'Fake-current and stale credential owners must fail closed.'
    Assert-SeasonCredential ($env:FARMRX_SEASON_OWNER_PASSWORD -ceq ('a' * 64) -and $env:FARMRX_SEASON_CREDENTIAL_CHAIN -ceq ('b' * 64) -and $env:FARMRX_SEASON_CREDENTIAL_OWNER_PID -ceq $owner -and $env:FARMRX_SEASON_CREDENTIAL_HANDSHAKE -ceq "Local\FarmRxSeasonCredential-$('b' * 64)") 'Rejected inherited state must be preserved exactly.'
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  }

  $originalSetter = ${function:Set-MapleSeasonEnvironmentValue}
  $script:failCredentialSetOnce = $true
  $script:partialHandshakeName = $null
  Set-Item function:Set-MapleSeasonEnvironmentValue -Value {
    param([string]$Name, [AllowNull()][string]$Value)
    if ($Name -eq 'FARMRX_SEASON_CREDENTIAL_HANDSHAKE') { $script:partialHandshakeName = $Value }
    if ($Name -eq 'FARMRX_SEASON_CREDENTIAL_OWNER_PID' -and $script:failCredentialSetOnce) { $script:failCredentialSetOnce = $false; throw 'synthetic setter failure' }
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
  }
  $partialRefused = $false
  try { Enter-MapleSeasonCredential } catch { $partialRefused = $true } finally { Set-Item function:Set-MapleSeasonEnvironmentValue -Value $originalSetter }
  Assert-SeasonCredential $partialRefused 'A partial environment update must fail.'
  foreach ($name in $names) { Assert-SeasonCredential (-not [Environment]::GetEnvironmentVariable($name, 'Process')) 'A partial environment update must roll back every value.' }
  $partialEventStillExists = $false
  $opened = $null
  try { $opened = [Threading.EventWaitHandle]::OpenExisting($script:partialHandshakeName); $partialEventStillExists = $true } catch { } finally { if ($opened) { $opened.Dispose() } }
  Assert-SeasonCredential (-not $partialEventStillExists) 'A partial environment failure must dispose its owner handshake.'

  $root = Split-Path -Parent $PSScriptRoot
  $validProbe = { [pscustomobject]@{ Containers = @('supabase_db_farmrx-farmer-simplicity-2027-local'); DockerExit = 0; StatusLines = @('API_URL="http://127.0.0.1:55321"', 'PUBLISHABLE_KEY="sb_publishable_synthetic"'); StatusExit = 0 } }
  $boundary = Assert-MapleSeasonLocalBoundary -Root $root -Supabase 'unused' -ExpectedProjectId 'farmrx-farmer-simplicity-2027-local' -ExpectedContainer 'supabase_db_farmrx-farmer-simplicity-2027-local' -Probe $validProbe
  Assert-SeasonCredential ($boundary.ApiUrl -ceq 'http://127.0.0.1:55321') 'The exact local boundary must pass.'
  foreach ($unsafeLine in @('API_URL="https://example.invalid"', 'PUBLISHABLE_KEY="sb_secret_unsafe"')) {
    $refused = $false
    $probe = { [pscustomobject]@{ Containers = @('supabase_db_farmrx-farmer-simplicity-2027-local'); DockerExit = 0; StatusLines = @($unsafeLine, $(if ($unsafeLine -like 'API_URL*') { 'PUBLISHABLE_KEY="sb_publishable_synthetic"' } else { 'API_URL="http://127.0.0.1:55321"' })); StatusExit = 0 } }.GetNewClosure()
    try { $null = Assert-MapleSeasonLocalBoundary -Root $root -Supabase 'unused' -ExpectedProjectId 'farmrx-farmer-simplicity-2027-local' -ExpectedContainer 'supabase_db_farmrx-farmer-simplicity-2027-local' -Probe $probe } catch { $refused = $true }
    Assert-SeasonCredential $refused 'Remote APIs and secret/service-role browser keys must fail closed.'
  }

  Enter-MapleSeasonCredential
  $secret = $env:FARMRX_SEASON_OWNER_PASSWORD
  $failure = $null
  $failureOutput = @()
  $global:FarmRxSawUnicodePayload = $false
  try {
    $failureOutput = @(Invoke-MapleSeasonSqlFile -Path (Join-Path $root 'tests/season/maple-2027-start.sql') -ExpectedContainer 'unused' -NativeInvoker { param($payload) $global:FarmRxSawUnicodePayload = $payload.Contains([string][char]0x2014); $payload; [pscustomobject]@{ ExitCode = 9 } })
  } catch { $failure = $_.Exception.Message }
  Assert-SeasonCredential ($failure -ceq 'Disposable season SQL execution failed.' -and $failureOutput.Count -eq 0 -and $failure -notlike "*$secret*") 'Native SQL failure must suppress native output and throw only a generic non-secret error.'
  Assert-SeasonCredential $global:FarmRxSawUnicodePayload 'Season SQL must be decoded as UTF-8 before the stdin-only native invocation.'
  Exit-MapleSeasonCredential

  Write-Output 'MAPLE_SEASON_CREDENTIAL_REGRESSION_PASS'
} finally {
  Exit-MapleSeasonCredential
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $original[$name], 'Process') }
  $first = $null
  $chain = $null
  $handshake = $null
  $secret = $null
  Remove-Variable FarmRxSawUnicodePayload -Scope Global -ErrorAction SilentlyContinue
  $original = $null
}
