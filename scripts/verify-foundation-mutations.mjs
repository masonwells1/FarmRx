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
const mutate = (path, replace) => { const target = join(temporary, path); writeFileSync(target, replace(readFileSync(target, 'utf8'))) }
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
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('if (-not $detected) { throw "Foundation Windows execution lane accounting accepted an outcome of [$($case.Label)]." }', 'if (-not $detected) { Write-Output \'tolerated\' }'))
  detected('Windows execution lane accounting probe stops asserting', 'orchestrator:windows-execution-lane-accounting-probe-asserts')
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
