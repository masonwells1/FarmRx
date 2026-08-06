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
// Every way PowerShell can WRITE a named variable, counted over lines. A fresh-context review defeated two
// hand-rolled versions of this with spellings they did not allow for, so the rules are written out once here:
// names are CASE-INSENSITIVE (`$NoNcE` is `$nonce`), a scope qualifier may sit inside or outside the braces
// (`${script:nonce}` and `$script:nonce` are both writes), any compound assignment operator is a write, and
// `Set-Variable` is a write that never mentions a `$` at all. This is a second channel only: the values it
// protects are ReadOnly bindings, so PowerShell itself refuses the second write at run time. A regex over
// another language is the wrong place for the load-bearing barrier.
const countPowerShellWrites = (lines, name) => {
  const assignment = new RegExp(`\\$(?:\\{(?:script:|global:|local:|private:|using:)?${name}\\}|(?:script:|global:|local:|private:|using:)?${name}(?![\\w:]))\\s*(?:=|\\+=|-=|\\*=|/=|%=)`, 'i')
  const setVariable = new RegExp(`Set-Variable\\b[^\\n]*(?:'|"|\\b)${name}(?:'|"|\\b)`, 'i')
  // Comment-only lines are dropped first. This can only ever REMOVE false positives, never hide a real write:
  // a line PowerShell treats as a comment cannot assign anything, and a write that shares a line with code is
  // still counted because only lines that START with # are dropped. The comments in these files quote the very
  // defeats they defend against - `${script:nonce} = 'fixed'`, `$agrees = $true` - so without this the counter
  // reports its own documentation as extra writes.
  return lines.filter((line) => !/^\s*#/.test(line)).filter((line) => assignment.test(line) || setVariable.test(line)).length
}
// A PROHIBITION, which is the one shape of static check that is sound on its own: unlike an affirmation, the
// thing being forbidden cannot take effect without its definition being present for this to find. A
// fresh-context review demonstrated that `function Where-Object { $input }` defined beside a load-bearing
// pipeline makes that pipeline return every object without ever invoking its filter - so a candidate list
// accepts an answer it should refuse, with the pinned source line completely unchanged. Keywords and
// operators cannot be shadowed, which is why the comparisons themselves were rewritten as `foreach` plus
// `-ccontains`; the remaining pipelines are covered here.
const shadowableCmdlets = ['Where-Object', 'ForEach-Object', 'Sort-Object', 'Select-String', 'Compare-Object', 'Measure-Object', 'Select-Object', 'Set-Variable', 'Get-Variable']
const forbidCmdletShadowing = (errors, source, label) => {
  for (const cmdlet of shadowableCmdlets) {
    const escaped = cmdlet.replace('-', '\\-')
    if (new RegExp(`(?:^|[^\\w-])function\\s+${escaped}\\b`, 'i').test(source)) errors.push(`${label}:cmdlet-not-shadowed-by-function:${cmdlet}`)
    if (new RegExp(`(?:Set|New)-Alias\\b[^\\n]*(?:\\b|['"])${escaped}(?:\\b|['"])`, 'i').test(source)) errors.push(`${label}:cmdlet-not-shadowed-by-alias:${cmdlet}`)
    if (new RegExp(`\\$(?:function|alias):${escaped}\\b`, 'i').test(source)) errors.push(`${label}:cmdlet-not-shadowed-by-provider-write:${cmdlet}`)
  }
}

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
  // What this count actually counts: statements beginning with `Invoke-FoundationLane`. That is 23 -
  // one intermediate-failure probe, twenty-one in the orchestration body, and one nested inside
  // Invoke-FoundationWindowsExecutionLane. It does NOT count the Windows lane's own call site, because
  // this pattern requires whitespace immediately after `Invoke-FoundationLane` and
  // `Invoke-FoundationWindowsExecutionLane` continues with a letter. So the earlier rise from 21 to 22
  // came from the nested call, not from a new top-level lane, 22 to 23 is the runtime drill lane, and
  // 23 to 24 was the season browser ownership regression lane. It is back to 23 because the mutation
  // drill's lane no longer goes through the helper: Invoke-FoundationLane streams its child's output and
  // does not return it, and that lane now has to READ what the drill printed to require the drill's own
  // behavioural claim, so it is written out longhand and pinned by that claim instead.
  // The label says invoke-lane-statements rather than all-lanes-checked for that reason - the old
  // label implied this one number covered every lane in the file, which it does not.
  if ((foundationOrchestrator.match(/^\s*Invoke-FoundationLane\s/gm) ?? []).length !== 23) errors.push('orchestrator:invoke-lane-statements')
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
  const mutationDrill = read(root, 'scripts/verify-foundation-mutations.mjs')
  requireText(errors, foundationWorkflow, "Select-String -LiteralPath foundation-gate.log -SimpleMatch -CaseSensitive -Pattern 'Farm Rx foundation gate: PASS' -Quiet", 'workflow:foundation-completion-marker-asserted')
  requireText(errors, foundationWorkflow, "throw 'Foundation gate did not print its completion marker.'", 'workflow:foundation-completion-marker-fatal')
  // The three gates the workflow must run ITSELF. Invoked from the orchestrator alone, all three are
  // suppressible by an orchestrator that returns before reaching them while still printing the final
  // marker - which a log-substring assertion cannot distinguish from a real run.
  requireText(errors, foundationWorkflow, 'run: node scripts/foundation-static-guards.mjs', 'workflow:static-guards-run-independently')
  // The mutation drill's step captures the drill's output so it can require the drill's own behavioural claim,
  // so the plain `run:` spelling this used to pin no longer exists. Pinned as the capture, and the claim itself
  // is pinned further down for both callers.
  requireText(errors, foundationWorkflow, '$drill = @(node scripts/verify-foundation-mutations.mjs)', 'workflow:mutation-drill-run-independently')
  requireText(errors, foundationWorkflow, 'run: node scripts/foundation-windows-lane-runtime-drill.mjs', 'workflow:runtime-drill-run-independently')
  // STRUCTURE, not text. Every pin above is a substring test, and a substring test cannot see the two
  // one-line edits that switch a step off while leaving its whole body in place: `if: false` never runs it,
  // and `continue-on-error: true` runs it and then ignores the result. Both would leave every pin in this
  // file green. There is no YAML parser in node_modules, so the steps are sliced by indentation: a step
  // begins at `      - name:` and its body is every following line indented further, up to the next step.
  const governedSteps = ['Foundation static guards', 'Foundation mutation drill', 'Windows execution lane runtime drill', 'Season browser ownership regression', 'Run foundation gate']
  const workflowLines = foundationWorkflow.split(/\r?\n/)
  // KEYS ARE NORMALIZED BEFORE THEY ARE JUDGED. Both loops below used to match the bare spelling `if:`, and a
  // fresh-context review wrote `'if': false` at job level instead - the same key to any YAML parser, the whole
  // job disabled, and this guard green. Reproduced against the real workflow before this rewrite. YAML accepts
  // single quotes, double quotes and space before the colon, so the key is PARSED at the required indent and
  // then compared, rather than a list of spellings being guessed at. Exact indent matters: job keys sit at four
  // spaces and step keys at eight, and none of the quoting forms can begin with a space, so a deeper-indented
  // line inside a run: block cannot be mistaken for a key at either level.
  // AND DOUBLE-QUOTED KEYS ARE DECODED FIRST. A double-quoted YAML scalar carries escapes, so `"if"` and
  // `"\x69f"` are both the key `if` to any parser while being nothing like the letters `if` as text. Measured:
  // `"if": false` at job level disabled the whole job with this guard green. Single-quoted and plain
  // scalars carry no escapes in YAML and are compared as written.
  // YAML's escape set includes an EIGHT-digit `\U########` as well as `\u####` and `\x##`. The first version of
  // this decoder handled two of the three, and a fresh-context review wrote `"\U00000069f": false` - `\U00000069`
  // is the letter `i`, so the key is `if` to any parser, the whole job is disabled, and the decoder returned the
  // literal text `U00000069f`. All three widths are decoded here, longest first so `\U` is never read as the
  // one-character escape `U`. The durable answer is a real YAML parser; there is none in node_modules, and a
  // hand-written decoder is exactly the kind of thing that gets one spelling right and misses the next.
  const decodeDoubleQuoted = (text) => text.replace(/\\(u\{([0-9A-Fa-f]+)\}|U([0-9A-Fa-f]{8})|u([0-9A-Fa-f]{4})|x([0-9A-Fa-f]{2})|[\s\S])/g, (_whole, body, braced, u8, u4, x2) => {
    if (braced) return String.fromCodePoint(Number.parseInt(braced, 16))
    if (u8) return String.fromCodePoint(Number.parseInt(u8, 16))
    if (u4) return String.fromCharCode(Number.parseInt(u4, 16))
    if (x2) return String.fromCharCode(Number.parseInt(x2, 16))
    const simple = { 0: '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ' }
    return Object.prototype.hasOwnProperty.call(simple, body) ? simple[body] : body
  })
  const gatingKeyAt = (line, indent) => {
    const match = new RegExp(`^ {${indent}}(?:'([^']*)'|"((?:[^"\\\\]|\\\\.)*)"|([^\\s:'"#][^:]*?))\\s*:`).exec(line)
    if (!match) return null
    let key
    if (match[1] !== undefined) key = match[1]
    else if (match[2] !== undefined) key = decodeDoubleQuoted(match[2])
    else key = match[3] ?? ''
    key = key.trim()
    return key === 'if' || key === 'continue-on-error' ? key : null
  }
  const stepStarts = workflowLines.map((line, index) => ({ line, index })).filter((entry) => /^ {6}- name: /.test(entry.line))
  for (const name of governedSteps) {
    const start = stepStarts.find((entry) => entry.line === `      - name: ${name}`)
    if (!start) { errors.push(`workflow:governed-step-present:${name}`); continue }
    const next = stepStarts.find((entry) => entry.index > start.index)
    const body = workflowLines.slice(start.index + 1, next ? next.index : workflowLines.length)
    // Stop at the end of the step even when it is the last one in the file, and only look at keys that
    // belong to this step - eight spaces of indent - so a nested `if` inside a run: script is not confused
    // for a step condition.
    for (const bodyLine of body) {
      if (/^ {6}\S/.test(bodyLine)) break
      if (gatingKeyAt(bodyLine, 8)) errors.push(`workflow:governed-step-unconditional:${name}`)
    }
  }
  // The job itself is the same hole one level up: `if: false` on the job disables all five steps at once.
  //
  // The first version of this check required `foundation:` to be followed IMMEDIATELY by `runs-on:`, on the
  // reasoning that a condition would have to be inserted between them. A fresh-context review put `if: false`
  // on the line AFTER `runs-on:` instead - valid YAML, whole job disabled, and this guard stayed green.
  // Reproduced before this rewrite. Adjacency was never the property worth asserting; the absence of a
  // job-level condition ANYWHERE in the job is. Job keys sit at four spaces and step keys at eight, so this
  // scans for a gating key at job level regardless of where in the block it appears.
  for (let index = 0; index < workflowLines.length; index += 1) {
    if (!/^ {2}foundation:\s*$/.test(workflowLines[index])) continue
    for (const jobLine of workflowLines.slice(index + 1)) {
      if (/^ {0,2}\S/.test(jobLine)) break
      if (gatingKeyAt(jobLine, 4)) errors.push('workflow:foundation-job-unconditional')
    }
  }
  requireMatch(errors, foundationWorkflow, /^ {2}foundation:\n {4}runs-on: /m, 'workflow:foundation-job-declared')
  requireText(errors, foundationOrchestrator, "Write-Output 'Farm Rx foundation gate: PASS'", 'orchestrator:completion-marker')

  // The kill-authorizing predicate. This is the sole gate on the force kill in
  // Clear-MapleSeasonBrowserPort - TerminateProcess through an OS handle opened before the check, so the
  // id cannot change hands - so a false TRUE terminates a process Farm Rx does not own. Matching
  // the root text does not establish that the listener's path stays inside the tree that root names:
  // measured, root C:\FarmRx against `node.exe "C:\FarmRx\..\Other\scripts\factory-board.mjs"` answered
  // True. The traversal refusal is pinned here and executed by
  // scripts/maple-season-browser-port-preflight.regression.ps1.
  const seasonBrowser = read(root, 'scripts/maple-season-browser.ps1')
  // The predicate now compares whole ARGUMENTS, parsed by Windows' own rules, instead of searching the raw
  // command line for the root text and then classifying the boundary by hand. That hand classification
  // produced a different false-TRUE in each of three consecutive reviews, so the pins below hold the
  // tokenizer's load-bearing rules rather than any one boundary test.
  requireText(errors, seasonBrowser, 'foreach ($argument in (Split-MapleSeasonCommandLineArguments -CommandLine $commandLine)) {', 'season-browser:ownership-compares-whole-arguments')
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
  requireText(errors, seasonBrowser, 'throw "Split-MapleSeasonCommandLineArguments made no progress at index $index', 'season-browser:tokenizer-refuses-stalled-parse')
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
  requireText(errors, seasonBrowserRegression, "$stallOutcome -like 'THREW: Split-MapleSeasonCommandLineArguments made no progress*'", 'season-browser-regression:stall-drill-requires-the-refusal')
  // The empty command line is the ONE place this tokenizer deliberately disagrees with Windows, and the
  // divergence is asserted in both directions rather than omitted from the table. Windows answers an empty
  // command line with the path of the process asking - a fact about the caller, useless as evidence about
  // a listener - so zero arguments is the fail-closed answer.
  // Pin the CONTENT assertion, not a count. The count pin here was `-eq 1`, which was measured to be
  // host-dependent: Windows tokenizes the caller path it invents for an empty command line, so the answer
  // is 1 argument under Windows PowerShell 5.1 (C:\Windows\System32\...) and 2 under PowerShell 7
  // (C:\Program Files\...). Rejoining and comparing to the asking process path holds on both.
  requireText(errors, seasonBrowserRegression, "Assert-True (($emptyFromWindows -join ' ') -ceq $askingProcessPath)", 'season-browser-regression:empty-divergence-is-asserted')
  // The RUNTIME RECEIPT for that table. Everything this file pins about the 33 rows below - their spelling,
  // their pairing against the portable table in both directions, their total - is a statement that the rows
  // EXIST. A fresh-context review wrapped the `foreach` in `if ($false) { ... }` and every one of those checks
  // stayed green while zero command lines reached CommandLineToArgvW. Reproduced. So the count of comparisons
  // actually executed is published and asserted, and the counter is declared before the Windows branch and
  // consumed after it closes, so wrapping the branch's body cannot take the check with it. Both the total and
  // the DISTINCT total are required, because a duplicated row keeps the total while silently displacing a case.
  //
  // AND THE COUNT MUST BE TAKEN AFTER THE COMPARISON. The first version incremented at the TOP of the loop
  // body, which a fresh-context review defeated exactly as written: wrap only the comparison, and the receipt
  // still read `comparisons=33 distinct=33` with nothing handed to CommandLineToArgvW. Reproduced. So the
  // recording is gated on the comparison's own result, and the result is cleared at the top of each row so a
  // stale agreement cannot carry over. Both the clearing and the gate are pinned; without the clearing, the
  // gate would pass on row two onwards from row one's answer.
  //
  // ALL THREE are cleared, and that is a repair, not tidiness. A fresh-context review found that only $agrees
  // was cleared: wrap the two parses, force $agrees = $true, and $expected still held the PREVIOUS row's
  // argument array, so `$tokenizerTokens += $expected.Count` credited this row with a count Windows produced
  // for a different command line - and two rows in the table parse to the same number of arguments, so the
  // carried value did not even look wrong. The clear is pinned as an ORDERED block ahead of the two parses,
  // because a clear that lands after the parse it is meant to invalidate is worse than no clear at all.
  requireText(errors, seasonBrowserRegression, '$agrees = $null', 'season-browser-regression:tokenizer-agreement-cleared-per-row')
  requireMatch(errors, seasonBrowserRegression, /\$agrees = \$null\n *\$expected = \$null\n *\$actual = \$null\n *\$expected = @\(\[MapleSeasonArgv\]::Parse\(\$commandLine\)\)\n *\$actual = @\(Split-MapleSeasonCommandLineArguments -CommandLine \$commandLine\)\n/, 'season-browser-regression:tokenizer-parses-cleared-per-row')
  // The affirmative half of that repair, pinned in POSITION: a clear alone only makes a wrapped parse
  // under-count, and the shortfall then surfaces two hundred lines later as a total that does not reconcile,
  // which names the wrong thing. This assertion has to sit between the gate and the recording, so the regex
  // holds the whole ordered sequence rather than the assertion's mere presence.
  requireMatch(errors, seasonBrowserRegression, /Assert-True \$agrees "Split-MapleSeasonCommandLineArguments disagreed[^\n]*\n(?: *#[^\n]*\n)* *if \(\$agrees\) \{\n(?: *#[^\n]*\n)* *Assert-True \(\$null -ne \$expected -and \$expected\.Count -gt 0\)[^\n]*\n *\$tokenizerComparisons\+\+\n *\$tokenizerTokens \+= \$expected\.Count\n *\[void\]\$tokenizerLinesCompared\.Add\(\$commandLine\)\n/, 'season-browser-regression:tokenizer-receipt-recorded-after-the-comparison')
  requireText(errors, seasonBrowserRegression, '$tokenizerComparisons++', 'season-browser-regression:tokenizer-comparisons-counted')
  requireText(errors, seasonBrowserRegression, '[void]$tokenizerLinesCompared.Add($commandLine)', 'season-browser-regression:tokenizer-lines-recorded')
  requireText(errors, seasonBrowserRegression, '[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)', 'season-browser-regression:tokenizer-receipt-is-case-sensitive')
  requireText(errors, seasonBrowserRegression, 'TOKENIZER_RECEIPT comparisons=$tokenizerComparisons distinct=$($tokenizerLinesCompared.Count) tokens=$tokenizerTokens windows=', 'season-browser-regression:tokenizer-receipt-published')
  requireText(errors, seasonBrowserRegression, 'Assert-True ($tokenizerComparisons -eq $tokenizerExpectedComparisons)', 'season-browser-regression:tokenizer-receipt-total-consumed')
  requireText(errors, seasonBrowserRegression, 'Assert-True ($tokenizerLinesCompared.Count -eq $tokenizerExpectedComparisons)', 'season-browser-regression:tokenizer-receipt-distinct-consumed')
  requireText(errors, seasonBrowserRegression, 'if ($onWindows) { 33 } else { 0 }', 'season-browser-regression:tokenizer-receipt-expects-the-full-table')
  // The receipt's SECOND channel. A child that asserts things about itself is the shape of defeat this chain
  // keeps finding, so the caller that chains this regression holds the expected count longhand: deleting the
  // child's own two assertions is then not enough to hide a table that never ran.
  const julyWiringRegression = read(root, 'scripts/maple-july-db-clock-wiring.regression.ps1')
  requireText(errors, julyWiringRegression, "'TOKENIZER_RECEIPT comparisons=33 distinct=33 tokens=90 windows=true'", 'july-wiring-regression:tokenizer-receipt-asserted-by-the-caller')
  requireText(errors, seasonBrowser, '# ONE deliberate divergence from CommandLineToArgvW', 'season-browser:empty-divergence-is-declared')
  // The force kill must go through the identity that was validated, and that identity must still hold.
  // A process id is not durable: the validated process can exit and Windows can reissue its number. The
  // previous pins here held `$ownedProcess.Kill()` and read the .NET Process object as the pin. Measured,
  // that object pins nothing - haveProcessHandle stayed False and m_processHandle stayed null across
  // .StartTime, .HasExited and .Kill() - so each of those re-resolved the id at call time. An OS handle
  // opened BEFORE the ownership check is what actually reserves the id, so these pins hold the handle.
  requireText(errors, seasonBrowser, '[MapleSeasonProcessInterop]::OpenProcess(', 'season-browser:cleanup-opens-a-handle-before-validating')
  requireText(errors, seasonBrowser, '[MapleSeasonProcessInterop]::TerminateProcess($target.Handle, 1)', 'season-browser:cleanup-terminates-through-the-validated-handle')
  requireText(errors, seasonBrowser, 'no longer identifies the listener it validated', 'season-browser:cleanup-rechecks-process-identity')
  // The two-pass split is the F15 repair and it is load-bearing, not stylistic. Measured: the one-pass
  // version terminated an OWNED listener and then reported "refusing to terminate it" on the foreign one
  // sharing the same port. Pin the second pass reading a list built by the first, so collapsing the two
  // back into a single validate-then-kill loop cannot pass silently.
  requireText(errors, seasonBrowser, 'foreach ($target in $validated) {', 'season-browser:cleanup-validates-every-listener-before-terminating-any')
  // Fail-closed listener probe, in ONE place. Every caller must go through Get-MapleSeasonPortListener,
  // whose only swallowed error is the measured "nothing is listening" one; a bare SilentlyContinue probe
  // reads a BROKEN query as a free port, which is the single direction this file must never fail.
  requireText(errors, seasonBrowser, "if ($_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') { return @() }", 'season-browser:listener-probe-fails-closed')
  // Count CALL SITES, not mentions: the cmdlet name is discussed in three comments in this file, and a
  // mention count would have to move every time one of those comments is reworded. A call always carries
  // a parameter, so `Get-NetTCPConnection` followed by a dash is the invocation and the prose is not.
  const seasonBrowserNetQueries = (seasonBrowser.match(/Get-NetTCPConnection\s+-/g) ?? []).length
  if (seasonBrowserNetQueries !== 1) {
    errors.push(`season-browser:listener-probe-is-the-only-net-query (found ${seasonBrowserNetQueries} Get-NetTCPConnection call sites, expected 1 - the one inside Get-MapleSeasonPortListener)`)
  }

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
  // copy. Delete this and the file becomes decoration that cannot distinguish a working predicate from
  // `return $true`.
  requireText(errors, ownershipRegression, "Replace($firstGuard, \"  return `$true`n$firstGuard\")", 'ownership-regression:guts-the-predicate')
  // The rejection is checked as a SET OF LABELS, not as a count. The count version was here and it was
  // weaker than it read: N executions of one row satisfy a count of N. It was also measurably wrong, because
  // `[string]$CommandLine` coerced a $null command line to '' and two rows became the same input. Both the
  // set comparison and the distinct-input assertion are pinned, because either alone can be defeated.
  // Assert-MapleSeasonCase, not Assert-True: every real case in that file now goes through a wrapper that
  // tallies independently and then calls the helper, because the helper itself was measured sabotageable in a
  // way no text pin can see. Pinning the wrapper is what keeps those two channels from collapsing back into
  // one - a case routed straight to Assert-True is untallied, and the cross-check below stops covering it.
  requireText(errors, ownershipRegression, 'Assert-MapleSeasonCase ($uncaught.Count -eq 0)', 'ownership-regression:refusals-reject-the-gutted-predicate')
  requireText(errors, ownershipRegression, 'Assert-MapleSeasonCase ($duplicateInputs.Count -eq 0)', 'ownership-regression:refusal-inputs-are-distinct')
  // THE TALLY COUNTS CASES REACHED, NOT CASES FAILED. The first version of that wrapper appended to its tally
  // inside `if (-not $Condition)`, which made it a second failure list rather than a second channel: a
  // fresh-context review wrapped an assertion that normally PASSES in `if ($false) { ... }`, both counts stayed
  // at zero, they agreed, and the suite printed PASS. Reproduced. The unconditional append and the failure-only
  // list are pinned separately, because collapsing either back into the other restores that defeat.
  requireMatch(errors, ownershipRegression, /function Assert-MapleSeasonCase \{\n *param\(\[bool\]\$Condition, \[string\]\$Message\)\n *\$script:tallied\.Add\(\$Message\)\n *if \(-not \$Condition\) \{ \$script:talliedFailures\.Add\(\$Message\) \}\n *Assert-True \$Condition \$Message\n\}/, 'ownership-regression:every-case-is-tallied')
  // The two tallies are ReadOnly append-only lists, not arrays. A fresh-context review defeated the array form
  // with `$script:tallied = @('padding') * $expectedCases` placed just before the count check: the count agreed
  // without a single case having run. PowerShell itself refuses to rebind a ReadOnly name at run time, so that
  // padding line now throws where the old form silently succeeded, and Add() cannot shrink a list.
  requireMatch(errors, ownershipRegression, /^Set-Variable -Name tallied -Scope Script -Option ReadOnly -Value \(\[Collections\.Generic\.List\[string\]\]::new\(\)\)$/m, 'ownership-regression:tally-bound-readonly')
  requireMatch(errors, ownershipRegression, /^Set-Variable -Name talliedFailures -Scope Script -Option ReadOnly -Value \(\[Collections\.Generic\.List\[string\]\]::new\(\)\)$/m, 'ownership-regression:failure-tally-bound-readonly')
  for (const tally of ['tallied', 'talliedFailures']) {
    const writes = countPowerShellWrites(ownershipRegression.split(/\r?\n/), tally)
    if (writes !== 1) errors.push(`ownership-regression:tally-bound-once:${tally}:${writes}`)
  }
  forbidCmdletShadowing(errors, ownershipRegression, 'ownership-regression')
  requireText(errors, ownershipRegression, 'if ($script:talliedFailures.Count -ne $script:failures.Count) {', 'ownership-regression:failure-channels-cross-checked')
  requireText(errors, ownershipRegression, '$expectedCases = 5 + $windowsCasesRun', 'ownership-regression:expected-case-count-is-derived')
  requireText(errors, ownershipRegression, 'if ($script:tallied.Count -lt $expectedCases) {', 'ownership-regression:case-count-consumed')
  // EVERY case goes through the wrapper. A case routed straight to Assert-True is untallied, so it would be
  // invisible to both the cross-check and the published count - which is the hole the wrapper exists to close.
  // Counted rather than pinned one at a time: eight call sites were pinned as two, and six of them could have
  // been deleted with this guard green. Eight = the five portable cases, one inside the gutted-predicate failure
  // loop, and two inside the Windows-only loops that run once per row. Assert-True itself may appear exactly
  // twice - the deliberate canary self-test, and the call inside the wrapper.
  const ownershipCaseCalls = ownershipRegression.split(/\r?\n/).filter((line) => /^\s*Assert-MapleSeasonCase /.test(line))
  if (ownershipCaseCalls.length !== 8) errors.push(`ownership-regression:case-call-site-count:${ownershipCaseCalls.length}`)
  const ownershipDirectAsserts = ownershipRegression.split(/\r?\n/).filter((line) => /^\s*Assert-True /.test(line))
  if (ownershipDirectAsserts.length !== 2) errors.push(`ownership-regression:direct-assert-call-count:${ownershipDirectAsserts.length}`)
  requireText(errors, ownershipRegression, 'param($CommandLine, $Name = \'node.exe\')', 'ownership-regression:listener-preserves-a-null-command-line')
  requireText(errors, ownershipRegression, "function Split-MapleSeasonCommandLineArgumentsGutted { param([string]$CommandLine) return @($CommandLine) }", 'ownership-regression:guts-the-tokenizer')
  requireText(errors, ownershipRegression, "Measure-TokenizerDisagreement -FunctionName 'Split-MapleSeasonCommandLineArgumentsGutted'", 'ownership-regression:table-rejects-the-gutted-tokenizer')
  // Both gutting needles fail closed. A stale needle would otherwise leave the anti-vacuity check
  // silently testing an unmodified copy, which is the vacuous pass it exists to prevent.
  requireText(errors, ownershipRegression, 'the anti-vacuity check below would prove nothing', 'ownership-regression:gutting-anchor-fails-closed')
  requireText(errors, ownershipRegression, 'the gutting needle is stale and the anti-vacuity check would prove nothing', 'ownership-regression:gutting-needle-fails-closed')
  // It must call the predicate, not read it, and the refusals must be the portable half so the ubuntu job
  // executes them. All 25 of those rows claim a gutted predicate, which is what makes the set comparison
  // above an assertion about the whole table.
  requireText(errors, ownershipRegression, "foreach ($claimed in @(Measure-RefusalFailures -FunctionName 'Test-MapleSeasonBrowserPortOwned')) {", 'ownership-regression:calls-the-real-predicate')
  requireText(errors, ownershipRegression, 'if (& $FunctionName -ListenerProcess $case.Listener -Root $case.Root) { $wrong += $case.Label }', 'ownership-regression:refusals-are-executed')
  // CHALLENGE/RESPONSE. The completion marker is a string, and a two-line file that prints it and exits 0
  // was measured to satisfy both callers - the same "requires text, not behaviour" defect this whole suite
  // exists to fix, one layer up. So the suite must publish how much of itself ran, and must answer command
  // lines supplied by its caller using the REAL tokenizer and the REAL predicate.
  // The portable table's expectations are HARD-CODED literals, claimed to have been measured from
  // CommandLineToArgvW. That claim is only durable if something re-derives them from the real API, which the
  // Windows socket regression does - and it was measured to be missing exactly one of them, so the claim was
  // wrong by one line. This check keeps the two tables from drifting again: every plainly-quoted command line
  // in the portable table must also appear in the file that re-derives it.
  //
  // The row count is stated twice on purpose, because the first version of this check stated it once and was
  // wrong: 29 rows begin the table, but only 26 are single-quoted literals the pattern below can capture. The
  // other THREE are built by expression, because they contain a character no single-quoted PowerShell string
  // can carry - a tab, a non-breaking space, a tab inside quotes. A pattern that silently skipped three rows
  // while the comment admitted only "a tab or a non-breaking space" would be exactly the defect this whole
  // tranche exists to close, so the excluded rows are enumerated and pinned by hand below rather than waved at.
  // Both spellings are required, because the two files build the same character differently and neither
  // spelling proves the other is present.
  const tokenizerRowStarts = (ownershipRegression.match(/^ {4}@\{ Line = /gm) ?? []).length
  if (tokenizerRowStarts !== 29) errors.push('ownership-regression:tokenizer-row-count')
  const portableTokenizerLines = [...ownershipRegression.matchAll(/^ {4}@\{ Line = '((?:[^']|'')*)'; Expected =/gm)].map((match) => match[1].replace(/''/g, "'"))
  if (portableTokenizerLines.length !== 26) errors.push('ownership-regression:tokenizer-literal-count')
  // DISTINCT, not just counted. Every count in this block is an array `.length`, and every pairing below runs
  // through a `Set` - which collapses duplicates. A fresh-context review used exactly that gap: duplicate one
  // row and delete a different one, MIRRORED on both sides so each table's total still matched, and the whole
  // pairing stayed green with a case silently gone. A one-sided duplicate was already caught
  // (`live-row-unaccounted`); the mirrored form was not. Requiring the Set size to equal the total is what
  // closes it, because a duplicate is the one thing that makes those two numbers differ.
  if (new Set(portableTokenizerLines).size !== 26) errors.push('ownership-regression:tokenizer-literal-distinct-count')
  const preflightRegression = read(root, 'scripts/maple-season-browser-port-preflight.regression.ps1')
  // The live side is PARSED into its actual rows, not searched as text, and the pairing is then asserted in
  // BOTH directions. The previous version searched the whole live file for each portable literal, and a
  // fresh-context review defeated it by COMMENTING OUT a live row: the row stopped executing, the substring
  // was still in the file, and the guard stayed green. Reproduced before this rewrite. A commented row is not
  // a re-derivation, so comment lines are excluded here by construction.
  const preflightLines = preflightRegression.split(/\r?\n/)
  const liveTableStart = preflightLines.findIndex((line) => line.trim() === 'foreach ($commandLine in @(')
  const liveTableEnd = preflightLines.findIndex((line, index) => index > liveTableStart && line === '    )) {')
  if (liveTableStart < 0 || liveTableEnd < 0) errors.push('ownership-regression:live-tokenizer-table-not-found')
  const liveTokenizerRows = liveTableStart < 0 || liveTableEnd < 0
    ? []
    : preflightLines.slice(liveTableStart + 1, liveTableEnd).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'))
  // 33 = the 26 single-quoted portable literals + the 3 hand-paired rows + the 4 live-only rows enumerated
  // below. Stating the live total is the reverse half of the pairing: without it the live table can grow rows
  // that nothing on the portable side asserts, which is how the tables drifted apart the first time.
  if (liveTokenizerRows.length !== 33) errors.push('ownership-regression:live-tokenizer-row-count')
  const liveTokenizerRowSet = new Set(liveTokenizerRows)
  // The live half of the same distinctness requirement, and the reason this one matters twice over: the runtime
  // receipt in the preflight file asserts 33 comparisons AND 33 distinct command lines, so a duplicated live row
  // now fails at run time as well as here. Two independent channels, deliberately.
  if (liveTokenizerRowSet.size !== 33) errors.push('ownership-regression:live-tokenizer-distinct-row-count')
  for (const line of portableTokenizerLines) {
    if (!liveTokenizerRowSet.has(`'${line.replace(/'/g, "''")}'`)) errors.push(`ownership-regression:tokenizer-literal-rederived:${line}`)
  }
  // The three expression-built rows, each named, each with the spelling that must exist on BOTH sides.
  const handPairedTokenizerRows = [
    { label: 'tab-separated-arguments', portable: "@{ Line = 'node.exe'+[char]9+'C:\\FarmRx\\x.js'+[char]9+'--port'+[char]9+'4177'", live: '"node.exe`tC:\\FarmRx\\x.js`t--port`t4177"' },
    { label: 'non-breaking-space-in-a-path', portable: "@{ Line = ('node.exe C:\\FarmRx'+[char]0x00A0+'Backup\\server.js')", live: '("node.exe C:\\FarmRx{0}Backup\\server.js" -f $nonBreakingSpace)' },
    { label: 'tab-inside-a-quoted-path', portable: "@{ Line = ('node.exe \"C:\\FarmRx\\'+[char]9+'\\Other\\x.js\"')", live: '"node.exe `"C:\\FarmRx\\`t\\Other\\x.js`""' },
  ]
  for (const row of handPairedTokenizerRows) {
    requireText(errors, ownershipRegression, row.portable, `ownership-regression:hand-paired-row-present:${row.label}`)
    if (!liveTokenizerRowSet.has(row.live)) errors.push(`ownership-regression:hand-paired-row-rederived:${row.label}`)
  }
  // The live NBSP row names a VARIABLE, so pinning the row's text says nothing about the character it carries.
  // Rewriting the definition to an ASCII space keeps the row pin above green and silently turns the one case
  // that distinguishes Windows' separators (space and tab only) from [char]::IsWhiteSpace into a case about an
  // ordinary space. Both the definition and its single assignment are required, for the same reason the nonce is.
  // The definition is now a ReadOnly binding, so a second write fails in POWERSHELL rather than only here. That
  // matters because a fresh-context review defeated the previous count with two ordinary spellings this regex had
  // no way to see: PowerShell variable names are case-insensitive (`$NoNbReAkInGsPaCe = …` is the same variable)
  // and `${script:nonBreakingSpace} = …` puts the scope INSIDE the braces, which the old alternation did not
  // allow for. Both are fixed below, and the runtime barrier is the channel that does not depend on my getting
  // the regex exhaustive.
  requireMatch(errors, preflightRegression, /^ *Set-Variable -Name nonBreakingSpace -Option ReadOnly -Value \(\[char\]0x00A0\)$/m, 'season-browser-regression:non-breaking-space-defined-readonly-by-code-point')
  if (countPowerShellWrites(preflightLines, 'nonBreakingSpace') !== 1) errors.push(`season-browser-regression:non-breaking-space-assigned-once:${countPowerShellWrites(preflightLines, 'nonBreakingSpace')}`)
  // THE RECEIPT CARRIES A QUANTITY WINDOWS PRODUCED. A fresh-context review defeated the gate-on-$agrees version
  // by writing `$agrees = $true` straight after the $null clear and then wrapping both parses and the comparison:
  // $agrees is truthy with no call to CommandLineToArgvW, and the comparison and distinct-line counts both still
  // reach 33. Summing the argument counts Windows RETURNED cannot be reached that way - an unset $expected counts
  // zero - so the shortfall survives any number of extra assignments to the agreement flag.
  requireMatch(errors, preflightRegression, /^ *\$tokenizerTokens \+= \$expected\.Count$/m, 'season-browser-regression:tokenizer-tokens-accumulated-from-windows')
  requireText(errors, preflightRegression, 'tokens=$tokenizerTokens windows=', 'season-browser-regression:tokenizer-tokens-published')
  requireText(errors, preflightRegression, '$tokenizerExpectedTokens = if ($onWindows) { 90 } else { 0 }', 'season-browser-regression:tokenizer-tokens-expected-held')
  requireText(errors, preflightRegression, 'Assert-True ($tokenizerTokens -eq $tokenizerExpectedTokens)', 'season-browser-regression:tokenizer-tokens-consumed')
  // $agrees is written exactly three times: cleared to $null, set from the length comparison, and cleared to
  // $false inside the element loop. A fourth write is the defeat above, so a fourth write is red.
  const agreesWrites = countPowerShellWrites(preflightLines, 'agrees')
  if (agreesWrites !== 3) errors.push(`season-browser-regression:tokenizer-agreement-written-three-times:${agreesWrites}`)
  forbidCmdletShadowing(errors, preflightRegression, 'season-browser-regression')
  // The reverse direction, named row by named row. Any live row that is NOT one of the 29 paired rows must be
  // one of these four, and each of these four must still be there - so neither table can gain or lose a row
  // without a failure that says which row and which side.
  const liveOnlyTokenizerRows = [
    { label: 'doubled-quote-inside-a-quoted-argument', live: '\'node.exe "a""b c"\'' },
    { label: 'even-backslashes-then-doubled-quote', live: '\'node.exe a\\\\""b c\'' },
    { label: 'even-backslashes-then-doubled-quote-inside-quotes', live: '\'node.exe "a\\\\""b" c\'' },
    { label: 'traversal-out-of-the-tree-unterminated-quote', live: '\'node.exe "C:\\FarmRx\\..\\Other\\x.js\'' },
  ]
  const pairedLiveRows = new Set([
    ...portableTokenizerLines.map((line) => `'${line.replace(/'/g, "''")}'`),
    ...handPairedTokenizerRows.map((row) => row.live),
  ])
  for (const row of liveOnlyTokenizerRows) {
    if (!liveTokenizerRowSet.has(row.live)) errors.push(`ownership-regression:live-only-row-present:${row.label}`)
  }
  const enumeratedLiveOnly = new Set(liveOnlyTokenizerRows.map((row) => row.live))
  for (const row of liveTokenizerRows) {
    if (!pairedLiveRows.has(row) && !enumeratedLiveOnly.has(row)) errors.push(`ownership-regression:live-row-unaccounted:${row}`)
  }
  requireText(errors, ownershipRegression, 'OWNERSHIP_MANIFEST tokenizer={0} refusals={1} gutted={2} windows={3} windowsCases={4} cases={5} challenges={6} canary={7}', 'ownership-regression:publishes-a-manifest')
  // `cases` is the field that made the tally visible to somebody other than the suite. It must be fed by the
  // tally itself, not by a literal or by a recount of the tables.
  requireText(errors, ownershipRegression, '$windowsCasesRun, $script:tallied.Count, $challengeLines.Count', 'ownership-regression:manifest-publishes-the-case-count')
  // The assertion-helper self-test. A fresh-context review turned `Assert-True`'s condition into `if ($false)`
  // and this suite still printed its marker, still published a manifest with every table at full size, still
  // answered all four challenges correctly, and exited 0 - with roughly a hundred table assertions dead. The
  // manifest cannot catch that (sizes are counted, not asserted) and the challenge cannot either (its answers
  // are computed outside the helper). Only handing the helper a must-fail condition can, so the block that
  // does it and the `throw` that refuses to continue without it are both pinned.
  requireText(errors, ownershipRegression, 'if (-not $Condition) { $script:failures += $Message }', 'ownership-regression:assertion-helper-records-failures')
  requireText(errors, ownershipRegression, 'Assert-True $false $script:assertionCanary', 'ownership-regression:assertion-helper-self-tested')
  requireText(errors, ownershipRegression, "throw 'Assertion helper did not record a deliberately-false assertion", 'ownership-regression:assertion-helper-self-test-is-terminating')
  requireText(errors, ownershipRegression, "$script:assertionCanaryCaught = 'caught'", 'ownership-regression:assertion-canary-published')
  requireText(errors, ownershipRegression, 'OWNERSHIP_CHALLENGE {0} owned={1} argv={2}', 'ownership-regression:answers-the-challenge')
  // The challenge payload is Base64 on both sides. Two transport defects were MEASURED in this one parameter -
  // `-File` binding an array to its first element only, and `-File` truncating a plain string at the first
  // embedded double quote - and in both cases challenges vanished while the suite still printed its marker and
  // exited 0. The encoding is therefore load-bearing and pinned on the decode side and on both encode sides,
  // and `challenges=` in the manifest is what turns a lost challenge into a named failure.
  requireText(errors, ownershipRegression, '$challengeLines = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Challenge)) -split ([char]0x1F))', 'ownership-regression:challenge-decoded-from-base64')
  requireText(errors, ownershipRegression, '$challengeArgv = @(Split-MapleSeasonCommandLineArguments -CommandLine $challengeLine)', 'ownership-regression:challenge-uses-the-real-tokenizer')
  requireText(errors, ownershipRegression, '$challengeOwned = [bool](Test-MapleSeasonBrowserPortOwned -ListenerProcess (New-Listener -CommandLine $challengeLine) -Root $ChallengeRoot)', 'ownership-regression:challenge-uses-the-real-predicate')
  // Its own slice must be unambiguous, and must actually contain the three functions under test.
  requireText(errors, ownershipRegression, 'declares Clear-MapleSeasonBrowserPort more than once', 'ownership-regression:slice-refuses-ambiguity')
  requireText(errors, ownershipRegression, 'function Test-MapleSeasonBrowserPortOwned', 'ownership-regression:slice-requires-the-predicate')
  // TWO independent callers, for the same reason the three node gates are listed separately in the
  // workflow: the orchestrator can be edited to return before its lane while still printing the final
  // marker, and a workflow step it does not invoke cannot be suppressed that way.
  requireText(errors, foundationWorkflow, './scripts/maple-season-browser-ownership.regression.ps1', 'workflow:ownership-regression-run-independently')
  requireText(errors, foundationWorkflow, "throw 'Season browser ownership regression did not print its completion marker.'", 'workflow:ownership-regression-marker-asserted')
  requireText(errors, foundationOrchestrator, "$script:ownershipOutput = @(& (Get-FoundationProbeShell) -NoProfile -ExecutionPolicy Bypass -File $ownership -Challenge $ownershipChallengeArgument -ChallengeRoot 'C:\\FarmRx')", 'orchestrator:ownership-regression-lane')
  requireText(errors, foundationOrchestrator, "if ($script:ownershipOutput -notcontains 'MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS') {", 'orchestrator:ownership-regression-marker-asserted')
  // Each caller must hold answers of its own and require them. The marker assertions above are kept but they
  // are no longer the whole gate: a marker is text, and these are behaviour. Both callers are pinned
  // separately and deliberately hold the expectations longhand - a challenge whose answers live in one shared
  // place is one edit away from being no challenge at all.
  // The two callers name their locals differently, so each occurrence pin carries that caller's own spelling -
  // a pin that matched either spelling would be satisfied by the wrong caller's line appearing in a comment.
  for (const [caller, id, collect, candidates, forIndex, index, accepted, verified] of [
    [foundationWorkflow, 'workflow', '$answered = @($ownership', '$candidates', '$forIndex', '$i', '$accepted', '$verifiedAnswers'],
    [foundationOrchestrator, 'orchestrator', '$ownershipAnswered = @($script:ownershipOutput', '$ownershipCandidates', '$ownershipForIndex', '$ownershipIndex', '$ownershipAccepted', '$ownershipVerifiedAnswers'],
  ]) {
    requireText(errors, caller, 'OWNERSHIP_MANIFEST tokenizer=29 refusals=25 gutted=25 windows=', `${id}:ownership-manifest-shape-asserted`)
    // How many assertion cases the suite must say it REACHED. `canary=caught` proved the helper noticed one
    // deliberately false condition; it could not tell a full run from one with an assertion quietly skipped,
    // because the suite's own cross-check compared failure counts and a skipped passing assertion fails nothing.
    // Measured. This caller holds the expected count, so the number lives somewhere the suite cannot edit.
    requireText(errors, caller, 'cases=$(', `${id}:ownership-case-count-asserted`)
    requireText(errors, caller, 'manifest lines instead of exactly one; it did not run to completion.', `${id}:ownership-manifest-required-once`)
    // The count of challenges the suite says it decoded, checked against the count this caller sent. Without
    // this, a transport that eats challenges is caught only if a surviving argv happens to look wrong.
    requireText(errors, caller, 'challenges=$(', `${id}:ownership-challenge-count-asserted`)
    requireText(errors, caller, '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(', `${id}:ownership-challenge-base64-encoded`)
    // U+001F splits the payload into challenges, and it is NOT impossible in a Windows command line - it was
    // measured surviving into a Node child's argv. A row containing it would become phantom challenges, so each
    // caller refuses to send one instead of relying on the withdrawn claim that it cannot happen.
    // Anchored so that only a LIVE statement satisfies it: a commented-out refusal starts with `#`.
    requireMatch(errors, caller, /^ *if \(\$\w+\.Line\.Contains\(\[char\]0x1F\)\) \{ throw "Ownership challenge row contains the U\+001F delimiter/m, `${id}:ownership-challenge-delimiter-refused`)
    requireText(errors, caller, 'OWNERSHIP_CHALLENGE $', `${id}:ownership-challenge-lines-required`)
    // Answers counted as INSTANCES of output, not as membership of this caller's own candidate strings. The
    // membership form was measured to accept a child that printed BOTH verdicts for one index, or the same
    // index twice, because it filtered the candidates rather than the output.
    requireText(errors, caller, `${collect} | Where-Object { $_.StartsWith('OWNERSHIP_CHALLENGE ', [StringComparison]::Ordinal) })`, `${id}:ownership-answers-counted-as-instances`)
    requireText(errors, caller, 'challenge answers for $(', `${id}:ownership-answer-total-asserted`)
    requireText(errors, caller, `${forIndex} = @(${collect.split(' = ')[0]} | Where-Object { $_.StartsWith("OWNERSHIP_CHALLENGE ${index} ", [StringComparison]::Ordinal) })`, `${id}:ownership-answer-per-index-selected`)
    // The accepted answer is SELECTED by filtering this caller's own candidates, and the selection's own result
    // is what gets recorded. The earlier form tested membership and then recorded nothing, so the recording step
    // could not tell an executed comparison from a skipped one.
    // A `foreach` KEYWORD and a `-ccontains` OPERATOR rather than a pipeline, and not for style. A fresh-context
    // review defined a local `Where-Object` function that returns every object without invoking its filter, and
    // the pipeline form then accepted a printed FALSE against a candidate TRUE with this pin still green.
    // Keywords and operators cannot be shadowed by a function definition. Anchored as a live statement.
    requireMatch(errors, caller, new RegExp(`^ *foreach \\(\\$\\w+ in ${forIndex.replace('$', '\\$')}\\) \\{`, 'm'), `${id}:ownership-answer-iterated-with-a-keyword`)
    requireText(errors, caller, `if (${candidates} -ccontains $`, `${id}:ownership-answer-selected-from-candidates`)
    requireText(errors, caller, `${accepted}.Add($`, `${id}:ownership-accepted-answer-collected`)
    requireText(errors, caller, `if (${forIndex}.Count -ne 1 -or ${accepted}.Count -ne 1) {`, `${id}:ownership-answer-must-be-a-candidate`)
    // No governed caller may shadow the cmdlets its remaining pipelines depend on.
    forbidCmdletShadowing(errors, caller, id)
    // The suite's assertion-helper self-test, reported through the manifest. A caller that stops requiring
    // `canary=caught` cannot tell a run with ~100 live assertions from a run with all of them disabled.
    // Anchored to the live expected-manifest statement: the surrounding comment also says `canary=caught`, and
    // a substring pin satisfied by prose is exactly the mistake this whole tranche keeps repairing.
    // ReadOnly, because a fresh-context review pointed out that assigning the child's own manifest line back over
    // this variable makes the caller compare the child's answer with itself while every pin here stays green.
    // PowerShell refuses the second write at run time; that is the barrier, and this is the pin that keeps it.
    // TWO pins, not one, because they fail for different reasons and a single label cannot say which happened:
    // the binding can lose its ReadOnly option while still demanding the canary, and it can keep ReadOnly while
    // dropping the canary from the expected manifest.
    requireMatch(errors, caller, /^ *Set-Variable -Name \w+ -Option ReadOnly -Value "OWNERSHIP_MANIFEST [^\n"]*"$/m, `${id}:ownership-assertion-canary-required-readonly`)
    requireMatch(errors, caller, /^ *Set-Variable -Name \w+ -Option ReadOnly -Value "OWNERSHIP_MANIFEST [^\n"]*canary=caught"$/m, `${id}:ownership-assertion-canary-required`)
    // The live unrelated Node process that holds the governed port on the author's workstation. If the
    // predicate ever answers TRUE for this line, the cleanup path force-kills it. Both callers must keep
    // asking about exactly this string.
    requireText(errors, caller, '"C:\\Program Files\\nodejs\\node.exe" scripts/factory-board.mjs --port 4177', `${id}:ownership-challenge-includes-the-live-foreign-listener`)
    requireText(errors, caller, 'ResolverDependent', `${id}:ownership-challenge-marks-resolver-dependent-rows`)
    // A per-run nonce, in an owned row AND an unowned row. Fixed rows are satisfiable by a stub that hard-codes
    // the answers without running the predicate at all; a nonce forces the child to tokenize and judge text it
    // has never seen. Anchored to live statements so a commented-out row cannot satisfy them.
    requireText(errors, caller, "[Guid]::NewGuid().ToString('N')", `${id}:ownership-challenge-nonce-generated`)
    // AND ASSIGNED EXACTLY ONCE. A fresh-context review added `$nonce = 'fixed'` on the line directly after the
    // NewGuid() call, in both callers: the pin above still matched, both nonce-row pins still matched, and the
    // challenge stopped being fresh - which is the whole point of it, because a fixed row is answerable by a
    // stub that hard-codes verdicts without running the predicate. Reproduced in both callers before this check.
    // The property is that nothing reassigns the variable, so assignments are COUNTED rather than more
    // spellings being pinned. The first version of the count matched only `^ *$nonce = `, which PowerShell has
    // at least four other spellings for: `${nonce} = 'fixed'`, `$nonce='fixed'`, `$script:nonce = 'fixed'` and
    // `Set-Variable nonce 'fixed'` all reassign it and all left that count at one. So every WRITE form is
    // counted, and any extra write - even one this file cannot interpret - makes the guard red rather than
    // quiet, because a nonce that is not fresh is the same as no challenge at all.
    // AND THE NONCE IS A ReadOnly BINDING, which is the channel that does not depend on this regex being
    // exhaustive - a later review defeated the count with two spellings it had no way to see: PowerShell names
    // are case-insensitive, and `${script:nonce}` puts the scope inside the braces. Both are handled now, but
    // PowerShell refusing the second write at RUN TIME is the barrier; the count is the second channel.
    const nonceAssignment = /^ *Set-Variable -Name (\w+) -Option ReadOnly -Value \(\[Guid\]::NewGuid\(\)\.ToString\('N'\)\)$/m.exec(caller)
    if (!nonceAssignment) errors.push(`${id}:ownership-challenge-nonce-assigned-live-readonly`)
    else if (countPowerShellWrites(caller.split(/\r?\n/), nonceAssignment[1]) !== 1) {
      errors.push(`${id}:ownership-challenge-nonce-assigned-once:${countPowerShellWrites(caller.split(/\r?\n/), nonceAssignment[1])}`)
    }
    // The per-index verification must be RECORDED and RECONCILED. A fresh-context review wrapped the
    // answer-total check and the per-index loop in `if ($false) { ... }` in both callers: every pin in this
    // block still matched, because every pinned line was still in the file, and nothing measured that any of it
    // RAN. Reproduced in both callers. The first repair counted `$n++` on its own line after the comparison,
    // which a later review defeated by wrapping only the comparison: the tick still fired once per row, so the
    // count reached the expected total with nothing compared. What is recorded now is the accepted ANSWER - a
    // value that exists only because the comparison produced it - and the recorded answers are reconciled
    // against what the child printed, so a skipped comparison leaves an empty or null-filled list.
    requireText(errors, caller, `${verified} = [Collections.Generic.List[string]]::new()`, `${id}:ownership-answers-recorded-as-values`)
    requireText(errors, caller, `${verified}.Add(${accepted}[0])`, `${id}:ownership-accepted-answer-recorded`)
    requireText(errors, caller, `if (((${verified} | Sort-Object) -join "\`n") -cne ((${collect.split(' = ')[0]} | Sort-Object) -join "\`n")) {`, `${id}:ownership-answers-reconciled`)
    requireText(errors, caller, 'challenge answers this lane accepted one by one do not reconcile with the', `${id}:ownership-answers-verified-count-consumed`)
    requireMatch(errors, caller, /^ *@\{ Line = "node\.exe C:\\FarmRx\\node_modules\\vite\\bin\\vite\.js --nonce \$\w+"; .*Owned = \$true;/m, `${id}:ownership-challenge-nonce-row-owned`)
    requireMatch(errors, caller, /^ *@\{ Line = "node\.exe C:\\Other\\server\.js --nonce \$\w+"; .*Owned = \$false;/m, `${id}:ownership-challenge-nonce-row-unowned`)
  }

  // The mutation drill's BEHAVIOURAL half, held by its callers. The drill has two halves: a static half that
  // breaks a subject and requires the static guard to notice, and a behavioural half that breaks a subject and
  // requires the SUITE THAT RUNS AGAINST IT to refuse by name. Only the second can tell a working predicate from
  // one edited to `return $true`. Measured: wrapping the behavioural half in `if (false) { ... }` left the drill
  // printing PASS, because the drill decided for itself what it had covered. So each caller states the count it
  // requires - broken subjects reported, plus subjects this platform cannot see - and the counts differ by
  // platform, which is why the two callers hold different sentences. A caller whose count no longer matches goes
  // red, so neither half can be removed, disabled, or quietly shrunk from inside the drill.
  const windowsBehaviouralClaim = 'Foundation behavioural mutation drill: PASS (5 broken subjects were reported by the suite that runs against them, 0 not measurable on this platform)'
  const portableBehaviouralClaim = 'Foundation behavioural mutation drill: PASS (4 broken subjects were reported by the suite that runs against them, 1 not measurable on this platform)'
  requireText(errors, foundationWorkflow, `$expectedBehaviour = '${portableBehaviouralClaim}'`, 'workflow:mutation-drill-behavioural-claim-held')
  // THE ORCHESTRATOR HOLDS BOTH SENTENCES AND SELECTS BY PLATFORM. It used to hold the Windows sentence
  // unconditionally, and a fresh-context review pointed out that this was not a residual but a broken CI lane
  // needing no adversarial edit at all: the ubuntu workflow requires the four-broken sentence from its own drill
  // step and then runs this script IN THE SAME JOB, which demanded the five-broken one - so the job could not be
  // green on either platform's truth. Selecting is not accepting: both exact sentences are still written out.
  requireText(errors, foundationOrchestrator, `$windowsBehaviouralMarker = '${windowsBehaviouralClaim}'`, 'orchestrator:mutation-drill-windows-claim-held')
  requireText(errors, foundationOrchestrator, `$portableBehaviouralMarker = '${portableBehaviouralClaim}'`, 'orchestrator:mutation-drill-portable-claim-held')
  requireMatch(errors, foundationOrchestrator, /^ *\$expectedBehaviouralMarker = if \(\$onWindowsForDrill\) \{ \$windowsBehaviouralMarker \} else \{ \$portableBehaviouralMarker \}$/m, 'orchestrator:mutation-drill-claim-selected-by-platform')
  // And the claim must be CONSUMED, not merely stored. Both callers capture the drill's output and refuse when
  // the sentence is absent, which is the only reason holding it is worth anything.
  requireText(errors, foundationWorkflow, '$drill -cnotcontains $expectedBehaviour', 'workflow:mutation-drill-behavioural-claim-consumed')
  requireText(errors, foundationOrchestrator, '$mutationDrill -cnotcontains $expectedBehaviouralMarker', 'orchestrator:mutation-drill-behavioural-claim-consumed')
  // The OTHER platform's sentence must be REFUSED. A drill that prints both is satisfying its callers rather
  // than measuring anything, and exactly one of the two can be true of a given run.
  requireText(errors, foundationWorkflow, '$drill -ccontains $rejectedBehaviour', 'workflow:mutation-drill-other-platform-claim-refused')
  requireText(errors, foundationOrchestrator, '$mutationDrill -ccontains $rejectedBehaviouralMarker', 'orchestrator:mutation-drill-other-platform-claim-refused')
  // THE STATIC HALF IS HELD TOO. A fresh-context review observed that every static mutation could be wrapped
  // whole while the behavioural half still earned its own sentence, because no caller read the static marker at
  // all - a marker nobody consumes is decoration. Both callers now hold it with its count.
  const staticClaim = 'Foundation mutation drill: PASS (178 controlled mutations turned the gate red)'
  requireText(errors, foundationWorkflow, `$expectedStatic = '${staticClaim}'`, 'workflow:mutation-drill-static-claim-held')
  requireText(errors, foundationOrchestrator, `$expectedStaticMarker = '${staticClaim}'`, 'orchestrator:mutation-drill-static-claim-held')
  requireText(errors, foundationWorkflow, '$drill -cnotcontains $expectedStatic', 'workflow:mutation-drill-static-claim-consumed')
  requireText(errors, foundationOrchestrator, '$mutationDrill -cnotcontains $expectedStaticMarker', 'orchestrator:mutation-drill-static-claim-consumed')

  // ---------------------------------------------------------------------------------------------------------
  // THE DRILL ITSELF, which until now this file did not read at all. A fresh-context review pointed at the
  // consequence: stubbing the drill's own subject runner - `const runOwnershipSuite = () => ({ status: 1,
  // output: expected })` - makes all five behavioural subjects "detected" without a child process ever
  // starting, and nothing anywhere noticed, because the counts in the sentence are computed from how many
  // times the drill called its own helper.
  //
  // SAY WHAT THIS DOES AND DOES NOT DO. It pins the runner to a real child process and the scoring helpers to
  // their strict criteria, so the stub cannot be written without moving text that is pinned here. It does NOT
  // make a self-reporting file honest about itself - that is not reachable by a check living in the same
  // repository the file lives in, and an eighth counter inside the drill would not reach it either. What
  // closes it is review of the exact commit plus a protected branch that runs this on a machine the author
  // does not control; what this closes is the accident and the quiet edit.
  requireText(errors, mutationDrill, "const result = spawnSync(onWindows ? 'powershell' : 'pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(temporary, ownershipSuite)]", 'mutation-drill:subject-runner-starts-a-real-child')
  requireMatch(errors, mutationDrill, /^ *return \{ status: result\.status, output: `\$\{result\.stdout \?\? ''\}\$\{result\.stderr \?\? ''\}` \}$/m, 'mutation-drill:subject-runner-returns-the-child-result')
  requireMatch(errors, mutationDrill, /^ *if \(result\.error\?\.code === 'ETIMEDOUT' \|\| result\.signal\) \{$/m, 'mutation-drill:subject-runner-refuses-a-hang')
  // The baseline is what makes "the suite went red" mean anything: a suite red for an unrelated reason would
  // satisfy every case below it while measuring nothing.
  requireMatch(errors, mutationDrill, /^ *if \(behaviourBaseline\.status !== 0 \|\| !behaviourBaseline\.output\.includes\('MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS'\)\) \{$/m, 'mutation-drill:behavioural-baseline-must-be-green')
  // A detection is exit EXACTLY 1, the named sentence, no PASS marker, and a sentence the green baseline did
  // NOT already print. "Non-zero exit plus a substring" scored crashes and boilerplate as detections.
  requireMatch(errors, mutationDrill, /^ *if \(status !== 1\) \{$/m, 'mutation-drill:detection-requires-exit-one')
  requireMatch(errors, mutationDrill, /^ *if \(!output\.includes\(expected\)\) \{$/m, 'mutation-drill:detection-requires-the-named-sentence')
  requireMatch(errors, mutationDrill, /^ *if \(output\.includes\('MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS'\)\) \{$/m, 'mutation-drill:detection-refuses-a-pass-marker')
  requireMatch(errors, mutationDrill, /^ *if \(behaviourBaseline\.output\.includes\(expected\)\) \{$/m, 'mutation-drill:detection-sentence-must-be-new')
  // And a recorded blind spot is exit 0 PLUS the PASS marker PLUS the manifest fields that make it the shape
  // the gap is claimed about. Exit 0 alone is also what a suite that stopped early produces.
  requireMatch(errors, mutationDrill, /^ *if \(!output\.includes\('MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS'\)\) \{$/m, 'mutation-drill:gap-requires-a-complete-run')
  requireMatch(errors, mutationDrill, /^ *for \(const field of expectedManifestFields\) \{$/m, 'mutation-drill:gap-requires-the-expected-manifest')
  requireText(errors, mutationDrill, "['windows=false', 'windowsCases=0', 'cases=5']", 'mutation-drill:gap-manifest-fields-held')
  // Both sentences are printed LAST and from the counters, never as literals. The static marker used to print
  // before the behavioural half ran, so the behavioural half could be wrapped whole and the log still read PASS.
  requireText(errors, mutationDrill, 'console.log(`Foundation mutation drill: PASS (${detectedMutations.length} controlled mutations turned the gate red)`)', 'mutation-drill:static-claim-counted-not-asserted')
  requireText(errors, mutationDrill, 'console.log(`Foundation behavioural mutation drill: PASS (${behaviouralMutations.length} broken subjects were reported by the suite that runs against them, ${behaviourGaps.length} not measurable on this platform)`)', 'mutation-drill:behavioural-claim-counted-not-asserted')

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
