param([switch]$ControlFlowChild,[string]$RepositoryRoot,[ValidateSet('Stop','Continue')][string]$InitialErrorActionPreference='Stop')
$ErrorActionPreference=$InitialErrorActionPreference
if(-not$ControlFlowChild-and-not[string]::IsNullOrWhiteSpace($RepositoryRoot)){throw 'FAKETIME_ARTIFACT_MANIFEST_REPOSITORY_ROOT_ONLY_ALLOWED_FOR_PROOF_CHILD'}
$root=Split-Path -Parent $PSScriptRoot
if($ControlFlowChild){if([string]::IsNullOrWhiteSpace($RepositoryRoot)-or-not[IO.Path]::IsPathRooted($RepositoryRoot)){throw 'FAKETIME_ARTIFACT_MANIFEST_PROOF_CHILD_REPOSITORY_ROOT_REQUIRED'};$root=[IO.Path]::GetFullPath($RepositoryRoot)}
$gitCommand=if($env:OS -eq 'Windows_NT'){'git.exe'}else{'git'}
$gitCommands=@(Get-Command $gitCommand -CommandType Application -ErrorAction Stop)
if($gitCommands.Count-lt1){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_EXE_MISSING'}
$gitExe=[IO.Path]::GetFullPath($gitCommands[0].Source)
$manifestPath=Join-Path $root 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json'
function Get-Cw2Sha256([byte[]]$Bytes){$sha=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}

function Invoke-Cw2ArtifactGitPathList([string[]]$Arguments,[string]$FailureMarker) {
  $previousErrorActionPreference=$ErrorActionPreference
  try{$ErrorActionPreference='Continue';$output=@(& $gitExe -C $root @Arguments 2>&1);$exitCode=$LASTEXITCODE}finally{$ErrorActionPreference=$previousErrorActionPreference}
  if($exitCode-ne0){$detail=($output|ForEach-Object{$_.ToString()}|Where-Object{$_}|Select-Object -First 1);throw "${FailureMarker}:exit=${exitCode}:detail=${detail}"}
  $joined=[string]::Concat([string[]]@($output|ForEach-Object{$_.ToString()}))
  @($joined.Split([char[]]@([char]0),[StringSplitOptions]::RemoveEmptyEntries))
}

function Get-Cw2ArtifactCanonicalManifest([switch]$ForceCleanFallback) {
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal);$paths=[Collections.Generic.List[string]]::new()
  if(-not$ForceCleanFallback){
    foreach($dirtyPath in (Invoke-Cw2ArtifactGitPathList @('diff','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_DIRTY_DIFF_GIT_FAILED')){$dirtyNormalized=$dirtyPath.Replace('\','/');if(-not(Test-Path -LiteralPath (Join-Path $root $dirtyPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_DIRTY_PATH_MISSING:$dirtyPath"};if($seen.Add($dirtyNormalized)){[void]$paths.Add($dirtyNormalized)}}
    foreach($stagedPath in (Invoke-Cw2ArtifactGitPathList @('diff','--cached','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_STAGED_DIFF_GIT_FAILED')){$stagedNormalized=$stagedPath.Replace('\','/');if(-not(Test-Path -LiteralPath (Join-Path $root $stagedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_STAGED_PATH_MISSING:$stagedPath"};if($seen.Add($stagedNormalized)){[void]$paths.Add($stagedNormalized)}}
    foreach($untrackedPath in (Invoke-Cw2ArtifactGitPathList @('ls-files','--others','--exclude-standard','-z') 'FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_GIT_FAILED')){$untrackedNormalized=$untrackedPath.Replace('\','/');if(-not(Test-Path -LiteralPath (Join-Path $root $untrackedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_PATH_MISSING:$untrackedPath"};if($seen.Add($untrackedNormalized)){[void]$paths.Add($untrackedNormalized)}}
  }
  $source='dirty-changed-untracked'
  if($paths.Count-eq0){
    foreach($previousPath in (Invoke-Cw2ArtifactGitPathList @('diff-tree','--no-commit-id','--name-only','-r','-z','HEAD^','HEAD') 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_GIT_FAILED')){$previousNormalized=$previousPath.Replace('\','/');if(-not(Test-Path -LiteralPath (Join-Path $root $previousPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_PATH_MISSING:$previousPath"};if($seen.Add($previousNormalized)){[void]$paths.Add($previousNormalized)}}
    if($paths.Count-eq0){throw 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY'}
    $source='exact-previous-commit-diff'
  }
  $paths.Sort([StringComparer]::Ordinal)
  $lines=[Collections.Generic.List[string]]::new();foreach($path in $paths){$bytes=[IO.File]::ReadAllBytes((Join-Path $root $path));$hash=Get-Cw2Sha256 $bytes;[void]$lines.Add("$path|$hash")}
  $utf8=[Text.UTF8Encoding]::new($false);$canonical=[string]::Join("`n",$lines)+"`n";$aggregate=Get-Cw2Sha256 $utf8.GetBytes($canonical)
  [pscustomobject]@{Lines=$lines;Aggregate=$aggregate;Canonical=$canonical;Source=$source}
}

function Get-Cw2ForcedGitFailureAstContract([string]$Source) {
  $tokens=$null;$parseErrors=$null
  $ast=[System.Management.Automation.Language.Parser]::ParseInput($Source,[ref]$tokens,[ref]$parseErrors)
  if($parseErrors.Count-ne0){return [pscustomobject]@{Valid=$false;TryStart=-1;TryLength=0}}
  $forcedCalls=@($ast.FindAll({param($node)
    $node-is[System.Management.Automation.Language.CommandAst]-and
    $node.GetCommandName()-ceq'Invoke-Cw2ArtifactGitPathList'-and
    $node.CommandElements.Count-eq3-and
    $node.CommandElements[1].Extent.Text-ceq'@(''rev-parse'',''--verify'',$forcedGitMissingRef)'-and
    $node.CommandElements[2].Extent.Text-ceq"'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE'"
  },$true))
  $assignments=@($ast.FindAll({param($node)$node-is[System.Management.Automation.Language.AssignmentStatementAst]-and$node.Left.Extent.Text-ceq'$forcedGitFailure'},$true))
  $exitAssignments=@($ast.FindAll({param($node)$node-is[System.Management.Automation.Language.AssignmentStatementAst]-and$node.Left.Extent.Text-ceq'$forcedGitExit'},$true))
  if($forcedCalls.Count-ne1-or$assignments.Count-ne2-or$assignments[0].Extent.Text-cne'$forcedGitFailure=$null'-or$assignments[1].Extent.Text-cne'$forcedGitFailure=$_.Exception.Message'-or$exitAssignments.Count-ne2-or$exitAssignments[0].Extent.Text-cne'$forcedGitExit=$null'-or$exitAssignments[1].Extent.Text-cne'$forcedGitExit=$LASTEXITCODE'){
    return [pscustomobject]@{Valid=$false;TryStart=-1;TryLength=0}
  }
  $forcedTry=$forcedCalls[0].Parent
  while($null-ne$forcedTry-and$forcedTry-isnot[System.Management.Automation.Language.TryStatementAst]){$forcedTry=$forcedTry.Parent}
  $outerTry=$null
  if($null-ne$forcedTry-and$forcedTry.Parent-is[System.Management.Automation.Language.StatementBlockAst]){$outerTry=$forcedTry.Parent.Parent}
  $topLevel=$outerTry-is[System.Management.Automation.Language.TryStatementAst]-and$outerTry.Parent-is[System.Management.Automation.Language.NamedBlockAst]-and[object]::ReferenceEquals($outerTry.Parent.Parent,$ast)
  $exactTry=$topLevel-and$forcedTry.CatchClauses.Count-eq1-and$null-eq$forcedTry.Finally-and$forcedTry.Body.Statements.Count-eq1-and$forcedTry.CatchClauses[0].Body.Statements.Count-eq2-and$outerTry.Finally.Statements.Count-gt0
  $tryStart=-1;$tryLength=0
  if($null-ne$forcedTry){$tryStart=$forcedTry.Extent.StartOffset;$tryLength=$forcedTry.Extent.EndOffset-$forcedTry.Extent.StartOffset}
  [pscustomobject]@{Valid=[bool]$exactTry;TryStart=$tryStart;TryLength=$tryLength}
}

function Invoke-Cw2ForcedGitFailureControlFlowProof([string]$Source,[pscustomobject]$Contract) {
  if(-not$Contract.Valid-or$Contract.TryStart-lt0-or$Contract.TryLength-le0){throw 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_BASELINE_FAILED'}
  $tryText=$Source.Substring($Contract.TryStart,$Contract.TryLength)
  $synthetic="'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=1:detail='+'synthetic'"
  $deadSource=$Source.Substring(0,$Contract.TryStart)+"if(`$false){$tryText};`$forcedGitFailure=$synthetic"+$Source.Substring($Contract.TryStart+$Contract.TryLength)
  $syntheticSource=$Source.Substring(0,$Contract.TryStart+$Contract.TryLength)+"`n`$forcedGitFailure=$synthetic"+$Source.Substring($Contract.TryStart+$Contract.TryLength)
  $cases=@(
    [pscustomobject]@{Name='baseline-stop';Source=$Source;Preference='Stop';ExpectedExit=0},
    [pscustomobject]@{Name='baseline-continue';Source=$Source;Preference='Continue';ExpectedExit=0},
    [pscustomobject]@{Name='dead-call-with-synthetic-result';Source=$deadSource;Preference='Stop';ExpectedExit=1},
    [pscustomobject]@{Name='synthetic-result-after-call';Source=$syntheticSource;Preference='Continue';ExpectedExit=1}
  )
  $expectedNames=@('baseline-stop','baseline-continue','dead-call-with-synthetic-result','synthetic-result-after-call')
  if($cases.Count-ne4-or[string]::Join('|',[string[]]$cases.Name)-cne[string]::Join('|',$expectedNames)){throw 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_CASES_INVALID'}
  $powershellExe=if($env:OS -eq 'Windows_NT'){(Get-Command powershell.exe -CommandType Application -ErrorAction Stop).Source}else{(Get-Command pwsh -CommandType Application -ErrorAction Stop).Source}
  $tempRoot=Join-Path ([IO.Path]::GetTempPath())("farmrx-cw2-artifact-git-ast-$([guid]::NewGuid().ToString('N'))")
  [void][IO.Directory]::CreateDirectory($tempRoot)
  $paths=[Collections.Generic.List[string]]::new();$primary=$null;$cleanupErrors=[Collections.Generic.List[Exception]]::new()
  try{
    foreach($case in $cases){
      $path=Join-Path $tempRoot("$($case.Name).ps1");$paths.Add($path)
      [IO.File]::WriteAllText($path,$case.Source,[Text.UTF8Encoding]::new($false))
      $savedPreference=$ErrorActionPreference
      try{$ErrorActionPreference='Continue';$output=@(&$powershellExe -NoProfile -ExecutionPolicy Bypass -File $path -ControlFlowChild -RepositoryRoot $root -InitialErrorActionPreference $case.Preference 2>&1);$exitCode=$LASTEXITCODE}finally{$ErrorActionPreference=$savedPreference}
      $text=[string]::Join("`n",[string[]]$output)
      if($case.ExpectedExit-eq0){
        $traceIndex=$text.IndexOf('FAKETIME_ARTIFACT_REPLACEMENT_GIT_TRACE_OBSERVATION_PASS',[StringComparison]::Ordinal);$eapIndex=$text.IndexOf('FAKETIME_ARTIFACT_REPLACEMENT_GIT_EAP_RESTORE_PASS',[StringComparison]::Ordinal);$failureIndex=$text.IndexOf('FAKETIME_ARTIFACT_REPLACEMENT_GIT_FAILURE_CAPTURE_PASS',[StringComparison]::Ordinal)
        if($exitCode-ne0-or[regex]::Matches($text,'(?m)^FAKETIME_ARTIFACT_REPLACEMENT_GIT_TRACE_OBSERVATION_PASS$').Count-ne1-or[regex]::Matches($text,'(?m)^FAKETIME_ARTIFACT_REPLACEMENT_GIT_EAP_RESTORE_PASS$').Count-ne1-or[regex]::Matches($text,'(?m)^FAKETIME_ARTIFACT_REPLACEMENT_GIT_FAILURE_CAPTURE_PASS$').Count-ne1-or$traceIndex-lt0-or$eapIndex-le$traceIndex-or$failureIndex-le$eapIndex){throw "FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_BASELINE_CHILD_FAILED:$exitCode"}
      }
      elseif($exitCode-eq0){throw "FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_MUTATION_SURVIVED:$($case.Name)"}
    }
  }catch{$primary=$_.Exception}
  finally{
    foreach($path in $paths){
      try{if([IO.File]::Exists($path)){[IO.File]::Delete($path)};if([IO.File]::Exists($path)){throw "FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_TEMP_REMAINS:$path"}}
      catch{$cleanupErrors.Add($_.Exception)}
    }
    try{if([IO.Directory]::Exists($tempRoot)){[IO.Directory]::Delete($tempRoot,$false)};if([IO.Directory]::Exists($tempRoot)){throw "FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_TEMP_ROOT_REMAINS:$tempRoot"}}
    catch{$cleanupErrors.Add($_.Exception)}
  }
  if($null-ne$primary-and$cleanupErrors.Count-gt0){throw [AggregateException]::new('FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_PRIMARY_AND_CLEANUP_FAILED',[Exception[]]@($primary)+[Exception[]]$cleanupErrors.ToArray())}
  if($null-ne$primary){throw $primary}
  if($cleanupErrors.Count-gt0){throw [AggregateException]::new('FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_CLEANUP_FAILED',[Exception[]]$cleanupErrors.ToArray())}
  Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_AST_CHILD_PROOF_PASS'
}

$manifest=Get-Content -Raw -LiteralPath $manifestPath|ConvertFrom-Json
if($manifest.combined_source_artifact_identity_recipe-notmatch'StringComparer\.Ordinal'-or$manifest.combined_source_artifact_identity_recipe-notmatch'LF final'-or$manifest.combined_source_artifact_identity_recipe-notmatch'NUL-delimited dirty tracked, staged, and untracked existing source'-or$manifest.combined_source_artifact_identity_recipe-notmatch'refusing missing/deleted paths'){throw 'FAKETIME_ARTIFACT_MANIFEST_RECIPE_TEXT_DRIFT'}
$ordering=[Collections.Generic.List[string]]::new([string[]]@('a','B'));$ordering.Sort([StringComparer]::Ordinal);if(($ordering-join'|')-cne'B|a'){throw 'FAKETIME_ARTIFACT_MANIFEST_ORDINAL_COMPARATOR_DRIFT'}
$expectedErrorActionPreference=$ErrorActionPreference
$canonical=Get-Cw2ArtifactCanonicalManifest
if(-not$canonical.Canonical.EndsWith("`n")-or$canonical.Lines.Count-eq0-or$canonical.Aggregate-notmatch'^[0-9a-f]{64}$'){throw 'FAKETIME_ARTIFACT_MANIFEST_CANONICALIZATION_DRIFT'}
$cleanFallback=Get-Cw2ArtifactCanonicalManifest -ForceCleanFallback
if($cleanFallback.Source-cne'exact-previous-commit-diff'-or$cleanFallback.Lines.Count-eq0-or-not$cleanFallback.Canonical.EndsWith("`n")){throw 'FAKETIME_ARTIFACT_MANIFEST_CLEAN_FALLBACK_PROOF_FAILED'}
if($ErrorActionPreference-cne$expectedErrorActionPreference){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_SUCCESS_EAP_RESTORE_FAILED'}
$forcedGitNonce=[guid]::NewGuid().ToString('N')
$forcedGitMissingRef="refs/heads/cw2-forced-missing-$forcedGitNonce"
$forcedGitTracePath=Join-Path ([IO.Path]::GetTempPath())("farmrx-cw2-git-trace-$forcedGitNonce.jsonl")
$traceEnvironmentWasPresent=Test-Path Env:GIT_TRACE2_EVENT
$previousTraceEnvironment=$env:GIT_TRACE2_EVENT
$forcedGitFailure=$null
$forcedGitExit=$null;$tracePrimary=$null;$traceCleanupErrors=[Collections.Generic.List[Exception]]::new()
try{
  $env:GIT_TRACE2_EVENT=$forcedGitTracePath
  try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE}
  if($forcedGitFailure-notmatch'^FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=([1-9][0-9]*):detail=.+$'){throw "FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_CAPTURE_PROOF_FAILED:$forcedGitFailure"}
  $capturedExit=[int]$Matches[1]
  if($null-eq$forcedGitExit-or$forcedGitExit-ne$capturedExit){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_EXIT_CAPTURE_DRIFT'}
  if(-not[IO.File]::Exists($forcedGitTracePath)){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_TRACE_MISSING'}
  $traceEvents=@([IO.File]::ReadAllLines($forcedGitTracePath)|ForEach-Object{$_|ConvertFrom-Json})
  $matchingStarts=@($traceEvents|Where-Object{$_.event-ceq'start'-and$_.argv.Count-ge5-and$_.argv[$_.argv.Count-5]-ceq'-C'-and[IO.Path]::GetFullPath([string]$_.argv[$_.argv.Count-4])-ceq$root-and$_.argv[$_.argv.Count-3]-ceq'rev-parse'-and$_.argv[$_.argv.Count-2]-ceq'--verify'-and$_.argv[$_.argv.Count-1]-ceq$forcedGitMissingRef})
  $matchingExits=@($traceEvents|Where-Object{$_.event-ceq'exit'-and[int]$_.code-eq$capturedExit})
  if($matchingStarts.Count-ne1-or$matchingExits.Count-ne1){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_TRACE_EXACT_INVOCATION_MISSING'}
}catch{$tracePrimary=$_.Exception}
finally{
  try{if($traceEnvironmentWasPresent){$env:GIT_TRACE2_EVENT=$previousTraceEnvironment}else{Remove-Item -LiteralPath Env:GIT_TRACE2_EVENT -ErrorAction SilentlyContinue}}catch{$traceCleanupErrors.Add($_.Exception)}
  try{if([IO.File]::Exists($forcedGitTracePath)){[IO.File]::Delete($forcedGitTracePath)};if([IO.File]::Exists($forcedGitTracePath)){throw "FAKETIME_ARTIFACT_MANIFEST_GIT_TRACE_REMAINS:$forcedGitTracePath"}}catch{$traceCleanupErrors.Add($_.Exception)}
  try{$traceEnvironmentIsPresent=Test-Path Env:GIT_TRACE2_EVENT;if($traceEnvironmentIsPresent-ne$traceEnvironmentWasPresent-or($traceEnvironmentWasPresent-and$env:GIT_TRACE2_EVENT-cne$previousTraceEnvironment)){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_TRACE_ENV_RESTORE_FAILED'}}catch{$traceCleanupErrors.Add($_.Exception)}
}
if($null-ne$tracePrimary-and$traceCleanupErrors.Count-gt0){throw [AggregateException]::new('FAKETIME_ARTIFACT_MANIFEST_GIT_TRACE_PRIMARY_AND_CLEANUP_FAILED',[Exception[]]@($tracePrimary)+[Exception[]]$traceCleanupErrors.ToArray())}
if($null-ne$tracePrimary){throw$tracePrimary}
if($traceCleanupErrors.Count-gt0){throw [AggregateException]::new('FAKETIME_ARTIFACT_MANIFEST_GIT_TRACE_CLEANUP_FAILED',[Exception[]]$traceCleanupErrors.ToArray())}
if($ErrorActionPreference-cne$expectedErrorActionPreference){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_EAP_RESTORE_FAILED'}
$selfSource=[IO.File]::ReadAllText($PSCommandPath)
$forcedGitAstContract=Get-Cw2ForcedGitFailureAstContract $selfSource
if(-not$forcedGitAstContract.Valid){throw 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_CONTRACT_FAILED'}
Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_TRACE_OBSERVATION_PASS'
Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_EAP_RESTORE_PASS'
Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_FAILURE_CAPTURE_PASS'
if(-not$ControlFlowChild){Invoke-Cw2ForcedGitFailureControlFlowProof $selfSource $forcedGitAstContract}
Write-Output "FAKETIME_ARTIFACT_REPLACEMENT_CLEAN_FALLBACK_PASS aggregate=$($cleanFallback.Aggregate) paths=$($cleanFallback.Lines.Count)"
Write-Output "FAKETIME_ARTIFACT_REPLACEMENT_CANONICAL_MANIFEST_PASS source=$($canonical.Source) aggregate=$($canonical.Aggregate) paths=$($canonical.Lines.Count)"
