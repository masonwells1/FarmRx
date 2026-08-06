# A BEHAVIOURAL regression for the kill-authorizing ownership predicate, runnable on any platform.
#
# Why this file exists, stated plainly because it is the whole justification for it. Every guard protecting
# `Test-MapleSeasonBrowserPortOwned` up to now was a `requireText` pin - a substring the source must contain -
# and the mutation drill only ever re-ran those pins. Measured on this workstation: inserting `return $true`
# at the top of the predicate, which authorizes killing EVERY listener on the governed port including a
# foreign one, left `node scripts/foundation-static-guards.mjs` printing PASS and
# `node scripts/verify-foundation-mutations.mjs` printing PASS with EVERY mutation in the drill reported as
# detected. No mutation count is quoted here on purpose: the measurement was taken on an intermediate working
# tree whose drill size matches no commit on this branch, so quoting the number invites a reader to check it
# against a tree where it was never true. The fact that survives is the one that matters - every pinned
# string was still present; only the behaviour was gone. The one gate that caught it,
# maple-season-browser-port-preflight.regression.ps1, is Windows-only because it opens real sockets, and the
# workflow runs on ubuntu-latest, so `main` had no behavioural coverage of the predicate at all.
#
# This file closes that. It has no sockets, no processes and no Windows APIs: it defines the predicate's
# functions from source, feeds them synthetic listener objects, and compares answers. It is invoked as its
# own workflow step - not through the orchestrator - and the mutation drill runs it as well.
#
# It ends by proving it has teeth, which is the property the pins lacked: it builds a GUTTED copy of the
# predicate in memory and requires its own case table to reject that copy. A suite that cannot fail is not
# evidence, and this one demonstrates its own failure mode every run.
#
# -Challenge exists because the completion marker below is just a string, and a reviewer demonstrated the
# obvious consequence: `Write-Output 'MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS'; exit 0` at the top of
# this file passed BOTH callers, because each of them only required the marker and a zero exit. Measured, and
# it is the same mistake one layer up that this whole file exists to fix - requiring text instead of
# behaviour. So each caller now hands over command lines it holds the answers to and this file must report
# what the REAL predicate says about them; a copy of this file that stops executing reports nothing and is
# refused. State the limit plainly: this defeats a suite that has stopped running, which is the accident that
# actually happens on edit. It does not defeat an author who deliberately forges the verdicts, because the
# verdicts are static and the forger writes the caller too. Only kernel provenance - a Job Object, which is
# an approval-gated design change - removes command-line inference from the kill decision entirely.
param(
  # The command lines whose answers the CALLER already holds: joined by U+001F, UTF-8 encoded, then BASE64.
  # Every part of that is a measured repair of a transport that silently ate the payload, and the payload IS
  # command lines, which is the most hostile possible thing to put on a command line.
  #   1. Not [string[]]: one caller dot-sources this file in-process while the other spawns it with `-File`,
  #      and through `-File` an array parameter bound only the FIRST element and discarded the rest - exit 0,
  #      no warning, three of four challenges never asked.
  #   2. Not the joined string on its own either. Measured in a full gate run: the joined string contains
  #      double quotes, because one challenge row is `"C:\Program Files\nodejs\node.exe" ...`, and passing it
  #      through `-File` truncated it AT THE FIRST QUOTE - challenge 1 came back as argv=<C:\Program> and
  #      challenges 2 and 3 were never asked, while the suite still printed its completion marker. A delimiter
  #      does not help when the QUOTING is what breaks. And U+001F is not in fact impossible in a Windows
  #      command line: `A<U+001F>B` handed to a Node child was measured arriving as three characters with code
  #      point 31 in the middle. Each caller therefore REFUSES to send a row containing the delimiter, rather
  #      than this file trusting a claim about what cannot happen.
  #   3. Base64 is the answer because its alphabet has no space, no quote, no backslash and no metacharacter,
  #      so there is nothing left for any shell, `-File` binder or YAML block scalar to reinterpret.
  # The manifest reports how many challenges were actually decoded, so "fewer challenges asked" fails by name
  # rather than by an argv mismatch that happens to notice.
  [string]$Challenge = '',
  [string]$ChallengeRoot = 'C:\FarmRx'
)
$ErrorActionPreference = 'Stop'
$script:failures = @()

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { $script:failures += $Message }
}

# THE ASSERTION HELPER PROVES ITSELF, AT RUN TIME, BEFORE ANY REAL ASSERTION RUNS.
#
# This is not caution. A fresh-context review changed the line above from `if (-not $Condition)` to
# `if ($false)` and this file still printed its completion marker, still published a manifest with every
# table at full size, still answered all four caller challenges correctly from the real tokenizer and the
# real predicate, and exited 0 - with every single one of its ~100 table assertions disabled. Reproduced
# here before this canary was written. The manifest cannot catch it, because table SIZES are counted
# independently of whether their assertions do anything. The challenge cannot catch it either, because the
# challenge answers are computed outside Assert-True.
#
# So the helper is checked the only way a helper can be: by handing it something that MUST fail and
# refusing to continue if it does not notice. `throw` rather than Assert-True, because Assert-True is the
# thing on trial.
$script:assertionCanary = 'assertion-helper-canary: Assert-True accepted a false condition'
Assert-True $false $script:assertionCanary
if ($script:failures -notcontains $script:assertionCanary) {
  throw 'Assertion helper did not record a deliberately-false assertion, so every other check in this file is inert. Refusing to report a result.'
}
$script:failures = @($script:failures | Where-Object { $_ -cne $script:assertionCanary })
if ($script:failures.Count -ne 0) {
  throw 'Assertion helper self-test left unexpected failures behind; this file cannot report on itself.'
}
# `canary=caught` in the manifest is how each CALLER learns the self-test ran. A caller that stops
# requiring it is a mutation drill away from red.
$script:assertionCanaryCaught = 'caught'

