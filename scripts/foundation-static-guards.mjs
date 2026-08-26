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

const completeFaketimeArtifactReplacementContract = (sources) => {
  const [harvest, adapter, adapterRegression, topology, topologyRegression, canonicalManifestRegression, spike, evidence, frozenEvidence, evidenceManifest, dockerfile] = sources
  const liveSources = [harvest, adapter, adapterRegression, topology, topologyRegression, spike]
  const cleanupSource = adapter.slice(adapter.indexOf('$adapter.RemoveDerivedImageIfOwned = {'), adapter.indexOf('return $adapter'))
  const cleanupTargets = [...cleanupSource.matchAll(/@\('image','rm',([^\)]+)\)/g)].map((match) => match[1])
  return liveSources.every((source) => !source.includes(retiredArtifact.id) && !source.includes(retiredArtifact.token) && !source.includes(retiredArtifact.tag))
    && harvest.includes(replacementArtifact.ref) && harvest.includes(replacementArtifact.id) && harvest.includes(replacementArtifact.tag) && harvest.includes(replacementArtifact.token)
    && adapter.includes(replacementArtifact.ref) && adapter.includes(replacementArtifact.id) && adapter.includes(replacementArtifact.tag) && adapter.includes(replacementArtifact.token)
    && adapterRegression.includes(replacementArtifact.ref) && adapterRegression.includes(replacementArtifact.id) && adapterRegression.includes(replacementArtifact.tag) && adapterRegression.includes(replacementArtifact.token)
    && topology.split(replacementArtifact.ref).length - 1 === 2 && topology.split(replacementArtifact.id).length - 1 === 4 && topology.includes('Observed=$true;LabelsVerified=$true') && topologyRegression.split(replacementArtifact.ref).length - 1 === 1
    && canonicalManifestRegression.includes('$paths.Sort([StringComparer]::Ordinal)') && canonicalManifestRegression.includes('HashSet[string]') && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_REPLACEMENT_CANONICAL_MANIFEST_PASS') && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_REPLACEMENT_CLEAN_FALLBACK_PASS') && canonicalManifestRegression.includes("@('diff-tree','--no-commit-id','--name-only','-r','-z','HEAD^','HEAD')") && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY') && !canonicalManifestRegression.includes('Sort-Object')
    && spike.includes(replacementArtifact.tag) && spike.includes(replacementArtifact.ref) && spike.includes(replacementArtifact.id) && spike.split('Assert-ExactReusableArtifact').length === 3 && [
      "'farmrx.synthetic-bootstrap'='b9ad08aeb66ed961e8426b2cce527365'", "'farmrx.synthetic-owner'='maple-faketime-bootstrap'", "'farmrx.synthetic-role'='faketime-artifacts'", "'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818'", "'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev'",
    ].every((label) => spike.includes(label))
    && adapter.includes('$artifactByRef=& $inspectImage $artifactRef') && adapter.includes('$artifactByTag=& $inspectImage $artifactLocalTag')
    && cleanupTargets.length === 2 && cleanupTargets.includes('$Inventory.derived_tag') && cleanupTargets.includes('$Inventory.snapshot_tag')
    && !/artifact(?:LocalTag|Ref|Id)|(?:image|system)\s+prune|@\('image','prune'/.test(cleanupSource)
    && evidence.includes(retiredArtifact.id) && evidence.includes(replacementArtifact.ref) && evidence.includes('No continuity')
    && frozenEvidence.includes(retiredArtifact.tag) && frozenEvidence.includes(replacementArtifact.tag) && frozenEvidence.includes('historical')
    && evidenceManifest.includes(replacementArtifact.ref) && evidenceManifest.includes(replacementArtifact.id) && evidenceManifest.includes(replacementArtifact.tag)
    && evidenceManifest.includes('d8b95bfa5a83c56b3236a5579ad33043456e0fb5b09d1f93005efb1ec48e4276') && evidenceManifest.includes('97cbbca788a38b14b11e7780fdeb00b6852a224bf39076174ef626f7411e29de') && evidenceManifest.includes('5ee6803f958a960c0ee11b423e63b81d6bcfb1f5301afe99f8fa86531eaeff48') && evidenceManifest.includes('9ecb1ceb867d28184bd21187901c909e9901a71b7cf86f2c3cadcf332bf1bed8') && evidenceManifest.includes('9f1400fc2b3dcf6a9454551e827bfcc58883e730772771583f2f466c92babc4e') && evidenceManifest.includes('aed05d2f6937223d8bbd53ea79a3043ce79a4436ce7e29d7569c04c66d77dbf2')
    && evidenceManifest.includes('clear-ld-preload.c') && evidenceManifest.includes('b6d9b439ccbfdf88f87b9c2f2d89b560d2370964074759373949c2bbb67cd66e')
    && evidenceManifest.includes('derived_image_proof') && evidenceManifest.includes('0ba1615005224ec79d44fcdb3998021d') && evidenceManifest.includes('sha256:ac2901f891cd4a96d70cde28c9dd9f1db6ca518f4d9e5db821518ecb518a0f74') && evidenceManifest.includes('eb43ca8c6035e8125e9ddbd7498f3bea8674a5a34c164c4e7ac4a1d1c9fc06d1')
    && evidenceManifest.includes('reusable_postcleanup_attestation') && evidenceManifest.includes('5469560cee6b3f5f863ea84aaab8376a38b3a909d2b2145e03671a32e5578eb5') && evidenceManifest.includes('efd709072eb35f838fcf5b81c22da204baadf3f54e016f5dfa64e4735d073163')
    && evidenceManifest.includes('combined_source_artifact_identity_recipe') && evidenceManifest.includes('NUL-delimited dirty tracked, staged, and untracked existing source') && evidenceManifest.includes('refusing missing/deleted paths')
    && dockerfile.includes('ARG FAKETIME_ARTIFACTS_IMAGE') && !dockerfile.includes('ARG FAKETIME_ARTIFACTS_IMAGE=') && !dockerfile.match(/apt-get|curl|wget|https?:\/\//)
}

const exactForcedGitLiveSpanContract = (source) => {
  const normalizedSource = source.replace(/\r\n/g, '\n')
  const forcedSpanStart = '$forcedGitFailure=$null\n$forcedGitExit=$null;$tracePrimary=$null;$traceCleanupErrors=[Collections.Generic.List[Exception]]::new()'
  const forcedSpanEnd = "if($ErrorActionPreference-cne$expectedErrorActionPreference){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_EAP_RESTORE_FAILED'}"
  const forcedSpanStartIndex = normalizedSource.indexOf(forcedSpanStart)
  const forcedSpanEndIndex = normalizedSource.indexOf(forcedSpanEnd, forcedSpanStartIndex)
  const forcedSpan = forcedSpanStartIndex >= 0 && forcedSpanEndIndex > forcedSpanStartIndex
    ? normalizedSource.slice(forcedSpanStartIndex, forcedSpanEndIndex + forcedSpanEnd.length)
    : ''
  const forcedSpanHash = createHash('sha256').update(forcedSpan, 'utf8').digest('hex')
  return forcedSpanStartIndex >= 0 && normalizedSource.indexOf(forcedSpanStart, forcedSpanStartIndex + forcedSpanStart.length) < 0
    && forcedSpanEndIndex > forcedSpanStartIndex && normalizedSource.indexOf(forcedSpanEnd, forcedSpanEndIndex + forcedSpanEnd.length) < 0
    && forcedSpanHash === '14651a7e62810c19660b6376aa9051031cfa90a54d5f11d6206272faeba1d1c1'
}

const canonicalManifestDiscoveryContract = (source) => {
  const dirty = source.indexOf("Invoke-Cw2ArtifactGitPathList @('diff','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_DIRTY_DIFF_GIT_FAILED'")
  const staged = source.indexOf("Invoke-Cw2ArtifactGitPathList @('diff','--cached','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_STAGED_DIFF_GIT_FAILED'")
  const untracked = source.indexOf("Invoke-Cw2ArtifactGitPathList @('ls-files','--others','--exclude-standard','-z') 'FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_GIT_FAILED'")
  const fallback = source.indexOf("Invoke-Cw2ArtifactGitPathList @('diff-tree','--no-commit-id','--name-only','-r','-z','HEAD^','HEAD') 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_GIT_FAILED'")
  const empty = source.indexOf("if($paths.Count-eq0){throw 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY'}")
  const forced = source.indexOf('$cleanFallback=Get-Cw2ArtifactCanonicalManifest -ForceCleanFallback')
  const forcedRefusal = source.indexOf("if($cleanFallback.Source-cne'exact-previous-commit-diff'-or$cleanFallback.Lines.Count-eq0-or-not$cleanFallback.Canonical.EndsWith(\"`n\")){throw 'FAKETIME_ARTIFACT_MANIFEST_CLEAN_FALLBACK_PROOF_FAILED'}")
  const forcedGitFailure = source.indexOf("try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE}")
  const forcedGitRefusal = source.indexOf("if($forcedGitFailure-notmatch'^FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=([1-9][0-9]*):detail=.+$'){throw \"FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_CAPTURE_PROOF_FAILED:$forcedGitFailure\"}")
  const forcedGitEapRefusal = source.indexOf("if($ErrorActionPreference-cne$expectedErrorActionPreference){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_EAP_RESTORE_FAILED'}")
  const forcedGitPass = source.indexOf("Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_FAILURE_CAPTURE_PASS'")
  const pathCustody = [
    '$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal);$paths=[Collections.Generic.List[string]]::new()',
    'if(-not(Test-Path -LiteralPath (Join-Path $root $dirtyPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_DIRTY_PATH_MISSING:$dirtyPath"}', 'if($seen.Add($dirtyNormalized)){[void]$paths.Add($dirtyNormalized)}',
    'if(-not(Test-Path -LiteralPath (Join-Path $root $stagedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_STAGED_PATH_MISSING:$stagedPath"}', 'if($seen.Add($stagedNormalized)){[void]$paths.Add($stagedNormalized)}',
    'if(-not(Test-Path -LiteralPath (Join-Path $root $untrackedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_PATH_MISSING:$untrackedPath"}', 'if($seen.Add($untrackedNormalized)){[void]$paths.Add($untrackedNormalized)}',
    'if(-not(Test-Path -LiteralPath (Join-Path $root $previousPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_PATH_MISSING:$previousPath"}', 'if($seen.Add($previousNormalized)){[void]$paths.Add($previousNormalized)}', '$paths.Sort([StringComparer]::Ordinal)',
  ]
  if (!exactForcedGitLiveSpanContract(source)) return false
  return source.includes('function Invoke-Cw2ArtifactGitPathList([string[]]$Arguments,[string]$FailureMarker)')
    && source.includes('$previousErrorActionPreference=$ErrorActionPreference')
    && source.includes("try{$ErrorActionPreference='Continue';$output=@(& $gitExe -C $root @Arguments 2>&1);$exitCode=$LASTEXITCODE}finally{$ErrorActionPreference=$previousErrorActionPreference}")
    && source.includes('throw "${FailureMarker}:exit=${exitCode}:detail=${detail}"')
    && source.includes("if($ErrorActionPreference-cne$expectedErrorActionPreference){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_SUCCESS_EAP_RESTORE_FAILED'}")
    && source.includes('function Get-Cw2ForcedGitFailureAstContract([string]$Source)') && source.includes('function Invoke-Cw2ForcedGitFailureControlFlowProof([string]$Source,[pscustomobject]$Contract)')
    && source.includes("if(-not$forcedGitAstContract.Valid){throw 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_CONTRACT_FAILED'}")
    && source.includes("$expectedNames=@('baseline-stop','baseline-continue','dead-call-with-synthetic-result','synthetic-result-after-call')") && source.includes('$cases.Count-ne4')
    && source.includes('if(-not$ControlFlowChild){Invoke-Cw2ForcedGitFailureControlFlowProof $selfSource $forcedGitAstContract}')
    && source.includes("if($ControlFlowChild){if([string]::IsNullOrWhiteSpace($RepositoryRoot)-or-not[IO.Path]::IsPathRooted($RepositoryRoot)){throw 'FAKETIME_ARTIFACT_MANIFEST_PROOF_CHILD_REPOSITORY_ROOT_REQUIRED'}")
    && source.includes('$tempRoot=Join-Path ([IO.Path]::GetTempPath())("farmrx-cw2-artifact-git-ast-$([guid]::NewGuid().ToString(\'N\'))")')
    && source.includes('elseif($exitCode-eq0){throw "FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_MUTATION_SURVIVED:$($case.Name)"}')
    && source.includes('$gitExe=[IO.Path]::GetFullPath($gitCommands[0].Source)') && source.includes('$matchingStarts.Count-ne1-or$matchingExits.Count-ne1')
    && source.includes('FAKETIME_ARTIFACT_REPLACEMENT_GIT_TRACE_OBSERVATION_PASS') && source.includes('farmrx-cw2-artifact-git-ast-')
    && source.includes('-RepositoryRoot $root -InitialErrorActionPreference $case.Preference') && source.includes('if([IO.File]::Exists($path)){[IO.File]::Delete($path)}') && source.includes('if([IO.Directory]::Exists($tempRoot)){[IO.Directory]::Delete($tempRoot,$false)}')
    && source.split('@($joined.Split([char[]]@([char]0),[StringSplitOptions]::RemoveEmptyEntries))').length - 1 === 1
    && pathCustody.every((needle) => source.includes(needle)) && source.includes('if(-not$ForceCleanFallback){')
    && dirty >= 0 && staged > dirty && untracked > staged && fallback > untracked && empty > fallback && forced > empty && forcedRefusal > forced && forcedGitFailure > forcedRefusal && forcedGitRefusal > forcedGitFailure && forcedGitEapRefusal > forcedGitRefusal && forcedGitPass > forcedGitEapRefusal
}

export function foundationStaticGuard(root = process.cwd()) {
  const errors = []
  const staticOwnerSource = read(root, 'scripts/foundation-static-guards.mjs')
  const forcedGitOwnerNeedle = 'if (!exactForcedGitLiveSpan' + 'Contract(source)) return false'
  if ((staticOwnerSource.split(forcedGitOwnerNeedle).length - 1) !== 1) errors.push('artifact:manifest-forced-git-live-span-owner')
  const artifactStaticBegin = '// SOIL_' + 'ARTIFACT_STATIC_GUARD_BEGIN'
  const artifactStaticEnd = '// SOIL_' + 'ARTIFACT_STATIC_GUARD_END'
  const artifactMutationBegin = '// SOIL_' + 'ARTIFACT_MUTATION_MATRIX_BEGIN'
  const artifactMutationEnd = '// SOIL_' + 'ARTIFACT_MUTATION_MATRIX_END'
  const app = read(root, 'src/App.tsx')
  const expectedRoutes = ['/fields', '/fields/new', '/fields/:id', '/fields/:id/edit', '/grain/*', '/inventory', '/profitability/*', '/equipment', '/tasks', '/weather', '/field-log', '/scouting', '/harvest', '/programs', '/notifications', '/soil-rx', '/privacy', '*', '/login', '/update-password', '/*']
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
  const queuedSoil = read(root, 'src/data/QueuedSoilRxRepository.ts')
  const attachmentCleanup = queuedSoil.slice(queuedSoil.indexOf('private async cleanAttachmentResources'), queuedSoil.indexOf('private async forgetRolledBackTest'))
  if (attachmentCleanup.indexOf('removeReports') < 0 || attachmentCleanup.indexOf('rollbackTestOperation') < 0 || attachmentCleanup.indexOf('removeReports') > attachmentCleanup.indexOf('rollbackTestOperation')) errors.push('soil-rx:attachment-cleanup-storage-before-row')
  if (attachmentCleanup.indexOf('confirmSoilRxAttachmentRemoval') < 0 || attachmentCleanup.indexOf('confirmSoilRxAttachmentRemoval') > attachmentCleanup.indexOf('rollbackTestOperation')) errors.push('soil-rx:attachment-cleanup-durable-storage-receipt')
  const soilStorage = read(root, 'src/data/soilRxStorage.ts')
  const soilStorageRemove = soilStorage.slice(soilStorage.indexOf('export async function removeSoilRxReports'), soilStorage.indexOf('export async function createSignedSoilRxReportUrl'))
  requireText(errors, soilStorage, 'const { data, error } = await storage.from(soilRxReportBucket).remove(paths)', 'soil-rx:storage-remove-receipt-data')
  requireText(errors, soilStorage, 'return confirmSoilRxReportRemoval(paths, data)', 'soil-rx:storage-remove-receipt-required')
  if ((soilStorageRemove.match(/return confirmSoilRxReportRemoval\(paths, data\)/g) ?? []).length !== 1 || /\bcatch\b|\.list\(/.test(soilStorageRemove)) errors.push('soil-rx:storage-remove-ambiguous-recovery-refused')
  const supabaseSoil = read(root, 'src/data/SupabaseSoilRxRepository.ts')
  requireText(errors, supabaseSoil, 'deleted.length !== 1', 'soil-rx:row-delete-exact-receipt')

  const foundationOrchestrator = read(root, 'scripts/verify-foundation.ps1')
  const foundationOrchestratorLf = foundationOrchestrator.replace(/\r\n/g, '\n')
  const playwrightConfig = read(root, 'playwright.config.ts')
  const foundationNativeLane = read(root, 'scripts/foundation-native-lane.ps1')
  const foundationNativeRegression = read(root, 'scripts/foundation-native-lane.regression.ps1')
  const foundationNativeRegressionLf = foundationNativeRegression.replace(/\r\n/g, '\n')
  const soilDisposableCapture = read(root, 'scripts/verify-soil-rx-disposable-capture.ps1')
  const soilDisposableCaptureRegression = read(root, 'scripts/verify-soil-rx-disposable-capture.regression.ps1')
  requireText(errors, foundationOrchestrator, 'if ($LASTEXITCODE -ne 0) { throw $Failure }', 'orchestrator:native-exit-check')
  requireText(errors, foundationOrchestrator, 'Assert-IntermediateLaneFailureIsFatal', 'orchestrator:controlled-failure-probe')
  requireText(errors, foundationOrchestrator, 'Assert-FoundationBrowserPortIsFree', 'orchestrator:browser-port-preflight')
  if ((foundationOrchestrator.match(/^\s*Assert-FoundationBrowserPortIsFree\s*$/gm) ?? []).length !== 1) errors.push('orchestrator:browser-port-preflight')
  const foundationEntry = "Push-Location $root\ntry {\n  Assert-FoundationBrowserPortIsFree\n  Assert-IntermediateLaneFailureIsFatal\n"
  if ((foundationOrchestratorLf.split(foundationEntry).length - 1) !== 1) errors.push('orchestrator:browser-port-preflight-order')
  requireText(errors, foundationOrchestrator, "throw 'FOUNDATION_BROWSER_PORT_4173_OCCUPIED: refusing to reuse an existing server.'", 'orchestrator:browser-port-refusal')
  requireText(errors, playwrightConfig, 'reuseExistingServer: false,', 'orchestrator:browser-server-reuse-refused')
  requireText(errors, foundationOrchestrator, "return (Join-Path $PSHOME 'powershell.exe')", 'orchestrator:desktop-probe-shell')
  requireText(errors, foundationOrchestrator, "return (Join-Path $PSHOME 'pwsh.exe')", 'orchestrator:windows-core-probe-shell')
  requireText(errors, foundationOrchestrator, "return (Join-Path $PSHOME 'pwsh')", 'orchestrator:unix-core-probe-shell')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & $probeShell -NoProfile -Command 'exit 23' } $expected", 'orchestrator:resolved-probe-shell')
  if ((foundationOrchestrator.match(/^\s*Invoke-FoundationLane\s/gm) ?? []).length !== 25) errors.push('orchestrator:all-lanes-checked')
  requireText(errors, foundationOrchestrator, ". (Join-Path $PSScriptRoot 'foundation-native-lane.ps1')", 'orchestrator:native-lane-import')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'foundation-native-lane.regression.ps1') } 'Foundation native-lane regression failed.'", 'orchestrator:native-lane-regression')
  const nativeBrowserInvocation = "Invoke-FoundationNativeLane -Lane 'built-browser' -Executable $nativeNpm -Arguments @('run','test:e2e') -Failure 'Built-browser foundation suite failed.' | Out-Null"
  if ((foundationOrchestrator.split(nativeBrowserInvocation).length - 1) !== 1) errors.push('orchestrator:native-browser-lane')
  if ((foundationOrchestrator.match(/test:e2e/g) ?? []).length !== 1) errors.push('orchestrator:native-browser-exactly-once')
  if (foundationOrchestrator.includes('Invoke-FoundationLane { & npm run test:e2e }')) errors.push('orchestrator:native-browser-legacy-capture')
  for (const proof of ['0033', '0034', '0035', '0036', '0037', '0039', '0040', '0041', '0042', '0043']) requireText(errors, foundationOrchestrator, `Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-${proof}-disposable.ps1') }`, `orchestrator:checked-${proof}`)
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-soil-rx-disposable.ps1') }", 'orchestrator:checked-soil-rx')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-soil-rx-disposable-capture.regression.ps1') }", 'orchestrator:checked-soil-rx-capture-regression')
  if ((soilDisposableCapture.match(/Invoke-FoundationNativeLane -Lane 'soil-rx-disposable'/g) ?? []).length !== 1 || !soilDisposableCapture.includes('-LogRoot $runDirectory | Out-Null')) errors.push('soil-rx:capture-native-lane')
  requireText(errors, soilDisposableCapture, "$passMarkers = @($logLines | Where-Object { $_ -ceq 'SOIL_RX_DISPOSABLE_RLS_STORAGE_PASS' })", 'soil-rx:capture-pass-marker')
  requireText(errors, soilDisposableCapture, 'Assert-SoilRxCapture ($passMarkers.Count -eq 1)', 'soil-rx:capture-pass-marker-exactly-once')
  requireText(errors, soilDisposableCapture, "$exitMarkers = @($logLines | Where-Object { $_ -ceq 'exitCode=0' })", 'soil-rx:capture-zero-exit')
  requireText(errors, soilDisposableCapture, 'Assert-SoilRxCapture ($exitMarkers.Count -eq 1)', 'soil-rx:capture-zero-exit-exactly-once')
  requireText(errors, soilDisposableCapture, "$causeMarkers = @($logLines | Where-Object { $_ -ceq 'cause=success' })", 'soil-rx:capture-success-cause')
  requireText(errors, soilDisposableCapture, 'Assert-SoilRxCapture ($causeMarkers.Count -eq 1)', 'soil-rx:capture-success-cause-exactly-once')
  requireText(errors, soilDisposableCapture, '[IO.File]::WriteAllLines($receiptPath, @(', 'soil-rx:capture-durable-receipt')
  requireText(errors, soilDisposableCaptureRegression, 'SOIL_RX_DISPOSABLE_CAPTURE_REGRESSION_PASS', 'soil-rx:capture-regression-marker')
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
  requireText(errors, foundationNativeLane, "$ErrorActionPreference = 'Continue'", 'orchestrator:native-eap-scope')
  requireText(errors, foundationNativeLane, '$output = @(& $Executable @Arguments 2>&1)', 'orchestrator:native-output-capture')
  if ((foundationNativeLane.match(/\$exitCode = \[int\]\$LASTEXITCODE/g) ?? []).length !== 2) errors.push('orchestrator:native-exit-capture')
  if (!/}\s*finally\s*{\s*\$ErrorActionPreference = \$priorErrorActionPreference/.test(foundationNativeLane)) errors.push('orchestrator:native-eap-restore')
  requireText(errors, foundationNativeLane, '[IO.File]::AppendAllLines($logPath, $durableLines, $utf8)', 'orchestrator:native-durable-log')
  requireText(errors, foundationNativeLane, '([string]$line) | Out-Host', 'orchestrator:native-host-replay')
  requireText(errors, foundationNativeLane, 'if ([int]$exitCode -ne 0) {', 'orchestrator:native-nonzero-guard')
  requireText(errors, foundationNativeLane, 'return $true', 'orchestrator:native-scalar-success')
  const uniqueLogAssignment = '$logPath = Join-Path $LogRoot ("{0}-{1}-{2}.log" -f [DateTime]::UtcNow.ToString(\'yyyyMMddTHHmmssfffZ\'), $safeLane, [Guid]::NewGuid().ToString(\'N\'))'
  if ((foundationNativeLane.split(uniqueLogAssignment).length - 1) !== 1) errors.push('orchestrator:native-unique-log')
  if (!/(?:^|\r?\n)  if \(\$null -ne \$captureFailure\) \{\r?\n    throw \[AggregateException\]::new\(\r?\n      "\$Failure Native capture failed; durable log: \$logPath",\r?\n      \[Exception\[\]\]@\(\$captureFailure\)\)\r?\n  \}/.test(foundationNativeLane)) errors.push('orchestrator:native-capture-failure-guard')
  if (!/(?:^|\r?\n)  if \(\$null -eq \$exitCode\) \{\r?\n    throw "\$Failure Native process ended without an exit code; durable log: \$logPath"\r?\n  \}/.test(foundationNativeLane)) errors.push('orchestrator:native-missing-exit-guard')
  if (foundationNativeLane.includes('playwright-report') || foundationNativeLane.includes('report.stats')) errors.push('orchestrator:native-report-override')
  const ownerLaneDefinition = "function Invoke-FoundationRegressionOwnerLane([scriptblock]$Command,[string]$Failure) {\n  $global:LASTEXITCODE = 0\n  & $Command\n  if ($LASTEXITCODE -ne 0) { throw $Failure }\n}"
  if ((foundationNativeRegressionLf.split(ownerLaneDefinition).length - 1) !== 1) errors.push('orchestrator:native-regression-owner-semantics')
  const ownerIntegrationInvocation = "$ownerOutput = @(Invoke-FoundationRegressionOwnerLane { & $PSCommandPath -SkipOwnerIntegration -StubSuffix 'OwnerNoPrior' } 'Owner integration regression failed.')"
  if ((foundationNativeRegressionLf.split(ownerIntegrationInvocation).length - 1) !== 1) errors.push('orchestrator:native-regression-owner-integration')
  requireText(errors, foundationNativeRegressionLf, "Invoke-FoundationRegressionOwnerLane { & $probeShell -NoProfile -Command 'exit 41' } 'Controlled owner child failure.'", 'orchestrator:native-regression-owner-failure')
  requireText(errors, foundationNativeRegressionLf, "Assert-FoundationNative $ownerFailureRefused 'Owner integration masked a genuine child failure.'", 'orchestrator:native-regression-owner-failure')
  const lastEvidenceAssertion = foundationNativeRegressionLf.indexOf("Assert-FoundationNative ($captureFailureLog.Contains('exitCode=<missing>')")
  const ownerIntegration = foundationNativeRegressionLf.indexOf(ownerIntegrationInvocation)
  const ownerPassAssertion = foundationNativeRegressionLf.indexOf("Assert-FoundationNative ($ownerOutput.Count -eq 1 -and $ownerOutput[0] -ceq 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS')", ownerIntegration)
  const ownerExitAssertion = foundationNativeRegressionLf.indexOf("Assert-FoundationNative ($LASTEXITCODE -eq 0) 'Owner integration regression poisoned caller-visible LASTEXITCODE.'", ownerPassAssertion)
  const custodyFinally = foundationNativeRegressionLf.indexOf('} finally {\n  for ($stubIndex = $installedStubNames.Count - 1;', ownerExitAssertion)
  const cleanupFailureRefusal = foundationNativeRegressionLf.indexOf("if ($cleanupFailures.Count) { throw [AggregateException]::new('Foundation native regression cleanup failed.'", custodyFinally)
  const primaryFailureRefusal = foundationNativeRegressionLf.indexOf('if ($primaryFailure) { throw $primaryFailure }', cleanupFailureRefusal)
  const callerExitRestore = foundationNativeRegressionLf.indexOf('$global:LASTEXITCODE = 0', primaryFailureRefusal)
  const finalRegressionPass = foundationNativeRegressionLf.indexOf("Write-Output 'FOUNDATION_NATIVE_LANE_REGRESSION_PASS'", callerExitRestore)
  if (!(lastEvidenceAssertion >= 0 && ownerIntegration > lastEvidenceAssertion && ownerPassAssertion > ownerIntegration && ownerExitAssertion > ownerPassAssertion && custodyFinally > ownerExitAssertion && cleanupFailureRefusal > custodyFinally && primaryFailureRefusal > cleanupFailureRefusal && callerExitRestore > primaryFailureRefusal && finalRegressionPass > callerExitRestore)) errors.push('orchestrator:native-regression-caller-exit-order')
  if ((foundationNativeRegressionLf.match(/\$global:LASTEXITCODE = 0/g) ?? []).length !== 3) errors.push('orchestrator:native-regression-caller-exit-count')
  requireText(errors, foundationNativeRegressionLf, '$priorState = Get-FoundationVisibleFunctionState $stubName\n    $stubStates[$stubName] = $priorState\n    $ownedStubStates[$stubName] = Set-FoundationScriptFunction $stubName $stubDefinitions[$stubName]', 'orchestrator:native-regression-scope-snapshot')
  requireText(errors, foundationNativeRegressionLf, '$definition = [scriptblock]::Create("function script:$Name {`n$($ScriptBlock.ToString())`n}")', 'orchestrator:native-regression-script-scope')
  const scriptInstaller = foundationNativeRegressionLf.slice(foundationNativeRegressionLf.indexOf('function Set-FoundationScriptFunction'), foundationNativeRegressionLf.indexOf('function Assert-FoundationNativeSource'))
  if (scriptInstaller.includes('function global:')) errors.push('orchestrator:native-regression-scope-broadening')
  requireText(errors, foundationNativeRegressionLf, '$current = Get-FoundationVisibleFunctionState $stubName\n      if (-not $current.Exists -or $current.Definition -cne $ownedStubStates[$stubName].Definition', 'orchestrator:native-regression-cleanup-ownership')
  requireText(errors, foundationNativeRegressionLf, 'Remove-Item -LiteralPath $priorState.Path -Force -ErrorAction Stop\n      $after = Get-FoundationVisibleFunctionState $stubName', 'orchestrator:native-regression-cleanup-fail-closed')
  requireText(errors, foundationNativeRegressionLf, 'if ($priorState.Exists) {\n        if (-not $after.Exists -or $after.Definition -cne $priorState.Definition -or $after.Options -ne $priorState.Options)', 'orchestrator:native-regression-scope-restoration')
  if ((foundationNativeRegressionLf.match(/\$cleanupFailures\.Add\(\$_\.Exception\)/g) ?? []).length !== 3) errors.push('orchestrator:native-regression-cleanup-retention')
  if (/Remove-Item[^\r\n]*-ErrorAction SilentlyContinue/.test(foundationNativeRegressionLf)) errors.push('orchestrator:native-regression-cleanup-swallowed')
  const sentinelSuffixAssignment = '$sentinelSuffix = "Owner$([Guid]::NewGuid().ToString(\'N\'))"'
  if ((foundationNativeRegressionLf.split(sentinelSuffixAssignment).length - 1) !== 1 || foundationNativeRegressionLf.includes('StubOwnerSentinel') || foundationNativeRegressionLf.includes('StubOwnerRestoreCleanup')) errors.push('orchestrator:native-regression-sentinel-randomized')
  requireText(errors, foundationNativeRegressionLf, "[ValidatePattern('^[A-Za-z0-9]+$')][string]$Suffix", 'orchestrator:native-regression-sentinel-name-validation')
  requireText(errors, foundationNativeRegressionLf, '$prior = Get-SentinelState $Name\n  if ($prior.Exists) { throw "FOUNDATION_SENTINEL_COLLISION_REFUSED:$Name" }', 'orchestrator:native-regression-sentinel-snapshot')
  requireText(errors, foundationNativeRegressionLf, '$collisionRefused -and $afterCollision.Definition -ceq $collisionState.Definition -and $afterCollision.Options -eq $collisionState.Options', 'orchestrator:native-regression-sentinel-collision')
  requireText(errors, foundationNativeRegressionLf, '$current = Get-SentinelState $sentinel.Name\n        if (-not $current.Exists -or $current.Definition -cne $sentinel.Owned.Definition -or $current.Options -ne $sentinel.Owned.Options)', 'orchestrator:native-regression-sentinel-cleanup-ownership')
  requireText(errors, foundationNativeRegressionLf, 'for ($sentinelIndex=$ownedSentinels.Count-1; $sentinelIndex -ge 0; $sentinelIndex--)', 'orchestrator:native-regression-sentinel-independent-cleanup')
  const sentinelCleanupStart = foundationNativeRegressionLf.indexOf('for ($sentinelIndex=$ownedSentinels.Count-1;')
  const sentinelCleanupEnd = foundationNativeRegressionLf.indexOf("if ($sentinelPrimaryFailure -and $sentinelCleanupFailures.Count) { throw [AggregateException]::new('Sentinel probe primary and cleanup failures.'", sentinelCleanupStart)
  const sentinelCleanup = foundationNativeRegressionLf.slice(sentinelCleanupStart, sentinelCleanupEnd)
  if (sentinelCleanupStart < 0 || sentinelCleanupEnd < 0 || /\b(?:break|return)\b/.test(sentinelCleanup)) errors.push('orchestrator:native-regression-sentinel-independent-cleanup')
  if ((foundationNativeRegressionLf.match(/\$sentinelCleanupFailures\.Add\(\$_\.Exception\)/g) ?? []).length !== 2) errors.push('orchestrator:native-regression-sentinel-cleanup-retention')
  requireText(errors, foundationNativeRegressionLf, '$sentinelCleanupAttempts.Add($sentinelCleanupOrdinal)', 'orchestrator:native-regression-sentinel-attempt-count')
  requireText(errors, foundationNativeRegressionLf, '$sentinelCleanupAttempts.Count -ne 2 -or $sentinelCleanupAttempts[0] -ne 1 -or $sentinelCleanupAttempts[1] -ne 2', 'orchestrator:native-regression-sentinel-attempt-order')
  requireText(errors, foundationNativeRegressionLf, "if ($sentinelPrimaryFailure -and $sentinelCleanupFailures.Count) { throw [AggregateException]::new('Sentinel probe primary and cleanup failures.',[Exception[]]@($sentinelPrimaryFailure) + [Exception[]]$sentinelCleanupFailures.ToArray()) }", 'orchestrator:native-regression-sentinel-cleanup-aggregation')
  requireText(errors, foundationNativeRegressionLf, 'if ($sentinel.Prior.Exists) {\n          if (-not $after.Exists -or $after.Definition -cne $sentinel.Prior.Definition -or $after.Options -ne $sentinel.Prior.Options)', 'orchestrator:native-regression-sentinel-restoration')
  const sentinelModes = "@('success','primary','first','second','both','primary-first','primary-second','primary-both')"
  if ((foundationNativeRegressionLf.split(sentinelModes).length - 1) !== 1) errors.push('orchestrator:native-regression-sentinel-matrix')
  requireText(errors, foundationNativeRegressionLf, "$cleanupMode -ceq 'both' -or ($cleanupMode -ceq 'first' -and $sentinelCleanupOrdinal -eq 1) -or ($cleanupMode -ceq 'second' -and $sentinelCleanupOrdinal -eq 2)", 'orchestrator:native-regression-sentinel-cleanup-order')
  requireText(errors, foundationNativeRegressionLf, 'FOUNDATION_SENTINEL_INJECTED_CLEANUP_$($sentinelCleanupOrdinal)_FAILURE', 'orchestrator:native-regression-sentinel-cleanup-cause')
  if (foundationNativeRegressionLf.includes('$invokeParameters.InjectCleanupFailure')) errors.push('orchestrator:native-regression-sentinel-injection-redirection')
  const sentinelAggregate = foundationNativeRegressionLf.indexOf("if ($sentinelPrimaryFailure -and $sentinelCleanupFailures.Count) { throw [AggregateException]::new('Sentinel probe primary and cleanup failures.'", sentinelCleanupEnd)
  const sentinelCleanupOnly = foundationNativeRegressionLf.indexOf("if ($sentinelCleanupFailures.Count) { throw [AggregateException]::new('Sentinel probe cleanup failed.'", sentinelAggregate)
  const sentinelPrimaryOnly = foundationNativeRegressionLf.indexOf('if ($sentinelPrimaryFailure) { throw $sentinelPrimaryFailure }', sentinelCleanupOnly)
  const sentinelCasePass = foundationNativeRegressionLf.indexOf("Write-Output 'FOUNDATION_SENTINEL_CUSTODY_CASE_PASS'", sentinelPrimaryOnly)
  const sentinelAbsence = foundationNativeRegressionLf.indexOf("Assert-SentinelProbe ($null -eq (Get-Command -Name $missingName", sentinelCasePass)
  const sentinelExitRestore = foundationNativeRegressionLf.indexOf('$global:LASTEXITCODE = 0', sentinelAbsence)
  const sentinelProbePass = foundationNativeRegressionLf.indexOf('Write-Output "FOUNDATION_NATIVE_SENTINEL_PROBE_PASS:$Mode"', sentinelExitRestore)
  if (!(sentinelAggregate === sentinelCleanupEnd && sentinelCleanupOnly > sentinelAggregate && sentinelPrimaryOnly > sentinelCleanupOnly && sentinelCasePass > sentinelPrimaryOnly && sentinelAbsence > sentinelCasePass && sentinelExitRestore > sentinelAbsence && sentinelProbePass > sentinelExitRestore)) errors.push('orchestrator:native-regression-sentinel-pass-order')
  requireText(errors, foundationNativeRegressionLf, "$InjectCleanupFailure -ceq 'both' -or ($InjectCleanupFailure -ceq 'first' -and $cleanupOrdinal -eq 1) -or ($InjectCleanupFailure -ceq 'second' -and $cleanupOrdinal -eq 2)", 'orchestrator:native-regression-cleanup-order')
  requireText(errors, foundationNativeRegressionLf, 'FOUNDATION_NATIVE_INJECTED_CLEANUP_$($cleanupOrdinal)_FAILURE', 'orchestrator:native-regression-cleanup-cause')

  // SOIL_ARTIFACT_STATIC_GUARD_BEGIN
  const packageSource = read(root, 'package.json')
  const artifactPackageLane = 'tsx src/data/programsChunk5.regression.ts && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/maple-season-db-clock-docker-adapter.regression.ps1 && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/maple-synthetic-docker-topology-plan.regression.ps1 && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/faketime-artifact-replacement-manifest.regression.ps1 && tsx src/data/programDueItems.regression.ts'
  if ((packageSource.split(artifactPackageLane).length - 1) !== 1) errors.push('artifact:package-regression-wiring')
  const artifactSources = [
    read(root, 'scripts/harvest-ridge-db-clock.psm1'),
    read(root, 'scripts/maple-season-db-clock-docker-adapter.psm1'),
    read(root, 'scripts/maple-season-db-clock-docker-adapter.regression.ps1'),
    read(root, 'scripts/maple-synthetic-docker-topology-plan.ps1'),
    read(root, 'scripts/maple-synthetic-docker-topology-plan.regression.ps1'),
    read(root, 'scripts/faketime-artifact-replacement-manifest.regression.ps1'),
    read(root, 'scripts/verify-maple-season-db-clock-spike.ps1'),
    read(root, 'docs/season-readiness/FAKETIME-ARTIFACT-EVIDENCE.md'),
    read(root, 'docs/season-readiness/FROZEN-OFFLINE-BUILD-EVIDENCE.md'),
    read(root, 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json'),
    read(root, 'tests/season/frozen-postgres-clock-spike.Dockerfile'),
  ]
  if (!completeFaketimeArtifactReplacementContract(artifactSources)) errors.push('artifact:portable-contract')
  if (!canonicalManifestDiscoveryContract(artifactSources[5])) errors.push('artifact:manifest-discovery-contract')
  const julyWiring = read(root, 'scripts/maple-july-db-clock-wiring.regression.ps1')
  const julyIdentity = "Assert-True ($replacementArtifactNeedles.Count -eq 8 -and @($replacementArtifactNeedles | Where-Object { -not $clockModule.Contains($_) }).Count -eq 0 -and -not $clockModule.Contains('225c197c34164c90b08a4c8b6b10e6c7') -and -not $clockModule.Contains('sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746')) 'Harvest Ridge clock module does not retain the exact replacement artifact identity and five-label refusal contract.'"
  const julyIdentityIndex = julyWiring.indexOf(julyIdentity)
  const julyPortIndex = julyWiring.indexOf('$portRegression = @(& npx tsx', julyIdentityIndex)
  if (julyIdentityIndex < 0 || julyPortIndex <= julyIdentityIndex) errors.push('artifact:july-identity-guard')
  const artifactStaticSource = read(root, 'scripts/foundation-static-guards.mjs')
  const artifactMutationSource = read(root, 'scripts/verify-foundation-mutations.mjs')
  if ((artifactStaticSource.split(artifactStaticBegin).length - 1) !== 1 || (artifactStaticSource.split(artifactStaticEnd).length - 1) !== 1) errors.push('artifact:soil-static-proof-span')
  if ((artifactMutationSource.split(artifactMutationBegin).length - 1) !== 1 || (artifactMutationSource.split(artifactMutationEnd).length - 1) !== 1 || !artifactMutationSource.includes('const expectedMutationCount = 158')) errors.push('artifact:soil-mutation-proof')
  for (const marker of ['artifactDiscoveryMutations.length !== 34', 'artifactReplacementMutations.length !== 19', 'artifactOmissionMutations.length !== 3', 'SOIL_ARTIFACT_MUTATION_MATRIX_PASS discovery=34 artifact=19 omission=3', 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_AST_CHILD_PROOF_PASS']) {
    if (!artifactMutationSource.includes(marker) && !artifactSources[5].includes(marker)) errors.push('artifact:soil-mutation-proof')
  }
  // SOIL_ARTIFACT_STATIC_GUARD_END

  const seasonOrchestrator = read(root, 'scripts/verify-season.ps1')
  const seasonSharedRegression = read(root, 'scripts/season-shared-harness-repair.regression.ps1')
  const soilSeasonBridge = "  Invoke-SeasonLane { & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/season-shared-harness-repair.regression.ps1 } 'Season shared harness repair regression failed.' | Out-Null"
  const seasonContractRegression = seasonOrchestrator.indexOf("  Invoke-SeasonLane { & node scripts/verify-season-contract.regression.mjs } 'Season fixture contract regression failed.'")
  const seasonBridge = seasonOrchestrator.indexOf(soilSeasonBridge)
  const seasonContractPass = seasonOrchestrator.indexOf("  Write-Output 'Farm Rx season contract gate: PASS (contract/isolation only; disposable-backend and browser workflow proof not yet run)'")
  if ((seasonOrchestrator.split(soilSeasonBridge).length - 1) !== 1 || (seasonOrchestrator.match(/scripts\/season-shared-harness-repair\.regression\.ps1/g) ?? []).length !== 1) errors.push('season:shared-harness-bridge-exactly-once')
  if (!(seasonContractRegression >= 0 && seasonBridge > seasonContractRegression && seasonContractPass > seasonBridge)) errors.push('season:shared-harness-bridge-order')
  requireText(errors, seasonSharedRegression, 'function Assert-SoilSeasonBridgeShape([string]$Text)', 'season:shared-harness-bridge-static-guard')
  requireText(errors, seasonSharedRegression, "Assert-SeasonHarness ($soilSeasonBridgeRejected -eq 7) 'Soil season bridge mutation count drifted.'", 'season:shared-harness-bridge-mutations')

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
