import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import * as ts from 'typescript'

const read = (root, path) => readFileSync(resolve(root, path), 'utf8')
const requireText = (errors, source, text, label) => { if (!source.includes(text)) errors.push(label) }

function hasDistinctLoginFormIdentities(source) {
  const file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const unwrap = (node) => ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node
  const attribute = (element, name) => {
    const value = element.openingElement.attributes.properties.find((candidate) => ts.isJsxAttribute(candidate) && candidate.name.getText(file) === name)
    if (!value?.initializer) return null
    if (ts.isStringLiteral(value.initializer)) return value.initializer.text
    if (ts.isJsxExpression(value.initializer) && value.initializer.expression) return value.initializer.expression.getText(file)
    return null
  }
  let protectedForms = false
  const visit = (node) => {
    const whenTrue = ts.isConditionalExpression(node) ? unwrap(node.whenTrue) : null
    const whenFalse = ts.isConditionalExpression(node) ? unwrap(node.whenFalse) : null
    if (ts.isConditionalExpression(node)
      && node.condition.getText(file) === 'forgotPassword'
      && ts.isJsxElement(whenTrue)
      && ts.isJsxElement(whenFalse)
      && whenTrue.openingElement.tagName.getText(file) === 'form'
      && whenFalse.openingElement.tagName.getText(file) === 'form'
      && attribute(whenTrue, 'onSubmit') === 'handlePasswordReset'
      && attribute(whenFalse, 'onSubmit') === 'handleSubmit'
      && attribute(whenTrue, 'key') === 'password-reset'
      && attribute(whenFalse, 'key') === 'sign-in') protectedForms = true
    ts.forEachChild(node, visit)
  }
  visit(file)
  return protectedForms
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
  if ((foundationOrchestrator.match(/^\s*Invoke-FoundationLane\s/gm) ?? []).length !== 23) errors.push('orchestrator:all-lanes-checked')
  for (const proof of ['0033', '0034', '0035', '0036', '0037', '0039', '0040', '0041', '0042', '0043']) requireText(errors, foundationOrchestrator, `Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-${proof}-disposable.ps1') }`, `orchestrator:checked-${proof}`)
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-rls-role-matrix.ps1') }", 'orchestrator:checked-rls-role-matrix')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & deno check --no-config --lock=deno.lock --frozen --node-modules-dir=none supabase/functions/send-push/index.ts }", 'orchestrator:frozen-send-push-deno-check')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-push-access-concurrency-mutation.ps1') }", 'orchestrator:checked-push-concurrency-mutation')

  const pushAccessRevocation = read(root, 'supabase/migrations/20260812135210_deny_revoked_push_delivery.sql')
  const pushAccessProof = read(root, 'scripts/verify-push-access-revocation-disposable.ps1')
  const pushConcurrencyMutation = read(root, 'scripts/verify-push-access-concurrency-mutation.ps1')
  const pushDeliveryLogic = read(root, 'supabase/functions/_shared/pushDeliveryLogic.ts')
  const pushDeliveryRegression = read(root, 'supabase/functions/_shared/pushDeliveryLogic.regression.ts')
  const sendPush = read(root, 'supabase/functions/send-push/index.ts')
  if ((pushAccessRevocation.match(/public\.push_recipient_has_current_farm_access\(notification\.farm_id, notification\.user_id\)/g) ?? []).length !== 3) errors.push('push:current-access-at-every-claim-boundary')
  if ((pushAccessRevocation.match(/set search_path = public, pg_temp/g) ?? []).length !== 5) errors.push('push:security-definer-fixed-search-paths')
  requireText(errors, pushAccessRevocation, 'for share;', 'push:access-epoch-linearization-lock')
  requireText(errors, pushAccessRevocation, "and not public.push_recipient_has_current_farm_access(notification.farm_id, notification.user_id);", 'push:revoked-target-terminalization')
  requireText(errors, pushAccessRevocation, "last_error = 'farm access removed'", 'push:revoked-target-reason')
  requireText(errors, pushAccessRevocation, 'revoke all on function public.push_recipient_has_current_farm_access(uuid,uuid)\nfrom public, anon, authenticated, service_role;', 'push:internal-access-helper-not-rpc')
  requireText(errors, pushAccessProof, 'if (select count(*) from first_authorized_rep_claim) <> 1 then', 'push:authorized-rep-positive-control')
  requireText(errors, pushAccessProof, "if (select endpoint from first_authorized_rep_claim) is distinct from 'https://push.example.test/removed-rep-device' then", 'push:authorized-rep-exact-endpoint-control')
  requireText(errors, pushAccessRevocation, 'create function public.revalidate_claimed_push_delivery_target(p_target_id uuid)', 'push:send-time-revalidation-rpc')
  const revalidationStart = pushAccessRevocation.indexOf('create function public.revalidate_claimed_push_delivery_target(p_target_id uuid)')
  const revalidationEnd = pushAccessRevocation.indexOf('create or replace function public.finish_push_delivery_target(', revalidationStart)
  const revalidationBody = revalidationStart >= 0 && revalidationEnd > revalidationStart ? pushAccessRevocation.slice(revalidationStart, revalidationEnd) : ''
  requireText(errors, revalidationBody, "last_error = 'farm access removed'", 'push:send-time-revalidation-terminal-reason')
  requireText(errors, pushAccessRevocation, 'grant execute on function public.revalidate_claimed_push_delivery_target(uuid)\nto service_role;', 'push:send-time-revalidation-service-role-only')
  requireText(errors, pushAccessRevocation, 'from public.push_deliveries\n  where id = p_delivery_id\n  for update;', 'push:parent-delivery-reconciliation-lock')
  if ((pushAccessRevocation.match(/perform public\.reconcile_push_delivery\(/g) ?? []).length !== 2) errors.push('push:all-target-outcomes-use-serialized-reconciliation')
  requireText(errors, pushDeliveryLogic, 'const stillAuthorized = await callBeforeAbort(() => database.revalidateTarget(target.target_id, controller.signal), controller.signal)', 'push:provider-preflight-revalidation')
  requireText(errors, sendPush, "admin.rpc('revalidate_claimed_push_delivery_target', { p_target_id: targetId }).abortSignal(signal)", 'push:edge-revalidation-rpc')
  requireText(errors, pushAccessProof, 'if public.revalidate_claimed_push_delivery_target(claimed_target) then', 'push:revoke-after-claim-disposable-control')
  requireText(errors, pushAccessProof, "create extension dblink;", 'push:two-connection-concurrency-control')
  if ((pushAccessProof.match(/raise exception 'push revalidation barrier timed out';/g) ?? []).length !== 2) errors.push('push:bounded-concurrency-barriers')
  requireText(errors, pushAccessProof, "throw 'EXPECTED_PARENT_RECONCILIATION_MUTATION_DETECTED'", 'push:concurrency-mutation-exact-database-failure')
  requireText(errors, pushConcurrencyMutation, "if ($_.Exception.Message -ne 'EXPECTED_PARENT_RECONCILIATION_MUTATION_DETECTED') { throw }", 'push:concurrency-mutation-rejects-unrelated-failures')
  requireText(errors, pushDeliveryRegression, 'if(revokeRaceProviderCalls!==0||revokeRace.gone!==1||revokeRace.sent!==0)', 'push:revoke-after-claim-provider-deny-control')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-push-access-revocation-disposable.ps1') }", 'orchestrator:checked-push-access-revocation')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-password-form-browser.ps1') }", 'orchestrator:checked-password-form-browser')

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
  if (!hasDistinctLoginFormIdentities(app)) errors.push('auth:login-form-distinct-ast-identity')
  requireText(errors, app, '{resetResponse && <p className="reset-confirmation" role="status">{resetResponse}</p>}\n          {error && <p className="auth-error" role="alert">{error}</p>}', 'auth:reset-storage-error-rendered')
  const main = read(root, 'src/main.tsx')
  requireText(errors, main, 'isPasswordRecoveryHostname(window.location.hostname) && window.location.pathname !== passwordRecoveryRoute', 'auth:recovery-host-route-confinement')
  requireText(errors, main, "'serviceWorker' in navigator && !isPasswordRecoveryHostname(window.location.hostname)", 'service-worker:recovery-origin-registration-denied')
  requireText(errors, main, "navigator.serviceWorker.register('/sw.js', { scope: '/' })", 'service-worker:ordinary-origin-registration')
  const vite = read(root, 'vite.config.ts')
  requireText(errors, vite, 'injectRegister: false', 'service-worker:no-unconditional-injection')
  if (/supabase\.co|api\/v1|rest\/v1/.test(serviceWorker)) errors.push('service-worker:private-api-runtime-cache')

  const defaultPlaywright = read(root, 'playwright.config.ts')
  const passwordPlaywright = read(root, 'playwright.password-form.config.ts')
  const passwordBrowserProof = read(root, 'scripts/verify-password-form-browser.ps1')
  requireText(errors, defaultPlaywright, "'**/password-form-isolation.spec.ts'", 'auth:password-form-proof-excluded-from-optional-suite')
  requireText(errors, passwordPlaywright, "testMatch: 'password-form-isolation.spec.ts'", 'auth:password-form-dedicated-test-match')
  requireText(errors, passwordPlaywright, "{ name: 'password-form-desktop'", 'auth:password-form-desktop-project')
  requireText(errors, passwordPlaywright, "{ name: 'password-form-phone'", 'auth:password-form-phone-project')
  requireText(errors, passwordPlaywright, "['json', { outputFile: reportFile }]", 'auth:password-form-json-report')
  requireText(errors, passwordBrowserProof, "$env:VITE_PASSWORD_EMAIL_DELIVERY_ENABLED = 'true'", 'auth:password-form-feature-enabled-by-proof')
  requireText(errors, passwordBrowserProof, '$reportPath = Join-Path ([IO.Path]::GetTempPath())', 'auth:password-form-fresh-report-path')
  if (!/^\s*& npx playwright test --config=playwright\.password-form\.config\.ts\s*$/m.test(passwordBrowserProof)) errors.push('auth:password-form-real-playwright-command')
  if (!/^\s*& node scripts\/verify-password-form-report\.mjs \$reportPath\s*$/m.test(passwordBrowserProof)) errors.push('auth:password-form-real-report-verifier-command')

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