# AND THE CANARY ABOVE IS NOT ENOUGH, which is measured rather than supposed. A fresh-context review left the
# canary working and defeated everything else with it:
#
#   function Assert-True {
#     param([bool]$Condition, [string]$Message)
#     if ($Message -ceq $script:assertionCanary) { $script:failures += $Message; return }
#   }
#
# The self-test above passes, `canary=caught` is honest, every table still reports full size, all six caller
# challenges are still answered correctly from a fresh nonce - and every real assertion in this file is
# discarded. Planted verbatim in the real files and measured: static guards PASS, all 139 controlled mutations
# still detected, the lane green, on a predicate edited to authorize killing every listener on the governed
# port. A self-test cannot close this, because whatever this file hands its own helper, the helper can be
# written to recognise.
#
# So there are TWO channels and they are cross-checked. Assert-True keeps the failure list; the wrapper below
# keeps an independent tally and merely CALLS Assert-True rather than being it. Sabotaging the helper leaves
# the tally full and the list empty, and the `throw` before the manifest - which does not go through the
# helper - refuses to report a result on that contradiction. Sabotaging BOTH is a larger edit, and
# scripts/verify-foundation-mutations.mjs now runs this file against a deliberately broken predicate and
# requires it to go red, which is the only check of this class that measures execution instead of text.
$script:tallied = @()
function Assert-MapleSeasonCase {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { $script:tallied += $Message }
  Assert-True $Condition $Message
}

$sourcePath = Join-Path $PSScriptRoot 'maple-season-browser.ps1'
$source = Get-Content -Raw $sourcePath
# Take only the pure functions. Everything from Clear-MapleSeasonBrowserPort onwards touches real processes
# and Get-NetTCPConnection, which is why the socket regression cannot run off Windows; slicing above it is
# what makes this file portable.
$boundary = $source.IndexOf('function Clear-MapleSeasonBrowserPort')
if ($boundary -lt 0) { throw 'Cannot find Clear-MapleSeasonBrowserPort in maple-season-browser.ps1; this regression would define nothing and pass vacuously.' }
$definitions = $source.Substring(0, $boundary)
# The slice must be unambiguous. A second, decoy copy of the marker earlier in the file would silently move
# this boundary and leave the predicate out of the slice entirely.
if ($source.IndexOf('function Clear-MapleSeasonBrowserPort') -ne $source.LastIndexOf('function Clear-MapleSeasonBrowserPort')) { throw 'maple-season-browser.ps1 declares Clear-MapleSeasonBrowserPort more than once; the slice below is ambiguous.' }
foreach ($required in @('function Split-MapleSeasonCommandLineArguments', 'function Test-MapleSeasonArgumentIsInsideTree', 'function Test-MapleSeasonBrowserPortOwned')) {
  if (-not $definitions.Contains($required)) { throw "The sliced definitions do not contain '$required'; this regression would test something other than the shipping predicate." }
}
Invoke-Expression $definitions

