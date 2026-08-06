function Test-MapleSeasonCommandLineSeparator {
  param([char]$Character)
  # The ONE definition of what separates two arguments, deliberately not written twice. Windows splits on
  # ASCII space and tab only; [char]::IsWhiteSpace also accepts a non-breaking space and a dozen other
  # characters that are legal in a Windows file name, which is how the sibling C:\FarmRx<NBSP>Backup came
  # to look like our root followed by a boundary. Measured True before this rule was ASCII-only.
  # Splitting this test across the two loops in Split-MapleSeasonCommandLineArguments is what made that bug
  # worse than a wrong answer: with the inner loop stopping at a character the outer loop would not
  # consume, the parse made no progress and never returned. Measured - a widened inner test hung the
  # governed-port regression for four minutes with no output instead of failing it. One definition used by
  # both loops cannot drift apart like that.
  return ($Character -eq ' ' -or $Character -eq "`t")
}

function Split-MapleSeasonCommandLineArguments {
  param([string]$CommandLine)
  # Windows' own argument rules, implemented once, instead of scanning the raw command line for the
  # root text. Three consecutive reviews found a different false-TRUE in that scan, and each was the
  # same mistake: deciding what a character MEANS without tokenizing. Measured defeats of the scan,
  # each of which authorized terminating a foreign process -
  #   node.exe C:\FarmRx\.. --port 4177                       (an unquoted argument ends at whitespace)
  #   node.exe C:\FarmRx" Backup"\scripts\factory-board.mjs   (a quote can OPEN a fragment)
  #   node.exe C:\Other\server.js --label "C:\FarmRx\safe\" --port 4177"
  #                                                           (\" is a LITERAL quote, not a delimiter)
  #   node.exe C:\FarmRx<U+00A0>Backup\server.js              (NBSP is not a Windows separator)
  # The last two cannot be fixed by another boundary test, because they are tokenizer bugs. Windows
  # splits arguments on ASCII space and tab only, and a backslash run before a quote follows the 2n/2n+1
  # rule. This function is verified against CommandLineToArgvW itself in
  # scripts/maple-season-browser-port-preflight.regression.ps1: if Windows and this disagree on any
  # table entry the regression fails, so the rules below are checked against the real parser rather
  # than against my reading of the documentation.
  $arguments = New-Object System.Collections.Generic.List[string]
  # ONE deliberate divergence from CommandLineToArgvW, stated here because the equivalence table cannot
  # assert it: given an empty string the real API returns the path of the CURRENT executable, measured as
  # one argument naming powershell.exe itself. That is documented behaviour and it is worthless as
  # ownership evidence - it would answer a question about a listener with a fact about the process asking.
  # Zero arguments is the fail-closed answer, and the equivalence table records the empty case as
  # excluded on purpose rather than omitting it silently. Every non-empty command line is compared.
  if ([string]::IsNullOrEmpty($CommandLine)) { return $arguments.ToArray() }
  $index = 0
  $length = $CommandLine.Length
  # argv[0] is parsed by its own rule: a backslash is never an escape there, and a leading quote runs
  # to the next quote. Parsing it with the general rule would mis-split a quoted program path. Note that
  # leading whitespace is NOT skipped: Windows begins argv[0] at the first character, so a command line
  # starting with a space yields an EMPTY argv[0] and then parses the rest normally. Skipping the
  # whitespace instead made this disagree with CommandLineToArgvW on '   node.exe   one', which would
  # have parsed the program path under the general rule and changed where its backslashes went.
  if ($index -lt $length) {
    $builder = New-Object System.Text.StringBuilder
    if ($CommandLine[$index] -eq '"') {
      $index++
      while ($index -lt $length -and $CommandLine[$index] -ne '"') { [void]$builder.Append($CommandLine[$index]); $index++ }
      if ($index -lt $length) { $index++ }
    } else {
      while ($index -lt $length -and -not (Test-MapleSeasonCommandLineSeparator -Character $CommandLine[$index])) { [void]$builder.Append($CommandLine[$index]); $index++ }
    }
    $arguments.Add($builder.ToString())
  }
  while ($index -lt $length) {
    while ($index -lt $length -and (Test-MapleSeasonCommandLineSeparator -Character $CommandLine[$index])) { $index++ }
    if ($index -ge $length) { break }
    $argumentStart = $index
    $builder = New-Object System.Text.StringBuilder
    $inQuotes = $false
    while ($index -lt $length) {
      $character = $CommandLine[$index]
      if ((-not $inQuotes) -and (Test-MapleSeasonCommandLineSeparator -Character $character)) { break }
      if ($character -eq '\') {
        $backslashes = 0
        while ($index -lt $length -and $CommandLine[$index] -eq '\') { $backslashes++; $index++ }
        if ($index -lt $length -and $CommandLine[$index] -eq '"') {
          # 2n backslashes then a quote: n backslashes and the quote is a delimiter. 2n+1 backslashes
          # then a quote: n backslashes and a LITERAL quote. This rule is why the escaped-quote command
          # line above defeated a raw quote count - the quote that looked like it closed the argument
          # was data, and the argument kept going.
          [void]$builder.Append('\', [int][Math]::Floor($backslashes / 2))
          if (($backslashes % 2) -eq 1) { [void]$builder.Append('"'); $index++ }
          # An EVEN run leaves the quote for the quote branch below rather than toggling it here. Handling
          # it here duplicated the decision and got it wrong, because a delimiter quote can also be the
          # first half of a doubled quote and only one of the two places knew that. Measured against the
          # real API on `node.exe C:\Other\server.js --label "C:\FarmRx\safe\\"" --port 4177`: Windows
          # returns `C:\FarmRx\safe\"` as its own argument, which the forbidden-character test then
          # refuses, while toggling here produced `C:\FarmRx\safe\ --port 4177` - one argument that starts
          # with our root at a real separator and carries no forbidden character, so the predicate
          # answered True and would have authorized terminating a process whose script was C:\Other.
          # There is now exactly one place in this function that decides what a quote means.
        } else {
          [void]$builder.Append('\', $backslashes)
        }
        continue
      }
      if ($character -eq '"') {
        # CommandLineToArgvW's doubled-quote quirk, and it is NOT the C runtime's: inside a quoted
        # argument, '""' yields one literal quote and LEAVES quoted mode. Measured with the real API on
        # `node.exe "C:\FarmRx"" Backup"\x.js`, which yields 'C:\FarmRx"' and 'Backup\x.js' - two
        # arguments, not the single concatenated sibling path an earlier ledger entry claimed.
        if ($inQuotes -and ($index + 1) -lt $length -and $CommandLine[$index + 1] -eq '"') {
          [void]$builder.Append('"')
          $inQuotes = $false
          $index += 2
          continue
        }
        $inQuotes = -not $inQuotes
        $index++
        continue
      }
      [void]$builder.Append($character)
      $index++
    }
    $arguments.Add($builder.ToString())
    # Every pass of the outer loop must consume at least one character. With the separator test written
    # once this cannot fail, but the consequence of it failing is the worst behaviour this function has:
    # not a wrong answer, which the callers are built to survive, but no answer at all. Measured - a parse
    # that stopped at a character the separator skip would not consume spun on the same index until the
    # governed-port regression was killed at four minutes, having printed nothing.
    # THROW rather than return the short list. An earlier version of this guard broke out of the loop and
    # returned what it had, on the stated reasoning that a truncated parse could only cost an owned
    # listener its match. That reasoning was wrong in the dangerous direction, and it was measured wrong:
    # with the separator test drifted and the command line `node.exe C:\FarmRx<U+00A0>Backup\server.js`,
    # the truncated list was `node.exe`, `C:\FarmRx`, `` - and the bare exact root IS a containment match,
    # so the predicate answered True for a listener living in the sibling tree and would have authorized
    # killing it. A parse that cannot advance is a defect in this function, and the only answer that
    # refuses to kill anything is to fail loudly: cleanup then reports a named internal failure instead of
    # either hanging or guessing.
    if ($index -eq $argumentStart) {
      throw "Split-MapleSeasonCommandLineArguments made no progress at index $index; refusing to answer ownership from a partial parse."
    }
  }
  return $arguments.ToArray()
}

function Test-MapleSeasonPathComponentIsRealName {
  param([string]$Component)
  # Win32 strips trailing dots and spaces from every path component, so '..', '.. ', '... ', '.. .' and
  # ' ' all reduce to a navigation segment or to nothing, and none of them is a directory name. The
  # trim must take dots, spaces and tabs as ONE set: chaining .TrimEnd(' ',tab) then .TrimEnd('.') is
  # order-dependent and left '.. .' with a length of three, so the component walk accepted it and the
  # predicate claimed the parent directory. Measured True before this was one trim.
  return $Component.TrimEnd(' ', "`t", '.').Length -ne 0
}

function Test-MapleSeasonArgumentIsInsideTree {
  param(
    [string]$Argument,
    [string]$NormalizedRoot
  )
  # One argument, one question: does this text name a file inside the given tree? The lesson the tokenizer
  # taught applies here too - decide it with the platform's own path rules rather than a hand-written walk.
  # The walk this replaces refused several spellings that ARE inside the tree, each of which would have
  # declared our own listener foreign and failed a proof month with a wrong diagnosis: `\\?\C:\FarmRx\x.js`,
  # `C:\FarmRx\.\x.js` and `C:\FarmRx\sub\..\x.js`. It also ACCEPTED `C:\FarmRx\NUL`, which is a reserved
  # device rather than a file in the tree, and `C:\FarmRx\file:stream`, which names an alternate data
  # stream. Both were measured.
  $candidate = $Argument.Replace('/', '\')
  # An extended-length prefix is a spelling of the same path, not a different one, so strip it and judge
  # what is underneath. Leaving it on is what refused the first spelling above.
  if ($candidate.StartsWith('\\?\', [StringComparison]::Ordinal)) { $candidate = $candidate.Substring(4) }
  # Characters Win32 forbids in a path. An argument carrying one is not a path at all, and the
  # escaped-quote defeat relied on exactly that: the argument Windows built was
  # `C:\FarmRx\safe" --port 4177`, which starts with our root at a real separator yet is not a filename,
  # while the actual server was a different argument entirely.
  if ($candidate.IndexOfAny([char[]]@('"', '<', '>', '|', '*', '?')) -ge 0) { return $false }
  foreach ($character in $candidate.ToCharArray()) {
    if ([char]::IsControl($character)) { return $false }
  }
  # A colon anywhere past the drive letter names an alternate data stream. This is checked explicitly
  # rather than left to the resolver: [IO.Path]::GetFullPath throws on it under Windows PowerShell 5.1,
  # measured, but this predicate must not answer differently under a shell built on a newer .NET, and a
  # permissive resolver would hand back the stream spelling unchanged for the prefix test to accept.
  if ($candidate.IndexOf(':', 2) -ge 0) { return $false }
  # Require an absolute drive- or share-rooted spelling BEFORE resolving. GetFullPath resolves a relative
  # or drive-relative path against process state - the current directory, or the current directory OF a
  # drive - and no part of a kill authorization may depend on where the shell happens to be standing.
  # `C:FarmRx\server.js` is therefore refused rather than resolved, which is fail-closed.
  if (-not (($candidate -match '^[A-Za-z]:\\') -or ($candidate -match '^\\\\[^\\?.]'))) { return $false }
  try { $resolved = [System.IO.Path]::GetFullPath($candidate) } catch { return $false }
  $resolved = $resolved.Replace('/', '\')
  if (-not $resolved.StartsWith($NormalizedRoot, [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $tail = $resolved.Substring($NormalizedRoot.Length)
  # The root must end at a directory boundary within this argument, or be the whole argument. Without
  # this, root C:\FarmRx claimed a listener running out of C:\FarmRx2.
  if ($tail.Length -gt 0 -and $tail[0] -ne '\') { return $false }
  foreach ($component in $tail.Split('\')) {
    # A truly empty component is a doubled separator, which Windows collapses and which cannot escape.
    if ($component.Length -eq 0) { continue }
    # GetFullPath resolves '.' and '..' but does NOT apply Win32's rule that trailing dots and spaces are
    # stripped from each component, measured: `C:\FarmRx\.. \Other\x.js` comes back unchanged, and Windows
    # would open it as `C:\Other\x.js`. So the component test still earns its place after the resolver.
    if (-not (Test-MapleSeasonPathComponentIsRealName -Component $component)) { return $false }
    # Reserved device names resolve to a device, not to a file in this tree. Under Windows PowerShell 5.1
    # GetFullPath already turns `C:\FarmRx\NUL` into `\\.\NUL`, which fails the prefix test above; this
    # check is what keeps the answer the same on a shell whose resolver leaves it alone.
    $bareName = $component.TrimEnd(' ', "`t", '.')
    $dot = $bareName.IndexOf('.')
    if ($dot -ge 0) { $bareName = $bareName.Substring(0, $dot) }
    if ($bareName -match '(?i)^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$') { return $false }
  }
  return $true
}

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
  # Windows has TWO argument grammars, and this predicate cannot know which one built the process it is
  # judging. CommandLineToArgvW is what this file reproduces and what the equivalence table checks; node
  # itself enters at wmain and gets the Microsoft C runtime's parse, and the two were MEASURED disagreeing
  # about a doubled quote. The earlier wording "exactly one construct" is withdrawn: no measurement here
  # enumerated every construct, so the claim that stands is the disagreement observed. Measured with the real
  # API on
  # `node.exe C:\Other\server.js --label "C:\Other"" C:\FarmRx\safe"`: shell32 splits the label into
  # `C:\Other"` and `C:\FarmRx\safe`, so the second half reads as a path in our tree, while under the
  # documented C runtime rule the label stays one argument that names nothing of ours. Both readings are
  # defensible and only one can be right, so a command line carrying a doubled quote is refused outright
  # rather than guessed at. Refusing costs a cleanup diagnosis; guessing costs a foreign process.
  if ($commandLine.Contains('""')) { return $false }
  # Put the root into one separator form. The command line is deliberately NOT normalized here: it is
  # handed to the tokenizer as Windows gave it, and each resulting ARGUMENT is normalized on its own in
  # Test-MapleSeasonArgumentIsInsideTree. Normalizing the whole line up front was left over from the raw
  # substring scan and nothing reads it now, so it is gone rather than kept as a decoy.
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
    if (-not (Test-MapleSeasonPathComponentIsRealName -Component $segment)) { return $false }
  }
  # Ask Windows how this command line splits, then test whole ARGUMENTS for containment. The previous
  # version searched the raw text for the root and then tried to prove the match sat at a real boundary;
  # that is the tokenizer's job, and doing it by hand produced a new false-TRUE in each of the last three
  # reviews. Comparing arguments removes the whole class: a sibling such as C:\FarmRx<NBSP>Backup is
  # simply a different argument, not our root followed by something the boundary test has to classify.
  $rooted = $false
  foreach ($argument in (Split-MapleSeasonCommandLineArguments -CommandLine $commandLine)) {
    if ([string]::IsNullOrEmpty($argument)) { continue }
    if (-not (Test-MapleSeasonArgumentIsInsideTree -Argument $argument -NormalizedRoot $normalizedRoot)) { continue }
    # Keep no early exit on a REFUSED argument: an unrelated leading argument such as
    # --require C:\FarmRx2\hook.js must not mask the real owned path later in the same command line,
    # which declared our own server foreign and failed the month with a wrong diagnosis.
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
