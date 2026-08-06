import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { foundationStaticGuard } from './foundation-static-guards.mjs'

// Windows Desktop PowerShell is `powershell`; everywhere else the cross-platform build is `pwsh`. Same
// resolution scripts/foundation-windows-lane-runtime-drill.mjs already uses, so both node-side drills
// reach the same shell.
const onWindows = process.platform === 'win32'

const root = resolve(process.cwd())
const temporary = mkdtempSync(join(tmpdir(), 'farmrx-foundation-mutations-'))
const files = [
  'docs/password-recovery-support.md',
  'src/App.tsx', 'src/main.tsx', 'src/sw.ts', 'src/auth/AuthProvider.tsx', 'src/auth/passwordRecovery.ts', 'src/components/MarketQuote.tsx', 'src/data/workspaceCache.ts', 'public/market-quote-frame.html', 'vercel.json', 'vite.config.ts',
  'scripts/provision-customer-lib.mjs', 'scripts/verify-foundation.ps1',
  // The three files the Windows-lane guards read besides the orchestrator: the out-of-process drill, the
  // kill-authorizing predicate, and the workflow that asserts the orchestrator's completion marker from
  // outside it. All three have to exist in the baseline copy or the guard cannot run against it.
  'scripts/foundation-windows-lane-runtime-drill.mjs', 'scripts/maple-season-browser.ps1', '.github/workflows/foundation.yml',
  // The predicate's regression, because the guard now pins the tokenizer's equivalence table there: the
  // rules in Split-MapleSeasonCommandLineArguments are only trustworthy while something compares them to
  // CommandLineToArgvW, so deleting that comparison has to fail the guard.
  'scripts/maple-season-browser-port-preflight.regression.ps1',
  // The behavioural suite over the same predicate. It is the only gate that can tell a working predicate
  // from one edited to `return $true`, so the guard reads it and the drills below mutate it.
  'scripts/maple-season-browser-ownership.regression.ps1',
  // The lane that CHAINS the predicate's regression, because it holds the tokenizer receipt's expected count
  // longhand - the second of the two channels that prove the equivalence table executed rather than merely
  // being present. The guard reads it, so the baseline copy needs it.
  'scripts/maple-july-db-clock-wiring.regression.ps1',
  // THIS FILE, because the static guard now reads it. A fresh-context review showed why: stubbing the runner
  // below to return `{ status: 1, output: expected }` scored all five behavioural subjects without starting a
  // single child process, and nothing looked at this file to notice. Its own drills mutate the copy, never the
  // original, so the pins over it are exercised the same way every other pin here is.
  'scripts/verify-foundation-mutations.mjs',
  // The season start fixture and every script that applies it. The static guard discovers the
  // consumers by scanning scripts/, so all of them have to exist here or the baseline is not the
  // same shape as the repository.
  'tests/season/maple-2027-start.sql',
  'scripts/verify-maple-season-start-disposable.ps1', 'scripts/verify-program-assignment-identities-disposable.ps1', 'scripts/maple-season-credential.regression.ps1',
  'supabase/migrations/20260711154325_module1_rls.sql', 'supabase/migrations/20260716122155_0037_scheduled_alert_foundation.sql', 'supabase/migrations/20260716122229_0041_unscoped_authenticated_write_fencing.sql',
  'src/data/SupabaseNotificationsDataGateway.ts', 'src/data/queuedOperationGuard.ts',
  'src/data/fieldLocation.ts', 'src/data/QueuedEquipmentTasksRepository.ts', 'src/data/QueuedFieldLogRepository.ts',
  'src/data/QueuedFieldsRepository.ts', 'src/data/QueuedGrainRepository.ts', 'src/data/QueuedHarvestRepository.ts',
  'src/data/QueuedInventoryRepository.ts', 'src/data/QueuedNotificationsRepository.ts', 'src/data/QueuedProfitabilityRepository.ts',
  'src/data/QueuedProgramsRepository.ts', 'src/data/QueuedScoutingRepository.ts',
]
const reset = () => { for (const path of files) { const target = join(temporary, path); mkdirSync(dirname(target), { recursive: true }); cpSync(join(root, path), target) } }
// A mutation is only a test if it actually applies. String.replace with a needle that no longer occurs
// returns the original silently, so the drill then runs the static guard against UNMODIFIED source, the
// guard is green because nothing was broken, and the failure surfaces as an empty "Observed:" list that
// reads like the guard went blind. Measured: that is exactly how a stale needle presented after the
// accounting probe was rewritten. Refusing a no-op mutation names the stale needle instead.
const mutate = (path, replace) => {
  const target = join(temporary, path)
  const before = readFileSync(target, 'utf8')
  const after = replace(before)
  if (after === before) throw new Error(`Mutation no longer applies to ${path}; its needle is stale: ${replace.toString()}`)
  writeFileSync(target, after)
}
// Count the drills instead of restating the total in the summary line. The hand-written count went
// stale the moment a drill was added, which made the summary claim coverage it had not measured.
const detectedMutations = []
const detected = (label, expected) => {
  const failures = foundationStaticGuard(temporary)
  if (!failures.includes(expected)) throw new Error(`${label} mutation was not detected. Observed: ${failures.join(', ')}`)
  detectedMutations.push(label)
  console.log(`Mutation detected: ${label}`)
}

