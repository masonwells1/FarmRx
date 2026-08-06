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
  # drive - and no part of this answer may depend on where the shell happens to be standing.
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

# DIAGNOSIS ONLY. THIS FUNCTION AUTHORIZES NO KILL, AND ITS NAME OVERSTATES WHAT IT CAN KNOW.
#
# It used to be the predicate that decided whether Clear-MapleSeasonBrowserPort was allowed to terminate a
# listener, and a fresh-context review proved it wrong in both directions on this workstation: a developer's
# own repository-rooted `node` process answered TRUE and was force-killed, and a genuine late-binding
# descendant of a scenario answered FALSE and was left holding the port. A command line cannot answer an
# ownership question, and no further hardening of the text analysis below would have changed that - the
# eighth consecutive review round on it was the evidence. Kill authority now comes from Job Object
# membership, which is kernel state the kernel maintains, and lives in Clear-MapleSeasonBrowserPort.
#
# What survives here is the one job this analysis is genuinely good at: telling Mason, at PREFLIGHT time,
# whether a listener already sitting on a governed port looks like a leftover Farm Rx process or somebody
# else's. Assert-MapleSeasonBrowserPortFree is its only caller, it never kills anything - it refuses to
# launch either way - and at that moment no job exists yet, so membership is not available to ask. A wrong
# answer there costs a less useful sentence in a refusal, not a process. Everything below therefore still
# earns its rigour, because a misleading refusal wastes Mason's time; it just no longer earns a kill.
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
  # argument cannot satisfy this. It still cannot tell our season server apart from another Node process
  # started by hand inside this tree, and it never will - that is the limitation that moved kill authority
  # to Job Object membership. Here it only shades a refusal message.
  return ([string]$ListenerProcess.Name) -match '(?i)^(node|npm|npx)(\.exe)?$'
}

function Clear-MapleSeasonBrowserPort {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][IntPtr]$Job,
    [Parameter(Mandatory)][string]$Scenario
  )
  # THIS FUNCTION NO LONGER DECIDES WHO OWNS A PROCESS, because nothing readable about a process can decide
  # it. Every version before this one asked "does this listener's command line sit under the owned root?"
  # and a fresh-context review proved that question wrong in BOTH directions on this workstation: a
  # developer's own repository-rooted `node` process answered yes and was force-killed, and a genuine
  # descendant of this scenario that bound the port late answered no and was left holding it. The ownership
  # question is not answerable from text. It IS answerable from provenance, and the kernel is the only thing
  # that can keep provenance honestly: the caller creates a Job Object, this file's browser process is
  # created suspended and assigned to that job before its first instruction, and every process it spawns is
  # a job member automatically and unavoidably. Membership is not a guess about a string, it is kernel state
  # bound to a HANDLE rather than to a reusable number.
  #
  # So the kill below names no process id at all. TerminateJobObject kills exactly the members of this job -
  # the whole tree, atomically, whatever each member was doing - and it CANNOT reach anything this scenario
  # did not launch. Two whole hazard classes retire with the id: the process-id reuse window (there is no id
  # to reuse, and no second lookup that could resolve one), and the command-line predicate's inability to
  # tell our server from another node process in the same tree.
  Initialize-MapleSeasonProcessInterop
  if ($Job -eq [IntPtr]::Zero) {
    throw "$Scenario was asked to release governed port $Port without the job that owns its browser tree; refusing to terminate anything."
  }
  # The ONLY kill in this file. Terminating a job whose members have already exited succeeds and is a no-op,
  # which is what makes this safe to call on the timeout path, the success path and again from the finally.
  if (-not [MapleSeasonProcessInterop]::TerminateJobObject($Job, 1)) {
    throw "$Scenario could not terminate the job holding its browser tree for governed port $Port (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
  }
  # Termination is asynchronous in effect: the kernel marks the members, and a socket is released as its
  # owner is torn down. Drain until the table agrees, and RETURN ONLY on an observed zero.
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $remaining = @(Get-MapleSeasonPortListener -Port $Port -Scenario $Scenario)
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)

  # Still held after our whole tree was terminated. Two very different situations, and the caller deserves
  # to be told which: a job member that survived termination is a kernel-level failure of this file, and a
  # non-member is somebody else's process that must be reported and left strictly alone.
  #
  # This pass AUTHORIZES NOTHING - there is no kill below it. That is why it can read ids out of the
  # listener table without the handle-binding ceremony the old kill path needed: if an id changes hands
  # between the read and the open, the worst outcome is a diagnosis that names the wrong process, never a
  # terminated one. Say that plainly rather than implying more rigour than the pass needs.
  $survivorHandles = [Collections.Generic.List[IntPtr]]::new()
  $members = [Collections.Generic.List[string]]::new()
  $strangers = [Collections.Generic.List[string]]::new()
  $unreadable = [Collections.Generic.List[string]]::new()
  $closeFailures = [Collections.Generic.List[string]]::new()
  try {
    foreach ($listener in $remaining) {
      $listenerId = [int]$listener.OwningProcess
      $handle = [MapleSeasonProcessInterop]::OpenProcess(
        [MapleSeasonProcessInterop]::PROCESS_QUERY_LIMITED_INFORMATION,
        $false,
        [uint32]$listenerId)
      if ($handle -eq [IntPtr]::Zero) {
        $unreadable.Add("pid $listenerId (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))")
        continue
      }
      $survivorHandles.Add($handle)
      $inJob = $false
      if (-not [MapleSeasonProcessInterop]::IsProcessInJob($handle, $Job, [ref]$inJob)) {
        $unreadable.Add("pid $listenerId (job membership unreadable, Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))")
        continue
      }
      if ($inJob) { $members.Add("pid $listenerId") } else { $strangers.Add("pid $listenerId") }
    }
  } finally {
    foreach ($open in $survivorHandles) {
      if (-not [MapleSeasonProcessInterop]::CloseHandle($open)) {
        $closeFailures.Add("Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())")
      }
    }
  }
  # A failed close leaves that process id reserved for the life of this session, so it is reported - but it
  # is appended to the diagnosis rather than thrown on its own, because every path out of here already
  # throws and a footnote must never replace the reason.
  $footnote = if ($closeFailures.Count -gt 0) { " It also could not close $($closeFailures.Count) inspection handle(s) ($($closeFailures -join '; ')), so those process ids stay reserved for the life of this session." } else { '' }
  if ($members.Count -gt 0) {
    throw "$Scenario terminated the job owning its browser tree and $($members -join ', ') survived still holding governed port $Port.$footnote"
  }
  if ($strangers.Count -gt 0) {
    throw "$Scenario terminated its own browser tree, but $($strangers -join ', ') is not in that job and still holds governed port $Port, so it is not a process this scenario launched and it refused to terminate it.$footnote"
  }
  throw "$Scenario browser server cleanup did not release governed port $Port, and it could not establish what still holds it ($($unreadable -join '; ')).$footnote"
}

