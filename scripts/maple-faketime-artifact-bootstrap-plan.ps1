param([guid]$SyntheticId=[guid]::NewGuid(),[switch]$Execute)
$ErrorActionPreference='Stop'
function New-MapleFaketimeArtifactBootstrapPlan([guid]$Id){
  if($Id-eq[guid]::Empty){throw 'MAPLE_FAKETIME_BOOTSTRAP_REFUSED: empty synthetic id.'}
  $token=$Id.ToString('N');$tag="maple-faketime-artifacts-${token}:synthetic";$owner="farmrx.synthetic-bootstrap=$token"
  [pscustomobject]@{
    Kind='locked-nonexecuting-faketime-artifact-bootstrap';Executable=$false;SyntheticTag=$tag;ExpectedImageId=$null
    SourceImage=[ordered]@{Ref='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';ObservedLocalRepoDigests=$null;ObservedLocalImageId=$null;ExecutionTimeInspectRequired=$true;InspectBeforeBuild=$true}
    PackageContract=@('libfaketime=0.9.10-2.1','gcc','libc6-dev')
    NetworkPackageBootstrap=[ordered]@{Limitation='apt repository state is mutable; the pinned Debian manifest alone does not make package resolution reproducible';GovernedOnlyAfter='build plus inspect records exact artifact image ID, exact labels, and retained evidence';ReproducibleSourceClaimed=$false}
    ExpectedLabels=[ordered]@{'farmrx.synthetic-owner'='maple-faketime-bootstrap';'farmrx.synthetic-role'='faketime-artifacts';'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev';'farmrx.synthetic-bootstrap'=$token}
    BootstrapBuildArgv=@('build','--pull=false','--label',$owner,'-f','tests/season/faketime-artifacts.Dockerfile','-t',$tag,'.')
    EvidenceArgv=@('image','inspect',$tag,'--format','{{json .}}')
    EvidenceContract=[ordered]@{Resolved=$false;Required=@('exact image ID','all exact labels','source digest','package contract');RecordOnlyNonsecret=$true}
    FrozenOfflineBuild=[ordered]@{Resolved=$false;RequiresArtifactImageId=$true;RequiresPreinspectedLocalTag=$true;ArgvTemplate=@('build','--no-cache','--network=none','--pull=false','--build-arg','BASE_IMAGE=<verified-local-digest-ref>','--build-arg','FAKETIME_ARTIFACTS_IMAGE=<preinspected-local-artifact-tag>','-f','tests/season/frozen-postgres-clock-spike.Dockerfile','-t','<synthetic-derived-tag>','.')}
    Cleanup=[ordered]@{InspectExactTagFirst=$true;RequireExactRecordedImageId=$true;RequireExactOwnershipLabel=$owner;RemoveArgv=@('image','rm',$tag);Force=$false;OnMissingOrAmbiguous='retain evidence and refuse'}
  }
}
function Assert-MapleFaketimeArtifactBootstrapPlan($Plan){
  function SameJson($a,$b){($a|ConvertTo-Json -Depth 8 -Compress)-ceq($b|ConvertTo-Json -Depth 8 -Compress)}
  if($Plan.Kind-cne'locked-nonexecuting-faketime-artifact-bootstrap'-or$Plan.Executable-or$null-ne$Plan.ExpectedImageId){throw 'MAPLE_FAKETIME_BOOTSTRAP_REFUSED: readiness overclaimed.'}
  $token=([string]$Plan.SyntheticTag)-replace'^maple-faketime-artifacts-',''-replace':synthetic$','';$tag="maple-faketime-artifacts-${token}:synthetic";$owner="farmrx.synthetic-bootstrap=$token"
  $source=[ordered]@{Ref='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';ObservedLocalRepoDigests=$null;ObservedLocalImageId=$null;ExecutionTimeInspectRequired=$true;InspectBeforeBuild=$true}
  $limitation=[ordered]@{Limitation='apt repository state is mutable; the pinned Debian manifest alone does not make package resolution reproducible';GovernedOnlyAfter='build plus inspect records exact artifact image ID, exact labels, and retained evidence';ReproducibleSourceClaimed=$false}
  $labels=[ordered]@{'farmrx.synthetic-owner'='maple-faketime-bootstrap';'farmrx.synthetic-role'='faketime-artifacts';'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev';'farmrx.synthetic-bootstrap'=$token}
  $build=@('build','--pull=false','--label',$owner,'-f','tests/season/faketime-artifacts.Dockerfile','-t',$tag,'.');$evidence=@('image','inspect',$tag,'--format','{{json .}}')
  $evidenceContract=[ordered]@{Resolved=$false;Required=@('exact image ID','all exact labels','source digest','package contract');RecordOnlyNonsecret=$true}
  $offline=[ordered]@{Resolved=$false;RequiresArtifactImageId=$true;RequiresPreinspectedLocalTag=$true;ArgvTemplate=@('build','--no-cache','--network=none','--pull=false','--build-arg','BASE_IMAGE=<verified-local-digest-ref>','--build-arg','FAKETIME_ARTIFACTS_IMAGE=<preinspected-local-artifact-tag>','-f','tests/season/frozen-postgres-clock-spike.Dockerfile','-t','<synthetic-derived-tag>','.')}
  $cleanup=[ordered]@{InspectExactTagFirst=$true;RequireExactRecordedImageId=$true;RequireExactOwnershipLabel=$owner;RemoveArgv=@('image','rm',$tag);Force=$false;OnMissingOrAmbiguous='retain evidence and refuse'}
  if(-not(SameJson $Plan.SourceImage $source)-or-not(SameJson $Plan.NetworkPackageBootstrap $limitation)-or-not(SameJson $Plan.ExpectedLabels $labels)-or-not(SameJson $Plan.BootstrapBuildArgv $build)-or-not(SameJson $Plan.EvidenceArgv $evidence)-or-not(SameJson $Plan.EvidenceContract $evidenceContract)-or-not(SameJson $Plan.FrozenOfflineBuild $offline)-or-not(SameJson $Plan.Cleanup $cleanup)-or-not(SameJson $Plan.PackageContract @('libfaketime=0.9.10-2.1','gcc','libc6-dev'))){throw 'MAPLE_FAKETIME_BOOTSTRAP_REFUSED: exact locked contract changed.'}
  $true
}
if($MyInvocation.InvocationName-ne'.'){$plan=New-MapleFaketimeArtifactBootstrapPlan $SyntheticId;Assert-MapleFaketimeArtifactBootstrapPlan $plan|Out-Null;if($Execute){throw 'MAPLE_FAKETIME_BOOTSTRAP_REFUSED: plan has no Docker executor.'};$plan|ConvertTo-Json -Depth 10}
