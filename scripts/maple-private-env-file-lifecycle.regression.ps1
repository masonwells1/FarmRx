$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'maple-synthetic-db-fixture-smoke.ps1')
function Assert-True($Value,[string]$Message){if(-not$Value){throw $Message}}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
foreach($case in @(@{Name='POSTGRES_PASSWORD';Value='dummy-lifecycle-one'},@{Name='PGOPTIONS';Value='-cfarmrx.private_password=dummy-lifecycle-two'})){
  $file=$null;$path=$null
  $exclusiveState=[pscustomobject]@{Calls=0;CompetingOpenFailed=$false};$exclusiveProbe={param($probePath);$exclusiveState.Calls++;$competitor=$null;try{$competitor=[IO.FileStream]::new($probePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)}catch [IO.IOException]{$exclusiveState.CompetingOpenFailed=$true}finally{if($null-ne$competitor){$competitor.Dispose()}};$exclusiveState.CompetingOpenFailed}.GetNewClosure()
  try{$file=New-MaplePrivateDockerEnvFile $case.Name $case.Value $null $exclusiveProbe;$path=$file.Path;Assert-True ($exclusiveState.Calls-eq1-and$exclusiveState.CompetingOpenFailed) 'competing pre-write open did not fail';Assert-True ([IO.File]::Exists($path)) 'lifecycle file missing';Assert-True ([IO.File]::ReadAllText($path)-ceq"$($case.Name)=$($case.Value)`n") 'lifecycle content mismatch';$acl=Get-Acl -LiteralPath $path;$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));Assert-True ($acl.AreAccessRulesProtected-and$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value-ceq$sid.Value) 'lifecycle ACL owner/protection mismatch';Assert-True ($rules.Count-eq1-and$rules[0].IdentityReference.Value-ceq$sid.Value-and$rules[0].AccessControlType-eq[Security.AccessControl.AccessControlType]::Allow-and($rules[0].FileSystemRights-band[Security.AccessControl.FileSystemRights]::FullControl)-eq[Security.AccessControl.FileSystemRights]::FullControl) 'lifecycle ACL rule mismatch'}finally{if($null-ne$file){&$file.Delete};if($null-ne$path){Assert-True (-not[IO.File]::Exists($path)) 'lifecycle residue'}}
}
$probe=[pscustomobject]@{Path=$null;Calls=0};$fail={param($path);$probe.Path=[string]$path;$probe.Calls++;$false}.GetNewClosure();$threw=$false
try{New-MaplePrivateDockerEnvFile 'PGOPTIONS' '-cfarmrx.private_password=dummy-lifecycle-failure' $fail|Out-Null}catch{$threw=$true}
Assert-True ($threw-and$probe.Calls-eq1-and-not[string]::IsNullOrWhiteSpace($probe.Path)-and-not[IO.File]::Exists($probe.Path)) 'failure lifecycle residue'
Write-Output 'MAPLE_PRIVATE_ENV_FILE_LIFECYCLE_PASS'
