Set-StrictMode -Version Latest

$script:MapleSeasonPasswordName = 'FARMRX_SEASON_OWNER_PASSWORD'
$script:MapleSeasonOwnerName = 'FARMRX_SEASON_CREDENTIAL_OWNER_PID'
$script:MapleSeasonChainName = 'FARMRX_SEASON_CREDENTIAL_CHAIN'
$script:MapleSeasonHandshakeName = 'FARMRX_SEASON_CREDENTIAL_HANDSHAKE'
$script:MapleSeasonCredentialOwned = $false
$script:MapleSeasonOwnedPassword = $null
$script:MapleSeasonOwnedChain = $null
$script:MapleSeasonPreviousEnvironment = $null
$script:MapleSeasonOwnerHandshake = $null

function Get-MapleSeasonEnvironmentValue {
  param([Parameter(Mandatory)][string]$Name)
  [Environment]::GetEnvironmentVariable($Name, [EnvironmentVariableTarget]::Process)
}

function Set-MapleSeasonEnvironmentValue {
  param([Parameter(Mandatory)][string]$Name, [AllowNull()][string]$Value)
  [Environment]::SetEnvironmentVariable($Name, $Value, [EnvironmentVariableTarget]::Process)
}

function Get-MapleSeasonAncestorProcessIds {
  $ancestors = [Collections.Generic.HashSet[int]]::new()
  $next = $PID
  for ($depth = 0; $depth -lt 64; $depth += 1) {
    try { $process = Get-CimInstance Win32_Process -Filter "ProcessId = $next" -ErrorAction Stop } catch { return ,$ancestors }
    if (-not $process -or $process.ParentProcessId -le 0 -or $process.ParentProcessId -eq $next) { return ,$ancestors }
    $next = [int]$process.ParentProcessId
    [void]$ancestors.Add($next)
  }
  ,$ancestors
}

function New-MapleSeasonRandomHex {
  $bytes = [byte[]]::new(32)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
    ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
  } finally {
    $rng.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

function Enter-MapleSeasonCredential {
  $password = Get-MapleSeasonEnvironmentValue -Name $script:MapleSeasonPasswordName
  $owner = Get-MapleSeasonEnvironmentValue -Name $script:MapleSeasonOwnerName
  $chain = Get-MapleSeasonEnvironmentValue -Name $script:MapleSeasonChainName
  $handshake = Get-MapleSeasonEnvironmentValue -Name $script:MapleSeasonHandshakeName
  $present = @(@($password, $owner, $chain, $handshake) | Where-Object { $_ })

  if ($present.Count -gt 0) {
    if (-not $password -or -not $owner -or -not $chain -or -not $handshake -or $password -notmatch '^[0-9a-f]{64}$' -or $chain -notmatch '^[0-9a-f]{64}$' -or $owner -notmatch '^\d+$' -or $handshake -notmatch '^Local\\FarmRxSeasonCredential-[0-9a-f]{64}$' -or $handshake -cne "Local\FarmRxSeasonCredential-$chain") {
      throw 'The inherited disposable season credential state is incomplete or invalid.'
    }
    if ($owner -eq [string]$PID) {
      if (-not $script:MapleSeasonCredentialOwned -or -not $script:MapleSeasonOwnerHandshake -or $password -cne $script:MapleSeasonOwnedPassword -or $chain -cne $script:MapleSeasonOwnedChain) {
        throw 'Refusing disposable credential state that this runner did not create.'
      }
      return
    }
    $ancestors = Get-MapleSeasonAncestorProcessIds
    if (-not $ancestors.Contains([int]$owner)) { throw 'The inherited disposable season credential owner is not a live ancestor.' }
    $openedHandshake = $null
    try { $openedHandshake = [Threading.EventWaitHandle]::OpenExisting($handshake) } catch { throw 'The inherited disposable season credential owner handshake is unavailable.' } finally { if ($openedHandshake) { $openedHandshake.Dispose() } }
    return
  }

  $previous = @{
    password = $password
    owner = $owner
    chain = $chain
    handshake = $handshake
  }
  $generatedPassword = $null
  $generatedChain = $null
  $generatedHandshake = $null
  $ownerHandshake = $null
  try {
    $generatedPassword = New-MapleSeasonRandomHex
    $generatedChain = New-MapleSeasonRandomHex
    $generatedHandshake = "Local\FarmRxSeasonCredential-$generatedChain"
    $createdNew = $false
    $ownerHandshake = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $generatedHandshake, [ref]$createdNew)
    if (-not $createdNew) { throw 'The disposable season credential handshake already exists.' }
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonPasswordName -Value $generatedPassword
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonChainName -Value $generatedChain
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonHandshakeName -Value $generatedHandshake
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonOwnerName -Value ([string]$PID)
    $script:MapleSeasonPreviousEnvironment = $previous
    $script:MapleSeasonOwnedPassword = $generatedPassword
    $script:MapleSeasonOwnedChain = $generatedChain
    $script:MapleSeasonOwnerHandshake = $ownerHandshake
    $script:MapleSeasonCredentialOwned = $true
    $ownerHandshake = $null
  } catch {
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonPasswordName -Value $previous.password
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonOwnerName -Value $previous.owner
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonChainName -Value $previous.chain
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonHandshakeName -Value $previous.handshake
    if ($ownerHandshake) { $ownerHandshake.Dispose() }
    $script:MapleSeasonPreviousEnvironment = $null
    $script:MapleSeasonOwnedPassword = $null
    $script:MapleSeasonOwnedChain = $null
    $script:MapleSeasonCredentialOwned = $false
    $script:MapleSeasonOwnerHandshake = $null
    throw 'Farm Rx could not create the disposable season credential.'
  } finally {
    $generatedPassword = $null
    $generatedChain = $null
    $generatedHandshake = $null
  }
}

