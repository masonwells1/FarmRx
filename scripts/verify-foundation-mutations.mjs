import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { foundationStaticGuard } from './foundation-static-guards.mjs'

const root = resolve(process.cwd())
const temporary = mkdtempSync(join(tmpdir(), 'farmrx-foundation-mutations-'))
const expectedMutationCount = 139
let mutationCount = 0
const artifactStaticBegin = '// SOIL_' + 'ARTIFACT_STATIC_GUARD_BEGIN'
const artifactStaticEnd = '// SOIL_' + 'ARTIFACT_STATIC_GUARD_END'
const artifactMutationBegin = '// SOIL_' + 'ARTIFACT_MUTATION_MATRIX_BEGIN'
const artifactMutationEnd = '// SOIL_' + 'ARTIFACT_MUTATION_MATRIX_END'
const files = [
  'docs/password-recovery-support.md',
  'src/App.tsx', 'src/main.tsx', 'src/sw.ts', 'src/auth/AuthProvider.tsx', 'src/auth/passwordRecovery.ts', 'src/components/MarketQuote.tsx', 'src/data/workspaceCache.ts', 'public/market-quote-frame.html', 'vercel.json', 'vite.config.ts',
  'scripts/provision-customer-lib.mjs', 'scripts/verify-foundation.ps1', 'scripts/verify-season.ps1', 'scripts/season-shared-harness-repair.regression.ps1', 'scripts/foundation-native-lane.ps1', 'scripts/foundation-native-lane.regression.ps1', 'scripts/foundation-static-guards.mjs', 'scripts/verify-foundation-mutations.mjs', 'playwright.config.ts',
  'package.json', 'scripts/maple-july-db-clock-wiring.regression.ps1', 'scripts/harvest-ridge-db-clock.psm1', 'scripts/maple-season-db-clock-docker-adapter.psm1', 'scripts/maple-season-db-clock-docker-adapter.regression.ps1', 'scripts/maple-synthetic-docker-topology-plan.ps1', 'scripts/maple-synthetic-docker-topology-plan.regression.ps1', 'scripts/verify-maple-season-db-clock-spike.ps1', 'scripts/faketime-artifact-replacement-manifest.regression.ps1', 'docs/season-readiness/FAKETIME-ARTIFACT-EVIDENCE.md', 'docs/season-readiness/FROZEN-OFFLINE-BUILD-EVIDENCE.md', 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json', 'tests/season/frozen-postgres-clock-spike.Dockerfile',
  'supabase/migrations/20260711154325_module1_rls.sql', 'supabase/migrations/20260716122155_0037_scheduled_alert_foundation.sql', 'supabase/migrations/20260716122229_0041_unscoped_authenticated_write_fencing.sql',
  'src/data/SupabaseNotificationsDataGateway.ts', 'src/data/queuedOperationGuard.ts',
  'src/data/fieldLocation.ts', 'src/data/QueuedEquipmentTasksRepository.ts', 'src/data/QueuedFieldLogRepository.ts',
  'src/data/QueuedFieldsRepository.ts', 'src/data/QueuedGrainRepository.ts', 'src/data/QueuedHarvestRepository.ts',
  'src/data/QueuedInventoryRepository.ts', 'src/data/QueuedNotificationsRepository.ts', 'src/data/QueuedProfitabilityRepository.ts',
  'src/data/QueuedProgramsRepository.ts', 'src/data/QueuedScoutingRepository.ts',
]
const reset = () => { for (const path of files) { const target = join(temporary, path); mkdirSync(dirname(target), { recursive: true }); cpSync(join(root, path), target) } }
const mutate = (path, replace) => { const target = join(temporary, path); writeFileSync(target, replace(readFileSync(target, 'utf8'))) }
const replaceExactlyOne = (source, pattern, replacement, label) => {
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) throw new Error(`${label} expected exactly one mutation target, observed ${matches.length}.`)
  return source.replace(pattern, replacement)
}
const detected = (label, expected) => {
  const failures = foundationStaticGuard(temporary)
  if (!failures.includes(expected)) throw new Error(`${label} mutation was not detected. Observed: ${failures.join(', ')}`)
  mutationCount += 1
  console.log(`Mutation detected: ${label}`)
}

