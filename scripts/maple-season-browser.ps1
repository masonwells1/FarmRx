function Test-MapleSeasonBrowserPortOwned {
  param(
    $ListenerProcess,
    [string]$Root
  )
  # Neither parameter is Mandatory: that would make the guards below dead code and would turn a
  # caller that forgets -Root into an interactive prompt, which hangs a proof run instead of failing
  # it. A missing argument has to fail closed to "not ours", and the only consequence of that is
  # refusing to terminate something.
  # $Root keeps its [string] cast, though, and the cast is load-bearing in the other direction. With
  # the cast dropped, a caller that passed a non-string - a port number, a path object - reached
  # .Replace() below and got "does not contain a method named 'Replace'" instead of the fail-closed
  # answer this function promises. The cast coerces such an argument to text, which then fails the
  # root-shape check a few lines down and returns false.
  # CommandLine is null for a process this session cannot inspect (another user, or elevated).
  # Guard it explicitly: calling .IndexOf() on $null raises a method-not-found error in every
  # PowerShell mode, so without this guard the callers get an exception instead of the "not ours"
  # answer they depend on.
  if ($null -eq $ListenerProcess) { return $false }
  $commandLine = $ListenerProcess.CommandLine
  # IsNullOrWhiteSpace, not IsNullOrEmpty. A root of a single space survived the empty check, and a
  # space occurs in nearly every command line, so root ' ' matched a foreign listener and authorized
  # killing it.
  if ([string]::IsNullOrWhiteSpace($commandLine)) { return $false }
  if ([string]::IsNullOrWhiteSpace($Root)) { return $false }
  # Compare on one separator form, then require the root to end at a directory boundary. A bare
  # substring test lets root C:\FarmRx claim a listener running out of C:\FarmRx2, and this
  # predicate gates the Stop-Process in Clear-MapleSeasonBrowserPort, so an over-broad match would
  # terminate a process this proof does not own.
  $normalizedCommandLine = $commandLine.Replace('/', '\')
  $normalizedRoot = $Root.Replace('/', '\').TrimEnd('\')
  # TrimEnd can empty the root (Root of '\' or '/'), and IndexOf('') succeeds at every position,
  # so without this the predicate would claim every listener.
  if ([string]::IsNullOrWhiteSpace($normalizedRoot)) { return $false }
  # The root must name a directory BELOW a drive or share root, and the emptiness check above is not
  # enough to enforce that. TrimEnd reduces 'C:\' to 'C:', which is non-empty and which every
  # absolute path on that drive continues with a separator - a legal boundary - so root 'C:\' claimed
  # every node process on the machine and authorized killing all of them. A relative root has the
  # same shape of problem: root '.' matched the '.' in `node .`, and in most command lines besides.
  # Requiring a named directory under the root rejects 'C:\', 'C:', '.', '\\server\share', and any
  # bare relative name, all of which are too broad to identify one tree.
  # A device or extended-length prefix is rejected before the share shape is considered, because
  # '\\.\C:\FarmRx' satisfies the share pattern below - it reads as share '\\.\C:' with a directory
  # 'FarmRx' under it - and would then be accepted as a named tree. These spellings alias a path this
  # predicate may already hold under its normal name, so accepting them means the same tree can be
  # matched two ways and only one of them was ever tested.
  if ($normalizedRoot -match '^\\\\[.?]\\') { return $false }
  $rootNamesDirectoryUnderDrive = $normalizedRoot -match '^[A-Za-z]:\\[^\\]'
  $rootNamesDirectoryUnderShare = $normalizedRoot -match '^\\\\[^\\]+\\[^\\]+\\[^\\]'
  if (-not ($rootNamesDirectoryUnderDrive -or $rootNamesDirectoryUnderShare)) { return $false }
  # The shape check above is necessary but not sufficient, and the gap fails OPEN. It only demands one
  # character after the root separator, and '.', '..', a space, and a tab are all one character, so
  # 'C:\.', 'C:\..', 'C:\ ', and "C:\`t" passed it and each one claimed an unrelated listener - the
  # same authorize-a-kill answer the plain 'C:\' hole gave. 'C:\FarmRx\..' passed too and names the
  # drive root by another spelling. Require every segment below the drive or share root to be a real
  # directory name: not empty, not whitespace, and not a relative navigation segment.
  $rootTail = if ($rootNamesDirectoryUnderDrive) { $normalizedRoot.Substring(3) } else { ($normalizedRoot -replace '^\\\\[^\\]+\\[^\\]+\\', '') }
  foreach ($segment in $rootTail.Split('\')) {
    if ([string]::IsNullOrWhiteSpace($segment)) { return $false }
    if ($segment.TrimEnd(' ', "`t").TrimEnd('.').Length -eq 0) { return $false }
  }
  # Neither a space nor an apostrophe is a boundary. Both are legal in a Windows directory name, so
  # treating either as a terminator lets root C:\FarmRx claim a different tree and this predicate
  # authorizes killing what it finds there: a space accepted "C:\FarmRx Backup\node_modules\vite\..."
  # and an apostrophe accepted "C:\FarmRx's Backup\node_modules\vite\...". A double quote is not simply
  # a boundary either: whether it closes the argument or opens another fragment of the same name depends
  # on how many quotes precede it, which the parity test below establishes.
  $rooted = $false
  $searchIndex = 0
  while ($searchIndex -le ($normalizedCommandLine.Length - $normalizedRoot.Length)) {
    $matchIndex = $normalizedCommandLine.IndexOf($normalizedRoot, $searchIndex, [StringComparison]::OrdinalIgnoreCase)
    if ($matchIndex -lt 0) { break }
    # Keep scanning past this occurrence whatever it turns out to be. Stopping at the first occurrence
    # let an unrelated leading argument such as --require C:\FarmRx2\hook.js mask the real owned path
    # later in the same command line, which declared our own server foreign and failed the month at
    # cleanup with a wrong diagnosis. Advancing here rather than at the bottom of the loop means every
    # `continue` below is safe.
    $searchIndex = $matchIndex + 1
    $boundaryIndex = $matchIndex + $normalizedRoot.Length
    # Count the double quotes ahead of this occurrence. Quote parity is what a character after the root
    # MEANS: inside a quoted argument a space belongs to the directory name and a double quote closes
    # the argument, while outside one a space ends the argument and a double quote OPENS a fragment that
    # continues the same name. Measured with root C:\FarmRx: without this test
    # `node.exe C:\FarmRx" Backup"\scripts\factory-board.mjs` answered True, because the bare quote was
    # read as a closing quote - yet the argument Windows actually builds is C:\FarmRx Backup\..., a
    # sibling directory, and this predicate is the sole gate on Stop-Process -Force.
    $quotesBefore = 0
    for ($scan = 0; $scan -lt $matchIndex; $scan++) {
      if ($normalizedCommandLine[$scan] -eq '"') { $quotesBefore++ }
    }
    $insideQuotes = ($quotesBefore % 2) -eq 1
    # An unquoted occurrence has to be ONE argument. Windows splits an unquoted argument at whitespace,
    # so when the root's own name contains a space the matched text spans two arguments and the root is
    # not really present. Measured: root 'C:\Mason FarmRx' against `node C:\Mason FarmRx` answered True,
    # yet what that command line actually passes is 'C:\Mason' and then 'FarmRx'. A listener genuinely
    # running from a space-bearing root quotes it, which is the branch above.
    if ((-not $insideQuotes) -and ($normalizedRoot -match '\s')) { continue }
    # Find where this argument ends, so the traversal walk below sees one path token instead of the rest
    # of the command line. Measured: scanning only to the next double quote left the tail
    # '\.. --port 4177' for `node.exe C:\FarmRx\.. --port 4177`, which is not the exact segment '..', so
    # the traversal refusal missed it and the predicate claimed the PARENT directory.
    $tokenEnd = $normalizedCommandLine.Length
    $argumentContinues = $false
    for ($scan = $boundaryIndex; $scan -lt $normalizedCommandLine.Length; $scan++) {
      $character = $normalizedCommandLine[$scan]
      if ($character -eq '"') {
        $tokenEnd = $scan
        # An unquoted token cannot be ended by a quote - that quote opens a fragment appended to this
        # same name. A quoted token's closing quote must be followed by whitespace or nothing; anything
        # else (including the '""' spelling) concatenates a further fragment. Either way the argument
        # being built is longer than the text matched here, so this occurrence proves nothing.
        $argumentContinues = (-not $insideQuotes) -or -not (($scan -eq ($normalizedCommandLine.Length - 1)) -or [char]::IsWhiteSpace($normalizedCommandLine[$scan + 1]))
        break
      }
      if ((-not $insideQuotes) -and [char]::IsWhiteSpace($character)) { $tokenEnd = $scan; break }
    }
    if ($argumentContinues) { continue }
    # The root must end where a directory name can end: at a separator inside the token, or exactly at
    # the token's end. Whitespace is a boundary only for an unquoted token, which is why the token end
    # is computed above rather than tested character by character - inside quotes a space is part of the
    # name, outside quotes it ends the argument.
    $endsAtTokenEnd = $boundaryIndex -ge $tokenEnd
    $endsAtSeparator = (-not $endsAtTokenEnd) -and ($normalizedCommandLine[$boundaryIndex] -eq '\')
    if (-not ($endsAtTokenEnd -or $endsAtSeparator)) { continue }
    # A boundary-valid occurrence still has to stay inside the tree it names, and matching the root
    # text does not establish that. Measured with root C:\FarmRx against
    # `node.exe "C:\FarmRx\..\Other\scripts\factory-board.mjs" --port 4177`: the root was found at a
    # real separator, this predicate answered True, and it would have authorized Stop-Process -Force
    # against a process running wholly outside the repository - the parent directory reached by another
    # spelling. Walk the remaining segments of this one token and refuse a parent traversal. Farm Rx
    # builds these paths through [IO.Path]::GetFullPath, which leaves no '..' behind, so no legitimate
    # listener loses its match; and refusing is the fail-closed answer, which costs a cleanup diagnosis
    # rather than a wrong termination.
    $escapesTree = $false
    foreach ($segment in $normalizedCommandLine.Substring($boundaryIndex, $tokenEnd - $boundaryIndex).Split('\')) {
      # A truly empty segment is a doubled separator, which Windows collapses and which cannot escape.
      if ($segment.Length -eq 0) { continue }
      # Win32 strips trailing dots and spaces from a path component, so '.. ' reaches the parent exactly
      # as '..' does, and a component built only of dots and spaces is never a real directory name.
      # Measured: '"C:\FarmRx\.. \Other\x.js"' and '"C:\FarmRx\... \Other\x.js"' both answered True
      # before this normalization.
      if ($segment.TrimEnd(' ', "`t").TrimEnd('.').Length -eq 0) { $escapesTree = $true; break }
    }
    if ($escapesTree) { continue }
    $rooted = $true
    break
  }
  if (-not $rooted) { return $false }
  # Test the image name, not the command line. The old '(vite|npm|node)' match scanned the whole
  # command line, so any process whose arguments merely mentioned node_modules qualified; an
  # argument cannot satisfy this. This still cannot tell our season server apart from another Node
  # process started by hand inside this tree - Assert-MapleSeasonBrowserPortFree is what guards
  # that case, before launch - so it is a narrowing, not a proof of ownership.
  return ([string]$ListenerProcess.Name) -match '(?i)^(node|npm|npx)(\.exe)?$'
}

function Clear-MapleSeasonBrowserPort {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Scenario
  )
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    # Take the process object BEFORE validating ownership. A process id is not a durable identity: the
    # validated process can exit and Windows can hand its number to something unrelated, and what
    # follows is a force kill. Holding the object first, then killing through it rather than by number,
    # removes the window in which the id could come to mean a different process.
    $ownedProcess = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($null -eq $ownedProcess) { continue }
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($ownedProcess.Id)" -ErrorAction SilentlyContinue
    $owned = Test-MapleSeasonBrowserPortOwned -ListenerProcess $listenerProcess -Root $Root
    if (-not $owned) {
      throw "$Scenario found an unrecognized listener on governed port $Port; refusing to terminate it."
    }
    # Confirm the object about to be killed is the one that was validated. The ownership test ran against
    # a WMI snapshot; comparing that snapshot's creation time to the live object's start time is what
    # detects an id that changed hands between the two reads. Refusing is the fail-closed answer: it
    # costs a cleanup diagnosis, where guessing costs an unrelated process.
    $validatedStart = $null
    if ($null -ne $listenerProcess) { $validatedStart = $listenerProcess.CreationDate }
    if ($null -eq $validatedStart) {
      throw "$Scenario could not read the start time of the listener on governed port $Port; refusing to terminate it."
    }
    if ([Math]::Abs((New-TimeSpan -Start $validatedStart -End $ownedProcess.StartTime).TotalSeconds) -gt 1) {
      throw "$Scenario found the process id on governed port $Port no longer identifies the listener it validated; refusing to terminate it."
    }
    if ($ownedProcess.HasExited) { continue }
    $ownedProcess.Kill()
    if (-not $ownedProcess.WaitForExit(10000)) {
      throw "$Scenario browser server did not terminate within ten seconds."
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
  $ownedHolders = [Collections.Generic.List[string]]::new()
  $foreignHolders = [Collections.Generic.List[string]]::new()
  foreach ($listener in $listeners) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    # Image name and PID only. A foreign command line can carry tokens or private paths and
    # this message is written into season evidence logs.
    $name = if ($null -eq $listenerProcess) { 'unknown' } else { $listenerProcess.Name }
    $holder = "$name (PID $($listener.OwningProcess))"
    # Bucket by ownership rather than counting. A combined list plus "some of these are foreign"
    # gave the operator no way to tell which PID to go look at, which is the mis-diagnosis this
    # preflight exists to remove.
    if (Test-MapleSeasonBrowserPortOwned -ListenerProcess $listenerProcess -Root $Root) { $ownedHolders.Add($holder) }
    else { $foreignHolders.Add($holder) }
  }
  # No -f here: $Scenario is caller-supplied and already interpolated, so a brace in it would
  # turn this refusal into a FormatException instead of the diagnosis.
  # Select-Object -Unique, not Sort-Object -Unique: the latter reordered holders alphabetically, so
  # the message no longer matched the order of the listener enumeration the operator is comparing
  # it against.
  $ownedList = ($ownedHolders | Select-Object -Unique) -join ', '
  $foreignList = ($foreignHolders | Select-Object -Unique) -join ', '
  # Distinguish a Farm Rx server from a genuinely foreign one. Vite has no strictPort, so a season
  # server can drift onto the next month's governed port; telling the operator to hunt a foreign
  # squatter that does not exist is the same mis-diagnosis this preflight exists to remove. But the
  # ownership test only proves the command line looks like Farm Rx, not that a proof leaked it - a
  # developer's own `npm run dev` in this tree matches identically, so name both causes rather than
  # asserting a leak. Both branches carry the $PortVariable redirect: the operator needs a way
  # forward even when the holder is theirs and they do not want to stop it. Refuse either way -
  # never terminate a listener this scenario did not create.
  $redirect = "Free that port or set $PortVariable to an unused port."
  if ($ownedHolders.Count -gt 0) {
    $mixed = if ($foreignHolders.Count -gt 0) { " Listeners on that port that do not belong to Farm Rx: $foreignList." } else { '' }
    throw "$Scenario cannot start: governed port $Port was already held by a Farm Rx dev or season server ($ownedList) before this scenario ran.$mixed An earlier proof that never released the port is the usual cause, but a development server started by hand in this tree looks the same; stop that server or investigate the proof that left it behind. $redirect"
  }
  throw "$Scenario cannot start: governed port $Port was already in use by $foreignList before this scenario ran, and no listener there belongs to Farm Rx. $redirect"
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
