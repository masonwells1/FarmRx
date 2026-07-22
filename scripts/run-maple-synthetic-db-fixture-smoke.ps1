param(
  [guid]$SyntheticId=[guid]::NewGuid(),
  [int]$DbPort=62141,
  [switch]$Execute,
  [switch]$UnsafeReviewed,
  [string]$ConfirmationToken=''
)
$ErrorActionPreference='Stop'
$runnerSyntheticId=$SyntheticId
$runnerDbPort=$DbPort
$runnerExecute=[bool]$Execute
$runnerUnsafeReviewed=[bool]$UnsafeReviewed
$runnerConfirmationToken=[string]$ConfirmationToken
. (Join-Path $PSScriptRoot 'maple-synthetic-db-fixture-smoke.ps1')
$script:MapleDbFixtureRunnerConfirmation='MAPLE_SYNTHETIC_DB_FIXTURE_LOCAL_ONLY_REVIEWED'

function Invoke-MapleSyntheticDbFixtureRunnerCore {
  param(
    [guid]$Id,[int]$Port,[switch]$Run,[switch]$Reviewed,[string]$Confirmation,
    [scriptblock]$Smoke,[scriptblock]$DockerInvoke,[scriptblock]$PortProbe,
    [scriptblock]$UtcClock,[scriptblock]$BoundedWait,[scriptblock]$PrivateEnvFileFactory
  )
  $plan=New-MapleSyntheticDbFixturePlan $Id $Port
  if(-not$Run){return $plan}
  if(-not$Reviewed-or$Confirmation-cne$script:MapleDbFixtureRunnerConfirmation){throw 'MAPLE_DBFIXTURE_RUNNER_REFUSED: exact reviewed local-only confirmation is required.'}
  foreach($boundary in @($Smoke,$DockerInvoke,$PortProbe,$UtcClock,$BoundedWait,$PrivateEnvFileFactory)){if($null-eq$boundary){throw 'MAPLE_DBFIXTURE_RUNNER_REFUSED: execution boundary missing.'}}
  & $Smoke $Id $Port $DockerInvoke $PortProbe $UtcClock $BoundedWait $PrivateEnvFileFactory -InternalReviewedGate
}

if($MyInvocation.InvocationName-ne'.'){
  $smoke=${function:Invoke-MapleSyntheticDbFixtureSmoke}
  $dockerInvoke={param([string[]]$Argv,[string]$PrivateStdin,[hashtable]$PrivateEnvironment,[string[]]$PrivateSensitiveValues);Invoke-MapleDbFixtureProcess $Argv $PrivateStdin $PrivateEnvironment $PrivateSensitiveValues}
  $portProbe={param([int]$Port);Test-MapleLoopbackPortAvailable $Port}
  $clock={[DateTimeOffset]::UtcNow}
  $wait={param([int]$Milliseconds);Start-Sleep -Milliseconds $Milliseconds;$true}
  $envFactory={param([string]$Name,[string]$Value);New-MaplePrivateDockerEnvFile $Name $Value}
  $result=Invoke-MapleSyntheticDbFixtureRunnerCore $runnerSyntheticId $runnerDbPort -Run:$runnerExecute -Reviewed:$runnerUnsafeReviewed -Confirmation $runnerConfirmationToken -Smoke $smoke -DockerInvoke $dockerInvoke -PortProbe $portProbe -UtcClock $clock -BoundedWait $wait -PrivateEnvFileFactory $envFactory
  if(-not$runnerExecute){$result|ConvertTo-Json -Depth 6}else{$result}
}
