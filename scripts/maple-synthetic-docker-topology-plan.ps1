param([guid]$SyntheticId=[guid]::NewGuid(),[int]$DbPort=0,[int]$ApiPort=0,[switch]$Execute)
$ErrorActionPreference='Stop'
function New-MapleSyntheticDockerTopologyPlan {
  param([guid]$Id,[int]$DatabasePort,[int]$RestPort)
  if($Id-eq[guid]::Empty){throw'MAPLE_TOPOLOGY_REFUSED: empty id.'}
  foreach($port in @($DatabasePort,$RestPort)){if($port-lt 49152-or$port-gt 65535){throw'MAPLE_TOPOLOGY_REFUSED: ports must be high ports.'}}
  if($DatabasePort-eq$RestPort){throw'MAPLE_TOPOLOGY_REFUSED: ports must be distinct.'}
  $token=$Id.ToString('N');$prefix="maple-synthetic-$token";$label="farmrx.synthetic-topology=$token"
  $resources=@(
    [ordered]@{Kind='container';Role='db';Name="$prefix-db";ExpectedIdEvidence='unresolved-until-created'},
    [ordered]@{Kind='container';Role='rest-analog';Name="$prefix-rest";ExpectedIdEvidence='unresolved-until-created'},
    [ordered]@{Kind='volume';Role='db-data';Name="$prefix-volume";ExpectedIdEvidence='unresolved-until-created'},
    [ordered]@{Kind='network';Role='isolated';Name="$prefix-network";ExpectedIdEvidence='unresolved-until-created'}
  )
  $cleanup=[Collections.Generic.List[object]]::new()
  foreach($resource in $resources){
    $cleanup.Add([ordered]@{Action='inspect';Kind=$resource.Kind;Name=$resource.Name;RequireExactId=$resource.ExpectedIdEvidence;RequireOwnershipLabel=$label;Absent='safe-no-op';Mismatch='retain-evidence-and-refuse'})
    if($resource.Kind-ceq'container'){$cleanup.Add([ordered]@{Action='conditional-graceful-stop';Name=$resource.Name;Seconds=60;OnlyAfterExactInspection=$true;IfRunningOnly=$true})}
    $cleanup.Add([ordered]@{Action='conditional-remove';Kind=$resource.Kind;Name=$resource.Name;OnlyAfterExactInspection=$true;Force=$false})
  }
  [pscustomobject]@{
    Kind='planning-topology-sketch';Executable=$false;Prefix=$prefix;OwnershipLabel=$label;Resources=$resources
    LoopbackPublishes=@("127.0.0.1:${DatabasePort}:5432","127.0.0.1:${RestPort}:3000")
    PortPreflight=[ordered]@{Implemented=$false;Required='bind both loopback ports immediately before creation';KnownRace='bind then release cannot reserve a port; another process may claim it before container publish'}
    FixtureLineage=[ordered]@{Resolved=$false;Reason='No reviewed immutable PostgREST-analog fixture digest and initialization contract is recorded; create commands are intentionally omitted.'}
    Cleanup=$cleanup;EvidencePolicy='Retain nonsecret evidence on missing identity, ownership mismatch, ambiguity, or cleanup failure.'
  }
}
function Assert-MapleSyntheticDockerTopologyPlan($Plan){$json=$Plan|ConvertTo-Json -Depth 9;if($Plan.Kind-cne'planning-topology-sketch'-or$Plan.Executable-or$Plan.FixtureLineage.Resolved-or$Plan.PortPreflight.Implemented){throw'MAPLE_TOPOLOGY_REFUSED: sketch overclaims implementation.'};if($json-match'supabase_db_|farmrx-farmer-simplicity|55321|55322|POSTGRES_PASSWORD|JWT_SECRET|rm\s+-f|\bkill\b'){throw'MAPLE_TOPOLOGY_REFUSED: reserved, secret, destructive, or rehearsal claim found.'};$true}
if($MyInvocation.InvocationName-ne'.'){
  if($DbPort-eq0-or$ApiPort-eq0){$DbPort=62131;$ApiPort=62132}
  $plan=New-MapleSyntheticDockerTopologyPlan $SyntheticId $DbPort $ApiPort;Assert-MapleSyntheticDockerTopologyPlan $plan|Out-Null
  if($Execute){throw'MAPLE_TOPOLOGY_REFUSED: this is a non-executing planning/topology sketch; no adapter or Docker invocation exists.'}
  $plan|ConvertTo-Json -Depth 9
}
