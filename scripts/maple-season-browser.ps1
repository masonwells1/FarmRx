if (-not ('MapleSeasonOwnedJob' -as [type])) {
  Add-Type -Path (Join-Path $PSScriptRoot 'maple-season-browser-job.cs') -ErrorAction Stop
}

function Get-MapleSeasonProcessIdentity {
  param([Parameter(Mandatory)][int]$ProcessId)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  return [pscustomobject]@{
    ProcessId = [int]$process.ProcessId
    ParentProcessId = [int]$process.ParentProcessId
    Name = [string]$process.Name
    ExecutablePath = [string]$process.ExecutablePath
    CreationTimeUtc = ([datetime]$process.CreationDate).ToUniversalTime().ToString('o')
    CommandLine = [string]$process.CommandLine
  }
}

function Get-MapleSeasonJobIdentitySnapshot {
  param(
    [Parameter(Mandatory)][MapleSeasonOwnedJob]$Job,
    [Parameter(Mandatory)][string]$Scenario
  )
  $snapshot = New-Object System.Collections.Generic.List[object]
  foreach ($processId in @($Job.GetActiveProcessIds())) {
    $identity = Get-MapleSeasonProcessIdentity -ProcessId $processId
    if ($null -eq $identity) {
      throw "$Scenario could not capture an exact identity for owned browser process $processId."
    }
    $snapshot.Add($identity)
  }
  return @($snapshot | Sort-Object ProcessId)
}

function Assert-MapleSeasonJobIdentitySnapshot {
  param(
    [Parameter(Mandatory)][MapleSeasonOwnedJob]$Job,
    [Parameter(Mandatory)][object[]]$Expected,
    [Parameter(Mandatory)][string]$Scenario
  )
  $currentIds = @($Job.GetActiveProcessIds() | Sort-Object)
  $expectedIds = @($Expected.ProcessId | Sort-Object)
  if (($currentIds -join '|') -cne ($expectedIds -join '|')) {
    throw "$Scenario owned browser process membership changed before exact termination."
  }
  foreach ($expected in $Expected) {
    $actual = Get-MapleSeasonProcessIdentity -ProcessId $expected.ProcessId
    $same = $null -ne $actual -and
      $actual.ProcessId -eq $expected.ProcessId -and
      $actual.ParentProcessId -eq $expected.ParentProcessId -and
      [string]::Equals($actual.Name, $expected.Name, [StringComparison]::OrdinalIgnoreCase) -and
      [string]::Equals($actual.ExecutablePath, $expected.ExecutablePath, [StringComparison]::OrdinalIgnoreCase) -and
      [string]::Equals($actual.CreationTimeUtc, $expected.CreationTimeUtc, [StringComparison]::Ordinal) -and
      [string]::Equals($actual.CommandLine, $expected.CommandLine, [StringComparison]::Ordinal)
    if (-not $same) {
      throw "$Scenario owned browser process $($expected.ProcessId) changed identity before exact termination."
    }
  }
}

function Get-MapleSeasonBrowserListeners {
  param(
    [Parameter(Mandatory)][int]$Port,
    [scriptblock]$Query
  )
  try {
    if ($null -ne $Query) { return @(& $Query $Port) }
    return @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { [int]$_.LocalPort -eq $Port })
  } catch {
    throw [InvalidOperationException]::new(
      "Maple browser listener inspection failed for governed port $Port.",
      $_.Exception)
  }
}

function Stop-MapleSeasonOwnedBrowserJob {
  param(
    [Parameter(Mandatory)][MapleSeasonOwnedJob]$Job,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Scenario,
    [ValidateRange(100, 30000)][int]$GracefulMilliseconds = 3000,
    [ValidateRange(100, 30000)][int]$ForcedMilliseconds = 10000
  )
  $gracefulDeadline = [DateTime]::UtcNow.AddMilliseconds($GracefulMilliseconds)
  do {
    $jobIds = @($Job.GetActiveProcessIds())
    $listeners = @(Get-MapleSeasonBrowserListeners -Port $Port)
    if ($jobIds.Count -eq 0 -and $listeners.Count -eq 0) { return }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $gracefulDeadline)

  $jobIds = @($Job.GetActiveProcessIds())
  $listeners = @(Get-MapleSeasonBrowserListeners -Port $Port)
  $unownedListener = @($listeners | Where-Object { $jobIds -notcontains [int]$_.OwningProcess })
  if ($jobIds.Count -gt 0) {
    $identitySnapshot = @(Get-MapleSeasonJobIdentitySnapshot -Job $Job -Scenario $Scenario)
    Assert-MapleSeasonJobIdentitySnapshot -Job $Job -Expected $identitySnapshot -Scenario $Scenario
    $Job.Terminate(125)
    $processDeadline = [DateTime]::UtcNow.AddMilliseconds($ForcedMilliseconds)
    do {
      if (@($Job.GetActiveProcessIds()).Count -eq 0) { break }
      Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $processDeadline)
    if (@($Job.GetActiveProcessIds()).Count -ne 0) {
      throw "$Scenario exact owned browser job did not terminate within its bounded limit."
    }
  }

  $portDeadline = [DateTime]::UtcNow.AddMilliseconds($ForcedMilliseconds)
  do {
    $remaining = @(Get-MapleSeasonBrowserListeners -Port $Port)
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $portDeadline)
  $remaining = @(Get-MapleSeasonBrowserListeners -Port $Port)
  if ($remaining.Count -ne 0) {
    if ($unownedListener.Count -gt 0) {
      throw "$Scenario left an unrecognized listener on governed port $Port; refusing to terminate it."
    }
    throw "$Scenario browser server cleanup did not release governed port $Port."
  }
}

