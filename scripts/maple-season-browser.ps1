function Clear-MapleSeasonBrowserPort {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Scenario
  )
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $owned = $null -ne $listenerProcess -and
      $listenerProcess.CommandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $listenerProcess.CommandLine -match '(?i)(vite|npm|node)'
    if (-not $owned) {
      throw "$Scenario found an unrecognized listener on governed port $Port; refusing to terminate it."
    }
    $ownedProcess = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($null -ne $ownedProcess) {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
      if (-not $ownedProcess.WaitForExit(10000)) {
        throw "$Scenario browser server did not terminate within ten seconds."
      }
    }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $remaining = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "$Scenario browser server cleanup did not release governed port $Port."
}

function Assert-MapleSeasonBrowserPortFree {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Scenario,
    [Parameter(Mandatory)][string]$PortVariable
  )
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return }
  $holders = foreach ($listener in $listeners) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    # Image name and PID only. A foreign command line can carry tokens or private paths and
    # this message is written into season evidence logs.
    $name = if ($null -eq $listenerProcess) { 'unknown' } else { $listenerProcess.Name }
    '{0} (PID {1})' -f $name, $listener.OwningProcess
  }
  throw ("$Scenario cannot start: governed port $Port was already in use by {0} before this scenario ran. Free that port or set $PortVariable to an unused port." -f (($holders | Sort-Object -Unique) -join ', '))
}

function Invoke-MapleSeasonBrowserProof {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Config,
    [Parameter(Mandatory)][string]$Scenario,
    [string]$Grep,
    [ValidateRange(500, 300000)][int]$TimeoutMilliseconds = 300000,
    [string]$RunnerFile,
    [string]$OwnedCommandMarker
  )
  $portContract = switch ($Config) {
    'playwright.season.config.ts' { @('FARMRX_SEASON_JANUARY_PORT', 4174) }
    'playwright.season-february.config.ts' { @('FARMRX_SEASON_JANUARY_PORT', 4174) }
    'playwright.season-march.config.ts' { @('FARMRX_SEASON_MARCH_PORT', 4175) }
    'playwright.season-april.config.ts' { @('FARMRX_SEASON_APRIL_PORT', 4176) }
    'playwright.season-may.config.ts' { @('FARMRX_SEASON_MAY_PORT', 4177) }
    'playwright.season-june.config.ts' { @('FARMRX_SEASON_JUNE_PORT', 4178) }
    'playwright.season-july.config.ts' { @('FARMRX_SEASON_JULY_PORT', 4178) }
    'playwright.season-august-december.config.ts' { @('FARMRX_SEASON_AUGUST_DECEMBER_PORT', 4280) }
    default { throw "$Scenario browser scenario has no governed port contract for $Config." }
  }
  $configuredPort = [Environment]::GetEnvironmentVariable($portContract[0], [EnvironmentVariableTarget]::Process)
  $port = if ([string]::IsNullOrWhiteSpace($configuredPort)) { [int]$portContract[1] } else { [int]$configuredPort }
  # Fail before launching. Playwright runs these configs with reuseExistingServer:false, so an
  # occupied governed port cannot be shared: without this the run burns its full bounded
  # timeout and then reports the post-run cleanup refusal, which reads as if this scenario
  # leaked the listener when in fact a foreign process held the port beforehand.
  Assert-MapleSeasonBrowserPortFree -Port $port -Scenario $Scenario -PortVariable $portContract[0]
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $runner = if ([string]::IsNullOrWhiteSpace($RunnerFile)) { Join-Path $Root 'node_modules/@playwright/test/cli.js' } else { $RunnerFile }
  $runner = [IO.Path]::GetFullPath($runner)
  if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw "$Scenario browser runner is unavailable." }
  $ownedMarker = if ([string]::IsNullOrWhiteSpace($OwnedCommandMarker)) { $Root } else { $OwnedCommandMarker }
  $arguments = '"{0}" test --config "{1}"' -f $runner, $Config
  if (-not [string]::IsNullOrWhiteSpace($Grep)) {
    if ($Grep -notmatch '^@[a-z0-9-]+$') { throw "$Scenario browser scenario has an invalid grep contract." }
    $arguments += ' --grep "{0}"' -f $Grep
  }
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $node
  $startInfo.Arguments = $arguments
  $startInfo.WorkingDirectory = $Root
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "$Scenario browser process did not start." }
  $completed = $process.WaitForExit($TimeoutMilliseconds)
  if (-not $completed) {
    & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null
    $killExitCode = $LASTEXITCODE
    $terminated = $process.WaitForExit(10000)
    Clear-MapleSeasonBrowserPort -Port $port -Root $ownedMarker -Scenario $Scenario
    if ($killExitCode -ne 0 -or -not $terminated -or -not $process.HasExited) {
      throw "$Scenario browser timeout cleanup did not terminate its owned process tree."
    }
    throw "$Scenario browser scenario exceeded its bounded process limit after verified cleanup."
  }
  if (-not $process.HasExited -or $null -eq $process.ExitCode) {
    throw "$Scenario browser process ended without a readable native exit code."
  }
  $exitCode = [int]$process.ExitCode

  Clear-MapleSeasonBrowserPort -Port $port -Root $ownedMarker -Scenario $Scenario
  if ($exitCode -ne 0) { throw "$Scenario browser scenario failed with exit code $exitCode." }
}
