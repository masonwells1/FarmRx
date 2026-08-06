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
  // The kill-authorizing predicate's traversal refusal. Without it, root C:\FarmRx claims a listener
  // running at C:\FarmRx\..\Other - outside the repository - and the sole gate on Stop-Process -Force
  // authorizes terminating it.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ($segment.TrimEnd(' ', \"`t\").TrimEnd('.').Length -eq 0) { $escapesTree = $true; break }", 'if ($false) { $escapesTree = $true }'))
  detected('ownership predicate stops refusing a traversing command line', 'season-browser:ownership-refuses-traversal')
  reset()
  // Quote parity. Read as a plain boundary, a double quote outside any quoted argument OPENS a fragment
  // that continues the directory name, and the name it builds is a sibling of our root.
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('$insideQuotes = ($quotesBefore % 2) -eq 1', '$insideQuotes = $true'))
  detected('ownership predicate stops counting quote parity', 'season-browser:ownership-counts-quote-parity')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace('$argumentContinues = (-not $insideQuotes) -or -not (($scan -eq ($normalizedCommandLine.Length - 1)) -or [char]::IsWhiteSpace($normalizedCommandLine[$scan + 1]))', '$argumentContinues = $false'))
  detected('ownership predicate accepts an argument that continues past the quote', 'season-browser:ownership-rejects-continued-argument')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ((-not $insideQuotes) -and [char]::IsWhiteSpace($character)) { $tokenEnd = $scan; break }", 'if ($false) { $tokenEnd = $scan }'))
  detected('ownership predicate stops ending an unquoted token at whitespace', 'season-browser:ownership-ends-unquoted-token-at-whitespace')
  reset()
  mutate('scripts/maple-season-browser.ps1', (source) => source.replace("if ((-not $insideQuotes) -and ($normalizedRoot -match '\\s')) { continue }", 'if ($false) { continue }'))
  detected('ownership predicate accepts a space-bearing root spanning two unquoted arguments', 'season-browser:ownership-rejects-unquoted-space-root')
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