function Write-MapleSeasonBrowserTranscript {
  param([Parameter(Mandatory)][string]$Path)
  if (-not [IO.File]::Exists($Path)) { return }
  foreach ($line in [IO.File]::ReadAllLines($Path)) { $line | Out-Host }
}

function Invoke-MapleSeasonBrowserProof {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Config,
    [Parameter(Mandatory)][string]$Scenario,
    [string]$Grep,
    [ValidateRange(500, 300000)][int]$TimeoutMilliseconds = 300000,
    [string]$RunnerFile
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
  if (@(Get-MapleSeasonBrowserListeners -Port $port).Count -ne 0) {
    throw "$Scenario governed browser port $port was not free before launch."
  }

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $runner = if ([string]::IsNullOrWhiteSpace($RunnerFile)) { Join-Path $Root 'node_modules/@playwright/test/cli.js' } else { $RunnerFile }
  $runner = [IO.Path]::GetFullPath($runner)
  if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw "$Scenario browser runner is unavailable." }
  $arguments = '"{0}" test --config "{1}"' -f $runner, $Config
  if (-not [string]::IsNullOrWhiteSpace($Grep)) {
    if ($Grep -notmatch '^@[a-z0-9-]+$') { throw "$Scenario browser scenario has an invalid grep contract." }
    $arguments += ' --grep "{0}"' -f $Grep
  }

  $transcriptRoot = Join-Path ([IO.Path]::GetTempPath()) ("farmrx-maple-browser-{0}" -f [Guid]::NewGuid().ToString('N'))
  $stdoutPath = Join-Path $transcriptRoot 'stdout.log'
  $stderrPath = Join-Path $transcriptRoot 'stderr.log'
  $job = $null
  $completed = $false
  $exitCode = $null
  $primaryFailure = $null
  $cleanupFailure = $null
  [IO.Directory]::CreateDirectory($transcriptRoot) | Out-Null
  try {
    try {
      $job = [MapleSeasonOwnedJob]::Start($node, $arguments, $Root, $stdoutPath, $stderrPath)
      $completed = $job.WaitForExit($TimeoutMilliseconds)
      if ($completed) { $exitCode = $job.GetExitCode() }
    } catch {
      $primaryFailure = $_.Exception
    } finally {
      if ($null -ne $job) {
        try {
          Stop-MapleSeasonOwnedBrowserJob -Job $job -Port $port -Scenario $Scenario
        } catch {
          $cleanupFailure = $_.Exception
        } finally {
          $job.Dispose()
        }
      }
    }

    Write-MapleSeasonBrowserTranscript -Path $stdoutPath
    Write-MapleSeasonBrowserTranscript -Path $stderrPath

    if ($null -ne $primaryFailure -and $null -ne $cleanupFailure) {
      throw [AggregateException]::new("$Scenario browser execution and exact owned cleanup both failed.", [Exception[]]@($primaryFailure, $cleanupFailure))
    }
    if ($null -ne $cleanupFailure) { throw $cleanupFailure }
    if ($null -ne $primaryFailure) { throw $primaryFailure }
    if (-not $completed) { throw "$Scenario browser scenario exceeded its bounded process limit after verified cleanup." }
    if ($null -eq $exitCode) { throw "$Scenario browser process ended without a readable native exit code." }
    if ([int]$exitCode -ne 0) { throw "$Scenario browser scenario failed with exit code $exitCode." }
    return $true
  } finally {
    if ($null -ne $job) { $job.Dispose() }
    if ([IO.Directory]::Exists($transcriptRoot)) {
      $resolvedTranscript = [IO.Path]::GetFullPath($transcriptRoot)
      $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
      if (-not $resolvedTranscript.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing browser transcript cleanup outside the temporary directory.'
      }
      Remove-Item -LiteralPath $resolvedTranscript -Recurse -Force
    }
  }
}
