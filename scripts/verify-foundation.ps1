$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-FoundationLane([scriptblock]$Command, [string]$Failure) {
  $global:LASTEXITCODE = 0
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Get-FoundationProbeShell {
  if ($PSVersionTable.PSEdition -eq 'Desktop') {
    return (Join-Path $PSHOME 'powershell.exe')
  }
  if ($IsWindows) {
    return (Join-Path $PSHOME 'pwsh.exe')
  }
  return (Join-Path $PSHOME 'pwsh')
}

function Assert-IntermediateLaneFailureIsFatal {
  $expected = 'Controlled intermediate foundation lane failed.'
  $detected = $false
  $probeShell = Get-FoundationProbeShell
  try {
    Invoke-FoundationLane { & $probeShell -NoProfile -Command 'exit 23' } $expected
  } catch {
    if ($_.Exception.Message -ne $expected) { throw }
    $detected = $true
  }
  if (-not $detected) { throw 'Foundation orchestrator ignored a controlled intermediate failure.' }
  Write-Output 'Foundation orchestrator intermediate-failure probe: PASS'
}

function Invoke-FoundationWindowsExecutionLane {
  # Clear both of this lane's variables before anything else, so no answer can be inherited from
  # earlier in the run. Without this, a value seeded above the lane stands in for one the lane
  # produced: measured, assigning 'executed' plus a forged marker line before this call, and leaving
  # the pinned call itself on a branch that never runs, presented a lane that did nothing as a real
  # execution to the accounting below.
  $script:windowsExecutionLaneOutcome = $null
  $script:windowsExecutionOutput = @()
  # Every guard the repository holds over the governed-port preflight reads it as text. Nothing
  # executed the ownership predicate that gates the Stop-Process in Clear-MapleSeasonBrowserPort: the
  # regression chain that does exercise it sat in scripts/ with no caller at all, so a defect in it
  # would have surfaced only when a season month either refused to clean up its own server or
  # terminated a process the proof does not own.
  #
  # This lane belongs here and not in scripts/verify-season.ps1. That file is itself reachable only
  # when an operator types `npm run verify:season` by hand - .github/workflows/foundation.yml runs this
  # script, and this script calls the two season node gates directly - so wiring the chain there would
  # have left it exactly as orphaned as it started, behind one more layer.
  #
  # The chain is Windows-only by necessity: Get-NetTCPConnection, node.exe, and a hidden Start-Process
  # have no portable equivalent. On any other platform it records a skip and claims no credit rather
  # than reporting a pass it did not earn. The CI runner is ubuntu-latest, so CI takes that skip: on CI
  # the ownership predicate is covered by static text assertions only, and this lane is real execution
  # coverage only on the Windows workstation where the season proofs actually run.
  if (-not ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows)) {
    $script:windowsExecutionLaneOutcome = 'skipped'
    Write-Output 'Foundation Windows execution lane: SKIPPED (Windows-only cmdlets; no credit claimed)'
    return
  }
  # This one file chains the forced-timeout cleanup regression and the governed-port preflight
  # regression, so a single lane reaches all three.
  $wiring = Join-Path $PSScriptRoot 'maple-july-db-clock-wiring.regression.ps1'
  try {
    # No 2>&1 here, and that is the whole point of this line. `npm run verify:foundation` runs under
    # Windows PowerShell 5.1, where merging a native command's stderr into the success stream while
    # $ErrorActionPreference is 'Stop' raises a terminating NativeCommandError. Measured on this
    # workstation: with 2>&1 a child that exits 0 after writing one harmless stderr line threw
    # `RemoteException :: npm WARN ...` and captured zero lines, so a PASSING run turned the whole
    # foundation gate red with an unrelated message - and a genuinely failing child relayed nothing at
    # all, which is less than the bare lane name the relay below exists to improve on. The chain runs
    # `npx tsx`, so one npm notice was enough to trigger it. Without the redirect all three shapes
    # behave: stdout is captured, the exit code survives, and stderr passes through to the operator's
    # console where they can still read it.
    #
    # State the cost plainly, because it is real: stderr is NOT in $script:windowsExecutionOutput, so it
    # is neither relayed by the finally below nor passed through Get-FoundationRedactedLine. A child
    # that writes a machine path to stderr writes it to the console unredacted. Redirecting to a file
    # instead of the success stream does not avoid this - measured on this workstation under 5.1, a
    # child exiting 0 after one stderr line threw `RemoteException :: <the line>` with `2> $file` just
    # as it did with 2>&1, because the trap is the error stream, not the destination. Capturing both
    # streams needs ProcessStartInfo with separate readers, which is a rewrite of this line rather than
    # a flag, and this line is the one the whole lane depends on.
    Invoke-FoundationLane { $script:windowsExecutionOutput = @(& (Get-FoundationProbeShell) -NoProfile -ExecutionPolicy Bypass -File $wiring) } 'Windows season execution regressions failed.'
  } finally {
    # Relay the child's output either way. Invoke-FoundationLane throws on a non-zero exit, so without
    # the finally a failure would report the lane name and discard the only lines saying what broke.
    # Redact the profile and temp directories first, the same two the wiring regression's own redactor
    # removes and for the same reason: this text lands in a gate log, and the child's diagnostics name
    # paths built from [IO.Path]::GetTempPath(), which follows %TEMP% and is not always inside the
    # profile.
    $script:windowsExecutionOutput | ForEach-Object { Write-Output (Get-FoundationRedactedLine $_) }
  }
  # Require the chain's own completion marker, not just exit 0. A child that dies before its last line,
  # or that is replaced by something which exits cleanly without running anything, satisfies an
  # exit-code check while proving nothing. Exact case-sensitive element match, not a regex over the
  # joined output: an unanchored -cnotmatch was also satisfied by a line reading
  # MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS_BUT_SKIPPED, and the chain itself compares its own
  # children's markers with -ceq.
  if ($script:windowsExecutionOutput -cnotcontains 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS') {
    throw 'Windows season execution regressions did not print their completion marker.'
  }
  $script:windowsExecutionLaneOutcome = 'executed'
}

