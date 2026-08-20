$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$manifestPath=Join-Path $root 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json'
function Get-Cw2Sha256([byte[]]$Bytes){$sha=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}

function Invoke-Cw2ArtifactGitPathList([string[]]$Arguments,[string]$FailureMarker) {
  $output=@(& git -C $root @Arguments 2>&1);$exitCode=$LASTEXITCODE
  if($exitCode-ne0){$detail=($output|ForEach-Object{$_.ToString()}|Where-Object{$_}|Select-Object -First 1);throw "$FailureMarker:exit=$exitCode:detail=$detail"}
  @($output|ForEach-Object{$_.ToString()}|Where-Object{$_})
}

function Get-Cw2ArtifactCanonicalManifest([switch]$ForceCleanFallback) {
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal);$paths=[Collections.Generic.List[string]]::new()
  if(-not$ForceCleanFallback){
    foreach($path in (Invoke-Cw2ArtifactGitPathList @('diff','--name-only') 'FAKETIME_ARTIFACT_MANIFEST_DIRTY_DIFF_GIT_FAILED')){if($seen.Add($path.Replace('\','/'))){[void]$paths.Add($path.Replace('\','/'))}}
    foreach($path in (Invoke-Cw2ArtifactGitPathList @('ls-files','--others','--exclude-standard') 'FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_GIT_FAILED')){if($seen.Add($path.Replace('\','/'))){[void]$paths.Add($path.Replace('\','/'))}}
  }
  $source='dirty-changed-untracked'
  if($paths.Count-eq0){
    foreach($path in (Invoke-Cw2ArtifactGitPathList @('diff-tree','--no-commit-id','--name-only','-r','HEAD^','HEAD') 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_GIT_FAILED')){if($seen.Add($path.Replace('\','/'))){[void]$paths.Add($path.Replace('\','/'))}}
    if($paths.Count-eq0){throw 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY'}
    $source='exact-previous-commit-diff'
  }
  $paths.Sort([StringComparer]::Ordinal)
  $lines=[Collections.Generic.List[string]]::new();foreach($path in $paths){$bytes=[IO.File]::ReadAllBytes((Join-Path $root $path));$hash=Get-Cw2Sha256 $bytes;[void]$lines.Add("$path|$hash")}
  $utf8=[Text.UTF8Encoding]::new($false);$canonical=[string]::Join("`n",$lines)+"`n";$aggregate=Get-Cw2Sha256 $utf8.GetBytes($canonical)
  [pscustomobject]@{Lines=$lines;Aggregate=$aggregate;Canonical=$canonical;Source=$source}
}

$manifest=Get-Content -Raw -LiteralPath $manifestPath|ConvertFrom-Json
if($manifest.combined_source_artifact_identity_recipe-notmatch'StringComparer\.Ordinal' -or $manifest.combined_source_artifact_identity_recipe-notmatch'LF final'){throw 'FAKETIME_ARTIFACT_MANIFEST_RECIPE_TEXT_DRIFT'}
$ordering=[Collections.Generic.List[string]]::new([string[]]@('a','B'));$ordering.Sort([StringComparer]::Ordinal);if(($ordering-join'|')-cne'B|a'){throw 'FAKETIME_ARTIFACT_MANIFEST_ORDINAL_COMPARATOR_DRIFT'}
$canonical=Get-Cw2ArtifactCanonicalManifest
if(-not$canonical.Canonical.EndsWith("`n")-or$canonical.Lines.Count-eq0-or$canonical.Aggregate-notmatch'^[0-9a-f]{64}$'){throw 'FAKETIME_ARTIFACT_MANIFEST_CANONICALIZATION_DRIFT'}
$cleanFallback=Get-Cw2ArtifactCanonicalManifest -ForceCleanFallback
if($cleanFallback.Source-cne'exact-previous-commit-diff'-or$cleanFallback.Lines.Count-eq0-or-not$cleanFallback.Canonical.EndsWith("`n")){throw 'FAKETIME_ARTIFACT_MANIFEST_CLEAN_FALLBACK_PROOF_FAILED'}
Write-Output "FAKETIME_ARTIFACT_REPLACEMENT_CLEAN_FALLBACK_PASS aggregate=$($cleanFallback.Aggregate) paths=$($cleanFallback.Lines.Count)"
Write-Output "FAKETIME_ARTIFACT_REPLACEMENT_CANONICAL_MANIFEST_PASS source=$($canonical.Source) aggregate=$($canonical.Aggregate) paths=$($canonical.Lines.Count)"
