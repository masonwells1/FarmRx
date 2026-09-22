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
    && canonicalManifestRegression.includes('$paths.Sort([StringComparer]::Ordinal)') && canonicalManifestRegression.includes('HashSet[string]') && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_REPLACEMENT_CANONICAL_MANIFEST_PASS') && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_REPLACEMENT_CLEAN_FALLBACK_PASS') && canonicalManifestRegression.includes("@('diff-tree','--no-commit-id','--name-status','-r','-z','-M100%','HEAD^','HEAD')") && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY') && !canonicalManifestRegression.includes('Sort-Object')
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
    && evidenceManifest.includes('combined_source_artifact_identity_recipe') && evidenceManifest.includes('NUL-delimited dirty tracked, staged, and untracked existing source') && evidenceManifest.includes('refusing missing/non-rename deleted paths') && evidenceManifest.includes('accepting only Git R100 renames by their existing destination path')
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
    && forcedSpanHash === '654108f692edf3b073a1f5d2d651a21124ac33838024c40b9fb5d12e72ef4f36'
}

const canonicalManifestDiscoveryContract = (source) => {
  const dirty = source.indexOf("Invoke-Cw2ArtifactGitPathList @('diff','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_DIRTY_DIFF_GIT_FAILED'")
  const staged = source.indexOf("Invoke-Cw2ArtifactGitPathList @('diff','--cached','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_STAGED_DIFF_GIT_FAILED'")
  const untracked = source.indexOf("Invoke-Cw2ArtifactGitPathList @('ls-files','--others','--exclude-standard','-z') 'FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_GIT_FAILED'")
  const fallback = source.indexOf("Invoke-Cw2ArtifactGitPathList @('diff-tree','--no-commit-id','--name-status','-r','-z','-M100%','HEAD^','HEAD') 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_GIT_FAILED'")
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
    && pathCustody.every((needle) => source.includes(needle)) && source.includes("if($status-ceq'R100'){") && source.includes('FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_RENAME_DESTINATION_MISSING') && source.includes("}elseif($status-ceq'D'){") && source.includes('FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DELETION_REFUSED') && source.includes('if(-not$ForceCleanFallback){')
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
  const expectedRoutes = ['/today', '/fields', '/fields/new', '/fields/:id', '/fields/:id/edit', '/grain/*', '/inventory', '/profitability/*', '/equipment', '/tasks', '/weather', '/field-log', '/scouting', '/harvest', '/programs', '/notifications', '/soil-rx', '/privacy', '*', '/login', '/update-password', '/*']
  const actualRoutes = [...app.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/g)].map((match) => match[1])
  if (actualRoutes.length !== expectedRoutes.length || actualRoutes.some((route, index) => route !== expectedRoutes[index])) errors.push('routes:exact-ordered-manifest')
  requireText(errors, app, 'mobilePrimaryOrder = ["/today", "/grain", "/fields"]', 'mobile:primary-destinations')
  requireText(errors, app, 'mobilePrimaryCount = 3', 'mobile:primary-destinations')
  requireText(errors, app, 'mobile-record-toggle', 'mobile:record-toggle')
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
  if ((queuedSoil.match(/this\.cleanupLocked\(/g) ?? []).length !== 3) errors.push('soil-rx:cleanup-shared-transaction-callers')
  const attachmentCleanup = queuedSoil.slice(queuedSoil.indexOf('private async cleanAttachmentResources'), queuedSoil.indexOf('private async forgetRolledBackTest'))
  if (attachmentCleanup.indexOf('removeReports') < 0 || attachmentCleanup.indexOf('rollbackTestOperation') < 0 || attachmentCleanup.indexOf('removeReports') > attachmentCleanup.indexOf('rollbackTestOperation')) errors.push('soil-rx:attachment-cleanup-storage-before-row')
  if (attachmentCleanup.indexOf('confirmSoilRxAttachmentRemoval') < 0 || attachmentCleanup.indexOf('confirmSoilRxAttachmentRemoval') > attachmentCleanup.indexOf('rollbackTestOperation')) errors.push('soil-rx:attachment-cleanup-durable-storage-receipt')
  const soilStorage = read(root, 'src/data/soilRxStorage.ts')
  const soilStorageRemove = soilStorage.slice(soilStorage.indexOf('export async function removeSoilRxReportsWithGateway'), soilStorage.indexOf('export async function createSignedSoilRxReportUrl'))
  requireText(errors, soilStorage, 'const { data, error } = await storage.from(soilRxReportBucket).remove(requested)', 'soil-rx:storage-remove-receipt-data')
  requireText(errors, soilStorageRemove, 'if (exactRemovalReceipt(paths, removed)) return confirmSoilRxReportRemoval(paths, removed)', 'soil-rx:storage-remove-receipt-required')
  requireText(errors, soilStorageRemove, 'if (removed.length !== 0) return confirmSoilRxReportRemoval(paths, removed)', 'soil-rx:storage-malformed-nonempty-receipt-refused')
  requireText(errors, soilStorageRemove, 'const absent = await gateway.verifyAbsent(paths, context)', 'soil-rx:storage-physical-absence-required')
  requireText(errors, soilStorageRemove, "supabase.rpc('verify_soil_report_objects_absent', { p_farm_id: expected.farmId, p_paths: requested })", 'soil-rx:storage-scoped-absence-rpc')
  if (/\.list\(/.test(soilStorageRemove)) errors.push('soil-rx:storage-remove-ambiguous-recovery-refused')
  requireText(errors, soilStorage, "(error as { code?: unknown }).code === '42501' && (error as { message?: unknown }).message === 'soil report path is not owned by the current farm test'", 'soil-rx:storage-terminal-fallback-exact-error')
  requireText(errors, soilStorageRemove, 'if (!missingTestOwnership(error) || !scope || !gateway.verifyTerminalAbsence) throw error', 'soil-rx:storage-terminal-fallback-fail-closed')
  requireText(errors, soilStorageRemove, 'const absent = await gateway.verifyTerminalAbsence(paths, context, scope)', 'soil-rx:storage-terminal-absence-required')
  requireText(errors, soilStorageRemove, "supabase.rpc('verify_soil_report_cleanup_terminal_absence', { p_farm_id: expected.farmId, p_field_id: scope.fieldId, p_test_id: scope.testId, p_paths: requested })", 'soil-rx:storage-terminal-scoped-rpc')
  if ((soilStorageRemove.match(/\bcatch \(error\)/g) ?? []).length !== 1) errors.push('soil-rx:storage-terminal-fallback-single-catch')
  const supabaseSoil = read(root, 'src/data/SupabaseSoilRxRepository.ts')
  requireText(errors, supabaseSoil, "deleted.length === 1 && deleted.every((value) => { const row = object(value); return exact(row, ['id']) && id(row.id) === idValue })", 'soil-rx:row-delete-exact-receipt')
  requireText(errors, supabaseSoil, "deleted.length !== 0 || await this.d.gateway.verifyTestAbsent({ farmId: context.farmId, testId: idValue }, context) !== true", 'soil-rx:row-delete-physical-absence-required')
  const soilMigration = read(root, 'supabase/migrations/20260810223508_soil_rx_storage.sql')
  const normalAbsenceStart = soilMigration.indexOf('create function public.verify_soil_report_objects_absent(p_farm_id uuid, p_paths text[])')
  const terminalAbsenceStart = soilMigration.indexOf('create function public.verify_soil_report_cleanup_terminal_absence(')
  const absenceAclStart = soilMigration.indexOf('revoke all on function public.verify_soil_test_absent(uuid, uuid)', terminalAbsenceStart)
  const normalAbsence = normalAbsenceStart >= 0 && terminalAbsenceStart > normalAbsenceStart ? soilMigration.slice(normalAbsenceStart, terminalAbsenceStart) : ''
  const terminalAbsence = terminalAbsenceStart >= 0 && absenceAclStart > terminalAbsenceStart ? soilMigration.slice(terminalAbsenceStart, absenceAclStart) : ''
  for (const [required, label] of [["create function public.verify_soil_test_absent(p_farm_id uuid, p_test_id uuid)", 'row-function'], ["create function public.verify_soil_report_objects_absent(p_farm_id uuid, p_paths text[])", 'storage-function'], ['grant execute on function public.verify_soil_test_absent(uuid, uuid)', 'authenticated-grant']]) requireText(errors, soilMigration, required, `soil-rx:absence-rpc-${label}`)
  for (const [required, label] of [['perform public.assert_current_farm_access_epoch(p_farm_id);', 'epoch'], ['not public.can_edit_farm(p_farm_id)', 'edit-access'], ["where test.farm_id = p_farm_id\n        and test.field_id::text = split_part(requested.path, '/', 2)\n        and test.id::text = split_part(requested.path, '/', 3)", 'owned-test'], ["raise exception using errcode = '42501', message = 'soil report path is not owned by the current farm test'", 'owned-test-error'], ["object.bucket_id = 'soil-test-reports' and object.name = requested.path", 'physical-object']]) requireText(errors, normalAbsence, required, `soil-rx:absence-rpc-${label}`)
  for (const [required, label] of [["returns table(name text)\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public, pg_temp", 'shape'], ['perform public.assert_current_farm_access_epoch(p_farm_id);', 'epoch'], ['not public.can_edit_farm(p_farm_id)', 'edit-access'], ["where test.farm_id = p_farm_id and test.id = p_test_id", 'farm-scoped-row'], ["object.bucket_id = 'soil-test-reports'\n      and object.name = any (p_paths)", 'physical-object'], ["return query select requested.path from unnest(p_paths) requested(path) order by requested.path", 'exact-receipt']]) requireText(errors, terminalAbsence, required, `soil-rx:terminal-absence-rpc-${label}`)
  requireText(errors, soilMigration, 'public.verify_soil_report_cleanup_terminal_absence(uuid, uuid, uuid, text[])\nto authenticated;', 'soil-rx:terminal-absence-rpc-authenticated-grant')
  const soilModule = read(root, 'src/SoilRxModule.tsx')
  requireText(errors, soilModule, "soybeanNitrogen: { label: 'University of Delaware Cooperative Extension, Nitrogen Removal by Delaware Crops'", 'soil-rx:nutrient-removal-soybean-source')
  requireText(errors, soilModule, "corn: { nitrogen: 0.60, phosphorus: 0.37, potassium: 0.24 },\n  soybeans: { nitrogen: 3.44, phosphorus: 0.75, potassium: 1.17 },\n} as const", 'soil-rx:nutrient-removal-corn-soy-only')
  requireText(errors, soilModule, '!Object.hasOwn(nutrientRemovalCoefficients, family)', 'soil-rx:nutrient-removal-own-family')
  requireText(errors, soilModule, 'Harvest-removal estimates are available for corn and soybeans only.', 'soil-rx:nutrient-removal-unsupported-copy')
  if (/\bwheat\s*:\s*\{\s*nitrogen/.test(soilModule) || soilModule.includes('soybeanWheatNitrogen')) errors.push('soil-rx:nutrient-removal-corn-soy-only')
  const openReport = soilModule.slice(soilModule.indexOf('async function openReport'), soilModule.indexOf('\n\n  return <section', soilModule.indexOf('async function openReport')))
  const popupOpen = openReport.indexOf("const popup = window.open('about:blank', '_blank')")
  const signedUrl = openReport.indexOf('await repository.getReportUrl')
  if (popupOpen < 0 || signedUrl < 0 || popupOpen > signedUrl) errors.push('soil-rx:report-popup-synchronous-order')
  requireText(errors, openReport, "if (!popup) { setError('Your browser blocked the lab report window. Allow pop-ups for Farm Rx and try again.'); return }", 'soil-rx:report-popup-blocked-before-url')
  requireText(errors, openReport, 'popup.opener = null', 'soil-rx:report-popup-opener-cleared')
  requireText(errors, openReport, 'popup.location.replace(url)', 'soil-rx:report-popup-navigate')
  requireText(errors, openReport, 'popup.close()', 'soil-rx:report-popup-failure-cleanup')
  const revokedFarmRecovery = read(root, 'src/data/revokedFarmRecovery.ts')
  requireText(errors, revokedFarmRecovery, 'return isSoilRxStoredCleanupEntry(value) && entry.userId === userId && entry.farmId === farmId', 'soil-rx:revoked-custody-canonical-schema')
  const soilCleanupOutbox = read(root, 'src/data/soilRxCleanupOutbox.ts')
  requireText(errors, soilCleanupOutbox, 'return coordinatedDeviceTransaction(soilRxCleanupOutboxKey(projectRef, userId), storage, createId, task)', 'soil-rx:cleanup-shared-transaction')
  requireText(errors, soilCleanupOutbox, "const soilRxAttachmentLegacyKeys = ['kind', 'testId', 'paths', 'userId', 'farmId', 'recordedAt'] as const", 'soil-rx:cleanup-legacy-own-key-set')
  requireText(errors, soilCleanupOutbox, "const soilRxAttachmentCurrentKeys = [...soilRxAttachmentLegacyKeys, 'removedPaths'] as const", 'soil-rx:cleanup-current-own-key-set')
  requireText(errors, soilCleanupOutbox, 'function hasExactOwnKeys(row: Record<string, unknown>, keys: readonly string[]) { return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)) }', 'soil-rx:cleanup-exact-own-membership')
  requireText(errors, soilCleanupOutbox, "if ('removedPaths' in row && !Object.hasOwn(row, 'removedPaths')) return false", 'soil-rx:cleanup-inherited-removed-paths-refused')
  requireText(errors, soilCleanupOutbox, 'if (hasExactOwnKeys(row, soilRxAttachmentLegacyKeys)) return true', 'soil-rx:cleanup-legacy-shape-required')
  requireText(errors, soilCleanupOutbox, 'return hasExactOwnKeys(row, soilRxAttachmentCurrentKeys) && Array.isArray(removedPaths)', 'soil-rx:cleanup-current-shape-required')
  const farmContext = read(root, 'src/auth/farmContext.ts')
  if ((farmContext.match(/soilRxCleanupOutboxTransaction\(/g) ?? []).length !== 2) errors.push('soil-rx:revoked-cleanup-shared-transaction')
  const pendingFarmWork = farmContext.slice(farmContext.indexOf('export function hasPendingFarmWork'), farmContext.indexOf('export async function clearFarmAccess'))
  requireText(errors, pendingFarmWork, 'if (readSoilRxCleanupOutbox(target, soilCleanupKey).some((entry) => entry.userId === userId && entry.farmId === farmId)) return true', 'soil-rx:farm-switch-pending-cleanup')
  requireText(errors, pendingFarmWork, '} catch { return true }', 'soil-rx:farm-switch-pending-fail-closed')

  const foundationOrchestrator = read(root, 'scripts/verify-foundation.ps1')
  const foundationOrchestratorLf = foundationOrchestrator.replace(/\r\n/g, '\n')
  const playwrightConfig = read(root, 'playwright.config.ts')
  const foundationNativeLane = read(root, 'scripts/foundation-native-lane.ps1')
  const foundationNativeRegression = read(root, 'scripts/foundation-native-lane.regression.ps1')
  const foundationNativeRegressionLf = foundationNativeRegression.replace(/\r\n/g, '\n')
  const soilDisposableCapture = read(root, 'scripts/verify-soil-rx-disposable-capture.ps1')
  const soilDisposableCaptureRegression = read(root, 'scripts/verify-soil-rx-disposable-capture.regression.ps1')
  const soilDisposable = read(root, 'scripts/verify-soil-rx-disposable.ps1')
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
  if ((foundationOrchestrator.match(/^\s*Invoke-FoundationLane\s/gm) ?? []).length !== 28) errors.push('orchestrator:all-lanes-checked')
  requireText(errors, foundationOrchestrator, ". (Join-Path $PSScriptRoot 'foundation-native-lane.ps1')", 'orchestrator:native-lane-import')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'foundation-native-lane.regression.ps1') } 'Foundation native-lane regression failed.'", 'orchestrator:native-lane-regression')
  const nativeBrowserInvocation = "Invoke-FoundationNativeLane -Lane 'built-browser' -Executable $nativeNpm -Arguments @('run','test:e2e') -Failure 'Built-browser foundation suite failed.' | Out-Null"
  if ((foundationOrchestrator.split(nativeBrowserInvocation).length - 1) !== 1) errors.push('orchestrator:native-browser-lane')
  if ((foundationOrchestrator.match(/test:e2e/g) ?? []).length !== 1) errors.push('orchestrator:native-browser-exactly-once')
  if (foundationOrchestrator.includes('Invoke-FoundationLane { & npm run test:e2e }')) errors.push('orchestrator:native-browser-legacy-capture')
  for (const proof of ['0033', '0034', '0035', '0036', '0037', '0039', '0040', '0041', '0042', '0043']) requireText(errors, foundationOrchestrator, `Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-${proof}-disposable.ps1') }`, `orchestrator:checked-${proof}`)
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & (Join-Path $PSScriptRoot 'verify-equipment-cost-snapshots-disposable.ps1') }", 'orchestrator:checked-equipment-cost-snapshots')
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
  if ((soilDisposableCapture.match(/if \(-not \$Condition\) \{ throw \$Failure \}/g) ?? []).length !== 1) errors.push('soil-rx:capture-assertion-fail-closed')
  if ((soilDisposableCapture.match(/\$runDirectory = Join-Path \$EvidenceRoot \(\[Guid\]::NewGuid\(\)\.ToString\('N'\)\)/g) ?? []).length !== 1) errors.push('soil-rx:capture-unique-directory')
  requireText(errors, soilDisposableCaptureRegression, 'SOIL_RX_DISPOSABLE_CAPTURE_REGRESSION_PASS', 'soil-rx:capture-regression-marker')
  for (const required of ["raise exception using errcode = 'ZX001', message = 'SOIL_RX_CROSS_FARM_ROW_GUARD_BYPASSED'", "raise exception using errcode = 'ZX002', message = 'SOIL_RX_CROSS_FARM_STORAGE_GUARD_BYPASSED'", "if sqlstate <> 'P0001' or sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' then raise", "'terminal-epoch' = 'SOIL_RX_TERMINAL_EPOCH_GUARD_BYPASSED'", "'terminal-edit' = 'SOIL_RX_TERMINAL_EDIT_GUARD_BYPASSED'", "'terminal-path' = 'SOIL_RX_TERMINAL_PATH_GUARD_BYPASSED'", "'terminal-row' = 'SOIL_RX_TERMINAL_ROW_ABSENCE_GUARD_BYPASSED'", "'terminal-object' = 'SOIL_RX_TERMINAL_OBJECT_ABSENCE_GUARD_BYPASSED'", "'terminal-duplicate' = 'SOIL_RX_TERMINAL_DUPLICATE_GUARD_BYPASSED'", 'foreach ($entry in $mutations.GetEnumerator()) { Invoke-ExpectedGuardMutation $entry.Key $entry.Value }', 'if ($exitCode -eq 0 -or $text -notmatch [regex]::Escape($expected))', 'SOIL_RX_GUARD_MUTATIONS_PASS row=detected storage=detected terminal-epoch=detected terminal-edit=detected terminal-path=detected terminal-row=detected terminal-object=detected terminal-duplicate=detected']) requireText(errors, soilDisposable, required, 'soil-rx:cross-farm-runtime-mutations')
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
  const artifactPackageLane = 'tsx src/data/programsChunk5.regression.ts && pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/maple-season-db-clock-docker-adapter.regression.ps1 && pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/maple-synthetic-docker-topology-plan.regression.ps1 && pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/faketime-artifact-replacement-manifest.regression.ps1 && tsx src/data/programDueItems.regression.ts'
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
  if ((artifactMutationSource.split(artifactMutationBegin).length - 1) !== 1 || (artifactMutationSource.split(artifactMutationEnd).length - 1) !== 1 || !artifactMutationSource.includes('const expectedMutationCount = 388')) errors.push('artifact:soil-mutation-proof')
  for (const marker of ['artifactDiscoveryMutations.length !== 36', 'artifactReplacementMutations.length !== 19', 'artifactOmissionMutations.length !== 3', 'SOIL_ARTIFACT_MUTATION_MATRIX_PASS discovery=36 artifact=19 omission=3', 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_AST_CHILD_PROOF_PASS']) {
    if (!artifactMutationSource.includes(marker) && !artifactSources[5].includes(marker)) errors.push('artifact:soil-mutation-proof')
  }
  // SOIL_ARTIFACT_STATIC_GUARD_END

  const seasonOrchestrator = read(root, 'scripts/verify-season.ps1')
  const seasonSharedRegression = read(root, 'scripts/season-shared-harness-repair.regression.ps1')
  const soilSeasonBridge = "  Invoke-SeasonLane { & $harnessShell -NoProfile -ExecutionPolicy Bypass -File scripts/season-shared-harness-repair.regression.ps1 } 'Season shared harness repair regression failed.' | Out-Null"
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

  // GL-1: the USDA MARS feed can only enter cash_bids through the service-only fan-out, only for a verified report, only into
  // farms whose region matches, and never through a signed-in client; the browser keeps every feed row out of position math.
  const marsFeed = read(root, 'supabase/migrations/20260915150000_gl1_usda_mars_feed.sql')
  requireText(errors, marsFeed, 'revoke all on function public.ingest_usda_mars_observations(text, uuid, jsonb) from public, anon, authenticated;', 'mars-feed:fan-out-service-only')
  requireText(errors, marsFeed, 'grant execute on function public.ingest_usda_mars_observations(text, uuid, jsonb) to service_role;', 'mars-feed:fan-out-service-grant')
  if ((marsFeed.match(/set search_path = public, pg_temp/g) ?? []).length !== 1) errors.push('mars-feed:fan-out-fixed-search-path')
  requireText(errors, marsFeed, "if v_report.verified_at is null then\n    return jsonb_build_object('status', 'skipped', 'reason', 'report_unverified', 'report_id', p_report_id);", 'mars-feed:unverified-report-refused')
  requireText(errors, marsFeed, 'where market_region = v_report.geography;', 'mars-feed:region-match-only')
  if ((marsFeed.match(/with check \(public\.can_edit_farm\(farm_id\) and feed_source is null\);/g) ?? []).length !== 2) errors.push('mars-feed:client-cannot-create-feed-row')
  if ((marsFeed.match(/using \(public\.can_edit_farm\(farm_id\) and feed_source is null\)/g) ?? []).length !== 2) errors.push('mars-feed:client-cannot-alter-feed-row')
  requireText(errors, marsFeed, 'create unique index cash_bids_feed_observation_per_farm\n  on public.cash_bids (farm_id, feed_observation_key)\n  where feed_observation_key is not null;', 'mars-feed:one-observation-per-farm')
  requireText(errors, marsFeed, 'is distinct from (v_elevator, v_commodity, v_bid_date, v_basis, v_cash_price, v_delivery_start, v_delivery_end, v_note) then', 'mars-feed:unchanged-row-untouched')
  requireText(errors, marsFeed, 'revoke all on table public.usda_market_report_runs from public, anon, authenticated;', 'mars-feed:run-log-service-only')
  const basisMath = read(root, 'src/data/basisMath.ts')
  requireText(errors, basisMath, "bid.feed_source === 'usda_mars' || marsNote.test(bid.notes ?? '')", 'mars-feed:browser-fence-any-report')
  const grainGateway = read(root, 'src/data/SupabaseGrainDataGateway.ts')
  if (/function bidColumns[^\n]*feed_/.test(grainGateway)) errors.push('mars-feed:manual-save-never-sends-provenance')
  requireText(errors, foundationOrchestrator, "Invoke-FoundationLane { & deno check --no-config --lock=deno.lock --frozen --node-modules-dir=none supabase/functions/usda-mars-feed/index.ts }", 'orchestrator:frozen-usda-mars-feed-deno-check')
  const marsWorkflow = read(root, '.github/workflows/usda-mars-feed.yml')
  requireText(errors, marsWorkflow, '--header "x-scheduler-key: $SCHEDULER_KEY"', 'mars-feed:workflow-scheduler-key')
  const marsFunction = read(root, 'supabase/functions/usda-mars-feed/index.ts')
  requireText(errors, marsFunction, "if (!expected || !sameSecret(expected, supplied)) return json(401, { error: 'scheduler authorization failed' })", 'mars-feed:function-scheduler-auth')
  if (/console\.(?:info|error|log)\([^\n]*marsKey/.test(marsFunction)) errors.push('mars-feed:key-never-logged')
  // GL-004: a market day counts as done only through an ok run's report date, judged by the orchestrator; the feed never confirms a price alert.
  requireText(errors, marsFunction, "await admin.from('usda_market_report_runs').select('report_date').eq('report_id', reportId).eq('market_date', marketDate).eq('status', 'ok').abortSignal(signal)", 'mars-feed:run-report-dates-read')
  const marsOrchestrator = read(root, 'supabase/functions/_shared/marsFeedOrchestrator.ts')
  requireText(errors, marsOrchestrator, 'if (priorReportDates.some((reportDate) => reportDate === null || reportDate >= marketDate)) {', 'mars-feed:stale-report-refetched')
  const grainAlerts = read(root, 'src/data/grainAlerts.ts')
  requireText(errors, grainAlerts, "bid.commodity_id === target.commodity_id && bid.cash_price !== null && !isMarsBid(bid) && observationFresh(bid.bid_date, now)", 'mars-feed:plan-target-ignores-feed')
  const deliverGrainAlert = read(root, 'supabase/functions/deliver-grain-alert/index.ts')
  // GL-2 narrowed GL-004 here: the plan-target confirm keeps its feed fence (exactly one), while the
  // marketing-rule re-check deliberately admits feed rows through the shared selection below.
  if ((deliverGrainAlert.match(/\.is\('feed_source',null\)/g) ?? []).length !== 1) errors.push('mars-feed:alert-recheck-ignores-feed')

  // GL-2: crop-year eligibility decides which bid may satisfy a rule, in SQL and in the browser, and
  // the two copies of the marketing-year start are pinned to each other here so neither moves alone.
  const gl2Migration = read(root, 'supabase/migrations/20260920160000_gl2_alert_crop_year_eligibility.sql')
  requireText(errors, gl2Migration, "where crop_family = 'wheat'", 'gl2:wheat-marketing-year-seeded')
  requireText(errors, gl2Migration, "add column if not exists marketing_year_start_month smallint not null default 9", 'gl2:marketing-year-configured')
  const marketingYear = read(root, 'src/data/marketingYear.ts')
  requireText(errors, marketingYear, "corn: { month: 9, day: 1 },\n  soybeans: { month: 9, day: 1 },\n  wheat: { month: 6, day: 1 },", 'gl2:browser-marketing-year-matches-sql')
  // Those constants are the fallback for a database without the GL-2 migration, never the authority: the
  // sweep reads commodities.marketing_year_start_*, so a data change there must move the page too. A
  // guard can pin code to code; only reading the same row keeps the page honest against a data change.
  requireText(errors, marketingYear, 'export function marketingYearStartFor(', 'gl2:marketing-year-from-stored-configuration')
  requireText(errors, marketingYear, 'const configured = marketingYearStartFor(commodity)', 'gl2:marketing-year-from-stored-configuration')
  requireText(errors, read(root, 'src/data/SupabaseFieldsRepository.ts'), 'marketing_year_start_month: marketingMonth, marketing_year_start_day: marketingDay', 'gl2:commodity-carries-marketing-year')
  // Read from the RAW record, never through strictRow: that proxy fails closed on a column the row does
  // not carry, and these two do not exist until the GL-2 migration is applied.
  requireText(errors, read(root, 'src/data/SupabaseFieldsRepository.ts'), "const marketingMonth = optionalSmallInt(raw, 'marketing_year_start_month')", 'gl2:pre-migration-commodity-still-loads')
  // A merge deploys the client on its own; the migration is a separate owner action. Until the server
  // carries the eligibility rule the browser must not write alert_rule_states, or it and the old sweep
  // re-fire the same alert at each other.
  requireText(errors, read(root, 'src/data/grainAlerts.ts'), 'export function mayRecordAlertTransitions(', 'gl2:transitions-gated-on-schema')
  // The holdback selects the delivery input; it must not fall through into the pre-0035 branch, which
  // would stamp last_triggered_at and ask for a delivery the pre-GL-2 server refuses, hiding the alert
  // for the rest of the day -- the very harm the gate exists to prevent.
  requireText(errors, read(root, 'src/GrainModule.tsx'), 'const deliveries = mayRecordAlertTransitions(data.capabilities)', 'gl2:transitions-gated-on-schema')
  // And it reaches no further than saved marketing rules: a plan-target or report reminder carries no
  // ruleId, owes nothing to GL-2, and must keep the email the page still promises it.
  requireText(errors, read(root, 'src/GrainModule.tsx'), ': requestOwnerAlertDelivery(nextAlerts.filter((alert) => !alert.ruleId), data.fields.farm.id, alertOperationContext);', 'gl2:holdback-still-emails-plan-targets')
  requireText(errors, read(root, 'src/data/SupabaseGrainDataGateway.ts'), 'gl2_alert_eligibility: !functionMissing(per_commodity_cash_bids.error)', 'gl2:capability-reports-schema')
  requireText(errors, marketingYear, 'return inside(low) && inside(high)', 'gl2:window-wholly-inside')
  const marketingAlerts = read(root, 'src/data/marketingAlerts.ts')
  requireText(errors, marketingAlerts, 'cashBidEligibleForCropYear(commodity, rule.crop_year, bid.bid_date, bid.delivery_start, bid.delivery_end)', 'gl2:alert-reader-uses-eligibility')
  // The valuation reader keeps the feed out; the alerting reader admits it. That split is GL-2's whole point.
  requireText(errors, marketingAlerts, "bid.commodity_id === commodityId && bid.cash_price !== null && !isMarsBid(bid)", 'gl2:valuation-still-excludes-feed')
  if (/latestAlertEligibleCashBid[\s\S]{0,600}?isMarsBid/.test(marketingAlerts)) errors.push('gl2:alert-reader-must-not-exclude-feed')
  requireText(errors, read(root, '.github/workflows/usda-mars-feed.yml'), 'Evaluate marketing alerts against the bids just ingested', 'gl2:sweep-sequenced-after-feed')
  // GL-2 repair: one selection decides which bid may satisfy a rule. The sweep and the email re-check
  // both call it, so a rule can never be judged true by one and 409'd by the other -- which would
  // consume the transition in alert_rule_states and lose the alert with nothing sent.
  requireText(errors, gl2Migration, 'create or replace function public.latest_eligible_cash_bid(', 'gl2:one-eligible-bid-selection')
  requireText(errors, gl2Migration, 'from public.latest_eligible_cash_bid(v_farm.id,v_rule.commodity_id,v_rule.crop_year,v_local_date) b;', 'gl2:sweep-uses-shared-selection')
  requireText(errors, deliverGrainAlert, "admin.rpc('latest_eligible_cash_bid'", 'gl2:email-recheck-uses-shared-selection')
  // GL-1 made cash_bids grow every market day. The browser must read the NEWEST rows, bounded, or it
  // will judge a rule on stale history and fight the sweep over alert_rule_states.
  const gl2Gateway = read(root, 'src/data/SupabaseGrainDataGateway.ts')
  const gl3BasisMath = read(root, 'src/data/basisMath.ts')
  requireText(errors, gl2Gateway, ".order('bid_date', { ascending: false }).order('id', { ascending: false }).limit(RECENT_CASH_BID_LIMIT)", 'gl2:cash-bids-read-newest-first')
  requireText(errors, gl2Gateway, `.is('feed_source', null).or('notes.is.null,notes.not.like."[USDA MARS %"').order('bid_date', { ascending: false }).order('id', { ascending: false }).limit(MANUAL_CASH_BID_LIMIT)`, 'gl2:cash-bids-keep-manual-history')
  // A bare not.like is null for a row with no note, so it drops the ordinary manual bids this slice
  // exists to keep. The null branch must stay.
  if (/\.not\('notes', 'like'/.test(gl2Gateway)) errors.push('gl2:manual-slice-admits-null-notes')
  // That slice names feed_source, which GL-1's migration adds and which is applied separately from the
  // deploy. Its absence must be tolerated, or the first farm to load Grain after the merge loses the
  // whole workspace.
  requireText(errors, gl2Gateway, 'columnMissing(manual_cash_bids.error) ? [] : rows(manual_cash_bids.data, manual_cash_bids.error)', 'gl2:pre-gl1-workspace-still-loads')
  // A cap cannot promise the newest row for each commodity, which is what valuation and the grain line
  // read. Those rows are fetched exactly, and row-level security still applies to them.
  requireText(errors, gl2Gateway, "supabase.rpc('latest_cash_bids_per_commodity', { p_farm_id: farmId })", 'gl2:cash-bids-complete-per-commodity')
  requireText(errors, gl2Migration, 'create or replace function public.latest_cash_bids_per_commodity(', 'gl2:cash-bids-complete-per-commodity')
  // One definition of "this row is feed", on both sides of the wire. The browser has always read
  // provenance from the column OR the legacy note marker; the server's partition must do the same, or
  // a note-marked row written before the column existed is returned as the newest manual bid, the
  // browser discards it as feed, and the farm shows no valuation while a real manual bid sits below it.
  requireText(errors, gl2Migration, 'create or replace function public.cash_bid_is_feed(', 'gl2:feed-test-is-shared')
  requireText(errors, gl2Migration, "select p_feed_source is not null or coalesce(p_notes, '') ~ '^\\[USDA MARS \\S+( \u00b7 [^]]+)?\\]';", 'gl2:feed-marker-matches-browser')
  requireText(errors, gl3BasisMath, "const marsNote = /^\\[USDA MARS (\\S+)(?: \u00b7 ([^\\]]+))?\\]/", 'gl2:feed-marker-matches-browser')
  requireText(errors, gl2Migration, 'where b.farm_id = p_farm_id and not public.cash_bid_is_feed(b.feed_source, b.notes)', 'gl2:manual-side-uses-shared-feed-test')
  requireText(errors, gl2Migration, 'where b.farm_id = p_farm_id and public.cash_bid_is_feed(b.feed_source, b.notes)', 'gl2:feed-side-uses-shared-feed-test')
  requireText(errors, gl2Migration, 'security invoker', 'gl2:per-commodity-read-keeps-rls')
  // The page must break a tie exactly as the sweep does, or the two record opposite conditions.
  requireText(errors, marketingAlerts, 'right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id)', 'gl2:tie-breaker-matches-sweep')
  requireText(errors, gl2Migration, 'order by b.bid_date desc, b.updated_at desc, b.id desc', 'gl2:tie-breaker-matches-sweep')
  // GL-2 (c): the page states the real schedule. It must never go back to calling the server-checked
  // marketing alerts check-on-open.
  const grainModule = read(root, 'src/GrainModule.tsx')
  requireText(errors, grainModule, 'checks these on the server about every', 'gl2:true-schedule-stated')
  if (/Check-on-open/.test(grainModule)) errors.push('gl2:true-schedule-stated')
  // GL-2 (c) must not promise an email for a saved marketing alert. There are two reasons, and the
  // second only showed up after the first repair: the scheduled path has no Resend call at all, and a
  // rule the sweep already fired returns fired:false from record_marketing_alert_transition, so the
  // browser filters it out before deliver-grain-alert is ever invoked. A server-fired marketing alert
  // therefore never produces an email by any route.
  requireText(errors, grainModule, 'sends the alert to your phone, if you have turned notifications on', 'gl2:email-promise-is-true')
  // Three rounds went on this one sentence. Every phrasing that claimed something the code does not do
  // is rejected by name, so the fourth attempt cannot be another rewording that passes.
  if (/(emails the farm owner|The email goes out|their email goes out|and it is listed\s+here|and listed here)/.test(grainModule)) errors.push('gl2:email-promise-is-true')
  // A rule the sweep fired today is suppressed from the page's list by hasFiredToday, so the page must
  // say so rather than imply the farmer will find it there.
  requireText(errors, grainModule, 'already sent to your phone today is not', 'gl2:same-day-suppression-stated')

  // GL-3: the dead ends. Both counterparty fields accept free text with suggestions, no buyer or
  // elevator is hardcoded, the position card leads with a disclosure, and a second crop is reachable.
  requireText(errors, gl3BasisMath, 'export function knownCounterparties(', 'gl3:suggestions-are-shared')
  requireText(errors, gl3BasisMath, "...workspace.cash_bids.filter((bid) => !isMarsBid(bid)).map((bid) => bid.elevator),", 'gl3:suggestions-exclude-feed')
  if (/Cargill/.test(grainModule)) errors.push('gl3:no-hardcoded-buyer')
  requireText(errors, grainModule, 'list="basis-elevator-suggestions"', 'gl3:elevator-is-free-text')
  requireText(errors, grainModule, 'list="contract-buyer-suggestions"', 'gl3:buyer-is-free-text')
  requireText(errors, grainModule, 'className="position-more-toggle"', 'gl3:position-card-discloses')
  requireText(errors, grainModule, '{showMore ? "Hide details" : "More details"}', 'gl3:position-card-discloses')
  requireText(errors, grainModule, '<h2>Add another crop</h2>', 'gl3:second-crop-reachable')
  // The compact card stays mounted between crops, so the yield must not carry from one to the next.
  requireText(errors, grainModule, 'setAph("");\n      await onSaved();', 'gl3:yield-cleared-between-crops')

  // GL-3b: the way out of a contract typed wrong. Both actions are server-owned, because "this
  // contract has no deliveries" must be decided under a row lock, the reason is not optional, and the
  // audit row and the change are one transaction.
  const gl3bMigration = read(root, 'supabase/migrations/20260920170000_gl3_contract_edit_delete.sql')
  requireText(errors, gl3bMigration, 'create or replace function public.edit_grain_contract(', 'gl3b:repair-is-server-owned')
  requireText(errors, gl3bMigration, 'create or replace function public.delete_grain_contract(', 'gl3b:repair-is-server-owned')
  requireText(errors, gl2Gateway, "supabase.rpc('edit_grain_contract'", 'gl3b:repair-is-server-owned')
  requireText(errors, gl2Gateway, "supabase.rpc('delete_grain_contract'", 'gl3b:repair-is-server-owned')
  // One test of "this contract can still be corrected", on both sides of the wire. The screen must
  // never offer a control the database will refuse, and the database must never accept one the screen
  // thought it had already withheld.
  requireText(errors, gl3bMigration, 'create or replace function public.grain_contract_has_deliveries(', 'gl3b:delivered-contract-is-history')
  requireText(errors, gl3bMigration, 'if public.grain_contract_has_deliveries(p_farm_id, p_contract_id) then\n    raise exception \'this contract already has delivered bushels and can no longer be changed\';', 'gl3b:delivered-contract-is-history')
  requireText(errors, gl3bMigration, 'if public.grain_contract_has_deliveries(p_farm_id, p_contract_id) then\n    raise exception \'this contract already has delivered bushels and can no longer be deleted\';', 'gl3b:delivered-contract-is-history')
  requireText(errors, read(root, 'src/data/grain.ts'), 'return !workspace.grain_contract_deliveries.some((delivery) => delivery.grain_contract_id === contractId)', 'gl3b:delivered-contract-is-history')
  requireText(errors, grainModule, 'if (!available || !contractIsCorrectable(workspace, contract.id)) return null;', 'gl3b:delivered-contract-is-history')
  // The reason is the farm's own record of why a number moved, so it is required in the browser, in
  // the repository, and in the column's own check constraint.
  requireText(errors, read(root, 'src/data/grain.ts'), 'export function validateContractCorrectionReason(', 'gl3b:reason-is-required')
  requireText(errors, gl3bMigration, 'reason text not null check (length(btrim(reason)) between 3 and 2000)', 'gl3b:reason-is-required')
  requireText(errors, gl3bMigration, 'a reason of 3 to 2000 characters is required to change a contract', 'gl3b:reason-is-required')
  requireText(errors, gl3bMigration, 'a reason of 3 to 2000 characters is required to delete a contract', 'gl3b:reason-is-required')
  // A correction changes what was typed wrong, never the contract's identity or its math. Pricing on a
  // basis or HTA contract belongs to 0033's one-shot finalization rule, which this must not reach past.
  requireText(errors, gl3bMigration, 'set buyer = v_buyer, bushels = v_bushels, delivery_start = v_start, delivery_end = v_end,\n         contract_number = v_number, notes = v_notes, updated_at = now()', 'gl3b:identity-and-math-not-editable')
  if (/(crop_year|commodity_id|contract_type|cash_price|futures_price|basis|premium_cents_per_bu)\s*=/.test(gl3bMigration.slice(gl3bMigration.indexOf('update public.grain_contracts'), gl3bMigration.indexOf('returning * into v_after')))) errors.push('gl3b:identity-and-math-not-editable')
  // The record of a delete has to outlive the row it removed, which is the whole point of the table.
  if (gl3bMigration.indexOf("values (p_farm_id, p_contract_id, 'delete'") > gl3bMigration.indexOf('delete from public.grain_contracts')) errors.push('gl3b:audit-outlives-the-contract')
  if (/grain_contract_id uuid not null references/.test(gl3bMigration)) errors.push('gl3b:audit-outlives-the-contract')
  requireText(errors, gl3bMigration, 'create trigger grain_contract_audit_immutable', 'gl3b:audit-is-append-only')
  requireText(errors, gl3bMigration, 'grant select on public.grain_contract_audit to authenticated;', 'gl3b:audit-is-append-only')
  if (/grant[^;\n]*(insert|update|delete)[^;\n]*on public\.grain_contract_audit/.test(gl3bMigration)) errors.push('gl3b:audit-is-append-only')
  // This migration is applied separately from the deploy that carries the client, so the screen must
  // withhold both controls until the schema is there rather than offer one that fails on first use.
  requireText(errors, gl2Gateway, 'contract_edit_delete: !tableMissing(contract_audit_probe.error)', 'gl3b:capability-reports-schema')
  requireText(errors, grainModule, "const available = workspace.capabilities?.contract_edit_delete !== false;", 'gl3b:capability-reports-schema')
  // Neither correction is ever queued: a queued edit would replay against a contract that may since
  // have taken a delivery, and a queued delete against one that no longer exists.
  const gl3bQueued = read(root, 'src/data/QueuedGrainRepository.ts')
  requireText(errors, gl3bQueued, "async editContract(contractId: string, reason: string, changes: GrainContractCorrection, expectedUpdatedAt: string, operationId: string) { if (this.dependencies.isOffline()) throw new Error('Connect to the internet before correcting a contract.')", 'gl3b:correction-needs-a-connection')
  requireText(errors, gl3bQueued, "async deleteContract(contractId: string, reason: string, expectedUpdatedAt: string, operationId: string) { if (this.dependencies.isOffline()) throw new Error('Connect to the internet before deleting a contract.')", 'gl3b:correction-needs-a-connection')
  // An absent key keeps the stored value; only an explicit null clears one. A payload that named every
  // column would turn a buyer correction into a silent wipe of the window and the notes.
  requireText(errors, read(root, 'src/data/SupabaseGrainRepository.ts'), 'if (changes.delivery_start !== undefined) payload.delivery_start = changes.delivery_start || null', 'gl3b:absent-key-keeps-stored-value')
  requireText(errors, gl3bMigration, "v_start   := case when p_changes ? 'delivery_start'  then (p_changes->>'delivery_start')::date           else v_before.delivery_start end;", 'gl3b:absent-key-keeps-stored-value')
  // A contract created from a firm offer IS the record that the offer was filled. Deleting it must not
  // leave the offer marked filled pointing at nothing, which no screen can explain and which would
  // block that offer from ever being filled again.
  requireText(errors, gl3bMigration, "v_reopened_status := case when v_offer.expires_on is not null and v_offer.expires_on < v_local_date then 'expired' else 'open' end;", 'gl3b:filled-offer-does-not-dangle')
  requireText(errors, gl3bMigration, 'set status = v_reopened_status::public.firm_offer_status,', 'gl3b:filled-offer-does-not-dangle')
  // Either association. A contract filled through the pre-RPC fallback never got firm_offer_id --
  // contractColumns does not carry it -- so for those the link lives only on the offer's side.
  requireText(errors, gl3bMigration, 'where farm_id = p_farm_id and (id = v_before.firm_offer_id or filled_contract_id = p_contract_id)', 'gl3b:filled-offer-does-not-dangle')
  requireText(errors, gl3bMigration, 'filled_contract_id = null, updated_at = now()', 'gl3b:filled-offer-does-not-dangle')
  // Two members can hold the same contract open. Without a compare-and-swap the second save reverses
  // the first correction, and the audit records both as deliberate. Same fence as optimisticSave.
  requireText(errors, gl3bMigration, "if p_expected_updated_at is null or v_before.updated_at is distinct from p_expected_updated_at then\n    raise exception using errcode = 'P0001', message = 'FARM_RX_STALE_WRITE';", 'gl3b:correction-is-compare-and-swap')
  // Both RPCs, not just whichever one happens to still carry the text: an edit and a delete are each
  // a write against a row another member may have moved.
  if ((gl3bMigration.split("is distinct from p_expected_updated_at").length - 1) !== 2) errors.push('gl3b:correction-is-compare-and-swap')
  requireText(errors, read(root, 'src/data/grain.ts'), 'export function contractCorrectionDiff(', 'gl3b:only-changed-fields-are-sent')
  requireText(errors, grainModule, 'const changes = contractCorrectionDiff(current, { buyer, bushels: contractBushels, delivery_start: start, delivery_end: end, contract_number: number, notes });', 'gl3b:only-changed-fields-are-sent')
  requireText(errors, grainModule, 'await services.grainRepository.editContract(contract.id, reason, changes, current.updated_at, operationId.current);', 'gl3b:correction-is-compare-and-swap')
  requireText(errors, grainModule, 'await services.grainRepository.deleteContract(contract.id, reason, current.updated_at, operationId.current);', 'gl3b:correction-is-compare-and-swap')
  // The farm's own calendar day, not the database's. After UTC midnight an Illinois farm is still on
  // the previous evening, and an offer expiring that day is still fillable there.
  requireText(errors, gl3bMigration, "select (now() at time zone coalesce(f.time_zone, 'UTC'))::date into v_local_date", 'gl3b:offer-expiry-is-farm-local')
  // can_edit_farm admits a worker; Grain is behind can_read_private_financials; these functions are
  // security definer and so answer to neither unless they ask. Both RPCs must ask, hence the count.
  if ((gl3bMigration.split('not public.can_read_private_financials(p_farm_id)').length - 1) !== 2) errors.push('gl3b:repair-requires-financial-access')
  // An audited action is pointless while the direct path is open.
  requireText(errors, gl3bMigration, 'revoke update, delete on public.grain_contracts from authenticated;', 'gl3b:audited-actions-are-the-only-path')
  requireText(errors, gl3bMigration, 'drop policy if exists grain_contracts_update on public.grain_contracts;', 'gl3b:audited-actions-are-the-only-path')
  requireText(errors, gl3bMigration, 'drop policy if exists grain_contracts_delete on public.grain_contracts;', 'gl3b:audited-actions-are-the-only-path')
  // A write that commits and loses its response must not read as a failure the farmer cannot resolve.
  // The recognition has to come BEFORE the compare-and-swap, because a committed edit moved updated_at.
  requireText(errors, gl3bMigration, 'select * into v_replay from public.grain_contract_audit a where a.farm_id = p_farm_id and a.operation_id = p_operation_id;\n  if found then', 'gl3b:correction-survives-a-lost-response')
  if (gl3bMigration.indexOf('a.operation_id = p_operation_id') > gl3bMigration.indexOf('is distinct from p_expected_updated_at')) errors.push('gl3b:correction-survives-a-lost-response')
  requireText(errors, gl3bMigration, 'create unique index grain_contract_audit_operation_idx', 'gl3b:correction-survives-a-lost-response')
  requireText(errors, gl3bMigration, "if p_operation_id is null then raise exception 'a correction must carry its own operation id'; end if;", 'gl3b:correction-survives-a-lost-response')
  requireText(errors, grainModule, 'const operationId = useRef<string | null>(null);', 'gl3b:correction-survives-a-lost-response')
  // A version fence plus a draft holding pre-refresh values is worse than either alone: the request
  // carries the NEW updated_at with the OLD field values, so the compare-and-swap accepts a write that
  // undoes whatever another member just corrected.
  requireText(errors, grainModule, 'if (contract.updated_at !== seenVersion) {', 'gl3b:draft-rebases-on-a-changed-contract')
  requireText(errors, grainModule, 'This contract changed while you had it open. The fields now show the current values', 'gl3b:draft-rebases-on-a-changed-contract')
  // The refresh after a successful save hands back the row this panel just wrote. Without adopting
  // that version, the farmer's own correction is read as somebody else's and the success message is
  // replaced by a warning that nothing concurrent actually happened.
  // The prop does not carry the new version until the refresh lands, so adopting it at save time
  // only moves the mismatch. The version this panel wrote is remembered separately and recognised.
  requireText(errors, grainModule, 'setSavedRow(saved);', 'gl3b:own-save-is-not-a-concurrent-change')
  requireText(errors, grainModule, 'if (contract.updated_at !== seenVersion && savedRow !== null && contract.updated_at === savedRow.updated_at) {', 'gl3b:own-save-is-not-a-concurrent-change')
  // The reload after a save catches its own failure, so a correction can succeed while the prop stays
  // on the row before it. The panel diffs and versions against the row it last wrote, not the prop.
  requireText(errors, grainModule, 'const current = savedRow ?? contract;', 'gl3b:a-failed-reload-cannot-strand-the-panel')
  requireText(errors, grainModule, 'const changes = contractCorrectionDiff(current, {', 'gl3b:a-failed-reload-cannot-strand-the-panel')
  requireText(errors, grainModule, 'changes, current.updated_at, operationId.current);', 'gl3b:a-failed-reload-cannot-strand-the-panel')
  requireText(errors, grainModule, 'reason, current.updated_at, operationId.current);', 'gl3b:a-failed-reload-cannot-strand-the-panel')
  // Setting a basis or futures price tells the farmer to add a contract note. Without a note field in
  // the only form that can change one, that instruction has nowhere to land.
  requireText(errors, grainModule, '<label>Contract note<textarea value={notes}', 'gl3b:a-contract-note-is-reachable')
  // A deleted contract takes its row with it, so what the delete has to say goes above the table. A
  // contract that came from a firm offer sent that offer back to open; entering a replacement by hand
  // instead of refilling it leaves the offer counted as pending and fillable into a second contract.
  requireText(errors, read(root, 'src/data/SupabaseGrainRepository.ts'), 'return { reopenedFirmOfferId: reopened, reopenedFirmOfferStatus: status }', 'gl3b:a-reopened-offer-is-surfaced')
  requireText(errors, grainModule, 'onDeleted?.(result.reopenedFirmOfferId', 'gl3b:a-reopened-offer-is-surfaced')
  requireText(errors, grainModule, 'fill it from Firm offers rather than entering a new contract', 'gl3b:a-reopened-offer-is-surfaced')
  // An offer whose expiry had passed comes back 'expired', not 'open'. It cannot be filled and is not
  // counted as pending, so the id alone is not enough to know what to tell the farmer.
  // The status the delete SET, stored and replayed -- not the offer's state at some later moment,
  // which by the time of a retry can be whatever another member did to it since.
  requireText(errors, gl3bMigration, "  reopened_firm_offer_status text,", 'gl3b:a-reopened-offer-is-surfaced')
  requireText(errors, gl3bMigration, "'reopened_firm_offer_status', v_reopened_status,", 'gl3b:a-reopened-offer-is-surfaced')
  requireText(errors, gl3bMigration, "'reopened_firm_offer_status', v_replay.reopened_firm_offer_status,", 'gl3b:a-reopened-offer-is-surfaced')
  if (/'reopened_firm_offer_status', \(select/.test(gl3bMigration)) errors.push('gl3b:a-reopened-offer-is-surfaced')
  // Every state named. "Not open, therefore expired" announces an expiry that never happened.
  requireText(errors, grainModule, 'result.reopenedFirmOfferStatus === "expired"', 'gl3b:a-reopened-offer-is-surfaced')
  requireText(errors, grainModule, 'result.reopenedFirmOfferStatus === "open"', 'gl3b:a-reopened-offer-is-surfaced')
  requireText(errors, grainModule, 'marked expired rather than reopened', 'gl3b:a-reopened-offer-is-surfaced')
  // A retry after a lost response owes the same answer, or that guidance is lost entirely.
  requireText(errors, gl3bMigration, "'reopened_firm_offer_id', v_replay.reopened_firm_offer_id,", 'gl3b:a-reopened-offer-is-surfaced')
  // A delete retry is the SAME delete or it is not a retry. "An audit row exists" would answer a
  // different reason, or another member's delete, with this caller's success.
  requireText(errors, gl3bMigration, 'if v_replay.operation_id = p_operation_id and v_replay.reason is not distinct from v_reason then', 'gl3b:a-delete-retry-must-be-the-same-delete')
  requireText(errors, gl3bMigration, "raise exception using errcode = 'P0001', message = 'FARM_RX_CONTRACT_ALREADY_DELETED';", 'gl3b:a-delete-retry-must-be-the-same-delete')
  requireText(errors, gl3bMigration, "if p_operation_id is null then raise exception 'a delete must carry its own operation id'; end if;", 'gl3b:a-delete-retry-must-be-the-same-delete')
  // A replay returns the row THAT operation produced. Handing back a later member's version would let
  // the browser adopt it as its own and then overwrite their work with the values it still holds.
  requireText(errors, gl3bMigration, '      return v_replay.after_row;', 'gl3b:a-retry-must-be-the-same-correction')
  requireText(errors, read(root, 'src/data/grain.ts'), 'if ((draft.notes.trim() || null) !== contract.notes) changes.notes = draft.notes.trim() || null', 'gl3b:a-contract-note-is-reachable')
  // The browser refuses an empty correction, but the RPC is reachable without the browser, and a
  // no-op there would move updated_at and make every other member's open draft stale for nothing.
  requireText(errors, gl3bMigration, "if v_changes is null or not (v_changes ?| array['buyer','bushels','delivery_start','delivery_end','contract_number','notes']) then", 'gl3b:a-correction-must-correct-something')
  requireText(errors, gl3bMigration, "raise exception 'a correction must change something';", 'gl3b:a-correction-must-correct-something')
  // Recognising a retry by id alone would answer a CHANGED draft with the earlier correction and
  // report success while dropping what the farmer just typed.
  // The contract is part of the replay identity, not context around it: an id spent on contract A
  // must not answer for contract B, however identical the reason and the requested change are.
  requireText(errors, gl3bMigration, 'if v_replay.grain_contract_id = p_contract_id\n       and v_replay.reason is not distinct from v_reason\n       and v_replay.requested_changes is not distinct from v_changes then', 'gl3b:a-retry-must-be-the-same-correction')
  requireText(errors, gl3bMigration, "raise exception using errcode = 'P0001', message = 'FARM_RX_CORRECTION_ALREADY_SAVED';", 'gl3b:a-retry-must-be-the-same-correction')
  requireText(errors, grainModule, 'const redraft = () => { operationId.current = null };', 'gl3b:a-retry-must-be-the-same-correction')
  // Counted inside ContractRepair rather than across the file. LD-1's load form uses the same idiom
  // for the same reason, and a file-wide count would have turned that into a GL-3b failure while also
  // letting a GL-3b field lose its redraft() as long as some other component gained one.
  const contractRepairBody = grainModule.slice(grainModule.indexOf('export function ContractRepair'), grainModule.indexOf('export function Bins'))
  if ((contractRepairBody.split('redraft();').length - 1) !== 7) errors.push('gl3b:a-retry-must-be-the-same-correction')
  // ??=, not =: a retry must reuse the id its first attempt used, or the server cannot recognise it.
  requireText(errors, grainModule, 'operationId.current ??= services.createGrainId();', 'gl3b:correction-survives-a-lost-response')
  // Both paths mint lazily, correction and delete. A plain assignment in either would hand a retry a
  // fresh id, and the server would read it as a different operation rather than the same one.
  if ((grainModule.split('operationId.current ??= services.createGrainId();').length - 1) !== 2) errors.push('gl3b:correction-survives-a-lost-response')
  requireText(errors, grainModule, 'current.updated_at, operationId.current);\n      operationId.current = null;', 'gl3b:correction-survives-a-lost-response')
  if (/expires_on < current_date/.test(gl3bMigration)) errors.push('gl3b:offer-expiry-is-farm-local')
  // GL-3a made the crop and year picker permanent, so the sale form must not outlive a scope change:
  // a draft typed for one crop year would otherwise be saved under the next one.
  requireText(errors, grainModule, 'key={scopeKey(selectedScope)}', 'gl3:contract-form-resets-on-scope-change')
  requireText(errors, grainModule, '<tfoot>', 'gl3:contract-totals-row')
  // The totals row floors each contract's remaining exactly as its own row does, so one over-delivered
  // contract can never make the farm's remaining look smaller than it is.
  requireText(errors, grainModule, 'sum + Math.max(0, contract.bushels - workspace.grain_contract_deliveries', 'gl3:totals-never-net-over-delivery')

  // ----- Initiative LD-1: the load record
  const ld1Migration = read(root, 'supabase/migrations/20260920180000_ld1_grain_loads.sql')
  const grainTypes = read(root, 'src/data/grain.ts')
  // A load is written only through the RPC. The table granting INSERT would put every check below
  // behind a browser that can simply not call it.
  requireText(errors, ld1Migration, 'grant select on public.grain_loads to authenticated;', 'ld1:the-only-write-path-is-the-rpc')
  if (/^grant\b[^;]*\b(insert|update|delete)\b[^;]*\bon public\.grain_loads/mi.test(ld1Migration)) errors.push('ld1:the-only-write-path-is-the-rpc')
  // Both fences, on both RPCs. can_edit_farm alone admits a worker, and a scale ticket carries the
  // farm's bushels and the buyer that bought them.
  if ((ld1Migration.split('not public.can_read_private_financials(p_farm_id) then').length - 1) !== 2) errors.push('ld1:a-load-is-private-financial-data')
  if ((ld1Migration.split('public.request_uses_service_role()').length - 1) !== 2) errors.push('ld1:a-load-is-private-financial-data')
  // The origin decides the lot. Preferring the client's value, or the stored one, would be two
  // evaluators of one fact -- the defect that cost GL-2 five rounds.
  requireText(errors, ld1Migration, 'v_commodity := v_crop.commodity_id;\n    v_crop_year := v_crop.crop_year;', 'ld1:the-origin-decides-the-lot')
  requireText(errors, ld1Migration, 'v_commodity := v_inventory.commodity_id;\n      v_crop_year := v_inventory.crop_year;', 'ld1:the-origin-decides-the-lot')
  // Carry-over grain paying down a current-year contract is the defect this tranche exists to stop.
  requireText(errors, ld1Migration, 'if v_contract.crop_year is distinct from v_crop_year then', 'ld1:a-contract-must-match-the-lot')
  requireText(errors, ld1Migration, 'if v_contract.commodity_id is distinct from v_commodity then', 'ld1:a-contract-must-match-the-lot')
  requireText(errors, grainTypes, 'contract.crop_year !== lot.crop_year', 'ld1:a-contract-must-match-the-lot')
  // Append-only, and the epoch guard every farm-scoped table carries.
  requireText(errors, ld1Migration, 'create trigger grain_loads_append_only\nbefore update on public.grain_loads\nfor each row execute function public.grain_loads_append_only();', 'ld1:a-saved-ticket-is-evidence')
  requireText(errors, ld1Migration, "raise exception 'a load record cannot be edited; void it and record the correct one';", 'ld1:a-saved-ticket-is-evidence')
  requireText(errors, ld1Migration, 'create trigger farm_access_epoch_guard\nbefore insert or update or delete on public.grain_loads\nfor each row execute function public.guard_row_farm_access_epoch();', 'ld1:a-load-is-epoch-fenced')
  // A retry replays; it never writes a second ticket, and never silently means something else.
  requireText(errors, ld1Migration, "raise exception using errcode = 'P0001', message = 'FARM_RX_LOAD_ID_REUSED';", 'ld1:a-lost-response-is-not-a-lost-ticket')
  requireText(errors, ld1Migration, "raise exception using errcode = 'P0001', message = 'FARM_RX_LOAD_ALREADY_VOIDED';", 'ld1:a-lost-response-is-not-a-lost-ticket')
  requireText(errors, grainModule, 'loadId.current ??= services.createGrainId();', 'ld1:a-lost-response-is-not-a-lost-ticket')
  requireText(errors, grainModule, 'const redraft = () => { loadId.current = null; setTicketOutstanding(false) };', 'ld1:a-lost-response-is-not-a-lost-ticket')
  // Every field change drops the held ticket id: the same id standing for different content is the
  // one thing the server refuses outright.
  const loadsTabBody = grainModule.slice(grainModule.indexOf('export function LoadsTab'))
  if ((loadsTabBody.split('update({').length - 1) < 12) errors.push('ld1:a-lost-response-is-not-a-lost-ticket')
  // LD-1 stored the ticket and nothing else, and said so. LD-2 gives the ticket its effects, so that
  // sentence is gone and what replaces it is the list of effects the farmer confirms. The rule is the
  // same rule: what a save will do is on the screen before the button is pressed.
  requireText(errors, grainModule, 'What saving this will do', 'ld2:the-effects-are-shown-before-the-save')
  requireText(errors, grainModule, 'Saving this records the ticket and changes nothing else.', 'ld2:the-effects-are-shown-before-the-save')
  // An effect is only ever offered when the load's shape can reach it. All four are checked, because
  // offering a box that the server would refuse is the same defect as performing an effect silently.
  for (const effect of ['bin_out', 'bin_in', 'contract_delivery', 'harvest']) {
    requireText(errors, grainModule, `availableEffects.includes("${effect}")`, 'ld2:an-effect-is-only-offered-when-reachable')
  }
  // An effect the load's shape cannot reach is never SENT, whatever the draft remembers. The
  // narrowing happens once, in the payload, so there is one place to check rather than one per
  // screen that edits a draft.
  requireText(errors, read(root, 'src/data/SupabaseGrainDataGateway.ts'), 'const effective = normalizeLoadEffects(draft)', 'ld2:an-impossible-effect-is-never-sent')
  // A blocked void changed nothing at all. Reporting it as done would leave the farmer believing
  // bushels moved back when they did not.
  requireText(errors, grainModule, 'result.status === "blocked"', 'ld2:a-blocked-void-is-not-reported-as-done')
  // Merging deploys this client before the migration is applied, every time. LD-1 made the Loads
  // tab wait for its table; LD-2 has a worse window, because the table exists and only the columns
  // are missing, so the form would offer effects whose save produces a database error.
  requireText(errors, grainModule, "workspace.capabilities?.grain_load_effects !== false", 'ld2:the-effects-wait-for-the-migration')
  requireText(errors, read(root, 'src/data/SupabaseGrainDataGateway.ts'), "select('id,effect_harvest')", 'ld2:the-effects-wait-for-the-migration')
  {
    // LD-3: committed and free are ONE farm-level figure. The per-bin pair read
    // bin_inventory.committed_bushels, a stored number per bin, while contracts are written against
    // the farm -- so the same bushels appeared again on every bin holding that crop.
    //
    // Comments are stripped before this is tested. LD-1 shipped a guard that its own explanatory
    // comment satisfied, and the comment that explains THIS rule necessarily names the column it
    // forbids; matching raw source would make the guard pass on its own prose.
    const withoutComments = grainModule
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
    if (withoutComments.includes('committed_bushels')) errors.push('ld3:committed-is-one-farm-level-figure')
    if ((grainModule.split('<CommittedFreeLine').length - 1) !== 1) errors.push('ld3:committed-is-one-farm-level-figure')
    const committedFree = read(root, 'src/data/committedFree.ts')
    // Carry-over grain is never charged against a current-year contract. Both halves of the lot key
    // are required, on the contracts and on the movements.
    requireText(errors, committedFree, 'contract.commodity_id === commodityId && contract.crop_year === cropYear', 'ld3:carry-over-is-never-charged-to-another-year')
    requireText(errors, committedFree, 'movement.commodity_id === commodityId && movement.crop_year === cropYear', 'ld3:an-unstamped-movement-joins-no-year')
    // An over-delivered contract owes nothing; letting it go negative pays down a different one.
    requireText(errors, committedFree, 'Math.max(0, contract.bushels - delivered)', 'ld3:over-delivery-never-pays-down-another-contract')

    // An unresolved movement is unresolved whatever it nets to. Filtering the unknown bucket by net
    // bushels dropped exactly the rows whose resolution moves the figures most -- an unknown 1,000
    // in and 1,000 out, which can land in two different crop years.
    requireText(errors, grainModule, 'deriveUnknownCropYearBushels(workspace.bin_transactions).filter((row) => row.movementCount > 0)', 'ld3:an-unresolved-movement-is-named-however-it-nets')
    // This component returns null when it has neither lots nor unknown movements, so reaching an
    // empty state meant unknown movements existed -- and "Nothing stored or contracted yet" was
    // printed directly above a list of stored bushels. It can never be true here.
    if (grainModule.includes('Nothing stored or contracted yet')) errors.push('ld3:the-empty-state-that-could-never-be-true')
  }
  {
    // LD-4: a bin origin hauls the lot the farmer names, and the rules that decide which lot are
    // the ones the amendment wrote. These four are the ones a plausible rewrite would lose.
    const committedFree = read(root, 'src/data/committedFree.ts')
    const grainData = read(root, 'src/data/grain.ts')

    // The lot list comes from the baseline AND the movements. Reading the baseline alone is the
    // LD-1 defect this initiative closed, and it is a one-line regression away.
    // Pinned as the movements read inside loadLotFor, not as a bare binLotsOnHand( call: that call
    // appears twice, so a guard on the name alone stays satisfied by originBinLots while the
    // origin quietly goes back to the baseline. The mutation drill caught exactly that.
    requireText(errors, grainData, 'workspace.bin_transactions.filter((row) => row.grain_bin_id === draft.origin_grain_bin_id)', 'ld4:a-bin-origin-reads-its-lots-not-its-baseline')
    // Defaulting happens only for a bin holding exactly one lot. The amendment's words.
    requireText(errors, grainData, 'lots.length === 1 ?', 'ld4:only-a-single-lot-bin-defaults')
    // Bushels with no crop year are never offered as one, and never defaulted to.
    requireText(errors, committedFree, "lot.crop_year !== null && lot.bushels > 0.000001", 'ld4:the-unstamped-bucket-is-never-a-crop-year')

    // The same merge-before-migration window as LD-2's effects, and the reason LD-006 finding 1
    // existed: while the capability is false the form offers no choice and the derivation answers
    // as LD-1 did, because that is what the installed RPC will accept.
    // Counted, not merely present. Two places consult this capability -- the derivation and the
    // validation -- and a guard that only asks whether the string appears stays green while one of
    // them quietly stops asking. The mutation drill caught that too.
    if ((grainData.split("workspace.capabilities?.grain_load_bin_lot === false").length - 1) !== 2) errors.push('ld4:the-lot-choice-waits-for-the-migration')
    requireText(errors, grainModule, "workspace.capabilities?.grain_load_bin_lot !== false", 'ld4:the-lot-choice-waits-for-the-migration')
    requireText(errors, grainModule, '!binLotReady\n        ? { ...outgoing0, origin_crop_year: "", origin_commodity_id: "" }', 'ld4:a-hidden-lot-choice-is-never-sent')
    // And when the capability IS there, the lot on the wire is the one this render resolved, not a
    // draft field an effect fills in after the render commits. Between the read landing and that
    // effect flushing the screen named a lot while the payload carried none, and the server
    // defaulted -- which is the silent guess this whole initiative exists to stop.
    requireText(errors, grainModule, 'draft.origin_kind === "bin" && lot\n          ? { ...outgoing0, origin_crop_year: String(lot.crop_year), origin_commodity_id: lot.commodity_id }', 'ld4:the-form-states-the-lot-it-showed')
    requireText(errors, read(root, 'src/data/SupabaseGrainDataGateway.ts'), "supabase.rpc('bin_lots'", 'ld4:the-lot-choice-waits-for-the-migration')

    // The balance question stays in append_bin_movement, under a row lock. save_grain_load asking
    // it too would make two guards that can disagree -- the defect shape this initiative keeps
    // finding. Comments are stripped, for the same reason the LD-3 guard above strips them: the
    // migration's own header explains the rule and would otherwise satisfy the guard.
    const ld4Migration = read(root, 'supabase/migrations/20260921180000_ld4_bin_origin_lot.sql')
    // Bounded at both ends. This migration now also redefines append_bin_movement below, and that
    // function legitimately raises FR001 and reads bin_inventory -- an open-ended slice would read
    // its body as save_grain_load's and pass on the wrong evidence.
    const saveStart = ld4Migration.indexOf('create or replace function public.save_grain_load')
    const saveEnd = ld4Migration.indexOf('revoke all on function public.save_grain_load', saveStart)
    const saveBody = ld4Migration
      .slice(saveStart, saveEnd)
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n')
    if (saveBody.includes('FR001')) errors.push('ld4:the-balance-question-has-one-answer')
    if (saveBody.includes('bin_inventory')) errors.push('ld4:a-bin-origin-reads-its-lots-not-its-baseline')
    // A lot the farmer names has to be one the bin has a record of. Without this the server would
    // take any year on trust and stamp a ticket with a crop the bin has never held.
    requireText(errors, ld4Migration, "raise exception 'this bin has no record of the % crop', v_crop_year;", 'ld4:save-grain-load-checks-the-lot-is-real')

    // LD-4 repair: the picker asks the database what the bin holds. Deriving it from the workspace
    // array is what made a truncated movement list look like a one-lot bin -- the form then offered
    // no choice, sent no crop year, and the save was refused with a message the form had no control
    // to answer. A load the farmer could not record at all.
    requireText(errors, grainModule, 'authoritativeLots ?? originBinLots(workspace, draft.origin_grain_bin_id)', 'ld4:the-picker-asks-the-database-what-the-bin-holds')
    requireText(errors, grainData, 'authoritativeLots ?? binLotsOnHand(', 'ld4:the-picker-asks-the-database-what-the-bin-holds')
    // And when it cannot get that answer it says so rather than falling back to a list that may be
    // short: a short movement list is indistinguishable from a one-lot bin.
    requireText(errors, grainModule, "const lotsUnavailable = lotsState === 'unavailable';", 'ld4:a-lot-list-that-could-not-be-read-is-never-guessed')
    {
      // LD-4 repair: the lot answer is stored WITH the bin it is about and the refresh it was
      // fetched for, so a stale one cannot be read at all. As two independent pieces of state the
      // lots and the status could disagree for a render after the bin changed -- status still
      // 'ready', lots still the previous bin's -- and the form auto-selected a lot from ANOTHER
      // BIN's list. That is this feature's own defect, one layer up from the truncation it was
      // built for, and it was invisible until a journey refused to go red against it.
      requireText(errors, grainModule, 'const [lotRead, setLotRead] = useState<{ binId: string; refresh: number; lots: BinLotOnHand[] | null } | null>(null);', 'ld4:the-lot-answer-is-keyed-to-its-bin')
      // BOTH halves of the key. Either one dropped is a different stale answer becoming readable,
      // and a requireText on the whole line stays green while the comparison under it is cut.
      requireText(errors, grainModule, 'lotRead.binId === originBinId && lotRead.refresh === lotsRefresh', 'ld4:the-lot-answer-is-keyed-to-its-bin')
      // And the status is DERIVED from that one piece of state, never set beside it. A second
      // setter is how the two drift back out of step.
      if (grainModule.includes('setLotsState(')) errors.push('ld4:the-lot-answer-is-keyed-to-its-bin')
      if (grainModule.includes('setAuthoritativeLots(')) errors.push('ld4:the-lot-answer-is-keyed-to-its-bin')
    }
    requireText(errors, grainModule, 'Farm Rx could not read what this bin holds', 'ld4:a-lot-list-that-could-not-be-read-is-never-guessed')

    // LD-1's replay guarantee, which LD-4 broke for one case: a one-lot bin hauled to exactly zero
    // has no lot left, so a retry after a lost response was refused seventy lines before it reached
    // the replay check -- telling a farmer their load failed when it was already recorded. The
    // stored lot is adopted only when the caller named none, so a retry naming a different lot is
    // still a reused id.
    requireText(errors, ld4Migration, 'select crop_year, commodity_id into v_replay_year, v_replay_commodity', 'ld4:a-retry-still-returns-the-ticket-it-saved')
    // The form keeps the origin for the next ticket, and a save can empty the year it named. A
    // choice the picker no longer offers has to be dropped, or the form refuses every further save
    // with no control on screen to fix it.
    requireText(errors, grainModule, 'setDraft((current) => ({ ...current, origin_crop_year: "", origin_commodity_id: "" }));', 'ld4:a-crop-year-the-bin-no-longer-offers-is-dropped')

    // A lot is a commodity IN a crop year -- this initiative's first rule. The year alone does not
    // identify one, so both halves travel with the choice and the server refuses an ambiguous year
    // rather than picking the fuller lot.
    requireText(errors, ld4Migration, 'select count(distinct lots.commodity_id), max(lots.commodity_id)', 'ld4:a-lot-is-a-commodity-in-a-crop-year')
    requireText(errors, grainModule, 'const [commodity, year] = event.target.value.split(":");', 'ld4:a-lot-is-a-commodity-in-a-crop-year')
    requireText(errors, read(root, 'src/data/SupabaseGrainDataGateway.ts'), 'if (draft.origin_commodity_id) payload.commodity_id = draft.origin_commodity_id', 'ld4:a-lot-is-a-commodity-in-a-crop-year')
    // And one baseline rule, shared by the three places that compute what a bin holds.
    requireText(errors, ld4Migration, 'v_baseline_covers_commodity := v_has_inventory and v_inventory.commodity_id = v_commodity;', 'ld4:one-baseline-rule-everywhere')
    // bin_lots finds the baseline that SUPERSEDES by commodity alone. Narrowing that subselect by
    // crop year is the exact shape of the rule this tranche got wrong first time, and it reads as
    // more careful, so it is pinned here rather than left to whoever edits the function next. The
    // other subselect a few lines above, which decides whose BUSHELS the baseline is, does match on
    // the crop year -- correctly, because those are the baseline's own lot. Two questions.
    requireText(errors, ld4Migration, 't.occurred_on > coalesce((select inv.measured_on from inv\n                                                     where inv.commodity_id = lots.commodity_id)', 'ld4:one-baseline-rule-everywhere')
    // Counted, not merely present. Two functions in this migration ask this question -- the lot
    // balance and the crop-year assignment -- and a guard that only asks whether the predicate
    // appears stays green while one of them reverts. That is the fourth time this shape has
    // slipped through on this tranche, so it is counted every time now.
    if ((ld4Migration.split('(not v_baseline_covers_commodity or occurred_on > v_inventory.measured_at::date)').length - 1) !== 2) errors.push('ld4:one-baseline-rule-everywhere')
    {
      const superseded = committedFree.slice(committedFree.indexOf('export function isLotMovementSuperseded'))
      if (superseded.slice(0, superseded.indexOf('}')).includes('crop_year')) errors.push('ld4:one-baseline-rule-everywhere')
    }
    // And the lots are read again after a save, or the next load is picked against stale balances.
    requireText(errors, grainModule, 'if (originBinId) setLotsRefresh((count) => count + 1);', 'ld4:a-save-changes-what-the-bin-holds')

    // "Not answered yet" is not "answered with nothing". While the lot read is in flight the
    // derivation stands in -- the truncated list the repair exists to stop trusting -- so a farmer
    // who saves in that window gets the original defect back. The save waits for a settled answer.
    requireText(errors, grainModule, "if (binLotReady && originBinId && lotsState !== 'ready') {", 'ld4:a-save-waits-for-a-settled-lot-list')

    // The form states the lot it displayed, even when it displayed it as a sentence rather than a
    // picker. Sending nothing let the server resolve the lot a second time at save time, and
    // between the read and the save another device can empty that lot and add a different one --
    // so the ticket would record a crop the screen never named, with no error to notice it by.
    requireText(errors, grainModule, "setDraft((current) => ({ ...current, origin_crop_year: String(only.crop_year), origin_commodity_id: only.commodity_id }));", 'ld4:the-form-states-the-lot-it-showed')
    // And it states it only from a settled list, or it answers from the fallback it exists to replace.
    // BOTH effects that touch the chosen lot wait for a settled list, not just the one that fills
    // it in. The clearing twin guessed around an unsettled list instead, with an early return on an
    // empty one -- so hauling a one-lot bin dry left the emptied year in the draft, resolvable
    // against the recorded list, refused by the server, and unreachable on screen. Counted, because
    // a requireText here stays green with either one of the two gates removed.
    if ((grainModule.split("if (!binLotReady || lotsState !== 'ready' || ticketOutstanding) return;").length - 1) !== 2) errors.push('ld4:the-form-states-the-lot-it-showed')
    // And the hole itself is checked as an absence: an empty list is the case that matters most.
    if (grainModule.includes('originLots.length === 0) return;')) errors.push('ld4:a-crop-year-the-bin-no-longer-offers-is-dropped')
    {
      // The browser fixture answers like public.bin_lots, which KEEPS a lot the bin has emptied, at
      // zero. It filtered those rows out -- the fourth place on this tranche where a stand-in
      // disagreed with the server, and the worst kind: it made a journey written for this very bug
      // pass against the broken code. A fixture that is wrong in the same direction as the code
      // does not test the code, it agrees with it.
      const journeys = read(root, 'tests/e2e/foundation-shell.spec.ts')
      // Scoped to the bin_lots ROUTE, because the save mock beside it narrows to positive lots
      // legitimately -- that is what the server's own default does. Both mock blocks are checked.
      let from = 0
      let routes = 0
      for (;;) {
        const start = journeys.indexOf("url.pathname === '/rest/v1/rpc/bin_lots'", from)
        if (start < 0) break
        routes += 1
        const handler = journeys.slice(start, journeys.indexOf('\n', start))
        if (/bushels\)?\s*>/.test(handler)) errors.push('ld4:the-browser-fixture-answers-like-the-database')
        from = start + 1
      }
      if (routes !== 2) errors.push('ld4:the-browser-fixture-answers-like-the-database')
      // The void fixture answers like void_grain_load too: it used to return `voided` for
      // grain_loads[0] whatever id was asked for, always with an empty blocked_by, so the BLOCKED
      // branch was unreachable in every journey and the round that repaired its lot refresh had no
      // browser coverage. Fifth stand-in on this tranche found disagreeing with the server.
      if ((journeys.split("const target = loads.find((row) => row.id === value.p_load_id)").length - 1) !== 2) errors.push('ld4:the-browser-fixture-answers-like-the-database')
      if ((journeys.split("if (blockers.length) { await fulfillJson(route, { status: 'blocked', load: target, blocked_by: blockers }); return }").length - 1) !== 2) errors.push('ld4:the-browser-fixture-answers-like-the-database')
    }
    // The bin is locked before its lots are read, so this function's lot decision and
    // append_bin_movement's balance check are inside one serialised window.
    requireText(errors, ld4Migration, 'where id = v_origin_bin and farm_id = p_farm_id for update;', 'ld4:the-bin-is-locked-before-its-lots-decide-anything')
    // And that list is read once on the defaulting path: counting and then selecting was two
    // snapshots, and a SELECT INTO over two rows takes whichever came first.
    requireText(errors, ld4Migration, 'select count(*), max(lots.commodity_id), max(lots.crop_year)', 'ld4:the-lot-list-is-read-once-when-it-defaults')

    // A lot the bin has emptied is still a lot it has a record of. The server accepts one when the
    // farmer names it, which is how a ticket that moves nothing is filed against the year it really
    // was -- so the repository must not drop it on the way to the form. Defaulting still uses only
    // what the bin holds, and that narrowing belongs where the load's effects are known.
    if (/\.filter\(\(lot\) => lot\.bushels > 0\.000001\)/.test(read(root, 'src/data/SupabaseGrainRepository.ts'))) errors.push('ld4:an-emptied-lot-can-still-be-named')
    requireText(errors, grainModule, 'const originLots = movesBushels ? onHandLots : recordedLots;', 'ld4:an-emptied-lot-can-still-be-named')
    requireText(errors, grainModule, "const lotsForResolution = draft.origin_crop_year.trim() ? recordedLots : originLots;", 'ld4:an-emptied-lot-can-still-be-named')

    // Everything that can change which lots a bin has takes the same row lock, so counting them and
    // acting on that count cannot be interleaved. Naming a crop year CREATES a lot, so it queues
    // there too -- it locked only the movement row before.
    // Counted: twice, once inside lock_farm_bins and once where naming a crop year takes its bin.
    // Asking only whether the string appears would stay green while the second one went away --
    // the sixth time that shape has slipped through on this tranche.
    if ((ld4Migration.split('perform 1 from public.grain_bins').length - 1) !== 2) errors.push('ld4:everything-that-changes-a-bin-queues-behind-it')
    // And in the SAME ORDER append_bin_movement takes them: bin, then movement row. Two functions
    // taking two locks in opposite orders is a deadlock cycle, and PostgreSQL resolves it by
    // aborting a farmer's save for a reason they can neither see nor act on.
    // One lock order for the module, stated once and used by everything that touches more than one
    // bin. Three review rounds found three deadlocks, each a different pair taken in a different
    // order, because there was no order to follow. Both multi-bin writers call this.
    requireText(errors, ld4Migration, 'create or replace function public.lock_farm_bins(p_farm_id uuid, p_bin_ids uuid[])', 'ld4:one-lock-order-for-the-module')
    if ((ld4Migration.split('perform public.lock_farm_bins(').length - 1) !== 2) errors.push('ld4:one-lock-order-for-the-module')
    requireText(errors, ld4Migration, 'order by id', 'ld4:one-lock-order-for-the-module')
    // And the draft's chosen lot is frozen while a ticket id is outstanding, or a retry can reach
    // the server under a different lot and be refused as a reused id -- for a load already saved.
    requireText(errors, grainModule, 'const [ticketOutstanding, setTicketOutstanding] = useState(false);', 'ld4:an-outstanding-ticket-keeps-its-lot')
    if ((grainModule.split('ticketOutstanding) return;').length - 1) !== 2) errors.push('ld4:an-outstanding-ticket-keeps-its-lot')
    {
      const assign = ld4Migration.slice(ld4Migration.indexOf('function public.assign_bin_movement_crop_year'))
      const binLock = assign.indexOf('perform 1 from public.grain_bins')
      const rowLock = assign.indexOf('where id = p_transaction_id and farm_id = p_farm_id for update')
      if (binLock < 0 || rowLock < 0 || binLock > rowLock) errors.push('ld4:two-locks-are-always-taken-in-one-order')
    }
    {
      // The void is a multi-bin writer too, so it follows the same order: bins, then grain_loads.
      // It took the load row first once, which is the opposite of what save_grain_load does -- a
      // retry of a save holding the bins and waiting for the load row, against a void holding the
      // load row and waiting for the bins, is a deadlock cycle with two farmers in it.
      const voidBody = ld4Migration.slice(ld4Migration.indexOf('function public.void_grain_load'))
      const binLock = voidBody.indexOf('perform public.lock_farm_bins(')
      const rowLock = voidBody.indexOf('where id = p_load_id and farm_id = p_farm_id for update')
      if (binLock < 0 || rowLock < 0 || binLock > rowLock) errors.push('ld4:one-lock-order-for-the-module')
      // And nothing may sit between that select and the check that reads its FOUND. Moving the
      // lock in front of them is what this round did; putting it BETWEEN them is what the previous
      // round did, and FOUND then answered for the perform instead -- every load id looked like it
      // belonged to this farm. No suite noticed, because none had ever asserted the fence.
      if (binLock >= 0 && rowLock >= 0) {
        const fence = voidBody.slice(rowLock, voidBody.indexOf('if not found', rowLock))
        if (/\bperform\b|\bselect\b/i.test(fence)) errors.push('ld4:the-void-fence-reads-its-own-select')
      }
    }
    // The mock answers with every RECORDED lot, as the real function does. A mock that dropped the
    // emptied ones would reject a path production accepts, and no mock-backed test could cover it.
    if (/originBinLots\(workspace, binId\)/.test(read(root, 'src/data/MockGrainRepository.ts'))) errors.push('ld4:the-mock-answers-like-the-database')
    {
      // Checked as an ABSENCE inside listBinLots, not as a string the filter starts with: appending
      // a balance test to that predicate leaves the pinned text intact and reads as compliance.
      // That is the fifth time a requireText on a shared idiom has passed while the rule under it
      // changed, so this one is written the other way round.
      const mock = read(root, 'src/data/MockGrainRepository.ts')
      const body = mock.slice(mock.indexOf('async listBinLots('))
      if (body.slice(0, body.indexOf('\n  }')).includes('bushels >')) errors.push('ld4:the-mock-answers-like-the-database')
      // The derivation moved into recordedBinLots, so the absence check follows it. Left on the
      // mock alone it would have been guarding an empty shell -- green, and checking nothing.
      const recorded = grainData.slice(grainData.indexOf('export function recordedBinLots('))
      if (recorded.slice(0, recorded.indexOf('\n}')).includes('bushels >')) errors.push('ld4:the-mock-answers-like-the-database')
      requireText(errors, mock, 'return [...recordedBinLots(workspace, binId)]', 'ld4:the-mock-answers-like-the-database')
    }
    {
      // LD-4 repair: the mock stands in for save_grain_load, so it resolves a draft against the
      // list THAT function uses. It passed no list at all, and both calls then fell through to
      // binLotsOnHand -- so a ticket-only load naming an emptied lot was refused by the mock while
      // production accepts it, and no mock-backed test could reach the path the round before had
      // just repaired.
      //
      // Written as an ABSENCE of the no-list calls, not as the presence of the two-argument ones.
      // Either call reverting on its own is the bug, and a requireText on one of them stays green
      // while the other goes back -- the seventh time that shape would have slipped through here.
      const mock = read(root, 'src/data/MockGrainRepository.ts')
      const save = mock.slice(mock.indexOf('async saveLoad(id: string, draft: GrainLoadDraft)'))
      const body = save.slice(0, save.indexOf('\n  async '))
      // Both spellings, because the draft the save resolves is now the recovered one and either
      // name dropping its list is the same bug.
      for (const name of ['draft', 'resolvedDraft']) {
        if (body.includes(`validateGrainLoad(${name}, workspace)`)) errors.push('ld4:a-save-resolves-against-the-list-the-server-uses')
        if (body.includes(`loadLotFor(workspace, ${name})`)) errors.push('ld4:a-save-resolves-against-the-list-the-server-uses')
      }
      requireText(errors, body, 'lotsSaveResolvesAgainst(recordedBinLots(workspace, resolvedDraft.origin_grain_bin_id), resolvedDraft)', 'ld4:a-save-resolves-against-the-list-the-server-uses')
      // And the whole sequence is the server's, step for step, because two earlier repairs each
      // fixed one step and broke another:
      //
      //   shape  ->  lot (recovered from the stored load when no year is named)  ->  replay
      //   comparison  ->  save.
      //
      // Positional, because every one of these lines exists whatever the order, and only the order
      // carries the rule.
      const shape = body.indexOf('const shape = validateGrainLoadShape(draft)')
      const recover = body.indexOf('const resolvedDraft = existing && draft.origin_kind')
      const compare = body.indexOf('const same = existing.farm_id === saved.farm_id')
      if (shape < 0 || recover < 0 || compare < 0 || shape > recover || recover > compare) errors.push('ld4:a-save-resolves-against-the-list-the-server-uses')
      // The replay must COMPARE, not just return. An unconditional return was how moving the
      // replay earlier came to bypass validation altogether -- a reused id with a cleared net
      // amount came back as a successful save, where the server refuses it.
      requireText(errors, body, "throw new Error('FARM_RX_LOAD_ID_REUSED')", 'ld4:a-save-resolves-against-the-list-the-server-uses')
      // Every column the server compares, so a field quietly dropped from the check fails here.
      for (const column of ['farm_id', 'load_date', 'origin_kind', 'origin_grain_bin_id', 'origin_crop_assignment_id',
        'destination_kind', 'destination_buyer', 'destination_grain_contract_id', 'destination_grain_bin_id',
        'commodity_id', 'crop_year', 'net_bushels', 'effect_bin_out', 'effect_bin_in',
        'effect_contract_delivery', 'effect_harvest']) {
        if (!body.includes(`existing.${column} === saved.${column}`)) errors.push('ld4:a-save-resolves-against-the-list-the-server-uses')
      }
      // And the rule itself keys on whether a year was NAMED: recorded when it was, on-hand when
      // it was not. Both branches are pinned, because collapsing either one reproduces a bug this
      // tranche has already shipped once in each direction.
      requireText(errors, grainData, "return draft.origin_crop_year.trim()\n    ? recordedLots\n    : recordedLots.filter((lot) => lot.bushels > 0.000001)", 'ld4:a-save-resolves-against-the-list-the-server-uses')
    }
    // And the replay lookup reads INSIDE that lock. Before it, an overlapping retry could read "no
    // such ticket", wait on the lock while the first call emptied the lot, and fail anyway.
    {
      const bin = ld4Migration.slice(ld4Migration.indexOf('if v_origin_bin is null then raise exception'))
      const lock = bin.indexOf('for update;')
      const replay = bin.indexOf('select crop_year, commodity_id into v_replay_year')
      if (lock < 0 || replay < 0 || replay < lock) errors.push('ld4:the-replay-lookup-reads-inside-the-lock')
    }
    {
      // LD-4 repair: the mock's lot balance applies the SAME baseline cutoff the server does --
      // a movement the baseline already measured is not counted a second time. It had no cutoff at
      // all, so an older outbound movement was subtracted twice and the mock refused a crop-year
      // assignment the real assign_bin_movement_crop_year accepts. Third occurrence of the mock
      // disagreeing with the server on this tranche, so it is pinned to the ONE predicate rather
      // than to a copy of the rule: isLotMovementSuperseded is what bin_lots derives through too.
      const mock = read(root, 'src/data/MockGrainRepository.ts')
      const balance = mock.slice(mock.indexOf('function lotBalance('))
      const body = balance.slice(0, balance.indexOf('\n}'))
      requireText(errors, body, '.filter((row) => !isLotMovementSuperseded(baseline, row))', 'ld4:the-mock-balance-uses-the-server-baseline-rule')
      // Written as an absence too: a second, inline copy of the predicate here is the way this
      // would drift back apart, and it would leave the pinned line above perfectly intact.
      if (/measured_at/.test(body)) errors.push('ld4:the-mock-balance-uses-the-server-baseline-rule')
    }
    {
      // LD-4 repair: the lot read verifies the operation context AFTER the response lands, as every
      // other read and write in this repository does. Fencing only before the request leaves a read
      // that is still in flight when the farm, account or access epoch changes free to resolve into
      // the form -- putting the PREVIOUS farm's private bin quantities on screen as lots to haul.
      // A read is not exempt from the epoch fence because it writes nothing.
      //
      // Positional, not textual: the call has to sit after the gateway read, and pinning the string
      // alone would stay green with it moved back above.
      const repository = read(root, 'src/data/SupabaseGrainRepository.ts')
      const lots = repository.slice(repository.indexOf('async listBinLots(binId: string)'))
      const body = lots.slice(0, lots.indexOf('\n  async '))
      const gatewayRead = body.indexOf('await read.call(')
      const fence = body.indexOf('await this.dependencies.verifyOperationContext(context)')
      if (gatewayRead < 0 || fence < 0 || fence < gatewayRead) errors.push('ld4:a-lot-read-is-fenced-after-it-lands')
      // And the queued repository forwards to that writer rather than reaching past it, or the
      // fence above would apply to one caller and not the other.
      requireText(errors, read(root, 'src/data/QueuedGrainRepository.ts'), 'return this.writer.listBinLots(binId)', 'ld4:a-lot-read-is-fenced-after-it-lands')
    }
    {
      // LD-4 repair: the lot freeze is only right while the save's outcome is UNKNOWN. A definitive
      // refusal rolled the transaction back, so no ticket exists, and staying frozen strands the
      // farmer -- the refresh shows the lot that replaced theirs while every retry resubmits the
      // stale one. Pinned as the NEGATION of the codebase's existing transport test, so a second
      // classifier cannot quietly grow here: that is the mistake this tranche has already made.
      requireText(errors, grainModule, "if (!isTransportFailure(error, typeof navigator !== 'undefined' && navigator.onLine === false)) {", 'ld4:a-refused-save-lets-its-lot-go')
      const save = grainModule.slice(grainModule.indexOf('const save = async () => {'))
      const body = save.slice(0, save.indexOf('\n  const voidLoad'))
      const clear = body.indexOf('setTicketOutstanding(false);\n      }')
      const message = body.indexOf('setMessage(farmerError(error, "record this load"));')
      // Before the message, and therefore inside the catch rather than after it.
      if (clear < 0 || message < 0 || clear > message) errors.push('ld4:a-refused-save-lets-its-lot-go')
      // And the ticket id goes with it: a retry that may reuse an id whose load was never written
      // is a new ticket, not a replay.
      requireText(errors, body, 'loadId.current = null;\n        setTicketOutstanding(false);', 'ld4:a-refused-save-lets-its-lot-go')
    }
    // A void puts bushels back, so the lots have to be read again -- the stale answer wins over the
    // workspace refresh and would keep offering one lot where the server now sees two.
    if ((grainModule.split('setLotsRefresh((count) => count + 1);').length - 1) !== 2) errors.push('ld4:a-void-changes-what-the-bin-holds-too')
    {
      // And after ANY attempt, not only a successful one. A BLOCKED void returns before the end of
      // the try block, and a blocked void is exactly the case where something else already moved
      // those bins -- the outcome that most needs a fresh list was the one skipping it. So the
      // refresh has to sit in the finally, which is pinned here by its position: ahead of the lock
      // release that only the finally performs. Counting the string alone stayed green while it sat
      // in the success path, which is how this shipped once already.
      const handler = grainModule.slice(grainModule.indexOf('const voidLoad = async (load: GrainLoad) => {'))
      const voidHandler = handler.slice(0, handler.indexOf('\n  };'))
      const fin = voidHandler.indexOf('} finally {')
      const refresh = voidHandler.indexOf('setLotsRefresh((count) => count + 1);')
      const release = voidHandler.indexOf('lock.current.release();')
      // Between the finally and the release, not merely somewhere ahead of the release: a refresh
      // moved back up into the success path is still before the release, and that is precisely the
      // bug -- so the first way I wrote this guard passed against it.
      if (fin < 0 || refresh < 0 || release < 0 || refresh < fin || refresh > release) errors.push('ld4:a-void-changes-what-the-bin-holds-too')
    }
  }
  {
    // A load's harvest contribution is derived and never written into the replaceable manual total.
    // This reads the migration, because the one place it could go wrong is a well-meaning UPDATE.
    const ld2Migration = read(root, 'supabase/migrations/20260921120000_ld2_load_effects.sql')
    if (/update\s+public\.crop_assignments/i.test(ld2Migration)) errors.push('ld2:a-load-never-writes-the-manual-harvest-total')
    // The lot guard is added ON TOP of the commodity guard, never in place of it: rows written before
    // this migration carry a null crop year and are invisible to the lot figure, so the commodity
    // guard is what still stops a bin being drawn past what is physically in it.
    requireText(errors, ld2Migration, 'this movement would make the bin balance negative', 'ld2:both-negative-balance-guards-are-live')
    requireText(errors, ld2Migration, 'does not hold that many bushels of the %s crop', 'ld2:both-negative-balance-guards-are-live')
    // The compensating movements a void writes are found by link, and marked so a second void does
    // not write them twice.
    requireText(errors, ld2Migration, "'grain_load_void'", 'ld2:a-void-reverses-what-the-load-created')
  }
  {
    // A scale ticket is private financial data and Harvest is a screen a worker without financial
    // access uses every day. The reader is handed to those screens ONLY under that capability, and
    // the decision lives at the composition root so there is one place to check.
    const app = read(root, 'src/App.tsx')
    requireText(errors, app, 'canReadPrivateFinancials ? () => grainServices.grainRepository.listHarvestLoads()', 'ld2:the-loads-read-is-gated-on-financial-access')
    if (/HarvestPage[^>]*grainRepository=/.test(app)) errors.push('ld2:the-loads-read-is-gated-on-financial-access')
  }
  // The Loads tab hides itself until the migration is applied, rather than offering a form that cannot save.
  requireText(errors, grainModule, "workspace.capabilities?.grain_loads !== false", 'ld1:the-tab-waits-for-the-migration')
  requireText(errors, read(root, 'src/data/SupabaseGrainDataGateway.ts'), 'grain_loads: !loadsUnavailable', 'ld1:the-tab-waits-for-the-migration')
  // Every tab in the header must be a tab the router will actually open. These are two lists that have
  // to agree, and LD-1 added a tab to one of them: the header offered Loads and the route fell through
  // to Overview. Pinning the pair means the next tab cannot repeat it.
  {
    const tabList = grainModule.slice(grainModule.indexOf('const GRAIN_TABS = ['), grainModule.indexOf('];', grainModule.indexOf('const GRAIN_TABS = [')))
    const routerList = grainModule.slice(grainModule.indexOf('const tabPath = ['), grainModule.indexOf('].includes(rawTab)'))
    const slugs = [...tabList.matchAll(/slug: "([^"]*)"/g)].map((match) => match[1]).filter((slug) => slug !== '')
    if (slugs.length === 0 || slugs.some((slug) => !routerList.includes(`"${slug}"`))) errors.push('grain:every-tab-has-a-route')
  }
  // Bounded and newest-first, so a hauling season cannot push the current tickets past PostgREST's cap.
  {
    // Two reads of grain_loads are bounded now: the workspace's recent tickets and LD-2's harvest
    // contributions. Counting rather than merely finding one is the point -- with a single
    // requireText, dropping the bound from either read still left the other to satisfy it.
    const gateway = read(root, 'src/data/SupabaseGrainDataGateway.ts')
    requireText(errors, gateway, '.limit(RECENT_GRAIN_LOAD_LIMIT)', 'ld1:the-newest-tickets-are-the-ones-loaded')
    // The harvest read is a SUM, not a display list, so it does not share the display cap. It asks
    // for one row past its own bound precisely so a truncated answer can be told from a full one:
    // a figure that is quietly short would let "Use load total" overwrite a typed harvest with a
    // partial total. Codex found this on PR #51 after it merged.
    requireText(errors, gateway, '.limit(HARVEST_LOAD_SUM_LIMIT + 1)', 'ld2:a-summed-figure-says-when-it-is-short')
    const harvestModule = read(root, 'src/HarvestModule.tsx')
    requireText(errors, harvestModule, 'canEdit && loadsComplete && !confirming', 'ld2:a-summed-figure-says-when-it-is-short')
    // While the migration is not applied the load form shows no effects and says the save records
    // only the ticket. The flags underneath still default to ticked, so what is SENT has to be
    // cleared too -- otherwise a page left open across the migration performs effects unseen.
    requireText(errors, grainModule, 'effectsReady\n        ? draft', 'ld2:a-hidden-effect-is-never-sent')
  }
  // Six of grain_loads' seven foreign keys shipped with no covering index, because the indexes were
  // written farm-first the way the app queries rather than key-first the way `on delete restrict`
  // checks. The 0043 advisor rule wants each key's own columns leading, in the order the constraint
  // declares them, with no partial predicate -- and 0043 is a PowerShell lane, so nothing runnable on
  // a development machine saw it until CI did. Pin the leading columns and the predicate ban here;
  // section 14 of scripts/sql/ld1-grain-loads-assertions.sql proves the same rule against a catalog.
  for (const leading of [
    'create index grain_loads_commodity_idx on public.grain_loads (commodity_id, farm_id)',
    'create index grain_loads_truck_idx on public.grain_loads (truck_equipment_id, farm_id)',
    'create index grain_loads_origin_bin_idx on public.grain_loads (origin_grain_bin_id, farm_id',
    'create index grain_loads_destination_bin_idx on public.grain_loads (destination_grain_bin_id, farm_id',
    'create index grain_loads_origin_crop_idx on public.grain_loads (origin_crop_assignment_id, farm_id)',
    'create index grain_loads_destination_contract_idx on public.grain_loads (destination_grain_contract_id, farm_id',
  ]) requireText(errors, ld1Migration, leading, 'ld1:every-foreign-key-has-a-covering-index')
  if (/create index[^;]*on public\.grain_loads[^;]*\bwhere\b/i.test(ld1Migration)) errors.push('ld1:every-foreign-key-has-a-covering-index')
  return errors
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const errors = foundationStaticGuard(process.argv[2] ? resolve(process.argv[2]) : process.cwd())
  if (errors.length) { console.error(`Foundation static guard failed: ${errors.join(', ')}`); process.exit(1) }
  console.log('Foundation static guards: PASS')
}