function Assert-FoundationWindowsExecutionLaneAccountedFor {
  # This is the one check on the Windows lane that is not a text assertion, and it exists because
  # every text assertion over the lane can be defeated by an edit that leaves the words in place.
  # Measured against the guard file: commenting out the single call site keeps the identifier count at
  # two and stays green; inserting a bare `return` at the top of the lane stays green; replacing the
  # platform test with something always true stays green. None of those three survive here, because the
  # lane only ever sets this variable by reaching the end of one of its two real branches - and claiming
  # 'skipped' on Windows is a contradiction rather than a platform report.
  #
  # What this check is NOT: a proof that the lane executed. It is a consistency test between two
  # variables, and an edit that writes both of them honestly-looking values defeats it. Measured: a
  # forgery inserted at the top of this very function, which detects that it is being driven by the
  # probe below (the probe's loop variable is visible in the caller's scope), reproduces each expected
  # message, and then returns silently for the real call - that defeat passed both this function and a
  # rejection-only probe end to end. The probe now carries a positive control for that reason, and
  # scripts/foundation-windows-lane-runtime-drill.mjs re-runs this accounting out of process, where no
  # probe scope exists to detect. Those raise the cost of a forgery; they do not make it impossible.
  # Only executing the lane on a runner that does not take the Windows skip does that.
  if ($null -eq $script:windowsExecutionLaneOutcome) {
    throw 'Foundation Windows execution lane never ran; its outcome was never recorded.'
  }
  if ($script:windowsExecutionLaneOutcome -cne 'executed' -and $script:windowsExecutionLaneOutcome -cne 'skipped') {
    throw "Foundation Windows execution lane recorded an unknown outcome: $script:windowsExecutionLaneOutcome."
  }
  $onWindows = ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows)
  if ($onWindows -and $script:windowsExecutionLaneOutcome -cne 'executed') {
    throw 'Foundation Windows execution lane skipped itself on Windows, where it is required to execute.'
  }
  # 'executed' has to be corroborated, not merely claimed. Rejecting the unset, unknown, and
  # skipped-on-Windows outcomes above closes the branches that can be reached by deleting work, but not
  # the one that can be reached by asserting success: assigning this variable at the top of the lane and
  # returning leaves every pinned line present, runs nothing, and would satisfy all three. So the two
  # variables are compared against each other - a claim of execution must be backed by the chain's own
  # marker sitting in the output this run captured, which only the real child writes.
  if ($script:windowsExecutionLaneOutcome -ceq 'executed' -and $script:windowsExecutionOutput -cnotcontains 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS') {
    throw 'Foundation Windows execution lane reported an execution it cannot evidence; the chain completion marker is absent from the output it captured.'
  }
  Write-Output "Foundation Windows execution lane outcome: $script:windowsExecutionLaneOutcome (on Windows: $onWindows)"
}

