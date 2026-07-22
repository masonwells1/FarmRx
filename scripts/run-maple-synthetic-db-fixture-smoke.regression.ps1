$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'run-maple-synthetic-db-fixture-smoke.ps1')
function Assert-True($Value,[string]$Message){if(-not$Value){throw $Message}}
function Assert-Refused([scriptblock]$Action,[string]$Message){$refused=$false;try{&$Action|Out-Null}catch{$refused=$true};Assert-True $refused $Message}

$id=[guid]'11111111-2222-4333-8444-555555555555'
$calls=[Collections.Generic.List[object]]::new()
$docker={param($argv,$stdin,$environment,$sensitive);$calls.Add([pscustomobject]@{Kind='docker';Argv=@($argv)});[pscustomobject]@{ExitCode=0;Stdout='';Stderr=''}}
$probe={param($port);$calls.Add([pscustomobject]@{Kind='probe';Value=$port});$true}
$clock={$calls.Add([pscustomobject]@{Kind='clock'});[datetimeoffset]'2026-07-21T00:00:00Z'}
$wait={param($milliseconds);$calls.Add([pscustomobject]@{Kind='wait';Value=$milliseconds});$true}
$factory={param($name,$value);$calls.Add([pscustomobject]@{Kind='factory';Name=$name});[pscustomobject]@{Path='opaque';Verified=$true;Delete={}}}
$smoke={param($fixtureId,$port,$invoke,$portProbe,$utcClock,$boundedWait,$envFactory,[switch]$InternalReviewedGate);Assert-True $InternalReviewedGate 'internal gate omitted';Assert-True ($fixtureId-ceq$id-and$port-eq62141) 'identity routing changed';&$portProbe $port|Out-Null;&$utcClock|Out-Null;&$boundedWait 1000|Out-Null;&$envFactory 'PGOPTIONS' 'private'|Out-Null;&$invoke @('version') $null @{} @('private')|Out-Null;$calls.Add([pscustomobject]@{Kind='smoke'});'INJECTED_RUNNER_PASS'}.GetNewClosure()

$plan=Invoke-MapleSyntheticDbFixtureRunnerCore $id 62141 -Smoke $smoke -DockerInvoke $docker -PortProbe $probe -UtcClock $clock -BoundedWait $wait -PrivateEnvFileFactory $factory
Assert-True (-not$plan.Executable-and($plan|ConvertTo-Json)-notmatch'maple-[0-9a-f]{32}|POSTGRES_PASSWORD=|farmrx\.private_password=') 'plan-only output leaked or overclaimed'
Assert-True ($calls.Count-eq0) 'plan-only path invoked a boundary'
Assert-Refused {Invoke-MapleSyntheticDbFixtureRunnerCore $id 62141 -Run -Smoke $smoke -DockerInvoke $docker -PortProbe $probe -UtcClock $clock -BoundedWait $wait -PrivateEnvFileFactory $factory} 'missing review flag accepted'
Assert-Refused {Invoke-MapleSyntheticDbFixtureRunnerCore $id 62141 -Run -Reviewed -Confirmation 'wrong' -Smoke $smoke -DockerInvoke $docker -PortProbe $probe -UtcClock $clock -BoundedWait $wait -PrivateEnvFileFactory $factory} 'wrong confirmation accepted'
Assert-True ($calls.Count-eq0) 'refused gate invoked a boundary'
Assert-Refused {Invoke-MapleSyntheticDbFixtureRunnerCore ([guid]::Empty) 62141} 'empty id accepted'
Assert-Refused {Invoke-MapleSyntheticDbFixtureRunnerCore $id 49151} 'low port accepted'
$result=Invoke-MapleSyntheticDbFixtureRunnerCore $id 62141 -Run -Reviewed -Confirmation 'MAPLE_SYNTHETIC_DB_FIXTURE_LOCAL_ONLY_REVIEWED' -Smoke $smoke -DockerInvoke $docker -PortProbe $probe -UtcClock $clock -BoundedWait $wait -PrivateEnvFileFactory $factory
Assert-True ($result-ceq'INJECTED_RUNNER_PASS') 'injected execution routing failed'
Assert-True (($calls.Kind-join'|')-ceq'probe|clock|wait|factory|docker|smoke') 'callback order/routing changed'
$captured=$calls|ConvertTo-Json -Depth 5;Assert-True ($captured-notmatch'maple-[0-9a-f]{32}|farmrx\.private_password=|POSTGRES_PASSWORD=') 'secret callback data serialized'
$source=Get-Content -Raw (Join-Path $PSScriptRoot 'run-maple-synthetic-db-fixture-smoke.ps1')
foreach($required in @('Invoke-MapleDbFixtureProcess','Test-MapleLoopbackPortAvailable','[DateTimeOffset]::UtcNow','Start-Sleep -Milliseconds','New-MaplePrivateDockerEnvFile','-InternalReviewedGate')){Assert-True $source.Contains($required) "real callback missing: $required"}
Assert-True (-not$script:MapleDbFixtureExecutionUnlocked) 'accepted harness public lock changed'
Write-Output 'MAPLE_SYNTHETIC_DB_FIXTURE_RUNNER_REGRESSION_PASS'