function Initialize-MapleSeasonProcessInterop {
  # Declared AFTER the Clear-MapleSeasonBrowserPort boundary on purpose:
  # maple-season-browser-ownership.regression.ps1 slices everything above that line and dot-sources it as
  # pure functions, and that suite must not start compiling interop to test string handling.
  if ('MapleSeasonProcessInterop' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MapleSeasonProcessInterop {
  // ONE ACCESS RIGHT, AND IT IS A READ. PROCESS_TERMINATE and SYNCHRONIZE used to be declared here because
  // the old design opened a handle in order to kill by id and then wait on the corpse. Nothing kills by id
  // any more, so asking for the right to do it is a right taken and never spent - which is precisely what a
  // fresh-context review objected to. QUERY_LIMITED_INFORMATION is all the surviving classification pass
  // needs, and it is all this file can now obtain.
  public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  // Named here rather than written as hex at the call sites, because PowerShell reads the hex literal
  // 0xFFFFFFFF as the SIGNED value -1, so `$waitResult -eq 0xFFFFFFFF` is false for every possible wait
  // result and a WAIT_FAILED would have been reported as an ordinary timeout. WAIT_TIMEOUT is deliberately
  // NOT declared: the wait path treats anything that is not WAIT_OBJECT_0 and not WAIT_FAILED as a timeout,
  // so a named constant for it would be a third comparison nothing performs.
  public const uint WAIT_OBJECT_0 = 0x00000000;
  public const uint WAIT_FAILED = 0xFFFFFFFF;
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const int JobObjectExtendedLimitInformation = 9;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const uint RESUME_THREAD_FAILED = 0xFFFFFFFF;

  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct STARTUPINFO {
    public int cb;
    public string lpReserved, lpDesktop, lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public uint dwProcessId, dwThreadId;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);
  // PRIVATE, AND THAT IS A HARD BOUNDARY RATHER THAN A RULE. StartInJob below needs it for exactly one case -
  // a child that could not be assigned to the job, which is therefore not a member and cannot be reached by
  // TerminateJobObject. Outside this class there is no way to invoke it at all, so no future edit to the
  // PowerShell above can reintroduce a kill by process id even by accident. GetProcessTimes went with it: its
  // only caller was the creation-time reconciliation that existed to prove a re-resolved id was still the
  // process the launch started, and CreateProcessW hands back the handle, so there is nothing to re-resolve.
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes,
    IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory,
    ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr thread);

  // An UNNAMED job object, so two concurrent scenarios cannot collide on a name and cannot open each
  // other's job. KILL_ON_JOB_CLOSE is the backstop that no PowerShell code can provide: if this session
  // dies - killed, crashed, closed - the kernel reaps every member as the last job handle closes. That is
  // what makes the launch window between creating the process and the first line of the try harmless.
  //
  // The stage is reported the same way StartInJob reports its own, and for the same reason: "the job could not
  // be created" and "the job was created but could not be given the limit that makes it a backstop, and then
  // could not even be closed again" are different facts about the workstation, and a refusal that says only
  // "could not create the job object" tells whoever reads the evidence log the wrong one.
  public static IntPtr CreateKillOnCloseJob(out int error, out string stage) {
    error = 0;
    stage = "";
    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    if (job == IntPtr.Zero) { error = Marshal.GetLastWin32Error(); stage = "create"; return IntPtr.Zero; }
    // EVERY EXIT FROM HERE ON EITHER HANDS THE JOB TO THE CALLER OR CLOSES IT, INCLUDING THE THROWN ONES.
    // An earlier version guarded only the unmanaged buffer with a finally, which covered the two failures it
    // had thought about - the limit call failing, and the buffer needing to be freed - and left a third
    // uncovered: a MANAGED operation between creating the job and returning it can throw. Marshal.AllocHGlobal
    // throws OutOfMemoryException when the process cannot satisfy the request; SizeOf and StructureToPtr throw
    // on a bad type or a bad pointer. Any of those unwinds straight out of this method with the job created,
    // nobody holding its handle, and no PowerShell statement able to name it - a leaked kernel object for the
    // life of the session. This flag is the whole fix: it stays true only while the job is still this method's
    // to lose, and the catch below closes the handle in exactly that case. It is cleared on the limit-failure
    // path, which closes by hand because it has a stage sentence to write, and on the success path, where the
    // caller becomes responsible for it.
    //
    // IT IS A CATCH RATHER THAN A FINALLY, AND THAT IS THE CORRECTION THIS LINE CARRIES. An earlier version put
    // the rescue close in a finally and discarded its result - which left the method claiming, in a guard label
    // no less, that it could not leak the job on a thrown path while doing exactly that whenever the close
    // failed. A finally cannot do better: a close failure discovered while an exception is already travelling
    // has nowhere to go. The "out string stage" this method reports through is never marshalled back to
    // PowerShell when the method throws, so writing the leak into it would be writing to a channel nobody will
    // read, and throwing from a finally would replace the original exception and lose the reason the unwind
    // started. A catch has both facts in hand, so it reports both: the original message, the leak sentence
    // appended, and the original exception preserved as InnerException for anyone reading it in a debugger.
    bool jobIsStillThisMethodsToLose = true;
    try {
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
      IntPtr buffer = Marshal.AllocHGlobal(size);
      try {
        Marshal.StructureToPtr(limits, buffer, false);
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size)) {
          error = Marshal.GetLastWin32Error();
          stage = "limit";
          // THIS CLOSE IS CHECKED TOO. The job never received its KILL_ON_JOB_CLOSE limit, so it will never reap
          // anything and leaking it strands no process - but it is a kernel object this process opened and is one
          // statement away from losing the only reference to. A close that fails leaks it for the life of the
          // session, and the caller is about to refuse the launch anyway, so saying so costs one sentence in a
          // message a human is already going to read.
          string unusableJob = CloseAndDescribe(job, "the unusable job object", ref jobIsStillThisMethodsToLose);
          if (unusableJob.Length > 0) { stage = "limit, and" + unusableJob; }
          return IntPtr.Zero;
        }
      } finally { Marshal.FreeHGlobal(buffer); }
      jobIsStillThisMethodsToLose = false;
      return job;
    } catch (Exception thrown) {
      if (!jobIsStillThisMethodsToLose) { throw; }
      string leakedJob = CloseAndDescribe(job, "the job object being created", ref jobIsStillThisMethodsToLose);
      if (leakedJob.Length == 0) { throw; }
      throw new InvalidOperationException(thrown.Message + leakedJob, thrown);
    }
  }

  // A CLOSE IS AN OPERATION, AND OPERATIONS FAIL. Every CloseHandle in this class used to discard its answer
  // except the one on the unusable job object, which is an odd place to draw the line: the reason that one is
  // checked - a kernel object this process opened and is about to lose the only reference to - is equally true
  // of a child's process and thread handles. The consequence is smaller (a leaked handle keeps a process id
  // reserved; it strands no process, because the child is a job member and the kernel reaps it) but it is not
  // nothing, and a failure nobody records is a failure nobody fixes. This returns a sentence rather than a bool
  // so a caller can append it to the stage it is already reporting, and returns the empty string on success so
  // appending it costs nothing on the ordinary path.
  //
  // THE OWNERSHIP FLAG IS CLEARED BEFORE THE CLOSE, NOT AFTER, and that ordering is the entire reason the third
  // parameter exists rather than each caller writing "flag = false" on the line after the call. A caller that
  // closed a handle and then threw while building the sentence describing the close would, with an after-the-fact
  // clear, still be holding a flag that says "mine" - and the unwinding catch would close the same handle a
  // second time. Windows reissues handle values, so a second close is not a harmless no-op; it can close
  // something else this process has since opened. Once this function has been entered for a handle nobody else
  // may close it, and that is true on both outcomes: either the close succeeded, or it failed, and a handle
  // CloseHandle has already refused is not going to be closed by asking again.
  //
  // Passing the flag by reference is also what lets the static guard state the rule as a shape rather than as a
  // habit: this is the only place in the class that calls CloseHandle at all, so "every close reports its
  // outcome and gives up ownership" is checkable by counting, not by reading every branch.
  private static string CloseAndDescribe(IntPtr handle, string label, ref bool stillOurs) {
    stillOurs = false;
    if (CloseHandle(handle)) { return ""; }
    return " " + label + " could not be closed (Windows error "
      + Marshal.GetLastWin32Error().ToString() + "), so it leaked for the life of this session.";
  }

  // CREATE_SUSPENDED IS THE WHOLE POINT, and assigning after the child is already running would not do.
  // Playwright's node process spawns the dev server that holds the governed port; a child spawned in the
  // window between CreateProcess returning and AssignProcessToJobObject would be born OUTSIDE the job, and
  // job membership - the only thing that now authorizes a kill - would answer "not ours" about the one
  // process this file most needs to own. Creating the child suspended closes that window in the kernel
  // rather than betting on how long node takes to reach its first spawn.
  //
  // Every failure path terminates the child it created, and the one path whose kill KILL_ON_JOB_CLOSE cannot
  // backstop checks that kill by hand. A suspended process that is never resumed and never killed is a
  // permanent stranded process on the workstation, and returning false while leaving one behind would make a
  // launch failure worse than a launch. The assign-failure path is the only one where that can still happen:
  // that child is NOT a job member, so nothing done to the job handle will ever reach it, so TerminateProcess
  // is the only thing that can end it - and if TerminateProcess itself fails, this function reports the
  // stranded pid out through stage and processId instead of dropping the last name anyone had for it. An
  // earlier version of this comment claimed the termination always succeeded; it never checked.
  public static bool StartInJob(IntPtr job, string executable, string commandLine, string workingDirectory,
      out IntPtr processHandle, out uint processId, out int error, out string stage) {
    processHandle = IntPtr.Zero;
    processId = 0;
    error = 0;
    stage = "";
    STARTUPINFO startup = new STARTUPINFO();
    startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    PROCESS_INFORMATION created;
    // CreateProcessW may write into the command line it is given, so it gets a mutable buffer.
    StringBuilder mutableCommandLine = new StringBuilder(commandLine);
    if (!CreateProcessW(executable, mutableCommandLine, IntPtr.Zero, IntPtr.Zero, false,
        CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, workingDirectory, ref startup, out created)) {
      error = Marshal.GetLastWin32Error();
      stage = "create";
      return false;
    }
    // TWO HANDLES BECAME THIS METHOD'S THE MOMENT CreateProcessW RETURNED TRUE, and from here to the return every
    // path has to account for both of them - the thrown paths included. This is the job handle's defect one level
    // down: the three deliberate exits below each close what they still own, but a MANAGED operation between them
    // can throw. Building a stage sentence concatenates strings, which throws OutOfMemoryException when the
    // process cannot satisfy the allocation; a Marshal call throws on a bad pointer. An exception between the two
    // closes on a failure path leaves the second handle open forever, and an exception on the success path before
    // the process handle reaches its out parameter loses the only reference this session had to a running child.
    // Each handle gets its own flag, and CloseAndDescribe clears it at the moment ownership passes rather than
    // afterwards, so the catch closes exactly what is still outstanding and cannot close anything twice.
    //
    // The catch does not kill the child, deliberately. On the two failure paths the child is already dead or
    // already reaped; on the success path it is running and a job member, and the caller - which is about to see
    // this exception - closes the job handle in its own finally, at which point KILL_ON_JOB_CLOSE reaps it. A
    // TerminateProcess here would be a second executioner for a process that already has one.
    bool threadHandleIsStillThisMethodsToLose = true;
    bool processHandleIsStillThisMethodsToLose = true;
    try {
      if (!AssignProcessToJobObject(job, created.hProcess)) {
        error = Marshal.GetLastWin32Error();
        stage = "assign";
        // THE RETURN VALUE IS CHECKED, because this is the one child KILL_ON_JOB_CLOSE cannot save. The
        // assignment failed, so this process is not a member of the job, and nothing that happens to the job
        // handle will ever touch it. It was created suspended, so it will never run and never exit on its own.
        // A few lines below, both handles close and this script loses the ability to name it at all. So if the
        // kill fails, the pid leaves through stage and processId and the refusal upstream tells a human which
        // process to end, rather than reporting a cleanup that did not happen.
        if (!TerminateProcess(created.hProcess, 1)) {
          stage = "assign, and the suspended child could not be terminated (Windows error "
            + Marshal.GetLastWin32Error().ToString() + ")";
          processId = created.dwProcessId;
        }
        // EACH CLOSE IS ITS OWN STATEMENT, and the sentences are collected before either is appended to stage.
        // Written as one chained expression - stage + close(thread) + close(process) - a throw while
        // concatenating the first sentence would skip the second close entirely, which is the whole defect this
        // block exists to close.
        string unassignedThread = CloseAndDescribe(created.hThread, "the unassigned child's thread handle",
          ref threadHandleIsStillThisMethodsToLose);
        string unassignedProcess = CloseAndDescribe(created.hProcess, "the unassigned child's process handle",
          ref processHandleIsStillThisMethodsToLose);
        stage = stage + unassignedThread + unassignedProcess;
        return false;
      }
      if (ResumeThread(created.hThread) == RESUME_THREAD_FAILED) {
        error = Marshal.GetLastWin32Error();
        stage = "resume";
        // THE JOB KILL IS THE RIGHT PRIMITIVE HERE AND ITS RESULT IS DELIBERATELY NOT CHECKED, which is the
        // opposite of the decision one branch up, so the difference is worth stating. This child IS a job member,
        // so it has two independent executioners: this call, and the kernel reaping every member when the last
        // job handle closes - which the caller's finally does, and which process exit does even if this session
        // is killed outright. A failed TerminateJobObject here therefore strands nothing. The unassigned child
        // above had exactly one executioner, which is why that one is checked.
        TerminateJobObject(job, 1);
        string unresumedThread = CloseAndDescribe(created.hThread, "the unresumed child's thread handle",
          ref threadHandleIsStillThisMethodsToLose);
        string unresumedProcess = CloseAndDescribe(created.hProcess, "the unresumed child's process handle",
          ref processHandleIsStillThisMethodsToLose);
        stage = stage + unresumedThread + unresumedProcess;
        return false;
      }
      // THE THREAD HANDLE IS DONE WITH; THE PROCESS HANDLE IS THE CALLER'S NOW. A failed close of the thread
      // handle does not make the launch a failure - the child is running, inside the job, and reachable - so this
      // returns true either way and reports the leak through stage, which is empty on an ordinary success. The
      // caller warns on a non-empty stage after a successful launch, because a channel nobody reads is not a
      // report. The process handle's flag is cleared AFTER the assignment to processHandle, not before: until
      // that assignment has happened the caller has nothing, so an exception before it must still close.
      stage = CloseAndDescribe(created.hThread, "the launched child's thread handle",
        ref threadHandleIsStillThisMethodsToLose);
      processHandle = created.hProcess;
      processHandleIsStillThisMethodsToLose = false;
      processId = created.dwProcessId;
      return true;
    } catch (Exception thrown) {
      // THE EXCEPTION IS THE ONLY CHANNEL LEFT, for the reason spelled out over CreateKillOnCloseJob's catch:
      // out parameters are not marshalled back to PowerShell from a method that threw, so a leak recorded in
      // stage would be a leak recorded nowhere.
      string leaked = "";
      if (threadHandleIsStillThisMethodsToLose) {
        leaked = leaked + CloseAndDescribe(created.hThread, "the child's thread handle",
          ref threadHandleIsStillThisMethodsToLose);
      }
      if (processHandleIsStillThisMethodsToLose) {
        leaked = leaked + CloseAndDescribe(created.hProcess, "the child's process handle",
          ref processHandleIsStillThisMethodsToLose);
      }
      if (leaked.Length == 0) { throw; }
      throw new InvalidOperationException(thrown.Message + leaked, thrown);
    }
  }
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
  # A FAILED READ IS NOT EVIDENCE OF A STRANGER, and until this third bucket existed it was recorded as one.
  # The process lookup below ran with -ErrorAction SilentlyContinue, so an access-denied read, an unhealthy CIM
  # service, or a process that exited between the listener table and this query all produced $null - and $null
  # went to the ownership predicate, which answered FALSE, which put the holder in the FOREIGN bucket. The
  # refusal then told the operator, as a flat statement, that no listener on that port belonged to Farm Rx.
  # That sentence was derived from a read that never happened. The likeliest real cause of an unreadable
  # holder is not a stranger at all: it is a leaked Farm Rx server the operator now has no reason to look for.
  # Diagnosis is this function's entire remaining job, so a confident wrong diagnosis is the failure that
  # matters here, and the fix is to refuse to classify rather than to classify harder.
  $unreadableHolders = [Collections.Generic.List[string]]::new()
  foreach ($listener in $listeners) {
    # Read with -ErrorAction Stop and catch, the same shape as the listener-table read above, because the
    # two outcomes SilentlyContinue merges have to be told apart: a query that FAILED, and a query that
    # SUCCEEDED and found nothing because the process is already gone. Neither is an ownership answer.
    $listenerProcess = $null
    $listenerReadError = $null
    try {
      $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction Stop
    } catch {
      $listenerReadError = $_.Exception.Message
    }
    if ($null -ne $listenerReadError) {
      # The message names the query's own failure, not the target's command line, so this stays inside the
      # image-name-and-PID-only rule that governs everything written into season evidence logs.
      $unreadableHolders.Add("PID $($listener.OwningProcess) (could not be identified: $listenerReadError)")
      continue
    }
    if ($null -eq $listenerProcess) {
      $unreadableHolders.Add("PID $($listener.OwningProcess) (exited before it could be identified)")
      continue
    }
    # Image name and PID only. A foreign command line can carry tokens or private paths and
    # this message is written into season evidence logs.
    $name = $listenerProcess.Name
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
  $unreadableList = ($unreadableHolders | Select-Object -Unique) -join ', '
  # One clause, appended to whichever refusal fires, so an unidentified holder is never silently dropped out
  # of the diagnosis. It says what could not be established rather than guessing which side of the line the
  # holder falls on, and it tells the operator the one thing that actually helps: an elevated look at that PID.
  $unreadableClause = if ($unreadableHolders.Count -gt 0) { " Listeners on that port this preflight could not identify, so it will not say whether they are Farm Rx or not: $unreadableList. Check those PIDs from an elevated shell before concluding anything about this port." } else { '' }
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
    throw "$Scenario cannot start: governed port $Port was already held by a Farm Rx dev or season server ($ownedList) before this scenario ran.$mixed$unreadableClause An earlier proof that never released the port is the usual cause, but a development server started by hand in this tree looks the same; stop that server or investigate the proof that left it behind. $redirect"
  }
  # THE THIRD REFUSAL, for the case where nothing on the port could be read at all. It exists because the two
  # refusals around it are both CLAIMS, and neither claim is available here: this branch knows the port is
  # occupied and knows nothing else. Saying so is the honest diagnosis, and it is still a refusal - a port whose
  # holder cannot be identified is exactly the port a scenario must not launch onto.
  if ($foreignHolders.Count -eq 0) {
    throw "$Scenario cannot start: governed port $Port was already in use before this scenario ran, and this preflight could not identify a single listener on it, so it will not guess whether the holder is Farm Rx or not: $unreadableList. Check those PIDs from an elevated shell. $redirect"
  }
  # The "no listener there belongs to Farm Rx" sentence is a definite claim, so it only survives when every
  # holder was actually read. When some were not, the clause above says which ones and the claim narrows to
  # the ones it covers.
  $foreignClaim = if ($unreadableHolders.Count -gt 0) { "none of the listeners this preflight could identify belong to Farm Rx" } else { 'no listener there belongs to Farm Rx' }
  throw "$Scenario cannot start: governed port $Port was already in use by $foreignList before this scenario ran, and $foreignClaim.$unreadableClause $redirect"
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
  # ONE COMMAND LINE, COMPOSED HERE. CreateProcessW takes the whole line rather than an argv array, and
  # argv[0] is part of it. ProcessStartInfo used to compose this from FileName plus Arguments; it is written
  # out here so the quoting is visible in this file instead of inherited from a framework rule, and $node is
  # quoted because it is an absolute path that can contain spaces.
  $commandLine = '"{0}" {1}' -f $node, $arguments
  # Fail before launching, and only after the deterministic contract checks above, so a real
  # defect (missing runner, invalid grep tag) is never masked by an environment collision.
  # Playwright runs these configs with reuseExistingServer:false, so an occupied governed port
  # cannot be shared: without this the scenario launches anyway, waits out Playwright's 120s
  # webServer timeout, and then dies inside the post-run cleanup refusal - which reads as if
  # this scenario leaked the listener when something else held the port beforehand.
  Assert-MapleSeasonBrowserPortFree -Port $port -Scenario $Scenario -PortVariable $portContract[0] -Root $ownedMarker
  Initialize-MapleSeasonProcessInterop
  $launchedHandle = [IntPtr]::Zero
  $launchedId = [uint32]0
  $primaryFailure = $false
  # THE JOB EXISTS BEFORE THE PROCESS DOES, and it is the definition of everything this scenario is allowed
  # to kill. Refusing to launch when the job cannot be created is deliberate: a browser tree this file cannot
  # prove it owns is a tree it cannot clean up, and the eight review rounds that preceded this design were all
  # spent trying to recover that proof afterwards from command-line text. Created LAST before the try, so no
  # statement can throw between owning this handle and the finally that closes it.
  $jobError = 0
  $jobStage = ''
  $job = [MapleSeasonProcessInterop]::CreateKillOnCloseJob([ref]$jobError, [ref]$jobStage)
  if ($job -eq [IntPtr]::Zero) {
    throw "$Scenario could not create the job object that would own its browser process tree (failed at the $jobStage stage, Windows error $jobError), so it refused to launch a process tree it could not prove it owned."
  }
  # THE TRY NOW OPENS *BEFORE* THE LAUNCH, and that is a reversal of the previous arrangement worth stating.
  # It used to open on the line AFTER Start(), because nothing below it could protect a process launched above
  # it - an Add-Type failure or an unpinnable id left a live node child and its dev-server grandchild running,
  # unwaited and unkilled. That reasoning was correct for a design whose cleanup depended on later statements
  # succeeding. It no longer applies: the child is a member of a KILL_ON_JOB_CLOSE job from before its first
  # instruction, so the kernel reaps the whole tree when this job handle closes - which the finally does, and
  # which process exit does even if this session is killed outright. Putting the launch inside the try is now
  # the safer placement, because a throw from the launch itself reaches a finally that terminates the job.
  try {
    $launchError = 0
    $launchStage = ''
    if (-not [MapleSeasonProcessInterop]::StartInJob($job, $node, $commandLine, $Root, [ref]$launchedHandle, [ref]$launchedId, [ref]$launchError, [ref]$launchStage)) {
      # A NONZERO ID ON A FAILED LAUNCH MEANS EXACTLY ONE THING, which is why this reads it as a discriminator
      # rather than needing a second flag. StartInJob leaves processId at 0 on every failure it cleaned up
      # after: create-failure never had a child, assign-failure sets it only when the kill of that child also
      # failed, resume-failure is reaped by the job. So an id here is a suspended process that is not a job
      # member, cannot be reaped by closing the job handle, will never run, and will never exit - and this is
      # the last statement that can name it. The pid goes in the refusal because a human has to end it.
      #
      # THE WORDING IS DELIBERATELY WEAKER THAN "IT IS STILL RUNNING", because that is more than this line can
      # know. What actually happened is that TerminateProcess returned false; by the time this message is built
      # the process handle has been closed inside StartInJob, so nothing here can re-ask whether the child is
      # alive, and an antivirus product or another administrator may have ended it in between. A pid reliably
      # means "this scenario could not confirm it killed that child", and a refusal that says so sends a human to
      # check rather than telling them a fact it made up.
      $strandedClause = ''
      if ($launchedId -ne 0) {
        $strandedClause = " Process id $launchedId was created suspended, could not be added to the job, and its termination could not be confirmed, so it may still be running on this workstation and has to be checked and ended by hand."
      }
      throw "$Scenario browser process did not start (failed at the $launchStage stage, Windows error $launchError).$strandedClause"
    }
    # A LAUNCH CAN SUCCEED AND STILL HAVE LEAKED SOMETHING. StartInJob leaves the stage empty on an ordinary
    # success and fills it only when closing the finished thread handle failed, which keeps that child's process
    # id reserved for the life of the session. Not a launch failure, so this does not throw; but a leak reported
    # into a variable nobody reads is not reported at all, so it is a warning on the stream the season evidence
    # log captures.
    if ($launchStage -ne '') {
      Write-Warning "$Scenario launched its browser process, but$launchStage"
    }
    # WAIT ON THE HANDLE, not on a .NET Process object. There is no Process object in this path any more, and
    # that is a simplification rather than a loss: every previous version had to prove that .NET's private,
    # invisible handle and this file's own handle described the same process, and that proof - an OpenProcess by
    # id plus a FILETIME comparison against $process.StartTime, some thirty lines of it - existed only because
    # the launch handed back a NUMBER and the number had to be re-resolved. CreateProcessW hands back the
    # HANDLE, so there is nothing to re-resolve and nothing to reconcile. The deleted proof is not a weakening;
    # its entire subject matter is gone.
    $waitResult = [MapleSeasonProcessInterop]::WaitForSingleObject($launchedHandle, [uint32]$TimeoutMilliseconds)
    if ($waitResult -eq [MapleSeasonProcessInterop]::WAIT_FAILED) {
      throw "$Scenario could not wait for the browser process it started (pid $launchedId, Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
    }
    if ($waitResult -ne [MapleSeasonProcessInterop]::WAIT_OBJECT_0) {
      # NO KILL HERE, AND NO CLEANUP CALL HERE. The timeout is the diagnosis; terminating the tree and
      # releasing the port is the finally's single job, on every path out of this function including this one.
      # Two things are bought by not doing it here. First, the previous version's timeout branch force-killed
      # by pid, then had to prove the kill landed, then had to distinguish the root's death from the tree
      # walk's exit status - roughly fifty lines whose whole purpose was to compensate for killing by number.
      # TerminateJobObject kills the members of a job and cannot reach anything else, so there is nothing to
      # compensate for. Second, a cleanup failure can no longer overwrite the timeout: the finally footnotes it
      # and the scenario still fails, with the cause that is actually true.
      throw "$Scenario browser scenario exceeded its bounded process limit of $TimeoutMilliseconds milliseconds."
    }
    # The wait returned WAIT_OBJECT_0, so this process is dead and 259 - STILL_ACTIVE - cannot be ambiguous
    # here; it would be a genuine exit code of 259.
    $exitCode = [uint32]0
    if (-not [MapleSeasonProcessInterop]::GetExitCodeProcess($launchedHandle, [ref]$exitCode)) {
      throw "$Scenario browser process ended without a readable native exit code (pid $launchedId, Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
    }
    if ($exitCode -ne 0) { throw "$Scenario browser scenario failed with exit code $exitCode." }
  } catch {
    # Bare `throw` rethrows the ErrorRecord unchanged; this records only that the scenario already has a
    # verdict, so the housekeeping below downgrades itself to a warning instead of overwriting it.
    $primaryFailure = $true
    throw
  } finally {
    $footnotes = [Collections.Generic.List[string]]::new()
    # ONE CLEANUP SITE, UNCONDITIONALLY, ON EVERY PATH OUT OF THIS FUNCTION. Every previous version had two or
    # three, each guarded by a different condition - the parent's liveness, then a $portReleased flag, then a
    # $verifiedPortRelease flag - and every one of those conditions was an attempt to answer "is the thing on
    # that port mine?" from something other than the fact itself. A fresh-context review broke the last of them
    # in both directions, which is the finding that led here: a flag that says a release already happened
    # cannot distinguish a descendant of this scenario that bound the port a moment later from a stranger that
    # bound it a moment later, and the code guessed wrong either way round.
    #
    # There is nothing left to guess. Clear-MapleSeasonBrowserPort terminates THIS JOB - the scenario's own
    # tree, all of it, whatever state each member is in - and then drains the port. A listener that survives
    # that and is not a job member is somebody else's process; it is reported by name and never touched. So
    # this call is safe to make unconditionally, which is why there is no condition on it, and calling it a
    # second time after the try body already cleared successfully is a no-op: terminating a job whose members
    # have exited succeeds and the drain loop sees an empty table.
    #
    # It is wrapped because a cleanup failure must annotate the scenario's verdict, never replace it - the
    # masking that $primaryFailure exists to prevent.
    try { Clear-MapleSeasonBrowserPort -Port $port -Job $job -Scenario $Scenario }
    # ${port} is BRACED, and not for style. PowerShell reads `$port:` as a scoped variable reference - the
    # `$scope:name` form - so the unbraced spelling made this file fail to parse at all, which the parse sweep
    # caught immediately. A colon after an interpolated variable always needs the braces.
    catch { $footnotes.Add("could not release governed port ${port}: $($_.Exception.Message)") }
    # The two closes are wrapped SEPARATELY and in this order on purpose. A failure closing the process handle
    # must not skip the job close, because the job close is the backstop below.
    try {
      if ($launchedHandle -ne [IntPtr]::Zero -and -not [MapleSeasonProcessInterop]::CloseHandle($launchedHandle)) {
        $footnotes.Add("could not close the handle on browser pid $launchedId (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so that id stays reserved for the life of this session")
      }
    } catch {
      $footnotes.Add("could not close the handle on the browser process it started: $($_.Exception.Message)")
    }
    # CLOSED LAST, AND CLOSING IT IS ITSELF A KILL. This is the only handle to a job created with
    # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, so the kernel terminates every surviving member as it closes. That
    # makes the backstop unconditional in a way no PowerShell statement can be: it holds when the cleanup above
    # threw, when this script is killed mid-run, and when the host process dies without running any finally at
    # all - handles close on process exit whatever killed it. The previous design's equivalent was a
    # $process.Kill() in this block, which required this block to run.
    try {
      if (-not [MapleSeasonProcessInterop]::CloseHandle($job)) {
        $footnotes.Add("could not close the job object owning its browser process tree (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so any surviving member of that tree was not reaped by the kernel either")
      }
    } catch {
      $footnotes.Add("could not close the job object owning its browser process tree: $($_.Exception.Message)")
    }
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