try {
  reset()
  if (foundationStaticGuard(temporary).length) throw new Error('Static guard baseline was not green before mutation drills.')
  // Drill the no-op guard itself. Every one of the mutations below is only a test while its needle still
  // matches, so the guard above is load-bearing for this entire file - and deleting it would leave all of
  // them green while some of them tested untouched source. Nothing else in this repository would notice,
  // so the guard gets its own executed self-test: supply a deliberately stale needle and require the
  // named refusal. Run against the baseline copy, and it must leave that copy byte-identical.
  const baselineBefore = readFileSync(join(temporary, 'src/App.tsx'), 'utf8')
  let staleNeedleRefusal = null
  try {
    mutate('src/App.tsx', (source) => source.replace('a needle that this file will never contain', 'x'))
  } catch (error) {
    staleNeedleRefusal = error.message
  }
  if (staleNeedleRefusal === null) throw new Error('The mutation helper accepted a needle that does not match; every drill in this file would then be able to test unmodified source.')
  if (!staleNeedleRefusal.startsWith('Mutation no longer applies to src/App.tsx; its needle is stale:')) throw new Error(`The mutation helper refused a stale needle without naming it: ${staleNeedleRefusal}`)
  if (readFileSync(join(temporary, 'src/App.tsx'), 'utf8') !== baselineBefore) throw new Error('The mutation helper wrote to the baseline copy while refusing a stale needle.')
  // Not counted as a controlled mutation: it drills this file's own helper rather than a repository guard,
  // and folding it into that total would inflate a number the summary line reports as coverage.
  console.log('Mutation helper self-test: a stale needle is refused and named')
  mutate('src/App.tsx', (source) => source.replace('path="/grain/*"', 'path="/grain-broken/*"'))
  detected('ordered route manifest change', 'routes:exact-ordered-manifest')
  reset()
  mutate('src/App.tsx', (source) => source.replace('key={user.id} user={user}', 'key="shared-account" user={user}'))
  detected('cross-account farm gate reuse', 'identity:keyed-farm-access-gate')
  reset()
  mutate('supabase/migrations/20260716122229_0041_unscoped_authenticated_write_fencing.sql', (source) => source.replace('perform public.assert_current_farm_access_epoch(p_farm_id);', 'perform null;'))
  detected('unscoped RPC epoch fence removal', 'rpc:unscoped-write-fences')
  reset()
  mutate('src/data/SupabaseNotificationsDataGateway.ts', (source) => source.replace('p_farm_id: context.farmId', "p_farm_id: 'shared-farm'"))
  detected('push farm context removal', 'rpc:push-farm-context-forwarding')
  reset()
  mutate('supabase/migrations/20260716122229_0041_unscoped_authenticated_write_fencing.sql', (source) => source.replace('where push_subscriptions.user_id = v_caller', 'where true'))
  detected('push endpoint owner fence removal', 'rpc:push-endpoint-owner-fence')
  reset()
  mutate('supabase/migrations/20260716122229_0041_unscoped_authenticated_write_fencing.sql', (source) => source.replace('revoke insert, update, delete on table public.push_subscriptions from public, anon, authenticated;', 'grant insert, update, delete on table public.push_subscriptions to authenticated;'))
  detected('push direct-table write revoke removal', 'table:push-direct-write-revoked')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-0033-disposable.ps1') }", "& (Join-Path $PSScriptRoot 'verify-0033-disposable.ps1')"))
  detected('intermediate foundation exit check removal', 'orchestrator:invoke-lane-statements')
  reset()
  // The Windows execution lane is the only thing in the repository that runs the port-ownership
  // predicate gating the force kill, so every way of losing that coverage gets its own drill and must be
  // reported as itself rather than as a generic count mismatch.
  //
  // The first drill is the one that matters most, and it is here because an adversarial review defeated
  // the previous version of this block. The old drill replaced the call with '# lane call removed',
  // which deletes the identifier and so was caught by an occurrence count. Simply COMMENTING the call
  // out - prepending one '#' - leaves the identifier present, keeps the count at two, and stays green
  // while the lane never runs. That is the mutation below, and the pin it must trip is a whole-line
  // match rather than a count.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('\n  Invoke-FoundationWindowsExecutionLane\n', '\n  # Invoke-FoundationWindowsExecutionLane\n'))
  detected('Windows execution lane call commented out with the name left in place', 'orchestrator:windows-execution-lane-called')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('\n  Assert-FoundationWindowsExecutionLaneAccountedFor\n', '\n  # Assert-FoundationWindowsExecutionLaneAccountedFor\n'))
  detected('Windows execution lane runtime accounting check commented out', 'orchestrator:windows-execution-lane-accounted-for-called')
  reset()
  // The runtime accounting check is the only non-text coverage over this lane, so losing the probe that
  // proves it still throws would leave it trusted rather than tested. Both its call site and its
  // assertion are mutated: silence the probe, and a runtime check quietly reduced to a no-op stays green.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('\n  Assert-FoundationWindowsExecutionLaneAccountingIsFatal\n', '\n  # Assert-FoundationWindowsExecutionLaneAccountingIsFatal\n'))
  detected('Windows execution lane accounting probe commented out', 'orchestrator:windows-execution-lane-accounting-probe-called')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('if ($null -eq $failure) { throw "Foundation Windows execution lane accounting accepted an outcome of [$($case.Label)]." }', 'if ($null -eq $failure) { Write-Output \'tolerated\' }'))
  detected('Windows execution lane accounting probe stops asserting', 'orchestrator:windows-execution-lane-accounting-probe-asserts')
  reset()
  // Without the evidence cross-check, a lane that assigns its outcome at the top and returns satisfies
  // the runtime accounting while running nothing, and no text assertion can see the difference.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("if ($script:windowsExecutionLaneOutcome -ceq 'executed' -and $script:windowsExecutionOutput -cnotcontains 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS') {", 'if ($false) {'))
  detected('Windows execution lane execution claim no longer needs evidence', 'orchestrator:windows-execution-lane-evidenced-execution')
  reset()
  // Replacing the platform test with something always true makes the lane skip on every platform,
  // including the Windows workstation where it is the only real coverage.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("if (-not ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows)) {", 'if ($true) {'))
  detected('Windows execution lane platform gate always skips', 'orchestrator:windows-execution-lane-platform-gate')
  reset()
  // Swapping the child invocation for one that echoes the marker itself satisfies both the exit-code
  // check and the marker check while executing nothing. The chain pin cannot see it, because a mutation
  // like this keeps the $wiring assignment line intact.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('-ExecutionPolicy Bypass -File $wiring)', "-Command 'Write-Output \"MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS\"')"))
  detected('Windows execution lane child replaced by an echo of its own marker', 'orchestrator:windows-execution-lane-invocation')
  reset()
  // Restoring the 2>&1 redirect. Under Windows PowerShell 5.1 that turns one stderr line from a
  // PASSING child into a terminating NativeCommandError, so the gate goes red on a good run and relays
  // nothing on a bad one.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('-ExecutionPolicy Bypass -File $wiring)', '-ExecutionPolicy Bypass -File $wiring 2>&1)'))
  detected('Windows execution lane stderr merge reintroduced', 'orchestrator:windows-execution-lane-no-stderr-merge')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('maple-july-db-clock-wiring.regression.ps1', 'unrelated.regression.ps1'))
  detected('Windows execution lane points at another chain', 'orchestrator:windows-execution-lane-chain')
  reset()
  // Dropping the marker requirement leaves an exit-code check, which a child that dies early or does
  // nothing at all can satisfy. Mutating the whole statement, not just the marker string, because the
  // string alone also occurs in the comment above it.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("if ($script:windowsExecutionOutput -cnotcontains 'MAPLE_JULY_DB_CLOCK_WIRING_REGRESSION_PASS') {", 'if ($false) {'))
  detected('Windows execution lane completion marker removal', 'orchestrator:windows-execution-lane-marker')
  reset()
  // Turning the honest skip into a pass is the failure mode that matters most on CI, where the skip is
  // the branch actually taken: it would report earned coverage on a platform that ran nothing.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('SKIPPED (Windows-only cmdlets; no credit claimed)', 'PASS'))
  detected('Windows execution lane skip reported as a pass', 'orchestrator:windows-execution-lane-honest-skip')
  reset()
  // Letting the lane report 'skipped' on Windows without objecting is how the runtime accounting check
  // would be hollowed out while still appearing to be present.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("if ($onWindows -and $script:windowsExecutionLaneOutcome -cne 'executed') {", 'if ($false) {'))
  detected('Windows execution lane allowed to skip itself on Windows', 'orchestrator:windows-execution-lane-windows-must-execute')
  reset()
  // The accounting probe's positive control. Removing it leaves a rejection-only probe, which a forged
  // accounting that throws unconditionally satisfies - measured, exactly that forgery then passed both
  // the probe and the real check.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("      @{ Outcome = 'executed'; Output = @('a preceding line', $marker); Expected = $null; Label = 'executed with evidence' }", "      @{ Outcome = 'ran'; Output = @(); Expected = 'Foundation Windows execution lane recorded an unknown outcome: ran.'; Label = 'a second rejection' }"))
  detected('Windows execution lane accounting probe loses its positive control', 'orchestrator:windows-execution-lane-accounting-probe-positive-control')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('throw "Foundation Windows execution lane accounting rejected an evidenced execution [$($case.Label)]: $failure"', 'Write-Output "ignored"'))
  detected('Windows execution lane accounting probe stops asserting its accept case', 'orchestrator:windows-execution-lane-accounting-probe-accept-asserts')
  reset()
  // The out-of-process behavioral drill: its lane, and the two cases that carry the coverage. Commenting
  // the lane out with the name left in place is the same one-character defeat the whole-line pins exist
  // for, so it is drilled the same way.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("\n  Invoke-FoundationLane { & node scripts/foundation-windows-lane-runtime-drill.mjs } 'Foundation Windows lane runtime drill failed.'\n", "\n  # Invoke-FoundationLane { & node scripts/foundation-windows-lane-runtime-drill.mjs } 'Foundation Windows lane runtime drill failed.'\n"))
  detected('Windows lane runtime drill lane commented out with the name left in place', 'orchestrator:windows-lane-runtime-drill-lane')
  reset()
  mutate('scripts/foundation-windows-lane-runtime-drill.mjs', (source) => source.replace("label: 'lane call removed entirely'", "label: 'lane call left in place'"))
  detected('runtime drill drops the case a forged accounting cannot survive', 'runtime-drill:lane-call-removed-case')
  reset()
  mutate('scripts/foundation-windows-lane-runtime-drill.mjs', (source) => source.replace("label: 'accounting forged to recognize its own probe'", "label: 'accounting left alone'"))
  detected('runtime drill drops the probe-forgery regression', 'runtime-drill:probe-forgery-case')
  reset()
  mutate('scripts/foundation-windows-lane-runtime-drill.mjs', (source) => source.replace("label: 'an evidenced execution is accepted'", "label: 'an evidenced execution is ignored'"))
  detected('runtime drill drops its own positive control', 'runtime-drill:positive-control-case')
  reset()
  mutate('scripts/foundation-windows-lane-runtime-drill.mjs', (source) => source.replace('if (anchorIndex < 0) throw new Error(', 'if (false) throw new Error('))
  detected('runtime drill no longer fails closed on a missing slice anchor', 'runtime-drill:slice-anchor-fails-closed')
  reset()
  // The completion marker, and the assertion over it that lives outside the orchestrator. A top-level
  // `return` above the lanes keeps every text pin in the script and skips this line, so the marker is
  // the only thing that edit cannot preserve - and the check on it has to live in another file.
  mutate('.github/workflows/foundation.yml', (source) => source.replace("Select-String -LiteralPath foundation-gate.log -SimpleMatch -CaseSensitive -Pattern 'Farm Rx foundation gate: PASS' -Quiet", 'Select-String -LiteralPath foundation-gate.log -SimpleMatch -Pattern \'gate\' -Quiet'))
  detected('CI stops asserting the foundation completion marker', 'workflow:foundation-completion-marker-asserted')
  reset()
  mutate('.github/workflows/foundation.yml', (source) => source.replace("throw 'Foundation gate did not print its completion marker.'", "Write-Output 'marker missing'"))
  detected('CI marker assertion downgraded to a message', 'workflow:foundation-completion-marker-fatal')
  reset()
  // Each of the three independent steps, removed one at a time. Losing any of them puts that gate back
  // behind the orchestrator, where an orchestrator that lies about running it is enough to skip it.
  mutate('.github/workflows/foundation.yml', (source) => source.replace('run: node scripts/foundation-static-guards.mjs', 'run: echo skipped'))
  detected('CI stops running the static guards itself', 'workflow:static-guards-run-independently')
  reset()
  mutate('.github/workflows/foundation.yml', (source) => source.replace('$drill = @(node scripts/verify-foundation-mutations.mjs)', '$drill = @()'))
  detected('CI stops running the mutation drill itself', 'workflow:mutation-drill-run-independently')
  reset()
  mutate('.github/workflows/foundation.yml', (source) => source.replace('run: node scripts/foundation-windows-lane-runtime-drill.mjs', 'run: echo skipped'))
  detected('CI stops running the lane runtime drill itself', 'workflow:runtime-drill-run-independently')
  reset()
  // The behavioural suite over the kill-authorizing predicate, and the reason it exists: every mutation
  // in this file drills a SUBSTRING PIN, and inserting `return $true` at the top of the predicate was
  // measured to leave this drill green with every one of its mutations detected, because no pinned substring
  // had moved. The drills below therefore protect a suite that CALLS the predicate - its two callers, the
  // self-test that makes it non-vacuous, and the challenge that makes its completion marker mean something.
  mutate('.github/workflows/foundation.yml', (source) => source.replace('./scripts/maple-season-browser-ownership.regression.ps1', 'echo skipped'))
  detected('CI stops running the ownership regression itself', 'workflow:ownership-regression-run-independently')
  reset()
  // Switching a governed step OFF without touching a single pinned string. Both of these leave every
  // substring pin in foundation-static-guards.mjs satisfied, which is why that file now slices the workflow
  // by indentation instead of only searching it. `if: false` never runs the step; `continue-on-error: true`
  // runs it and discards the verdict; on the job, `if: false` takes all five governed steps down at once.
  mutate('.github/workflows/foundation.yml', (source) => source.replace('      - name: Season browser ownership regression\n        shell: pwsh\n', '      - name: Season browser ownership regression\n        if: false\n        shell: pwsh\n'))
  detected('a governed workflow step is disabled with a condition', 'workflow:governed-step-unconditional:Season browser ownership regression')
  reset()
  mutate('.github/workflows/foundation.yml', (source) => source.replace('      - name: Run foundation gate\n        shell: pwsh\n', '      - name: Run foundation gate\n        continue-on-error: true\n        shell: pwsh\n'))
  detected('a governed workflow step keeps running but its failure is ignored', 'workflow:governed-step-unconditional:Run foundation gate')
  reset()
  mutate('.github/workflows/foundation.yml', (source) => source.replace('  foundation:\n    runs-on: ubuntu-latest', '  foundation:\n    if: false\n    runs-on: ubuntu-latest'))
  detected('the whole foundation job is disabled with a condition', 'workflow:foundation-job-unconditional')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("\n    if ($ownershipOnWindows) { $script:ownershipOutput = @(& (Get-FoundationProbeShell) -NoProfile -ExecutionPolicy Bypass -File $ownership -Challenge $ownershipChallengeArgument -ChallengeRoot 'C:\\FarmRx') }\n", "\n    if ($ownershipOnWindows) { $script:ownershipOutput = @('MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS') }\n"))
  detected('orchestrator forges the ownership regression marker instead of running it', 'orchestrator:ownership-regression-lane')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("if ($script:ownershipOutput -notcontains 'MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS') {", 'if ($false) {'))
  detected('orchestrator stops requiring the ownership regression marker', 'orchestrator:ownership-regression-marker-asserted')
  reset()
  // The anti-vacuity self-test, degraded the way it would actually be degraded: "at least one case caught
  // it" instead of "every case did". That passes while most of the table is unreachable.
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('Assert-MapleSeasonCase ($uncaught.Count -eq 0)', 'Assert-MapleSeasonCase ($uncaught.Count -lt 99)'))
  detected('ownership regression stops requiring its whole refusal table to catch a gutted predicate', 'ownership-regression:refusals-reject-the-gutted-predicate')
  reset()
  // The distinct-input assertion, and the re-typing that made it necessary. `[string]$CommandLine` coerces
  // $null to '', which silently turned two refusal rows into one case wearing two labels - measured. Both the
  // assertion and the de-typed parameter are drilled, because either one alone lets that back in.
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('Assert-MapleSeasonCase ($duplicateInputs.Count -eq 0)', 'Assert-MapleSeasonCase ($true)'))
  detected('ownership regression stops requiring its refusal rows to be distinct inputs', 'ownership-regression:refusal-inputs-are-distinct')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace("param($CommandLine, $Name = 'node.exe')", "param([string]$CommandLine, [string]$Name = 'node.exe')"))
  detected('ownership regression coerces a null command line to empty, collapsing two refusal rows into one', 'ownership-regression:listener-preserves-a-null-command-line')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('Replace($firstGuard, "  return `$true`n$firstGuard")', 'Replace($firstGuard, $firstGuard)'))
  detected('ownership regression stops actually gutting the predicate it claims to gut', 'ownership-regression:guts-the-predicate')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('if (& $FunctionName -ListenerProcess $case.Listener -Root $case.Root) { $wrong += $case.Label }', 'if ($false) { $wrong += $case.Label }'))
  detected('ownership regression stops calling the predicate at all', 'ownership-regression:refusals-are-executed')
  reset()
  // CHALLENGE/RESPONSE. A two-line file printing the completion marker and exiting 0 was measured to satisfy
  // both callers, so the marker alone proves nothing. These drills cover the whole chain: the suite must
  // publish what it ran, must answer with the real tokenizer and the real predicate rather than a constant,
  // and each caller must keep requiring both - including the one challenge line that names a live unrelated
  // process on the governed port, which the cleanup path would force-kill if the predicate ever said TRUE.
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('OWNERSHIP_MANIFEST tokenizer={0} refusals={1} gutted={2} windows={3} windowsCases={4} cases={5} challenges={6}', 'OWNERSHIP_MANIFEST ran'))
  detected('ownership regression stops publishing how much of itself ran', 'ownership-regression:publishes-a-manifest')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('OWNERSHIP_CHALLENGE {0} owned={1} argv={2}', 'OWNERSHIP_CHALLENGE {0} answered'))
  detected('ownership regression stops reporting its answers to the caller challenge', 'ownership-regression:answers-the-challenge')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('$challengeOwned = [bool](Test-MapleSeasonBrowserPortOwned -ListenerProcess (New-Listener -CommandLine $challengeLine) -Root $ChallengeRoot)', '$challengeOwned = $false'))
  detected('ownership regression answers the challenge with a constant instead of the real predicate', 'ownership-regression:challenge-uses-the-real-predicate')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('$challengeArgv = @(Split-MapleSeasonCommandLineArguments -CommandLine $challengeLine)', '$challengeArgv = @($challengeLine)'))
  detected('ownership regression answers the challenge without the real tokenizer', 'ownership-regression:challenge-uses-the-real-tokenizer')
  reset()
  // The portable tokenizer table's expectations are hard-coded; the Windows socket regression is what
  // re-derives them from CommandLineToArgvW, and the two had already drifted by one line once. Three of the
  // 29 rows contain a character no single-quoted PowerShell string can carry, so they are paired by hand -
  // and a hand pairing is worth nothing unless removing either half turns the gate red. Drill all three
  // halves that can go missing, plus silent growth of the table itself.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('node.exe`tC:\\FarmRx\\x.js`t--port`t4177', 'node.exe C:\\FarmRx\\x.js --port 4177'))
  detected('live tokenizer table stops re-deriving the tab-separated command line', 'ownership-regression:hand-paired-row-rederived:tab-separated-arguments')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('("node.exe C:\\FarmRx{0}Backup\\server.js" -f $nonBreakingSpace)', "'node.exe C:\\FarmRx Backup\\server.js'"))
  detected('live tokenizer table stops re-deriving the non-breaking-space path', 'ownership-regression:hand-paired-row-rederived:non-breaking-space-in-a-path')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace("@{ Line = ('node.exe \"C:\\FarmRx\\'+[char]9+'\\Other\\x.js\"')", "@{ Line = ('node.exe \"C:\\FarmRx\\ \\Other\\x.js\"')"))
  detected('portable tokenizer table drops the tab inside a quoted path', 'ownership-regression:hand-paired-row-present:tab-inside-a-quoted-path')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace("    @{ Line = 'node.exe C:\\FarmRx\\x.js'", "    @{ Line = 'node.exe C:\\Added\\x.js'; Expected = @('node.exe', 'C:\\Added\\x.js') }\n    @{ Line = 'node.exe C:\\FarmRx\\x.js'"))
  detected('portable tokenizer table grows a row nothing re-derives', 'ownership-regression:tokenizer-row-count')
  reset()
  // THE TRANSPORT. Two defects were measured in this one parameter, both silent: `-File` bound an array to its
  // first element and dropped the rest, and then the joined plain string was truncated at the first embedded
  // double quote - and one challenge row legitimately begins with a quote. Each time, challenges simply never
  // arrived while the suite printed its marker and exited 0. So the Base64 encoding and the decoded-challenge
  // COUNT are both drilled: reverting either is the exact regression that hid three challenges twice.
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('$challengeLines = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Challenge)) -split ([char]0x1F))', '$challengeLines = @($Challenge -split ([char]0x1F))'))
  detected('ownership regression reads the challenge payload without decoding it', 'ownership-regression:challenge-decoded-from-base64')
  reset()
  for (const [path, id, collection] of [['.github/workflows/foundation.yml', 'workflow', '$rows'], ['scripts/verify-foundation.ps1', 'orchestrator', '$ownershipChallenge']]) {
    mutate(path, (source) => source.replace('OWNERSHIP_MANIFEST tokenizer=29 refusals=25 gutted=25 windows=', 'OWNERSHIP_MANIFEST tokenizer='))
    detected(`${id} stops requiring the ownership regression to report its full size`, `${id}:ownership-manifest-shape-asserted`)
    reset()
    mutate(path, (source) => source.replace('"C:\\Program Files\\nodejs\\node.exe" scripts/factory-board.mjs --port 4177', 'node.exe C:\\Other\\server.js'))
    detected(`${id} stops asking whether the live foreign listener on the governed port is ours`, `${id}:ownership-challenge-includes-the-live-foreign-listener`)
    reset()
    mutate(path, (source) => source.replace(` challenges=$(${collection}.Count)`, ''))
    detected(`${id} stops checking how many challenges the ownership regression actually decoded`, `${id}:ownership-challenge-count-asserted`)
    reset()
    mutate(path, (source) => source.replace(`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(((${collection} | ForEach-Object { $_.Line }) -join ([char]0x1F))))`, `((${collection} | ForEach-Object { $_.Line }) -join ([char]0x1F))`))
    detected(`${id} sends the challenge payload unencoded, as the transport that ate it did`, `${id}:ownership-challenge-base64-encoded`)
    reset()
    // The four fixed challenge rows are satisfiable by a stub that hard-codes the answers and never runs the
    // predicate. Removing either nonce row - the owned one or the unowned one - restores that hole.
    mutate(path, (source) => source.replace(/\n *@\{ Line = "node\.exe C:\\FarmRx\\node_modules\\vite\\bin\\vite\.js --nonce \$\w+";[^\n]*\n/, '\n'))
    detected(`${id} drops the owned per-run nonce challenge row`, `${id}:ownership-challenge-nonce-row-owned`)
    reset()
    mutate(path, (source) => source.replace(/\n *@\{ Line = "node\.exe C:\\Other\\server\.js --nonce \$\w+";[^\n]*\n/, '\n'))
    detected(`${id} drops the unowned per-run nonce challenge row`, `${id}:ownership-challenge-nonce-row-unowned`)
    reset()
    mutate(path, (source) => source.replace("[Guid]::NewGuid().ToString('N')", "'fixed'"))
    detected(`${id} freezes the challenge nonce, making the rows hard-codeable again`, `${id}:ownership-challenge-nonce-generated`)
    reset()
    // U+001F splits the payload. It is NOT impossible in a Windows command line - measured surviving into a
    // child's argv - so a row containing it would become phantom challenges unless the encoder refuses.
    mutate(path, (source) => source.replace(/^( *)if \(\$\w+\.Line\.Contains\(\[char\]0x1F\)\) \{ throw "Ownership challenge row/m, '$1if ($false) { throw "Ownership challenge row'))
    detected(`${id} stops refusing a challenge row that contains the payload delimiter`, `${id}:ownership-challenge-delimiter-refused`)
    reset()
    // The assertion-helper self-test, reported through the manifest. Dropping `canary=caught` is what let a
    // suite with every table assertion disabled pass: full manifest, right answers, exit 0.
    mutate(path, (source) => source.replace(' canary=caught"', '"'))
    detected(`${id} stops requiring the ownership regression's assertion-helper self-test`, `${id}:ownership-assertion-canary-required`)
    reset()
    // Answers must be counted as INSTANCES of output. Filtering this caller's own candidate strings instead
    // accepts a child that prints both verdicts for one index, or the same index twice.
    mutate(path, (source) => source.replace("| Where-Object { $_.StartsWith('OWNERSHIP_CHALLENGE ', [StringComparison]::Ordinal) })", '| Where-Object { $_ -like \'OWNERSHIP_CHALLENGE *\' } | Select-Object -Unique)'))
    detected(`${id} stops counting challenge answers as distinct output instances`, `${id}:ownership-answers-counted-as-instances`)
    reset()
    mutate(path, (source) => source.replace(/ challenge answers for \$\(/, ' challenge answers, which is fine $('))
    detected(`${id} stops requiring one challenge answer per challenge sent`, `${id}:ownership-answer-total-asserted`)
    reset()
    mutate(path, (source) => source.replace(/^( *)if \((\$\w*[Ff]orIndex)\.Count -ne 1 -or (\$\w*[Aa]ccepted)\.Count -ne 1\) \{/m, '$1if ($2.Count -eq 0) {'))
    detected(`${id} stops requiring exactly one answer per challenge index and stops checking it is accepted`, `${id}:ownership-answer-must-be-a-candidate`)
    reset()
    // The accepted answer must be SELECTED by filtering this caller's own candidate spellings. A selection
    // replaced by a constant records a value the comparison did not produce, which is the whole defect the
    // recording exists to catch.
    mutate(path, (source) => source.replace(/if \(\$\w*[Cc]andidates -ccontains \$\w*[Aa]nswer\)/, 'if ($true)'))
    detected(`${id} stops selecting the accepted answer from its own candidate spellings`, `${id}:ownership-answer-selected-from-candidates`)
    reset()
    // AND THE SELECTION MUST NOT GO THROUGH A CMDLET. A fresh-context review defeated the `Where-Object` version
    // of this selection with eight lines placed earlier in the same file: `function Where-Object { process { $_ } }`
    // returns every object un-filtered, so a child printing `owned=FALSE` against a caller expecting TRUE is
    // accepted, `$accepted.Count` is 1, and the reconciliation compares the forged answer with itself. Both the
    // keyword form and the prohibition on redefining the cmdlet are drilled, because either alone restores it.
    mutate(path, (source) => source.replace(/^( *)foreach \((\$\w*[Aa]nswer) in (\$\w*[Ff]orIndex)\) \{/m, '$1$2s = @($3 | Where-Object { $_ }); foreach ($2 in $2s) {'))
    detected(`${id} routes the answer selection back through a shadowable cmdlet`, `${id}:ownership-answer-iterated-with-a-keyword`)
    reset()
    mutate(path, (source) => source.replace(/^( *)foreach \((\$\w*[Aa]nswer) in /m, '$1function Where-Object { process { $_ } }\n$1foreach ($2 in '))
    detected(`${id} redefines Where-Object so any pipeline filter in it stops filtering`, `${id}:cmdlet-not-shadowed-by-function:Where-Object`)
    reset()
    // The caller's expectations are ReadOnly BINDINGS, not plain assignments. PowerShell refuses the second write
    // at run time, which no regex over PowerShell can promise: names are case-insensitive and `${script:x}` puts
    // the scope inside the braces, and a fresh-context review confirmed both spellings landed silently.
    mutate(path, (source) => source.replace(/^( *)Set-Variable -Name (\w+) -Option ReadOnly -Value ("OWNERSHIP_MANIFEST)/m, '$1$$$2 = $3'))
    detected(`${id} makes its ownership-manifest expectation rebindable by the party being judged`, `${id}:ownership-assertion-canary-required-readonly`)
    reset()
    mutate(path, (source) => source.replace(/^( *)Set-Variable -Name (\w+) -Option ReadOnly -Value \(\[Guid\]::NewGuid\(\)\.ToString\('N'\)\)/m, "$1$$$2 = [Guid]::NewGuid().ToString('N')"))
    detected(`${id} makes its per-run challenge nonce rebindable after it is generated`, `${id}:ownership-challenge-nonce-assigned-live-readonly`)
    reset()
    // And the recorded value must be the accepted answer rather than whatever the child printed. Recording the
    // raw output makes the reconciliation below compare the output against itself, which always agrees.
    mutate(path, (source) => source.replace(/^( *)(\$\w*[Vv]erifiedAnswers)\.Add\(\$\w*[Aa]ccepted\[0\]\)/m, (_whole, indent, list) => `${indent}${list}.Add('recorded without comparing')`))
    detected(`${id} records the printed answer instead of the one its comparison accepted`, `${id}:ownership-accepted-answer-recorded`)
    reset()
    // The reconciliation is what turns the recording into a measurement of execution. Without it the list is
    // built and never read, so a per-index loop that never ran leaves it empty with nothing noticing.
    mutate(path, (source) => source.replace(/^( *)if \(\(\(\$\w*[Vv]erifiedAnswers \| Sort-Object\) -join "`n"\) -cne/m, '$1if ($false -and'))
    detected(`${id} stops reconciling the answers it accepted against the answers the child printed`, `${id}:ownership-answers-reconciled`)
    reset()
    // The manifest's reached-case count, held by this caller. `canary=caught` proves the helper notices a false
    // condition; only the count can tell a full run from one with a passing assertion quietly skipped.
    mutate(path, (source) => source.replace(' cases=$(', ' cases=any$('))
    detected(`${id} stops requiring the number of assertion cases the ownership regression reached`, `${id}:ownership-case-count-asserted`)
    reset()
  }
  // THE ASSERTION HELPER ITSELF. A fresh-context review changed its condition to `if ($false)` and the suite
  // still printed its marker, still published a full-size manifest, still answered every challenge correctly
  // from the real predicate, and exited 0 - with roughly a hundred table assertions dead. Two layers now stand
  // in the way: the helper's body is pinned statically, and the suite hands the helper a must-fail condition at
  // run time and throws if it is not recorded. Both are drilled.
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('if (-not $Condition) { $script:failures += $Message }', 'if ($false) { $script:failures += $Message }'))
  detected('ownership regression assertion helper stops recording failures', 'ownership-regression:assertion-helper-records-failures')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('Assert-True $false $script:assertionCanary', '# self-test removed'))
  detected('ownership regression stops handing its assertion helper a must-fail condition', 'ownership-regression:assertion-helper-self-tested')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace("throw 'Assertion helper did not record a deliberately-false assertion", "Write-Output 'Assertion helper did not record a deliberately-false assertion"))
  detected('ownership regression reports a result even when its assertion helper is inert', 'ownership-regression:assertion-helper-self-test-is-terminating')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace("$script:assertionCanaryCaught = 'caught'", "$script:assertionCanaryCaught = 'skipped'"))
  detected('ownership regression stops publishing the assertion-helper verdict its callers require', 'ownership-regression:assertion-canary-published')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('challenges={6} canary={7}', 'challenges={6}'))
  detected('ownership regression drops the assertion-helper field from its manifest', 'ownership-regression:publishes-a-manifest')
  reset()
  // THE PAIRING, in both directions. The portable tables in the ownership suite are only meaningful if the
  // live CommandLineToArgvW table re-derives them, and the first version searched the whole live file as text -
  // a live row COMMENTED OUT stopped executing while still satisfying the search. So the live table is now
  // parsed into rows, and both drills below start from a green gate.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace("\n      'node.exe C:\\FarmRx\\x.js'\n", "\n      # 'node.exe C:\\FarmRx\\x.js'\n"))
  detected('a live tokenizer row is commented out while its text stays in the file', 'ownership-regression:tokenizer-literal-rederived:node.exe C:\\FarmRx\\x.js')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace("\n      'node.exe C:\\FarmRx\\x.js'\n", "\n      'node.exe C:\\FarmRx\\x.js'\n      'node.exe C:\\FarmRx\\unasserted.js'\n"))
  detected('the live tokenizer table grows a row the portable side never asserts', "ownership-regression:live-row-unaccounted:'node.exe C:\\FarmRx\\unasserted.js'")
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('"node.exe`tC:\\FarmRx\\x.js`t--port`t4177"', '"node.exe C:\\FarmRx\\x.js --port 4177"'))
  detected('a hand-paired live tokenizer row loses the spelling its portable twin exists for', 'ownership-regression:hand-paired-row-rederived:tab-separated-arguments')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace("\n      'node.exe \"a\"\"b c\"'\n", '\n'))
  detected('an enumerated live-only tokenizer row is deleted', 'ownership-regression:live-only-row-present:doubled-quote-inside-a-quoted-argument')
  reset()
  // The job-level hole, in the direction the first guard missed. `if: false` on the line AFTER `runs-on:` is
  // valid YAML, disables all five steps at once, and the adjacency check it replaced stayed green.
  mutate('.github/workflows/foundation.yml', (source) => source.replace('  foundation:\n    runs-on: ubuntu-latest\n', '  foundation:\n    runs-on: ubuntu-latest\n    if: false\n'))
  detected('the foundation job is disabled by a condition placed after runs-on', 'workflow:foundation-job-unconditional')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("Write-Output 'Farm Rx foundation gate: PASS'", "Write-Output 'done'"))
  detected('foundation completion marker renamed', 'orchestrator:completion-marker')
  reset()
  // The kill-authorizing predicate. It now compares whole ARGUMENTS, parsed by Windows' own rules,
  // instead of searching the raw command line for the root text and classifying the boundary by hand.
  // Each drill below removes one rule that a measured false-TRUE depended on.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('foreach ($argument in (Split-MapleSeasonCommandLineArguments -CommandLine $commandLine)) {', 'foreach ($argument in @($commandLine)) {'))
  detected('ownership predicate stops tokenizing and scans the raw command line again', 'season-browser:ownership-compares-whole-arguments')
  reset()
  // Windows splits on ASCII space and tab only. Widening that to [char]::IsWhiteSpace makes a
  // non-breaking space a separator, and NBSP is legal in a file name: the sibling C:\FarmRx<NBSP>Backup
  // then looks like our root followed by a boundary. Measured True before this rule was ASCII-only.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("return ($Character -eq ' ' -or $Character -eq \"`t\")", 'return [char]::IsWhiteSpace($Character)'))
  detected('tokenizer treats Unicode whitespace as an argument separator', 'season-browser:tokenizer-splits-on-ascii-space-and-tab-only')
  reset()
  // The separator rule is defined once on purpose. Inlining a different test at either loop is how the two
  // copies drifted, and the drift did not produce a wrong answer - it produced NO answer: measured, a parse
  // that stopped at a character the separator skip would not consume spun on one index until the
  // governed-port regression was killed at four minutes with no output.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('if ((-not $inQuotes) -and (Test-MapleSeasonCommandLineSeparator -Character $character)) { break }', 'if ((-not $inQuotes) -and [char]::IsWhiteSpace($character)) { break }'))
  detected('tokenizer stops using the shared separator rule to end an argument', 'season-browser:tokenizer-breaks-argument-at-shared-separator')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('while ($index -lt $length -and (Test-MapleSeasonCommandLineSeparator -Character $CommandLine[$index])) { $index++ }', "while ($index -lt $length -and $CommandLine[$index] -eq ' ') { $index++ }"))
  detected('tokenizer stops using the shared separator rule to skip between arguments', 'season-browser:tokenizer-skips-shared-separator')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('throw "Split-MapleSeasonCommandLineArguments made no progress at index $index', 'Write-Verbose "no progress at index $index'))
  detected('tokenizer loses the guard that stops it stalling on one index', 'season-browser:tokenizer-refuses-stalled-parse')
  reset()
  // Degrading the refusal back to `break` is the specific regression that matters, because breaking LOOKS
  // fail-closed and is not: the truncated list contains the bare exact root, which is itself a containment
  // match, so it authorized killing the sibling's listener. Measured.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('throw "Split-MapleSeasonCommandLineArguments made no progress at index $index', 'break; "no progress at index $index'))
  detected('tokenizer degrades a stalled parse to a truncated argument list instead of refusing', 'season-browser:tokenizer-refuses-stalled-parse')
  reset()
  // The 2n / 2n+1 backslash rule. Without it a backslash-escaped quote reads as a delimiter, which is how
  // `--label "C:\FarmRx\safe\" --port 4177"` put our root inside an argument that belonged to C:\Other.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("[void]$builder.Append('\\', [int][Math]::Floor($backslashes / 2))", "[void]$builder.Append('\\', $backslashes)"))
  detected('tokenizer stops halving an escaped backslash run', 'season-browser:tokenizer-halves-escaped-backslash-run')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if (($backslashes % 2) -eq 1) { [void]$builder.Append('\"'); $index++ }", 'if ($false) { $index++ }'))
  detected('tokenizer treats an escaped quote as a delimiter', 'season-browser:tokenizer-treats-odd-run-quote-as-literal')
  reset()
  // CommandLineToArgvW's doubled-quote quirk. Removing it does not merely mis-split: it changes which
  // argument the sibling path lands in.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($inQuotes -and ($index + 1) -lt $length -and $CommandLine[$index + 1] -eq '\"') {", 'if ($false) {'))
  detected('tokenizer stops handling the doubled-quote quirk', 'season-browser:tokenizer-handles-doubled-quote')
  reset()
  // Win32 strips trailing dots and spaces per component. Chaining the two trims is order-dependent and
  // left '.. .' three characters long, so the component walk accepted it and the predicate claimed the
  // parent directory. Measured True before the trim took all three characters as one set.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("return $Component.TrimEnd(' ', \"`t\", '.').Length -ne 0", "return $Component.TrimEnd(' ', \"`t\").TrimEnd('.').Length -ne 0"))
  detected('component check goes back to chained order-dependent trims', 'season-browser:ownership-refuses-traversal')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('if (-not (Test-MapleSeasonPathComponentIsRealName -Component $component)) { return $false }', 'if ($false) { return $false }'))
  detected('ownership predicate stops walking the components below the root', 'season-browser:ownership-walks-tail-components')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('if (-not (Test-MapleSeasonPathComponentIsRealName -Component $segment)) { return $false }', 'if ($false) { return $false }'))
  detected('ownership predicate stops validating the components of the root itself', 'season-browser:ownership-walks-root-components')
  reset()
  // Windows' two argument grammars disagree on exactly one construct, and picking the wrong one authorizes
  // a kill: shell32 splits `--label "C:\Other"" C:\FarmRx\safe"` so that half the label reads as a path in
  // our tree, while node's own C-runtime parse keeps it one argument naming nothing of ours. Measured.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($commandLine.Contains('\"\"')) { return $false }", 'if ($false) { return $false }'))
  detected('ownership predicate answers a command line whose meaning depends on which Windows grammar parsed it', 'season-browser:ownership-refuses-ambiguous-grammar')
  reset()
  // Containment is the platform resolver's answer, not a hand-written walk's. Going back to a raw prefix
  // test on the unresolved text is the mutation that matters: it re-accepts `C:\FarmRx\.\x.js` correctly but
  // also re-accepts every spelling the resolver would have moved OUT of the tree.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('try { $resolved = [System.IO.Path]::GetFullPath($candidate) } catch { return $false }', '$resolved = $candidate'))
  detected('ownership predicate stops resolving the argument with the platform path resolver', 'season-browser:ownership-resolves-with-the-platform')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($candidate.StartsWith('\\\\?\\', [StringComparison]::Ordinal)) { $candidate = $candidate.Substring(4) }", 'if ($false) { $candidate = $candidate.Substring(4) }'))
  detected('ownership predicate stops recognizing an extended-length spelling of the owned tree', 'season-browser:ownership-strips-extended-length-prefix')
  reset()
  // An argument carrying a character Win32 forbids in a path is not a path. This is what refuses the
  // escaped-quote defeat, whose argument starts with our root at a real separator yet cannot name a file.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($candidate.IndexOfAny([char[]]@('\"', '<', '>', '|', '*', '?')) -ge 0) { return $false }", 'if ($false) { return $false }'))
  detected('ownership predicate stops refusing characters Win32 forbids in a path', 'season-browser:ownership-refuses-non-path-characters')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('if ([char]::IsControl($character)) { return $false }', 'if ($false) { return $false }'))
  detected('ownership predicate stops refusing control characters in an argument', 'season-browser:ownership-refuses-control-characters')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($candidate.IndexOf(':', 2) -ge 0) { return $false }", 'if ($false) { return $false }'))
  detected('ownership predicate stops refusing an alternate data stream below the root', 'season-browser:ownership-refuses-alternate-data-stream')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($bareName -match '(?i)^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$') { return $false }", 'if ($false) { return $false }'))
  detected('ownership predicate stops refusing a reserved device name below the root', 'season-browser:ownership-refuses-reserved-device-name')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if (-not (($candidate -match '^[A-Za-z]:\\\\') -or ($candidate -match '^\\\\\\\\[^\\\\?.]'))) { return $false }", 'if ($false) { return $false }'))
  detected('ownership predicate resolves a shell-relative path, making a kill depend on the current directory', 'season-browser:ownership-refuses-shell-relative-path')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($tail.Length -gt 0 -and $tail[0] -ne '\\') { return $false }", 'if ($false) { return $false }'))
  detected('ownership predicate stops requiring a separator after the root', 'season-browser:ownership-requires-separator-boundary')
  reset()
  // The tokenizer's rules are only trustworthy while something compares them to the real parser. Three
  // consecutive reviews found a different false-TRUE in the hand-written scan that preceded them, and all
  // three came from checking the rules against my reading of the documentation rather than against
  // Windows. Deleting that comparison has to fail the guard.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replaceAll('CommandLineToArgvW', 'SomeOtherParser'))
  detected('predicate regression stops comparing the tokenizer to the real Windows parser', 'season-browser-regression:tokenizer-compared-to-win32')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('disagreed with CommandLineToArgvW', 'agreed with CommandLineToArgvW'))
  detected('predicate regression stops naming a tokenizer disagreement as a failure', 'season-browser-regression:tokenizer-disagreement-is-fatal')
  reset()
  // The stall drill has six moving parts and every one of them can be quietly disarmed: the timeout that
  // bounds the wait, the drift that provokes the stall, the assertion that names it, the needle check that
  // refuses to pass on a copy it failed to mutate, the state check that a truthy Wait-Job return does not
  // give, and the outcome check that distinguishes refusing from merely finishing. Losing any one turns the
  // drill into decoration.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('Wait-Job $stallJob -Timeout 30', 'Wait-Job $stallJob'))
  detected('stall drill waits forever instead of bounding the parse', 'season-browser-regression:stall-drill-is-bounded')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('[char]::IsWhiteSpace($character)', "($character -eq ' ')"))
  detected('stall drill stops re-introducing the separator drift it exists to catch', 'season-browser-regression:stall-drill-reintroduces-drift')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('made the command-line parse stall', 'took a while'))
  detected('stall drill stops naming a stalled parse as a failure', 'season-browser-regression:stall-is-fatal')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('its needle is stale and the drill would prove nothing', 'continuing anyway'))
  detected('stall drill stops refusing a stale mutation needle', 'season-browser-regression:stall-drill-refuses-stale-needle')
  reset()
  // Wait-Job returns a truthy job object even for a Failed or Stopped job - measured on a job whose body was
  // `throw 'copy failed'`. Reverting to the [bool] cast is the exact weakness Sol found: the drill would go
  // green on a job that never ran the tokenizer at all.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace("Assert-True ($stallJob.State -eq 'Completed')", 'Assert-True ([bool]$stallWaited)'))
  detected('stall drill accepts a failed job as proof the parse returned', 'season-browser-regression:stall-drill-requires-a-completed-job')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace("$stallOutcome -like 'THREW: Split-MapleSeasonCommandLineArguments made no progress*'", '$null -ne $stallOutcome'))
  detected('stall drill accepts any completion instead of requiring the parse to refuse', 'season-browser-regression:stall-drill-requires-the-refusal')
  reset()
  // The empty command line is the one deliberate divergence from Windows, and it is asserted rather than
  // omitted. Windows answers an empty line with the path of the process ASKING, which is a fact about the
  // caller and worthless as evidence about a listener.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace("Assert-True (($emptyFromWindows -join ' ') -ceq $askingProcessPath)", 'Assert-True ($true)'))
  detected('predicate regression stops asserting the deliberate empty-command-line divergence', 'season-browser-regression:empty-divergence-is-asserted')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('# ONE deliberate divergence from CommandLineToArgvW', '# a divergence'))
  detected('tokenizer stops declaring its one deliberate divergence from Windows', 'season-browser:empty-divergence-is-declared')
  reset()
  // The cleanup kill itself. Killing by NUMBER rather than through the handle that was opened before the
  // ownership check reopens the window in which that number can come to mean a different process, and this
  // is a force kill on Mason's own workstation. The needle here used to be `$ownedProcess.Kill()`, and it
  // went stale when the cleanup was rewritten to hold an OS handle - the drill named the stale needle and
  // failed the gate rather than silently testing unmodified source, which is what that guard is for.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('[MapleSeasonProcessInterop]::TerminateProcess($target.Handle, 1)', '(Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop)'))
  detected('cleanup kills by process id instead of the handle it validated', 'season-browser:cleanup-terminates-through-the-validated-handle')
  reset()
  // Measured, and this is why the handle and not the .NET Process object is the pin: haveProcessHandle stayed
  // False and m_processHandle stayed null across .StartTime, .HasExited and .Kill(), so every one of those
  // re-resolved the id at call time. Validating without holding a handle leaves the id free to change hands.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('[MapleSeasonProcessInterop]::OpenProcess(', '[MapleSeasonProcessInterop]::OpenProcessWithoutPinning('))
  detected('cleanup validates a listener without holding a handle that reserves its id', 'season-browser:cleanup-opens-a-handle-before-validating')
  reset()
  // F15: terminate each listener as soon as it validates, instead of validating every listener first. One
  // port can hold two listeners - measured, one on 127.0.0.1 and one on ::1, enumerated IPv6-first - so a
  // one-pass cleanup kills the owned one and then refuses on the foreign one, having already killed. Both
  // occurrences are renamed, because the guard reads presence and the finally block holds the second.
  mutate('scripts/maple-season-browser.ps1', (source) => source.split('foreach ($target in $validated) {').join('foreach ($target in $validatedSoFar) {'))
  detected('cleanup no longer separates validating every listener from terminating any', 'season-browser:cleanup-validates-every-listener-before-terminating-any')
  reset()
  // F17: a listener query that cannot tell a FREE port from a BROKEN query. Measured, Get-NetTCPConnection
  // on a free port with -ErrorAction Stop throws CmdletizationQuery_NotFound, so the two are distinguishable
  // and swallowing every error conflates them - which would report a governed port as free and let the
  // scenario proceed against a port it does not hold.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') { return @() }", 'return @()'))
  detected('listener probe treats a broken listener query as a free port', 'season-browser:listener-probe-fails-closed')
  reset()
  // And the probe has to be the ONLY way this file asks Windows for the listener table. A second, direct
  // Get-NetTCPConnection call site is how F17 got in: the fail-closed probe stays intact and correct while
  // the caller that matters routes around it.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('$listeners = @(Get-MapleSeasonPortListener -Port $Port -Scenario $Scenario)', '$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)'))
  detected('a second direct listener query bypasses the fail-closed probe', 'season-browser:listener-probe-is-the-only-net-query (found 2 Get-NetTCPConnection call sites, expected 1 - the one inside Get-MapleSeasonPortListener)')
  reset()
  // The tokenizer receipt's per-row clear. Only $agrees was cleared, so a wrapped parse left $expected
  // holding the previous row's array and the token total carried forward instead of falling short. Removing
  // the clear of $expected is that defect exactly.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('      $agrees = $null\n      $expected = $null\n', '      $agrees = $null\n'))
  detected('tokenizer receipt lets a row carry the previous row\'s parse', 'season-browser-regression:tokenizer-parses-cleared-per-row')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('Assert-True ($null -ne $expected -and $expected.Count -gt 0)', 'Assert-True ($true)'))
  detected('tokenizer receipt stops requiring a parse from this iteration', 'season-browser-regression:tokenizer-receipt-recorded-after-the-comparison')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('no longer identifies the listener it validated', 'is fine'))
  detected('cleanup stops re-checking the validated process identity', 'season-browser:cleanup-rechecks-process-identity')
  reset()
  mutate('src/data/QueuedScoutingRepository.ts', (source) => source.replace('const verifyRead = () => verifyQueuedReadContext', 'const verifyRead = () => verifyQueuedOperationContext'))
  detected('queued read identity fence removal', 'read-context:src/data/QueuedScoutingRepository.ts')
  reset()
  mutate('src/data/QueuedNotificationsRepository.ts', (source) => source.replace('queueTransaction(', 'unlockedTransaction('))
  detected('queue lock removal', 'queue-lock:src/data/QueuedNotificationsRepository.ts')
  reset()
  mutate('supabase/migrations/20260711154325_module1_rls.sql', (source) => { const start = source.indexOf('create policy fields_select'); const end = source.indexOf('create policy fields_insert'); return source.slice(0, start) + source.slice(start, end).replace('public.can_access_farm(farm_id)', 'true') + source.slice(end) })
  detected('field RLS farm-scope removal', 'rls:fields-select-farm-scope')
  reset()
  mutate('src/data/workspaceCache.ts', (source) => source.replace('`${scope.projectRef}:${scope.userId}:${scope.farmId}:${scope.module}`', '`${scope.projectRef}:shared-user:${scope.farmId}:${scope.module}`'))
  detected('private cache user-scope removal', 'cache:user-farm-module-key')
  reset()
  mutate('src/main.tsx', (source) => source.replace("'serviceWorker' in navigator && !isPasswordRecoveryHostname(window.location.hostname)", "'serviceWorker' in navigator && true"))
  detected('recovery-origin service-worker registration', 'service-worker:recovery-origin-registration-denied')
  reset()
  mutate('src/main.tsx', (source) => source.replace('isPasswordRecoveryHostname(window.location.hostname) && window.location.pathname !== passwordRecoveryRoute', 'false && window.location.pathname !== passwordRecoveryRoute'))
  detected('recovery-host route confinement removal', 'auth:recovery-host-route-confinement')
  reset()
  mutate('docs/password-recovery-support.md', (source) => source.replace('allow the exact redirect\n   `https://recovery.croprxsolutions.app/update-password`', 'allow the exact redirect\n   `https://farm-rx.vercel.app/update-password`'))
  detected('stale main-origin recovery allowlist instruction', 'auth:runbook-exact-recovery-redirect')
  reset()
  mutate('scripts/provision-customer-lib.mjs', (source) => source.replace("firstPasswordRedirectTo = 'https://recovery.croprxsolutions.app/update-password'", "firstPasswordRedirectTo = 'https://farm-rx.vercel.app/update-password'"))
  detected('stale main-origin provisioning redirect', 'auth:provisioning-exact-recovery-redirect')
  reset()
  mutate('src/App.tsx', (source) => source.replace('phase === "signed_in" && !forgotPassword', 'phase === "signed_in"'))
  detected('signed-in redirect overrides reset intent', 'auth:reset-intent-before-signed-in-redirect')
  reset()
  mutate('src/auth/passwordRecovery.ts', (source) => source.replace("if (intent === 'completed') target.searchParams.set('recoveryComplete', '1')", "if (intent === 'completed') target.searchParams.set('forgotPassword', '1')"))
  detected('completed recovery loses canonical cleanup signal', 'auth:completion-canonical-session-signal')
  reset()
  mutate('src/auth/AuthProvider.tsx', (source) => source.replaceAll('persistedPasswordRecoveryCleanupAuthority(d.storage, cleanupUserId, d.now()) !== authority', 'false'))
  detected('completed recovery loses transactional lineage revalidation', 'auth:completion-revalidates-persisted-lineage-in-transaction')
  reset()
  mutate('src/auth/AuthProvider.tsx', (source) => source.replace('pendingSignOutCleanupUserIds.current.add(cleanupUserId)', 'void cleanupUserId'))
  detected('completed recovery loses cleanup user retry state', 'auth:completion-retains-cleanup-user')
  reset()
  mutate('src/auth/AuthProvider.tsx', (source) => source.replace('appliedRecoveryCompletionAuthority.current = authority', 'appliedRecoveryCompletionAuthority.current = null'))
  detected('completed recovery loses applied authority retry state', 'auth:completion-retains-retry-authority')
  reset()
  mutate('src/App.tsx', (source) => source.replace("passwordRecoveryPhase === 'complete' || passwordRecoveryPhase === 'complete_with_warning'", "passwordRecoveryPhase === 'complete'"))
  detected('completed recovery warning loses automatic handoff', 'auth:completion-auto-handoff-terminal-phases')
  reset()
  mutate('src/auth/passwordRecovery.ts', (source) => source.replaceAll('throw new PasswordRecoveryStorageError()', 'return'))
  detected('reset storage preflight suppresses its honest failure', 'auth:reset-storage-preflight-fails-honestly')
  reset()
  mutate('src/App.tsx', (source) => source.replace('if (isPasswordRecoveryStorageError(error))', 'if (false)'))
  detected('reset storage failure falls through to public email success', 'auth:reset-storage-error-distinguished')
  reset()
  mutate('docs/password-recovery-support.md', (source) => source.replace('If any prior farmer client exists or any\n   known proof client cannot be enumerated and retired, stop and keep recovery unavailable.', 'Proceed after deployment readiness alone.'))
  detected('stale-client customer-zero transition gate removal', 'auth:runbook-stale-client-customer-zero-gate')
  reset()
  mutate('src/App.tsx', (source) => source.replace('{resetResponse && <p className="reset-confirmation" role="status">{resetResponse}</p>}\n          {error && <p className="auth-error" role="alert">{error}</p>}', '{resetResponse && <p className="reset-confirmation" role="status">{resetResponse}</p>}'))
  detected('reset storage failure loses visible error', 'auth:reset-storage-error-rendered')
  reset()
  // This is the mutation that reproduces a defect that already shipped. tests/season/maple-2027-start.sql
  // takes its season owner password from psql variable :'season_owner_password', and only
  // Invoke-MapleSeasonSqlFile prepends the matching \set. Piping the fixture straight into psql hands
  // the placeholder to Postgres verbatim, so the fixture dies on `syntax error at or near ":"`. That
  // is how verify-program-assignment-identities-disposable.ps1 broke when the fixture was
  // parameterized, and it stayed broken because nothing in the repository ran that script.
  mutate('scripts/verify-program-assignment-identities-disposable.ps1', (source) => source.replace('try { $null = Invoke-MapleSeasonSqlFile -Path $fixturePath -ExpectedContainer $expectedContainer }', 'Get-Content -Raw -LiteralPath $fixturePath | docker exec -i $expectedContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1'))
  detected('season start fixture piped raw into psql', 'season:fixture-raw-psql-pipe-verify-program-assignment-identities-disposable.ps1')
  reset()
  mutate('tests/season/maple-2027-start.sql', (source) => source.replaceAll(":'season_owner_password'", "'a-literal-password'"))
  detected('season start fixture carries a literal password', 'season:start-fixture-parameterized-password')
  reset()

  // ---------------------------------------------------------------------------------------------------
  // THIS FILE'S OWN CLAIMS, and the two receipts that carry a measured quantity. Every case below exists
  // because a fresh-context review defeated the previous shape of it.
  //
  // The static half of this drill printed its PASS marker at line ~820 and NOBODY READ IT. So the whole
  // static half - every case above - could be wrapped in `if (false)`, the marker would still print, and
  // both callers would still be satisfied. Both callers now hold the sentence and refuse a run without it.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('$mutationDrill -cnotcontains $expectedStaticMarker', '$false'))
  detected('orchestrator stops requiring the mutation drill to report its static half', 'orchestrator:mutation-drill-static-claim-consumed')
  reset()
  mutate('.github/workflows/foundation.yml', (source) => source.replace('$drill -cnotcontains $expectedStatic', '$false'))
  detected('CI stops requiring the mutation drill to report its static half', 'workflow:mutation-drill-static-claim-consumed')
  reset()
  // And the behavioural claim is PLATFORM-SPECIFIC, which is how a real CI break got in with no adversarial
  // edit at all: the ubuntu job's drill step required the 4-broken/1-gap sentence while the same job's
  // orchestrator required the 5-broken/0-gap one unconditionally. That lane was red on merge. Selecting by
  // platform is pinned, and so is REFUSING the other platform's sentence - a run that prints both is not
  // measuring anything, because at most one of them can be true of the machine it ran on.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('$expectedBehaviouralMarker = if ($onWindowsForDrill) { $windowsBehaviouralMarker } else { $portableBehaviouralMarker }', '$expectedBehaviouralMarker = $windowsBehaviouralMarker'))
  detected('orchestrator demands the Windows behavioural claim on every platform', 'orchestrator:mutation-drill-claim-selected-by-platform')
  reset()
  for (const [path, id, drill, rejected] of [['.github/workflows/foundation.yml', 'workflow', '$drill', '$rejectedBehaviour'], ['scripts/verify-foundation.ps1', 'orchestrator', '$mutationDrill', '$rejectedBehaviouralMarker']]) {
    mutate(path, (source) => source.replace(`${drill} -ccontains ${rejected}`, '$false'))
    detected(`${id} stops refusing the other platform's behavioural claim`, `${id}:mutation-drill-other-platform-claim-refused`)
    reset()
  }
  // The tokenizer receipt carries a QUANTITY WINDOWS PRODUCED. The count-only version was defeated by
  // `$agrees = $true` after the $null clear plus wrapping both parses: comparisons=33, distinct=33, and not
  // one call to CommandLineToArgvW. Summing the argument counts the real parse returned cannot be reached
  // that way, so removing the sum, the publication, or the check each restores the hole.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('      $tokenizerTokens += $expected.Count\n', ''))
  detected('tokenizer receipt stops carrying the argument count Windows returned', 'season-browser-regression:tokenizer-receipt-recorded-after-the-comparison')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('Assert-True ($tokenizerTokens -eq $tokenizerExpectedTokens)', 'Assert-True ($tokenizerTokens -ge 0)'))
  detected('tokenizer receipt stops checking the argument total against the measured expectation', 'season-browser-regression:tokenizer-tokens-consumed')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('      $agrees = $expected.Count -eq $actual.Count\n', '      $agrees = $expected.Count -eq $actual.Count\n      $agrees = $true\n'))
  detected('tokenizer agreement flag is forced true after the comparison', 'season-browser-regression:tokenizer-agreement-written-three-times:4')
  reset()
  // The two runtime-immutable bindings. `Set-Variable -Option ReadOnly` is the HARD half of these: PowerShell
  // itself refuses the second write, which is worth more than any regex over PowerShell, because names are
  // case-insensitive and `${script:x}` puts the scope inside the braces - a fresh-context review confirmed
  // `${script:nonBreakingSpace} = [char]0x20` and `$script:tallied = @('padding') * $expectedCases` both
  // landed silently against the plain-assignment versions.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('Set-Variable -Name nonBreakingSpace -Option ReadOnly -Value ([char]0x00A0)', '$nonBreakingSpace = [char]0x00A0'))
  detected('non-breaking space becomes rebindable to an ordinary space', 'season-browser-regression:non-breaking-space-defined-readonly-by-code-point')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('Set-Variable -Name tallied -Scope Script -Option ReadOnly -Value ([Collections.Generic.List[string]]::new())', '$script:tallied = @()'))
  detected('reached-case tally becomes a rebindable array that padding can inflate', 'ownership-regression:tally-bound-readonly')
  reset()
  mutate('scripts/maple-season-browser-ownership.regression.ps1', (source) => source.replace('  $script:tallied.Add($Message)', '  $script:tallied.Add($Message)\n  $script:tallied = @()'))
  detected('reached-case tally is rebound a second time inside the wrapper', 'ownership-regression:tally-bound-once:tallied:2')
  reset()
  // AND THIS FILE, mutated in the copy exactly as the review wrote it. The behavioural half below counts how
  // many times it called its own helper, so a runner that answers without starting a child makes every one of
  // those calls succeed. Five pins stand over that: the child process, the returned result, the hang refusal,
  // and the two scoring criteria. Each mutation here is the review's own stub or a weakening of one criterion.
  // EVERY NEEDLE HERE IS ANCHORED TO THE START OF A LINE, and that is not cosmetic. The first version used
  // plain substrings, and each one matched ITSELF: the needle is written out in this file, above the code it
  // aims at, so `String.replace` mutated the mutation case and left the runner untouched. The guard was green,
  // the drill reported "not detected", and the diagnosis looked like a blind guard rather than a self-hit
  // needle. Measured here before this comment was written. Anchoring works because the copy inside a needle
  // is preceded by a quote, never by line-start-plus-spaces.
  const drillFile = 'scripts/verify-foundation-mutations.mjs'
  mutate(drillFile, (source) => source.replace(/^( *)const result = spawnSync\(onWindows \? 'powershell' : 'pwsh'/m, '$1const result = { status: 1, stdout: expected, stderr: "" }; const unused = (() => spawnSync)(onWindows ? "powershell" : "pwsh"'))
  detected("the drill's subject runner answers without starting a child process", 'mutation-drill:subject-runner-starts-a-real-child')
  reset()
  mutate(drillFile, (source) => source.replace(/^( *)if \(status !== 1\) \{$/m, '$1if (false) {'))
  detected('the drill scores any non-zero exit as a detection again', 'mutation-drill:detection-requires-exit-one')
  reset()
  mutate(drillFile, (source) => source.replace(/^( *)if \(output\.includes\('MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS'\)\) \{$/m, '$1if (false) {'))
  detected('the drill accepts a suite that printed PASS and then exited 1', 'mutation-drill:detection-refuses-a-pass-marker')
  reset()
  mutate(drillFile, (source) => source.replace(/^( *)if \(behaviourBaseline\.output\.includes\(expected\)\) \{$/m, '$1if (false) {'))
  detected("the drill stops requiring its expected sentence to be absent from the green baseline", 'mutation-drill:detection-sentence-must-be-new')
  reset()
  mutate(drillFile, (source) => source.replace(/^( *)for \(const field of expectedManifestFields\) \{$/m, '$1for (const field of []) {'))
  detected('the drill records a blind spot without checking the run had the shape it claims', 'mutation-drill:gap-requires-the-expected-manifest')
  reset()
  mutate(drillFile, (source) => source.replace(/^( *)if \(behaviourBaseline\.status !== 0 \|\|/m, '$1if (false &&'))
  detected('the drill stops requiring its behavioural baseline to be green', 'mutation-drill:behavioural-baseline-must-be-green')

  // ---------------------------------------------------------------------------------------------------
  // THE BEHAVIOURAL HALF. Every drill above asks the STATIC guard whether it noticed, and every one of
  // them is a text mutation caught by a text pin. A fresh-context review measured what that cannot see:
  // `Assert-True` in the ownership suite was rewritten to record ONLY its own canary message and to drop
  // the general path entirely, and the whole gate stayed green - static guards PASS, all controlled
  // mutations above detected, `OWNERSHIP_MANIFEST ... canary=caught` with every table at full size, all
  // six challenge answers correct from a fresh nonce - with roughly a hundred real assertions inert.
  // Reproduced against the real files before this section was written.
  //
  // No text guard can close that, because the sabotaged text IS present, and no self-test inside the
  // suite can either: whatever the suite hands its own helper, the helper can be written to recognise.
  // The only check that survives is end to end - break the SUBJECT, then require the suite to say so.
  // A suite whose assertions do not bite cannot report a broken predicate, however its internals are
  // arranged, so this measures execution rather than presence.
  const ownershipSuite = 'scripts/maple-season-browser-ownership.regression.ps1'
  const predicateFile = 'scripts/maple-season-browser.ps1'
  const runOwnershipSuite = () => {
    // Not execFileSync: a suite that reports FAIL exits 1, and execFileSync throws on that, so the
    // expected outcome would arrive as an exception and the unexpected one as a value.
    //
    // TIMED OUT, because every subject below is deliberately broken and a broken subject can loop instead of
    // answering. Without this the drill would hang until the job's own 45-minute limit killed it, which reads
    // as an infrastructure failure rather than as this drill's verdict. A timeout kills the child and returns
    // status null with signal SIGTERM, so it is distinguished from a real non-zero exit rather than being
    // scored as one - `null` is not zero, and a drill that accepted any non-zero result would call a hang a
    // detection.
    const result = spawnSync(onWindows ? 'powershell' : 'pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(temporary, ownershipSuite)], { encoding: 'utf8', timeout: 300000 })
    if (result.error?.code === 'ETIMEDOUT' || result.signal) {
      throw new Error(`The ownership suite did not finish within five minutes (signal ${result.signal ?? 'none'}), so this drill measured a hang rather than a verdict.`)
    }
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
  }
  // The baseline first, and it is load-bearing. "The suite went red" proves nothing unless the same suite
  // is green on unmutated source from this same copy: a suite that is red for an unrelated reason - a
  // missing file in the temp tree, a shell that cannot run it - would satisfy every drill below while
  // measuring nothing at all.
  reset()
  const behaviourBaseline = runOwnershipSuite()
  if (behaviourBaseline.status !== 0 || !behaviourBaseline.output.includes('MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS')) {
    throw new Error(`The ownership suite was not green on unmutated source in the baseline copy, so nothing below measures a mutation. exit=${behaviourBaseline.status}\n${behaviourBaseline.output.trim()}`)
  }
  const behaviouralMutations = []
  // A NAMED refusal, not merely a red exit. Measured while writing this: replacing the predicate's first guard
  // outright made the suite die with an exception, because that exact line is the needle the suite uses to gut
  // its own predicate - red, but for the wrong reason and saying nothing about the mutation. A drill that
  // accepted any non-zero exit would score that as a detection and would keep scoring it after the mutation
  // stopped being applied at all. So each case states the sentence the suite must produce.
  //
  // BY NAME means the sentence that names THIS defect, not the suite's generic FAIL marker. The first version
  // of this accepted `MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_FAIL` for three of the four cases, which a
  // fresh-context review correctly called "nonzero exit plus a substring": any unrelated failure, and any
  // future mutation that broke something else entirely, would have scored. Each case now states the sentence
  // the suite must produce about the specific thing that was broken.
  //
  // FOUR conditions, because a later fresh-context review showed that "non-zero exit plus a substring" is still
  // too generous. `status === 0 ||` accepted ANY non-zero result: a suite that could not start, a syntax error
  // introduced by the mutation, a crash in an unrelated file - each scores as a detection, and keeps scoring
  // after the mutation stops being applied. So:
  //   1. exit is EXACTLY 1, the code this suite uses to say FAIL. Not 2, not 255, not null.
  //   2. the sentence naming THIS defect is present.
  //   3. the PASS marker is absent. A suite that reported PASS and then exited 1 for an unrelated reason has
  //      not reported the mutation, whatever else is in its output.
  //   4. the sentence is NEW relative to the green baseline captured above. If the suite says it on unmutated
  //      source too, the sentence is not evidence about the mutation - it is boilerplate, and the case is
  //      measuring nothing.
  const detectedByBehaviour = (label, expected) => {
    if (behaviourBaseline.output.includes(expected)) {
      throw new Error(`${label}: the sentence this case waits for is already present when the suite runs on UNMUTATED source, so finding it after the mutation proves nothing about the mutation. expected=${expected}`)
    }
    const { status, output } = runOwnershipSuite()
    if (status !== 1) {
      throw new Error(`${label}: the ownership suite exited ${status} on a deliberately broken subject. Only exit 1 is this suite's way of reporting a defect; any other code means it fell over instead of reporting, and a crash is not a detection.\n${output.trim()}`)
    }
    if (!output.includes(expected)) {
      throw new Error(`${label}: the ownership suite went red but never said what was wrong, so its assertions do not bite on this defect. expected=${expected}\n${output.trim()}`)
    }
    if (output.includes('MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS')) {
      throw new Error(`${label}: the ownership suite printed its PASS marker AND exited 1, so the red exit is not attributable to this mutation.\n${output.trim()}`)
    }
    behaviouralMutations.push(label)
    console.log(`Behavioural mutation detected: ${label}`)
  }
  // The other half of honesty about this drill: where the suite CANNOT see a broken subject, measure that and
  // say so, rather than skipping the case silently or asserting a detection the platform cannot produce.
  //
  // A fresh-context review found the drill as first written could not pass on ubuntu-latest at all, which is
  // the only place CI runs it: the suite skips every must-be-TRUE case off Windows, so a predicate that
  // REFUSES EVERYTHING leaves all portable refusals passing, the suite exits 0, and the required detection
  // never arrives. Reproduced by forcing the suite's $onWindows to false with that predicate in place - exit 0,
  // PASS marker, windowsCases=0. So the expectation is now platform-conditional, and where the answer is "not
  // measured here" this prints a named gap that a Windows lane would have to close.
  //
  // Exit 0 ALONE is not enough here either, for the mirror-image reason. A suite that exits 0 because it stopped
  // early - a `return` near the top, a body that no longer runs - also exits 0, and would be recorded as "this
  // platform cannot see the defect" when the truth is "this run measured nothing". So the gap is only recorded
  // when the suite ran all the way to the end and said so: the PASS marker, plus a manifest whose own fields
  // agree that this is the off-Windows shape the gap is claimed about.
  const behaviourGaps = []
  const unseenByBehaviour = (label, why, expectedManifestFields) => {
    const { status, output } = runOwnershipSuite()
    if (status !== 0) {
      throw new Error(`${label}: this platform was expected NOT to see the defect, and the suite went red anyway. The gap this records has been closed or moved, so this case needs re-deciding rather than re-asserting. exit=${status}\n${output.trim()}`)
    }
    if (!output.includes('MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS')) {
      throw new Error(`${label}: the ownership suite exited 0 without printing its PASS marker, so it stopped somewhere short of the end. That is not a measured blind spot, it is an unmeasured run.\n${output.trim()}`)
    }
    for (const field of expectedManifestFields) {
      if (!output.includes(field)) {
        throw new Error(`${label}: the ownership suite's manifest does not carry ${field}, so this run is not the off-Windows shape this gap is claimed about and the gap is not what was measured.\n${output.trim()}`)
      }
    }
    behaviourGaps.push(label)
    console.log(`BEHAVIOUR_GAP ${label}: ${why}`)
  }
  // The kill-authorizing predicate, in both directions. A false TRUE force-kills a foreign process on the
  // workstation; a false FALSE fails a proof month with a wrong diagnosis. Both are inserted lines rather
  // than edited ones, so no pinned substring moves and the static guard above stays green on them - which
  // is precisely why this section exists.
  // Inserted AFTER the null guard, not over it. Replacing that line was measured to make the suite die
  // with an exception instead of a verdict: the suite locates that exact guard to gut the predicate for
  // its own anti-vacuity check, so deleting it makes the suite refuse to report at all. A crash is not a
  // defect report, and a drill that accepted one would stop distinguishing "the suite noticed" from "the
  // suite fell over", so the needle leaves the line in place and the mutation goes underneath it.
  const authorizeEverything = (source) => source.replace('  if ($null -eq $ListenerProcess) { return $false }', '  if ($null -eq $ListenerProcess) { return $false }\n  return $true')
  reset()
  mutate(predicateFile, authorizeEverything)
  // The dangerous direction, and the one the portable refusals cover everywhere: a predicate that says TRUE
  // about a listener in another tree is what force-kills a stranger's process on the workstation.
  detectedByBehaviour('kill-authorizing predicate authorizes everything', 'The ownership predicate authorized a kill for ')
  reset()
  mutate(predicateFile, (source) => source.replace('  if ($null -eq $ListenerProcess) { return $false }', '  if ($null -eq $ListenerProcess) { return $false }\n  return $false'))
  // The other direction is proved only by the must-be-TRUE table, and that table is Windows-only, so this is
  // the case that splits by platform. On ubuntu it is an honest, measured blind spot; a Windows CI job is what
  // would close it, and until one exists the gap is printed rather than implied.
  if (onWindows) {
    detectedByBehaviour('kill-authorizing predicate refuses everything', 'The ownership predicate refused ')
  } else {
    unseenByBehaviour('kill-authorizing predicate refuses everything', 'the must-be-TRUE table is Windows-only, so off Windows the suite stays green on a predicate that declares every listener foreign - it would fail a proof month with a wrong diagnosis and nothing here would notice', ['windows=false', 'windowsCases=0', 'cases=5'])
  }
  reset()
  mutate(predicateFile, (source) => source.replace('  param([string]$CommandLine)\n', '  param([string]$CommandLine)\n  return @($CommandLine)\n'))
  detectedByBehaviour('tokenizer collapses every command line into one argument', 'disagreed with the measured Windows parse on ')
  // THE CASE THIS SECTION WAS WRITTEN FOR, planted verbatim as the review wrote it. The helper still
  // records the canary, so `canary=caught` is still honest and the suite's own self-test still passes;
  // every other assertion is discarded. Paired with an authorize-everything predicate, the suite has a
  // real defect in front of it and no working way to report it.
  reset()
  mutate(ownershipSuite, (source) => source.replace(
    '  if (-not $Condition) { $script:failures += $Message }\n',
    '  if ($Message -ceq $script:assertionCanary) { $script:failures += $Message; return }\n'))
  mutate(predicateFile, authorizeEverything)
  detectedByBehaviour('assertion helper honours only its own canary while the predicate authorizes everything', 'reporting channels disagree')
  // The defeat that made the case tally count every case rather than only the failing ones: wrapping an
  // assertion that normally PASSES in `if ($false) { ... }` left the old failure-only tally at zero on both
  // channels, agreeing, and the suite printed PASS. Reproduced against the real file. The suite now publishes
  // how many cases it REACHED, so a case short of the expected count refuses to report at all.
  reset()
  mutate(ownershipSuite, (source) => source.replace(
    "Assert-MapleSeasonCase (@($expectedRefusalLabels | Select-Object -Unique).Count -eq $portableRefusals.Count)",
    "if ($false) { Assert-MapleSeasonCase (@($expectedRefusalLabels | Select-Object -Unique).Count -eq $portableRefusals.Count)"))
  mutate(ownershipSuite, (source) => source.replace(
    "'Two refusal rows share a label, so the set comparison above cannot tell them apart.'\n",
    "'Two refusal rows share a label, so the set comparison above cannot tell them apart.' }\n"))
  detectedByBehaviour('an assertion that normally passes is skipped without changing a single pinned string', 'assertion cases and expected at least ')
  reset()
  // Printed LAST, and both markers together. The static half's marker used to print before this section ran,
  // so a fresh-context review could wrap the whole behavioural half and still read `Foundation mutation drill:
  // PASS` in the log. Nothing in this file may claim success before everything in it has run.
  console.log(`Foundation mutation drill: PASS (${detectedMutations.length} controlled mutations turned the gate red)`)
  console.log(`Foundation behavioural mutation drill: PASS (${behaviouralMutations.length} broken subjects were reported by the suite that runs against them, ${behaviourGaps.length} not measurable on this platform)`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
