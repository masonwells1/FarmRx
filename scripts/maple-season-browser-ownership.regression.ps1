# A BEHAVIOURAL regression for the kill-authorizing ownership predicate, runnable on any platform.
#
# Why this file exists, stated plainly because it is the whole justification for it. Every guard protecting
# `Test-MapleSeasonBrowserPortOwned` up to now was a `requireText` pin - a substring the source must contain -
# and the mutation drill only ever re-ran those pins. Measured on this workstation: inserting `return $true`
# at the top of the predicate, which authorizes killing EVERY listener on the governed port including a
# foreign one, left `node scripts/foundation-static-guards.mjs` printing PASS and
# `node scripts/verify-foundation-mutations.mjs` printing PASS with all 85 mutations detected. Every pinned
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
$ErrorActionPreference = 'Stop'
$script:failures = @()

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { $script:failures += $Message }
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
foreach ($required in @('function Split-MapleSeasonCommandLineArgument', 'function Test-MapleSeasonArgumentIsInsideTree', 'function Test-MapleSeasonBrowserPortOwned')) {
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

$tokenizerDisagreements = @(Measure-TokenizerDisagreement -FunctionName 'Split-MapleSeasonCommandLineArgument')
foreach ($disagreement in $tokenizerDisagreements) { Assert-True $false "Split-MapleSeasonCommandLineArgument disagreed with the measured Windows parse on $disagreement." }

# The empty command line is the tokenizer's ONE deliberate divergence from Windows. The real API answers it
# with the path of the process ASKING - measured as one argument naming powershell.exe itself - which is a
# fact about the caller and worthless as evidence about a listener. Zero is the fail-closed answer.
Assert-True (@(Split-MapleSeasonCommandLineArgument -CommandLine '').Count -eq 0) 'Split-MapleSeasonCommandLineArgument answered an empty command line with arguments instead of none.'

# ---------------------------------------------------------------------------------------------------------
# The predicate's refusals that hold on EVERY platform, because each returns before the path resolver is
# reached. This is the portable core, and it is what catches a predicate whose body has been replaced.
function New-Listener {
  param([string]$CommandLine, [string]$Name = 'node.exe')
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
  # Windows has TWO argument grammars and they disagree on exactly one construct. Measured with the real
  # API: shell32 splits `--label "C:\Other"" C:\FarmRx\safe"` into `C:\Other"` and `C:\FarmRx\safe`, so half
  # a label reads as a path inside our tree, while node's own C-runtime parse keeps it one argument naming
  # nothing of ours. Both readings are defensible and guessing wrong authorizes a kill.
  @{ Label = 'a doubled quote whose meaning depends on which Windows grammar parsed it'; Listener = (New-Listener -CommandLine 'node.exe C:\Other\server.js --label "C:\Other"" C:\FarmRx\safe"'); Root = 'C:\FarmRx' }
  @{ Label = 'a doubled quote spelling of a sibling tree'; Listener = (New-Listener -CommandLine 'node.exe "C:\FarmRx"" Backup"\x.js'); Root = 'C:\FarmRx' }
  # The image-name narrowing. A process that merely mentions our tree is not a Node listener of ours.
  @{ Label = 'a non-Node process whose arguments mention the owned tree'; Listener = (New-Listener -CommandLine 'python.exe C:\FarmRx\tool.py' -Name 'python.exe'); Root = 'C:\FarmRx' }
  @{ Label = 'a process with no image name at all'; Listener = (New-Listener -CommandLine 'node.exe C:\FarmRx\x.js' -Name $null); Root = 'C:\FarmRx' }
  # An unrelated tree that merely shares the root's leading text. On Windows this is refused by the
  # separator-boundary rule AFTER the resolver runs, so - unlike the cases above - it is portable by
  # arithmetic rather than by design: off Windows no drive-shaped path resolves inside a drive-shaped root
  # at all, so the answer is FALSE either way. It is listed here because a FALSE that holds everywhere is
  # still worth asserting everywhere; the Windows-only section below is what proves the boundary rule
  # itself, by pairing this with the C:\FarmRx paths that must answer TRUE.
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
  Assert-True $false "The ownership predicate authorized a kill for $claimed."
}

# ---------------------------------------------------------------------------------------------------------
# THE ANTI-VACUITY CHECK, and the reason this file is worth its length.
#
# Gut the predicate in memory - `return $true` at the top, which authorizes killing every listener on the
# governed port - and require the portable refusals above to reject it. Measured: that same edit against the
# real file left the static guards and all 85 mutations passing, because every guard was a substring pin and
# every pinned substring was still there. If this suite cannot tell the gutted copy from the real one, it is
# decoration too, and this assertion is what says so out loud.
$predicateStart = $definitions.IndexOf('function Test-MapleSeasonBrowserPortOwned')
if ($predicateStart -lt 0) { throw 'Cannot locate the ownership predicate to gut; the anti-vacuity check below would prove nothing.' }
$predicateSource = $definitions.Substring($predicateStart)
$firstGuard = '  if ($null -eq $ListenerProcess) { return $false }'
if (-not $predicateSource.Contains($firstGuard)) { throw 'Cannot find the ownership predicate''s first guard; the gutting needle is stale and the anti-vacuity check would prove nothing.' }
$guttedSource = $predicateSource.Replace('function Test-MapleSeasonBrowserPortOwned', 'function Test-MapleSeasonBrowserPortOwnedGutted').Replace($firstGuard, "  return `$true`n$firstGuard")
Invoke-Expression $guttedSource
$guttedClaims = @(Measure-RefusalFailures -FunctionName 'Test-MapleSeasonBrowserPortOwnedGutted')
# EVERY refusal must fail against a predicate that returns true unconditionally. Requiring the exact count
# rather than "at least one" is deliberate: it proves the table is reached in full, not that one case is.
Assert-True ($guttedClaims.Count -eq $portableRefusals.Count) "The refusal table did not reject a gutted predicate: $($guttedClaims.Count) of $($portableRefusals.Count) cases caught `return `$true`. A table that cannot detect an unconditional authorization is not evidence."
# The same proof for the tokenizer table.
function Split-MapleSeasonCommandLineArgumentGutted { param([string]$CommandLine) return @($CommandLine) }
Assert-True ((@(Measure-TokenizerDisagreement -FunctionName 'Split-MapleSeasonCommandLineArgumentGutted')).Count -gt 0) 'The tokenizer table did not reject a gutted tokenizer that returns the whole command line as one argument.'

# ---------------------------------------------------------------------------------------------------------
# What this file CANNOT prove off Windows, stated rather than quietly skipped. Containment is decided by
# [System.IO.Path]::GetFullPath, and that resolver is platform-dependent: on Linux a backslash is an
# ordinary character and `C:\FarmRx\x.js` is a relative name, so no Windows-shaped root can ever match and
# the predicate answers FALSE for every case. The refusals above are therefore fully meaningful on Linux -
# they catch the dangerous direction, a predicate that authorizes what it should not - while the cases that
# must answer TRUE, and the refusals that depend on the resolver, are asserted only where the resolver
# behaves as the shipping code assumes.
$onWindows = ($null -eq $IsWindows) -or $IsWindows
if (-not $onWindows) {
  Write-Output 'Ownership TRUE cases skipped: containment is decided by the platform path resolver, and a Windows-shaped root cannot resolve off Windows.'
} else {
  # Paths that ARE inside the tree and must be recognized. A false FALSE here does not kill anything, but it
  # declares our own listener foreign and fails a proof month with a wrong diagnosis.
  foreach ($case in @(
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
  )) {
    Assert-True (Test-MapleSeasonBrowserPortOwned -ListenerProcess (New-Listener -CommandLine $case.CommandLine) -Root $case.Root) "The ownership predicate refused $($case.Label), which would declare our own listener foreign and fail a proof month with a wrong diagnosis."
  }
  # Resolver-dependent refusals: an argument that begins with our root at a real separator and still cannot
  # name a file inside the tree.
  foreach ($case in @(
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
  )) {
    Assert-True (-not (Test-MapleSeasonBrowserPortOwned -ListenerProcess (New-Listener -CommandLine $case.CommandLine) -Root 'C:\FarmRx')) "The ownership predicate authorized a kill for $($case.Label)."
  }
}

if ($script:failures.Count -gt 0) {
  foreach ($failure in $script:failures) { Write-Output "  - $failure" }
  Write-Output "MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_FAIL $($script:failures.Count) case(s)"
  exit 1
}
Write-Output 'MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS'
exit 0