function Assert-FoundationWindowsExecutionLaneAccountingIsFatal {
  # Same reasoning as Assert-IntermediateLaneFailureIsFatal above: a detector nobody has watched fail is
  # not a detector. This one earns the probe more than most, because it is the only check over the
  # Windows lane that is not a text assertion, and the hole it exists to cover cannot be text-checked -
  # a bare `return` inserted at the top of the lane leaves every pinned word in place and keeps
  # scripts/foundation-static-guards.mjs green. Measured with that exact mutation: the lane returned
  # silently and this accounting threw 'never ran; its outcome was never recorded'.
  #
  # It runs here, before the lane, so the outcome variable is genuinely unset rather than being reset
  # from a real answer, and every case restores what it found so this probe can never decide the real
  # check's verdict later in the run.
  $saved = $script:windowsExecutionLaneOutcome
  $savedOutput = $script:windowsExecutionOutput
  try {
    $marker = 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS'
    $cases = @(
      @{ Outcome = $null; Output = @(); Expected = 'Foundation Windows execution lane never ran; its outcome was never recorded.'; Label = '<unset>' },
      @{ Outcome = 'ran'; Output = @(); Expected = 'Foundation Windows execution lane recorded an unknown outcome: ran.'; Label = 'ran' },
      # The unevidenced-success case. Deliberately driven with an empty captured output, which is exactly
      # the state a lane leaves behind when it claims 'executed' without running its child.
      @{ Outcome = 'executed'; Output = @(); Expected = 'Foundation Windows execution lane reported an execution it cannot evidence; the chain completion marker is absent from the output it captured.'; Label = 'executed without evidence' },
      # The positive control, and it is not symmetry for its own sake. A rejection-only probe is
      # satisfied by an accounting function that throws unconditionally, so it cannot tell a working
      # detector apart from a broken one. Measured: a forgery that detects this probe by reading the
      # caller's scope, throws each expected message back, and returns silently for the real call passed
      # a rejection-only probe end to end. Requiring one evidenced execution to be ACCEPTED means a
      # throw-always accounting fails here instead of being credited.
      @{ Outcome = 'executed'; Output = @('a preceding line', $marker); Expected = $null; Label = 'executed with evidence' }
    )
    if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) {
      # Only a contradiction on Windows. On the ubuntu CI runner 'skipped' is the honest answer, and
      # asserting a throw there would fail the gate for telling the truth.
      $cases += @{ Outcome = 'skipped'; Output = @(); Expected = 'Foundation Windows execution lane skipped itself on Windows, where it is required to execute.'; Label = 'skipped' }
    }
    foreach ($case in $cases) {
      $script:windowsExecutionLaneOutcome = $case.Outcome
      $script:windowsExecutionOutput = @($case.Output)
      $failure = $null
      try {
        Assert-FoundationWindowsExecutionLaneAccountedFor | Out-Null
      } catch {
        $failure = $_.Exception.Message
      }
      if ($null -eq $case.Expected) {
        if ($null -ne $failure) { throw "Foundation Windows execution lane accounting rejected an evidenced execution [$($case.Label)]: $failure" }
        continue
      }
      if ($null -eq $failure) { throw "Foundation Windows execution lane accounting accepted an outcome of [$($case.Label)]." }
      # A rejection with the wrong message is its own defect, and reporting it as an acceptance would
      # send the next reader looking for the wrong thing.
      if ($failure -ne $case.Expected) { throw "Foundation Windows execution lane accounting rejected [$($case.Label)] with an unexpected message: $failure" }
    }
  } finally {
    $script:windowsExecutionLaneOutcome = $saved
    $script:windowsExecutionOutput = $savedOutput
  }
  $rejectedCount = @($cases | Where-Object { $null -ne $_.Expected }).Count
  Write-Output "Foundation Windows execution lane accounting probe: PASS ($rejectedCount rejected, $($cases.Count - $rejectedCount) accepted)"
}

