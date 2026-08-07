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
  // ownership predicate, and the workflow that asserts the orchestrator's completion marker from
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
  'scripts/maple-july-db-clock-wiring.regression.ps1', 'scripts/maple-season-browser-timeout.regression.ps1',
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
// How many mutations have actually been written to the copy and not yet been spent by a detection. Nothing
// used to check that a detection had a WRITE behind it: `detected` only re-ran the guard and looked for a
// label, so two `detected` calls after ONE `mutate` both passed and the total counted a defect that was
// never planted. A fresh-context review found the total fabricable. So `mutate` counts what it wrote and
// `detected` spends it - a detection with nothing pending is refused by name.
//
// SAY EXACTLY WHAT THE TOTAL IS, because a later review found the summary line overstating it. `detected`
// clears the pending count whatever its value, so one detection can stand on more than one write: several
// drills below rewrite two or three anchors that only form a defect together. The total is therefore the
// number of CONTROLLED DEFECTS - each one planted by at least one real write and each one named back by the
// gate - and the summary line says "defects" for that reason. It is not a count of `replace` calls, and the
// earlier word "mutations" invited exactly that misreading.
let pendingMutations = 0
const reset = () => { pendingMutations = 0; for (const path of files) { const target = join(temporary, path); mkdirSync(dirname(target), { recursive: true }); cpSync(join(root, path), target) } }
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
  pendingMutations += 1
}
// Count the drills instead of restating the total in the summary line. The hand-written count went
// stale the moment a drill was added, which made the summary claim coverage it had not measured.
const detectedMutations = []
const detected = (label, expected) => {
  if (pendingMutations === 0) throw new Error(`${label} claims a controlled mutation, but none was applied since the last reset or detection, so the drill total would count a mutation that never happened.`)
  const failures = foundationStaticGuard(temporary)
  if (!failures.includes(expected)) throw new Error(`${label} mutation was not detected. Observed: ${failures.join(', ')}`)
  pendingMutations = 0
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
  // The behavioural suite over the ownership predicate, and the reason it exists: every mutation
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
  // The ownership predicate. It now compares whole ARGUMENTS, parsed by Windows' own rules,
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
  // The quotes are DOUBLED because the text being replaced sits inside a single-quoted PowerShell string. Written
  // with bare quotes this mutation left a file PowerShell cannot parse, so the pin reddened on broken syntax
  // rather than on the weakening it names - the defect could never have shipped, because any parse would reject
  // it first. Escaped, the mutated file parses and says exactly what a maintainer narrowing the drift would say.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('[char]::IsWhiteSpace($character)', "($character -eq '' '')"))
  detected('stall drill stops re-introducing the separator drift it exists to catch', 'season-browser-regression:stall-drill-reintroduces-drift')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('made the command-line parse stall', 'took a while'))
  detected('stall drill stops naming a stalled parse as a failure', 'season-browser-regression:stall-is-fatal')
  reset()
  // NAMES THE STALL DRILL'S OWN SENTENCE. The needle used to be the shared tail phrase alone, and once a second
  // stale-needle guard in this same file earned that phrase legitimately, `.replace` patched whichever copy came
  // FIRST in the file - the other guard's - while the label below still pointed at the stall drill's. The
  // mutation applied, the pin stayed green, and the drill reported the guard as blind when the guard was fine.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace(
    'The stall drill could not find the shared separator test to drift; its needle is stale and the drill would prove nothing.',
    'continuing anyway'))
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
  // ---- THE JOB OBJECT, AND THE ONE LIMIT THAT MAKES IT A BACKSTOP -------------------------------------
  // Every drill from the previous eight rounds that lived here is gone, and not because it was weak: the code
  // it drilled is gone. Those mutations broke a taskkill tree walk, a $verifiedPortRelease flag, a creation-time
  // reconciliation and a kill by process id, none of which this file contains any more. A drill whose needle
  // names deleted code is not coverage, it is a stale needle - which `mutate` refuses by name rather than
  // silently testing unmodified source, and which is how the whole set below was found to need re-aiming.
  //
  // The replacements are aimed at what now carries the weight. Each one models the REAL defect rather than
  // breaking adjacent text or making the file unparseable, because a guard that reddens on broken syntax proves
  // only that it noticed garbage. Where a single realistic defect necessarily trips two pins, the drill says so
  // and names the one it is aimed at.
  //
  // KILL_ON_JOB_CLOSE zeroed. The job is still created, still assigned, still terminated - and nothing is ever
  // reaped when this session dies without running a finally, which is the one guarantee no PowerShell statement
  // can provide. Contiguous needle, so the flag cannot be separated from the struct it is written into.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;',
    '    limits.BasicLimitInformation.LimitFlags = 0;'))
  detected('the job stops asking for kill-on-job-close', 'season-browser:job-asks-for-kill-on-job-close')
  reset()
  // A limit asked for and never applied. Passing a different information class leaves SetInformationJobObject
  // SUCCEEDING with the struct ignored, so no error is raised anywhere and the backstop is simply absent.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    'if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size)) {',
    'if (!SetInformationJobObject(job, 4, buffer, (uint)size)) {'))
  detected('the job limit is applied under the wrong information class', 'season-browser:job-limit-is-applied-to-the-job')
  reset()
  // And the VALUE, not merely the name. 0x8 is JOB_OBJECT_LIMIT_PROCESS_MEMORY; the flag is still named, still
  // assigned, still applied, and the kernel is being told something else entirely.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;',
    '  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00000008;'))
  detected('the kill-on-job-close flag is retuned to a different limit', 'season-browser:kill-on-job-close-is-the-documented-flag')
  reset()
  // A failed creation that records the error and carries on. The caller then receives a zero handle from a
  // function whose contract is "a job or nothing", and every kill made through it reaches no process at all.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if (job == IntPtr.Zero) { error = Marshal.GetLastWin32Error(); stage = "create"; return IntPtr.Zero; }',
    '    if (job == IntPtr.Zero) { error = Marshal.GetLastWin32Error(); stage = "create"; }'))
  detected('a job that could not be created is returned anyway', 'season-browser:job-creation-failure-returns-nothing')
  reset()
  // And the stage that names WHICH of the two job failures happened. Delete it and both refusals read "failed at
  // the  stage" - an empty word in an evidence log, and the two failures are different facts: one means the
  // kernel would not make a job, the other means it made one that cannot be trusted to reap anything.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '        stage = "limit";\n',
    ''))
  detected('the job limit failure stops naming its stage', 'season-browser:job-limit-failure-reports-its-stage')
  reset()
  // The opposite half: a job whose limit could not be set, handed back instead of closed. It governs membership
  // correctly and reaps nothing, so the failure shows up only as a stranded browser tree after a killed session.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '          string unusableJob = CloseAndDescribe(job, "the unusable job object", ref jobIsStillThisMethodsToLose);\n          if (unusableJob.Length > 0) { stage = "limit, and" + unusableJob; }\n          return IntPtr.Zero;\n',
    '          jobIsStillThisMethodsToLose = false;\n          return job;\n'))
  detected('a job without its limit is handed back rather than closed', 'season-browser:job-without-its-limit-is-closed-not-returned')
  reset()
  // AND THE REGRESSION THAT MOTIVATED THE CHECK: the close is made but its result is thrown away, which is the
  // exact shape a fresh-context review found here. The handle is gone either way, the refusal reads the same, and
  // a leaked kernel object goes unmentioned for the life of the session. This one is invisible to any pin that
  // asks only whether CloseHandle is called.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '          string unusableJob = CloseAndDescribe(job, "the unusable job object", ref jobIsStillThisMethodsToLose);\n          if (unusableJob.Length > 0) { stage = "limit, and" + unusableJob; }\n',
    '          CloseHandle(job);\n          jobIsStillThisMethodsToLose = false;\n'))
  detected('the job close result is discarded again', 'season-browser:job-without-its-limit-is-closed-not-returned')
  reset()
  // THE THIRD WAY THIS METHOD CAN LEAK ITS JOB, and the one no enumerated failure path covers: a MANAGED throw
  // between creating the job and returning it. AllocHGlobal throws OutOfMemoryException, SizeOf and StructureToPtr
  // throw on a bad type or pointer, and any of them unwinds out of the method with the job created and nobody
  // holding its handle. Three drills, one per part of the invariant, because each part fails differently.
  //
  // First, the flag starts FALSE: every enumerated path still behaves, the success return is unchanged, and the
  // outer finally simply never closes anything - so this is the original defect restored with the fix still
  // visibly present in the file.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    bool jobIsStillThisMethodsToLose = true;',
    '    bool jobIsStillThisMethodsToLose = false;'))
  detected('the job-ownership flag starts out already disclaimed', 'season-browser:job-creation-tracks-whether-the-handle-is-still-its-own')
  reset()
  // Second, the success return stops clearing it - which is the OPPOSITE failure and a far worse one: the finally
  // closes the handle it just returned, so the caller holds a dead handle, KILL_ON_JOB_CLOSE fires on a job with
  // no members yet, and every subsequent AssignProcessToJobObject fails on a closed handle. Every launch breaks,
  // which is the good case; the point of the drill is that the pin catches it here rather than at run time.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      jobIsStillThisMethodsToLose = false;\n      return job;\n',
    '      return job;\n'))
  detected('the successful return keeps claiming the job it handed away', 'season-browser:job-creation-hands-ownership-to-the-caller-on-success')
  reset()
  // Third, the rescue goes back to being a FINALLY THAT DISCARDS ITS CLOSE - which is not a hypothetical, it is
  // the shape the previous commit shipped and the next fresh-context review objected to. Every part of the
  // invariant is still visibly present, the job is still closed on the thrown path, and the one thing that is
  // gone is the report: when the close fails the handle leaks for the session and nothing anywhere says so, under
  // a guard label that promised the job could not leak on a thrown path. Valid C#, and every other pin green.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    } catch (Exception thrown) {\n      if (!jobIsStillThisMethodsToLose) { throw; }\n      string leakedJob = CloseAndDescribe(job, "the job object being created", ref jobIsStillThisMethodsToLose);\n      if (leakedJob.Length == 0) { throw; }\n      InvalidOperationException decorated = Decorate(thrown, leakedJob, "", "");\n      if (decorated == null) { throw; }\n      throw decorated;\n    }\n',
    '    } finally {\n      if (jobIsStillThisMethodsToLose) { CloseHandle(job); }\n    }\n'))
  detected('the job is left to leak unreported on a thrown path', 'season-browser:job-creation-closes-and-reports-its-job-on-a-thrown-path')
  reset()
  // Fourth, the ORIGINAL EXCEPTION IS DROPPED. The leak is still reported, the close is still checked, and the
  // reason the unwind started - the OutOfMemoryException, the bad-pointer failure - is replaced by a sentence
  // about a handle. Whoever reads the refusal learns that a job leaked and loses the fact that explains why the
  // method was unwinding at all, which is the more actionable of the two.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      InvalidOperationException decorated = Decorate(thrown, leakedJob, "", "");',
    '      InvalidOperationException decorated = new InvalidOperationException(thrown.Message + leakedJob);'))
  detected('the job leak report throws away the exception that caused it', 'season-browser:job-creation-closes-and-reports-its-job-on-a-thrown-path')
  reset()
  // Fifth, the flag is no longer CONSULTED. The limit-failure path has already closed this handle and cleared the
  // flag; a throw while it was assembling its stage sentence lands here, and without the guard the same handle
  // closes a second time. Windows reissues handle values, so the second close can land on a handle this process
  // opened since - the inspection handle in Clear-MapleSeasonBrowserPort, say. Nothing about the file's behaviour
  // changes on any ordinary run, which is what makes it a drill rather than a test.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      if (!jobIsStillThisMethodsToLose) { throw; }\n',
    ''))
  detected('the thrown path closes a job handle it may already have closed', 'season-browser:job-creation-closes-and-reports-its-job-on-a-thrown-path')
  reset()

  // ---- SUSPENDED, ASSIGNED, AND ONLY THEN RESUMED -----------------------------------------------------
  // CREATE_SUSPENDED deleted. This is the hazard the whole design exists to close, and it is invisible: the job
  // is created, the child is assigned, the limit is applied, every other pin in this section stays green - and
  // the child is running from the instant CreateProcessW returns, so the dev server it spawns in that window is
  // born OUTSIDE the job. Job membership is the only thing that authorizes a kill, so the one process this file
  // most needs to own becomes the one it must refuse to touch.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '        CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, workingDirectory, ref startup, out created)) {',
    '        CREATE_NO_WINDOW, IntPtr.Zero, workingDirectory, ref startup, out created)) {'))
  detected('the child is no longer created suspended', 'season-browser:launch-creates-its-child-suspended')
  reset()
  // The same hole reached by ORDER instead of by deletion, which is why that pin compares three positions rather
  // than asserting three presences. CREATE_SUSPENDED stays, the assignment stays, both failure paths stay - and
  // the child is resumed before it is a member, so the window is exactly as wide as it was above. The assign
  // block is DELETED first and reinserted after the resume, because String.replace patches only the first match
  // and a copy-then-delete would find its own copy.
  mutate('scripts/maple-season-browser.ps1', (source) => {
    // The whole block, COMMENTS INCLUDED, because this needle runs against raw source and the block's own
    // explanation lives inside its braces. Spelled as a literal rather than sliced with indexOf on purpose: a
    // literal that goes stale makes this a no-op and mutate() throws, whereas an indexOf that returns -1 would
    // slice from the end of the file and hand the guard broken syntax to redden on instead of the named defect.
    const assignBlock = [
      '      if (!AssignProcessToJobObject(job, created.hProcess)) {',
      '        error = Marshal.GetLastWin32Error();',
      '        stage = "assign";',
      '        // THE RETURN VALUE IS CHECKED, because this is the one child KILL_ON_JOB_CLOSE cannot save. The',
      '        // assignment failed, so this process is not a member of the job, and nothing that happens to the job',
      '        // handle will ever touch it. It was created suspended, so it will never run and never exit on its own.',
      '        // A few lines below, both handles close and this script loses the ability to name it at all. So if the',
      '        // kill fails, the pid leaves through stage and processId and the refusal upstream tells a human which',
      '        // process to end, rather than reporting a cleanup that did not happen.',
      '        //',
      '        // AND THE PID IS RECORDED BEFORE THE SENTENCE THAT REPORTS IT, not after. A fresh-context review found',
      '        // the order the other way round: the concatenation came first, and a concatenation allocates, so an',
      '        // OutOfMemoryException there unwound out of this method with a live unowned suspended child and every',
      '        // name for it lost - `processId` unassigned, and unassignable anyway, because out parameters do not',
      '        // survive a throw. Three statements, in the only order that survives a failure of any of them: read the',
      '        // error while it is still the last error, record the id where the catch can reach it, then build the',
      '        // sentence that is merely the nicest way of saying it.',
      '        if (!TerminateProcess(created.hProcess, 1)) {',
      '          int killError = Marshal.GetLastWin32Error();',
      '          strandedChildId = created.dwProcessId;',
      '          processId = created.dwProcessId;',
      '          stage = "assign, and the suspended child could not be terminated (Windows error "',
      '            + killError.ToString() + ")";',
      '        }',
      '        // EACH CLOSE IS ITS OWN STATEMENT, and the sentences are collected before either is appended to stage.',
      '        // Written as one chained expression - stage + close(thread) + close(process) - a throw while',
      '        // concatenating the first sentence would skip the second close entirely, which is the whole defect this',
      '        // block exists to close.',
      '        string unassignedThread = CloseAndDescribe(created.hThread, "the unassigned child\'s thread handle",',
      '          ref threadHandleIsStillThisMethodsToLose);',
      '        string unassignedProcess = CloseAndDescribe(created.hProcess, "the unassigned child\'s process handle",',
      '          ref processHandleIsStillThisMethodsToLose);',
      '        stage = stage + unassignedThread + unassignedProcess;',
      '        return false;',
      '      }',
      '',
    ].join('\n')
    const reinsertAnchor = '      stage = CloseAndDescribe(created.hThread, "the launched child\'s thread handle",\n        ref threadHandleIsStillThisMethodsToLose);\n      processHandle = created.hProcess;'
    // Both anchors checked before either is used, for the reason spelled out on the try-after-launch drill
    // below: with two replaces, a stale needle rides along on a live one and mutate() sees a changed file.
    if (!source.includes(assignBlock) || !source.includes(reinsertAnchor)) {
      throw new Error('the assign-after-resume drill lost an anchor and would have half-applied; needles are stale: ' +
        JSON.stringify({ assignBlockFound: source.includes(assignBlock), reinsertAnchorFound: source.includes(reinsertAnchor) }))
    }
    return source
      .replace(assignBlock, '')
      .replace(reinsertAnchor, assignBlock + reinsertAnchor)
  })
  detected('the child is assigned to the job only after it is already running', 'season-browser:child-is-assigned-to-the-job-before-it-runs')
  reset()
  // The two failure paths clean up DIFFERENTLY, so they are two pins and two drills. A child that could not be
  // ASSIGNED is not a member, so TerminateJobObject cannot reach it and only TerminateProcess can: delete that
  // call and a suspended process that will never be resumed and never be killed stays on the workstation for
  // the life of the login session. Nothing reports it, because the function correctly returns false.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    [
      '        if (!TerminateProcess(created.hProcess, 1)) {',
      '          int killError = Marshal.GetLastWin32Error();',
      '          strandedChildId = created.dwProcessId;',
      '          processId = created.dwProcessId;',
      '          stage = "assign, and the suspended child could not be terminated (Windows error "',
      '            + killError.ToString() + ")";',
      '        }',
      '',
    ].join('\n'),
    ''))
  detected('a child that could not be assigned is abandoned suspended', 'season-browser:launch-terminates-a-child-it-could-not-assign')
  reset()
  // AND THE SHAPE A FRESH-CONTEXT REVIEW ACTUALLY FOUND, which the deletion above cannot reach: the kill is still
  // made, so every "is TerminateProcess called here" question answers yes, and its bool is thrown away. When the
  // kill fails - the child is protected, the handle carries no PROCESS_TERMINATE right, the pid is already
  // reaped and reissued - the function returns false having reported nothing, the two handles close, and the last
  // name anyone had for a permanently suspended process is gone. The comment above the mutated line still says
  // the return value is checked, which is the second half of the defect: a false comment reads as proof.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    [
      '        if (!TerminateProcess(created.hProcess, 1)) {',
      '          int killError = Marshal.GetLastWin32Error();',
      '          strandedChildId = created.dwProcessId;',
      '          processId = created.dwProcessId;',
      '          stage = "assign, and the suspended child could not be terminated (Windows error "',
      '            + killError.ToString() + ")";',
      '        }',
    ].join('\n'),
    '        TerminateProcess(created.hProcess, 1);'))
  detected('the failed-assignment kill goes back to discarding its result', 'season-browser:launch-terminates-a-child-it-could-not-assign')
  reset()
  // And the mirror: a child that could not be RESUMED is already a member, so terminating the JOB is what kills
  // it. Delete that and the stranded suspended process is a job member with nothing left holding the job.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '        TerminateJobObject(job, 1);\n        string unresumedThread = CloseAndDescribe(created.hThread, "the unresumed child\'s thread handle",\n',
    '        string unresumedThread = CloseAndDescribe(created.hThread, "the unresumed child\'s thread handle",\n'))
  detected('a child that could not be resumed is abandoned inside its job', 'season-browser:launch-kills-the-job-of-a-child-it-could-not-resume')
  reset()
  // AND THE SPLIT ITSELF, on the path where re-chaining it is the defect a fresh-context review named: the two
  // closes go back into one expression, so a throw while the first sentence is being concatenated skips the second
  // close and leaks the child's process handle for the session. Both closes are still present, both still report,
  // and the ordering that makes the report survivable is gone.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '        string unresumedThread = CloseAndDescribe(created.hThread, "the unresumed child\'s thread handle",\n          ref threadHandleIsStillThisMethodsToLose);\n        string unresumedProcess = CloseAndDescribe(created.hProcess, "the unresumed child\'s process handle",\n          ref processHandleIsStillThisMethodsToLose);\n        stage = stage + unresumedThread + unresumedProcess;\n',
    '        stage = stage + CloseAndDescribe(created.hThread, "the unresumed child\'s thread handle",\n          ref threadHandleIsStillThisMethodsToLose)\n          + CloseAndDescribe(created.hProcess, "the unresumed child\'s process handle",\n          ref processHandleIsStillThisMethodsToLose);\n'))
  detected('the unresumed child\'s two closes are chained back into one expression', 'season-browser:launch-kills-the-job-of-a-child-it-could-not-resume')
  reset()

  // ---- AND EVERY CHILD-HANDLE CLOSE REPORTS ITS OUTCOME ------------------------------------------------
  // The helper always claiming success. The close still happens, every call site still appends its result, and
  // the result is now the empty string whatever the kernel said - so a handle that would not close is a leaked
  // kernel handle that keeps a process id reserved for the session, reported nowhere. Invisible to any pin that
  // asks only whether the helper is called.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if (CloseHandle(handle)) { return ""; }',
    '    CloseHandle(handle); return "";'))
  detected('the child-handle close helper always claims success', 'season-browser:child-handle-closes-report-their-outcome')
  reset()
  // AND THE ORDER OF THE TWO LINES INSIDE IT, which is the whole reason the flag is passed by reference instead of
  // cleared by each caller on the following line.
  //
  // THIS DRILL PROVES A PINNED ORDERING AND NOT A BEHAVIOURAL FAILURE, and saying so is the point of this comment.
  // It used to be labelled "the close helper disclaims ownership only after the close", claiming it recreated the
  // double-close defect - and a fresh-context review checked the mutated code and found no defect in it at all. On
  // the mutated failure path the flag is still cleared before anything that can throw, so no unwinding catch can
  // ever see a stale "mine". The guard went red because a contiguous text pin moved, which is the exact confusion
  // this whole harness exists to expose: a drill that passes without a defect behind it is a receipt for nothing.
  //
  // It is kept, at its honest strength, because the ordering IS worth holding: it is defence in depth for the day
  // someone adds a throwing statement between the close and the clear, which is what the helper looked like before
  // the sentence-building moved inside a try. The drill below - the accumulator restored between the two closes in
  // the launch rescue - is the one that plants the real version of this defect.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    stillOurs = false;\n    if (CloseHandle(handle)) { return ""; }',
    '    if (CloseHandle(handle)) { stillOurs = false; return ""; }\n    stillOurs = false;'))
  detected('the close helper clears ownership after the close rather than before it', 'season-browser:child-handle-closes-report-their-outcome')
  reset()
  // AND THE HELPER CANNOT THROW, which is the property that makes two-closes-in-a-row safe anywhere in this class.
  // Here the guarded sentence goes back to being an unguarded one: the close still happens, the outcome is still
  // reported, and building the report allocates - so a failed close in the first of two consecutive calls can throw
  // OutOfMemoryException out of the helper and the second handle never closes at all. Valid C#, identical on every
  // ordinary run, and the defect only appears on the one workstation state where the rescue matters.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    int windowsError = Marshal.GetLastWin32Error();\n    try {\n      return " " + label + " could not be closed (Windows error "\n        + windowsError.ToString() + "), so it leaked for the life of this session.";\n    } catch (Exception) { return CLOSE_FAILED_INDESCRIBABLY; }\n',
    '    return " " + label + " could not be closed (Windows error "\n      + Marshal.GetLastWin32Error().ToString() + "), so it leaked for the life of this session.";\n'))
  detected('the close helper can throw while describing a failed close', 'season-browser:child-handle-closes-cannot-throw-while-describing-a-failure')
  reset()
  // AND DECORATING AN EXCEPTION CANNOT REPLACE IT. Here the decorator throws instead of degrading: the try is gone,
  // so on the out-of-memory state that makes AllocHGlobal fail in the first place, the concatenation fails a second
  // time and the OutOfMemoryException raised inside the catch REPLACES the exception travelling through it. The
  // refusal a human reads then says "out of memory" where it used to say why the launch actually failed. Both
  // rescues in the class route through this one helper, so this single mutation is the whole class's regression.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    try {\n      return new InvalidOperationException(thrown.Message + first + second + third, thrown);\n    } catch (Exception) { return null; }\n',
    '    return new InvalidOperationException(thrown.Message + first + second + third, thrown);\n'))
  detected('decorating an exception can replace the diagnosis it was adding to', 'season-browser:exception-decoration-cannot-replace-the-original-diagnosis')
  reset()
  // AND THE CLOSE PRIMITIVE IS REALLY kernel32's CloseHandle, which the census alone cannot establish: a census
  // says "no line mentions CloseHandle except these two", and this mutation changes NEITHER of those lines. It
  // re-points the DllImport above the declaration at a different entry point, so every close in the class calls
  // something that is not CloseHandle while the managed name, the call site, and the census all stay exactly as
  // they were. A fresh-context review named this hole; the attribute is pinned with its declaration to close it.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  [DllImport("kernel32.dll", SetLastError = true)]\n  public static extern bool CloseHandle(IntPtr handle);',
    '  [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "CloseHandle")]\n  public static extern bool CloseHandle(IntPtr handle);'))
  detected('the close primitive is rebound through a re-pointed DllImport attribute', 'season-browser:the-close-primitive-is-bound-to-kernel32-closehandle')
  reset()
  // A BARE CLOSE REAPPEARING SOMEWHERE, which is the shape the forbid exists for: the five original bare calls
  // are gone, and nothing stops a sixth being written at a new call site. This restores two of them at the
  // assign path. It reddens that path's own pin as well - the label aimed at is the forbid, which is the one
  // that has no line number and therefore covers call sites this file has not thought of.
  const assignPathCloses = '        string unassignedThread = CloseAndDescribe(created.hThread, "the unassigned child\'s thread handle",\n          ref threadHandleIsStillThisMethodsToLose);\n        string unassignedProcess = CloseAndDescribe(created.hProcess, "the unassigned child\'s process handle",\n          ref processHandleIsStillThisMethodsToLose);\n        stage = stage + unassignedThread + unassignedProcess;\n'
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    assignPathCloses,
    '        CloseHandle(created.hThread);\n        CloseHandle(created.hProcess);\n'))
  detected('a child handle is closed again without reporting the outcome', 'season-browser:a-child-handle-is-closed-without-reporting-the-outcome')
  reset()
  // AND THE THREE SPELLINGS THAT DEFEATED THE EARLIER FORM OF THAT RULE. It forbade the literal
  // `CloseHandle(created.` - one exact character sequence - and a fresh-context review pointed out on paper that
  // legal C# has more than one way to write the same call. Each of the next three drills is that same bare,
  // unreported close in a spelling the literal rule would have read as clean, which is why the rule is now a
  // census of every CloseHandle mention in the class rather than a search for one arrangement of characters.
  //
  // First: a space between the name and the parenthesis. Identical IL, identical defect.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    assignPathCloses,
    '        CloseHandle (created.hThread);\n        CloseHandle (created.hProcess);\n'))
  detected('a bare close hides behind a space before its parenthesis', 'season-browser:a-child-handle-is-closed-without-reporting-the-outcome')
  reset()
  // Second: the argument wrapped in its own parentheses, so the two tokens the old rule looked for never appear
  // adjacent.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    assignPathCloses,
    '        CloseHandle((created.hThread));\n        CloseHandle((created.hProcess));\n'))
  detected('a bare close hides behind extra parentheses', 'season-browser:a-child-handle-is-closed-without-reporting-the-outcome')
  reset()
  // Third: a local alias. The close is made through a delegate, so the file never writes CloseHandle next to a
  // handle argument at all - and the old rule, which asked only about `CloseHandle(created.`, would have found
  // nothing to object to. The census catches it because the ALIAS ITSELF has to name CloseHandle somewhere.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    assignPathCloses,
    '        Func<IntPtr, bool> closer = CloseHandle;\n        closer(created.hThread);\n        closer(created.hProcess);\n'))
  detected('a bare close hides behind a local alias', 'season-browser:a-child-handle-is-closed-without-reporting-the-outcome')
  reset()
  // And the success path's report DISCARDED rather than the close removed, which is the subtler half. The handle
  // still closes and the helper still describes a failure - into nothing. `stage` stays at whatever StartInJob
  // last wrote, which on this path is nothing at all, so the caller's warning never fires and a launch that
  // leaked a handle is indistinguishable from a clean one. Deliberately does not spell a bare CloseHandle, so
  // the forbid above stays green and this drill can only be caught by the pin it names.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      stage = CloseAndDescribe(created.hThread, "the launched child\'s thread handle",',
    '      CloseAndDescribe(created.hThread, "the launched child\'s thread handle",'))
  detected('the successful launch throws away its own leak report', 'season-browser:launch-reports-a-thread-handle-it-could-not-close')
  reset()

  // ---- AND THE TWO CHILD HANDLES ARE TRACKED FROM THE MOMENT THEY EXIST -------------------------------
  // The launch path's version of the job-handle defect, one level down, and the one a fresh-context review found
  // still open after the job was fixed: between a successful CreateProcessW and the return, three deliberate exits
  // each close what they own and nothing covers a MANAGED throw between them.
  //
  // First, a flag starts already disclaimed. Every enumerated path behaves exactly as before - each one closes by
  // hand - and the rescue simply never closes the thread handle, which is the original defect restored with the
  // fix still visibly present in the file.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    bool threadHandleIsStillThisMethodsToLose = true;',
    '    bool threadHandleIsStillThisMethodsToLose = false;'))
  detected('the launch stops tracking its thread handle before it starts', 'season-browser:launch-tracks-both-child-handles-independently')
  reset()
  // Second, the OTHER flag, because two handles that stop being this method's at different moments cannot share
  // one flag and this pin is what says so. Same shape, different handle, and this is the worse of the two: the
  // process handle is the one the caller needs.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    bool processHandleIsStillThisMethodsToLose = true;',
    '    bool processHandleIsStillThisMethodsToLose = false;'))
  detected('the launch stops tracking its process handle before it starts', 'season-browser:launch-tracks-both-child-handles-independently')
  reset()
  // Third, the success path hands the process handle to the caller and KEEPS CLAIMING IT. This is the opposite
  // failure and the more damaging one: any later throw - or any future statement added after the hand-off - lets
  // the rescue close a handle the caller is already holding, so the caller waits on a dead handle while the child
  // it thinks it owns runs on.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      processHandle = created.hProcess;\n      processHandleIsStillThisMethodsToLose = false;\n',
    '      processHandle = created.hProcess;\n'))
  detected('the launch keeps claiming the process handle it handed away', 'season-browser:launch-reports-a-thread-handle-it-could-not-close')
  reset()
  // Fourth, the rescue stops CONSULTING a flag: the thread handle closes unconditionally, so a throw after the
  // success path already closed it closes the same handle twice - onto a value Windows may have reissued.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      if (threadHandleIsStillThisMethodsToLose) {\n        leakedThread = CloseAndDescribe(created.hThread, "the child\'s thread handle",',
    '      if (true) {\n        leakedThread = CloseAndDescribe(created.hThread, "the child\'s thread handle",'))
  detected('the launch rescue closes a thread handle it may already have closed', 'season-browser:launch-catch-closes-both-handles-before-building-any-sentence')
  reset()
  // Fifth, the rescue reports the leak and DESTROYS THE REASON IT WAS UNWINDING, exactly as on the job path.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      InvalidOperationException decorated = Decorate(thrown, stranded, leakedThread, leakedProcess);',
    '      InvalidOperationException decorated = new InvalidOperationException(thrown.Message + leakedThread + leakedProcess);'))
  detected('the launch leak report throws away the exception that caused it', 'season-browser:launch-closes-and-reports-both-child-handles-on-a-thrown-path')
  reset()
  // Sixth, the rescue closes the PROCESS handle and says nothing about it - the half of the pair that is easiest to
  // drop, because the thread handle's report is right above it and reads as covering both.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '        leakedProcess = CloseAndDescribe(created.hProcess, "the child\'s process handle",\n          ref processHandleIsStillThisMethodsToLose);\n',
    '        CloseAndDescribe(created.hProcess, "the child\'s process handle",\n          ref processHandleIsStillThisMethodsToLose);\n'))
  detected('the launch rescue drops its process-handle leak report', 'season-browser:launch-catch-closes-both-handles-before-building-any-sentence')
  reset()
  // Seventh, THE ACCUMULATOR COMES BACK BETWEEN THE TWO CLOSES, which is the defect a fresh-context review found in
  // the rescue itself: `leaked = leaked + CloseAndDescribe(...)` performs a string concatenation between closing the
  // first handle and closing the second, and OutOfMemoryException is the likeliest reason this catch is running at
  // all. A throw there leaks the process handle - the very handle the rescue exists to save - and does it inside the
  // block whose comment claimed the split had closed that hole. Both closes are still written, both still report,
  // and the ordering that makes the second one reachable is gone. This is the mutation that plants the real version
  // of the double-close-window defect the helper-ordering drill above only pins textually.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '        leakedThread = CloseAndDescribe(created.hThread, "the child\'s thread handle",',
    '        leakedThread = leakedThread + CloseAndDescribe(created.hThread, "the child\'s thread handle",'))
  detected('the launch rescue reintroduces an allocation between its two closes', 'season-browser:launch-catch-closes-both-handles-before-building-any-sentence')
  reset()
  // Eighth, THE STRANDED CHILD'S ID IS NEVER RECORDED. The kill is still checked and its failure still reported
  // through stage, so every "does this path check its kill" question answers yes - and the one path in the file that
  // can leave a live, suspended, unowned process behind loses the pid on any throw after this point, because out
  // parameters are not marshalled back from a method that threw. What a human loses is the process id they need to
  // end it by hand.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '          strandedChildId = created.dwProcessId;\n          processId = created.dwProcessId;\n',
    '          processId = created.dwProcessId;\n'))
  detected('the id of a child nothing will reap is never recorded for the rescue', 'season-browser:launch-terminates-a-child-it-could-not-assign')
  reset()
  // Ninth, IT IS RECORDED AND THEN NEVER REPORTED - the other half, and the easier one to write by accident, because
  // the rescue reads as complete without it: two handles closed, two leaks reported, and no mention of the process.
  // The `if` then rethrows the original untouched whenever both closes succeeded, so a stranded child on a
  // successful-close path is silent.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      if (leakedThread.Length == 0 && leakedProcess.Length == 0 && stranded.Length == 0) { throw; }\n',
    '      if (leakedThread.Length == 0 && leakedProcess.Length == 0) { throw; }\n'))
  detected('a stranded child is recorded and then left out of the rescue report', 'season-browser:launch-closes-and-reports-both-child-handles-on-a-thrown-path')
  reset()

  // ---- THE NARROWED INTEROP SURFACE, WHICH IS A HARD BOUNDARY AND NOT A RULE ---------------------------
  // TerminateProcess is PRIVATE, so no PowerShell statement anywhere in this repository can invoke a kill that
  // is not TerminateJobObject - not by accident and not in a future edit. Republishing it is the one edit that
  // undoes that boundary while every other pin stays green, and it reads as a harmless visibility tidy-up.
  // This mutation reddens the presence pin too, because `public ` sits between the two spaces and the name; the
  // label aimed at here is the forbid, which is the pin that carries the weight.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  static extern bool TerminateProcess(IntPtr process, uint exitCode);',
    '  public static extern bool TerminateProcess(IntPtr process, uint exitCode);'))
  detected('the interop kill is republished to PowerShell', 'season-browser:terminate-process-is-public-again')
  reset()
  // The three rights and reads that were deleted with the kill-by-id design, each reintroduced on its own. A
  // right taken and never spent is what a fresh-context review objected to, and these forbids are what stop one
  // being taken again - a P/Invoke or a const costs nothing to add and nothing else in the repository notices.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  public const uint WAIT_OBJECT_0 = 0x00000000;\n',
    '  public const uint WAIT_OBJECT_0 = 0x00000000;\n  [DllImport("kernel32.dll", SetLastError = true)]\n  static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);\n'))
  detected('the creation-time read is declared again', 'season-browser:interop-still-declares-a-creation-time-read')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  public const uint WAIT_OBJECT_0 = 0x00000000;\n',
    '  public const uint WAIT_OBJECT_0 = 0x00000000;\n  public const uint PROCESS_TERMINATE = 0x0001;\n'))
  detected('the interop asks for terminate rights again', 'season-browser:interop-still-asks-for-terminate-rights')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  public const uint WAIT_OBJECT_0 = 0x00000000;\n',
    '  public const uint WAIT_OBJECT_0 = 0x00000000;\n  public const uint SYNCHRONIZE = 0x00100000;\n'))
  detected('the interop asks for wait rights again', 'season-browser:interop-still-asks-for-wait-rights')
  reset()

  // ---- THE WAIT, AND THE CONSTANT THAT MADE AN EARLIER VERSION OF IT LIE -------------------------------
  // WAIT_FAILED retuned to WAIT_TIMEOUT's value. The name is still there, the comparison is still there, and a
  // failed wait is now reported as an ordinary scenario timeout - a real diagnosis replaced by a plausible
  // wrong one, which is the failure mode this whole section exists to prevent.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  public const uint WAIT_FAILED = 0xFFFFFFFF;',
    '  public const uint WAIT_FAILED = 0x00000102;'))
  detected('the failed-wait constant is retuned to a timeout', 'season-browser:wait-failed-is-a-named-constant')
  reset()
  // The literal back at the comparison, which is the defect this file MEASURED: PowerShell reads 0xFFFFFFFF as
  // the signed value -1, so this condition is false for every possible wait result. It looks more direct than
  // the named constant, and it is the reason the forbid exists rather than only the presence pins - the literal
  // can reappear at any new comparison, and an absence has no line number. It reddens the presence pin as well;
  // the forbid is the label aimed at.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if ($waitResult -eq [MapleSeasonProcessInterop]::WAIT_FAILED) {',
    '    if ($waitResult -eq 0xFFFFFFFF) {'))
  detected('a wait result is compared to the signed hex literal again', 'season-browser:launch-compares-a-wait-result-to-a-signed-hex-literal')
  reset()
  // And each branch of the wait made unreachable in turn. `if ($false)` is used rather than deleting the block,
  // so the file still parses and the guard reddens on the defect rather than on garbage.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if ($waitResult -eq [MapleSeasonProcessInterop]::WAIT_FAILED) {',
    '    if ($false) {'))
  detected('a failed wait is no longer separated from a timeout', 'season-browser:launch-separates-a-failed-wait-from-a-timeout')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if ($waitResult -ne [MapleSeasonProcessInterop]::WAIT_OBJECT_0) {',
    '    if ($false) {'))
  detected('anything but a signalled wait stops being a timeout', 'season-browser:launch-treats-anything-but-signalled-as-a-timeout')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if (-not [MapleSeasonProcessInterop]::GetExitCodeProcess($launchedHandle, [ref]$exitCode)) {',
    '    if ($false) {'))
  detected('an unreadable native exit code stops being an error', 'season-browser:launch-reads-a-native-exit-code')
  reset()
  // The scenario's actual verdict. With this branch dead the browser can fail every assertion Playwright has and
  // the function returns success, which is the single most consequential line in the launch path.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if ($exitCode -ne 0) { throw "$Scenario browser scenario failed with exit code $exitCode." }',
    '    if ($false) { throw "$Scenario browser scenario failed with exit code $exitCode." }'))
  detected('a nonzero browser exit code stops failing the scenario', 'season-browser:launch-fails-on-a-nonzero-exit-code')
  reset()
  // The timeout downgraded to a warning. The finally still terminates the job and still releases the port, so
  // nothing leaks and nothing looks wrong - a scenario that never finished simply reports success.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      throw "$Scenario browser scenario exceeded its bounded process limit of $TimeoutMilliseconds milliseconds."',
    '      Write-Warning "$Scenario browser scenario exceeded its bounded process limit of $TimeoutMilliseconds milliseconds."'))
  detected('a bounded-limit timeout is downgraded to a warning', 'season-browser:launch-reports-its-own-timeout')
  reset()

  // ---- Clear-MapleSeasonBrowserPort: REFUSE, KILL THE JOB, THEN CLASSIFY WHAT IS LEFT ------------------
  // NO JOB MEANS NO KILL, and this is the first of three drills whose defect was also planted in the real file
  // and confirmed to redden the real port-preflight regression, not only the static guard. Removing the refusal
  // lets a caller that cannot name the job terminate whatever holds the port - the exact authority this design
  // exists to withhold.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  if ($Job -eq [IntPtr]::Zero) {',
    '  if ($false) {'))
  detected('the cleanup accepts a caller with no job', 'season-browser:cleanup-refuses-a-caller-with-no-job')
  reset()
  // The same refusal defeated by ORDER rather than removed, which is why that pin reads two positions. Every
  // statement stays present and spelled the same way; a refusal that runs after the terminate call is decoration.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  if ($Job -eq [IntPtr]::Zero) {',
    '  [void][MapleSeasonProcessInterop]::TerminateJobObject($Job, 1)\n  if ($Job -eq [IntPtr]::Zero) {'))
  detected('the cleanup terminates before it refuses', 'season-browser:cleanup-refuses-before-it-terminates-anything')
  reset()
  // The kill itself made unreachable - planted in the real file and confirmed to redden the real regression on
  // the case where a governed port stays held. The drain loop then times out and the classification pass reports
  // the scenario's own browser tree as a survivor, which is a true statement about a kill that never happened.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  if (-not [MapleSeasonProcessInterop]::TerminateJobObject($Job, 1)) {',
    '  if ($false) {'))
  detected('the cleanup stops terminating the job', 'season-browser:cleanup-kills-the-job-not-a-process-id')
  reset()
  // THE FOUR OTHER SPELLINGS OF A KILL, each forbidden by shape because a kill can reappear anywhere and an
  // absence has no line number. Every one of these was in this file at some point in the eight rounds before
  // the job object, and each reintroduces the ownership question the job object answers.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  Initialize-MapleSeasonProcessInterop\n  if ($Job -eq [IntPtr]::Zero) {',
    '  Initialize-MapleSeasonProcessInterop\n  Stop-Process -Id $Port -Force -ErrorAction SilentlyContinue\n  if ($Job -eq [IntPtr]::Zero) {'))
  detected('a kill reappears through Stop-Process', 'season-browser:kills-through-stop-process')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  $deadline = [DateTime]::UtcNow.AddSeconds(10)\n  do {\n',
    '  & taskkill.exe /F /T /PID 0 | Out-Null\n  $deadline = [DateTime]::UtcNow.AddSeconds(10)\n  do {\n'))
  detected('a kill reappears through the taskkill tree walk', 'season-browser:kills-through-taskkill')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      $survivorHandles.Add($handle)\n',
    '      $survivorHandles.Add($handle)\n      (Get-Process -Id $listenerId).Kill()\n'))
  detected('a kill reappears through a .NET Process object', 'season-browser:kills-through-a-dotnet-process-object')
  reset()
  // The interop form, inside the classification pass - which is where it would actually creep back, because that
  // pass already holds an open handle to every survivor and killing through it looks like using what is there.
  // The pass authorizes nothing, and that is the property this forbid holds.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      $inJob = $false\n',
    '      $inJob = $false\n      [void][MapleSeasonProcessInterop]::TerminateProcess($handle, 1)\n'))
  detected('a kill reappears through the interop handle form', 'season-browser:kills-a-process-by-handle-from-powershell')
  reset()
  // MEMBERSHIP IS THE CLASSIFIER, and this is the third defect planted in the real file: forcing the branch to
  // `if ($true)` reddened the real regression on exactly the stranger case, where a foreign listener is reported
  // as a survivor of this scenario's own tree. That is the diagnosis that would send someone hunting a leak in
  // this file for a process it never launched.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      if ($inJob) { $members.Add("pid $listenerId") } else { $strangers.Add("pid $listenerId") }',
    '      if ($true) { $members.Add("pid $listenerId") } else { $strangers.Add("pid $listenerId") }'))
  detected('every survivor is classified as a member of our own job', 'season-browser:cleanup-classifies-survivors-by-job-membership')
  reset()
  // The inspection handles released on the SUCCEEDING path only. All three verdicts below that block throw, so a
  // `catch` leaks a handle on every path this function actually takes - and each leaked handle reserves a process
  // id for the life of the session. The file still parses, which is the point of using `catch` rather than
  // deleting the block.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  } finally {\n    foreach ($open in $survivorHandles) {',
    '  } catch {\n    foreach ($open in $survivorHandles) {'))
  detected('the inspection handles are closed only when nothing threw', 'season-browser:cleanup-closes-its-inspection-handles-on-every-path')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      if (-not [MapleSeasonProcessInterop]::CloseHandle($open)) {\n        $closeFailures.Add("Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())")\n      }\n',
    '      [void][MapleSeasonProcessInterop]::CloseHandle($open)\n'))
  detected('a handle the cleanup could not close goes unreported', 'season-browser:cleanup-reports-a-handle-it-could-not-close')
  reset()
  // THE THREE VERDICTS, HELD WORD FOR WORD, because the port-preflight regression asserts these exact sentences
  // at runtime: reword one silently and that suite keeps passing on a message it will never see again. The first
  // two are reworded here; the third is turned into the defect that matters more than its wording.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    throw "$Scenario terminated the job owning its browser tree and $($members -join \', \') survived still holding governed port $Port.$footnote"',
    '    throw "$Scenario could not release governed port $Port."'))
  detected('the surviving-member verdict is reworded out from under its regression', 'season-browser:cleanup-reports-a-surviving-member-of-its-own-tree')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    throw "$Scenario terminated its own browser tree, but $($strangers -join \', \') is not in that job and still holds governed port $Port, so it is not a process this scenario launched and it refused to terminate it.$footnote"',
    '    throw "$Scenario could not release governed port $Port."'))
  detected('the stranger verdict stops saying it refused to touch anything', 'season-browser:cleanup-names-a-stranger-and-refuses-to-touch-it')
  reset()
  // The unreadable case turned into a silent success, which is the worst of the three: the port is still held,
  // the function returns as though it were free, and the caller launches Playwright into an occupied port and
  // waits out a 120-second webServer timeout for a reason nothing recorded.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  throw "$Scenario browser server cleanup did not release governed port $Port, and it could not establish what still holds it ($($unreadable -join \'; \')).$footnote"',
    '  return'))
  detected('a cleanup that cannot tell what holds the port returns as if it were free', 'season-browser:cleanup-admits-when-it-cannot-tell-what-holds-the-port')
  reset()

  // ---- THE LAUNCH PATH ---------------------------------------------------------------------------------
  // A tree this file cannot prove it owns is a tree it cannot clean up, so a job that will not create is a
  // refusal to launch. With the refusal dead the launch proceeds with a zero job handle: every kill made through
  // it reaches nothing, the port is never released, and the diagnosis blames the browser.
  //
  // The needle is `$job` in LOWER case and String.replace is ordinal, so it passes over the cleanup's `$Job`
  // eleven times without matching - which is also why the sabotage harness uses .Replace() and not -replace.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  if ($job -eq [IntPtr]::Zero) {',
    '  if ($false) {'))
  detected('the launch starts a tree it could not prove it owns', 'season-browser:launch-refuses-to-start-a-tree-it-cannot-own')
  reset()
  // THE TRY RESTORED TO WHERE IT USED TO BE - after the launch, which is the arrangement this design reversed.
  // It was correct for a cleanup that depended on later statements succeeding; with a KILL_ON_JOB_CLOSE job it
  // is now the unsafe placement, because a throw from the launch itself reaches no finally and the job handle
  // is closed by process exit rather than by code that could report what happened.
  //
  // MOVES THE `try {` RATHER THAN THE LAUNCH BLOCK, and that is a deliberate rewrite of an earlier version of
  // this drill. The earlier one carried the whole failed-launch block as a literal needle, and when that block
  // grew a stranded-pid clause the needle went stale - silently, because the FIRST replace still applied, so
  // mutate() saw a changed file and never threw. A drill that only half-applies is worse than no drill: it
  // reports a pass. Two one-line anchors cannot rot that way, and the closing brace plus the comment that
  // follows it is a unique anchor no matter how long the block inside grows.
  mutate('scripts/maple-season-browser.ps1', (source) => {
    const openAnchor = '  try {\n    $launchError = 0\n    $launchStage = \'\'\n'
    const closeAnchor = '    }\n    # WAIT ON THE HANDLE, not on a .NET Process object.'
    // BOTH ANCHORS ARE CHECKED BEFORE EITHER IS USED, which is the general repair for the failure described
    // above: mutate() can only see whether the file changed, so in any multi-anchor mutation a stale anchor
    // hides behind a live one. Checking here converts that silence into the loud stale-needle failure the
    // single-anchor drills get for free.
    if (!source.includes(openAnchor) || !source.includes(closeAnchor)) {
      throw new Error('the try-after-launch drill lost an anchor and would have half-applied; needles are stale: ' +
        JSON.stringify({ openAnchorFound: source.includes(openAnchor), closeAnchorFound: source.includes(closeAnchor) }))
    }
    return source
      .replace(openAnchor, '  $launchError = 0\n  $launchStage = \'\'\n')
      .replace(closeAnchor, '    }\n    try {\n    # WAIT ON THE HANDLE, not on a .NET Process object.')
  })
  detected('the try opens after the launch again', 'season-browser:launch-opens-its-try-before-it-starts-anything')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if (-not [MapleSeasonProcessInterop]::StartInJob($job, $node, $commandLine, $Root, [ref]$launchedHandle, [ref]$launchedId, [ref]$launchError, [ref]$launchStage)) {',
    '    if ($false) {'))
  detected('a child that did not start stops failing the launch', 'season-browser:launch-fails-when-its-child-does-not-start')
  reset()
  // THE INTEROP'S REPORT IS WORTHLESS IF THE POWERSHELL DROPS IT, so the clause that carries the stranded pid
  // into the refusal is drilled twice. First the interpolation: the clause is still built, the condition still
  // evaluates, and the sentence a human reads no longer contains the pid - which is the whole point of building
  // it. A run that stranded a suspended process reports "did not start (failed at the assign stage)" and nobody
  // learns there is a process to end.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      throw "$Scenario browser process did not start (failed at the $launchStage stage, Windows error $launchError).$strandedClause"',
    '      throw "$Scenario browser process did not start (failed at the $launchStage stage, Windows error $launchError)."'))
  detected('the refusal stops naming the child it could not terminate', 'season-browser:launch-names-a-child-it-could-not-terminate')
  reset()
  // Then the condition, which is the same hole reached from the other side: the clause is interpolated into the
  // sentence and never populated, so every failed launch reports the same message it did before the pid was
  // available. `$false` rather than deletion, because deleting the `if` would also delete the assignment and the
  // string would interpolate an unbound variable - and with no Set-StrictMode in this file that is an empty
  // string, which is precisely the failure being drilled, from a third direction.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      if ($launchedId -ne 0) {',
    '      if ($false) {'))
  detected('the stranded-pid clause is never populated', 'season-browser:launch-names-a-child-it-could-not-terminate')
  reset()
  // AND THE SAME DEFECT ON THE SUCCESS SIDE OF THE SAME CHANNEL. StartInJob can return TRUE with a non-empty
  // stage - the launch worked and closing the finished thread handle did not - and deleting this block puts the
  // report back into a variable nobody reads, which is the state a fresh-context review found. No throw is
  // involved and no assertion changes, so nothing else in the repository notices.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if ($launchStage -ne \'\') {\n      Write-Warning "$Scenario launched its browser process, but$launchStage"\n    }\n',
    ''))
  detected('a successful launch stops reporting the handle it leaked', 'season-browser:launch-reports-a-leak-on-a-successful-start')
  reset()
  // A SECOND CLEANUP CALL SITE, which is how three review rounds of conditional cleanup returned each time. This
  // one is placed on the timeout path and looks entirely reasonable there - release the port before reporting the
  // timeout - and the count is the only pin that can see it, because each individual site is defensible.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      throw "$Scenario browser scenario exceeded its bounded process limit of $TimeoutMilliseconds milliseconds."',
    '      Clear-MapleSeasonBrowserPort -Port $port -Job $job -Scenario $Scenario\n      throw "$Scenario browser scenario exceeded its bounded process limit of $TimeoutMilliseconds milliseconds."'))
  detected('a second cleanup call site appears on the timeout path', 'season-browser:cleanup-is-called-from-exactly-one-place (found 2 call sites, expected 1 - the unconditional call in the finally)')
  reset()
  // The one call site made CONDITIONAL again - the defect class a fresh-context review broke in both directions
  // before this design removed the ability to have it. The try/catch is kept intact inside the new `if` rather
  // than being commented out, so the file parses and the guard reddens on the condition instead of on a `catch`
  // attached to nothing.
  mutate('scripts/maple-season-browser.ps1', (source) => source
    .replace(
      '    try { Clear-MapleSeasonBrowserPort -Port $port -Job $job -Scenario $Scenario }',
      '    if (-not $primaryFailure) { try { Clear-MapleSeasonBrowserPort -Port $port -Job $job -Scenario $Scenario }')
    .replace(
      '    catch { $footnotes.Add("could not release governed port ${port}: $($_.Exception.Message)") }',
      '    catch { $footnotes.Add("could not release governed port ${port}: $($_.Exception.Message)") } }'))
  detected('the one cleanup call is conditional again', 'season-browser:cleanup-runs-unconditionally-and-cannot-mask-a-verdict')
  reset()
  // THE JOB HANDLE MUST CLOSE LAST, because closing it IS the kill. Two drills, because that order fails in two
  // directions. First the swap: both closes still happen, both are still wrapped separately, and the backstop
  // now runs before the handle whose failure it is meant to backstop.
  mutate('scripts/maple-season-browser.ps1', (source) => {
    const processClose = '    try {\n      if ($launchedHandle -ne [IntPtr]::Zero -and -not [MapleSeasonProcessInterop]::CloseHandle($launchedHandle)) {\n        $footnotes.Add("could not close the handle on browser pid $launchedId (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so that id stays reserved for the life of this session")\n      }\n    } catch {\n      $footnotes.Add("could not close the handle on the browser process it started: $($_.Exception.Message)")\n    }\n'
    return source
      .replace(processClose, '')
      .replace('    if ($footnotes.Count -gt 0) {', processClose + '    if ($footnotes.Count -gt 0) {')
  })
  detected('the job handle closes before the process handle', 'season-browser:launch-closes-the-process-handle-before-the-job-handle')
  reset()
  // And second, the job close made unreachable. The footnote it would write is still present, so the pin over
  // that sentence stays green; what is gone is the close itself, and with it the only kill that is guaranteed to
  // happen when this session dies without running a finally. Same label, opposite direction.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      if (-not [MapleSeasonProcessInterop]::CloseHandle($job)) {',
    '      if ($false) {'))
  detected('the job handle is never closed at all', 'season-browser:launch-closes-the-process-handle-before-the-job-handle')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    ', so that id stays reserved for the life of this session")',
    '")'))
  detected('the leaked-pin footnote stops saying what the leak costs', 'season-browser:launch-reports-a-leaked-pin')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    ', so any surviving member of that tree was not reaped by the kernel either")',
    '")'))
  detected('the job-close footnote stops saying the backstop did not fire', 'season-browser:launch-reports-a-job-it-could-not-close')
  reset()
  // A SUCCESSFUL SCENARIO THAT LEAKED STILL FAILS. It was a warning on both paths once, so a season proof could
  // return success having reported its own leak and only one regression happened to read the warning stream.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '      if ($primaryFailure) { Write-Warning $report -WarningAction Continue } else { throw $report }',
    '      Write-Warning $report -WarningAction Continue'))
  detected('a successful scenario that leaked is downgraded to a warning', 'season-browser:launch-fails-a-successful-scenario-that-leaked')
  reset()

  // ---- THE DELETED MACHINERY MUST STAY DELETED --------------------------------------------------------
  // Six shapes that existed only to compensate for killing by process id, each individually broken by a
  // fresh-context review before it was removed, and each cheap enough to reappear in a single line. They are
  // forbids rather than pins for the reason the kill spellings are: what must be true is an absence.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  $primaryFailure = $false\n',
    '  $primaryFailure = $false\n  $startInfo = New-Object System.Diagnostics.ProcessStartInfo\n'))
  detected('the launch reaches for ProcessStartInfo again', 'season-browser:launch-goes-back-through-a-dotnet-process-object')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  $primaryFailure = $false\n',
    '  $primaryFailure = $false\n  $child = New-Object Process\n'))
  detected('the launch constructs a .NET Process again', 'season-browser:launch-constructs-a-dotnet-process')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    $exitCode = [uint32]0\n',
    '    $exitCode = [uint32]$process.ExitCode\n'))
  detected('the launch reads its exit code off a .NET Process object again', 'season-browser:launch-manages-a-dotnet-process-object')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  $primaryFailure = $false\n',
    '  $primaryFailure = $false\n  $verifiedPortRelease = $false\n'))
  detected('the verified-release flag reappears', 'season-browser:launch-still-remembers-a-verified-release')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  $primaryFailure = $false\n',
    '  $primaryFailure = $false\n  $portReleased = $false\n'))
  detected('the port-released flag reappears', 'season-browser:launch-still-remembers-a-release-flag')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  $primaryFailure = $false\n',
    '  $primaryFailure = $false\n  $launchCreation = 0\n'))
  detected('the creation-time reconciliation reappears', 'season-browser:launch-still-reconciles-a-creation-time')
  reset()
  // THE OWNERSHIP PREDICATE IS DIAGNOSIS ONLY, and its REACH is the pin: exactly two occurrences in executable
  // text, its definition and the one refusal message it shades inside the preflight. MEASURED that it cannot do
  // more than that - on a genuinely foreign, repository-rooted node listener started by hand, the predicate
  // returned True, which is the finding that moved kill authority to job membership. A third occurrence is how a
  // text-derived ownership guess creeps back toward a kill path, and this one is placed in the cleanup, one
  // statement above the drain loop, where it would look like ordinary diagnostic enrichment.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  $deadline = [DateTime]::UtcNow.AddSeconds(10)\n  do {\n',
    '  $ownedGuess = Test-MapleSeasonBrowserPortOwned -ListenerProcess $null -Root $PSScriptRoot\n  $deadline = [DateTime]::UtcNow.AddSeconds(10)\n  do {\n'))
  detected('the ownership predicate reaches into the cleanup path', 'season-browser:ownership-predicate-is-diagnosis-only (found 3 occurrences, expected 2 - its definition and the preflight refusal)')
  reset()

  // ---- AND THE TWO COMMENT VIEWS EVERY PIN ABOVE DEPENDS ON -------------------------------------------
  // A THIRD OF THIS FILE IS C#, and the comment-stripped view knows only `#`. Until this round a `//` line in the
  // interop here-string satisfied a pin exactly as a `#` line used to before the strip existed - the layer-nine
  // defeat arriving through a language boundary. The stricter view drops both spellings, which is only exact
  // while every `//` is on its own line: MEASURED, 18 whole-line and zero trailing. This drill is what keeps it
  // exact, including against a URL, which is the innocent way a `//` arrives mid-line.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    return job;',
    '    return job; // the kill-on-close job, ready to own a tree'))
  detected('a trailing C# comment reopens the comment-satisfaction hole in the interop region', 'season-browser:no-trailing-c-sharp-comments')
  reset()
  // The same hole in the PowerShell region, which is where it was first closed. The anchor used to be the last
  // declaration before the `try` and it has now moved four times - to `$portReleased`, back to `$primaryFailure`,
  // on to `$verifiedPortRelease`, and now to a launch declaration, because the job creation sits between the
  // declarations and the try. Every one of those moves surfaced as a NAMED stale needle rather than as a drill
  // quietly passing against unmodified source, which is the whole reason `mutate` refuses a no-op. The property
  // is a whole-file one, so any statement line serves as the anchor.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '  $launchedId = [uint32]0',
    '  $launchedId = [uint32]0 # a trailing comment the strip cannot see'))
  detected('a trailing comment reopens the comment-satisfaction hole in the browser helper', 'season-browser:no-inline-comments')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('$port = 4288', '$port = 4288 # a trailing comment the strip cannot see'))
  detected('a trailing comment reopens the comment-satisfaction hole in the timeout regression', 'browser-timeout-regression:no-inline-comments')
  reset()
  // A PowerShell BLOCK comment, which is the same hole in a third shape and is caught today only by a
  // coincidence of spelling. MEASURED against the real helper: the body of a <# ... #> block survives the
  // line filter, so a statement quoted inside one would satisfy a pin that no code satisfies. What catches it
  // is that the opener contains a # while not being comment-ONLY, so that line trips the same check - in all
  // three shapes measured, opener alone, indented opener, and a single-line block. A plausible tidy-up of the
  // comment-only test to also accept the opener would silently undo that, so it gets a drill of its own rather
  // than a paragraph. The body here quotes a pinned statement deliberately: that is the attack, not decoration.
  //
  // The block chosen is the job-handle close, and it is chosen for two reasons. A whole try/catch pair goes
  // inside the block rather than one statement, because commenting out the middle of a pair leaves a catch
  // attached to nothing and a file that cannot parse would prove the guard reddens on garbage instead of on
  // this. And every pin over that block stays GREEN through this mutation - the footnote sentence is still
  // present, the two closes are still in order - so the only thing that can notice is the comment check itself,
  // which is exactly the situation this drill exists to test.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    try {\n      if (-not [MapleSeasonProcessInterop]::CloseHandle($job)) {\n        $footnotes.Add("could not close the job object owning its browser process tree (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so any surviving member of that tree was not reaped by the kernel either")\n      }\n    } catch {\n      $footnotes.Add("could not close the job object owning its browser process tree: $($_.Exception.Message)")\n    }\n',
    '    <#\n    try {\n      if (-not [MapleSeasonProcessInterop]::CloseHandle($job)) {\n        $footnotes.Add("could not close the job object owning its browser process tree (Windows error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())), so any surviving member of that tree was not reaped by the kernel either")\n      }\n    } catch {\n      $footnotes.Add("could not close the job object owning its browser process tree: $($_.Exception.Message)")\n    }\n    #>\n'))
  detected('a block comment lets a pinned statement be satisfied by quoted prose', 'season-browser:no-inline-comments')
  reset()
  // F17: a listener query that cannot tell a FREE port from a BROKEN query. Measured, Get-NetTCPConnection
  // on a free port with -ErrorAction Stop throws CmdletizationQuery_NotFound, so the two are distinguishable
  // and swallowing every error conflates them - which would report a governed port as free and let the
  // scenario proceed against a port it does not hold.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($_.FullyQualifiedErrorId -ceq 'CmdletizationQuery_NotFound,Get-NetTCPConnection') { return @() }", 'return @()'))
  detected('listener probe treats a broken listener query as a free port', 'season-browser:listener-probe-fails-closed')
  reset()
  // And the compare has to stay EXACT. `-like 'CmdletizationQuery_NotFound*'` reads any future not-found id
  // from any cmdlet as "the port is free"; the exact id was measured byte-identical on both hosts that can
  // run this file, so the prefix buys nothing and costs the fail-closed direction.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("-ceq 'CmdletizationQuery_NotFound,Get-NetTCPConnection'", "-like 'CmdletizationQuery_NotFound*'"))
  detected('listener probe accepts any not-found id as a free port', 'season-browser:listener-probe-fails-closed')
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
  // The success branch of the launch path, which had no coverage at all until this round and so could be
  // broken by any change to Invoke-MapleSeasonBrowserProof while every gate stayed green. Each of its five
  // parts is drilled separately: a suite that keeps four of them still prints its PASS marker.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace("Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple launch success regression'", "Write-Output 'skipped the helper' #"))
  detected('launch success case stops running the real browser helper', 'timeout-regression:success-case-runs-the-real-helper')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('Assert-True ($null -eq $successFailure)', 'Assert-True ($true)'))
  detected('launch success case tolerates a scenario that threw on a clean exit', 'timeout-regression:success-case-requires-no-failure')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('Assert-True (Test-Path -LiteralPath $successReadyFile)', 'Assert-True ($true)'))
  detected('launch success case stops requiring its child to have run', 'timeout-regression:success-case-requires-the-child-ran')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('Assert-True ($successWarnings.Count -eq 0)', 'Assert-True ($true)'))
  detected('launch success case tolerates a leaked handle pinning its child id', 'timeout-regression:success-case-requires-no-leaked-handle')
  reset()
  // DELETING THE FLAG RATHER THAN THE ASSERTION, which is the realistic version of this defect and the one the
  // assertion pin above cannot see. A developer tidying up what looks like an unused parameter removes
  // -WarningVariable and leaves `Assert-True ($successWarnings.Count -eq 0)` exactly where it was: pinned, green,
  // and reading a variable nothing sets. It passes, because no Set-StrictMode is in force here and an unset
  // variable's .Count is 0. Three of these, one per case, because each flag feeds only its own assertion.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(' -WarningVariable successWarnings', ''))
  detected('the success case stops collecting the warnings its own assertion reads', 'timeout-regression:success-case-collects-the-warnings-it-asserts-on')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace("Assert-True (@(Get-MapleSeasonPortListener -Port $successPort -Scenario 'Maple launch success regression').Count -eq 0)", 'Assert-True ($true)'))
  detected('launch success case stops requiring the governed port to be released', 'timeout-regression:success-case-requires-the-port-released')
  reset()
  // THE LAUNCH FINALLY, TRANCHE C, AND WHY SIXTEEN DRILLS ARE GONE FROM HERE RATHER THAN REPAIRED. They drilled a
  // finally that force-killed by process id, proved the kill landed, reconciled a creation time against a
  // re-resolved id, distinguished a root's death from a tree walk's exit status, and gated a port release on the
  // parent's liveness. All of it was real code and every one of those drills was aimed at a real defect. None of
  // that code exists now: the launch hands back a HANDLE, the one kill is TerminateJobObject, and closing the job
  // handle is itself the kill. The properties those sixteen drills protected are covered above by the ones aimed
  // at the finally this file actually has - the single unconditional call site, the two closes in order, the job
  // close last, the footnote sentences, and the leak that still fails a successful scenario. Keeping the old
  // drills pointed at deleted text would have meant sixteen stale needles, which `mutate` refuses by name.
  // The orphan case, drilled part by part for the reason the success case is: a suite that keeps five of its six
  // assertions still prints its PASS marker, and this is the only executed proof anywhere in this repository that
  // the governed port is released when the process this function launched is already gone.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    "    Invoke-MapleSeasonBrowserProof -Root $root -Config 'playwright.season.config.ts' -Scenario 'Maple orphan drill' -TimeoutMilliseconds 30000 -RunnerFile $orphanRunner -OwnedCommandMarker $tempRoot -WarningVariable orphanWarnings\n",
    "    Write-Output 'skipped the orphan helper'\n"))
  detected('the orphan case stops running the injected helper', 'timeout-regression:orphan-case-runs-the-injected-helper')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('Assert-True (Test-Path -LiteralPath $orphanReadyFile)', 'Assert-True ($true)'))
  detected('the orphan case stops requiring its detached listener to have taken the port', 'timeout-regression:orphan-case-requires-the-detached-listener')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace("Assert-True ($orphanFailure -ceq 'Maple orphan drill launch drill failed on purpose after the parent exited.')", 'Assert-True ($true)'))
  detected('the orphan case accepts any failure instead of the one it injected', 'timeout-regression:orphan-case-requires-its-injected-failure')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace("Assert-True (@(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill').Count -eq 0)", 'Assert-True ($true)'))
  detected('the orphan case stops requiring the orphaned port to be released', 'timeout-regression:orphan-case-requires-the-port-released')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('Assert-True ($orphanWarnings.Count -eq 0)', 'Assert-True ($true)'))
  detected('the orphan case tolerates a salvage that could not finish', 'timeout-regression:orphan-case-requires-a-complete-salvage')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(' -WarningVariable orphanWarnings', ''))
  detected('the orphan case stops collecting the warnings its own assertion reads', 'timeout-regression:orphan-case-collects-the-warnings-it-asserts-on')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('; its needle is stale and the drill would prove nothing', ''))
  detected('the orphan case stops refusing a stale injection needle', 'timeout-regression:orphan-case-refuses-a-stale-needle')
  reset()
  // THE REFUSAL ITSELF, not its wording. The drill above removes words from a thrown message while the test that
  // throws it stays, so the regression still refuses a stale needle and the pin it breaks protects prose. A
  // fresh-context review found that. This one removes the test: the message survives untouched and the drill
  // proceeds to report on source it never changed.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('if ($orphanNeedleCount -ne 1) {', 'if ($false) {'))
  detected('the orphan drill stops refusing a needle it did not match exactly once', 'timeout-regression:orphan-case-refuses-a-needle-that-is-not-unique')
  reset()
  // The count asserted rather than measured, which is the same hole one layer down: the refusal stays, the number
  // it judges is a literal, and a needle occurring twice - which .Replace() would patch BOTH of - reads as one.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    '$orphanNeedleCount = ([regex]::Matches($orphanSource, [regex]::Escape($orphanNeedle))).Count',
    '$orphanNeedleCount = 1'))
  detected('the orphan drill asserts its needle count instead of measuring it', 'timeout-regression:orphan-case-counts-its-needle')
  reset()
  // The injected wait's result discarded, which is how it was written: [void] threw it away, so the injected
  // failure could announce "after the parent exited" having waited out thirty seconds with the parent still
  // running. The premise this entire case rests on was carried by a sentence that could not fail. The wait is on
  // the process HANDLE now, so the discard is spelled with the interop call, and this mutation trips the FORBID
  // as well as the presence pin - the label named here is the presence pin, which is the one being drilled.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    'if ($orphanWait -ne [MapleSeasonProcessInterop]::WAIT_OBJECT_0) { throw "$Scenario launch drill could not confirm its parent exited, so it proves nothing." }',
    '[void][MapleSeasonProcessInterop]::WaitForSingleObject($launchedHandle, [uint32]30000)'))
  detected('the orphan injection discards the wait that establishes its premise', 'timeout-regression:orphan-case-reads-the-parent-wait')
  reset()
  // The suite's own safety net, which is not decoration: this case deliberately creates a process that outlives
  // its parent, so a FAILING run - including one that failed because the repair under test is absent - would
  // leave a node process holding a port on the workstation. MEASURED: on the pre-repair helper it fired.
  //
  // The pair goes, not the kill line alone, for the reason the Dispose deletion drill takes a pair: removing the
  // call from inside its own wrapper leaves a `catch` with nothing to catch and the mutated file stops parsing.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    '    try { $strandedHandle.Kill(); [void]$strandedHandle.WaitForExit(10000) }\n    catch { Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED_KILL_FAILED pid ${strandedId}: $($_.Exception.Message)" }\n',
    ''))
  detected('the orphan case stops cleaning up the process it strands', 'timeout-regression:orphan-case-cleans-up-after-itself')
  reset()
  // AND THE THREE WAYS THAT NET WAS UNSOUND, each restored on its own. It force killed by a process id read in one
  // lookup and killed in another, so the owner could exit between them and Windows could reissue the number to
  // something this suite never created - the exact PID-reuse hazard the helper under test was hardened against,
  // sitting inside the test that guards it. It swallowed the outcome, so it could announce a kill it had not
  // performed. And it never re-read the port, so it deleted the temporary directory that was the only evidence
  // tying a survivor to this suite and exited as though the workstation were clean. A fresh-context review found
  // all three.
  // THE PID REUSE HAZARD ITSELF, and only it. This drill used to replace the whole handle acquisition with
  // `$strandedHandle = $null`, which the very next line turns into `continue` - so it skipped the kill instead of
  // recreating a kill aimed at a number. A fresh-context review found that. What it does now leaves the ownership
  // test, the failure report and the verification exactly where they are and changes ONE thing: the force kill goes
  // to a bare id in a second lookup rather than through the handle whose identity was pinned. That is the window -
  // the owner can exit between the ownership test and the kill, and Windows can reissue the number to a process
  // this suite never created. The .Handle deletion further down attacks the same pin from the other end.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    '    try { $strandedHandle.Kill(); [void]$strandedHandle.WaitForExit(10000) }\n',
    '    try { Stop-Process -Id $strandedId -Force -ErrorAction Stop }\n'))
  detected('the orphan cleanup force kills a bare id in a second lookup', 'timeout-regression:orphan-case-cleans-up-after-itself')
  reset()
  // SWALLOWED, ALL THE WAY. Replacing only the kill pair left the HasExited verification below it, so an
  // access-denied kill still printed _STRANDED_ALIVE and the survivor was never actually hidden - a fresh-context
  // review found the drill weaker than its name. The report and the verification go with the kill, which is the
  // defect the pin names: a kill announced as done, on a process still running, with nothing said about either.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    '    try { $strandedHandle.Kill(); [void]$strandedHandle.WaitForExit(10000) }\n    catch { Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED_KILL_FAILED pid ${strandedId}: $($_.Exception.Message)" }\n    if (-not $strandedHandle.HasExited) { Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED_ALIVE pid $strandedId" }\n',
    '    Stop-Process -Id $strandedId -Force -ErrorAction SilentlyContinue\n'))
  detected('the orphan cleanup goes back to swallowing its kill outcome', 'timeout-regression:orphan-cleanup-swallows-its-kill-outcome')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('if (-not $strandedHandle.HasExited) {', 'if ($false) {'))
  detected('the orphan cleanup stops verifying the kill it announced', 'timeout-regression:orphan-cleanup-verifies-its-kill')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    'Write-Output "MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_STRANDED_PORT_STILL_HELD $orphanPort"',
    "Write-Verbose 'the port looked fine'"))
  detected('the orphan cleanup stops reporting a port it left held', 'timeout-regression:orphan-cleanup-reports-a-still-held-port')
  reset()
  // TRANCHE E1 IS GONE WITH THE FLAG IT DRILLED, and this is the most instructive deletion in the file. Six drills
  // lived here, aimed at a $verifiedPortRelease flag that recorded whether a cleanup had already observed the
  // governed port free, so a later salvage could decide whether it was allowed to kill what it found there. Each
  // of the six was a real defect: the kill unconditional again, the refusal ordered where it could never run, the
  // flag true from the start, the write moved above the cleanup it reported on, the write deleted from the timeout
  // path, and a write added where no cleanup ran.
  //
  // A fresh-context review then broke the flag in BOTH directions at once, and it was right: "a release already
  // happened" cannot distinguish a descendant of this scenario that bound the port a moment later from a stranger
  // that bound it a moment later. No arrangement of that flag answers the ownership question, because the flag is
  // a sentence about a call completing and the question is about a process. Six good drills over an unanswerable
  // predicate are still six drills over an unanswerable predicate. The flag is gone, the salvage path is gone, and
  // ownership now comes from job membership, which is drilled above from the kernel's side.
  //
  // AND THE FACT THE WHOLE CLEANUP CONTRACT STILL DEPENDS ON. "This port was released" is only warranted because
  // Clear-MapleSeasonBrowserPort returns exclusively from inside a loop that saw zero listeners. Let it return on
  // anything else and it is back to reporting that a call completed, which is where this entire chain started.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace(
    '    if ($remaining.Count -eq 0) { return }',
    '    if ($true) { return }'))
  detected('the port cleanup returns without observing the port free', 'season-browser:port-cleanup-returns-only-on-an-observed-free-port')
  reset()
  // THE REGRESSION'S OWN SAFETY NET, which is the only code in this repository that force kills by a process id it
  // did not launch. A fresh-context review found three defects in it and the repair of a fourth was itself wrong.
  //
  // The ownership test was `.Contains($tempRoot)`, a bare substring: a sibling directory whose name merely BEGINS
  // with this suite's - `...-<guid>-foreign\\runner.js` - satisfied it, so an unrelated process could be classified
  // as this suite's own and killed. Restored here exactly.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    'if (-not ([string]$strandedProcess.CommandLine).Contains($ownedPrefix)) { continue }',
    'if (-not ([string]$strandedProcess.CommandLine).Contains($tempRoot)) { continue }'))
  detected('the orphan cleanup authorizes a kill on a bare substring again', 'timeout-regression:orphan-cleanup-matches-a-bare-substring')
  reset()
  // The same hazard reached the other way: the separator dropped from the marker while the comparison keeps using
  // it, which the forbid above cannot see because the forbidden spelling never appears.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    '$ownedPrefix = $tempRoot + [IO.Path]::DirectorySeparatorChar',
    '$ownedPrefix = $tempRoot'))
  detected('the ownership marker stops being a path boundary', 'timeout-regression:orphan-cleanup-builds-a-path-boundary-marker')
  reset()
  // A FAIL-OPEN LISTENER READ RESTORED, on the assertion that proves the orphan repair. Every read in this file was
  // `-ErrorAction SilentlyContinue`, so a listener table that could not be queried answered "nothing is listening" -
  // and this is one of the three reads that are ASSERTIONS, which a fresh-context review did not name and which are
  // worse than the two it did: a broken query reports the case clean while a dev server holds the port.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    "Assert-True (@(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill').Count -eq 0)",
    'Assert-True (@(Get-NetTCPConnection -LocalPort $orphanPort -State Listen -ErrorAction SilentlyContinue).Count -eq 0)'))
  detected('an assertion goes back to reading listeners fail-open', 'timeout-regression:reads-listeners-without-the-fail-closed-probe')
  reset()
  // The timeout case's port assertion, which had no pin at all before this tranche.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    "Assert-True (@(Get-MapleSeasonPortListener -Port $port -Scenario 'Maple timeout regression').Count -eq 0)",
    'Assert-True ($true)'))
  detected('the timeout case stops requiring its governed port to be released', 'timeout-regression:timeout-case-requires-the-port-released')
  reset()
  // The timeout case's zero-warning assertion and the flag that feeds it. This is the path where a cleanup problem
  // is deliberately downgraded to a warning so it cannot overwrite the timeout verdict, which is why a lost
  // warning here is the quietest of the three.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('Assert-True ($timeoutWarnings.Count -eq 0)', 'Assert-True ($true)'))
  detected('the timeout case tolerates a cleanup that footnoted a problem', 'timeout-regression:timeout-case-requires-a-quiet-cleanup')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(' -WarningVariable timeoutWarnings', ''))
  detected('the timeout case stops collecting the warnings its own assertion reads', 'timeout-regression:timeout-case-collects-the-warnings-it-asserts-on')
  reset()
  // The cleanup naming a port the case does not use. It was written this way - the case assigned 4290 inside the
  // try and the cleanup hard-coded 4290 beside it - so changing the case's port alone would have left the cleanup
  // watching a port nothing ran on while every pin stayed green.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    "try { $strandedListeners = @(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill cleanup') }",
    "try { $strandedListeners = @(Get-MapleSeasonPortListener -Port 4290 -Scenario 'Maple orphan drill cleanup') }"))
  detected('the orphan cleanup hard-codes the port it watches', 'timeout-regression:orphan-cleanup-hard-codes-its-port')
  reset()
  // And a SECOND declaration, which is how the two would diverge without either literal looking wrong.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    "  if (@(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill preflight').Count -ne 0) {",
    "  $orphanPort = 4291\n  if (@(Get-MapleSeasonPortListener -Port $orphanPort -Scenario 'Maple orphan drill preflight').Count -ne 0) {"))
  detected('the orphan case reassigns its port behind the cleanup', 'timeout-regression:orphan-port-is-written-once:2')
  reset()
  // THE MARKERS' TEETH. Everything the safety net prints is output only, and the success path prints PASS and
  // `exit 0` inside the try, BEFORE the finally runs - so a run that stranded a live dev server could announce
  // PASS, exit 0, and leave the evidence in the same output for a caller reading only the exit code. A
  // fresh-context review found that. MEASURED on this workstation: a script exiting 0 in its try and 3 in its
  // finally exits 3, so the override is real. Broken four ways: the flag undeclared, the flag unset on a path, the
  // override removed entirely, and the override reduced to a message with no exit.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('$strandedReported = $false\n', ''))
  detected('the report flag is never declared, so the override never fires', 'timeout-regression:orphan-cleanup-declares-its-report-flag')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('    $strandedReported = $true\n', ''))
  detected('a path that finds the workstation unclean stops recording it', 'timeout-regression:orphan-cleanup-sets-its-report-flag-on-every-path:3')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace(
    "  if ($strandedReported) {\n    Write-Output 'MAPLE_SEASON_BROWSER_TIMEOUT_REGRESSION_FAIL the orphan drill safety net had to report a stranded process or a port it could not clear, so this run did not leave the workstation clean.'\n    exit 1\n  }\n",
    ''))
  detected('the safety net stops consulting what it reported', 'timeout-regression:orphan-cleanup-consults-its-report-flag')
  reset()
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('    exit 1\n  }\n}', '  }\n}'))
  detected('the safety net reports a stranded process and still exits zero', 'timeout-regression:orphan-cleanup-overrides-a-passing-exit-code')
  reset()
  // And the handle touch, which is the whole reason the kill below speaks about one process. Get-Process alone pins
  // NOTHING - measured here and already recorded in the helper this suite tests - so removing the touch returns
  // the net to force killing by a bare number that Windows may have reissued.
  mutate('scripts/maple-season-browser-timeout.regression.ps1', (source) => source.replace('      $null = $strandedHandle.Handle\n', ''))
  detected('the orphan cleanup kills by an id it never pinned', 'timeout-regression:orphan-cleanup-pins-the-id-it-kills')
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
  // CONSUMING THE SENTENCE IS NOT HOLDING THE RIGHT SENTENCE. Both callers compare against a literal that
  // carries the drill's own total, so a total that moves without both callers moving with it leaves a caller
  // demanding a sentence this drill can no longer print - which is a red lane, not a silent hole, but it is
  // a red lane discovered by CI rather than here. These two cases were the last labels in this section with
  // no drill behind them: they fail from the direction the mistake actually arrives from, a stale count.
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('(313 controlled defects', '(292 controlled defects'))
  detected('orchestrator holds a stale total in the static claim it demands', 'orchestrator:mutation-drill-static-claim-held')
  reset()
  mutate('.github/workflows/foundation.yml', (source) => source.replace('(313 controlled defects', '(292 controlled defects'))
  detected('CI holds a stale total in the static claim it demands', 'workflow:mutation-drill-static-claim-held')
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
  // THE UNREADABLE-HOLDER CASE, drilled part by part. It is the only executed proof anywhere that the preflight
  // refuses to classify a holder it could not read, so every piece it stands on gets its own mutation: the
  // injection that creates the condition, the two assertions that read the refusal, the two that require it to
  // be a refusal rather than a launch or a kill, and the needle guard that keeps the injection honest.
  //
  // The injection is neutered rather than deleted, because that is the realistic version: a developer who
  // decides the fault injection is too clever replaces the throw with the read it was standing in for, the
  // listener becomes readable and foreign, and the case then asserts the wrong refusal - passing prose,
  // testing nothing about the branch it names.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace(
    "      throw 'the process table could not be read (injected)'",
    '      $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = 0" -ErrorAction SilentlyContinue'))
  detected('the unreadable-holder case stops injecting a failed process read', 'season-browser-regression:unreadable-holder-case-injects-a-failed-process-read')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace('Assert-True ($cimMessage -ceq $cimExpected)', 'Assert-True ($true)'))
  detected('the unreadable-holder case stops comparing the refusal it received', 'season-browser-regression:unreadable-holder-case-requires-the-honest-refusal')
  reset()
  // THE SENTENCE, not just the comparison. Keeping the -ceq and rewriting the expectation to the old foreign
  // refusal is how this case would be "fixed" by someone who reverted the repair and made the test agree.
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace(
    'so it will not guess whether the holder is Farm Rx or not: PID $($listenerProcess.Id) (could not be identified: the process table could not be read (injected))',
    'and no listener there belongs to Farm Rx'))
  detected('the unreadable-holder case expects the old sentence that guessed', 'season-browser-regression:unreadable-holder-case-expects-the-full-sentence')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace(
    "Assert-True (-not (Test-Path -LiteralPath $startedSentinel)) 'Port preflight started the browser runner despite being unable to identify the holder of the governed port.'",
    'Assert-True ($true)'))
  detected('the unreadable-holder case stops requiring that nothing launched', 'season-browser-regression:unreadable-holder-case-requires-a-refusal-not-a-launch')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace(
    "Assert-True (-not $listenerProcess.HasExited) 'Port preflight terminated a listener it could not even identify instead of refusing.'",
    'Assert-True ($true)'))
  detected('the unreadable-holder case tolerates a listener it could not identify being killed', 'season-browser-regression:unreadable-holder-case-requires-the-listener-untouched')
  reset()
  mutate('scripts/maple-season-browser-port-preflight.regression.ps1', (source) => source.replace(
    'Port preflight regression could not find exactly one process-lookup statement to inject a failure into',
    'Port preflight regression found no process-lookup statement, which is fine'))
  detected('the unreadable-holder case stops refusing a stale or duplicated injection needle', 'season-browser-regression:unreadable-holder-case-refuses-a-stale-or-duplicated-needle')
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
  reset()
  // THE OTHER SEVEN PINS OVER THIS FILE, which stood undrilled while the six above were drilled. A pin nobody
  // has broken on purpose is a pin nobody has proved bites - that is the whole argument this file exists to
  // make, and leaving seven of its own pins unexercised applied the argument to every file except itself.
  // Each mutation below was measured against the real file before being written here: it applies, it changes
  // the INTENDED line rather than its own copy inside the needle, and it moves the named pin from holding to
  // broken. Line-anchored for the reason given above; a plain substring would match itself first.
  //
  // Only stderr survives. A PowerShell suite that dies with an exception writes its diagnosis to stderr, so a
  // runner that returns stdout alone hands every scoring criterion an output that cannot contain the sentence
  // it is looking for. `detectedByBehaviour` would then report "went red but never said what was wrong" about
  // a suite that said precisely what was wrong - a real defect that reads as a suite failure.
  mutate(drillFile, (source) => source.replace(/^( *)return \{ status: result\.status, output: `\$\{result\.stdout \?\? ''\}\$\{result\.stderr \?\? ''\}` \}$/m, '$1return { status: result.status, output: `${result.stdout ?? \'\'}` }'))
  detected("the drill's subject runner drops the child's stderr", 'mutation-drill:subject-runner-returns-the-child-result')
  reset()
  // The signal half of the hang refusal, deleted. This is not the redundant half: spawnSync's `timeout` kills
  // the child and reports status null WITH a signal, and often no `error.code` at all, so `result.signal` is
  // the branch that actually fires on a hang. Without it a hung suite falls through to the scoring criteria as
  // status null - not 1, so `detectedByBehaviour` calls it a crash, and `unseenByBehaviour` calls it red - and
  // a five-minute hang gets diagnosed as anything except a hang.
  mutate(drillFile, (source) => source.replace(/^( *)if \(result\.error\?\.code === 'ETIMEDOUT' \|\| result\.signal\) \{$/m, "$1if (result.error?.code === 'ETIMEDOUT') {"))
  detected('the drill stops recognising a hang that was killed by signal', 'mutation-drill:subject-runner-refuses-a-hang')
  reset()
  mutate(drillFile, (source) => source.replace(/^( *)if \(!output\.includes\(expected\)\) \{$/m, '$1if (false) {'))
  detected('the drill accepts a red suite that never named the defect', 'mutation-drill:detection-requires-the-named-sentence')
  reset()
  mutate(drillFile, (source) => source.replace(/^( *)if \(!output\.includes\('MAPLE_SEASON_BROWSER_OWNERSHIP_REGRESSION_PASS'\)\) \{$/m, '$1if (false) {'))
  detected('the drill records a blind spot from a run that stopped short of the end', 'mutation-drill:gap-requires-a-complete-run')
  reset()
  // The expectation itself, emptied at the CALL SITE. The already-drilled `gap-requires-the-expected-manifest`
  // breaks the loop that reads this list; this breaks the list the loop reads. Both leave the loop iterating
  // nothing, and that is the point - two ways to reach one hole, and only one of them was pinned before.
  mutate(drillFile, (source) => source.replace(/^( *unseenByBehaviour\('kill-authorizing predicate refuses everything',.*?)\['windows=false', 'windowsCases=0', 'cases=5'\]\)$/m, '$1[])'))
  detected('the off-Windows gap stops stating the shape of run it is claimed about', 'mutation-drill:gap-manifest-fields-held')
  reset()
  // THE TWO SUMMARY SENTENCES, fabricated rather than counted. `202` is chosen deliberately: it is the count
  // that was true one commit ago, which is the exact shape this pin exists to refuse. The comment on
  // `detectedMutations` says it happened - a hand-written total went stale the moment a drill was added, and
  // the sentence claimed coverage nothing had measured. A literal here would let this file report 202 drills
  // while running three, and both callers that consume the sentence would be satisfied by the claim.
  mutate(drillFile, (source) => source.replace(/^( *)console\.log\(`Foundation mutation drill: PASS \(\$\{detectedMutations\.length\}/m, '$1console.log(`Foundation mutation drill: PASS (202'))
  detected('the static half states a fabricated total instead of counting its drills', 'mutation-drill:static-claim-counted-not-asserted')
  reset()
  mutate(drillFile, (source) => source.replace(/^( *)console\.log\(`Foundation behavioural mutation drill: PASS \(\$\{behaviouralMutations\.length\}/m, '$1console.log(`Foundation behavioural mutation drill: PASS (5'))
  detected('the behavioural half states a fabricated total instead of counting its subjects', 'mutation-drill:behavioural-claim-counted-not-asserted')
  reset()
  // THE TOTAL, FABRICABLE WITHOUT TOUCHING THE SENTENCE. The two drills above prove the number is computed;
  // these three prove the number counts APPLIED MUTATIONS. Drop the refusal and a `detected` with nothing
  // pending scores anyway, so two detections after one `mutate` both count. Drop the clear and one applied
  // mutation is spendable by every detection that follows it. Both leave the summary sentence untouched.
  mutate(drillFile, (source) => source.replace(/^ *if \(pendingMutations === 0\) throw new Error\(`\$\{label\} claims a controlled mutation.*\n/m, ''))
  detected('a detection scores with no mutation applied behind it', 'mutation-drill:detection-spends-an-applied-mutation')
  reset()
  mutate(drillFile, (source) => source.replace(/^( *)pendingMutations = 0\n( *)detectedMutations\.push\(label\)$/m, '$2detectedMutations.push(label)'))
  detected('one applied mutation is spendable by every detection after it', 'mutation-drill:detection-spends-an-applied-mutation')
  reset()
  // And the increment, DUPLICATED above the stale-needle refusal rather than moved: the contiguous pin over
  // `writeFileSync` and its increment stays satisfied, and every mutation whose needle no longer matches is
  // counted before `mutate` refuses it. Presence of the pinned pair says nothing about a second occurrence.
  mutate(drillFile, (source) => source.replace(/^( *)if \(after === before\) throw new Error\(`Mutation no longer applies/m, '$1pendingMutations += 1\n$1if (after === before) throw new Error(`Mutation no longer applies'))
  detected('a mutation that never applied is counted before it is refused', 'mutation-drill:mutate-counts-a-write-exactly-once:2')

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
  // The ownership predicate, in both directions. When these drills were written a false TRUE force-killed a
  // foreign process on the workstation; that is no longer what it costs, because the predicate no longer
  // gates a kill - cleanup terminates this scenario's own job object and reaches nothing outside it. Both
  // directions now cost the same thing, a wrong DIAGNOSIS in a preflight refusal: a false TRUE blames a
  // leftover Farm Rx server for a stranger's port, a false FALSE fails a proof month blaming a stranger for
  // its own. Cheaper than a dead process and still worth every drill here, because a preflight that names
  // the wrong culprit is how this defect stayed mis-attributed for rounds. The labels below still say
  // "kill-authorizing"; that wording, and the predicate's own name, are renamed in their own commit rather
  // than folded into this one, where a label rename would also have to patch the self-drill that quotes it.
  // Both are inserted lines rather
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
  console.log(`Foundation mutation drill: PASS (${detectedMutations.length} controlled defects each turned the gate red under their own name)`)
  console.log(`Foundation behavioural mutation drill: PASS (${behaviouralMutations.length} broken subjects were reported by the suite that runs against them, ${behaviourGaps.length} not measurable on this platform)`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
