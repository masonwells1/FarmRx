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
    Images=[ordered]@{
      SupabasePostgres=[ordered]@{Ref='public.ecr.aws/supabase/postgres@sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5';ExpectedLocalImageId='sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5';RequireLocalIdEqualsDigest=$true;PullAllowed=$false}
      Postgrest=[ordered]@{Ref='public.ecr.aws/supabase/postgrest@sha256:488093de819567422bc1d37cb79da6e84bca3726bac321daeed618f0ed957888';ExpectedLocalImageId='sha256:488093de819567422bc1d37cb79da6e84bca3726bac321daeed618f0ed957888';RequireLocalIdEqualsDigest=$true;PullAllowed=$false}
      FaketimeBuilder=[ordered]@{Ref='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';ExpectedLocalImageId='sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';RequireLocalIdEqualsDigest=$true;PullAllowed=$false}
      FaketimeArtifacts=[ordered]@{Ref='maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7@sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746';ExpectedLocalImageId='sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746';RequireLocalIdEqualsDigest=$true;PullAllowed=$false;Observed=$true;LabelsVerified=$true}
      MutableTagsAllowed=$false
    }
    FixtureLineage=[ordered]@{Resolved=$false;SelectedExpectedImmutableLineage=$true;ExecutionTimeLocalInspectRequired=$true;ObservedLocalPresenceClaimed=$false;Reason='Expected immutable lineage is selected; execution-time local inspect must verify each exact image ID equals its digest. This plan makes no observed local-presence claim.'}
    InitializationSchemaContract=[ordered]@{
      ContainsSecrets=$false
      Roles=@([ordered]@{Name='anon';Login=$false},[ordered]@{Name='authenticated';Login=$false},[ordered]@{Name='authenticator';Login=$true;SecretSource='private execution input only';SecretValueIncluded=$false})
      Schema='api';ProofRelation='api.fixture_proof'
      Columns=@([ordered]@{Name='contract_hash';Type='text';PrimaryKey=$true;Nullable=$false},[ordered]@{Name='result';Type='text';PrimaryKey=$false;Nullable=$false})
      ExactSyntheticRow=[ordered]@{contract_hash="maple-synthetic-$token";result='fixture-ready'}
      Grants=@('grant anon to authenticator','grant authenticated to authenticator','grant usage on schema api to anon, authenticated','grant select on api.fixture_proof to anon, authenticated')
      Revokes=@('revoke all on schema api from public','revoke all on api.fixture_proof from public')
    }
    PostgrestConfigurationContract=[ordered]@{EnvironmentKeyNames=@('PGRST_DB_URI','PGRST_DB_SCHEMAS','PGRST_DB_ANON_ROLE','PGRST_SERVER_PORT','PGRST_JWT_SECRET');ApplicationName="postgrest-synthetic-$token";SecretValuesIncluded=$false;JwtValuesIncluded=$false;EvidenceMayContainValues=$false}
    FrozenBuildOfflineProof=[ordered]@{Resolved=$true;ArtifactConsumption='exact pre-inspected local tag; bare sha256 ID and local repo-digest ref are rejected resolution forms';RequiredFlags=@('--no-cache','--network=none','--pull=false');ResultImageId='sha256:2012a39d6a620292e75bee5ac5e218bf9cc2c4ae1ae463a77f335a296b088858';OwnerLabel='farmrx.synthetic-offline-proof=f7ca3c46fc164f7c83b634f850660c48';Entrypoint=@('/usr/local/bin/frozen-postgres-entrypoint');Cmd=@('postgres','-D','/etc/postgresql');FrozenEnvironment='FROZEN_INSTANT=2027-07-09 21:10:00+00:00';IdentityRechecked=$true;Cleanup='exact identity and owner rechecked; synthetic proof tag removed nonforce';RuntimeFixtureAccepted=$false}
    Cleanup=$cleanup;EvidencePolicy='Retain nonsecret evidence on missing identity, ownership mismatch, ambiguity, or cleanup failure.'
  }
}
function Assert-MapleSyntheticDockerTopologyPlan($Plan){
  $json=$Plan|ConvertTo-Json -Depth 12
  function ExactFalse($object,[string]$name){if($object-is[Collections.IDictionary]){if(-not$object.Contains($name)){return $false};$value=$object[$name]}else{$property=$object.PSObject.Properties[$name];if($null-eq$property){return $false};$value=$property.Value};$null-ne$value-and$value.GetType()-eq[bool]-and$value-eq$false}
  function ExactTrue($object,[string]$name){if($object-is[Collections.IDictionary]){if(-not$object.Contains($name)){return $false};$value=$object[$name]}else{$property=$object.PSObject.Properties[$name];if($null-eq$property){return $false};$value=$property.Value};$null-ne$value-and$value.GetType()-eq[bool]-and$value-eq$true}
  function SameJson($a,$b){($a|ConvertTo-Json -Depth 8 -Compress)-ceq($b|ConvertTo-Json -Depth 8 -Compress)}
  if($Plan.Kind-cne'planning-topology-sketch'-or-not(ExactFalse $Plan 'Executable')-or-not(ExactFalse $Plan.PortPreflight 'Implemented')-or-not(ExactTrue $Plan.FrozenBuildOfflineProof 'Resolved')){throw'MAPLE_TOPOLOGY_REFUSED: sketch misstates readiness.'}
  $expectedImages=[ordered]@{
    SupabasePostgres=[ordered]@{Ref='public.ecr.aws/supabase/postgres@sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5';ExpectedLocalImageId='sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5';RequireLocalIdEqualsDigest=$true;PullAllowed=$false}
    Postgrest=[ordered]@{Ref='public.ecr.aws/supabase/postgrest@sha256:488093de819567422bc1d37cb79da6e84bca3726bac321daeed618f0ed957888';ExpectedLocalImageId='sha256:488093de819567422bc1d37cb79da6e84bca3726bac321daeed618f0ed957888';RequireLocalIdEqualsDigest=$true;PullAllowed=$false}
    FaketimeBuilder=[ordered]@{Ref='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';ExpectedLocalImageId='sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';RequireLocalIdEqualsDigest=$true;PullAllowed=$false}
    FaketimeArtifacts=[ordered]@{Ref='maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7@sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746';ExpectedLocalImageId='sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746';RequireLocalIdEqualsDigest=$true;PullAllowed=$false;Observed=$true;LabelsVerified=$true}
  }
  foreach($name in $expectedImages.Keys){$image=$Plan.Images.$name;if(-not(SameJson $image $expectedImages[$name])){throw 'MAPLE_TOPOLOGY_REFUSED: image lineage is not immutable and locally identity-gated.'}}
  if(-not(ExactFalse $Plan.Images 'MutableTagsAllowed')-or-not(ExactFalse $Plan.InitializationSchemaContract 'ContainsSecrets')-or-not(ExactFalse $Plan.PostgrestConfigurationContract 'SecretValuesIncluded')-or-not(ExactFalse $Plan.PostgrestConfigurationContract 'JwtValuesIncluded')-or-not(ExactFalse $Plan.PostgrestConfigurationContract 'EvidenceMayContainValues')){throw'MAPLE_TOPOLOGY_REFUSED: credential or mutable-image policy weakened.'}
  if(($Plan.PostgrestConfigurationContract.EnvironmentKeyNames-join'|')-cne'PGRST_DB_URI|PGRST_DB_SCHEMAS|PGRST_DB_ANON_ROLE|PGRST_SERVER_PORT|PGRST_JWT_SECRET'){throw'MAPLE_TOPOLOGY_REFUSED: PostgREST key contract changed.'}
  $token=([string]$Plan.Prefix)-replace'^maple-synthetic-',''
  $expectedRoles=@([ordered]@{Name='anon';Login=$false},[ordered]@{Name='authenticated';Login=$false},[ordered]@{Name='authenticator';Login=$true;SecretSource='private execution input only';SecretValueIncluded=$false})
  $expectedColumns=@([ordered]@{Name='contract_hash';Type='text';PrimaryKey=$true;Nullable=$false},[ordered]@{Name='result';Type='text';PrimaryKey=$false;Nullable=$false})
  $expectedRow=[ordered]@{contract_hash=$Plan.Prefix;result='fixture-ready'}
  $expectedGrants=@('grant anon to authenticator','grant authenticated to authenticator','grant usage on schema api to anon, authenticated','grant select on api.fixture_proof to anon, authenticated')
  $expectedRevokes=@('revoke all on schema api from public','revoke all on api.fixture_proof from public')
  $expectedLineage=[ordered]@{Resolved=$false;SelectedExpectedImmutableLineage=$true;ExecutionTimeLocalInspectRequired=$true;ObservedLocalPresenceClaimed=$false;Reason='Expected immutable lineage is selected; execution-time local inspect must verify each exact image ID equals its digest. This plan makes no observed local-presence claim.'}
  if(-not(SameJson $Plan.FixtureLineage $expectedLineage)){throw'MAPLE_TOPOLOGY_REFUSED: fixture lineage contract changed.'}
  $expectedFrozen=[ordered]@{Resolved=$true;ArtifactConsumption='exact pre-inspected local tag; bare sha256 ID and local repo-digest ref are rejected resolution forms';RequiredFlags=@('--no-cache','--network=none','--pull=false');ResultImageId='sha256:2012a39d6a620292e75bee5ac5e218bf9cc2c4ae1ae463a77f335a296b088858';OwnerLabel='farmrx.synthetic-offline-proof=f7ca3c46fc164f7c83b634f850660c48';Entrypoint=@('/usr/local/bin/frozen-postgres-entrypoint');Cmd=@('postgres','-D','/etc/postgresql');FrozenEnvironment='FROZEN_INSTANT=2027-07-09 21:10:00+00:00';IdentityRechecked=$true;Cleanup='exact identity and owner rechecked; synthetic proof tag removed nonforce';RuntimeFixtureAccepted=$false}
  if(-not(SameJson $Plan.FrozenBuildOfflineProof $expectedFrozen)){throw'MAPLE_TOPOLOGY_REFUSED: frozen offline proof contract changed.'}
  if($Plan.InitializationSchemaContract.Schema-cne'api'-or$Plan.InitializationSchemaContract.ProofRelation-cne'api.fixture_proof'-or-not(SameJson $Plan.InitializationSchemaContract.Roles $expectedRoles)-or-not(SameJson $Plan.InitializationSchemaContract.Columns $expectedColumns)-or-not(SameJson $Plan.InitializationSchemaContract.ExactSyntheticRow $expectedRow)-or-not(SameJson $Plan.InitializationSchemaContract.Grants $expectedGrants)-or-not(SameJson $Plan.InitializationSchemaContract.Revokes $expectedRevokes)){throw'MAPLE_TOPOLOGY_REFUSED: initialization schema contract changed.'}
  if($Plan.PostgrestConfigurationContract.ApplicationName-cne"postgrest-synthetic-$token"){throw'MAPLE_TOPOLOGY_REFUSED: PostgREST application name changed.'}
  if($json-match'supabase_db_|farmrx-farmer-simplicity|55321|55322|PGRST_JWT_SECRET\s*=|postgres(?:ql)?://[^"\s]*:[^@"\s]*@|docker\s+pull|rm\s+-f|\bkill\b'){throw'MAPLE_TOPOLOGY_REFUSED: reserved, secret, pull, destructive, or rehearsal claim found.'}
  $true
}
if($MyInvocation.InvocationName-ne'.'){
  if($DbPort-eq0-or$ApiPort-eq0){$DbPort=62131;$ApiPort=62132}
  $plan=New-MapleSyntheticDockerTopologyPlan $SyntheticId $DbPort $ApiPort;Assert-MapleSyntheticDockerTopologyPlan $plan|Out-Null
  if($Execute){throw'MAPLE_TOPOLOGY_REFUSED: this is a non-executing planning/topology sketch; no adapter or Docker invocation exists.'}
  $plan|ConvertTo-Json -Depth 9
}
