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
// A pin over EXECUTABLE PowerShell that must name ONE place, and the two things it adds over requireText are
// the two ways presence pins have actually been defeated in this repository rather than in theory.
//
// One: satisfied by a comment. These files carry long comments that quote the very statements they defend, so
// `requireText('$process.Dispose()')` stays green over a file whose only occurrence of that text is the
// sentence explaining why it matters. Comment-only lines are dropped first - the same rule
// countPowerShellWrites uses, and sound for the same reason: a line PowerShell treats as a comment cannot
// execute anything. It is only a COMPLETE strip while no line carries a trailing `#`, which is pinned below
// as season-browser:no-inline-comments so a future `$x = 1 # $process.Dispose()` cannot satisfy a pin.
//
// Two: satisfied by a SECOND occurrence, which is the failure that actually happened. A repair added a
// legitimate second `[MapleSeasonProcessInterop]::OpenProcess(` call site; String.replace renames only the
// first, so the drill mutated one site, the pin found the other, the guard stayed green and the mutation went
// undetected. Requiring exactly one occurrence makes that arrive as a named guard failure at the moment the
// duplicate is introduced, instead of as a drill that silently stops testing anything. The two counts get
// distinct labels because they are distinct defects and each is drilled separately.
const powerShellStatements = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const requireStatementOnce = (errors, source, text, label) => {
  const code = powerShellStatements(source)
  let count = 0
  for (let at = code.indexOf(text); at >= 0; at = code.indexOf(text, at + 1)) count++
  if (count === 0) errors.push(label)
  else if (count > 1) errors.push(`${label}-appears-more-than-once`)
}
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

  // The ownership predicate, WHICH NO LONGER AUTHORIZES A KILL. It used to be the sole gate on a force
  // kill in Clear-MapleSeasonBrowserPort, and every pin and drill below was written when a false TRUE
  // there terminated a process Farm Rx does not own. That is not what it does now. Ownership comes from
  // the kernel - TerminateJobObject kills the members of this scenario's own job and cannot reach
  // anything else - and the predicate is called from exactly one place, the preflight refusal in
  // Assert-MapleSeasonBrowserPortFree, which kills nothing. So the cost of a false answer here is a
  // WRONG DIAGNOSIS in a refusal message: a stranger's listener described as a leftover Farm Rx one, or
  // the reverse. That is worth keeping correct, and the pins below are kept for it, but the reader
  // should not carry away that this text gates a kill. Its NAME still says Owned and still overstates
  // what it can know; renaming it is deliberately left to its own commit rather than folded in here.
  // Matching the root text does not establish that the listener's path stays inside the tree that root names:
  // measured, root C:\FarmRx against `node.exe "C:\FarmRx\..\Other\scripts\factory-board.mjs"` answered
  // True. The traversal refusal is pinned here and executed by
  // scripts/maple-season-browser-port-preflight.regression.ps1.
  const seasonBrowser = read(root, 'scripts/maple-season-browser.ps1')
  // The predicate now compares whole ARGUMENTS, parsed by Windows' own rules, instead of searching the raw
  // command line for the root text and then classifying the boundary by hand. That hand classification
  // produced a different false-TRUE in each of three consecutive reviews, so the pins below hold the
  // tokenizer's load-bearing rules rather than any one boundary test.
  requireStatementOnce(errors, seasonBrowser, 'foreach ($argument in (Split-MapleSeasonCommandLineArguments -CommandLine $commandLine)) {', 'season-browser:ownership-compares-whole-arguments')
  // Windows splits on ASCII space and tab ONLY. [char]::IsWhiteSpace also accepts NBSP, which is legal in
  // a file name, so treating it as a separator made the sibling C:\FarmRx<NBSP>Backup look like our root
  // followed by a boundary. Measured True before this rule was ASCII-only. The rule is defined ONCE and
  // used by both of the tokenizer's loops: written twice, the two copies drifted, and a parse that stopped
  // at a character the separator skip would not consume spun forever instead of answering. The stall
  // guard is the second half of that repair - and it THROWS rather than returning what it has. Breaking out
  // with a truncated argument list was measured to be a false-TRUE of its own: on the sibling line the
  // drifted parse yields `node.exe`, `C:\FarmRx`, ``, and the bare exact root IS a containment match, so
  // the truncation authorized killing the sibling's listener. Refusing to answer is the only safe answer.
  requireStatementOnce(errors, seasonBrowser, "return ($Character -eq ' ' -or $Character -eq \"`t\")", 'season-browser:tokenizer-splits-on-ascii-space-and-tab-only')
  requireStatementOnce(errors, seasonBrowser, 'if ((-not $inQuotes) -and (Test-MapleSeasonCommandLineSeparator -Character $character)) { break }', 'season-browser:tokenizer-breaks-argument-at-shared-separator')
  requireStatementOnce(errors, seasonBrowser, 'while ($index -lt $length -and (Test-MapleSeasonCommandLineSeparator -Character $CommandLine[$index])) { $index++ }', 'season-browser:tokenizer-skips-shared-separator')
  requireStatementOnce(errors, seasonBrowser, 'throw "Split-MapleSeasonCommandLineArguments made no progress at index $index', 'season-browser:tokenizer-refuses-stalled-parse')
  // 2n backslashes then a quote: n backslashes, quote is a delimiter. 2n+1: n backslashes and a LITERAL
  // quote. Without this rule `--label "C:\FarmRx\safe\" --port 4177"` counted the escaped quote as a
  // closing delimiter and the predicate answered True for a listener running out of C:\Other. Measured.
  requireStatementOnce(errors, seasonBrowser, "[void]$builder.Append('\\', [int][Math]::Floor($backslashes / 2))", 'season-browser:tokenizer-halves-escaped-backslash-run')
  requireStatementOnce(errors, seasonBrowser, "if (($backslashes % 2) -eq 1) { [void]$builder.Append('\"'); $index++ }", 'season-browser:tokenizer-treats-odd-run-quote-as-literal')
  // CommandLineToArgvW's doubled-quote quirk, which the C runtime does NOT share: inside a quoted
  // argument '""' yields one literal quote and LEAVES quoted mode. Measured against the real API.
  requireStatementOnce(errors, seasonBrowser, "if ($inQuotes -and ($index + 1) -lt $length -and $CommandLine[$index + 1] -eq '\"') {", 'season-browser:tokenizer-handles-doubled-quote')
  // Win32 strips trailing dots and spaces per component. The trim must take dots, spaces and tabs as ONE
  // set: chaining .TrimEnd(' ',tab) then .TrimEnd('.') is order-dependent and left '.. .' with a length of
  // three, so the component walk accepted it and the predicate claimed the parent directory. Measured.
  requireStatementOnce(errors, seasonBrowser, "return $Component.TrimEnd(' ', \"`t\", '.').Length -ne 0", 'season-browser:ownership-refuses-traversal')
  requireStatementOnce(errors, seasonBrowser, 'if (-not (Test-MapleSeasonPathComponentIsRealName -Component $component)) { return $false }', 'season-browser:ownership-walks-tail-components')
  requireStatementOnce(errors, seasonBrowser, 'if (-not (Test-MapleSeasonPathComponentIsRealName -Component $segment)) { return $false }', 'season-browser:ownership-walks-root-components')
  // Windows has TWO argument grammars, and the construct below is the one whose disagreement was MEASURED
  // here - not the only construct on which they can disagree, which is what "exactly one" claimed before a
  // fresh-context review pointed out that nothing in this repository establishes it. CommandLineToArgvW - what
  // the tokenizer above reproduces - splits `"C:\Other"" C:\FarmRx\safe"` into `C:\Other"` and
  // `C:\FarmRx\safe`, so half a label reads as a path in our tree; node.exe is parsed by the Microsoft C
  // runtime, where the same label stays one argument naming nothing of ours. Both readings are defensible,
  // and guessing wrong authorizes a kill, so a doubled quote is refused rather than parsed. Measured.
  requireStatementOnce(errors, seasonBrowser, "if ($commandLine.Contains('\"\"')) { return $false }", 'season-browser:ownership-refuses-ambiguous-grammar')
  // Containment is decided by the PLATFORM's path resolver, not by a hand-written walk over the text. The
  // walk this replaced refused `\\?\C:\FarmRx\x.js`, `C:\FarmRx\.\x.js` and `C:\FarmRx\sub\..\x.js`, all of
  // which ARE inside the tree - each would have declared our own listener foreign - and it ACCEPTED
  // `C:\FarmRx\NUL` and `C:\FarmRx\file:stream`, which name a device and a stream. All five measured.
  requireStatementOnce(errors, seasonBrowser, 'try { $resolved = [System.IO.Path]::GetFullPath($candidate) } catch { return $false }', 'season-browser:ownership-resolves-with-the-platform')
  requireStatementOnce(errors, seasonBrowser, "if ($candidate.StartsWith('\\\\?\\', [StringComparison]::Ordinal)) { $candidate = $candidate.Substring(4) }", 'season-browser:ownership-strips-extended-length-prefix')
  // An argument carrying a character Win32 forbids in a path is not a path at all. This is what refuses
  // the escaped-quote defeat, whose argument `C:\FarmRx\safe" --port 4177` starts with our root at a real
  // separator yet cannot name a file.
  requireStatementOnce(errors, seasonBrowser, "if ($candidate.IndexOfAny([char[]]@('\"', '<', '>', '|', '*', '?')) -ge 0) { return $false }", 'season-browser:ownership-refuses-non-path-characters')
  requireStatementOnce(errors, seasonBrowser, 'if ([char]::IsControl($character)) { return $false }', 'season-browser:ownership-refuses-control-characters')
  // A colon past the drive letter names an alternate data stream, and a reserved device name is a device
  // rather than a file. Both are checked explicitly instead of being left to the resolver, so the answer
  // cannot change under a shell built on a different .NET.
  requireStatementOnce(errors, seasonBrowser, "if ($candidate.IndexOf(':', 2) -ge 0) { return $false }", 'season-browser:ownership-refuses-alternate-data-stream')
  requireStatementOnce(errors, seasonBrowser, "if ($bareName -match '(?i)^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$') { return $false }", 'season-browser:ownership-refuses-reserved-device-name')
  // Resolve only ABSOLUTE spellings. GetFullPath resolves a relative or drive-relative path against
  // process state - the current directory, or the current directory of a drive - and no part of a kill
  // authorization may depend on where the shell happens to be standing.
  requireStatementOnce(errors, seasonBrowser, "if (-not (($candidate -match '^[A-Za-z]:\\\\') -or ($candidate -match '^\\\\\\\\[^\\\\?.]'))) { return $false }", 'season-browser:ownership-refuses-shell-relative-path')
  // The root must end at a real separator inside the argument, or be the whole argument. Without this,
  // root C:\FarmRx claimed a listener running out of C:\FarmRx2.
  requireStatementOnce(errors, seasonBrowser, "if ($tail.Length -gt 0 -and $tail[0] -ne '\\') { return $false }", 'season-browser:ownership-requires-separator-boundary')
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
  // ANCHORED TO THE STALL DRILL'S OWN SENTENCE, because this pin used to hold only the shared tail phrase - and a
  // second, entirely legitimate stale-needle guard added elsewhere in this same file gave that phrase a second
  // occurrence, which blinded the pin: deleting the stall drill's copy left the other one behind and the guard
  // stayed green. Caught by the drill aimed at this label rather than by reading, which is the whole argument for
  // having the drill. The repair is to make the pin unique instead of forbidding the repo's shared wording, since
  // the wording is worth reusing and the next stale-needle guard would have hit this again.
  requireStatementOnce(errors, seasonBrowserRegression, 'The stall drill could not find the shared separator test to drift; its needle is stale and the drill would prove nothing.', 'season-browser-regression:stall-drill-refuses-stale-needle')
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
  // THE UNREADABLE-HOLDER CASE, pinned part by part. Deleting the whole case leaves a suite that still prints its
  // PASS marker, and the property it proves has no other executed home: every other case in this file has a
  // holder the preflight can read, so nothing else exercises the branch that must refuse to classify. The
  // injected statement is pinned alongside the assertions, because without the injection the listener is
  // readable and foreign and the case would be asserting the wrong refusal.
  //
  // requireStatementOnce rather than requireText, which the rows above use: it strips whole-line comments and
  // demands exactly one occurrence, so neither a commented-out copy nor a second occurrence can satisfy it.
  requireStatementOnce(errors, seasonBrowserRegression, "throw 'the process table could not be read (injected)'", 'season-browser-regression:unreadable-holder-case-injects-a-failed-process-read')
  requireStatementOnce(errors, seasonBrowserRegression, 'Assert-True ($cimMessage -ceq $cimExpected)', 'season-browser-regression:unreadable-holder-case-requires-the-honest-refusal')
  requireStatementOnce(errors, seasonBrowserRegression, "so it will not guess whether the holder is Farm Rx or not: PID $($listenerProcess.Id) (could not be identified: the process table could not be read (injected))", 'season-browser-regression:unreadable-holder-case-expects-the-full-sentence')
  requireStatementOnce(errors, seasonBrowserRegression, "Assert-True (-not (Test-Path -LiteralPath $startedSentinel)) 'Port preflight started the browser runner despite being unable to identify the holder of the governed port.'", 'season-browser-regression:unreadable-holder-case-requires-a-refusal-not-a-launch')
  requireStatementOnce(errors, seasonBrowserRegression, "Assert-True (-not $listenerProcess.HasExited) 'Port preflight terminated a listener it could not even identify instead of refusing.'", 'season-browser-regression:unreadable-holder-case-requires-the-listener-untouched')
  // EXACTLY ONE match, because .Replace patches every one: a second copy of the process-lookup statement would
  // be neutered silently and the case would pass while covering less than its own prose claims.
  requireStatementOnce(errors, seasonBrowserRegression, "Port preflight regression could not find exactly one process-lookup statement to inject a failure into", 'season-browser-regression:unreadable-holder-case-refuses-a-stale-or-duplicated-needle')
  // The receipt's SECOND channel. A child that asserts things about itself is the shape of defeat this chain
  // keeps finding, so the caller that chains this regression holds the expected count longhand: deleting the
  // child's own two assertions is then not enough to hide a table that never ran.
  // The only suite in this repository that EXECUTES Invoke-MapleSeasonBrowserProof rather than reading it as
  // text, and until this round it drove exactly one of that function's two branches. Both are now pinned. The
  // success branch is the one every Maple scenario takes and the one no gate covered: a launch that pins the
  // child's id with an OS handle, a child that exits zero, a cleanup that releases the governed port, and a
  // handle that closes. Each assertion is held separately, because each of them can be removed on its own and
  // leave a suite that still prints its PASS marker.
  const browserTimeoutRegression = read(root, 'scripts/maple-season-browser-timeout.regression.ps1')
  // The FORBIDS below need a view with comment lines dropped, and finding that out cost a red gate: this file's
  // comments quote the very defects they defend against - `.Contains($tempRoot)`, the fail-open reads - so a forbid
  // run over the raw source reports the documentation as the defect. It is the same reason countPowerShellWrites
  // strips them. Presence pins keep using the raw source, because requireStatementOnce strips them itself.
  const browserTimeoutRegressionCode = powerShellStatements(browserTimeoutRegression)
  requireStatementOnce(errors, browserTimeoutRegression, "Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple launch success regression'", 'timeout-regression:success-case-runs-the-real-helper')
  requireStatementOnce(errors, browserTimeoutRegression, 'Assert-True ($null -eq $successFailure)', 'timeout-regression:success-case-requires-no-failure')
  requireStatementOnce(errors, browserTimeoutRegression, 'Assert-True (Test-Path -LiteralPath $successReadyFile)', 'timeout-regression:success-case-requires-the-child-ran')
  // Silence is the assertion here, so losing it is invisible: a leaked launch handle is only ever REPORTED,
  // through a warning, and a suite that stops collecting warnings passes while an id stays reserved.
  requireStatementOnce(errors, browserTimeoutRegression, 'Assert-True ($successWarnings.Count -eq 0)', 'timeout-regression:success-case-requires-no-leaked-handle')
  // A PIN ON AN ASSERTION IS NOT A PIN ON THE THING THAT GIVES THE ASSERTION ITS DATA, and this is the third time
  // that distinction has cost something in this file. All three zero-warning assertions were pinned above and the
  // -WarningVariable flags that POPULATE them were not, so deleting a flag left the assertion sitting there,
  // pinned and green, reading a variable nothing had ever set. Measured on this workstation rather than assumed:
  // neither this file nor the helper sets Set-StrictMode, and an unset variable's .Count reads 0 in PowerShell 7,
  // so `$x.Count -eq 0` on an unbound $x is TRUE. The assertion does not fail loudly when its source of data
  // disappears; it certifies silence it never listened for. Each flag is pinned together with the -RunnerFile and
  // -OwnedCommandMarker arguments of its own invocation, which is what ties a flag to the case it belongs to
  // rather than letting one case's flag satisfy another case's pin.
  requireStatementOnce(errors, browserTimeoutRegression, '-RunnerFile $successRunner -OwnedCommandMarker $tempRoot -WarningVariable successWarnings', 'timeout-regression:success-case-collects-the-warnings-it-asserts-on')
  requireStatementOnce(errors, browserTimeoutRegression, "Assert-True (@(Get-MapleSeasonPortListener -Port $successPort -Scenario 'Maple launch success regression').Count -eq 0)", 'timeout-regression:success-case-requires-the-port-released')
  // The TIMEOUT case's port assertion, which no pin held at all until now - the success and orphan cases each had
  // one and the dramatic branch in between did not, so deleting it left a case that runs the timeout cleanup and
  // never asks whether the port came back.
  requireStatementOnce(errors, browserTimeoutRegression, "Assert-True (@(Get-MapleSeasonPortListener -Port $port -Scenario 'Maple timeout regression').Count -eq 0)", 'timeout-regression:timeout-case-requires-the-port-released')
  // The timeout case's own zero-warning assertion, which did not exist until now. It is the path that most needed
  // it: cleanup here runs in the finally with a terminating error already in flight, and the helper deliberately
  // DOWNGRADES a cleanup problem to a warning on that path rather than overwriting the timeout verdict. Correct
  // behaviour, and also precisely how a failed cleanup rides along underneath a green timeout case. Both halves
  // are pinned, for the reason given above the success-case flag.
  requireStatementOnce(errors, browserTimeoutRegression, '-RunnerFile $fakeRunner -OwnedCommandMarker $tempRoot -WarningVariable timeoutWarnings', 'timeout-regression:timeout-case-collects-the-warnings-it-asserts-on')
  requireStatementOnce(errors, browserTimeoutRegression, 'Assert-True ($timeoutWarnings.Count -eq 0)', 'timeout-regression:timeout-case-requires-a-quiet-cleanup')
  // THE ORPHAN CASE, and it is the only executed proof in this repository that the governed port gets released
  // when the process this function launched is already gone. Every other case has the parent alive at the moment
  // the salvage runs, which is why the leak survived: the release was gated on the parent, and the listener was
  // never the parent. Reaching that state needs a launch-side failure AFTER the parent exits, which no
  // environment knob produces, so the failure is INJECTED into a copy of the helper - the ownership regression's
  // technique - and the injection waits for the parent before throwing, which makes the ordering deterministic
  // instead of a race. Five assertions, each held separately: the detached listener really took the port, the
  // failure that came out is the injected one and not an earlier throw, the port is free afterwards, and the
  // salvage completed without a footnote. Losing any one of them leaves a case that still prints PASS.
  requireStatementOnce(errors, browserTimeoutRegression, "Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple orphan drill'", 'timeout-regression:orphan-case-runs-the-injected-helper')
  requireStatementOnce(errors, browserTimeoutRegression, 'Assert-True (Test-Path -LiteralPath $orphanReadyFile)', 'timeout-regression:orphan-case-requires-the-detached-listener')
  requireStatementOnce(errors, browserTimeoutRegression, "Assert-True ($orphanFailure -ceq 'Maple orphan drill launch drill failed on purpose after the parent exited.')", 'timeout-regression:orphan-case-requires-its-injected-failure')
  requireStatementOnce(errors, browserTimeoutRegression, "Assert-True (@(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill').Count -eq 0)", 'timeout-regression:orphan-case-requires-the-port-released')
  requireStatementOnce(errors, browserTimeoutRegression, 'Assert-True ($orphanWarnings.Count -eq 0)', 'timeout-regression:orphan-case-requires-a-complete-salvage')
  requireStatementOnce(errors, browserTimeoutRegression, '-RunnerFile $orphanRunner -OwnedCommandMarker $tempRoot -WarningVariable orphanWarnings', 'timeout-regression:orphan-case-collects-the-warnings-it-asserts-on')
  // A drill whose needle has gone stale patches nothing and then reports on unmodified source, which is the one
  // failure mode that makes an injection worse than no injection at all.
  requireStatementOnce(errors, browserTimeoutRegression, 'its needle is stale and the drill would prove nothing', 'timeout-regression:orphan-case-refuses-a-stale-needle')
  // EXACTLY ONE OCCURRENCE, not at least one, and the CONDITION is the pin rather than the sentence it throws.
  // Contains() was the whole check while .Replace() patches every match, so a second occurrence of the needle
  // would have injected the drill's throw into a path this case never reasons about - and the case would still
  // have printed PASS. A fresh-context review found it, and found that the pin above protects only the WORDING
  // of the refusal: with the message intact and the test gone, the drill reports on source it never changed.
  requireStatementOnce(errors, browserTimeoutRegression, 'if ($orphanNeedleCount -ne 1) {', 'timeout-regression:orphan-case-refuses-a-needle-that-is-not-unique')
  requireStatementOnce(errors, browserTimeoutRegression, '$orphanNeedleCount = ([regex]::Matches($orphanSource, [regex]::Escape($orphanNeedle))).Count', 'timeout-regression:orphan-case-counts-its-needle')
  // THE INJECTED WAIT'S RESULT IS READ. [void] discarded it, so the injected failure could announce "after the
  // parent exited" having waited out thirty seconds with the parent still running - the premise this whole case
  // rests on, carried by a sentence that could not fail. A fresh-context review found it.
  //
  // The wait is now on the process HANDLE, because the helper has no .NET Process object left, and the pin is on
  // the -ne WAIT_OBJECT_0 comparison rather than on a boolean. That comparison is the load-bearing part: it is
  // what makes WAIT_TIMEOUT and WAIT_FAILED both reach the refusal. An -eq against WAIT_TIMEOUT alone would
  // read as a wait that is checked while a broken wait sailed through into the on-purpose failure.
  requireStatementOnce(errors, browserTimeoutRegression, 'if ($orphanWait -ne [MapleSeasonProcessInterop]::WAIT_OBJECT_0) { throw "$Scenario launch drill could not confirm its parent exited', 'timeout-regression:orphan-case-reads-the-parent-wait')
  if (/\[void\]\[MapleSeasonProcessInterop\]::WaitForSingleObject\(\$launchedHandle, \[uint32\]30000\)/.test(browserTimeoutRegression)) errors.push('timeout-regression:orphan-case-discards-the-parent-wait')
  // A case that deliberately creates a process outliving its parent owes the workstation a guarantee that a
  // FAILING run - including one that failed because the repair under test is absent - does not leave it behind.
  // MEASURED: on the pre-repair helper this branch fired and killed a stranded node process.
  // The safety net kills by a PROCESS ID, and it had the very PID-reuse hazard the helper it guards was hardened
  // against: the CIM read that authorized the kill and the Stop-Process that performed it were two separate
  // lookups of one number, so the owner could exit between them and Windows could reissue that number to
  // something this suite never created. It also swallowed the outcome - SilentlyContinue, no wait, no re-read -
  // so it could announce a kill it had not performed and then delete the temporary directory that was the only
  // evidence tying the survivor to this suite. A fresh-context review found both.
  //
  // The first repair pinned `Get-Process -Id` alone and the comment here claimed the returned object holds an OS
  // handle that keeps the id reserved. A later fresh-context review said that is false, and it is: this repository
  // had already MEASURED the opposite about the helper this suite tests, and it was measured again -
  // haveProcessHandle is False after Get-Process -Id and still False after reading .HasExited, so .Kill()
  // re-resolves the id at call time and the reservation never existed. Reading .Handle is what opens one, measured
  // True immediately afterwards. So the pin is the whole block: the lookup, the handle touch, and a catch that
  // leaves $strandedHandle null - because a process this suite cannot pin is one it must refuse to kill, not one
  // it kills by a bare number.
  // MEASURED: on the pre-repair helper this branch fired and killed a stranded node process.
  requireStatementOnce(errors, browserTimeoutRegression, [
    '    try {',
    '      $strandedHandle = Get-Process -Id $strandedId -ErrorAction Stop',
    '      $null = $strandedHandle.Handle',
    '    } catch { $strandedHandle = $null }',
    '    if ($null -eq $strandedHandle) { continue }',
  ].join('\n'), 'timeout-regression:orphan-cleanup-pins-the-id-it-kills')
  requireStatementOnce(errors, browserTimeoutRegression, 'try { $strandedHandle.Kill(); [void]$strandedHandle.WaitForExit(10000) }', 'timeout-regression:orphan-case-cleans-up-after-itself')
  requireStatementOnce(errors, browserTimeoutRegression, 'if (-not $strandedHandle.HasExited) {', 'timeout-regression:orphan-cleanup-verifies-its-kill')
  requireStatementOnce(errors, browserTimeoutRegression, 'MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED_PORT_STILL_HELD', 'timeout-regression:orphan-cleanup-reports-a-still-held-port')
  if (/Stop-Process[^\n]*-ErrorAction SilentlyContinue/.test(browserTimeoutRegression)) errors.push('timeout-regression:orphan-cleanup-swallows-its-kill-outcome')
  // A PATH BOUNDARY, NOT A SUBSTRING, on the one test that AUTHORIZES a force kill in this file.
  // .Contains($tempRoot) also matched any sibling directory whose name merely begins with this one's, so an
  // unrelated process could be classified as this suite's own. A fresh-context review found it. Both halves are
  // pinned - the separator that makes the marker a boundary, and the comparison that uses it - because either one
  // alone is satisfiable while the other is reverted, and the forbid below is what closes the revert.
  requireStatementOnce(errors, browserTimeoutRegression, '$ownedPrefix = $tempRoot + [IO.Path]::DirectorySeparatorChar', 'timeout-regression:orphan-cleanup-builds-a-path-boundary-marker')
  requireStatementOnce(errors, browserTimeoutRegression, 'if (-not ([string]$strandedProcess.CommandLine).Contains($ownedPrefix)) { continue }', 'timeout-regression:orphan-cleanup-matches-on-the-boundary')
  if (/\.Contains\(\$tempRoot\)/.test(browserTimeoutRegressionCode)) errors.push('timeout-regression:orphan-cleanup-matches-a-bare-substring')
  // NO FAIL-OPEN LISTENER READ ANYWHERE IN THIS FILE. Every read here used -ErrorAction SilentlyContinue, so a
  // listener table that could not be queried answered "nothing is listening" - and three of those reads are the
  // ASSERTIONS that prove the repairs, which means a broken query reported the cases clean while a dev server held
  // the port. A fresh-context review named the two in the cleanup; the three assertions are worse and it did not.
  // A forbid rather than a set of presence pins, because the defect is a SHAPE that can reappear at any new read.
  if (/Get-NetTCPConnection/.test(browserTimeoutRegressionCode)) errors.push('timeout-regression:reads-listeners-without-the-fail-closed-probe')
  // ONE PORT DECLARATION, read by the case and by the cleanup. The orphan port was assigned inside the try and the
  // cleanup hard-coded 4290 beside it, so changing the case's port alone would have left the cleanup watching a
  // port nothing ran on while every pin above stayed green. A fresh-context review found it.
  requireStatementOnce(errors, browserTimeoutRegression, '$orphanPort = 4290', 'timeout-regression:orphan-port-is-declared-once')
  // AND WRITTEN ONCE. The pin above holds the literal, which a SECOND declaration assigning a different value
  // leaves perfectly intact - `$orphanPort = 4291` inside the try would run the case on one port while the cleanup
  // watched the other, which is the divergence this pin exists to stop rather than the spelling of one line.
  const orphanPortWrites = countPowerShellWrites(browserTimeoutRegression.split(/\r?\n/), 'orphanPort')
  if (orphanPortWrites !== 1) errors.push(`timeout-regression:orphan-port-is-written-once:${orphanPortWrites}`)
  if (/(?:LocalPort|-Port)\s+4290/.test(browserTimeoutRegressionCode)) errors.push('timeout-regression:orphan-cleanup-hard-codes-its-port')
  // THE CLEANUP MARKERS HAVE TO BE ABLE TO FAIL THE RUN. Everything above is output only, and the success path
  // prints PASS and `exit 0` inside the try, BEFORE the finally runs - so a run that stranded a live dev server
  // could announce PASS, exit 0, and leave the evidence in the same output for a caller that reads only the exit
  // code. A fresh-context review found it. MEASURED: a script exiting 0 in its try and 3 in its finally exits 3,
  // so the override below is real. The flag's declaration, the exit, and the presence of at least one write are
  // each held: a flag that is declared and consulted but never SET is the same silence with more code.
  requireStatementOnce(errors, browserTimeoutRegression, '$strandedReported = $false', 'timeout-regression:orphan-cleanup-declares-its-report-flag')
  requireStatementOnce(errors, browserTimeoutRegression, [
    '  if ($strandedReported) {',
  ].join('\n'), 'timeout-regression:orphan-cleanup-consults-its-report-flag')
  requireStatementOnce(errors, browserTimeoutRegression, "    exit 1\n  }\n}", 'timeout-regression:orphan-cleanup-overrides-a-passing-exit-code')
  // FOUR: the declaration plus one write for each way the cleanup can find the workstation unclean - an unreadable
  // listener table, a stranded process it named, and a port still held. Deleting any one of them silences that path
  // while the exit override above stays perfectly intact, so the count is the pin. It takes LINES, not the source
  // string: passed a string this returns undefined, `undefined < 4` is false, and the pin would pass on everything.
  const strandedReportWrites = countPowerShellWrites(browserTimeoutRegression.split(/\r?\n/), 'strandedReported')
  if (strandedReportWrites !== 4) errors.push(`timeout-regression:orphan-cleanup-sets-its-report-flag-on-every-path:${strandedReportWrites}`)
  const julyWiringRegression = read(root, 'scripts/maple-july-db-clock-wiring.regression.ps1')
  requireText(errors, julyWiringRegression, "'TOKENIZER_RECEIPT comparisons=33 distinct=33 tokens=90 windows=true'", 'july-wiring-regression:tokenizer-receipt-asserted-by-the-caller')
  // requireText, deliberately, and the ONE pin here that must stay a presence check: its needle IS a comment,
  // so requireStatementOnce - which drops comment-only lines before looking - could never find it. What this
  // pin protects is a declaration that the tokenizer diverges from the Win32 API on purpose; the divergence
  // itself is asserted by the regression, executably, so nothing load-bearing rests on this text.
  requireText(errors, seasonBrowser, '# ONE deliberate divergence from CommandLineToArgvW', 'season-browser:empty-divergence-is-declared')
  // ---------------------------------------------------------------------------------------------------
  // THE ONE KILL IN THIS FILE GOES THROUGH A WINDOWS JOB OBJECT, and every pin below holds a piece of that.
  // An entire previous generation of pins lived here - an OpenProcess by id, a FILETIME creation-time window,
  // a taskkill tree walk, a $verifiedPortRelease flag, a handle-before-predicate ordering - and all of them
  // existed to answer one question after the fact: is the process on this port one this scenario started?
  // Eight review rounds established that the question is not answerable from text, because a command line is
  // copyable and a process id is reusable. It IS answerable from provenance: the scenario creates a job,
  // starts its browser SUSPENDED, assigns it to the job, and only then lets it run, so every descendant is a
  // job member by kernel rule rather than by inference. Ownership is then IsProcessInJob, and the kill is
  // TerminateJobObject, which names no process id at all.
  //
  // So the pins below hold PROVENANCE rather than identity text: the job's kill-on-close limit, the
  // suspend-assign-resume order, the two refusals that fire when there is no job, the membership branch that
  // separates a survivor of our own tree from a stranger, the single unconditional cleanup call site, and the
  // handle-close order that leaves the kernel as the backstop of last resort. Every pin that read the deleted
  // machinery is gone, and what replaced it is a set of forbids: those shapes must stay deleted.
  //
  // EVERY POSITION BELOW IS MEASURED OVER COMMENT-STRIPPED SOURCE. A fresh-context review pointed out that an
  // index comparison is as satisfiable by a comment as a presence check is - these files quote their own
  // statements at length, so a pin comparing raw offsets can be held in order by two sentences of prose while
  // the real statements are gone or reordered. seasonBrowserExecutable, defined below, is the view every pin in
  // this section reads, and the two comment pins around it are what keep that view complete.
  // THE COMMENT-STRIPPED VIEW IS ONLY HONEST WHILE EVERY COMMENT IS ON ITS OWN LINE. powerShellStatements drops
  // comment-ONLY lines; it cannot drop a comment that trails a statement, because telling a real `#` from a `#`
  // inside a quoted string or a here-string needs a parser, and a wrong guess in that direction would delete
  // executable text and take a pin down with it. So instead of parsing, hold the property the simple strip
  // depends on: in these two files no line outside a comment-only line contains `#` at all. MEASURED today -
  // zero such lines in either file, so the strip is currently exact, and this pin is what keeps it exact. If a
  // trailing comment is ever genuinely wanted here, that is a deliberate decision to reopen the comment-
  // satisfaction hole, and it should fail this guard first rather than quietly weaken every pin above.
  //
  // BLOCK COMMENTS ARE CAUGHT BY THE SAME LINE, and that is worth saying out loud because it is currently a
  // side effect rather than a design. MEASURED against this exact helper: the BODY of a `<# ... #>` block
  // survives the line filter, so a statement quoted inside one would satisfy a pin that no code satisfies -
  // the layer-nine defeat in a third shape. What saves it today is that `<#` contains a `#` and is never
  // comment-ONLY by the test above, so the opener line is flagged in all three shapes measured: opener alone,
  // indented opener, and a single-line `<# ... #>`. That is a coincidence of spelling, and a plausible tidy-up
  // - widening the comment-only test to `/^\s*(#|<#)/` - would silently undo it. So the coincidence is held by
  // an executed drill rather than by this paragraph: see the block-comment mutation in the drill file.
  for (const [label, source] of [
    ['season-browser:no-inline-comments', seasonBrowser],
    ['browser-timeout-regression:no-inline-comments', browserTimeoutRegression],
  ]) {
    const trailing = source.split('\n').filter((line) => !/^\s*#/.test(line) && line.includes('#'))
    if (trailing.length > 0) errors.push(label)
  }
  // THE COMMENT-STRIPPED VIEW ABOVE KNOWS ONLY `#`, AND A THIRD OF THIS FILE IS C#. The interop source is a
  // here-string whose comments start with `//`, so a pin measured over a `#`-only strip is satisfiable
  // inside that region by a comment - the layer-nine defeat in a fourth shape, arriving through a language
  // boundary rather than through a here-string body. So the pins below use a stricter view that drops both
  // comment spellings. MEASURED on this file today: 18 whole-line `//` comments and ZERO trailing ones, so the
  // drop is currently exact, and the pin under it is what keeps it exact - including against a URL, which is
  // the innocent way a `//` arrives in the middle of a line.
  const seasonBrowserExecutable = seasonBrowser.split('\n').filter((line) => !/^\s*(#|\/\/)/.test(line)).join('\n')
  if (seasonBrowser.split('\n').some((line) => !/^\s*\/\//.test(line) && line.includes('//'))) {
    errors.push('season-browser:no-trailing-c-sharp-comments')
  }
  // Same contract as requireStatementOnce - absent is a failure and TWICE is also a failure, because a second
  // legitimate occurrence is exactly how a presence pin goes blind, and that defeat arrived from a repair here
  // rather than from an attacker - but measured over the stricter view.
  const pinBrowserOnce = (text, label) => {
    let count = 0
    for (let at = seasonBrowserExecutable.indexOf(text); at >= 0; at = seasonBrowserExecutable.indexOf(text, at + 1)) count += 1
    if (count === 0) errors.push(label)
    else if (count > 1) errors.push(`${label}-appears-more-than-once`)
  }
  const browserAt = (text) => seasonBrowserExecutable.indexOf(text)

  // ---- the job, and the limit that makes it a backstop no PowerShell statement can provide ------------
  // CONTIGUOUS, so the flag cannot be separated from the struct it is written into. This limit is the only
  // reason a killed, crashed or force-closed session still reaps its browser tree: the kernel terminates every
  // member as the last handle to the job closes, and handles close on process exit whatever killed the host.
  // Proven behaviourally on this workstation - two ports went from held to free after the probe closed both
  // handles, made no kill call and made no cleanup call.
  pinBrowserOnce([
    '    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;',
    '    int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));',
  ].join('\n'), 'season-browser:job-asks-for-kill-on-job-close')
  // A LIMIT ASKED FOR AND NEVER APPLIED IS NOT A LIMIT. The info class is inside the needle deliberately:
  // passing any other class leaves this call succeeding, the struct ignored, and the backstop silently absent.
  pinBrowserOnce('      if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size)) {', 'season-browser:job-limit-is-applied-to-the-job')
  // AND THE VALUE, not merely the name. KILL_ON_JOB_CLOSE is 0x2000; any other number reaches the kernel as a
  // different limit entirely, and both pins above stay green while nothing is ever reaped.
  pinBrowserOnce('  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;', 'season-browser:kill-on-job-close-is-the-documented-flag')
  // NEITHER FAILURE MAY DEGRADE INTO AN UNGOVERNED JOB: a job that could not be created returns nothing, and a
  // job whose limit could not be set is CLOSED rather than handed back, because a job without the limit is a
  // job whose members outlive this session.
  pinBrowserOnce('    if (job == IntPtr.Zero) { error = Marshal.GetLastWin32Error(); stage = "create"; return IntPtr.Zero; }', 'season-browser:job-creation-failure-returns-nothing')
  // AND THAT CLOSE IS CHECKED, so "the job was closed" is a fact rather than an intention. A fresh-context review
  // found the bare call here: the only handle to a just-created kernel object, discarded one statement before the
  // last reference to it went out of scope, with nothing able to say it had failed. Nothing is stranded when it
  // fails - this job never got its limit, so it would never have reaped anything - but the leak lasts the whole
  // session and the caller is already assembling a refusal a human will read. The pin is on the `if (!...)` form
  // and includes the sentence, because a check whose failure is not reported is the same silence in a longer
  // spelling.
  pinBrowserOnce([
    '        stage = "limit";',
  ].join('\n'), 'season-browser:job-limit-failure-reports-its-stage')
  pinBrowserOnce([
    '        if (!CloseHandle(job)) {',
    '          stage = "limit, and the unusable job object could not be closed (Windows error "',
    '            + Marshal.GetLastWin32Error().ToString() + "), so it leaked for the life of this session";',
    '        }',
    '        return IntPtr.Zero;',
  ].join('\n'), 'season-browser:job-without-its-limit-is-closed-not-returned')

  // ---- suspended, assigned, and only then resumed -----------------------------------------------------
  // THE ORDER IS THE ENTIRE GUARANTEE, so this compares three positions instead of asserting three presences.
  // Assigning a process that is already running leaves a window in which it can spawn a child OUTSIDE the job,
  // and that child is the dev server - the process that actually holds the governed port. CREATE_SUSPENDED is
  // therefore not a tidiness flag; deleting it reopens the exact hole the whole design exists to close, while
  // every other pin in this section stays green.
  pinBrowserOnce('        CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, workingDirectory, ref startup, out created)) {', 'season-browser:launch-creates-its-child-suspended')
  const createdSuspended = browserAt('CREATE_SUSPENDED | CREATE_NO_WINDOW')
  const assignedToJob = browserAt('if (!AssignProcessToJobObject(job, created.hProcess)) {')
  const resumedChild = browserAt('if (ResumeThread(created.hThread) == RESUME_THREAD_FAILED) {')
  if (createdSuspended < 0 || assignedToJob < 0 || resumedChild < 0 ||
      !(createdSuspended < assignedToJob && assignedToJob < resumedChild)) {
    errors.push('season-browser:child-is-assigned-to-the-job-before-it-runs')
  }
  // BOTH FAILURE PATHS CLEAN UP, AND THEY CLEAN UP DIFFERENTLY, which is why these are two pins and not one.
  // A child that could not be ASSIGNED is not a job member, so nothing but TerminateProcess can reach it; a
  // child that could not be RESUMED is already a member, so terminating the job is what kills it. The two
  // CloseHandle pairs are identical text, so each needle runs to the statement that follows it - a needle that
  // names both blocks names neither.
  //
  // AND THE ASSIGN PATH'S KILL IS PINNED AS A CHECKED CALL, not as a call. A fresh-context review found the
  // earlier version invoking TerminateProcess and discarding its bool, under a comment promising every failure
  // path terminated its child - the one claim in this file that KILL_ON_JOB_CLOSE cannot make true, because a
  // child that failed to be assigned is not a member and closing the job handle never touches it. So the pin is
  // on the `if (!...)` form: restoring the bare call reddens the gate.
  pinBrowserOnce([
    '      if (!TerminateProcess(created.hProcess, 1)) {',
    '        stage = "assign, and the suspended child could not be terminated (Windows error "',
    '          + Marshal.GetLastWin32Error().ToString() + ")";',
    '        processId = created.dwProcessId;',
    '      }',
    '      CloseHandle(created.hThread);',
    '      CloseHandle(created.hProcess);',
    '      return false;',
  ].join('\n'), 'season-browser:launch-terminates-a-child-it-could-not-assign')
  pinBrowserOnce([
    '      TerminateJobObject(job, 1);',
    '      CloseHandle(created.hThread);',
    '      CloseHandle(created.hProcess);',
    '      return false;',
  ].join('\n'), 'season-browser:launch-kills-the-job-of-a-child-it-could-not-resume')
  // THE INTEROP SURFACE IS NARROWED TO WHAT IS ACTUALLY CALLED, and that is a HARD boundary rather than a rule
  // in a comment: TerminateProcess is PRIVATE, so no PowerShell statement can reach THIS FILE'S kill primitive -
  // only its C# can, on the one path that needs it. Stated narrowly on purpose. An earlier version of this
  // comment said no PowerShell statement anywhere in the repository could invoke a kill that was not
  // TerminateJobObject, and that is simply false: Stop-Process and .Kill() exist, this repository's regression
  // scripts use them on processes they created themselves, and a private DllImport cannot revoke a cmdlet.
  // What the private modifier buys is exactly one thing - the season browser helper cannot kill by pid - and
  // overstating it in a comment is how a false sentence gets copied into a ledger entry, which is what
  // happened. GetProcessTimes and
  // PROCESS_TERMINATE went with it - their only caller was the creation-time reconciliation that existed to
  // prove a re-resolved process id still described the process the launch started, and CreateProcessW hands
  // back the HANDLE, so there is nothing to re-resolve. A right taken and never spent is what a fresh-context
  // review objected to, and the answer is to stop taking it.
  pinBrowserOnce('  static extern bool TerminateProcess(IntPtr process, uint exitCode);', 'season-browser:terminate-process-is-not-callable-from-powershell')

  // ---- the wait, and the constant that made an earlier version of it lie ------------------------------
  // WAIT_FAILED IS A NAMED C# CONSTANT because PowerShell reads the hex literal 0xFFFFFFFF as the SIGNED value
  // -1: `$waitResult -eq 0xFFFFFFFF` is false for every possible wait result, so a failed wait would have been
  // reported as an ordinary scenario timeout - a real diagnosis replaced by a plausible wrong one. MEASURED on
  // this workstation. The FORBID is the pin that carries the weight, because the literal can reappear at any
  // new comparison; the presence pins only say that today's comparisons are the named ones.
  pinBrowserOnce('  public const uint WAIT_FAILED = 0xFFFFFFFF;', 'season-browser:wait-failed-is-a-named-constant')
  pinBrowserOnce('    if ($waitResult -eq [MapleSeasonProcessInterop]::WAIT_FAILED) {', 'season-browser:launch-separates-a-failed-wait-from-a-timeout')
  if (/-eq\s+0xFFFFFFFF/.test(seasonBrowserExecutable)) errors.push('season-browser:launch-compares-a-wait-result-to-a-signed-hex-literal')
  pinBrowserOnce('    if ($waitResult -ne [MapleSeasonProcessInterop]::WAIT_OBJECT_0) {', 'season-browser:launch-treats-anything-but-signalled-as-a-timeout')
  pinBrowserOnce('    if (-not [MapleSeasonProcessInterop]::GetExitCodeProcess($launchedHandle, [ref]$exitCode)) {', 'season-browser:launch-reads-a-native-exit-code')
  pinBrowserOnce('    if ($exitCode -ne 0) { throw "$Scenario browser scenario failed with exit code $exitCode." }', 'season-browser:launch-fails-on-a-nonzero-exit-code')
  // THE TIMEOUT BRANCH DIAGNOSES AND DOES NOTHING ELSE - no kill, no cleanup call. That is enforced by the
  // single-call-site count further down rather than by a forbid here, because the property is "cleanup happens
  // in exactly one place", not "this branch avoids one spelling".
  pinBrowserOnce('      throw "$Scenario browser scenario exceeded its bounded process limit of $TimeoutMilliseconds milliseconds."', 'season-browser:launch-reports-its-own-timeout')

  // ---- Clear-MapleSeasonBrowserPort: refuse, kill the job, then classify what is left ------------------
  // NO JOB MEANS NO KILL. A caller that cannot name the job owning the tree has no authority to terminate
  // anything holding that port, and this refusal is what makes that structural instead of advisory. Held as a
  // contiguous block so the condition cannot survive with its throw replaced by a warning.
  pinBrowserOnce([
    '  if ($Job -eq [IntPtr]::Zero) {',
    '    throw "$Scenario was asked to release governed port $Port without the job that owns its browser tree; refusing to terminate anything."',
    '  }',
  ].join('\n'), 'season-browser:cleanup-refuses-a-caller-with-no-job')
  // AND REFUSES *BEFORE* IT KILLS, which is an order and not a presence: a refusal that runs after the
  // terminate call is decoration. Both positions are read from the executable view, so neither can be held in
  // place by the paragraph above them.
  const cleanupRefusal = browserAt('  if ($Job -eq [IntPtr]::Zero) {')
  const cleanupJobKill = browserAt('[MapleSeasonProcessInterop]::TerminateJobObject($Job, 1)')
  if (cleanupRefusal < 0 || cleanupJobKill < 0 || cleanupRefusal > cleanupJobKill) {
    errors.push('season-browser:cleanup-refuses-before-it-terminates-anything')
  }
  pinBrowserOnce('  if (-not [MapleSeasonProcessInterop]::TerminateJobObject($Job, 1)) {', 'season-browser:cleanup-kills-the-job-not-a-process-id')
  // ONE KILL IN THE WHOLE FILE AND IT NAMES NO PROCESS. Every other spelling is forbidden by SHAPE rather than
  // pinned by absence at one line, because a kill can reappear anywhere and an absence has no line number.
  // `.Kill()` and Stop-Process are the .NET and PowerShell forms; taskkill is the tree walk this design
  // deleted; the bracketed TerminateProcess is the interop form, which the private declaration above already
  // makes uninvokable - this is the pin that says so out loud if someone republishes it.
  for (const [pattern, label] of [
    [/\[MapleSeasonProcessInterop\]::TerminateProcess\(/, 'season-browser:kills-a-process-by-handle-from-powershell'],
    [/public static extern bool TerminateProcess/, 'season-browser:terminate-process-is-public-again'],
    [/taskkill/i, 'season-browser:kills-through-taskkill'],
    [/Stop-Process/, 'season-browser:kills-through-stop-process'],
    [/\.Kill\(\)/, 'season-browser:kills-through-a-dotnet-process-object'],
    [/GetProcessTimes/, 'season-browser:interop-still-declares-a-creation-time-read'],
    [/PROCESS_TERMINATE/, 'season-browser:interop-still-asks-for-terminate-rights'],
    [/SYNCHRONIZE/, 'season-browser:interop-still-asks-for-wait-rights'],
  ]) {
    if (pattern.test(seasonBrowserExecutable)) errors.push(label)
  }
  // THE DRAIN LOOP RETURNS ONLY ON AN OBSERVED FREE PORT. A cleanup that returns because its kill call
  // returned has proven the call and not the outcome, and the outcome is the entire claim.
  pinBrowserOnce([
    '    $remaining = @(Get-MapleSeasonPortListener -Port $Port -Scenario $Scenario)',
    '    if ($remaining.Count -eq 0) { return }',
  ].join('\n'), 'season-browser:port-cleanup-returns-only-on-an-observed-free-port')
  // MEMBERSHIP IS THE CLASSIFIER, and it is the one fact in this file that comes from the kernel rather than
  // from text. A survivor inside this job is our own and its survival is a defect here; a survivor outside it
  // is somebody else's process, and it is named and never touched. Sabotage-proven: forcing this branch to
  // `if ($true)` turned the port-preflight regression red on exactly the stranger case.
  pinBrowserOnce('      if ($inJob) { $members.Add("pid $listenerId") } else { $strangers.Add("pid $listenerId") }', 'season-browser:cleanup-classifies-survivors-by-job-membership')
  // THE CLASSIFICATION PASS AUTHORIZES NOTHING, and its handles are released on the throwing path too - which
  // requires a `finally`, not a `catch` and not a trailing loop. All three verdicts below throw, so the loop
  // would never run if it sat after the block.
  pinBrowserOnce('  } finally {\n    foreach ($open in $survivorHandles) {', 'season-browser:cleanup-closes-its-inspection-handles-on-every-path')
  pinBrowserOnce('      if (-not [MapleSeasonProcessInterop]::CloseHandle($open)) {', 'season-browser:cleanup-reports-a-handle-it-could-not-close')
  // THE THREE VERDICTS ARE HELD WORD FOR WORD, because the port-preflight regression asserts these exact
  // sentences at runtime: reword one silently and that suite keeps passing on a message it will never see
  // again. Two of the three are sabotage-proven from the other direction as well.
  pinBrowserOnce('    throw "$Scenario terminated the job owning its browser tree and $($members -join \', \') survived still holding governed port $Port.$footnote"', 'season-browser:cleanup-reports-a-surviving-member-of-its-own-tree')
  pinBrowserOnce('    throw "$Scenario terminated its own browser tree, but $($strangers -join \', \') is not in that job and still holds governed port $Port, so it is not a process this scenario launched and it refused to terminate it.$footnote"', 'season-browser:cleanup-names-a-stranger-and-refuses-to-touch-it')
  pinBrowserOnce('  throw "$Scenario browser server cleanup did not release governed port $Port, and it could not establish what still holds it ($($unreadable -join \'; \')).$footnote"', 'season-browser:cleanup-admits-when-it-cannot-tell-what-holds-the-port')

  // ---- the launch: the job exists before the process, and the try opens before the launch --------------
  // A TREE THIS FILE CANNOT PROVE IT OWNS IS A TREE IT CANNOT CLEAN UP, so a job that will not create is a
  // refusal to launch rather than an ungoverned start. Contiguous, because the creation call and the check on
  // its result are one statement in two lines.
  pinBrowserOnce([
    '  $job = [MapleSeasonProcessInterop]::CreateKillOnCloseJob([ref]$jobError, [ref]$jobStage)',
    '  if ($job -eq [IntPtr]::Zero) {',
    '    throw "$Scenario could not create the job object that would own its browser process tree (failed at the $jobStage stage, Windows error $jobError), so it refused to launch a process tree it could not prove it owned."',
    '  }',
  ].join('\n'), 'season-browser:launch-refuses-to-start-a-tree-it-cannot-own')
  // ORDER: create the job, open the try, then start the child. The try opening BEFORE the launch is a reversal
  // of the previous arrangement and it is deliberate - it routes a throw from the launch itself into the
  // finally that closes the job, and closing the job is itself the kill. The old placement was correct for a
  // design whose cleanup depended on later statements succeeding; this one does not.
  const jobCreated = browserAt('$job = [MapleSeasonProcessInterop]::CreateKillOnCloseJob(')
  const tryOpened = browserAt('\n  try {\n    $launchError = 0')
  const childStarted = browserAt('[MapleSeasonProcessInterop]::StartInJob($job, $node, $commandLine, $Root,')
  if (jobCreated < 0 || tryOpened < 0 || childStarted < 0 ||
      !(jobCreated < tryOpened && tryOpened < childStarted)) {
    errors.push('season-browser:launch-opens-its-try-before-it-starts-anything')
  }
  pinBrowserOnce('    if (-not [MapleSeasonProcessInterop]::StartInJob($job, $node, $commandLine, $Root, [ref]$launchedHandle, [ref]$launchedId, [ref]$launchError, [ref]$launchStage)) {', 'season-browser:launch-fails-when-its-child-does-not-start')
  // AND THE REFUSAL NAMES THE STRANDED PROCESS, because the interop's report is worthless if the PowerShell that
  // receives it drops it. StartInJob leaves processId at 0 on every failure it cleaned up after, so a nonzero id
  // at this throw means precisely one state: a suspended child that is not a job member, that closing the job
  // handle will never reap, that will never run and never exit, and whose pid this is the last statement able to
  // name. Contiguous with the throw, so a repair that keeps the clause but stops interpolating it is not
  // satisfied by this pin.
  pinBrowserOnce([
    '      $strandedClause = \'\'',
    '      if ($launchedId -ne 0) {',
    '        $strandedClause = " Process id $launchedId was created suspended, could not be added to the job, and could not be terminated, so it is still running on this workstation and has to be ended by hand."',
    '      }',
    '      throw "$Scenario browser process did not start (failed at the $launchStage stage, Windows error $launchError).$strandedClause"',
  ].join('\n'), 'season-browser:launch-names-a-child-it-could-not-terminate')
  // EXACTLY ONE CLEANUP CALL SITE, and it is the unconditional one in the finally. Every previous version of
  // this function had two or three, each guarded by a different condition - the parent's liveness, then a
  // $portReleased flag, then a $verifiedPortRelease flag - and every one of those conditions was an attempt to
  // answer "is that listener mine?" from something other than the fact. A second call site is how that returns,
  // and a count is the only pin that sees it: each individual site looks perfectly reasonable.
  const cleanupCallSites = (seasonBrowserExecutable.match(/Clear-MapleSeasonBrowserPort -Port/g) ?? []).length
  if (cleanupCallSites !== 1) {
    errors.push(`season-browser:cleanup-is-called-from-exactly-one-place (found ${cleanupCallSites} call sites, expected 1 - the unconditional call in the finally)`)
  }
  // UNCONDITIONAL BECAUSE JOB MEMBERSHIP ALREADY ANSWERS THE OWNERSHIP QUESTION, and WRAPPED because a cleanup
  // failure must annotate the scenario's verdict rather than replace it. Both halves are in one needle: making
  // it conditional again and swallowing its failure are the two ways this line degrades.
  pinBrowserOnce([
    '    try { Clear-MapleSeasonBrowserPort -Port $port -Job $job -Scenario $Scenario }',
    '    catch { $footnotes.Add("could not release governed port ${port}: $($_.Exception.Message)") }',
  ].join('\n'), 'season-browser:cleanup-runs-unconditionally-and-cannot-mask-a-verdict')
  // THE PROCESS HANDLE CLOSES FIRST AND THE JOB HANDLE CLOSES LAST, wrapped separately so a failure closing
  // the first cannot skip the second. This is an order pin because the job close is the backstop: it must be
  // the last thing that happens, and it must happen even when everything above it failed.
  const processHandleClose = browserAt('if ($launchedHandle -ne [IntPtr]::Zero -and -not [MapleSeasonProcessInterop]::CloseHandle($launchedHandle)) {')
  const jobHandleClose = browserAt('if (-not [MapleSeasonProcessInterop]::CloseHandle($job)) {')
  if (processHandleClose < 0 || jobHandleClose < 0 || processHandleClose > jobHandleClose) {
    errors.push('season-browser:launch-closes-the-process-handle-before-the-job-handle')
  }
  pinBrowserOnce('        $footnotes.Add("could not close the handle on browser pid $launchedId (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so that id stays reserved for the life of this session")', 'season-browser:launch-reports-a-leaked-pin')
  pinBrowserOnce('        $footnotes.Add("could not close the job object owning its browser process tree (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so any surviving member of that tree was not reaped by the kernel either")', 'season-browser:launch-reports-a-job-it-could-not-close')
  // A SUCCESSFUL SCENARIO THAT LEAKED STILL FAILS. This was a warning on both paths once, so a season proof
  // could return success having reported its own leak, and only one regression happened to read the warning
  // stream. -WarningAction Continue is pinned on the downgrade because Write-Warning honours $WarningPreference:
  // MEASURED, a caller passing -WarningAction Stop turned this footnote into a terminating error inside the
  // finally and the real diagnosis was replaced by "the preference variable ... is set to Stop".
  pinBrowserOnce('      if ($primaryFailure) { Write-Warning $report -WarningAction Continue } else { throw $report }', 'season-browser:launch-fails-a-successful-scenario-that-leaked')

  // ---- the deleted machinery must stay deleted --------------------------------------------------------
  // Each shape below existed only to compensate for killing by process id, and each was individually broken by
  // a fresh-context review before it was removed. Forbids rather than pins, for the same reason as the kill
  // spellings above: what must be true is an absence.
  for (const [pattern, label] of [
    [/ProcessStartInfo/, 'season-browser:launch-goes-back-through-a-dotnet-process-object'],
    [/New-Object\s+Process/, 'season-browser:launch-constructs-a-dotnet-process'],
    [/\$process\./, 'season-browser:launch-manages-a-dotnet-process-object'],
    [/verifiedPortRelease/, 'season-browser:launch-still-remembers-a-verified-release'],
    [/portReleased/, 'season-browser:launch-still-remembers-a-release-flag'],
    [/\$launchCreation/, 'season-browser:launch-still-reconciles-a-creation-time'],
  ]) {
    if (pattern.test(seasonBrowserExecutable)) errors.push(label)
  }
  // THE OWNERSHIP PREDICATE IS DIAGNOSIS ONLY, AND ITS REACH IS THE PIN. Exactly two occurrences in executable
  // text: its own definition, and the one refusal message it shades inside the preflight. MEASURED that it
  // cannot do more than that - on a genuinely foreign node process started by hand inside this tree, the old
  // predicate returned True, which is the finding that moved kill authority to job membership in the first
  // place. A third occurrence is how a text-derived ownership guess creeps back into a kill path.
  const predicateMentions = (seasonBrowserExecutable.match(/Test-MapleSeasonBrowserPortOwned/g) ?? []).length
  if (predicateMentions !== 2) {
    errors.push(`season-browser:ownership-predicate-is-diagnosis-only (found ${predicateMentions} occurrences, expected 2 - its definition and the preflight refusal)`)
  }
  // Fail-closed listener probe, in ONE place. Every caller must go through Get-MapleSeasonPortListener,
  // whose only swallowed error is the measured "nothing is listening" one; a bare SilentlyContinue probe
  // reads a BROKEN query as a free port, which is the single direction this file must never fail.
  // -ceq against the COMPLETE id, not `-like 'CmdletizationQuery_NotFound*'`. The prefix form accepted any
  // future not-found id from any cmdlet as "the port is free"; the exact id was measured identical on
  // Windows PowerShell 5.1 and pwsh 7.6.3, and an invalid port produces a different id on both.
  requireStatementOnce(errors, seasonBrowser, "if ($_.FullyQualifiedErrorId -ceq 'CmdletizationQuery_NotFound,Get-NetTCPConnection') { return @() }", 'season-browser:listener-probe-fails-closed')
  // Count CALL SITES, not mentions: the cmdlet name is discussed in three comments in this file, and a
  // mention count would have to move every time one of those comments is reworded. A call always carries
  // a parameter, so `Get-NetTCPConnection` followed by a dash is the invocation and the prose is not.
  const seasonBrowserNetQueries = (seasonBrowser.match(/Get-NetTCPConnection\s+-/g) ?? []).length
  if (seasonBrowserNetQueries !== 1) {
    errors.push(`season-browser:listener-probe-is-the-only-net-query (found ${seasonBrowserNetQueries} Get-NetTCPConnection call sites, expected 1 - the one inside Get-MapleSeasonPortListener)`)
  }

  // ---------------------------------------------------------------------------------------------------
  // Every pin above this line, and every mutation drilled against them, reads the ownership predicate as
  // TEXT. Measured on the author's workstation, AT A TIME WHEN THAT PREDICATE STILL GATED A FORCE KILL:
  // inserting `return $true` at the top of Test-MapleSeasonBrowserPortOwned - which then authorized
  // killing every listener on the governed port, a foreign one included - left this guard printing PASS
  // and the mutation drill printing PASS with all
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
  const staticClaim = 'Foundation mutation drill: PASS (285 controlled mutations turned the gate red)'
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
  // COUNTING THE CALLS IS NOT COUNTING THE MUTATIONS. The pin above proves the total is computed rather than
  // written down, and a fresh-context review showed that is a weaker claim than the sentence makes: `detected`
  // only re-runs the guard and looks for a label, so two `detected` calls after ONE `mutate` both pass and the
  // total counts a mutation that was never applied. So the count is spent: `mutate` records the write it made,
  // `detected` refuses when nothing is pending and clears the record. All three parts are load-bearing and each
  // fails differently, so the shape is pinned CONTIGUOUSLY - a refusal placed after the clear refuses nothing,
  // and a clear that never runs lets one mutation be counted by every detection that follows it.
  // Line-anchored because this file's drills patch their own source, so their replacement literals contain the
  // text of the statements they patch; a plain presence pin over this file is satisfiable by a string argument.
  requireMatch(errors, mutationDrill, /^ *if \(pendingMutations === 0\) throw new Error\(`\$\{label\} claims a controlled mutation.*\n *const failures = foundationStaticGuard\(temporary\)\n *if \(!failures\.includes\(expected\)\) throw new Error.*\n *pendingMutations = 0\n *detectedMutations\.push\(label\)$/m, 'mutation-drill:detection-spends-an-applied-mutation')
  requireMatch(errors, mutationDrill, /^ *writeFileSync\(target, after\)\n *pendingMutations \+= 1$/m, 'mutation-drill:mutate-counts-only-a-write-it-made')
  // AND EXACTLY ONE OF THEM. The contiguous pin above stays green if a SECOND increment is added higher up in
  // `mutate` - above the stale-needle refusal, where it would count a mutation that never applied while the
  // pinned pair below it is untouched. Same defect the orphan port's write count exists to refuse.
  const pendingIncrements = (mutationDrill.match(/^ *pendingMutations \+= 1$/gm) ?? []).length
  if (pendingIncrements !== 1) errors.push(`mutation-drill:mutate-counts-a-write-exactly-once:${pendingIncrements}`)

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
