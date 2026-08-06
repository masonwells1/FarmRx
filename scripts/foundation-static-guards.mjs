import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const read = (root, path) => readFileSync(resolve(root, path), 'utf8')
const requireText = (errors, source, text, label) => { if (!source.includes(text)) errors.push(label) }
// requireText is a substring test, so it is satisfied by the same words appearing inside a comment or
// a commented-out statement. Use requireMatch where the pin has to be a live statement rather than
// merely present text.
const requireMatch = (errors, source, pattern, label) => { if (!pattern.test(source)) errors.push(label) }

export function foundationStaticGuard(root = process.cwd()) {
  const errors = []
  const app = read(root, 'src/App.tsx')
  const expectedRoutes = ['/fields', '/fields/new', '/fields/:id', '/fields/:id/edit', '/grain/*', '/inventory', '/profitability/*', '/equipment', '/tasks', '/weather', '/field-log', '/scouting', '/harvest', '/programs', '/notifications', '/privacy', '*', '/login', '/update-password', '/*']
  const actualRoutes = [...app.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/g)].map((match) => match[1])
  if (actualRoutes.length !== expectedRoutes.length || actualRoutes.some((route, index) => route !== expectedRoutes[index])) errors.push('routes:exact-ordered-manifest')
  requireText(errors, app, 'mobilePrimaryPaths = new Set(["/fields", "/grain", "/tasks", "/weather"])', 'mobile:primary-destinations')
  requireText(errors, app, 'mobileMoreNavigation', 'mobile:more-destinations')
  if (!/<FarmAccessGateForUser\b[^>]*\bkey=\{user\.id\}[^>]*\buser=\{user\}[^>]*>/.test(app)) errors.push('identity:keyed-farm-access-gate')
  requireText(errors, app, 'access?.userId !== user.id', 'identity:farm-access-render-fence')

  const unscopedWriteFencing = read(root, 'supabase/migrations/20260716122229_0041_unscoped_authenticated_write_fencing.sql')
  if ((unscopedWriteFencing.match(/perform public\.assert_current_farm_access_epoch\(p_farm_id\);/g) ?? []).length !== 3) errors.push('rpc:unscoped-write-fences')
  requireText(errors, unscopedWriteFencing, 'revoke all on function public.save_push_subscription(text, text, text, text)', 'rpc:legacy-push-save-retired')
  requireText(errors, unscopedWriteFencing, 'revoke all on function public.delete_push_subscription(text)', 'rpc:legacy-push-delete-retired')
  requireText(errors, unscopedWriteFencing, 'where push_subscriptions.user_id = v_caller', 'rpc:push-endpoint-owner-fence')
  requireText(errors, unscopedWriteFencing, "message = 'PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_USER'", 'rpc:push-endpoint-owner-conflict')
  requireText(errors, unscopedWriteFencing, 'revoke insert, update, delete on table public.push_subscriptions from public, anon, authenticated;', 'table:push-direct-write-revoked')
  for (const operation of ['insert', 'update', 'delete']) requireText(errors, unscopedWriteFencing, `drop policy if exists push_subscriptions_${operation} on public.push_subscriptions;`, `table:push-${operation}-policy-removed`)
  if (/set\s+user_id\s*=\s*excluded\.user_id/i.test(unscopedWriteFencing)) errors.push('rpc:push-endpoint-owner-transfer')
  const notificationsGateway = read(root, 'src/data/SupabaseNotificationsDataGateway.ts')
  if ((notificationsGateway.match(/p_farm_id: context\.farmId/g) ?? []).length !== 2) errors.push('rpc:push-farm-context-forwarding')

  const foundationOrchestrator = read(root, 'scripts/verify-foundation.ps1')
  requireText(errors, foundationOrchestrator, 'if ($LASTEXITCODE -ne 0) { throw $Failure }', 'orchestrator:native-exit-check')
  requireText(errors, foundationOrchestrator, 'Assert-IntermediateLaneFailureIsFatal', 'orchestrator:controlled-failure-probe')
  requireText(errors, foundationOrchestrator, "return (Join-Path $PSHOME 'powershell.exe')", 'orchestrator:desktop-probe-shell')
  requireText(errors, foundationOrchestrator, "return (Join-Path $PSHOME 'pwsh.exe')", 'orchestrator:windows-core-probe-shell')
  requireText(errors, foundationOrchestrator, "return (Join-Path $PSHOME 'pwsh')", 'orchestrator:unix-core-probe-shell')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & $probeShell -NoProfile -Command 'exit 23' } $expected", 'orchestrator:resolved-probe-shell')
  // What this count actually counts: statements beginning with `Invoke-FoundationLane`. That is 24 -
  // one intermediate-failure probe, twenty-two in the orchestration body, and one nested inside
  // Invoke-FoundationWindowsExecutionLane. It does NOT count the Windows lane's own call site, because
  // this pattern requires whitespace immediately after `Invoke-FoundationLane` and
  // `Invoke-FoundationWindowsExecutionLane` continues with a letter. So the earlier rise from 21 to 22
  // came from the nested call, not from a new top-level lane, 22 to 23 is the runtime drill lane, and
  // 23 to 24 is the season browser ownership regression lane; the Windows lane is pinned separately.
  // The label says invoke-lane-statements rather than all-lanes-checked for that reason - the old
  // label implied this one number covered every lane in the file, which it does not.
  if ((foundationOrchestrator.match(/^\s*Invoke-FoundationLane\s/gm) ?? []).length !== 24) errors.push('orchestrator:invoke-lane-statements')
  // Pin both season lanes by name. The count above only proves nobody added a lane without
  // updating this guard; it does not prove these two specific lanes survived, and they are the only
  // thing making the season contract gate reachable from an automated gate rather than by hand.
  requireText(errors, foundationOrchestrator, 'Invoke-FoundationLane { & node scripts/verify-season-contract.mjs }', 'orchestrator:checked-season-contract')
  requireText(errors, foundationOrchestrator, 'Invoke-FoundationLane { & node scripts/verify-season-contract.regression.mjs }', 'orchestrator:checked-season-contract-regression')
  // Pin the Windows execution lane. An earlier version of this block counted occurrences of the lane
  // name and required exactly two, on the theory that this catches the call being deleted while the
  // function stays behind. It does not: commenting the call out - one character - leaves the identifier
  // in place, keeps the count at two, and stays green while the lane never runs. The call is therefore
  // matched as a whole uncommented statement on its own line. Four more edits defeated the old block
  // the same way, by leaving the pinned words present: replacing the platform test with something
  // always true, inserting a bare `return`, deleting the marker check while its literal survived in a
  // comment, and swapping the child invocation for one that echoes the marker itself. The first three
  // are caught at RUNTIME by Assert-FoundationWindowsExecutionLaneAccountedFor, pinned below; the last
  // is caught by pinning the invocation line whole.
  //
  // State the limit of everything in this block honestly, because an adversarial review read more into
  // it than it earns. These are narrow text tripwires. Every one of them can be satisfied by an edit
  // that leaves the pinned line intact and unreachable - the general form is to put the exact line on a
  // branch that never runs, or to insert a `return` above it. Whole-line matching raises the bar over a
  // substring test and nothing more: it proves text occupies a line, never that control reaches it.
  // The behavioral coverage lives in three other places, and the pins here only keep those reachable:
  // Assert-FoundationWindowsExecutionLaneAccountedFor, which cross-checks the lane's claim against the
  // child's own marker; scripts/foundation-windows-lane-runtime-drill.mjs, which re-runs that accounting
  // out of process against mutated copies of the orchestrator; and the completion-marker assertion in
  // .github/workflows/foundation.yml, which sits outside the script and so cannot be skipped by a
  // top-level `return` inside it. Even together those do not prove the lane ran on any given run: on
  // this Linux CI job the lane reports a skip and the ownership predicate goes unexecuted, so real
  // execution credit for the predicate exists only on a Windows run.
  requireMatch(errors, foundationOrchestrator, /^ {2}Invoke-FoundationWindowsExecutionLane$/m, 'orchestrator:windows-execution-lane-called')
  requireMatch(errors, foundationOrchestrator, /^ {2}Assert-FoundationWindowsExecutionLaneAccountedFor$/m, 'orchestrator:windows-execution-lane-accounted-for-called')
  // The runtime check carries the coverage text cannot, which makes it the one thing here that must not
  // be allowed to rot into a no-op nobody has seen fail. Its own probe runs before the lane and asserts
  // each rejection branch actually throws, exactly as Assert-IntermediateLaneFailureIsFatal does for the
  // lane wrapper. Pin the probe's call site too, or the runtime check is trusted rather than tested.
  requireMatch(errors, foundationOrchestrator, /^ {2}Assert-FoundationWindowsExecutionLaneAccountingIsFatal$/m, 'orchestrator:windows-execution-lane-accounting-probe-called')
  requireText(errors, foundationOrchestrator, "throw \"Foundation Windows execution lane accounting accepted an outcome of [$($case.Label)].\"", 'orchestrator:windows-execution-lane-accounting-probe-asserts')
  requireText(errors, foundationOrchestrator, "if (-not ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows)) {", 'orchestrator:windows-execution-lane-platform-gate')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { $script:windowsExecutionOutput = @(& (Get-FoundationProbeShell) -NoProfile -ExecutionPolicy Bypass -File $wiring) } 'Windows season execution regressions failed.'", 'orchestrator:windows-execution-lane-invocation')
  requireText(errors, foundationOrchestrator, "Join-Path $PSScriptRoot 'maple-july-db-clock-wiring.regression.ps1'", 'orchestrator:windows-execution-lane-chain')
  requireText(errors, foundationOrchestrator, "if ($script:windowsExecutionOutput -cnotcontains 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS') {", 'orchestrator:windows-execution-lane-marker')
  requireText(errors, foundationOrchestrator, 'SKIPPED (Windows-only cmdlets; no credit claimed)', 'orchestrator:windows-execution-lane-honest-skip')
  requireText(errors, foundationOrchestrator, "if ($onWindows -and $script:windowsExecutionLaneOutcome -cne 'executed') {", 'orchestrator:windows-execution-lane-windows-must-execute')
  // Rejecting the unset, unknown, and skipped-on-Windows outcomes closes the branches reachable by
  // deleting work. The remaining branch is reachable by ASSERTING success: assign the outcome at the top
  // of the lane and return, and every line pinned above is still present while nothing runs. The
  // accounting therefore requires a claim of execution to be corroborated by the chain's own marker in
  // the output that run captured, so faking the outcome now also means faking the child's output.
  requireText(errors, foundationOrchestrator, "if ($script:windowsExecutionLaneOutcome -ceq 'executed' -and $script:windowsExecutionOutput -cnotcontains 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS') {", 'orchestrator:windows-execution-lane-evidenced-execution')
  // The redirect that must NOT come back. Under Windows PowerShell 5.1, merging a native command's
  // stderr into the success stream while $ErrorActionPreference is 'Stop' raises a terminating
  // NativeCommandError, so a child that exits 0 after one npm notice reddened the whole gate and a
  // failing child relayed nothing. The chain runs `npx tsx`, which makes that reachable.
  if (/-File \$wiring 2>&1/.test(foundationOrchestrator)) errors.push('orchestrator:windows-execution-lane-no-stderr-merge')
  // The probe's positive control. A rejection-only probe is satisfied by an accounting function that
  // throws unconditionally, and that is not hypothetical: a review demonstrated a forged accounting
  // which recognizes the probe by reading its loop variable out of the caller's scope, throws each
  // expected message back, and returns silently for the real call. Measured, that defeat passed a
  // rejection-only probe end to end. Requiring one evidenced execution to be ACCEPTED is what turns it
  // red, so the accept case is pinned as tightly as the reject cases.
  requireText(errors, foundationOrchestrator, "@{ Outcome = 'executed'; Output = @('a preceding line', $marker); Expected = $null; Label = 'executed with evidence' }", 'orchestrator:windows-execution-lane-accounting-probe-positive-control')
  requireText(errors, foundationOrchestrator, 'throw "Foundation Windows execution lane accounting rejected an evidenced execution [$($case.Label)]: $failure"', 'orchestrator:windows-execution-lane-accounting-probe-accept-asserts')
  // The out-of-process behavioral drill, and its lane. Everything else in this block is text; this is
  // the only guard over the Windows lane that runs the accounting for real, and the only one that does
  // so on the ubuntu CI runner.
  requireMatch(errors, foundationOrchestrator, /^ {2}Invoke-FoundationLane \{ & node scripts\/foundation-windows-lane-runtime-drill\.mjs \} 'Foundation Windows lane runtime drill failed\.'$/m, 'orchestrator:windows-lane-runtime-drill-lane')
  const windowsLaneRuntimeDrill = read(root, 'scripts/foundation-windows-lane-runtime-drill.mjs')
  // Pin the two cases that carry the coverage, by the assertion each one makes rather than by name. The
  // first is the case a forged accounting cannot survive, because out of process there is no probe frame
  // for it to detect. The second is this drill's own positive control - without it, an accounting that
  // threw on everything would pass every other case and the drill would report success for a detector
  // that no longer works.
  requireText(errors, windowsLaneRuntimeDrill, "label: 'lane call removed entirely'", 'runtime-drill:lane-call-removed-case')
  requireText(errors, windowsLaneRuntimeDrill, "label: 'accounting forged to recognize its own probe'", 'runtime-drill:probe-forgery-case')
  requireText(errors, windowsLaneRuntimeDrill, "label: 'an evidenced execution is accepted'", 'runtime-drill:positive-control-case')
  requireText(errors, windowsLaneRuntimeDrill, 'if (anchorIndex < 0) throw new Error(', 'runtime-drill:slice-anchor-fails-closed')

  // The completion marker, asserted from outside the script that prints it. Every guard above reads
  // scripts/verify-foundation.ps1 as text, so a top-level `return` inserted above its lanes keeps all of
  // them present, runs nothing, and exits 0 - and this assertion does NOT catch that. The earlier claim
  // here, that the final line is the one thing such an edit cannot keep, is withdrawn: measured, an edit
  // reading `Write-Output ('Farm Rx foundation gate: ' + 'PASS'); return` prints the marker having run
  // nothing, and no assertion over a log the script itself writes can tell the two apart. What this pair
  // does catch is a truncated or crashed run that still exits 0. The forgery class is closed instead by
  // the three independent workflow steps pinned below, which the orchestrator does not invoke.
  const foundationWorkflow = read(root, '.github/workflows/foundation.yml')
  requireText(errors, foundationWorkflow, "Select-String -LiteralPath foundation-gate.log -SimpleMatch -CaseSensitive -Pattern 'Farm Rx foundation gate: PASS' -Quiet", 'workflow:foundation-completion-marker-asserted')
  requireText(errors, foundationWorkflow, "throw 'Foundation gate did not print its completion marker.'", 'workflow:foundation-completion-marker-fatal')
  // The three gates the workflow must run ITSELF. Invoked from the orchestrator alone, all three are
  // suppressible by an orchestrator that returns before reaching them while still printing the final
  // marker - which a log-substring assertion cannot distinguish from a real run.
  requireText(errors, foundationWorkflow, 'run: node scripts/foundation-static-guards.mjs', 'workflow:static-guards-run-independently')
  requireText(errors, foundationWorkflow, 'run: node scripts/verify-foundation-mutations.mjs', 'workflow:mutation-drill-run-independently')
  requireText(errors, foundationWorkflow, 'run: node scripts/foundation-windows-lane-runtime-drill.mjs', 'workflow:runtime-drill-run-independently')
  requireText(errors, foundationOrchestrator, "Write-Output 'Farm Rx foundation gate: PASS'", 'orchestrator:completion-marker')

  // The kill-authorizing predicate. This is the sole gate on the Stop-Process -Force in
  // Clear-MapleSeasonBrowserPort, so a false TRUE terminates a process Farm Rx does not own. Matching
  // the root text does not establish that the listener's path stays inside the tree that root names:
  // measured, root C:\FarmRx against `node.exe "C:\FarmRx\..\Other\scripts\factory-board.mjs"` answered
  // True. The traversal refusal is pinned here and executed by
  // scripts/maple-season-browser-port-preflight.regression.ps1.
  const seasonBrowser = read(root, 'scripts/maple-season-browser.ps1')
  // The predicate now compares whole ARGUMENTS, parsed by Windows' own rules, instead of searching the raw
  // command line for the root text and then classifying the boundary by hand. That hand classification
  // produced a different false-TRUE in each of three consecutive reviews, so the pins below hold the
  // tokenizer's load-bearing rules rather than any one boundary test.
  requireText(errors, seasonBrowser, 'foreach ($argument in (Split-MapleSeasonCommandLineArgument -CommandLine $commandLine)) {', 'season-browser:ownership-compares-whole-arguments')
  // Windows splits on ASCII space and tab ONLY. [char]::IsWhiteSpace also accepts NBSP, which is legal in
  // a file name, so treating it as a separator made the sibling C:\FarmRx<NBSP>Backup look like our root
  // followed by a boundary. Measured True before this rule was ASCII-only. The rule is defined ONCE and
  // used by both of the tokenizer's loops: written twice, the two copies drifted, and a parse that stopped
  // at a character the separator skip would not consume spun forever instead of answering. The stall
  // guard is the second half of that repair - and it THROWS rather than returning what it has. Breaking out
  // with a truncated argument list was measured to be a false-TRUE of its own: on the sibling line the
  // drifted parse yields `node.exe`, `C:\FarmRx`, ``, and the bare exact root IS a containment match, so
  // the truncation authorized killing the sibling's listener. Refusing to answer is the only safe answer.
  requireText(errors, seasonBrowser, "return ($Character -eq ' ' -or $Character -eq \"`t\")", 'season-browser:tokenizer-splits-on-ascii-space-and-tab-only')
  requireText(errors, seasonBrowser, 'if ((-not $inQuotes) -and (Test-MapleSeasonCommandLineSeparator -Character $character)) { break }', 'season-browser:tokenizer-breaks-argument-at-shared-separator')
  requireText(errors, seasonBrowser, 'while ($index -lt $length -and (Test-MapleSeasonCommandLineSeparator -Character $CommandLine[$index])) { $index++ }', 'season-browser:tokenizer-skips-shared-separator')
  requireText(errors, seasonBrowser, 'throw "Split-MapleSeasonCommandLineArgument made no progress at index $index', 'season-browser:tokenizer-refuses-stalled-parse')
  // 2n backslashes then a quote: n backslashes, quote is a delimiter. 2n+1: n backslashes and a LITERAL
  // quote. Without this rule `--label "C:\FarmRx\safe\" --port 4177"` counted the escaped quote as a
  // closing delimiter and the predicate answered True for a listener running out of C:\Other. Measured.
  requireText(errors, seasonBrowser, "[void]$builder.Append('\\', [int][Math]::Floor($backslashes / 2))", 'season-browser:tokenizer-halves-escaped-backslash-run')
  requireText(errors, seasonBrowser, "if (($backslashes % 2) -eq 1) { [void]$builder.Append('\"'); $index++ }", 'season-browser:tokenizer-treats-odd-run-quote-as-literal')
  // CommandLineToArgvW's doubled-quote quirk, which the C runtime does NOT share: inside a quoted
  // argument '""' yields one literal quote and LEAVES quoted mode. Measured against the real API.
  requireText(errors, seasonBrowser, "if ($inQuotes -and ($index + 1) -lt $length -and $CommandLine[$index + 1] -eq '\"') {", 'season-browser:tokenizer-handles-doubled-quote')
  // Win32 strips trailing dots and spaces per component. The trim must take dots, spaces and tabs as ONE
  // set: chaining .TrimEnd(' ',tab) then .TrimEnd('.') is order-dependent and left '.. .' with a length of
  // three, so the component walk accepted it and the predicate claimed the parent directory. Measured.
  requireText(errors, seasonBrowser, "return $Component.TrimEnd(' ', \"`t\", '.').Length -ne 0", 'season-browser:ownership-refuses-traversal')
  requireText(errors, seasonBrowser, 'if (-not (Test-MapleSeasonPathComponentIsRealName -Component $component)) { return $false }', 'season-browser:ownership-walks-tail-components')
  requireText(errors, seasonBrowser, 'if (-not (Test-MapleSeasonPathComponentIsRealName -Component $segment)) { return $false }', 'season-browser:ownership-walks-root-components')
  // Windows has TWO argument grammars and they disagree on exactly one construct. CommandLineToArgvW - what
  // the tokenizer above reproduces - splits `"C:\Other"" C:\FarmRx\safe"` into `C:\Other"` and
  // `C:\FarmRx\safe`, so half a label reads as a path in our tree; node.exe is parsed by the Microsoft C
  // runtime, where the same label stays one argument naming nothing of ours. Both readings are defensible,
  // and guessing wrong authorizes a kill, so a doubled quote is refused rather than parsed. Measured.
  requireText(errors, seasonBrowser, "if ($commandLine.Contains('\"\"')) { return $false }", 'season-browser:ownership-refuses-ambiguous-grammar')
  // Containment is decided by the PLATFORM's path resolver, not by a hand-written walk over the text. The
  // walk this replaced refused `\\?\C:\FarmRx\x.js`, `C:\FarmRx\.\x.js` and `C:\FarmRx\sub\..\x.js`, all of
  // which ARE inside the tree - each would have declared our own listener foreign - and it ACCEPTED
  // `C:\FarmRx\NUL` and `C:\FarmRx\file:stream`, which name a device and a stream. All five measured.
  requireText(errors, seasonBrowser, 'try { $resolved = [System.IO.Path]::GetFullPath($candidate) } catch { return $false }', 'season-browser:ownership-resolves-with-the-platform')
  requireText(errors, seasonBrowser, "if ($candidate.StartsWith('\\\\?\\', [StringComparison]::Ordinal)) { $candidate = $candidate.Substring(4) }", 'season-browser:ownership-strips-extended-length-prefix')
  // An argument carrying a character Win32 forbids in a path is not a path at all. This is what refuses
  // the escaped-quote defeat, whose argument `C:\FarmRx\safe" --port 4177` starts with our root at a real
  // separator yet cannot name a file.
  requireText(errors, seasonBrowser, "if ($candidate.IndexOfAny([char[]]@('\"', '<', '>', '|', '*', '?')) -ge 0) { return $false }", 'season-browser:ownership-refuses-non-path-characters')
  requireText(errors, seasonBrowser, 'if ([char]::IsControl($character)) { return $false }', 'season-browser:ownership-refuses-control-characters')
  // A colon past the drive letter names an alternate data stream, and a reserved device name is a device
  // rather than a file. Both are checked explicitly instead of being left to the resolver, so the answer
  // cannot change under a shell built on a different .NET.
  requireText(errors, seasonBrowser, "if ($candidate.IndexOf(':', 2) -ge 0) { return $false }", 'season-browser:ownership-refuses-alternate-data-stream')
  requireText(errors, seasonBrowser, "if ($bareName -match '(?i)^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$') { return $false }", 'season-browser:ownership-refuses-reserved-device-name')
  // Resolve only ABSOLUTE spellings. GetFullPath resolves a relative or drive-relative path against
  // process state - the current directory, or the current directory of a drive - and no part of a kill
  // authorization may depend on where the shell happens to be standing.
  requireText(errors, seasonBrowser, "if (-not (($candidate -match '^[A-Za-z]:\\\\') -or ($candidate -match '^\\\\\\\\[^\\\\?.]'))) { return $false }", 'season-browser:ownership-refuses-shell-relative-path')
  // The root must end at a real separator inside the argument, or be the whole argument. Without this,
  // root C:\FarmRx claimed a listener running out of C:\FarmRx2.
  requireText(errors, seasonBrowser, "if ($tail.Length -gt 0 -and $tail[0] -ne '\\') { return $false }", 'season-browser:ownership-requires-separator-boundary')
  // The tokenizer's rules are checked against the real parser, not against my reading of the docs.
  const seasonBrowserRegression = read(root, 'scripts/maple-season-browser-port-preflight.regression.ps1')
  requireText(errors, seasonBrowserRegression, 'CommandLineToArgvW', 'season-browser-regression:tokenizer-compared-to-win32')
  requireText(errors, seasonBrowserRegression, 'disagreed with CommandLineToArgvW', 'season-browser-regression:tokenizer-disagreement-is-fatal')
  // A tokenizer that HANGS is worse than one that answers wrongly, because every caller is built to
  // survive a false and none survives a hang. The drill re-introduces the separator drift on a copy of
  // the function and requires the drifted parse to REFUSE - not merely to finish. Finishing was the
  // earlier, weaker requirement, and it would now pass on the truncated argument list that was itself a
  // false-TRUE. Three things have to hold or the drill proves nothing: it must be bounded in time, the
  // job must actually reach Completed, and the value it returns must be the refusal.
  requireText(errors, seasonBrowserRegression, 'Wait-Job $stallJob -Timeout 30', 'season-browser-regression:stall-drill-is-bounded')
  requireText(errors, seasonBrowserRegression, '[char]::IsWhiteSpace($character)', 'season-browser-regression:stall-drill-reintroduces-drift')
  requireText(errors, seasonBrowserRegression, 'made the command-line parse stall', 'season-browser-regression:stall-is-fatal')
  requireText(errors, seasonBrowserRegression, 'its needle is stale and the drill would prove nothing', 'season-browser-regression:stall-drill-refuses-stale-needle')
  // Wait-Job returns a job OBJECT, and a job object is truthy even when its State is Failed or Stopped.
  // Measured: a job whose body was `throw 'copy failed'` came back truthy with State = Failed. Casting the
  // return to [bool] therefore tested nothing, and this drill could have gone green on a job that never
  // ran the tokenizer at all - which is exactly the class of vacuous pass the drill exists to prevent.
  requireText(errors, seasonBrowserRegression, "Assert-True ($stallJob.State -eq 'Completed')", 'season-browser-regression:stall-drill-requires-a-completed-job')
  requireText(errors, seasonBrowserRegression, "$stallOutcome -like 'THREW: Split-MapleSeasonCommandLineArgument made no progress*'", 'season-browser-regression:stall-drill-requires-the-refusal')
  // The empty command line is the ONE place this tokenizer deliberately disagrees with Windows, and the
  // divergence is asserted in both directions rather than omitted from the table. Windows answers an empty
  // command line with the path of the process asking - a fact about the caller, useless as evidence about
  // a listener - so zero arguments is the fail-closed answer.
  requireText(errors, seasonBrowserRegression, "Assert-True ($emptyFromWindows.Count -eq 1)", 'season-browser-regression:empty-divergence-is-asserted')
  requireText(errors, seasonBrowser, '# ONE deliberate divergence from CommandLineToArgvW', 'season-browser:empty-divergence-is-declared')
  // The force kill must go through the object that was validated, and the validated identity must still
  // hold. A process id is not durable: the validated process can exit and Windows can reissue its number.
  requireText(errors, seasonBrowser, '$ownedProcess.Kill()', 'season-browser:cleanup-kills-validated-object')
  requireText(errors, seasonBrowser, 'no longer identifies the listener it validated', 'season-browser:cleanup-rechecks-process-identity')

  // ---------------------------------------------------------------------------------------------------
  // Every pin above this line, and every mutation drilled against them, reads the kill-authorizing
  // predicate as TEXT. Measured on the author's workstation: inserting `return $true` at the top of
  // Test-MapleSeasonBrowserPortOwned - which authorizes killing every listener on the governed port,
  // a foreign one included - left this guard printing PASS and the mutation drill printing PASS with all
  // 85 mutations detected. Not one pinned substring had moved; only the behaviour was gone. Pinning text
  // is a restatement of "the code still works" and it fails the same way the predicate itself kept
  // failing. So the pins below hold something different in kind: they require that a suite which CALLS
  // the predicate exists, that two separate callers run it, and that it proves its own teeth each run.
  const ownershipRegression = read(root, 'scripts/maple-season-browser-ownership.regression.ps1')
  // The suite must gut the predicate in memory and require its own refusal table to reject the gutted
  // copy - an EXACT-count match, so the whole table is proven reachable rather than one case of it. Delete
  // this and the file becomes decoration that cannot distinguish a working predicate from `return $true`.
  requireText(errors, ownershipRegression, "Replace($firstGuard, \"  return `$true`n$firstGuard\")", 'ownership-regression:guts-the-predicate')
  requireText(errors, ownershipRegression, 'Assert-True ($guttedClaims.Count -eq $portableRefusals.Count)', 'ownership-regression:refusals-reject-the-gutted-predicate')
  requireText(errors, ownershipRegression, "function Split-MapleSeasonCommandLineArgumentGutted { param([string]$CommandLine) return @($CommandLine) }", 'ownership-regression:guts-the-tokenizer')
  requireText(errors, ownershipRegression, "Measure-TokenizerDisagreement -FunctionName 'Split-MapleSeasonCommandLineArgumentGutted'", 'ownership-regression:table-rejects-the-gutted-tokenizer')
  // Both gutting needles fail closed. A stale needle would otherwise leave the anti-vacuity check
  // silently testing an unmodified copy, which is the vacuous pass it exists to prevent.
  requireText(errors, ownershipRegression, 'the anti-vacuity check below would prove nothing', 'ownership-regression:gutting-anchor-fails-closed')
  requireText(errors, ownershipRegression, 'the gutting needle is stale and the anti-vacuity check would prove nothing', 'ownership-regression:gutting-needle-fails-closed')
  // It must call the predicate, not read it, and the refusals must be the portable half so the ubuntu job
  // executes them. Gutted, the predicate fails 24 of these cases on Linux - measured.
  requireText(errors, ownershipRegression, "foreach ($claimed in @(Measure-RefusalFailures -FunctionName 'Test-MapleSeasonBrowserPortOwned')) {", 'ownership-regression:calls-the-real-predicate')
  requireText(errors, ownershipRegression, 'if (& $FunctionName -ListenerProcess $case.Listener -Root $case.Root) { $wrong += $case.Label }', 'ownership-regression:refusals-are-executed')
  // Its own slice must be unambiguous, and must actually contain the three functions under test.
  requireText(errors, ownershipRegression, 'declares Clear-MapleSeasonBrowserPort more than once', 'ownership-regression:slice-refuses-ambiguity')
  requireText(errors, ownershipRegression, 'function Test-MapleSeasonBrowserPortOwned', 'ownership-regression:slice-requires-the-predicate')
  // TWO independent callers, for the same reason the three node gates are listed separately in the
  // workflow: the orchestrator can be edited to return before its lane while still printing the final
  // marker, and a workflow step it does not invoke cannot be suppressed that way.
  requireText(errors, foundationWorkflow, './scripts/maple-season-browser-ownership.regression.ps1', 'workflow:ownership-regression-run-independently')
  requireText(errors, foundationWorkflow, "throw 'Season browser ownership regression did not print its completion marker.'", 'workflow:ownership-regression-marker-asserted')
  requireText(errors, foundationOrchestrator, "$script:ownershipOutput = @(& (Get-FoundationProbeShell) -NoProfile -ExecutionPolicy Bypass -File $ownership)", 'orchestrator:ownership-regression-lane')
  requireText(errors, foundationOrchestrator, "if ($script:ownershipOutput -notcontains 'MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS') {", 'orchestrator:ownership-regression-marker-asserted')

  for (const proof of ['0033', '0034', '0035', '0036', '0037', '0039', '0040', '0041', '0042', '0043']) requireText(errors, foundationOrchestrator, `Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-${proof}-disposable.ps1') }`, `orchestrator:checked-${proof}`)
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-rls-role-matrix.ps1') }", 'orchestrator:checked-rls-role-matrix')

  const queues = [
    'src/data/fieldLocation.ts',
    'src/data/QueuedEquipmentTasksRepository.ts',
    'src/data/QueuedFieldLogRepository.ts',
    'src/data/QueuedFieldsRepository.ts',
    'src/data/QueuedGrainRepository.ts',
    'src/data/QueuedHarvestRepository.ts',
    'src/data/QueuedInventoryRepository.ts',
    'src/data/QueuedNotificationsRepository.ts',
    'src/data/QueuedProfitabilityRepository.ts',
    'src/data/QueuedProgramsRepository.ts',
    'src/data/QueuedScoutingRepository.ts',
  ]
  for (const path of queues) {
    const source = read(root, path)
    if (!source.includes("from './queueTransaction'")) errors.push(`queue-import:${path}`)
    if (!source.includes('queueTransaction(')) errors.push(`queue-lock:${path}`)
  }

  const readRepositories = queues.filter((path) => path !== 'src/data/fieldLocation.ts')
  const readGuard = read(root, 'src/data/queuedOperationGuard.ts')
  requireText(errors, readGuard, 'export async function verifyQueuedReadContext(', 'read-context:shared-guard')
  requireText(errors, readGuard, 'await verifyQueuedOperationContext(dependencies, expected, expected)', 'read-context:shared-operation-verification')
  for (const path of readRepositories) {
    const source = read(root, path)
    if (!source.includes('const verifyRead = () => verifyQueuedReadContext')) errors.push(`read-context:${path}`)
    if ((source.match(/await verifyRead\(\)/g) ?? []).length < 4) errors.push(`read-boundaries:${path}`)
  }

  const rls = read(root, 'supabase/migrations/20260711154325_module1_rls.sql')
  const fieldsSelect = rls.slice(rls.indexOf('create policy fields_select'), rls.indexOf('create policy fields_insert'))
  requireText(errors, fieldsSelect, 'public.can_access_farm(farm_id)', 'rls:fields-select-farm-scope')
  requireText(errors, rls, 'alter table public.fields enable row level security;', 'rls:fields-enabled')

  const cache = read(root, 'src/data/workspaceCache.ts')
  requireText(errors, cache, '`${scope.projectRef}:${scope.userId}:${scope.farmId}:${scope.module}`', 'cache:user-farm-module-key')
  requireText(errors, cache, 'row.userId === scope.userId && row.farmId === scope.farmId', 'cache:envelope-scope-validation')
  requireText(errors, cache, 'financialCacheMaxAgeMs = 24 * 60 * 60 * 1_000', 'cache:financial-expiry')
  const serviceWorker = read(root, 'src/sw.ts')
  requireText(errors, serviceWorker, "registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\\/update-password(?:[/?]|$)/] }))", 'service-worker:recovery-network-shell')
  const passwordRecovery = read(root, 'src/auth/passwordRecovery.ts')
  requireText(errors, passwordRecovery, "passwordRecoveryOrigin = 'https://recovery.croprxsolutions.app'", 'auth:worker-free-recovery-origin')
  requireText(errors, passwordRecovery, "canonicalFarmRxOrigin = 'https://farm-rx.vercel.app'", 'auth:canonical-app-origin')
  requireText(errors, passwordRecovery, "new URL(passwordRecoveryRoute, recoveryBase)", 'auth:production-recovery-redirect')
  requireText(errors, passwordRecovery, 'passwordRecoveryHostname = new URL(passwordRecoveryOrigin).hostname', 'auth:recovery-host-derived-from-origin')
  requireText(errors, passwordRecovery, "target.searchParams.set('recoveryComplete', '1')", 'auth:completion-canonical-session-signal')
  requireText(errors, passwordRecovery, 'throw new PasswordRecoveryStorageError()', 'auth:reset-storage-preflight-fails-honestly')
  const passwordRecoverySupport = read(root, 'docs/password-recovery-support.md')
  requireText(errors, passwordRecoverySupport, '`https://recovery.croprxsolutions.app/update-password`', 'auth:runbook-exact-recovery-redirect')
  requireText(errors, passwordRecoverySupport, 'same Vercel project', 'auth:runbook-same-project-boundary')
  requireText(errors, passwordRecoverySupport, 'Only after that deployment and stale-client gate are proven', 'auth:runbook-deploy-before-domain')
  requireText(errors, passwordRecoverySupport, 'If any prior farmer client exists or any\n   known proof client cannot be enumerated and retired, stop and keep recovery unavailable.', 'auth:runbook-stale-client-customer-zero-gate')
  requireText(errors, passwordRecoverySupport, '`https://farm-rx.vercel.app/login`', 'auth:runbook-canonical-return')
  if (/allow the exact redirect\s+`https:\/\/farm-rx\.vercel\.app\/update-password`/.test(passwordRecoverySupport)) errors.push('auth:runbook-stale-main-origin-redirect')
  const provisioning = read(root, 'scripts/provision-customer-lib.mjs')
  requireText(errors, provisioning, "firstPasswordRedirectTo = 'https://recovery.croprxsolutions.app/update-password'", 'auth:provisioning-exact-recovery-redirect')
  requireText(errors, app, 'window.location.replace(signInUrl)', 'auth:recovery-cancel-canonical-exit')
  requireText(errors, app, 'passwordEmailDeliveryEnabled ? requestNewLinkUrl : signInUrl', 'auth:recovery-invalid-canonical-exit')
  requireText(errors, app, 'phase === "signed_in" && !forgotPassword', 'auth:reset-intent-before-signed-in-redirect')
  requireText(errors, app, "if (!recoveryCompleted || phase === 'restoring' || recoveryCompletionStarted.current) return", 'auth:completion-waits-for-session-restore')
  requireText(errors, app, 'passwordRecoveryCleanupAuthority(window.localStorage, session, user?.id, Date.now())', 'auth:completion-requires-local-cleanup-authority')
  const authProvider = read(root, 'src/auth/AuthProvider.tsx')
  requireText(errors, authProvider, 'persistedPasswordRecoveryCleanupAuthority(d.storage, cleanupUserId, d.now()) !== authority', 'auth:completion-revalidates-persisted-lineage-in-transaction')
  requireText(errors, authProvider, 'pendingSignOutCleanupUserIds.current.add(cleanupUserId)', 'auth:completion-retains-cleanup-user')
  requireText(errors, authProvider, 'appliedRecoveryCompletionAuthority.current = authority', 'auth:completion-retains-retry-authority')
  requireText(errors, app, 'void completePasswordRecoveryCleanup(recoveryCompletionAuthority.current)', 'auth:completion-clears-canonical-session')
  requireText(errors, app, '.then(() => navigate(\'/login\', { replace: true }))', 'auth:completion-waits-for-canonical-cleanup')
  requireText(errors, app, "passwordRecoveryPhase === 'complete' || passwordRecoveryPhase === 'complete_with_warning'", 'auth:completion-auto-handoff-terminal-phases')
  requireText(errors, app, "window.location.replace(recoveryCompleteUrl)", 'auth:completion-automatically-signals-canonical-cleanup')
  requireText(errors, app, 'if (isPasswordRecoveryStorageError(error))', 'auth:reset-storage-error-distinguished')
  requireText(errors, app, 'setError(passwordRecoveryStorageErrorMessage)', 'auth:reset-storage-error-shown')
  requireText(errors, app, '{resetResponse && <p className="reset-confirmation" role="status">{resetResponse}</p>}\n          {error && <p className="auth-error" role="alert">{error}</p>}', 'auth:reset-storage-error-rendered')
  const main = read(root, 'src/main.tsx')
  requireText(errors, main, 'isPasswordRecoveryHostname(window.location.hostname) && window.location.pathname !== passwordRecoveryRoute', 'auth:recovery-host-route-confinement')
  requireText(errors, main, "'serviceWorker' in navigator && !isPasswordRecoveryHostname(window.location.hostname)", 'service-worker:recovery-origin-registration-denied')
  requireText(errors, main, "navigator.serviceWorker.register('/sw.js', { scope: '/' })", 'service-worker:ordinary-origin-registration')
  const vite = read(root, 'vite.config.ts')
  requireText(errors, vite, 'injectRegister: false', 'service-worker:no-unconditional-injection')
  if (/supabase\.co|api\/v1|rest\/v1/.test(serviceWorker)) errors.push('service-worker:private-api-runtime-cache')

  const widget = read(root, 'src/components/MarketQuote.tsx')
  requireText(errors, widget, 'sandbox="allow-scripts"', 'widget:opaque-sandbox')
  requireText(errors, widget, 'src={`/market-quote-frame.html?symbol=', 'widget:isolated-frame-document')
  if (widget.includes('allow-same-origin')) errors.push('widget:same-origin-enabled')
  const vercel = JSON.parse(read(root, 'vercel.json'))
  const appRule = vercel.headers.find((rule) => rule.source.includes('?!market-quote-frame'))
  const frameRule = vercel.headers.find((rule) => rule.source === '/market-quote-frame.html')
  const headers = Object.fromEntries(appRule.headers.map(({ key, value }) => [key, value]))
  for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) if (!headers['Content-Security-Policy']?.includes(directive)) errors.push(`csp:${directive}`)
  if (headers['Content-Security-Policy']?.match(/script-src[^;]*tradingview/)) errors.push('csp:third-party-parent-script')
  const frameCsp = Object.fromEntries(frameRule.headers.map(({ key, value }) => [key, value]))['Content-Security-Policy']
  if (!frameCsp?.includes('https://s3.tradingview.com')) errors.push('csp:frame-script-source')
  const frameDocument = read(root, 'public/market-quote-frame.html')
  const inline = frameDocument.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
  const frameHash = createHash('sha256').update(inline).digest('base64')
  if (!frameCsp?.includes(`'sha256-${frameHash}'`)) errors.push('csp:frame-inline-hash')

  // tests/season/maple-2027-start.sql derives the season owner password from psql variable
  // :'season_owner_password' rather than carrying a literal one. Only Invoke-MapleSeasonSqlFile
  // prepends the matching \set, so piping the fixture straight into psql hands the placeholder to
  // Postgres verbatim and the fixture dies on `syntax error at or near ":"`. That is exactly how
  // scripts/verify-program-assignment-identities-disposable.ps1 broke when the fixture was
  // parameterized and stayed broken: nothing in the repository runs that script, so no gate
  // noticed. Consumers are discovered by scanning rather than from a fixed list so that adding a
  // runner does not also require remembering to register it here. This is a tripwire for the one
  // mistake that actually happened, not a proof: it sees only top-level scripts/*.ps1 that name the
  // fixture literally, and only the `| docker exec` spelling of the pipe. A consumer written as a
  // .psm1, placed elsewhere, or building the filename by concatenation is not covered.
  const seasonStartFixture = read(root, 'tests/season/maple-2027-start.sql')
  requireText(errors, seasonStartFixture, ":'season_owner_password'", 'season:start-fixture-parameterized-password')
  const fixtureConsumers = readdirSync(resolve(root, 'scripts')).filter((entry) => entry.endsWith('.ps1') && read(root, `scripts/${entry}`).includes('maple-2027-start.sql'))
  if (fixtureConsumers.length === 0) errors.push('season:start-fixture-has-no-consumer')
  for (const consumer of fixtureConsumers) {
    const source = read(root, `scripts/${consumer}`)
    requireText(errors, source, 'Invoke-MapleSeasonSqlFile', `season:fixture-helper-${consumer}`)
    // An exemption for the file that DEFINES the helper used to sit here, on the theory that piping
    // the payload into psql is that file's job. It was removed: the definer
    // (scripts/maple-season-credential.ps1) does not name the fixture, so it never enters this loop and
    // the exemption could not fire - while any consumer that did enter the loop could exempt itself
    // from the prohibition merely by containing the words `function Invoke-MapleSeasonSqlFile`
    // anywhere, including inside a comment. A bypass that no drill covered, guarding against a
    // situation that does not exist, is a worse trade than a red gate nobody has triggered.
    if (/\|\s*docker exec/.test(source)) errors.push(`season:fixture-raw-psql-pipe-${consumer}`)
  }

  const scheduler = read(root, 'supabase/migrations/20260716122155_0037_scheduled_alert_foundation.sql')
  requireText(errors, scheduler, "current_setting('request.jwt.claim.role',true),'') <> 'service_role'", 'scheduler:service-role-check')
  requireText(errors, scheduler, 'b.bid_date between v_local_date-2 and v_local_date', 'scheduler:bid-freshness')
  requireText(errors, scheduler, 'is not distinct from v_rule.operating_entity_id', 'scheduler:entity-scope')
  return errors
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const errors = foundationStaticGuard(process.argv[2] ? resolve(process.argv[2]) : process.cwd())
  if (errors.length) { console.error(`Foundation static guard failed: ${errors.join(', ')}`); process.exit(1) }
  console.log('Foundation static guards: PASS')
}
