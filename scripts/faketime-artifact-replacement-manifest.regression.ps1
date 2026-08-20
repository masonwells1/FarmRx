$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$manifestPath=Join-Path $root 'docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json'
function Get-Cw2Sha256([byte[]]$Bytes){$sha=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}

function Get-Cw2ArtifactCanonicalManifest {
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal);$paths=[Collections.Generic.List[string]]::new()
  foreach($path in (& git -C $root diff --name-only -z|ForEach-Object{$_-split"`0"})){if($path -and $seen.Add($path.Replace('\','/'))){[void]$paths.Add($path.Replace('\','/'))}}
  foreach($path in (& git -C $root ls-files --others --exclude-standard -z|ForEach-Object{$_-split"`0"})){if($path -and $seen.Add($path.Replace('\','/'))){[void]$paths.Add($path.Replace('\','/'))}}
  $paths.Sort([StringComparer]::Ordinal)
  $lines=[Collections.Generic.List[string]]::new();foreach($path in $paths){$bytes=[IO.File]::ReadAllBytes((Join-Path $root $path));$hash=Get-Cw2Sha256 $bytes;[void]$lines.Add("$path|$hash")}
  $utf8=[Text.UTF8Encoding]::new($false);$canonical=[string]::Join("`n",$lines)+"`n";$aggregate=Get-Cw2Sha256 $utf8.GetBytes($canonical)
  [pscustomobject]@{Lines=$lines;Aggregate=$aggregate;Canonical=$canonical}
}

$manifest=Get-Content -Raw -LiteralPath $manifestPath|ConvertFrom-Json
if($manifest.combined_source_artifact_identity_recipe-notmatch'StringComparer\.Ordinal' -or $manifest.combined_source_artifact_identity_recipe-notmatch'LF final'){throw 'FAKETIME_ARTIFACT_MANIFEST_RECIPE_TEXT_DRIFT'}
$ordering=[Collections.Generic.List[string]]::new([string[]]@('a','B'));$ordering.Sort([StringComparer]::Ordinal);if(($ordering-join'|')-cne'B|a'){throw 'FAKETIME_ARTIFACT_MANIFEST_ORDINAL_COMPARATOR_DRIFT'}
$canonical=Get-Cw2ArtifactCanonicalManifest
if(-not$canonical.Canonical.EndsWith("`n")-or$canonical.Lines.Count-eq0-or$canonical.Aggregate-notmatch'^[0-9a-f]{64}$'){throw 'FAKETIME_ARTIFACT_MANIFEST_CANONICALIZATION_DRIFT'}
Write-Output "FAKETIME_ARTIFACT_REPLACEMENT_CANONICAL_MANIFEST_PASS aggregate=$($canonical.Aggregate) paths=$($canonical.Lines.Count)"
