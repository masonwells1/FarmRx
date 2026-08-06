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
  # assert it: given an empty string the real API returns the path of the CURRENT executable, tokenized on
  # spaces - so the ARGUMENT COUNT is host-dependent, and the earlier "one argument naming powershell.exe"
  # here was only true of the host it was written on. Measured: Windows PowerShell 5.1 asks from
  # `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` and gets 1 argument; pwsh 7 asks from
  # `C:\Program Files\PowerShell\7\pwsh.exe` and gets 2, split at the space in "Program Files". The
  # regression therefore asserts the rejoined CONTENT against the asking process's own module path rather
  # than a count. Either way the answer is built from the caller, and it is worthless as
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
  Initialize-MapleSeasonProcessInterop
  $listeners = @(Get-MapleSeasonPortListener -Port $Port -Scenario $Scenario)
  # TWO PASSES, and the split is the point. The previous version validated and killed one listener at a
  # time, so a port held by an owned listener AND a foreign one left the owned one already dead when the
  # foreign one threw - a refusal that had by then terminated something. MEASURED, not reasoned: with the
  # previous version the owned listener was killed and the call still reported "refusing to terminate it";
  # with this version both listeners were still running after the same refusal. A port can genuinely hold
  # more than one listener - two node processes were measured holding one port together, one bound to
  # 127.0.0.1 and one to ::1, and Get-NetTCPConnection returned both rows, in IPv6-first order, which is
  # not creation order, so nothing about the ordering can be relied on either. Validate every listener
  # before terminating any of them.
  $handle = [IntPtr]::Zero
  $validated = @()
  # Whether a real failure is already on its way out. The handle-close check in the finally must REPORT a
  # leaked pin, never replace the diagnosis of why the cleanup failed in the first place.
  $primaryFailure = $false
  $closeFailures = [Collections.Generic.List[string]]::new()
  try {
    foreach ($listener in $listeners) {
      $listenerId = [int]$listener.OwningProcess
      # Open the handle FIRST and do everything else through it. Get-Process was MEASURED to pin nothing:
      # haveProcessHandle stayed False and m_processHandle stayed null before, during and after
      # .StartTime, .HasExited and after the child exited - so those and .Kill() each re-resolve the id at
      # call time, and the old comment claiming the object "removes the window in which the id could come
      # to mean a different process" was false. An open handle is what actually removes it: the kernel
      # keeps the process object, and therefore reserves its id, until the last handle closes. Measured:
      # after the process died, GetProcessTimes on the same handle still answered with a nonzero exit
      # time.
      $handle = [MapleSeasonProcessInterop]::OpenProcess(
        [MapleSeasonProcessInterop]::PROCESS_QUERY_LIMITED_INFORMATION -bor [MapleSeasonProcessInterop]::PROCESS_TERMINATE -bor [MapleSeasonProcessInterop]::SYNCHRONIZE,
        $false,
        [uint32]$listenerId)
      if ($handle -eq [IntPtr]::Zero) {
        # Cannot inspect it, so cannot claim it. Refusing costs a cleanup diagnosis; the old code
        # `continue`d past an unreadable listener and let the drain loop below fail with a message about
        # a port that would not release, which named neither the process nor the reason.
        throw "$Scenario could not open the listener holding governed port $Port (pid $listenerId, Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())); refusing to terminate it."
      }
      $creation = 0L; $exited = 0L; $kernel = 0L; $user = 0L
      if (-not [MapleSeasonProcessInterop]::GetProcessTimes($handle, [ref]$creation, [ref]$exited, [ref]$kernel, [ref]$user)) {
        throw "$Scenario could not read the start time of the listener holding governed port $Port (pid $listenerId); refusing to terminate it."
      }
      if ($exited -ne 0) {
        # Already gone. Our handle still reserves the id, so nothing else can be behind it; drop it and
        # let the drain loop confirm the port is released. The close is COLLECTED, not cast to void: this
        # branch was the one place a failed close stayed invisible, because clearing $handle immediately
        # afterwards also cleared the finally's only way to notice it, and a fresh-context review was right
        # that the earlier claim to have closed that gap everywhere was false.
        if (-not [MapleSeasonProcessInterop]::CloseHandle($handle)) {
          $closeFailures.Add("the already-exited listener pid $listenerId (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))")
        }
        $handle = [IntPtr]::Zero
        continue
      }
      # BIND THE HANDLE TO A LISTENER ROW OBSERVED WHILE IT WAS HELD. The snapshot above was taken before any
      # handle existed, so on its own it authorizes a kill on the strength of a row that may already have been
      # historical when it was read: if that listener exited and its id was reused, the handle, the WMI row and
      # the creation-time comparison all describe the REPLACEMENT and all agree with each other, and a
      # replacement that happens to be a node process inside the tree would be terminated having never held the
      # port. A fresh-context review found that, and it is the sharper half of the ownership problem this file
      # carries. Re-reading the table now closes it: from the moment the handle opened, this id cannot change
      # hands, so a listener row naming it is a row about the process in our hand. No row, no kill.
      $stillListening = @(@(Get-MapleSeasonPortListener -Port $Port -Scenario $Scenario) | Where-Object { [int]$_.OwningProcess -eq $listenerId })
      if ($stillListening.Count -eq 0) {
        throw "$Scenario found pid $listenerId no longer listening on governed port $Port once it could be pinned, so the snapshot naming it was stale; refusing to terminate it."
      }
      # The ownership predicate needs the command line, which only WMI carries. Querying by id is safe
      # HERE and nowhere else in this function: our handle already reserves that id, so this row cannot
      # describe some other live process that inherited the number.
      $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerId" -ErrorAction SilentlyContinue
      if ($null -eq $listenerProcess -or $null -eq $listenerProcess.CreationDate) {
        throw "$Scenario could not read the command line of the listener holding governed port $Port (pid $listenerId); refusing to terminate it."
      }
      # SAY WHAT THIS IS, AND NOT MORE. It compares ONE FIELD: the row's CreationDate against the creation
      # time of the process this handle holds. That is enough to reject a row left over from a previous
      # occupant of the id, which is what it is here for, and it is NOT a confirmation that the row as a whole
      # was read of that process - a row whose CreationDate is current while its Name and CommandLine are
      # stale passes this and then feeds the predicate. A fresh-context review said "confirms the row is the
      # same process" was an overclaim in exactly that way and it was right. Identity comes from the handle,
      # which reserves the id, and from the listener re-read above, which binds that id to the port while the
      # handle was held. What would close the remaining field-level gap is handle-bound launch provenance -
      # a Job Object - which this file does not yet have (F1, open).
      #
      # Ten FILETIME ticks - one microsecond - is the documented granularity of a CIM datetime, and the
      # disagreement was MEASURED against the kernel across 304 processes on this workstation: max 9 ticks,
      # median 4, and only 34 of 304 exactly equal. So exact equality would refuse almost every real
      # cleanup, and the previous one-SECOND window was a hundred million times looser than the measurement
      # needs - wide enough to accept a replacement born inside it. The bound is the MEASURED maximum, 9,
      # not the round number above it: `-gt 10` accepted a ten-tick disagreement that nothing here ever
      # observed, and a bound should be the largest value the measurement actually produced. Tightening
      # fails in the safe direction - a wider disagreement now refuses the cleanup by name instead of
      # authorizing a kill on a row it cannot vouch for.
      $snapshotTicks = $listenerProcess.CreationDate.ToUniversalTime().ToFileTimeUtc()
      if ([Math]::Abs($creation - $snapshotTicks) -gt 9) {
        throw "$Scenario found the process id holding governed port $Port no longer identifies the listener it validated; refusing to terminate it."
      }
      if (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess $listenerProcess -Root $Root)) {
        throw "$Scenario found an unrecognized listener on governed port $Port; refusing to terminate it."
      }
      $validated += [pscustomobject]@{ Handle = $handle; ProcessId = $listenerId }
      $handle = [IntPtr]::Zero
    }

    # Pass two. Every listener above is owned, and each is terminated through the handle that validated
    # it, so no id is resolved a second time and nothing can change hands in between.
    foreach ($target in $validated) {
      if (-not [MapleSeasonProcessInterop]::TerminateProcess($target.Handle, 1)) {
        $lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        $creation = 0L; $exited = 0L; $kernel = 0L; $user = 0L
        $alreadyGone = [MapleSeasonProcessInterop]::GetProcessTimes($target.Handle, [ref]$creation, [ref]$exited, [ref]$kernel, [ref]$user) -and $exited -ne 0
        if (-not $alreadyGone) {
          throw "$Scenario could not terminate its owned listener on governed port $Port (pid $($target.ProcessId), Windows error $lastError)."
        }
      }
      # WAIT_OBJECT_0 is 0; anything else (WAIT_TIMEOUT 0x102, WAIT_FAILED 0xFFFFFFFF) is a failure.
      if ([MapleSeasonProcessInterop]::WaitForSingleObject($target.Handle, 10000) -ne 0) {
        throw "$Scenario browser server did not terminate within ten seconds."
      }
    }
  } catch {
    # Bare `throw` inside catch rethrows the ErrorRecord unchanged; this exists only to record that the
    # body failed, so the close check below downgrades itself to a warning instead of overwriting the real
    # error on its way out of the finally.
    $primaryFailure = $true
    throw
  } finally {
    # A FAILED CLOSE IS NOT NOTHING, and while both of these were cast to void it was invisible. The kernel
    # keeps a process object - and therefore keeps reserving its id - until the last handle to it closes, so
    # a handle this function opened and failed to close leaves that id pinned for the life of the session,
    # and a later run reading that id is reading a reservation nobody owns any more. Collect, then decide:
    # never mask a primary failure with a footnote about cleanup of the cleanup.
    foreach ($target in $validated) {
      if (-not [MapleSeasonProcessInterop]::CloseHandle($target.Handle)) {
        $closeFailures.Add("pid $($target.ProcessId) (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))")
      }
    }
    if ($handle -ne [IntPtr]::Zero -and -not [MapleSeasonProcessInterop]::CloseHandle($handle)) {
      $closeFailures.Add("the listener still being validated (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))")
    }
    if ($closeFailures.Count -gt 0) {
      $leak = "$Scenario could not close $($closeFailures.Count) process handle(s) it opened for governed port $Port ($($closeFailures -join '; ')), so those process ids stay reserved for the life of this session."
      # -WarningAction Continue is PINNED on the downgrade, because Write-Warning honours $WarningPreference
      # and a warning is only a footnote while it stays non-terminating. MEASURED: with a caller passing
      # -WarningAction Stop, this line raised a terminating error from inside the finally and the message the
      # caller caught became "the running command stopped because the preference variable ... is set to Stop:
      # <footnote>" - the leaked-handle note had replaced the cleanup's real diagnosis, which is the exact
      # masking $primaryFailure exists to prevent. Pinned, the same test caught the real diagnosis instead,
      # and -WarningVariable still captured the footnote, so the regression that reads the warning stream is
      # unaffected. A fresh-context review found this.
      if ($primaryFailure) { Write-Warning $leak -WarningAction Continue } else { throw $leak }
    }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $remaining = @(Get-MapleSeasonPortListener -Port $Port -Scenario $Scenario)
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "$Scenario browser server cleanup did not release governed port $Port."
}