function Get-FoundationRedactedLine {
  param($Line)
  $text = [string]$Line
  foreach ($machinePath in @([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile), [IO.Path]::GetTempPath())) {
    if ([string]::IsNullOrEmpty($machinePath)) { continue }
    $needle = $machinePath.TrimEnd('\', '/')
    if ([string]::IsNullOrEmpty($needle)) { continue }
    # Match both separator spellings and ignore case. .Replace() did neither, and both gaps let a real
    # machine path through into a gate log: Node and npm diagnostics write some paths with forward
    # slashes, and a drive letter or directory that differs in case from what GetFolderPath returns
    # names the same directory on Windows. The text itself is left alone rather than normalized, so a
    # URL in a child's message keeps its own slashes.
    #
    # Deliberately unbounded on the right: this replaces the prefix wherever it appears, so a sibling
    # directory such as <profile>ry is rewritten too. Over-redaction costs readability; a missed
    # spelling writes a real path into season evidence, which is the error that matters here.
    foreach ($spelling in @($needle, $needle.Replace('\', '/'))) {
      $text = [Regex]::Replace($text, [Regex]::Escape($spelling), '<redacted-path>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
  }
  return $text
}

Push-Location $root
try {
  Assert-IntermediateLaneFailureIsFatal
  Assert-FoundationWindowsExecutionLaneAccountingIsFatal
  Invoke-FoundationLane { & npx tsc -b --force } 'Forced TypeScript failed.'
  Invoke-FoundationLane { & npm run regression } 'Fast regression suite failed.'
  Invoke-FoundationLane { & npm run build } 'Production build failed.'
  Invoke-FoundationLane { & npm audit --audit-level=high } 'Dependency audit failed.'
  Invoke-FoundationLane { & node scripts/foundation-static-guards.mjs } 'Foundation static guard failed.'
  Invoke-FoundationLane { & node scripts/verify-foundation-mutations.mjs } 'Foundation mutation drill failed.'
  # Behavioral, not textual, and out of process. The two lanes above assert that lines exist and that
  # deleting one turns a named guard red; this one runs the Windows lane's accounting for real against
  # mutated copies of this file's own functions. It is the only lane over the Windows lane that also
  # executes on the ubuntu CI runner, because it never starts the Windows-only regression chain.
  Invoke-FoundationLane { & node scripts/foundation-windows-lane-runtime-drill.mjs } 'Foundation Windows lane runtime drill failed.'
  # The season contract gate was reachable only when an operator typed `npm run verify:season` by
  # hand - no workflow and no hook ran it - so the structural guards it holds, including the
  # governed-port preflight checks, could regress without anything failing. Both are pure node with
  # no platform dependencies, so they run on the ubuntu foundation job as well as here.
  Invoke-FoundationLane { & node scripts/verify-season-contract.mjs } 'Season contract gate failed.'
  Invoke-FoundationLane { & node scripts/verify-season-contract.regression.mjs } 'Season contract mutation drill failed.'
  Invoke-FoundationWindowsExecutionLane
  Assert-FoundationWindowsExecutionLaneAccountedFor
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0033-disposable.ps1') } 'Disposable 0033 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0034-disposable.ps1') } 'Disposable 0034 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0035-disposable.ps1') } 'Disposable 0035 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0036-disposable.ps1') } 'Disposable 0036 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0037-disposable.ps1') } 'Disposable 0037 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0039-disposable.ps1') } 'Disposable 0039 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0040-disposable.ps1') } 'Disposable 0040 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0041-disposable.ps1') } 'Disposable 0041 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0042-disposable.ps1') } 'Disposable 0042 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0043-disposable.ps1') } 'Disposable 0043 proof failed.'
  Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-rls-role-matrix.ps1') } 'Disposable RLS role matrix failed.'
  Invoke-FoundationLane { & npm run test:e2e } 'Built-browser foundation suite failed.'
  Write-Output 'Farm Rx foundation gate: PASS'
} finally {
  Pop-Location
}