function Exit-MapleSeasonCredential {
  if (-not $script:MapleSeasonCredentialOwned) { return }
  $previous = $script:MapleSeasonPreviousEnvironment
  try {
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonPasswordName -Value $previous.password
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonOwnerName -Value $previous.owner
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonChainName -Value $previous.chain
    Set-MapleSeasonEnvironmentValue -Name $script:MapleSeasonHandshakeName -Value $previous.handshake
  } finally {
    if ($script:MapleSeasonOwnerHandshake) { $script:MapleSeasonOwnerHandshake.Dispose() }
    $script:MapleSeasonOwnerHandshake = $null
    $script:MapleSeasonPreviousEnvironment = $null
    $script:MapleSeasonOwnedPassword = $null
    $script:MapleSeasonOwnedChain = $null
    $script:MapleSeasonCredentialOwned = $false
    $previous = $null
  }
}

function Assert-MapleSeasonLocalBoundary {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Supabase,
    [Parameter(Mandatory)][string]$ExpectedProjectId,
    [Parameter(Mandatory)][string]$ExpectedContainer,
    [scriptblock]$Probe
  )
  $configPath = Join-Path $Root 'supabase/config.toml'
  $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath
  if ($config -notmatch ('(?m)^project_id\s*=\s*"' + [regex]::Escape($ExpectedProjectId) + '"\s*$')) { throw 'Refusing season proof outside the expected disposable project.' }

  $probeResult = $null
  $nativeOutput = $null
  try {
    if ($Probe) {
      $probeResult = @(& $Probe)[-1]
    } else {
      $containers = @(docker ps --format '{{.Names}}' 2>&1)
      $dockerExit = $LASTEXITCODE
      $oldPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        Push-Location $Root
        try { $statusLines = @(& $Supabase --profile supabase status -o env 2>&1); $statusExit = $LASTEXITCODE } finally { Pop-Location }
      } finally { $ErrorActionPreference = $oldPreference }
      $probeResult = [pscustomobject]@{ Containers = $containers; DockerExit = $dockerExit; StatusLines = $statusLines; StatusExit = $statusExit }
    }
    if ($probeResult.DockerExit -ne 0 -or $probeResult.StatusExit -ne 0 -or @($probeResult.Containers) -notcontains $ExpectedContainer) { throw 'The expected disposable local Supabase stack is not ready.' }
    $status = @{}
    foreach ($line in @($probeResult.StatusLines)) {
      if ([string]$line -match '^([A-Z0-9_]+)="?(.*?)"?$') { $status[$matches[1]] = $matches[2] }
    }
    if ($status['API_URL'] -cne 'http://127.0.0.1:55321') { throw 'Refusing a non-loopback or unexpected Supabase API.' }
    if (-not $status['PUBLISHABLE_KEY'] -or $status['PUBLISHABLE_KEY'] -notmatch '^sb_publishable_' -or $status['PUBLISHABLE_KEY'] -match 'service_role|secret') { throw 'The disposable browser publishable key is unavailable or unsafe.' }
    [pscustomobject]@{ ApiUrl = $status['API_URL']; PublishableKey = $status['PUBLISHABLE_KEY'] }
  } finally {
    $config = $null
    $probeResult = $null
    $nativeOutput = $null
    if (Get-Variable statusLines -ErrorAction SilentlyContinue) { $statusLines = $null }
    if (Get-Variable containers -ErrorAction SilentlyContinue) { $containers = $null }
    if (Get-Variable status -ErrorAction SilentlyContinue) { $status = $null }
  }
}

function Invoke-MapleSeasonSqlFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$ExpectedContainer,
    [scriptblock]$NativeInvoker
  )
  $password = Get-MapleSeasonEnvironmentValue -Name $script:MapleSeasonPasswordName
  $chain = Get-MapleSeasonEnvironmentValue -Name $script:MapleSeasonChainName
  if ($password -notmatch '^[0-9a-f]{64}$' -or $chain -notmatch '^[0-9a-f]{64}$') { throw 'The generated disposable season credential is unavailable or invalid.' }
  $payload = "\set season_owner_password '$password'`n" + (Get-Content -Raw -Encoding UTF8 -LiteralPath $Path)
  $nativeOutput = $null
  $exitCode = $null
  $result = $null
  $previousOutputEncoding = $OutputEncoding
  try {
    if ($NativeInvoker) {
      $nativeOutput = @(& $NativeInvoker $payload)
      $result = $nativeOutput[-1]
      $exitCode = [int]$result.ExitCode
    } else {
      $OutputEncoding = [Text.UTF8Encoding]::new($false)
      $nativeOutput = @($payload | docker exec -i $ExpectedContainer psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off 2>&1)
      $exitCode = $LASTEXITCODE
    }
    if ($exitCode -ne 0) { throw 'Disposable season SQL execution failed.' }
    $true
  } finally {
    $payload = $null
    $password = $null
    $chain = $null
    $nativeOutput = $null
    $result = $null
    $exitCode = $null
    $OutputEncoding = $previousOutputEncoding
    $previousOutputEncoding = $null
  }
}