function Initialize-MapleSeasonProcessInterop {
  # Declared AFTER the Clear-MapleSeasonBrowserPort boundary on purpose:
  # maple-season-browser-ownership.regression.ps1 slices everything above that line and dot-sources it as
  # pure functions, and that suite must not start compiling interop to test string handling.
  if ('MapleSeasonProcessInterop' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MapleSeasonProcessInterop {
  public const uint PROCESS_TERMINATE = 0x0001;
  public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  public const uint SYNCHRONIZE = 0x00100000;
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
}
'@
}

function Get-MapleSeasonPortListener {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Scenario
  )
  # -ErrorAction Stop, not SilentlyContinue. Both callers used to swallow every error, and both read the
  # resulting empty list as "nothing is listening" - so a query that FAILED reported the port clean and
  # the cleanup reported done. That fails OPEN, which is the one direction this file must never fail.
  # Measured: an empty result raises Microsoft.PowerShell.Cmdletization.Cim.CimJobException with
  # FullyQualifiedErrorId 'CmdletizationQuery_NotFound,Get-NetTCPConnection' and category ObjectNotFound,
  # so "nothing is listening" IS distinguishable from a broken query. Only that one error means empty.
  # This is the ONLY call to Get-NetTCPConnection in this file, pinned as such by
  # scripts/foundation-static-guards.mjs, so no caller can reintroduce a fail-open probe of its own.
  #
  # -ceq AGAINST THE WHOLE ID, not a prefix. The previous `-like 'CmdletizationQuery_NotFound*'` accepted any
  # id merely BEGINNING that way - `CmdletizationQuery_NotFoundSomethingElse,Get-NetTCPConnection` among them
  # - and a fresh-context review was right that "the id starts the way the measured one starts" is not the
  # same claim as "this is the measured one". That review also corrected an overstatement here: the earlier
  # wording said the prefix accepted not-found ids "from any cmdlet", which this try block cannot actually
  # produce because the only cmdlet inside it is the one below. Exact is the
  # fail-closed direction only if the id is genuinely identical everywhere this runs, so that was measured
  # rather than assumed, on both hosts that can run this file: Windows PowerShell 5.1.26100.8875 and
  # pwsh 7.6.3 each answered a free port with the byte-identical 48-character id below, and each answered
  # an INVALID port with 'ParameterArgumentTransformationError,Get-NetTCPConnection', which the prefix form
  # also rejected. Anything else - permission denied, a dead CIM service, a timeout - now throws with a
  # name instead of being read as an empty port.
  #
  # THE COST OF EXACT IS FRAGILITY, and it is accepted deliberately rather than overlooked. Two engines on one
  # workstation is the whole of the evidence; a future NetTCPIP or CIM module that renames or recases this id
  # turns a healthy free port into a thrown error on every scenario. That direction is survivable - a loud,
  # named refusal that a maintainer fixes in one line - and the direction the prefix risked was a broken query
  # read as a free port, which authorizes a launch onto an occupied port and a cleanup that reports done. A
  # fresh-context review raised the fragility; it is the trade, not an oversight.
  try {
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
  } catch {
    if ($_.FullyQualifiedErrorId -ceq 'CmdletizationQuery_NotFound,Get-NetTCPConnection') { return @() }
    throw "$Scenario could not read the listener table for governed port $Port, so it cannot tell an occupied port from a free one: $($_.Exception.Message)"
  }
}

