$ErrorActionPreference='Stop';. (Join-Path $PSScriptRoot 'maple-faketime-artifact-bootstrap-plan.ps1')
function A($v,$m){if(-not$v){throw $m}}
$plan=New-MapleFaketimeArtifactBootstrapPlan ([guid]'11111111-2222-4333-8444-555555555555');A(Assert-MapleFaketimeArtifactBootstrapPlan $plan)'valid plan refused';A(-not$plan.Executable-and$null-eq$plan.ExpectedImageId)'invented artifact image id';A($null-eq$plan.SourceImage.ObservedLocalRepoDigests-and$null-eq$plan.SourceImage.ObservedLocalImageId-and$plan.SourceImage.ExecutionTimeInspectRequired)'source observation overclaimed';A(-not$plan.NetworkPackageBootstrap.ReproducibleSourceClaimed-and$plan.NetworkPackageBootstrap.Limitation-match'apt repository state is mutable')'apt limitation absent'
$root=Split-Path $PSScriptRoot -Parent;$artifact=Get-Content -Raw (Join-Path $root 'tests/season/faketime-artifacts.Dockerfile')
function Assert-ArtifactDockerfile([string]$Text){
  $logical=@((($Text-replace'\\\r?\n\s*',' ') -split'\r?\n'|ForEach-Object{($_.Trim()-replace'\s+',' ')}|Where-Object{$_}))
  $from=@($logical|Where-Object{$_-match'^FROM '});if($from.Count-ne2){throw 'stage count drift'}
  $scratchIndex=[array]::IndexOf([object[]]$logical,($logical|Where-Object{$_-ceq'FROM scratch'}|Select-Object -First 1));if($scratchIndex-lt0){throw 'scratch stage missing'}
  $build=@($logical|Select-Object -First $scratchIndex);$final=@($logical|Select-Object -Skip $scratchIndex)
  if($build.Count-ne3-or$build[0]-cne'FROM debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818 AS build'-or$build[1]-cne'COPY tests/season/clear-ld-preload.c /tmp/clear-ld-preload.c'-or$build[2]-notmatch'^RUN apt-get update .*apt-get install -y --no-install-recommends libfaketime=0.9.10-2.1 gcc libc6-dev .*gcc -shared -fPIC -O2'){throw 'bootstrap stage drift'}
  $expected=@('FROM scratch','LABEL farmrx.synthetic-owner="maple-faketime-bootstrap" farmrx.synthetic-role="faketime-artifacts" farmrx.source-digest="debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818" farmrx.package-contract="libfaketime=0.9.10-2.1;gcc;libc6-dev"','COPY --from=build /usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1 /artifacts/libfaketime.so.1','COPY --from=build /tmp/libclear-ld-preload.so /artifacts/libclear-ld-preload.so')
  if(($final|ConvertTo-Json -Compress)-cne($expected|ConvertTo-Json -Compress)){throw 'scratch artifact stage not exact'}
  $true
}
A(Assert-ArtifactDockerfile $artifact)'artifact Dockerfile refused'
$textMutations=@(
  @{N='faketime source';Old='/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1';New='/wrong/libfaketime.so.1'},
  @{N='faketime destination';Old='/artifacts/libfaketime.so.1';New='/artifacts/wrong-faketime.so.1'},
  @{N='clear source';Old='/tmp/libclear-ld-preload.so';New='/tmp/wrong-clear.so'},
  @{N='clear destination';Old='/artifacts/libclear-ld-preload.so';New='/artifacts/wrong-clear.so'},
  @{N='source digest label';Old='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';New='debian@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}
)
foreach($m in $textMutations){$bad=$artifact.Replace($m.Old,$m.New);$refused=$false;try{Assert-ArtifactDockerfile $bad|Out-Null}catch{$refused=$true};A($refused)("Dockerfile mutation accepted: "+$m.N)}
A($null-eq$plan.ExpectedImageId-and-not$plan.FrozenOfflineBuild.Resolved-and$plan.FrozenOfflineBuild.RequiresArtifactImageId)'future frozen build was treated as ready'
A(($plan.FrozenOfflineBuild.ArgvTemplate-join'|')-ceq'build|--no-cache|--network=none|--pull=false|--build-arg|BASE_IMAGE=<verified-local-digest-ref>|--build-arg|FAKETIME_ARTIFACTS_IMAGE=<preinspected-local-artifact-tag>|-f|tests/season/frozen-postgres-clock-spike.Dockerfile|-t|<synthetic-derived-tag>|.'-and$plan.FrozenOfflineBuild.RequiresPreinspectedLocalTag)'offline argv drift'
$mutations=@(
 @{N='source ref';F={param($p)$p.SourceImage.Ref='debian:latest'}},@{N='observed id';F={param($p)$p.SourceImage.ObservedLocalImageId='sha256:invented'}},@{N='inspect type';F={param($p)$p.SourceImage.InspectBeforeBuild='true'}},
 @{N='labels';F={param($p)$p.ExpectedLabels.'farmrx.synthetic-role'='wrong'}},@{N='build argv';F={param($p)$p.BootstrapBuildArgv=@('build')}},@{N='evidence argv';F={param($p)$p.EvidenceArgv=@('inspect')}},
 @{N='evidence resolved';F={param($p)$p.EvidenceContract.Resolved=$true}},@{N='evidence required';F={param($p)$p.EvidenceContract.Required=@()}},@{N='nonsecret type';F={param($p)$p.EvidenceContract.RecordOnlyNonsecret='true'}},
 @{N='cleanup force';F={param($p)$p.Cleanup.Force=$true}},@{N='cleanup ambiguity';F={param($p)$p.Cleanup.OnMissingOrAmbiguous='remove'}},@{N='offline argv';F={param($p)$p.FrozenOfflineBuild.ArgvTemplate=@('build')}})
foreach($path in @(@('SourceImage','ObservedLocalRepoDigests'),@('SourceImage','ExecutionTimeInspectRequired'),@('ExpectedLabels','farmrx.synthetic-owner'),@('EvidenceContract','RecordOnlyNonsecret'),@('Cleanup','RequireExactRecordedImageId'),@('FrozenOfflineBuild','ArgvTemplate'))){$owner=$path[0];$field=$path[1];$mutations+=@{N="delete $owner.$field";F={param($p)$p.$owner.PSObject.Properties.Remove($field)}.GetNewClosure()}}
foreach($m in $mutations){$bad=$plan|ConvertTo-Json -Depth 10|ConvertFrom-Json;& $m.F $bad;$refused=$false;try{Assert-MapleFaketimeArtifactBootstrapPlan $bad|Out-Null}catch{$refused=$true};A($refused)("mutation accepted: "+$m.N)}
Write-Output 'MAPLE_FAKETIME_ARTIFACT_BOOTSTRAP_PLAN_REGRESSION_PASS'
