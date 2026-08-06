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
  // What this count actually counts: statements beginning with `Invoke-FoundationLane`. That is 22 -
  // one intermediate-failure probe, twenty in the orchestration body, and one nested inside
  // Invoke-FoundationWindowsExecutionLane. It does NOT count the Windows lane's own call site, because
  // this pattern requires whitespace immediately after `Invoke-FoundationLane` and
  // `Invoke-FoundationWindowsExecutionLane` continues with a letter. So the rise from 21 to 22 came
  // from the nested call, not from a new top-level lane; the lane itself is pinned separately below.
  // The label says invoke-lane-statements rather than all-lanes-checked for that reason - the old
  // label implied this one number covered every lane in the file, which it does not.
  if ((foundationOrchestrator.match(/^\s*Invoke-FoundationLane\s/gm) ?? []).length !== 22) errors.push('orchestrator:invoke-lane-statements')
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
  // are now caught at RUNTIME by Assert-FoundationWindowsExecutionLaneAccountedFor, pinned below, which
  // is the only non-text check over this lane; the last is caught by pinning the invocation line whole.
  // What text can and cannot do here: these assertions prove the lane is still wired, not that it ran,
  // and on this Linux CI job the lane reports a skip and the ownership predicate goes unexecuted, so
  // execution credit exists only on a Windows run.
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
  // The redirect that must NOT come back. Under Windows PowerShell 5.1, merging a native command's
  // stderr into the success stream while $ErrorActionPreference is 'Stop' raises a terminating
  // NativeCommandError, so a child that exits 0 after one npm notice reddened the whole gate and a
  // failing child relayed nothing. The chain runs `npx tsx`, which makes that reachable.
  if (/-File \$wiring 2>&1/.test(foundationOrchestrator)) errors.push('orchestrator:windows-execution-lane-no-stderr-merge')
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
