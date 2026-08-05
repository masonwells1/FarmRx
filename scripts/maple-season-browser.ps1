function Test-MapleSeasonBrowserPortOwned {
  param(
    $ListenerProcess,
    [Parameter(Mandatory)][string]$Root
  )
  # CommandLine is null for a process this session cannot inspect (another user, or elevated).
  # Guard it explicitly: calling .IndexOf() on $null raises a method-not-found error in every
  # PowerShell mode, so without this guard the callers get an exception instead of the "not ours"
  # answer they depend on.
  if ($null -eq $ListenerProcess) { return $false }
  $commandLine = $ListenerProcess.CommandLine
  if ([string]::IsNullOrEmpty($commandLine)) { return $false }
  if ([string]::IsNullOrEmpty($Root)) { return $false }
  # Compare on one separator form, then require a path boundary after the match. A bare substring
  # test lets root C:\FarmRx claim a listener running out of C:\FarmRx2, and this predicate gates
  # the Stop-Process in Clear-MapleSeasonBrowserPort, so an over-broad match would terminate a
  # process this proof does not own.
  $normalizedCommandLine = $commandLine.Replace('/', '\')
  $normalizedRoot = $Root.Replace('/', '\').TrimEnd('\')
  $matchIndex = $normalizedCommandLine.IndexOf($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)
  if ($matchIndex -lt 0) { return $false }
  $boundaryIndex = $matchIndex + $normalizedRoot.Length
  if ($boundaryIndex -lt $normalizedCommandLine.Length) {
    $boundary = [string]$normalizedCommandLine[$boundaryIndex]
    if ($boundary -notmatch '[\\"'' ]') { return $false }
  }
  return $commandLine -match '(?i)(vite|npm|node)'
}

function Clear-MapleSeasonBrowserPort {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Scenario
  )
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $owned = Test-MapleSeasonBrowserPortOwned -ListenerProcess $listenerProcess -Root $Root
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
    [Parameter(Mandatory)][string]$PortVariable,
    [Parameter(Mandatory)][string]$Root
  )
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return }
  $holders = [Collections.Generic.List[string]]::new()
  $ownedCount = 0
  foreach ($listener in $listeners) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if (Test-MapleSeasonBrowserPortOwned -ListenerProcess $listenerProcess -Root $Root) { $ownedCount++ }
    # Image name and PID only. A foreign command line can carry tokens or private paths and
    # this message is written into season evidence logs.
    $name = if ($null -eq $listenerProcess) { 'unknown' } else { $listenerProcess.Name }
    $holders.Add("$name (PID $($listener.OwningProcess))")
  }
  # No -f here: $Scenario is caller-supplied and already interpolated, so a brace in it would
  # turn this refusal into a FormatException instead of the diagnosis.
  $holderList = ($holders | Sort-Object -Unique) -join ', '
  # Distinguish a Farm Rx server from a genuinely foreign one. Vite has no strictPort, so a season
  # server can drift onto the next month's governed port; telling the operator to hunt a foreign
  # squatter that does not exist is the same mis-diagnosis this preflight exists to remove. But the
  # ownership test only proves the command line looks like Farm Rx, not that a proof leaked it - a
  # developer's own `npm run dev` in this tree matches identically, so name both causes rather than
  # asserting a leak. Both branches carry the $PortVariable redirect: the operator needs a way
  # forward even when the holder is theirs and they do not want to stop it. Refuse either way -
  # never terminate a listener this scenario did not create.
  $redirect = "Free that port or set $PortVariable to an unused port."
  if ($ownedCount -gt 0) {
    $mixed = if ($ownedCount -lt $listeners.Count) { ' Other listeners on that port do not belong to Farm Rx.' } else { '' }
    throw "$Scenario cannot start: governed port $Port was already held by a Farm Rx dev or season server ($holderList) before this scenario ran.$mixed An earlier proof that never released the port is the usual cause, but a development server started by hand in this tree looks the same; stop that server or investigate the proof that left it behind. $redirect"
  }
  throw "$Scenario cannot start: governed port $Port was already in use by $holderList before this scenario ran, and no listener there belongs to Farm Rx. $redirect"
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
  # Fail before launching, and only after the deterministic contract checks above, so a real
  # defect (missing runner, invalid grep tag) is never masked by an environment collision.
  # Playwright runs these configs with reuseExistingServer:false, so an occupied governed port
  # cannot be shared: without this the scenario launches anyway, waits out Playwright's 120s
  # webServer timeout, and then dies inside the post-run cleanup refusal - which reads as if
  # this scenario leaked the listener when something else held the port beforehand.
  Assert-MapleSeasonBrowserPortFree -Port $port -Scenario $Scenario -PortVariable $portContract[0] -Root $ownedMarker
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