try {
  reset()
  if (foundationStaticGuard(temporary).length) throw new Error('Static guard baseline was not green before mutation drills.')
  mutate('src/App.tsx', (source) => source.replace('path="/grain/*"', 'path="/grain-broken/*"'))
  detected('ordered route manifest change', 'routes:exact-ordered-manifest')
  reset()
  mutate('src/App.tsx', (source) => source.replace('path="/soil-rx"', 'path="/soil-rx-removed"'))
  detected('Soil Rx route removal', 'routes:exact-ordered-manifest')
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
  detected('intermediate foundation exit check removal', 'orchestrator:all-lanes-checked')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-soil-rx-disposable.ps1') } 'Disposable Soil Rx proof failed.'", ''))
  detected('Soil Rx disposable Foundation lane removal', 'orchestrator:checked-soil-rx')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("Invoke-FoundationNativeLane -Lane 'built-browser' -Executable $nativeNpm -Arguments @('run','test:e2e') -Failure 'Built-browser foundation suite failed.' | Out-Null", "Invoke-FoundationLane { & npm run test:e2e } 'Built-browser foundation suite failed.'"))
  detected('built-browser native-lane bypass', 'orchestrator:native-browser-lane')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace('  Assert-FoundationBrowserPortIsFree\n', ''))
  detected('built-browser port preflight removal', 'orchestrator:browser-port-preflight')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => {
    const withoutPreflight = replaceExactlyOne(source, /^  Assert-FoundationBrowserPortIsFree\r?\n/gm, '', 'built-browser port preflight relocation removal')
    return replaceExactlyOne(withoutPreflight, /^(  Invoke-FoundationNativeLane -Lane 'built-browser'[^\r\n]*\r?\n)/gm, '$1  Assert-FoundationBrowserPortIsFree\n', 'built-browser port preflight relocation insertion')
  })
  detected('built-browser port preflight relocation', 'orchestrator:browser-port-preflight-order')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => replaceExactlyOne(source, /FOUNDATION_BROWSER_PORT_4173_OCCUPIED: refusing to reuse an existing server\./g, 'FOUNDATION_BROWSER_PORT_4173_BUSY: refusing to reuse an existing server.', 'built-browser port refusal marker corruption'))
  detected('built-browser port refusal marker corruption', 'orchestrator:browser-port-refusal')
  reset()
  mutate('playwright.config.ts', (source) => source.replace('reuseExistingServer: false,', 'reuseExistingServer: !process.env.CI,'))
  detected('built-browser existing-server reuse restored', 'orchestrator:browser-server-reuse-refused')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("Invoke-FoundationNativeLane -Lane 'built-browser' -Executable $nativeNpm -Arguments @('run','test:e2e') -Failure 'Built-browser foundation suite failed.' | Out-Null", ''))
  detected('built-browser native-lane omission', 'orchestrator:native-browser-lane')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => source.replace("Invoke-FoundationNativeLane -Lane 'built-browser' -Executable $nativeNpm -Arguments @('run','test:e2e') -Failure 'Built-browser foundation suite failed.' | Out-Null", "Invoke-FoundationNativeLane -Lane 'built-browser' -Executable $nativeNpm -Arguments @('run','test:e2e') -Failure 'Built-browser foundation suite failed.' | Out-Null\n  Invoke-FoundationNativeLane -Lane 'built-browser' -Executable $nativeNpm -Arguments @('run','test:e2e') -Failure 'Built-browser foundation suite failed.' | Out-Null"))
  detected('built-browser native-lane duplication', 'orchestrator:native-browser-lane')
  reset()
  mutate('scripts/verify-foundation.ps1', (source) => `${source}\nInvoke-FoundationLane { & npm run test:e2e } 'Legacy built-browser foundation suite failed.'\n`)
  detected('built-browser legacy-capture addition', 'orchestrator:native-browser-legacy-capture')
  reset()
  mutate('scripts/foundation-native-lane.ps1', (source) => source.replace("$ErrorActionPreference = 'Continue'", "$ErrorActionPreference = 'Stop'"))
  detected('native stderr terminating capture', 'orchestrator:native-eap-scope')
  reset()
  mutate('scripts/foundation-native-lane.ps1', (source) => source.replaceAll('$exitCode = [int]$LASTEXITCODE', '$exitCode = 0'))
  detected('native exit capture removal', 'orchestrator:native-exit-capture')
  reset()
  mutate('scripts/foundation-native-lane.ps1', (source) => source.replace(/}\s*finally\s*{\s*\$ErrorActionPreference = \$priorErrorActionPreference/, '} if ($true) {\n    $ErrorActionPreference = $priorErrorActionPreference'))
  detected('native preference finally removal', 'orchestrator:native-eap-restore')
  reset()
  mutate('scripts/foundation-native-lane.ps1', (source) => source.replace('[IO.File]::AppendAllLines($logPath, $durableLines, $utf8)', '$null = $durableLines'))
  detected('native durable log removal', 'orchestrator:native-durable-log')
  reset()
  mutate('scripts/foundation-native-lane.ps1', (source) => source.replace("[Guid]::NewGuid().ToString('N')", "'shared'"))
  detected('native unique log removal', 'orchestrator:native-unique-log')
  reset()
  mutate('scripts/foundation-native-lane.ps1', (source) => source.replace('$logPath = Join-Path $LogRoot ("{0}-{1}-{2}.log" -f [DateTime]::UtcNow.ToString(\'yyyyMMddTHHmmssfffZ\'), $safeLane, [Guid]::NewGuid().ToString(\'N\'))', '$unusedUnique = [Guid]::NewGuid().ToString(\'N\')\n  $logPath = Join-Path $LogRoot ("{0}-{1}.log" -f [DateTime]::UtcNow.ToString(\'yyyyMMddTHHmmssfffZ\'), $safeLane)'))
  detected('native unique log movement', 'orchestrator:native-unique-log')
  reset()
  mutate('scripts/foundation-native-lane.ps1', (source) => source.replace(/(\r?\n)  if \(\$null -eq \$exitCode\) \{/, '$1  if ($false) {'))
  detected('native missing-exit refusal removal', 'orchestrator:native-missing-exit-guard')
  reset()
  mutate('scripts/foundation-native-lane.ps1', (source) => source.replace(/(\r?\n)  if \(\$null -ne \$captureFailure\) \{/, '$1  if ($false) {'))
  detected('native capture-failure refusal removal', 'orchestrator:native-capture-failure-guard')
  reset()
  mutate('scripts/foundation-native-lane.ps1', (source) => source.replace('if ([int]$exitCode -ne 0) {', "if ([int]$exitCode -ne 0 -and -not (Test-Path 'playwright-report/index.html')) {"))
  detected('native report override of nonzero exit', 'orchestrator:native-report-override')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => replaceExactlyOne(source, /\r?\n\$global:LASTEXITCODE = 0\r?\nWrite-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'/g, "\nWrite-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'", 'caller exit restore removal'))
  detected('native regression caller exit restore removal', 'orchestrator:native-regression-caller-exit-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => replaceExactlyOne(source, /\r?\n\$global:LASTEXITCODE = 0\r?\nWrite-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'/g, "\nWrite-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'\n$global:LASTEXITCODE = 0", 'caller exit restore movement'))
  detected('native regression caller exit restore movement', 'orchestrator:native-regression-caller-exit-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => replaceExactlyOne(source, /\r?\n\$global:LASTEXITCODE = 0\r?\nWrite-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'/g, "\nWrite-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'", 'premature restore removal').replace("  Assert-FoundationNative $noOutputRefused 'No-output native finalization did not fail closed with exact exit/log identity.'", "  $global:LASTEXITCODE = 0\n  Assert-FoundationNative $noOutputRefused 'No-output native finalization did not fail closed with exact exit/log identity.'"))
  detected('native regression premature caller exit restore', 'orchestrator:native-regression-caller-exit-order')
  reset()
  const cleanupMutationPattern = /}\s*finally\s*{\r?\n  for \(\$stubIndex = \$installedStubNames\.Count - 1;/g
  const cleanupMutationReplacement = "} finally {\n  $global:LASTEXITCODE = 0\n  for ($stubIndex = $installedStubNames.Count - 1;"
  const regressionSourceForLineEndings = readFileSync(join(root, 'scripts/foundation-native-lane.regression.ps1'), 'utf8')
  const lfCleanupMutation = replaceExactlyOne(regressionSourceForLineEndings.replace(/\r\n/g, '\n'), cleanupMutationPattern, cleanupMutationReplacement, 'LF unconditional cleanup mutation')
  const crlfCleanupMutation = replaceExactlyOne(regressionSourceForLineEndings.replace(/\r?\n/g, '\r\n'), cleanupMutationPattern, cleanupMutationReplacement.replace(/\n/g, '\r\n'), 'CRLF unconditional cleanup mutation')
  if ((lfCleanupMutation.match(/\$global:LASTEXITCODE = 0/g) ?? []).length !== 4 || (crlfCleanupMutation.match(/\$global:LASTEXITCODE = 0/g) ?? []).length !== 4) throw new Error('Line-ending cleanup mutation did not alter exactly one intended target under LF and CRLF.')
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => replaceExactlyOne(source, cleanupMutationPattern, cleanupMutationReplacement, 'unconditional cleanup mutation'))
  detected('native regression unconditional exit masking', 'orchestrator:native-regression-caller-exit-count')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("$ownerOutput = @(Invoke-FoundationRegressionOwnerLane { & $PSCommandPath -SkipOwnerIntegration -StubSuffix 'OwnerNoPrior' } 'Owner integration regression failed.')", "$ownerOutput = @(& $PSCommandPath -SkipOwnerIntegration -StubSuffix 'OwnerNoPrior')"))
  detected('native regression owner integration bypass', 'orchestrator:native-regression-owner-integration')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("$ownerOutput = @(Invoke-FoundationRegressionOwnerLane { & $PSCommandPath -SkipOwnerIntegration -StubSuffix 'OwnerNoPrior' } 'Owner integration regression failed.')", "$ownerOutput = @('FOUNDATION_NATIVE_LANE_REGRESSION_PASS')"))
  detected('native regression owner integration omission', 'orchestrator:native-regression-owner-integration')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('if ($LASTEXITCODE -ne 0) { throw $Failure }', '$global:LASTEXITCODE = 0'))
  detected('native regression owner failure masking', 'orchestrator:native-regression-owner-semantics')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('$priorState = Get-FoundationVisibleFunctionState $stubName', '$priorState = [pscustomobject]@{ Exists = $false }'))
  detected('native regression scope snapshot removal', 'orchestrator:native-regression-scope-snapshot')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('$definition = [scriptblock]::Create("function script:$Name {`n$($ScriptBlock.ToString())`n}")', '$definition = [scriptblock]::Create("function global:$Name {`n$($ScriptBlock.ToString())`n}")'))
  detected('native regression scope broadening', 'orchestrator:native-regression-script-scope')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('Remove-Item -LiteralPath $priorState.Path -Force -ErrorAction Stop', 'Remove-Item -LiteralPath $priorState.Path -Force -ErrorAction SilentlyContinue'))
  detected('native regression swallowed cleanup', 'orchestrator:native-regression-cleanup-fail-closed')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replaceAll('$cleanupFailures.Add($_.Exception)', '$null = $_.Exception'))
  detected('native regression cleanup cause loss', 'orchestrator:native-regression-cleanup-retention')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('if ($priorState.Exists) {\n        if (-not $after.Exists', 'if ($false) {\n        if (-not $after.Exists'))
  detected('native regression prior restoration loss', 'orchestrator:native-regression-scope-restoration')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('} finally {\n  for ($stubIndex = $installedStubNames.Count - 1;', '} catch {\n  for ($stubIndex = $installedStubNames.Count - 1;'))
  detected('native regression custody finally weakening', 'orchestrator:native-regression-caller-exit-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("$global:LASTEXITCODE = 0\nWrite-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'", "Write-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'\n$global:LASTEXITCODE = 0"))
  detected('native regression PASS before cleanup acceptance', 'orchestrator:native-regression-caller-exit-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('$sentinelSuffix = "Owner$([Guid]::NewGuid().ToString(\'N\'))"', '$sentinelSuffix = "OwnerFixed"'))
  detected('native regression fixed sentinel names', 'orchestrator:native-regression-sentinel-randomized')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("[ValidatePattern('^[A-Za-z0-9]+$')][string]$Suffix", '[string]$Suffix'))
  detected('native regression sentinel name validation removal', 'orchestrator:native-regression-sentinel-name-validation')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('$prior = Get-SentinelState $Name\n  if ($prior.Exists) { throw "FOUNDATION_SENTINEL_COLLISION_REFUSED:$Name" }', '$prior = [pscustomobject]@{ Exists=$false }\n  if ($false) { throw "FOUNDATION_SENTINEL_COLLISION_REFUSED:$Name" }'))
  detected('native regression sentinel snapshot removal', 'orchestrator:native-regression-sentinel-snapshot')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('$collisionRefused -and $afterCollision.Definition -ceq $collisionState.Definition -and $afterCollision.Options -eq $collisionState.Options', '$collisionRefused'))
  detected('native regression sentinel collision identity loss', 'orchestrator:native-regression-sentinel-collision')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('$current = Get-SentinelState $sentinel.Name\n        if (-not $current.Exists -or $current.Definition -cne $sentinel.Owned.Definition -or $current.Options -ne $sentinel.Owned.Options)', '$current = Get-SentinelState $sentinel.Name\n        if ($false)'))
  detected('native regression sentinel cleanup ownership loss', 'orchestrator:native-regression-sentinel-cleanup-ownership')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('for ($sentinelIndex=$ownedSentinels.Count-1; $sentinelIndex -ge 0; $sentinelIndex--) {', 'for ($sentinelIndex=$ownedSentinels.Count-1; $sentinelIndex -ge 0; $sentinelIndex--) {\n    break'))
  detected('native regression sentinel cleanup early abort', 'orchestrator:native-regression-sentinel-independent-cleanup')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("if ($sentinelPrimaryFailure -and $sentinelCleanupFailures.Count) { throw [AggregateException]::new('Sentinel probe primary and cleanup failures.',[Exception[]]@($sentinelPrimaryFailure) + [Exception[]]$sentinelCleanupFailures.ToArray()) }", 'if ($sentinelPrimaryFailure -and $sentinelCleanupFailures.Count) { throw $sentinelPrimaryFailure }'))
  detected('native regression sentinel cleanup aggregation loss', 'orchestrator:native-regression-sentinel-cleanup-aggregation')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('if ($sentinel.Prior.Exists) {\n          if (-not $after.Exists -or $after.Definition -cne $sentinel.Prior.Definition -or $after.Options -ne $sentinel.Prior.Options)', 'if ($sentinel.Prior.Exists) {\n          if ($false)'))
  detected('native regression sentinel restoration proof loss', 'orchestrator:native-regression-sentinel-restoration')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("@('success','primary','first','second','both','primary-first','primary-second','primary-both')", "@('success','primary','first','both','primary-first','primary-both')"))
  detected('native regression sentinel matrix omission', 'orchestrator:native-regression-sentinel-matrix')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("$InjectCleanupFailure -ceq 'both' -or ($InjectCleanupFailure -ceq 'first' -and $cleanupOrdinal -eq 1) -or ($InjectCleanupFailure -ceq 'second' -and $cleanupOrdinal -eq 2)", "$InjectCleanupFailure -ceq 'both' -or ($InjectCleanupFailure -ceq 'first' -and $cleanupOrdinal -eq 2) -or ($InjectCleanupFailure -ceq 'second' -and $cleanupOrdinal -eq 1)"))
  detected('native regression cleanup order swap', 'orchestrator:native-regression-cleanup-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("($InjectCleanupFailure -ceq 'first' -and $cleanupOrdinal -eq 1)", '($false)'))
  detected('native regression first cleanup failure swallowed', 'orchestrator:native-regression-cleanup-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("($InjectCleanupFailure -ceq 'second' -and $cleanupOrdinal -eq 2)", '($false)'))
  detected('native regression second cleanup failure swallowed', 'orchestrator:native-regression-cleanup-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('$invokeParameters = @{ SkipOwnerIntegration=$true; StubSuffix=$Suffix }', '$invokeParameters = @{ SkipOwnerIntegration=$true; StubSuffix=$Suffix }\n    $invokeParameters.InjectCleanupFailure = $cleanupMode'))
  detected('native regression sentinel injection redirected to nested cleanup', 'orchestrator:native-regression-sentinel-injection-redirection')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('$sentinelCleanupAttempts.Add($sentinelCleanupOrdinal)', '$null = $sentinelCleanupOrdinal'))
  detected('native regression sentinel attempt counter removal', 'orchestrator:native-regression-sentinel-attempt-count')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('$sentinelCleanupAttempts.Count -ne 2 -or $sentinelCleanupAttempts[0] -ne 1 -or $sentinelCleanupAttempts[1] -ne 2', '$false'))
  detected('native regression sentinel attempt-order assertion removal', 'orchestrator:native-regression-sentinel-attempt-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('try { throw "FOUNDATION_SENTINEL_INJECTED_CLEANUP_$($sentinelCleanupOrdinal)_FAILURE" } catch { $sentinelCleanupFailures.Add($_.Exception) }', 'try { throw "FOUNDATION_SENTINEL_INJECTED_CLEANUP_$($sentinelCleanupOrdinal)_FAILURE" } catch { $null = $_.Exception }'))
  detected('native regression injected sentinel cleanup cause swallowed', 'orchestrator:native-regression-sentinel-cleanup-retention')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('} catch { $sentinelCleanupFailures.Add($_.Exception) }\n    }', '} catch { $null = $_.Exception }\n    }'))
  detected('native regression real sentinel cleanup cause swallowed', 'orchestrator:native-regression-sentinel-cleanup-retention')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("$cleanupMode -ceq 'both' -or ($cleanupMode -ceq 'first' -and $sentinelCleanupOrdinal -eq 1) -or ($cleanupMode -ceq 'second' -and $sentinelCleanupOrdinal -eq 2)", "$cleanupMode -ceq 'both' -or ($cleanupMode -ceq 'first' -and $sentinelCleanupOrdinal -eq 2) -or ($cleanupMode -ceq 'second' -and $sentinelCleanupOrdinal -eq 1)"))
  detected('native regression sentinel cleanup order swap', 'orchestrator:native-regression-sentinel-cleanup-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("($cleanupMode -ceq 'first' -and $sentinelCleanupOrdinal -eq 1)", '($false)'))
  detected('native regression first sentinel cleanup failure swallowed', 'orchestrator:native-regression-sentinel-cleanup-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("($cleanupMode -ceq 'second' -and $sentinelCleanupOrdinal -eq 2)", '($false)'))
  detected('native regression second sentinel cleanup failure swallowed', 'orchestrator:native-regression-sentinel-cleanup-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('FOUNDATION_SENTINEL_INJECTED_CLEANUP_$($sentinelCleanupOrdinal)_FAILURE', 'FOUNDATION_NATIVE_INJECTED_CLEANUP_$($sentinelCleanupOrdinal)_FAILURE'))
  detected('native regression sentinel cleanup cause identity loss', 'orchestrator:native-regression-sentinel-cleanup-cause')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("  Write-Output 'FOUNDATION_SENTINEL_CUSTODY_CASE_PASS'", '').replace('    $output = @(& $RegressionPath @invokeParameters)', "    $output = @(& $RegressionPath @invokeParameters)\n    Write-Output 'FOUNDATION_SENTINEL_CUSTODY_CASE_PASS'"))
  detected('native regression sentinel case PASS before cleanup', 'orchestrator:native-regression-sentinel-pass-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("Assert-SentinelProbe ($null -eq (Get-Command -Name $missingName -CommandType Function -ErrorAction SilentlyContinue) -and $null -eq (Get-Command -Name $captureName -CommandType Function -ErrorAction SilentlyContinue)) 'Sentinel globals remained after the custody case.'\n$global:LASTEXITCODE = 0\nWrite-Output \"FOUNDATION_NATIVE_SENTINEL_PROBE_PASS:$Mode\"", "$global:LASTEXITCODE = 0\nWrite-Output \"FOUNDATION_NATIVE_SENTINEL_PROBE_PASS:$Mode\"\nAssert-SentinelProbe ($null -eq (Get-Command -Name $missingName -CommandType Function -ErrorAction SilentlyContinue) -and $null -eq (Get-Command -Name $captureName -CommandType Function -ErrorAction SilentlyContinue)) 'Sentinel globals remained after the custody case.'"))
  detected('native regression sentinel probe PASS before absence', 'orchestrator:native-regression-sentinel-pass-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace("if ($sentinelCleanupFailures.Count) { throw [AggregateException]::new('Sentinel probe cleanup failed.',[Exception[]]$sentinelCleanupFailures.ToArray()) }", 'if ($false) { throw [AggregateException]::new(\'Sentinel probe cleanup failed.\',[Exception[]]$sentinelCleanupFailures.ToArray()) }'))
  detected('native regression sentinel cleanup-only refusal removal', 'orchestrator:native-regression-sentinel-pass-order')
  reset()
  mutate('scripts/foundation-native-lane.regression.ps1', (source) => source.replace('[Exception[]]@($sentinelPrimaryFailure) + [Exception[]]$sentinelCleanupFailures.ToArray()', '[Exception[]]$sentinelCleanupFailures.ToArray() + [Exception[]]@($sentinelPrimaryFailure)'))
  detected('native regression sentinel primary-cleanup order reversal', 'orchestrator:native-regression-sentinel-cleanup-aggregation')
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

  // SOIL_ARTIFACT_MUTATION_MATRIX_BEGIN
  const replaceArtifactExactlyOnce = (source, from, to, label) => {
    const count = source.split(from).length - 1
    if (count !== 1) throw new Error(`${label} expected exactly one artifact mutation target, observed ${count}.`)
    return source.replace(from, to)
  }
  const runArtifactMutation = (mutation) => {
    reset()
    mutate(mutation.path, (source) => replaceArtifactExactlyOnce(source, mutation.from, mutation.to, mutation.name))
    detected(`artifact ${mutation.name}`, mutation.expected ?? 'artifact:portable-contract')
  }
  const manifestRegressionPath = 'scripts/faketime-artifact-replacement-manifest.regression.ps1'
  const replacementArtifact = {
    token: 'b9ad08aeb66ed961e8426b2cce527365',
    id: 'sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302',
    tag: 'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365:synthetic',
    ref: 'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365@sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302',
  }
  const retiredArtifact = {
    token: '225c197c34164c90b08a4c8b6b10e6c7',
    id: 'sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746',
    tag: 'maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7:synthetic',
  }
  const forcedGitCall = "try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE}"
  const artifactDiscoveryMutations = [
    { name: 'dirty manifest discovery bypassed before fallback', path: manifestRegressionPath, from: 'if(-not$ForceCleanFallback){', to: 'if($false){' },
    { name: 'staged manifest discovery omitted', path: manifestRegressionPath, from: "foreach($stagedPath in (Invoke-Cw2ArtifactGitPathList @('diff','--cached','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_STAGED_DIFF_GIT_FAILED'))", to: 'foreach($stagedPath in @())' },
    { name: 'clean fallback replaced with working diff', path: manifestRegressionPath, from: "@('diff-tree','--no-commit-id','--name-only','-r','-z','HEAD^','HEAD')", to: "@('diff','--name-only','-z')" },
    { name: 'clean fallback empty refusal removed', path: manifestRegressionPath, from: "if($paths.Count-eq0){throw 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY'}", to: "if($false){throw 'SOIL_REMOVED_PREVIOUS_COMMIT_EMPTY_REFUSAL'}" },
    { name: 'git failure capture bypassed', path: manifestRegressionPath, from: "try{$ErrorActionPreference='Continue';$output=@(& $gitExe -C $root @Arguments 2>&1);$exitCode=$LASTEXITCODE}finally{$ErrorActionPreference=$previousErrorActionPreference}", to: "try{$ErrorActionPreference='Continue';$output=@(& $gitExe -C $root @Arguments 2>&1);$exitCode=0}finally{$ErrorActionPreference=$previousErrorActionPreference}" },
    { name: 'forced clean fallback proof omitted', path: manifestRegressionPath, from: '$cleanFallback=Get-Cw2ArtifactCanonicalManifest -ForceCleanFallback', to: '$cleanFallback=$canonical' },
    { name: 'forced clean fallback refusal removed', path: manifestRegressionPath, from: 'FAKETIME_ARTIFACT_MANIFEST_CLEAN_FALLBACK_PROOF_FAILED', to: 'SOIL_REMOVED_CLEAN_FALLBACK_PROOF' },
    { name: 'git failure interpolation malformed', path: manifestRegressionPath, from: 'throw "${FailureMarker}:exit=${exitCode}:detail=${detail}"', to: 'throw "$FailureMarker:exit=$exitCode:detail=$detail"' },
    { name: 'forced git failure invocation omitted', path: manifestRegressionPath, from: forcedGitCall, to: "$forcedGitFailure='FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=1:detail=synthetic';$forcedGitExit=1" },
    { name: 'forced git failure refusal bypassed', path: manifestRegressionPath, from: "if($forcedGitFailure-notmatch'^FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=([1-9][0-9]*):detail=.+$')", to: 'if($false)' },
    { name: 'git error scope restore removed', path: manifestRegressionPath, from: 'finally{$ErrorActionPreference=$previousErrorActionPreference}', to: 'finally{}' },
    { name: 'git error capture broadened beyond helper', path: manifestRegressionPath, from: '$previousErrorActionPreference=$ErrorActionPreference', to: "$previousErrorActionPreference='Continue'" },
    { name: 'forced git call dead with synthetic result', path: manifestRegressionPath, from: forcedGitCall, to: "if($false){$forcedGitCall};$forcedGitFailure='FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=1:detail=synthetic';$forcedGitExit=1" },
    { name: 'forced git synthetic result injected', path: manifestRegressionPath, from: forcedGitCall, to: "$forcedGitCall;$forcedGitFailure='FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=1:detail=synthetic'" },
    { name: 'forced git AST contract bypassed', path: manifestRegressionPath, from: "if(-not$forcedGitAstContract.Valid){throw 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_CONTRACT_FAILED'}", to: "if($false){throw 'SOIL_REMOVED_FORCED_GIT_AST_CONTRACT'}" },
    { name: 'forced git AST child proof omitted', path: manifestRegressionPath, from: 'if(-not$ControlFlowChild){Invoke-Cw2ForcedGitFailureControlFlowProof $selfSource $forcedGitAstContract}', to: 'if($false){Invoke-Cw2ForcedGitFailureControlFlowProof $selfSource $forcedGitAstContract}' },
    { name: 'forced git AST child survival guard removed', path: manifestRegressionPath, from: 'elseif($exitCode-eq0){throw "FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_MUTATION_SURVIVED:$($case.Name)"}', to: 'elseif($false){throw "SOIL_REMOVED_AST_CHILD_SURVIVAL_GUARD"}' },
    { name: 'forced git trace observation bypassed', path: manifestRegressionPath, from: "if($matchingStarts.Count-ne1-or$matchingExits.Count-ne1){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_TRACE_EXACT_INVOCATION_MISSING'}", to: "if($false){throw 'SOIL_REMOVED_EXACT_GIT_TRACE_OBSERVATION'}" },
    { name: 'NUL delimiter parsing weakened', path: manifestRegressionPath, from: '@($joined.Split([char[]]@([char]0),[StringSplitOptions]::RemoveEmptyEntries))', to: '@($joined.Split([char[]]@([char]10),[StringSplitOptions]::RemoveEmptyEntries))' },
    { name: 'dirty path accumulation removed', path: manifestRegressionPath, from: 'if($seen.Add($dirtyNormalized)){[void]$paths.Add($dirtyNormalized)}', to: 'if($seen.Add($dirtyNormalized)){}' },
    { name: 'staged path accumulation removed', path: manifestRegressionPath, from: 'if($seen.Add($stagedNormalized)){[void]$paths.Add($stagedNormalized)}', to: 'if($seen.Add($stagedNormalized)){}' },
    { name: 'untracked path accumulation removed', path: manifestRegressionPath, from: 'if($seen.Add($untrackedNormalized)){[void]$paths.Add($untrackedNormalized)}', to: 'if($seen.Add($untrackedNormalized)){}' },
    { name: 'previous commit path accumulation removed', path: manifestRegressionPath, from: 'if($seen.Add($previousNormalized)){[void]$paths.Add($previousNormalized)}', to: 'if($seen.Add($previousNormalized)){}' },
    { name: 'dirty missing path refusal removed', path: manifestRegressionPath, from: 'if(-not(Test-Path -LiteralPath (Join-Path $root $dirtyPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_DIRTY_PATH_MISSING:$dirtyPath"}', to: 'if($false){throw "SOIL_REMOVED_DIRTY_PATH_REFUSAL"}' },
    { name: 'staged missing path refusal removed', path: manifestRegressionPath, from: 'if(-not(Test-Path -LiteralPath (Join-Path $root $stagedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_STAGED_PATH_MISSING:$stagedPath"}', to: 'if($false){throw "SOIL_REMOVED_STAGED_PATH_REFUSAL"}' },
    { name: 'untracked missing path refusal removed', path: manifestRegressionPath, from: 'if(-not(Test-Path -LiteralPath (Join-Path $root $untrackedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_PATH_MISSING:$untrackedPath"}', to: 'if($false){throw "SOIL_REMOVED_UNTRACKED_PATH_REFUSAL"}' },
    { name: 'previous commit missing path refusal removed', path: manifestRegressionPath, from: 'if(-not(Test-Path -LiteralPath (Join-Path $root $previousPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_PATH_MISSING:$previousPath"}', to: 'if($false){throw "SOIL_REMOVED_PREVIOUS_PATH_REFUSAL"}' },
    { name: 'path dedup comparator weakened', path: manifestRegressionPath, from: '$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)', to: '$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)' },
    { name: 'manifest path sort removed', path: manifestRegressionPath, from: '$paths.Sort([StringComparer]::Ordinal)', to: '$paths.Sort([StringComparer]::OrdinalIgnoreCase)' },
    { name: 'proof child repository-root refusal removed', path: manifestRegressionPath, from: "if($ControlFlowChild){if([string]::IsNullOrWhiteSpace($RepositoryRoot)-or-not[IO.Path]::IsPathRooted($RepositoryRoot)){throw 'FAKETIME_ARTIFACT_MANIFEST_PROOF_CHILD_REPOSITORY_ROOT_REQUIRED'}", to: 'if($ControlFlowChild){if($false){throw \'SOIL_REMOVED_CHILD_ROOT_REFUSAL\'}' },
    { name: 'proof child temp location moved into repository', path: manifestRegressionPath, from: '$tempRoot=Join-Path ([IO.Path]::GetTempPath())("farmrx-cw2-artifact-git-ast-$([guid]::NewGuid().ToString(\'N\'))")', to: '$tempRoot=Join-Path $PSScriptRoot ("farmrx-cw2-artifact-git-ast-$([guid]::NewGuid().ToString(\'N\'))")' },
    { name: 'proof child repository source override removed', path: manifestRegressionPath, from: '-RepositoryRoot $root -InitialErrorActionPreference $case.Preference', to: '-RepositoryRoot $PSScriptRoot -InitialErrorActionPreference $case.Preference' },
    { name: 'proof child file cleanup removed', path: manifestRegressionPath, from: 'if([IO.File]::Exists($path)){[IO.File]::Delete($path)}', to: 'if($false){[IO.File]::Delete($path)}' },
    { name: 'proof child directory cleanup removed', path: manifestRegressionPath, from: 'if([IO.Directory]::Exists($tempRoot)){[IO.Directory]::Delete($tempRoot,$false)}', to: 'if($false){[IO.Directory]::Delete($tempRoot,$false)}' },
  ]
  if (artifactDiscoveryMutations.length !== 34) throw new Error('Soil artifact discovery mutation count drifted.')
  for (const mutation of artifactDiscoveryMutations) runArtifactMutation({ ...mutation, expected: 'artifact:manifest-discovery-contract' })

  const artifactReplacementMutations = [
    { name: 'retired image ID restored in Harvest Ridge owner', path: 'scripts/harvest-ridge-db-clock.psm1', from: `$script:HrArtifactId='${replacementArtifact.id}'`, to: `$script:HrArtifactId='${retiredArtifact.id}'` },
    { name: 'replacement tag drifted in adapter', path: 'scripts/maple-season-db-clock-docker-adapter.psm1', from: `$artifactLocalTag='${replacementArtifact.tag}'`, to: "$artifactLocalTag='maple-faketime-artifacts-wrong:synthetic'" },
    { name: 'forced Git live-span static guard removed', path: 'scripts/foundation-static-guards.mjs', from: 'if (!exactForcedGitLiveSpanContract(source)) return false', to: 'if (false) return false', expected: 'artifact:manifest-forced-git-live-span-owner' },
    { name: 'replacement ref drifted in adapter regression', path: 'scripts/maple-season-db-clock-docker-adapter.regression.ps1', from: `ArtifactImageRef='${replacementArtifact.ref}'; ArtifactImageId=`, to: `ArtifactImageRef='maple-faketime-artifacts-wrong@sha256:${'a'.repeat(64)}'; ArtifactImageId=` },
    { name: 'replacement ref drifted in topology plan', path: 'scripts/maple-synthetic-docker-topology-plan.ps1', from: `      FaketimeArtifacts=[ordered]@{Ref='${replacementArtifact.ref}'`, to: `      FaketimeArtifacts=[ordered]@{Ref='maple-faketime-artifacts-wrong@sha256:${'b'.repeat(64)}'` },
    { name: 'topology regression retained retired ref', path: 'scripts/maple-synthetic-docker-topology-plan.regression.ps1', from: replacementArtifact.ref, to: `${retiredArtifact.tag.replace(':synthetic', '')}@${retiredArtifact.id}` },
    { name: 'spike runner retained retired tag', path: 'scripts/verify-maple-season-db-clock-spike.ps1', from: replacementArtifact.tag, to: retiredArtifact.tag },
    { name: 'spike runner reusable label drifted', path: 'scripts/verify-maple-season-db-clock-spike.ps1', from: "'farmrx.synthetic-owner'='maple-faketime-bootstrap'", to: "'farmrx.synthetic-owner'='wrong-owner'" },
    { name: 'spike runner reusable inspection removed', path: 'scripts/verify-maple-season-db-clock-spike.ps1', from: 'function Assert-ExactReusableArtifact {', to: 'function SOIL_REMOVED_REUSABLE_ARTIFACT_INSPECTION {' },
    { name: 'reusable artifact tag cleanup added', path: 'scripts/maple-season-db-clock-docker-adapter.psm1', from: '$adapter.RemoveDerivedImageIfOwned = {', to: "$adapter.RemoveDerivedImageIfOwned = { & $invokeTrue @('image','rm',$artifactLocalTag) 'unsafe reusable artifact cleanup';" },
    { name: 'reusable artifact ref cleanup added', path: 'scripts/maple-season-db-clock-docker-adapter.psm1', from: '$adapter.RemoveDerivedImageIfOwned = {', to: "$adapter.RemoveDerivedImageIfOwned = { & $invokeTrue @('image','rm',$artifactRef) 'unsafe reusable artifact cleanup';" },
    { name: 'reusable artifact ID cleanup added', path: 'scripts/maple-season-db-clock-docker-adapter.psm1', from: '$adapter.RemoveDerivedImageIfOwned = {', to: "$adapter.RemoveDerivedImageIfOwned = { & $invokeTrue @('image','rm',$artifactId) 'unsafe reusable artifact cleanup';" },
    { name: 'broad image cleanup added', path: 'scripts/maple-season-db-clock-docker-adapter.psm1', from: '$adapter.RemoveDerivedImageIfOwned = {', to: "$adapter.RemoveDerivedImageIfOwned = { & $invokeTrue @('image','prune','-a') 'unsafe broad image cleanup';" },
    { name: 'historical replacement provenance removed', path: 'docs/season-readiness/FAKETIME-ARTIFACT-EVIDENCE.md', from: replacementArtifact.ref, to: 'SOIL_REMOVED_REPLACEMENT_PROVENANCE' },
    { name: 'durable artifact evidence manifest removed', path: 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json', from: 'aed05d2f6937223d8bbd53ea79a3043ce79a4436ce7e29d7569c04c66d77dbf2', to: 'SOIL_REMOVED_EVIDENCE_MANIFEST' },
    { name: 'copied preload source provenance removed', path: 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json', from: 'b6d9b439ccbfdf88f87b9c2f2d89b560d2370964074759373949c2bbb67cd66e', to: 'SOIL_REMOVED_PRELOAD_SOURCE_PROVENANCE' },
    { name: 'derived image proof identity removed', path: 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json', from: 'sha256:ac2901f891cd4a96d70cde28c9dd9f1db6ca518f4d9e5db821518ecb518a0f74', to: 'SOIL_REMOVED_DERIVED_IMAGE_PROOF' },
    { name: 'reusable postcleanup attestation removed', path: 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json', from: '5469560cee6b3f5f863ea84aaab8376a38b3a909d2b2145e03671a32e5578eb5', to: 'SOIL_REMOVED_REUSABLE_POSTCLEANUP' },
    { name: 'manifest discovery recipe weakened', path: 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json', from: 'NUL-delimited dirty tracked, staged, and untracked existing source', to: 'newline dirty changed/untracked source' },
  ]
  if (artifactReplacementMutations.length !== 19) throw new Error('Soil artifact replacement mutation count drifted.')
  for (const mutation of artifactReplacementMutations) runArtifactMutation(mutation)

  const removeArtifactSpan = (source, start, end, label) => {
    const startIndex = source.indexOf(start); const endIndex = source.indexOf(end, startIndex)
    if (startIndex < 0 || endIndex <= startIndex || source.indexOf(start, startIndex + start.length) >= 0 || source.indexOf(end, endIndex + end.length) >= 0) throw new Error(`${label} artifact proof span is ambiguous.`)
    return source.slice(0, startIndex) + source.slice(endIndex + end.length)
  }
  const artifactOmissionMutations = [
    { name: 'artifact mutation matrix only omitted', apply: () => mutate('scripts/verify-foundation-mutations.mjs', (source) => removeArtifactSpan(source, artifactMutationBegin, artifactMutationEnd, 'matrix-only')), expected: 'artifact:soil-mutation-proof' },
    { name: 'artifact static guard only omitted', apply: () => mutate('scripts/foundation-static-guards.mjs', (source) => removeArtifactSpan(source, artifactStaticBegin, artifactStaticEnd, 'guard-only')), expected: 'artifact:soil-static-proof-span' },
    { name: 'artifact guard and matrix omitted', apply: () => { mutate('scripts/verify-foundation-mutations.mjs', (source) => removeArtifactSpan(source, artifactMutationBegin, artifactMutationEnd, 'combined-matrix')); mutate('scripts/foundation-static-guards.mjs', (source) => removeArtifactSpan(source, artifactStaticBegin, artifactStaticEnd, 'combined-guard')) }, expected: 'artifact:soil-static-proof-span' },
  ]
  if (artifactOmissionMutations.length !== 3) throw new Error('Soil artifact omission mutation count drifted.')
  for (const mutation of artifactOmissionMutations) { reset(); mutation.apply(); detected(`artifact ${mutation.name}`, mutation.expected) }
  console.log('SOIL_ARTIFACT_MUTATION_MATRIX_PASS discovery=34 artifact=19 omission=3')
  // SOIL_ARTIFACT_MUTATION_MATRIX_END
  if (mutationCount !== expectedMutationCount) throw new Error(`Foundation mutation count drifted: expected ${expectedMutationCount}, observed ${mutationCount}.`)
  console.log(`Foundation mutation drill: PASS (${mutationCount}/${expectedMutationCount} controlled mutations turned the gate red)`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