function Assert-MapleSeasonBrowserPortFree {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Scenario,
    [Parameter(Mandatory)][string]$PortVariable,
    [Parameter(Mandatory)][string]$Root
  )
  # Through the shared helper, so a broken listener query THROWS instead of reporting the port clean.
  # This preflight decides whether a scenario may launch; the old SilentlyContinue probe read a failed
  # query as an empty port, which is the direction that lets a scenario launch into an occupied one.
  $listeners = @(Get-MapleSeasonPortListener -Port $Port -Scenario $Scenario)
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
  # THE TRY OPENS ON THE LINE AFTER THE LAUNCH, and that placement is the fix for a real leak. Pinning the id
  # and compiling the interop used to sit between Start() and the try, so an Add-Type failure or an
  # unpinnable id threw with a live `node playwright test` child - and its dev-server grandchild holding the
  # governed port - still running, unwaited and unkilled, while the scenario reported failure. A fresh-context
  # review found that; nothing below the try can protect a process launched above it, so nothing is above it.
  $launchedHandle = [IntPtr]::Zero
  $primaryFailure = $false
  # WHETHER A CLEANUP OF THIS PORT ALREADY OBSERVED IT FREE. This is not the $portReleased flag that was removed
  # from here, and the difference is the whole point: that flag decided whether to LOOK at the port, and skipping
  # the look is what let a late-binding descendant hold it. This decides only whether a listener found at salvage
  # time may be KILLED. Clear-MapleSeasonBrowserPort returns only after its own loop observes zero listeners, so a
  # normal return means this port was observed free - and a listener appearing after that is, by construction, one
  # this scenario never launched.
  $verifiedPortRelease = $false
  try {
    # PIN THE ID THIS FUNCTION WILL KILL BY, with a handle of this file's own, held until after the kill.
    # `taskkill /PID` names a NUMBER, and a number means one particular process only for as long as the
    # kernel is still reserving it.
    #
    # The id is in fact already reserved here - by an implementation detail. MEASURED on this workstation, and
    # deliberately contrasted with the object shape Clear-MapleSeasonBrowserPort has to work with:
    #   Process.Start()          -> haveProcessHandle True,  m_processHandle open, still open AFTER exit
    #   Start-Process -PassThru  -> haveProcessHandle True,  m_processHandle open, still open AFTER exit
    #   Get-Process -Id          -> haveProcessHandle False, m_processHandle null
    # So a fresh-context review's reading that this path force-kills "without retaining a native handle" was
    # wrong about the mechanism: .NET holds one from Start(), which is precisely why the cleanup path needed
    # its own and this path appeared not to. But that reservation was PRIVATE to .NET and invisible in this
    # file - moving a `$process.Dispose()` above the kill, or re-resolving the id through Get-Process, would
    # delete the guarantee silently and nothing here would notice. The handle below makes the invariant local,
    # stated, and pinnable instead of inherited.
    #
    # No PROCESS_TERMINATE: taskkill /T is still what kills the TREE, and this handle exists to reserve the
    # id, not to do the killing. The two rights it does take are both spent below - SYNCHRONIZE on the
    # post-kill wait and PROCESS_QUERY_LIMITED_INFORMATION on the exit-time read - because a right this file
    # asks for and never uses is a right it cannot justify. An earlier version claimed "least privilege"
    # while using the handle for nothing but CloseHandle, and a fresh-context review was right that that is
    # not what least privilege means.
    Initialize-MapleSeasonProcessInterop
    $launchedHandle = [MapleSeasonProcessInterop]::OpenProcess(
      [MapleSeasonProcessInterop]::PROCESS_QUERY_LIMITED_INFORMATION -bor [MapleSeasonProcessInterop]::SYNCHRONIZE,
      $false,
      [uint32]$process.Id)
    if ($launchedHandle -eq [IntPtr]::Zero) {
      throw "$Scenario could not pin the browser process it just started (pid $($process.Id), Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so a later force-terminate could not be proved to address the same process."
    }
    # PROVE THE PIN LANDED ON THE PROCESS WE STARTED, rather than assuming it did. Opening by id closes the
    # window from here on, but it cannot vouch for the window BEFORE it: between Start() returning and this
    # OpenProcess, the guarantee that the id still means our child is .NET's private reservation again, which
    # is exactly the inherited invariant the handle was added to stop depending on. A fresh-context review
    # made that point and it was correct. So compare the two: $process.StartTime is read through .NET's OWN
    # retained handle and therefore describes the real child whatever the id now means, while $launchCreation
    # is read through ours and describes whatever the id means now. Agreement means one process.
    #
    # EXACT equality, and unlike the CIM comparison in the cleanup path that is not a tolerance judgement:
    # both numbers are the same kernel FILETIME, one of them merely round-tripped through DateTime, whose
    # ticks are the same 100ns unit. MEASURED over 8 launches on this workstation: delta 0 every time, max
    # absolute delta 0. There is no truncating provider in this path to allow for.
    $launchCreation = 0L; $launchExited = 0L; $launchKernel = 0L; $launchUser = 0L
    if (-not [MapleSeasonProcessInterop]::GetProcessTimes($launchedHandle, [ref]$launchCreation, [ref]$launchExited, [ref]$launchKernel, [ref]$launchUser)) {
      throw "$Scenario could not read the start time of the browser process it just started (pid $($process.Id), Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so it cannot prove its pin holds that process."
    }
    if ($launchCreation -ne $process.StartTime.ToUniversalTime().ToFileTimeUtc()) {
      throw "$Scenario pinned process id $($process.Id) but that id no longer identifies the browser process it started; refusing to run a scenario whose force-terminate could reach an unrelated process."
    }
    $completed = $process.WaitForExit($TimeoutMilliseconds)
    if (-not $completed) {
      # Safe to kill BY ID: $launchedHandle has reserved this id since immediately after Start() and has been
      # proved above to hold the process we started, so the number cannot have come to mean a different
      # process.
      #
      # /T IS A RESIDUAL, AND SAY SO. The handle reserves the TARGET's id and nothing else; it says nothing
      # about the ids of descendants, and taskkill /T walks numeric parent-pid relationships, which Windows
      # does not reserve and does not invalidate when a parent dies. A fresh-context review was right that
      # "/T can only reach genuine descendants" - what this comment said before - is not established here.
      # What bounds the blast radius today is that the tree is one node process and its dev server, both born
      # seconds ago from this launch, and that the port cleanup below independently validates ownership of
      # anything still holding the port. Closing it properly means a Job Object, which is carried as an open
      # decision (F1/F5) rather than claimed.
      & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null
      $killExitCode = $LASTEXITCODE
      # CONFIRM THE KILL THROUGH OUR OWN HANDLE, not through .NET's. $process.WaitForExit and
      # $process.HasExited both answer from the private handle whose invisibility is the whole reason this
      # pin exists, so a future change that disposed the object early would have left this branch confirming
      # a kill against nothing. WAIT_OBJECT_0 is 0; a nonzero exit FILETIME is the kernel's own record that
      # the process this handle holds is gone.
      $terminated = [MapleSeasonProcessInterop]::WaitForSingleObject($launchedHandle, 10000) -eq 0
      $killedCreation = 0L; $killedExited = 0L; $killedKernel = 0L; $killedUser = 0L
      $readKilledTimes = [MapleSeasonProcessInterop]::GetProcessTimes($launchedHandle, [ref]$killedCreation, [ref]$killedExited, [ref]$killedKernel, [ref]$killedUser)
      # THE EVIDENCE IS JUDGED BEFORE THE HOUSEKEEPING RUNS, and the order is the repair. The port release used
      # to sit between the two reads above and the test below, so a throw inside it - a listener this file
      # refuses to claim, a row it cannot read - replaced "the force kill could not be proved" with "the port
      # would not release". Those have different causes and different fixes, and the one that matters more was
      # the one being lost. A fresh-context review found it. Nothing leaks by testing first: the finally
      # releases the port on its own condition, not on this branch reaching the call below.
      #
      # WHAT THIS PROVES IS THAT THE ROOT DIED, and the message says so. The wait and the exit FILETIME are read
      # through a handle opened on the launched process and on nothing else; taskkill /T walked the descendants,
      # but no handle here reserved any of their ids and nothing here reads their exit state, so "terminated its
      # owned process tree" was a claim about processes this branch never observed. A fresh-context review was
      # right about that too. The port cleanup below is what speaks for the descendant that matters - the dev
      # server holding the governed port - and it does so by validating ownership rather than by inference.
      # THE ROOT'S DEATH AND THE TREE WALK'S STATUS ARE TWO DIFFERENT CLAIMS, and folding them into one test made
      # the diagnosis wrong in the more dangerous direction. The handle wait and the exit FILETIME are read on the
      # launched process and they either prove IT died or they do not. `taskkill /T`'s exit status speaks for the
      # WALK - a descendant it could not open, an access denial - and a nonzero status with the root's FILETIME
      # sitting right there reported "could not prove the root terminated" about a process this branch had just
      # proved dead, which sends the reader hunting the wrong process. A fresh-context review found it. Both still
      # fail the scenario; they now fail it with the cause that is actually true.
      if (-not $terminated -or -not $readKilledTimes -or $killedExited -eq 0) {
        throw "$Scenario browser timeout cleanup could not prove it terminated the root of its owned process tree."
      }
      if ($killExitCode -ne 0) {
        throw "$Scenario browser timeout cleanup proved the root of its owned process tree died, but the tree walk reported exit code $killExitCode, so a descendant of it may still be running."
      }
      Clear-MapleSeasonBrowserPort -Port $port -Root $ownedMarker -Scenario $Scenario
      $verifiedPortRelease = $true
      throw "$Scenario browser scenario exceeded its bounded process limit after verified cleanup."
    }
    if (-not $process.HasExited -or $null -eq $process.ExitCode) {
      throw "$Scenario browser process ended without a readable native exit code."
    }
    $exitCode = [int]$process.ExitCode

    Clear-MapleSeasonBrowserPort -Port $port -Root $ownedMarker -Scenario $Scenario
    $verifiedPortRelease = $true
    if ($exitCode -ne 0) { throw "$Scenario browser scenario failed with exit code $exitCode." }
  } catch {
    # Bare `throw` rethrows the ErrorRecord unchanged; this records only that the scenario already has a
    # verdict, so the housekeeping below downgrades itself to a warning instead of overwriting it.
    $primaryFailure = $true
    throw
  } finally {
    $footnotes = [Collections.Generic.List[string]]::new()
    # SALVAGE, AND EVERY STEP OF IT IS WRAPPED - including the steps that only READ. Reaching here with the
    # child still running means no branch above managed it: the pin failed, the interop would not compile, the
    # identity check refused. Kill() goes through .NET's own handle, so it is the one kill in this file that
    # cannot possibly reach another process. The wrapping is not decoration: a fresh-context review was right
    # that the two HasExited reads, the handle close and Dispose all sat outside any try, so four statements
    # nobody expected to throw could still raise a terminating error out of this finally and REPLACE the
    # diagnosis they exist to annotate - which is the exact masking the $primaryFailure split was added to stop.
    #
    # If the liveness read itself is what fails, assume RUNNING and attempt the kill anyway. A redundant kill on
    # a process that is already gone costs one footnote; a skipped kill on a live one leaves a browser process
    # on the workstation, and only one of those two mistakes is recoverable by reading the report.
    $stillRunning = $true
    try { $stillRunning = -not $process.HasExited }
    catch { $footnotes.Add("could not tell whether the browser process it started is still running (pid $($process.Id)): $($_.Exception.Message)") }
    if ($stillRunning) {
      try { $process.Kill(); [void]$process.WaitForExit(10000) }
      catch { $footnotes.Add("could not terminate the browser process it started (pid $($process.Id)): $($_.Exception.Message)") }
      try { if (-not $process.HasExited) { $footnotes.Add("left the browser process it started running (pid $($process.Id))") } }
      catch { $footnotes.Add("could not confirm the browser process it started has exited (pid $($process.Id)): $($_.Exception.Message)") }
    }
    # THE GOVERNED PORT IS RELEASED ON ITS OWN CONDITION, and that condition is THE PORT ITSELF - read here,
    # now - not whether the parent is alive and not a flag remembering that some earlier call returned.
    #
    # It was the parent's liveness first. That is a different question with a different answer: the node parent
    # spawns the dev server that holds the port, so a launch-side failure landing after the parent exited found
    # HasExited true and released nothing, leaving a live dev server on the governed port and every later
    # scenario refusing that port with a wrong diagnosis.
    #
    # The repair for that was a $portReleased flag, and a fresh-context review was right that a flag is still
    # not the port. It records that a cleanup call RETURNED, and Clear-MapleSeasonBrowserPort returns on a
    # single observation finding no listener, so a descendant binding a moment AFTER that observation left the
    # flag true and the port held. Worse in the other direction: that function can terminate its listeners and
    # then throw from its own finally over a handle it could not close, which left the flag false after a
    # successful kill and sent this branch in to release the port a SECOND time. On a workstation where the
    # ownership predicate cannot tell one repository-rooted node process from another - it says so itself - a
    # blind second release is a force kill aimed at whatever holds that port by then. Reading the port instead
    # closes both: nothing listening means nothing to do, and the only thing that authorizes a kill here is a
    # listener observed at salvage time.
    #
    # The read fails OPEN toward releasing, for the same reason the liveness read above does: an unanswerable
    # query must not be read as "the port is clean".
    #
    # READING THE PORT AND BEING ALLOWED TO KILL WHAT IS ON IT ARE TWO DIFFERENT PERMISSIONS, and the first
    # version of this repair conflated them. It read the port unconditionally and released whenever anything was
    # listening - including on the ordinary success path, where the cleanup at the end of the try had ALREADY
    # observed this port free. A fresh-context review was right that this is a NEW kill hazard rather than a
    # narrower one, and the hazard is not theoretical on this workstation: -OwnedCommandMarker defaults to the
    # repository root, and Test-MapleSeasonBrowserPortOwned accepts any node/npm/npx process whose command line
    # references that root - it says so itself. So a developer's own repository-rooted node process that bound
    # this port in the window between the verified release and this line would have been classified as owned and
    # force-killed, where the flag-based code before it would have left that process alone. That is strictly
    # worse than what it replaced, and the review's finding is recorded rather than paraphrased.
    #
    # So the port is still always READ - that is what catches the late-binding descendant the flag missed - and
    # the kill is authorized only where this scenario can still plausibly own what it finds. After a verified
    # release, a new listener is by construction not ours: it is reported and left alone. That footnote is not a
    # soft outcome; the launch regression asserts zero warnings, so a leak surfaces as a failure instead of as a
    # silent force kill aimed at a process this file cannot prove it owns.
    $portStillHeld = $true
    try { $portStillHeld = @(Get-MapleSeasonPortListener -Port $port -Scenario $Scenario).Count -gt 0 }
    catch { $footnotes.Add("could not tell whether governed port $port is still held, so it attempted the release anyway: $($_.Exception.Message)") }
    if ($portStillHeld -and $verifiedPortRelease) {
      $footnotes.Add("found a listener on governed port $port after it had already verified that port free, so the listener is not one this scenario launched and it refused to terminate it")
    }
    elseif ($portStillHeld) {
      try { Clear-MapleSeasonBrowserPort -Port $port -Root $ownedMarker -Scenario $Scenario }
      catch { $footnotes.Add("could not release governed port $port after salvaging an unmanaged launch: $($_.Exception.Message)") }
    }
    try {
      if ($launchedHandle -ne [IntPtr]::Zero -and -not [MapleSeasonProcessInterop]::CloseHandle($launchedHandle)) {
        $footnotes.Add("could not close the handle pinning browser pid $($process.Id) (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so that id stays reserved for the life of this session")
      }
    } catch {
      $footnotes.Add("could not close the handle pinning the browser process it started: $($_.Exception.Message)")
    }
    # .NET's own handle is a reservation too, and leaving the object undisposed keeps it - and therefore the
    # id - alive until a garbage collection nobody scheduled. A fresh-context review was right that closing
    # only OUR handle proves nothing about the id being released. This footnote names no pid on purpose: the
    # only way to reach it is a Process object that would not dispose, and asking that object for its id is how
    # a footnote turns into the terminating error the wrapping was added to prevent.
    try { $process.Dispose() }
    catch { $footnotes.Add("could not release the runtime reservation on the browser process id it started: $($_.Exception.Message)") }
    if ($footnotes.Count -gt 0) {
      $report = "$Scenario " + ($footnotes -join '; ') + '.'
      # ON A SUCCESSFUL SCENARIO THIS THROWS, matching the cleanup path. It was a warning either way before,
      # so a season proof could return success having leaked the pin it reported - and only this suite's
      # regression happened to read the warning stream. -WarningAction Continue is pinned on the downgrade
      # because Write-Warning HONOURS $WarningPreference: MEASURED, a caller passing -WarningAction Stop
      # turned this footnote into a terminating error inside the finally and the caught message became "the
      # preference variable ... is set to Stop" instead of the scenario's real diagnosis. Pinned, the same
      # test caught the real diagnosis, and -WarningVariable still captured the footnote.
      if ($primaryFailure) { Write-Warning $report -WarningAction Continue } else { throw $report }
    }
  }
}
