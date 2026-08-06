import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { foundationStaticGuard } from './foundation-static-guards.mjs'

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
  // rules in Split-MapleSeasonCommandLineArgument are only trustworthy while something compares them to
  // CommandLineToArgvW, so deleting that comparison has to fail the guard.
  'scripts/maple-season-browser-port-preflight.regression.ps1',
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
  // predicate gating Stop-Process, so every way of losing that coverage gets its own drill and must be
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
  mutate('.github/workflows/foundation.yml', (source) => source.replace('run: node scripts/verify-foundation-mutations.mjs', 'run: echo skipped'))
  detected('CI stops running the mutation drill itself', 'workflow:mutation-drill-run-independently')
  reset()
  mutate('.github/workflows/foundation.yml', (source) => source.replace('run: node scripts/foundation-windows-lane-runtime-drill.mjs', 'run: echo skipped'))
  detected('CI stops running the lane runtime drill itself', 'workflow:runtime-drill-run-independently')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("Write-Output 'Farm Rx foundation gate: PASS'", "Write-Output 'done'"))
  detected('foundation completion marker renamed', 'orchestrator:completion-marker')
  reset()
  // The kill-authorizing predicate. It now compares whole ARGUMENTS, parsed by Windows' own rules,
  // instead of searching the raw command line for the root text and classifying the boundary by hand.
  // Each drill below removes one rule that a measured false-TRUE depended on.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('foreach ($argument in (Split-MapleSeasonCommandLineArgument -CommandLine $commandLine)) {', 'foreach ($argument in @($commandLine)) {'))
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
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('if ($index -eq $argumentStart) { break }', 'if ($false) { break }'))
  detected('tokenizer loses the guard that stops it stalling on one index', 'season-browser:tokenizer-cannot-stall')
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
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('if (-not (Test-MapleSeasonPathComponentIsRealName -Component $component)) { $escapesTree = $true; break }', 'if ($false) { $escapesTree = $true }'))
  detected('ownership predicate stops walking the components below the root', 'season-browser:ownership-walks-tail-components')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('if (-not (Test-MapleSeasonPathComponentIsRealName -Component $segment)) { return $false }', 'if ($false) { return $false }'))
  detected('ownership predicate stops validating the components of the root itself', 'season-browser:ownership-walks-root-components')
  reset()
  // An argument carrying a character Win32 forbids in a path is not a path. This is what refuses the
  // escaped-quote defeat, whose argument starts with our root at a real separator yet cannot name a file.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("$forbiddenInPath = [char[]]@('\"', '<', '>', '|', '*', '?')", '$forbiddenInPath = [char[]]@()'))
  detected('ownership predicate stops refusing characters Win32 forbids in a path', 'season-browser:ownership-refuses-non-path-characters')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('if ($tail.IndexOfAny($forbiddenInPath) -ge 0) { continue }', 'if ($false) { continue }'))
  detected('ownership predicate stops applying the forbidden-character refusal', 'season-browser:ownership-applies-non-path-characters')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($tail.Length -gt 0 -and $tail[0] -ne '\\') { continue }", 'if ($false) { continue }'))
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
  // The stall drill has four moving parts and every one of them can be quietly disarmed: the timeout that
  // bounds the wait, the drift that provokes the stall, the assertion that names it, and the needle check
  // that refuses to pass on a copy it failed to mutate. Losing any one turns the drill into decoration.
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
  // The cleanup kill itself. Killing by number rather than through the validated object reopens the
  // window in which that number can come to mean a different process, and this is a force kill.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('$ownedProcess.Kill()', 'Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop'))
  detected('cleanup kills by process id instead of the validated object', 'season-browser:cleanup-kills-validated-object')
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
  console.log(`Foundation mutation drill: PASS (${detectedMutations.length} controlled mutations turned the gate red)`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