# ---------------------------------------------------------------------------------------------------------
# The tokenizer, against expectations MEASURED from CommandLineToArgvW rather than reasoned about.
#
# Every Expected value below was produced by calling the real shell32 API on this workstation and printing
# its output as a literal. That matters for honesty about what runs where: on Windows the socket regression
# re-derives these from the live API, so a literal that drifts away from Windows fails there; here the same
# cases run on any platform because string splitting has no platform. Hand-writing these expectations from
# my reading of the documentation is exactly the mistake that produced three consecutive false-TRUEs.
$tokenizerTable = @(
    @{ Line = 'node.exe C:\FarmRx\x.js'; Expected = @('node.exe', 'C:\FarmRx\x.js') }
    @{ Line = 'node.exe   C:\FarmRx\x.js   --port   4177'; Expected = @('node.exe', 'C:\FarmRx\x.js', '--port', '4177') }
    @{ Line = 'node.exe'+[char]9+'C:\FarmRx\x.js'+[char]9+'--port'+[char]9+'4177'; Expected = @('node.exe', 'C:\FarmRx\x.js', '--port', '4177') }
    @{ Line = '"C:\Program Files\nodejs\node.exe" scripts\factory-board.mjs --port 4177'; Expected = @('C:\Program Files\nodejs\node.exe', 'scripts\factory-board.mjs', '--port', '4177') }
    @{ Line = 'node.exe "C:\Mason FarmRx\x.js"'; Expected = @('node.exe', 'C:\Mason FarmRx\x.js') }
    # The four command lines that each defeated the hand-written scan, and the argument Windows really
    # builds from each. A backslash-escaped quote is DATA; a quote can OPEN a continuing fragment; a
    # non-breaking space is a legal file-name character and not a separator.
    @{ Line = 'node.exe C:\Other\server.js --label "C:\FarmRx\safe\" --port 4177"'; Expected = @('node.exe', 'C:\Other\server.js', '--label', 'C:\FarmRx\safe" --port 4177') }
    @{ Line = 'node.exe C:\FarmRx" Backup"\scripts\factory-board.mjs'; Expected = @('node.exe', 'C:\FarmRx Backup\scripts\factory-board.mjs') }
    # The concatenations inside these Expected arrays are PARENTHESIZED deliberately. PowerShell's comma
    # operator binds tighter than '+', so @('a', 'b'+[char]9+'c') is ('a','b') + tab + 'c' - a FOUR-element
    # array, not two. Measured: without the parentheses this table expected the tokenizer to split on a
    # non-breaking space, which is the very bug the case exists to refute, and the regression failed the
    # correct implementation. An expectation table that is itself mis-parsed argues for the wrong answer.
    @{ Line = ('node.exe C:\FarmRx'+[char]0x00A0+'Backup\server.js'); Expected = @('node.exe', ('C:\FarmRx'+[char]0x00A0+'Backup\server.js')) }
    @{ Line = 'node.exe C:\FarmRx\.. --port 4177'; Expected = @('node.exe', 'C:\FarmRx\..', '--port', '4177') }
    # The 2n / 2n+1 backslash rule at each parity. An ODD run leaves a literal quote; an EVEN run leaves the
    # quote to act as a delimiter.
    @{ Line = 'node.exe a\\"b c'; Expected = @('node.exe', 'a\b c') }
    @{ Line = 'node.exe a\\\"b c'; Expected = @('node.exe', 'a\"b', 'c') }
    @{ Line = 'node.exe a\\\\"b c" d'; Expected = @('node.exe', 'a\\b c', 'd') }
    # An even backslash run followed by TWO quotes - where the backslash rule and the doubled-quote rule
    # meet. Deciding the first quote inside the backslash branch produced a false-TRUE: it built
    # `C:\FarmRx\safe\ --port 4177` instead of `C:\FarmRx\safe\"`, and the predicate then claimed a listener
    # whose actual script was C:\Other\server.js. Only one place in the tokenizer may decide what a quote is.
    @{ Line = 'node.exe C:\Other\server.js --label "C:\FarmRx\safe\\"" --port 4177'; Expected = @('node.exe', 'C:\Other\server.js', '--label', 'C:\FarmRx\safe\"', '--port', '4177') }
    # CommandLineToArgvW's doubled-quote quirk: inside a quoted argument '""' yields one literal quote and
    # LEAVES quoted mode, which is why the second of these splits a path in two rather than joining a
    # sibling name. The C runtime does not share this rule, which is why the predicate refuses such lines
    # outright rather than trusting either reading.
    @{ Line = 'node.exe "C:\FarmRx"" Backup"\x.js'; Expected = @('node.exe', 'C:\FarmRx"', 'Backup\x.js') }
    @{ Line = 'node.exe C:\Other\server.js --label "C:\Other"" C:\FarmRx\safe"'; Expected = @('node.exe', 'C:\Other\server.js', '--label', 'C:\Other"', 'C:\FarmRx\safe') }
    @{ Line = 'node.exe "a""b"'; Expected = @('node.exe', 'a"b') }
    @{ Line = 'node.exe ab"c"d"e"f'; Expected = @('node.exe', 'abcdef') }
    # Degenerate and malformed spellings. A tokenizer that throws here gives its caller neither TRUE nor
    # FALSE, which is the one answer the caller cannot use.
    @{ Line = 'node.exe ""'; Expected = @('node.exe', '') }
    @{ Line = 'node.exe """"'; Expected = @('node.exe', '"') }
    @{ Line = 'node.exe """"""'; Expected = @('node.exe', '""') }
    @{ Line = 'node.exe \\'; Expected = @('node.exe', '\\') }
    @{ Line = 'node.exe "'; Expected = @('node.exe', '') }
    @{ Line = '"node.exe'; Expected = @('node.exe') }
    @{ Line = 'node.exe one"'; Expected = @('node.exe', 'one') }
    # Leading whitespace is NOT skipped: Windows begins argv[0] at the first character, so this yields an
    # EMPTY argv[0] and then parses the rest normally.
    @{ Line = '   node.exe   one'; Expected = @('', 'node.exe', 'one') }
    # Spellings the containment test depends on downstream.
    @{ Line = 'node.exe C:/FarmRx/x.js'; Expected = @('node.exe', 'C:/FarmRx/x.js') }
    @{ Line = 'node.exe "C:\FarmRx\my app\x.js" --port 4177'; Expected = @('node.exe', 'C:\FarmRx\my app\x.js', '--port', '4177') }
    @{ Line = 'node.exe "C:\FarmRx\.. .\Other\x.js"'; Expected = @('node.exe', 'C:\FarmRx\.. .\Other\x.js') }
    @{ Line = ('node.exe "C:\FarmRx\'+[char]9+'\Other\x.js"'); Expected = @('node.exe', ('C:\FarmRx\'+[char]9+'\Other\x.js')) }
)

function Measure-TokenizerDisagreement {
  param([string]$FunctionName)
  $disagreements = @()
  foreach ($case in $tokenizerTable) {
    $actual = @(& $FunctionName -CommandLine $case.Line)
    $expected = @($case.Expected)
    $agrees = $actual.Count -eq $expected.Count
    if ($agrees) {
      for ($position = 0; $position -lt $expected.Count; $position++) {
        if ($actual[$position] -cne $expected[$position]) { $agrees = $false; break }
      }
    }
    if (-not $agrees) {
      $disagreements += ("'{0}': expected [{1}] but produced [{2}]" -f $case.Line, (($expected | ForEach-Object { "<$_>" }) -join ' '), (($actual | ForEach-Object { "<$_>" }) -join ' '))
    }
  }
  return $disagreements
}

$tokenizerDisagreements = @(Measure-TokenizerDisagreement -FunctionName 'Split-MapleSeasonCommandLineArguments')
foreach ($disagreement in $tokenizerDisagreements) { Assert-MapleSeasonCase $false "Split-MapleSeasonCommandLineArguments disagreed with the measured Windows parse on $disagreement." }

# The empty command line is the tokenizer's ONE deliberate divergence from Windows. The real API answers it
# with the path of the process ASKING - measured as one argument naming powershell.exe itself - which is a
# fact about the caller and worthless as evidence about a listener. Zero is the fail-closed answer.
Assert-MapleSeasonCase (@(Split-MapleSeasonCommandLineArguments -CommandLine '').Count -eq 0) 'Split-MapleSeasonCommandLineArguments answered an empty command line with arguments instead of none.'

# ---------------------------------------------------------------------------------------------------------
# The predicate's refusals that hold on EVERY platform. This is the portable core, and it is what catches a
# predicate whose body has been replaced.
#
# Be exact about WHY they are portable, because an earlier version of this comment said "each returns before
# the path resolver is reached" and that is not true of all of them. Three groups, and they are portable for
# different reasons:
#   1. Rows refused on the LISTENER or the ROOT before any argument is resolved - a null listener, an
#      unreadable or empty or whitespace command line, a missing/whitespace/non-string root, an over-broad
#      root, a root that is the drive root under another spelling, a wrong image name, a relative script path.
#      These never reach the resolver on any platform.
#   2. The sibling row `C:\FarmRx2...`, which DOES reach the resolver and is refused by arithmetic no
#      resolver changes: whatever a platform prepends, it prepends to the argument and to the root alike, so
#      the character after the root text is still `2` and never a separator. Portable, but not because it
#      returns early - see the row's own comment.
#   3. Rows whose refusal is reached by a DIFFERENT branch depending on platform. Off Windows a
#      Windows-shaped path is a relative name, so several rows this file describes as image-name or
#      containment refusals are refused earlier than they are on Windows. The verdict is the same in both
#      worlds, which is all this table asserts; the branch is not, and this file does not claim it is.
function New-Listener {
  # NOT [string] on either parameter. A reviewer found that `[string]$CommandLine` silently coerces $null to
  # the empty string, which collapsed the 'command line cannot be read' row and the 'empty command line' row
  # into the SAME runtime input - measured, both arrived as a zero-length String. Two of the twenty-five rows
  # were therefore one case wearing two labels, which is precisely what the count-based anti-vacuity check
  # below could not see. WMI really does hand back $null for a command line the caller may not read, so the
  # row is meaningful only if the null survives to the predicate.
  param($CommandLine, $Name = 'node.exe')
  return [pscustomobject]@{ Name = $Name; CommandLine = $CommandLine }
}

$portableRefusals = @(
  @{ Label = 'a null listener object'; Listener = $null; Root = 'C:\FarmRx' }
  @{ Label = 'a listener whose command line cannot be read'; Listener = (New-Listener -CommandLine $null); Root = 'C:\FarmRx' }
  @{ Label = 'a listener with an empty command line'; Listener = (New-Listener -CommandLine ''); Root = 'C:\FarmRx' }
  @{ Label = 'a listener with a whitespace-only command line'; Listener = (New-Listener -CommandLine '   '); Root = 'C:\FarmRx' }
  @{ Label = 'a missing root'; Listener = (New-Listener -CommandLine 'node.exe C:\FarmRx\x.js'); Root = $null }
  @{ Label = 'a whitespace-only root, which occurs in nearly every command line'; Listener = (New-Listener -CommandLine 'node.exe C:\FarmRx\x.js'); Root = ' ' }
  @{ Label = 'a non-string root, which must fail closed rather than raise a method-not-found error'; Listener = (New-Listener -CommandLine 'node.exe C:\FarmRx\x.js'); Root = 4174 }
  # Over-broad roots. Each of these once claimed every node process on the machine, or a listener in an
  # unrelated tree, and each answer authorized a force kill.
  @{ Label = "the drive root 'C:\'"; Listener = (New-Listener -CommandLine 'node.exe C:\Other\x.js'); Root = 'C:\' }
  @{ Label = "the bare drive 'C:'"; Listener = (New-Listener -CommandLine 'node.exe C:\Other\x.js'); Root = 'C:' }
  @{ Label = "the forward-slash drive root 'C:/'"; Listener = (New-Listener -CommandLine 'node.exe C:\Other\x.js'); Root = 'C:/' }
  @{ Label = "the relative root '.'"; Listener = (New-Listener -CommandLine 'node .'); Root = '.' }
  @{ Label = 'a bare relative name as a root'; Listener = (New-Listener -CommandLine 'node.exe FarmRx\x.js'); Root = 'FarmRx' }
  @{ Label = 'a share root with no directory under it'; Listener = (New-Listener -CommandLine 'node.exe \\server\share\x.js'); Root = '\\server\share' }
  # Roots that ARE the drive root under another spelling, or that navigate back to it. Each satisfied the
  # first shape check, which only demanded one character after the separator.
  @{ Label = "the root 'C:\.'"; Listener = (New-Listener -CommandLine 'node.exe "C:\.\app.js"'); Root = 'C:\.' }
  @{ Label = "the root 'C:\..'"; Listener = (New-Listener -CommandLine 'node.exe "C:\..\app.js"'); Root = 'C:\..' }
  @{ Label = "the root 'C:\FarmRx\..'"; Listener = (New-Listener -CommandLine 'node.exe "C:\FarmRx\..\Other\app.js"'); Root = 'C:\FarmRx\..' }
  @{ Label = "the root 'C:\ '"; Listener = (New-Listener -CommandLine 'node.exe "C:\ \app.js"'); Root = 'C:\ ' }
  @{ Label = 'a device-namespace root that aliases a tree held under its normal name'; Listener = (New-Listener -CommandLine 'node.exe "\\.\C:\FarmRx\app.js"'); Root = '\\.\C:\FarmRx' }
  @{ Label = 'an extended-length root that aliases a tree held under its normal name'; Listener = (New-Listener -CommandLine 'node.exe "\\?\C:\FarmRx\app.js"'); Root = '\\?\C:\FarmRx' }
  # Windows has TWO argument grammars - shell32's CommandLineToArgvW and the C runtime that node.exe itself
  # links - and they do not agree everywhere. An earlier version of this comment claimed they disagree "on
  # exactly one construct"; that was an overstatement written from one measurement, and it is withdrawn.
  # What IS measured is the construct below. With the real API, shell32 splits
  # `--label "C:\Other"" C:\FarmRx\safe"` into `C:\Other"` and `C:\FarmRx\safe`, so half
  # a label reads as a path inside our tree, while node's own C-runtime parse keeps it one argument naming
  # nothing of ours. Both readings are defensible and guessing wrong authorizes a kill.
  @{ Label = 'a doubled quote whose meaning depends on which Windows grammar parsed it'; Listener = (New-Listener -CommandLine 'node.exe C:\Other\server.js --label "C:\Other"" C:\FarmRx\safe"'); Root = 'C:\FarmRx' }
  @{ Label = 'a doubled quote spelling of a sibling tree'; Listener = (New-Listener -CommandLine 'node.exe "C:\FarmRx"" Backup"\x.js'); Root = 'C:\FarmRx' }
  # The image-name narrowing. A process that merely mentions our tree is not a Node listener of ours.
  @{ Label = 'a non-Node process whose arguments mention the owned tree'; Listener = (New-Listener -CommandLine 'python.exe C:\FarmRx\tool.py' -Name 'python.exe'); Root = 'C:\FarmRx' }
  @{ Label = 'a process with no image name at all'; Listener = (New-Listener -CommandLine 'node.exe C:\FarmRx\x.js' -Name $null); Root = 'C:\FarmRx' }
  # An unrelated tree that merely shares the root's leading text. Unlike the cases above this one is decided
  # AFTER the resolver runs, and it belongs here anyway because the rule that refuses it is arithmetic no
  # resolver changes: whatever the resolver prepends, it prepends to the argument and to the root alike, so
  # the text immediately after the root is still `2`, which is not a directory separator. That holds on any
  # platform. The Windows-only section below is what proves the boundary rule is drawn in the right place, by
  # pairing this with the C:\FarmRx paths that must answer TRUE.
  @{ Label = 'a sibling tree sharing the root prefix'; Listener = (New-Listener -CommandLine 'node.exe C:\FarmRx2\node_modules\vite\bin\vite.js'); Root = 'C:\FarmRx' }
  # The exact command line of a live, unrelated Node process on the author's workstation, recorded here so
  # the ledger's repeated claim about it stops being prose and becomes an executed case. It is a Node
  # process holding port 4177, which the cleanup path governs, so the predicate's answer about it decides
  # whether that process gets force-killed. Note what actually refuses it: the script path is spelled
  # RELATIVELY, and a relative path resolves against wherever the shell happens to be standing - which is
  # why the predicate refuses to resolve one at all rather than resolving it and comparing. Both earlier
  # ledger entries claimed this line was the input a since-closed hole would have authorized killing; it is
  # not, because it never names our tree in any spelling. It is a refusal for the plainest possible reason,
  # and this case is here so that reason is verified rather than asserted.
  @{ Label = 'a live unrelated Node process on the governed port whose script path is relative'; Listener = (New-Listener -CommandLine '"C:\Program Files\nodejs\node.exe" scripts/factory-board.mjs --port 4177'); Root = 'C:\FarmRx' }
)

function Measure-RefusalFailures {
  param([string]$FunctionName)
  $wrong = @()
  foreach ($case in $portableRefusals) {
    if (& $FunctionName -ListenerProcess $case.Listener -Root $case.Root) { $wrong += $case.Label }
  }
  return $wrong
}

foreach ($claimed in @(Measure-RefusalFailures -FunctionName 'Test-MapleSeasonBrowserPortOwned')) {
  Assert-MapleSeasonCase $false "The ownership predicate authorized a kill for $claimed."
}

# ---------------------------------------------------------------------------------------------------------
# THE ANTI-VACUITY CHECK, and the reason this file is worth its length.
#
# Gut the predicate in memory - `return $true` at the top, which authorizes killing every listener on the
# governed port - and require the portable refusals above to reject it. Measured: that same edit against the
# real file left the static guards and the whole mutation drill passing, because every guard was a substring
# pin and every pinned substring was still there. If this suite cannot tell the gutted copy from the real one, it is
# decoration too, and this assertion is what says so out loud.
$predicateStart = $definitions.IndexOf('function Test-MapleSeasonBrowserPortOwned')
if ($predicateStart -lt 0) { throw 'Cannot locate the ownership predicate to gut; the anti-vacuity check below would prove nothing.' }
$predicateSource = $definitions.Substring($predicateStart)
$firstGuard = '  if ($null -eq $ListenerProcess) { return $false }'
if (-not $predicateSource.Contains($firstGuard)) { throw 'Cannot find the ownership predicate''s first guard; the gutting needle is stale and the anti-vacuity check would prove nothing.' }
$guttedSource = $predicateSource.Replace('function Test-MapleSeasonBrowserPortOwned', 'function Test-MapleSeasonBrowserPortOwnedGutted').Replace($firstGuard, "  return `$true`n$firstGuard")
Invoke-Expression $guttedSource
$guttedClaims = @(Measure-RefusalFailures -FunctionName 'Test-MapleSeasonBrowserPortOwnedGutted')
# EVERY refusal must fail against a predicate that returns true unconditionally, and this is checked as a SET
# OF LABELS rather than as a count. The earlier version compared counts and claimed that proved "the table is
# reached in full"; a reviewer showed that claim is false, because twenty-five executions of one row satisfy a
# count of twenty-five just as well as twenty-five distinct rows do. Comparing which labels answered wrongly
# against which labels exist cannot be satisfied that way.
$expectedRefusalLabels = @($portableRefusals | ForEach-Object { $_.Label })
$uncaught = @($expectedRefusalLabels | Where-Object { $guttedClaims -notcontains $_ })
Assert-MapleSeasonCase ($uncaught.Count -eq 0) "The refusal table did not reject a gutted predicate. Rows that failed to catch `return `$true`: $($uncaught -join '; '). A table that cannot detect an unconditional authorization is not evidence."
# A label set is only an identity if the labels are unique, and the rows are only distinct evidence if their
# INPUTS differ. Both are asserted rather than assumed: the second of these is what catches the null-coercion
# defect that made two rows the same case, and it will catch the next copy-paste row that forgets to change
# its command line.
Assert-MapleSeasonCase (@($expectedRefusalLabels | Select-Object -Unique).Count -eq $portableRefusals.Count) 'Two refusal rows share a label, so the set comparison above cannot tell them apart.'
$refusalInputKeys = @($portableRefusals | ForEach-Object {
  $listener = $_.Listener
  $name = if ($null -eq $listener) { '<no listener>' } elseif ($null -eq $listener.Name) { '<null name>' } else { $listener.Name }
  $line = if ($null -eq $listener) { '<no listener>' } elseif ($null -eq $listener.CommandLine) { '<null command line>' } else { $listener.CommandLine }
  $root = if ($null -eq $_.Root) { '<null root>' } else { [string]$_.Root }
  "$name`u{241F}$line`u{241F}$root"
})
$duplicateInputs = @($refusalInputKeys | Group-Object | Where-Object { $_.Count -gt 1 } | ForEach-Object { $_.Name })
Assert-MapleSeasonCase ($duplicateInputs.Count -eq 0) "Two refusal rows are the same runtime input wearing different labels, so the table has fewer distinct cases than rows: $($duplicateInputs.Count) duplicated input(s)."
# The same proof for the tokenizer table.
function Split-MapleSeasonCommandLineArgumentsGutted { param([string]$CommandLine) return @($CommandLine) }
Assert-MapleSeasonCase ((@(Measure-TokenizerDisagreement -FunctionName 'Split-MapleSeasonCommandLineArgumentsGutted')).Count -gt 0) 'The tokenizer table did not reject a gutted tokenizer that returns the whole command line as one argument.'

# ---------------------------------------------------------------------------------------------------------
# What this file CANNOT prove off Windows, stated rather than quietly skipped, and stated more carefully than
# it was. Containment is decided by [System.IO.Path]::GetFullPath, which is platform-dependent: off Windows a
# backslash is an ordinary character, so a Windows-shaped path is a RELATIVE name and the resolver prefixes
# the current directory to it. An earlier version of this comment concluded from that "no Windows-shaped root
# can ever match and the predicate answers FALSE for every case." That conclusion does not follow and is
# withdrawn: the resolver prefixes the same current directory to the root as well, so the prefix comparison
# can still match, and the directory-boundary rule that decides the rest is written with a literal backslash
# rather than the platform separator. What the correct off-Windows answers are has NOT been measured - there
# is no Linux .NET on this workstation to measure it with - and guessing is precisely the habit that produced
# the earlier false answers.
#
# So the split below is drawn by what needs no resolver at all. The refusals above are meaningful everywhere,
# because each returns before the resolver is reached or is decided by prefix arithmetic no resolver changes;
# they catch the dangerous direction, a predicate that authorizes what it should not. Everything whose answer
# the resolver decides is asserted only where the resolver is the one the shipping code assumes.
$onWindows = ($null -eq $IsWindows) -or $IsWindows
# Both Windows-only tables are named rather than written inline inside the `if`, so the manifest printed at the
# end of this file can report how many of their cases actually executed. A caller reading `windowsCases=0` on
# Windows learns that the half of this suite which proves the dangerous-FALSE direction did not run, which an
# inline `foreach` over an anonymous array gives it no way to notice.
$ownedCases = @(
    # Paths that ARE inside the tree and must be recognized. A false FALSE here does not kill anything, but it
    # declares our own listener foreign and fails a proof month with a wrong diagnosis.
    @{ Label = 'an ordinary owned script path'; Root = 'C:\FarmRx'; CommandLine = 'node.exe C:\FarmRx\node_modules\vite\bin\vite.js --port 4177' }
    @{ Label = 'a quoted owned path'; Root = 'C:\FarmRx'; CommandLine = 'node.exe "C:\FarmRx\node_modules\vite\bin\vite.js"' }
    @{ Label = 'forward slashes'; Root = 'C:\FarmRx'; CommandLine = 'node.exe C:/FarmRx/server.mjs' }
    @{ Label = 'an extended-length spelling of the owned tree'; Root = 'C:\FarmRx'; CommandLine = 'node.exe "\\?\C:\FarmRx\server.mjs"' }
    @{ Label = 'a no-op current-directory segment'; Root = 'C:\FarmRx'; CommandLine = 'node.exe C:\FarmRx\.\server.mjs' }
    @{ Label = 'a traversal that stays inside the tree'; Root = 'C:\FarmRx'; CommandLine = 'node.exe C:\FarmRx\sub\..\server.mjs' }
    @{ Label = 'a doubled separator'; Root = 'C:\FarmRx'; CommandLine = 'node.exe C:\FarmRx\\server.mjs' }
    @{ Label = 'the exact root followed by another argument'; Root = 'C:\FarmRx'; CommandLine = 'node C:\FarmRx --port 4177' }
    @{ Label = 'a dot-prefixed directory, which this repository''s own root depends on'; Root = 'C:\FarmRx\.claude\worktrees\b'; CommandLine = 'node.exe "C:\FarmRx\.claude\worktrees\b\node_modules\vite\bin\vite.js"' }
    @{ Label = 'a space-bearing segment, quoted as a real listener would quote it'; Root = 'C:\FarmRx'; CommandLine = 'node.exe "C:\FarmRx\my app\server.mjs"' }
    @{ Label = 'a space-bearing root'; Root = 'C:\Mason FarmRx'; CommandLine = 'node.exe "C:\Mason FarmRx\node_modules\vite\bin\vite.js"' }
    @{ Label = 'a UNC root'; Root = '\\server\share\FarmRx'; CommandLine = 'node.exe "\\server\share\FarmRx\node_modules\vite\bin\vite.js"' }
    @{ Label = 'an owned path later in the line than a traversing one'; Root = 'C:\FarmRx'; CommandLine = 'node.exe --require C:\FarmRx\..\Other\hook.js C:\FarmRx\app\server.mjs' }
    @{ Label = 'a case-differing spelling of the owned root'; Root = 'C:\FarmRx'; CommandLine = 'node.exe c:\farmrx\server.mjs' }
)
# Resolver-dependent refusals: an argument that begins with our root at a real separator and still cannot
# name a file inside the tree.
$resolverRefusals = @(
    @{ Label = 'a traversal out of the tree'; CommandLine = 'node.exe "C:\FarmRx\..\Other\scripts\factory-board.mjs" --port 4177' }
    @{ Label = 'an unquoted traversal followed by another argument'; CommandLine = 'node.exe C:\FarmRx\.. --port 4177' }
    @{ Label = 'a component that is only dots and a space'; CommandLine = 'node.exe "C:\FarmRx\.. \Other\x.js"' }
    @{ Label = 'a reserved device name'; CommandLine = 'node.exe C:\Other\server.js --label C:\FarmRx\NUL' }
    @{ Label = 'a reserved device name with an extension'; CommandLine = 'node.exe C:\Other\server.js --label C:\FarmRx\COM1.txt' }
    @{ Label = 'an alternate data stream'; CommandLine = 'node.exe C:\Other\server.js --label C:\FarmRx\file:stream' }
    @{ Label = 'a drive-relative path that depends on where the shell is standing'; CommandLine = 'node.exe C:FarmRx\server.js' }
    @{ Label = 'an escaped quote that puts our root inside an argument belonging to another tree'; CommandLine = 'node.exe C:\Other\server.js --label "C:\FarmRx\safe\" --port 4177"' }
    @{ Label = 'a sibling tree separated by a non-breaking space'; CommandLine = ('node.exe C:\FarmRx{0}Backup\server.js' -f [char]0x00A0) }
    @{ Label = 'a sibling tree reached by opening a quoted fragment'; CommandLine = 'node.exe C:\FarmRx" Backup"\scripts\factory-board.mjs' }
)

$windowsCasesRun = 0
if (-not $onWindows) {
  # Says only what is known. The earlier wording here asserted that a Windows-shaped root "cannot resolve
  # off Windows", which was withdrawn as unmeasured: off Windows `GetFullPath` prefixes the current
  # directory to the argument and the root alike, so the prefix comparison can still match, and no Linux
  # .NET run has settled it on this workstation. The honest statement is that these cases are not run here.
  Write-Output 'Ownership TRUE cases skipped: this platform is not Windows, and the off-Windows verdict for a Windows-shaped root is not measured. Run the Windows lane for those cases.'
} else {
  foreach ($case in $ownedCases) {
    Assert-MapleSeasonCase (Test-MapleSeasonBrowserPortOwned -ListenerProcess (New-Listener -CommandLine $case.CommandLine) -Root $case.Root) "The ownership predicate refused $($case.Label), which would declare our own listener foreign and fail a proof month with a wrong diagnosis."
    $windowsCasesRun++
  }
  foreach ($case in $resolverRefusals) {
    Assert-MapleSeasonCase (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess (New-Listener -CommandLine $case.CommandLine) -Root 'C:\FarmRx')) "The ownership predicate authorized a kill for $($case.Label)."
    $windowsCasesRun++
  }
}

# ---------------------------------------------------------------------------------------------------------
# THE TWO CHANNELS MUST AGREE, and this is the last thing that happens before anything is reported.
#
# Every real case above went through Assert-MapleSeasonCase, which tallies independently and then calls
# Assert-True. Equal counts is the only honest outcome: the tally is appended by plain array arithmetic outside
# the helper, so a helper rewritten to discard real failures leaves the tally populated and the failure list
# empty. `throw`, not Assert-True, because Assert-True is the thing being cross-checked - and it happens before
# the manifest and before the challenge answers, so a run in this state reports nothing rather than reporting
# PASS. Measured against the real files: without this, the sabotage quoted at the top of this file printed
# `canary=caught`, every table at full size, six correct challenge answers and PASS, against a predicate edited
# to authorize killing every listener on the governed port.
if ($script:tallied.Count -ne $script:failures.Count) {
  throw "This file's two reporting channels disagree: $($script:tallied.Count) case(s) were tallied and $($script:failures.Count) reached the failure list, so one of them is not working and no result from this run can be trusted. Tallied: $($script:tallied -join '; ')"
}

# ---------------------------------------------------------------------------------------------------------
# CHALLENGE/RESPONSE, and the MANIFEST. Both exist for the same reason: a caller that requires only a marker
# and a zero exit is trusting a string again, which is the exact mistake this whole file was written to fix.
#
# The manifest says how much of this file ran. The challenge makes it answer questions whose answers the
# caller already holds: for each command line handed over, this prints the real tokenizer's split of it and
# the real predicate's ownership verdict on it. A copy of this file that has stopped executing - deleted body,
# early exit, an edit that skipped a section - cannot produce those lines, and every caller refuses it.
#
# Say what this does not do. The verdicts are static text in the callers, so an author who deliberately forges
# them can forge these too, because the same author writes the caller. It defeats the accident, not the fraud.
# Removing command-line inference from the kill decision entirely needs kernel provenance - a Job Object - and
# that is an approval-gated design change, not a test.
function Format-MapleSeasonArgv {
  param($Arguments)
  return (($Arguments | ForEach-Object { "<$_>" }) -join '|')
}

# An empty -Challenge means a bare manual run, which stays possible; it is each CALLER that refuses a run with
# no answers in it, because the caller is the party holding the answers. Decoding happens BEFORE the manifest
# so the manifest can state how many challenges arrived - the transport defect this encoding exists to fix
# lost challenges silently, and a count the caller checks is what makes that loud. A payload that is not valid
# Base64 throws here rather than being read as zero challenges.
$challengeLines = @()
if ($Challenge.Length -gt 0) {
  $challengeLines = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Challenge)) -split ([char]0x1F))
}
Write-Output ("OWNERSHIP_MANIFEST tokenizer={0} refusals={1} gutted={2} windows={3} windowsCases={4} challenges={5} canary={6}" -f $tokenizerTable.Count, $portableRefusals.Count, $guttedClaims.Count, ($onWindows.ToString().ToLowerInvariant()), $windowsCasesRun, $challengeLines.Count, $script:assertionCanaryCaught)
for ($index = 0; $index -lt $challengeLines.Count; $index++) {
  $challengeLine = $challengeLines[$index]
  $challengeArgv = @(Split-MapleSeasonCommandLineArguments -CommandLine $challengeLine)
  $challengeOwned = [bool](Test-MapleSeasonBrowserPortOwned -ListenerProcess (New-Listener -CommandLine $challengeLine) -Root $ChallengeRoot)
  Write-Output ("OWNERSHIP_CHALLENGE {0} owned={1} argv={2}" -f $index, ($challengeOwned.ToString().ToUpperInvariant()), (Format-MapleSeasonArgv $challengeArgv))
}

if ($script:failures.Count -gt 0) {
  foreach ($failure in $script:failures) { Write-Output "  - $failure" }
  Write-Output "MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_FAIL $($script:failures.Count) case(s)"
  exit 1
}
Write-Output 'MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS'
exit 0
