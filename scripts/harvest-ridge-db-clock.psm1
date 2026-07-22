Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'maple-season-db-clock-swap-adapter.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'maple-season-db-clock-docker-adapter.psm1') -Force

$script:HrClockNames = [ordered]@{
  Project='farmrx-farmer-simplicity-2027-local'
  Db='supabase_db_farmrx-farmer-simplicity-2027-local'
  Rest='supabase_rest_farmrx-farmer-simplicity-2027-local'
  Gateway='supabase_kong_farmrx-farmer-simplicity-2027-local'
  Parked='supabase_db_farmrx-farmer-simplicity-2027-local-ordinary-parked'
  Network='supabase_network_farmrx-farmer-simplicity-2027-local'
  Volume='supabase_db_farmrx-farmer-simplicity-2027-local'
  DbPort='55322';ApiPort='55321'
}
$script:HrBaseId='sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5'
$script:HrBaseDigest='public.ecr.aws/supabase/postgres@sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5'
$script:HrArtifactRef='maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7@sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746'
$script:HrArtifactTag='maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7:synthetic'
$script:HrArtifactId='sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746'
$script:HrFarmId='27010000-0000-4000-8000-000000000004'

function ConvertTo-HrClockWindowsCommandLine {
  param([Parameter(Mandatory)][string[]]$Argv)
  $quoted=foreach($argument in $Argv){
    $builder=[Text.StringBuilder]::new();[void]$builder.Append([char]34);$slashes=0
    foreach($character in $argument.ToCharArray()){
      if($character-eq[char]92){$slashes++;continue}
      if($character-eq[char]34){if($slashes-gt0){[void]$builder.Append([string]::new([char]92,2*$slashes))};[void]$builder.Append([char]92);[void]$builder.Append([char]34);$slashes=0;continue}
      if($slashes-gt0){[void]$builder.Append([string]::new([char]92,$slashes));$slashes=0}
      [void]$builder.Append($character)
    }
    if($slashes-gt0){[void]$builder.Append([string]::new([char]92,2*$slashes))}
    [void]$builder.Append([char]34);$builder.ToString()
  }
  return ($quoted-join' ')
}

function Invoke-HrClockProcess {
  param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string[]]$Argv)
  $process=$null;$stdoutTask=$null;$stderrTask=$null
  try{
    $dockerCommand=Get-Command docker -CommandType Application -ErrorAction Stop|Select-Object -First 1
    if($null-eq$dockerCommand-or-not[IO.File]::Exists($dockerCommand.Source)){throw 'HARVEST_RIDGE_CLOCK_REFUSED: exact Docker executable is unavailable.'}
    $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$dockerCommand.Source;$start.Arguments=ConvertTo-HrClockWindowsCommandLine $Argv;$start.WorkingDirectory=$Root;$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    $process=[Diagnostics.Process]::new();$process.StartInfo=$start
    if(-not$process.Start()){throw 'HARVEST_RIDGE_CLOCK_REFUSED: Docker process did not start.'}
    $stdoutTask=$process.StandardOutput.ReadToEndAsync();$stderrTask=$process.StandardError.ReadToEndAsync();$process.WaitForExit()
    [pscustomobject]@{ExitCode=[int]$process.ExitCode;Stdout=[string]$stdoutTask.Result;Stderr=[string]$stderrTask.Result}
  }finally{if($null-ne$process){$process.Dispose()};$stdoutTask=$null;$stderrTask=$null;$process=$null}
}

function Get-HrClockHash([object]$Value){
  $json=$Value|ConvertTo-Json -Compress -Depth 10
  $sha=[Security.Cryptography.SHA256]::Create()
  try{([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($json)))-replace'-','').ToLowerInvariant()}finally{$sha.Dispose();$json=$null}
}

function ConvertFrom-HrClockJson([object]$Result,[string]$Name){
  if($Result.ExitCode-ne0){throw "HARVEST_RIDGE_CLOCK_REFUSED: $Name inspection failed."}
  try{$Result.Stdout|ConvertFrom-Json -ErrorAction Stop}catch{throw "HARVEST_RIDGE_CLOCK_REFUSED: malformed $Name inspection."}
}

function Get-HrClockContainer {
  param([string]$Root,[string]$Name)
  $format='{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Running":{{json .State.Running}},"ExitCode":{{json .State.ExitCode}},"OomKilled":{{json .State.OOMKilled}},"Pid":{{json .State.Pid}},"Health":{{with index .State "Health"}}{{json (index . "Status")}}{{else}}null{{end}},"RestartCount":{{json .RestartCount}},"RestartPolicy":{{json .HostConfig.RestartPolicy.Name}},"Labels":{{json .Config.Labels}},"Mounts":{{json .Mounts}},"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .HostConfig.PortBindings}},"Healthcheck":{{with index .Config "Healthcheck"}}{{json .}}{{else}}null{{end}}}'
  $missing=@("Error: No such container: $Name","Error: No such object: $Name","Error response from daemon: No such container: $Name","Error response from daemon: No such object: $Name")
  for($attempt=1;$attempt-le30;$attempt++){
    $result=Invoke-HrClockProcess $Root @('inspect','--type','container','--format',$format,$Name)
    if($result.ExitCode-eq0){return ConvertFrom-HrClockJson $result "container $Name"}
    if($result.ExitCode-eq1-and$result.Stderr.Trim()-cin$missing){return $null}
    if($attempt-lt30){Start-Sleep -Milliseconds 250}
  }
  $diagnostic=([string]$result.Stderr).Trim()-replace'[\r\n]+',' '
  if($diagnostic.Length-gt300){$diagnostic=$diagnostic.Substring(0,300)}
  throw "HARVEST_RIDGE_CLOCK_REFUSED: container inspection failed for $Name after bounded retries (exit $($result.ExitCode), stderr '$diagnostic', stdout length $(([string]$result.Stdout).Length))."
}

function Assert-HrClockAttestation {
  param([string]$Root,[string]$Phase,[string]$FrozenInstant,[string]$JournalPath,[switch]$AllowExistingJournal)
  $n=$script:HrClockNames
  if($Phase-notmatch'^[a-z0-9-]{2,40}$'){throw 'HARVEST_RIDGE_CLOCK_REFUSED: invalid phase name.'}
  if(-not$AllowExistingJournal-and[IO.File]::Exists($JournalPath)){throw 'HARVEST_RIDGE_CLOCK_REFUSED: a pre-existing phase journal is ambiguous.'}
  $db=$null;$rest=$null;$gateway=$null;$parked=$null
  for($attempt=1;$attempt-le60;$attempt++){
    $db=Get-HrClockContainer $Root $n.Db;$rest=Get-HrClockContainer $Root $n.Rest;$gateway=Get-HrClockContainer $Root $n.Gateway;$parked=Get-HrClockContainer $Root $n.Parked
    if($null-ne$parked-and-not$AllowExistingJournal){throw 'HARVEST_RIDGE_CLOCK_REFUSED: the ordinary database is already parked.'}
    $databaseReady=if($AllowExistingJournal-and$null-ne$parked){$null-ne$db-and-not$parked.Running-and[int]$parked.ExitCode-eq0}else{$null-ne$db-and$db.Running-and$db.Health-ceq'healthy'-and[int]$db.Pid-gt0}
    $ready=$databaseReady-and$null-ne$rest-and$null-ne$gateway-and$rest.Running-and[int]$rest.Pid-gt0-and$gateway.Running-and$gateway.Health-ceq'healthy'-and[int]$gateway.Pid-gt0
    if($ready){break}
    if($attempt-lt60){Start-Sleep -Milliseconds 500}
  }
  if(-not$ready){throw 'HARVEST_RIDGE_CLOCK_REFUSED: exact ordinary DB/Rest/gateway topology did not become ready.'}
  $ordinary=if($AllowExistingJournal-and$null-ne$parked){$parked}else{$db}
  if($ordinary.Id-notmatch'^[0-9a-f]{64}$'-or$ordinary.Image-cne$script:HrBaseId-or($null-eq$parked-and(-not$ordinary.Running-or$ordinary.Health-cne'healthy'-or[int]$ordinary.Pid-le0))-or($null-ne$parked-and($ordinary.Running-or[int]$ordinary.ExitCode-ne0-or$ordinary.OomKilled))-or$ordinary.RestartPolicy-cnotin@('unless-stopped','no')){throw 'HARVEST_RIDGE_CLOCK_REFUSED: ordinary database identity/health is not exact.'}
  if($rest.Id-notmatch'^[0-9a-f]{64}$'-or-not$rest.Running-or[int]$rest.Pid-le0-or$rest.RestartPolicy-cne'unless-stopped'-or$gateway.Id-notmatch'^[0-9a-f]{64}$'-or-not$gateway.Running-or[int]$gateway.Pid-le0-or$gateway.Health-cne'healthy'-or$gateway.RestartPolicy-cne'unless-stopped'){throw 'HARVEST_RIDGE_CLOCK_REFUSED: Rest/gateway identity or readiness is not exact.'}
  $services=if($null-ne$parked){@($ordinary,$db,$rest,$gateway)}else{@($db,$rest,$gateway)}
  foreach($service in $services){if($service.Labels.'com.docker.compose.project'-cne$n.Project-or$service.Labels.'com.supabase.cli.project'-cne$n.Project-or@($service.Networks.PSObject.Properties.Name).Count-ne1-or$service.Networks.PSObject.Properties.Name-cne$n.Network){throw 'HARVEST_RIDGE_CLOCK_REFUSED: service project/network identity is not exact.'}}
  $network=ConvertFrom-HrClockJson (Invoke-HrClockProcess $Root @('network','inspect','--format','{"Id":{{json .Id}},"Labels":{{json .Labels}}}',$n.Network)) 'network'
  $volume=ConvertFrom-HrClockJson (Invoke-HrClockProcess $Root @('volume','inspect','--format','{"Name":{{json .Name}},"Labels":{{json .Labels}}}',$n.Volume)) 'volume'
  if($network.Id-notmatch'^[0-9a-f]{64}$'-or$volume.Name-cne$n.Volume-or$network.Labels.'com.docker.compose.project'-cne$n.Project-or$volume.Labels.'com.docker.compose.project'-cne$n.Project){throw 'HARVEST_RIDGE_CLOCK_REFUSED: disposable network/volume attestation failed.'}
  $digests=@((ConvertFrom-HrClockJson (Invoke-HrClockProcess $Root @('image','inspect','--format','{{json .RepoDigests}}',$ordinary.Image)) 'ordinary image digests'))
  if($digests.Count-ne1-or$digests[0]-cne$script:HrBaseDigest){throw 'HARVEST_RIDGE_CLOCK_REFUSED: ordinary database repository digest is not exact.'}
  foreach($artifactName in @($script:HrArtifactRef,$script:HrArtifactTag)){
    $artifact=ConvertFrom-HrClockJson (Invoke-HrClockProcess $Root @('image','inspect','--format','{"Id":{{json .Id}},"Labels":{{json .Config.Labels}}}',$artifactName)) 'faketime artifact'
    if($artifact.Id-cne$script:HrArtifactId-or$artifact.Labels.'farmrx.synthetic-bootstrap'-cne'225c197c34164c90b08a4c8b6b10e6c7'-or$artifact.Labels.'farmrx.synthetic-owner'-cne'maple-faketime-bootstrap'-or$artifact.Labels.'farmrx.synthetic-role'-cne'faketime-artifacts'-or$artifact.Labels.'farmrx.source-digest'-cne'debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818'-or$artifact.Labels.'farmrx.package-contract'-cne'libfaketime=0.9.10-2.1;gcc;libc6-dev'){throw 'HARVEST_RIDGE_CLOCK_REFUSED: reviewed faketime artifact identity changed.'}
  }
  $contractHash=Get-HrClockHash ([ordered]@{Phase=$Phase;FrozenInstant=$FrozenInstant;DbId=$ordinary.Id;DbImage=$ordinary.Image;RestId=$rest.Id;RestImage=$rest.Image;RestPid=[int]$rest.Pid;GatewayId=$gateway.Id;GatewayImage=$gateway.Image;NetworkId=$network.Id;Volume=$volume.Name;Project=$n.Project})
  [pscustomobject]@{Db=$ordinary;Rest=$rest;Gateway=$gateway;Network=$network;Volume=$volume;ContractHash=$contractHash}
}

function New-HrClockProofSql([datetimeoffset]$Instant){
  $iso=$Instant.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture)
  $sql=@"
create temporary table hr_clock_default_probe(stamped_at timestamptz not null default now());
insert into hr_clock_default_probe default values;
select current_date::text||'|'||to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||'|'||to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||'|'||to_char((select stamped_at from hr_clock_default_probe) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
"@
  [pscustomobject]@{Sql=$sql;Expected="$($Instant.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture))|$iso|$iso|$iso"}
}

function Invoke-HarvestRidgeClockPhase {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Phase,
    [Parameter(Mandatory)][string]$FrozenInstant,
    [Parameter(Mandatory)][string]$ApiUrl,
    [Parameter(Mandatory)][string]$PublishableKey,
    [Parameter(Mandatory)][string]$AccessToken,
    [Parameter(Mandatory)][scriptblock]$Action,
    [switch]$ResumeRecovery
  )
  if($ApiUrl-cne'http://127.0.0.1:55321'-or$PublishableKey-notmatch'^sb_publishable_'-or[string]::IsNullOrWhiteSpace($AccessToken)){throw 'HARVEST_RIDGE_CLOCK_REFUSED: local API credentials/boundary are not exact.'}
  $instant=[datetimeoffset]::MinValue
  if(-not[datetimeoffset]::TryParseExact($FrozenInstant,'yyyy-MM-dd HH:mm:sszzz',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$instant)-or$instant.Offset-ne[timespan]::Zero){throw 'HARVEST_RIDGE_CLOCK_REFUSED: phase instant is not exact UTC.'}
  $journal=Join-Path ([IO.Path]::GetTempPath()) "farmrx-harvest-ridge-clock-$Phase.json"
  if($ResumeRecovery-and-not[IO.File]::Exists($journal)){throw 'HARVEST_RIDGE_CLOCK_REFUSED: resume recovery requires the exact retained phase journal.'}
  $attested=Assert-HrClockAttestation $Root $Phase $FrozenInstant $journal -AllowExistingJournal:$ResumeRecovery;$n=$script:HrClockNames
  $inventory=@{base_digest=$script:HrBaseDigest;contract_hash=$attested.ContractHash;network_id=$attested.Network.Id;original_id=$attested.Db.Id;original_image_id=$script:HrBaseId;snapshot_tag="farmrx-clock-snapshot:$($attested.Db.Id.Substring(0,12))";derived_tag="farmrx-frozen-clock-swap:$($instant.ToString('yyyyMMdd'))-9faa7279";volume_name=$n.Volume}
  if($ResumeRecovery){
    try{$retained=Get-Content -Raw -Encoding UTF8 -LiteralPath $journal|ConvertFrom-Json -ErrorAction Stop}catch{throw 'HARVEST_RIDGE_CLOCK_REFUSED: retained phase journal is malformed.'}
    $topKeys=@($retained.PSObject.Properties.Name|Sort-Object);if(($topKeys-join'|')-cne'intended_next_action|inventory|phase|version'-or[int]$retained.version-ne1-or$retained.phase-cnotin@('stop_original','snapshot_original','build_derived','park_original','create_replacement','start_replacement','run_frozen_action','recovery_remove_replacement','recovery_restore_name','recovery_stop_unhealthy_original','recovery_start_original','recovery_restart_postgrest','recovery_RemoveDerivedImageIfOwned','recovery_RemoveSnapshotImageIfOwned','recovery_remove_journal')-or$retained.intended_next_action-notmatch'^[A-Za-z0-9_]{3,80}$'){throw 'HARVEST_RIDGE_CLOCK_REFUSED: retained phase journal contract is not exact.'}
    $journalInventory=@{};foreach($property in $retained.inventory.PSObject.Properties){$journalInventory[$property.Name]=[string]$property.Value}
    $expected=$inventory.Clone();$expected.contract_hash=$journalInventory.contract_hash
    try{Assert-MapleSwapInventory $journalInventory $expected|Out-Null}catch{throw 'HARVEST_RIDGE_CLOCK_REFUSED: retained phase journal inventory does not match current topology.'}
    $inventory=$journalInventory;$retained=$null;$expected=$null
  }
  $contract=@{Id=$attested.Db.Id;ImageId=$script:HrBaseId;NetworkId=$attested.Network.Id;VolumeName=$n.Volume;Project=$n.Project;ContractHash=$inventory.contract_hash;FrozenInstant=$FrozenInstant}
  $clock=New-HrClockProofSql $instant
  $proof=@{ApiPath="/rest/v1/farms?id=eq.$($script:HrFarmId)&select=id,name";ArtifactImageId=$script:HrArtifactId;ArtifactImageRef=$script:HrArtifactRef;ClockProofSql=$clock.Sql;Database='postgres';DbUser='postgres';ExpectedApiResult='Harvest Ridge';ExpectedClockSample=$clock.Expected;ExpectedRestDbHost=$n.Db;ExpectedRestDbUser='authenticator';PollAttempts=[int]60;PollMilliseconds=[int]500;WaitMilliseconds=[int]500}
  $processInvoker=${function:Invoke-HrClockProcess};$farmId=$script:HrFarmId;$contractHash=$inventory.contract_hash
  $invoke={
    param([string]$Kind,[string[]]$Argv)
    if($Kind-ceq'docker'){return &$processInvoker $Root $Argv}
    if($Kind-cne'http_get'-or$Argv.Count-ne2-or$Argv[0]-cne"$ApiUrl$($proof.ApiPath)"-or$Argv[1]-cne'authenticated-expected-contract'){return [pscustomobject]@{ExitCode=64;Stdout='';Stderr=''}}
    try{
      $response=Invoke-WebRequest -UseBasicParsing -Method Get -Uri $Argv[0] -Headers @{apikey=$PublishableKey;Authorization="Bearer $AccessToken"} -TimeoutSec 10
      $data=@($response.Content|ConvertFrom-Json -ErrorAction Stop);$valid=$data.Count-eq1-and$data[0].id-ceq$farmId-and$data[0].name-ceq'Harvest Ridge'
      [pscustomobject]@{ExitCode=0;Stdout='';Stderr='';StatusCode=[int]$response.StatusCode;Data=[pscustomobject]@{ContractHash=if($valid){$contractHash}else{''};Result=if($valid){'Harvest Ridge'}else{''}}}
    }catch{[pscustomobject]@{ExitCode=69;Stdout='';Stderr=''}}
  }.GetNewClosure()
  $wait={param([int]$Milliseconds);Start-Sleep -Milliseconds $Milliseconds;$true}
  $adapter=New-MapleDockerSwapAdapter -Contract $contract -Inventory $inventory -ProofContract $proof -JournalPath $journal -Invoke $invoke -Wait $wait
  $initial=&$adapter.InspectActualState
  if($ResumeRecovery){if(-not$initial.JournalExists-or(-not$initial.OriginalCanonical-and-not$initial.OriginalParked)-or($initial.ReplacementExists-and-not$initial.ReplacementOwned)){throw 'HARVEST_RIDGE_CLOCK_REFUSED: retained recovery topology is not exactly owned.'}}
  elseif(-not$initial.OriginalCanonical-or-not$initial.OriginalRunning-or-not$initial.OriginalHealthy-or$initial.OriginalRestartPolicy-cne'unless-stopped'-or$initial.OriginalParked-or$initial.ReplacementExists-or$initial.SnapshotOwned-or$initial.DerivedOwned){throw 'HARVEST_RIDGE_CLOCK_REFUSED: pre-mutation adapter state is not exact ordinary state.'}
  $primary=$null
  try{
    if($ResumeRecovery){$resume=Invoke-MapleSwapRecovery $adapter $inventory;if(-not$resume.Restored){throw "HARVEST_RIDGE_CLOCK_RECOVERY_INCOMPLETE: $($resume.Failures-join'; ')"}}
    elseif((Invoke-MapleSwapStateMachine $adapter $inventory $Action)-cne'MAPLE_DB_CLOCK_SWAP_ADAPTER_PASS'){throw 'HARVEST_RIDGE_CLOCK_FAILED: state machine result was not exact.'}
  }
  catch{$primary=$_.Exception;try{$retry=Invoke-MapleSwapRecovery $adapter $inventory}catch{$retry=[pscustomobject]@{Restored=$false;Failures=@($_.Exception.Message)}};if(-not$retry.Restored){throw [AggregateException]::new('Harvest Ridge clock phase failed and recovery remained incomplete.',[Exception[]]@($primary,[Exception]::new(($retry.Failures-join'; '))))}}
  $ordinary=Get-HrClockContainer $Root $n.Db;$parked=Get-HrClockContainer $Root $n.Parked
  if($null-eq$ordinary-or$ordinary.Id-cne$attested.Db.Id-or$ordinary.Image-cne$script:HrBaseId-or-not$ordinary.Running-or$ordinary.Health-cne'healthy'-or$ordinary.RestartPolicy-cne'unless-stopped'-or$null-ne$parked-or[IO.File]::Exists($journal)){throw 'HARVEST_RIDGE_CLOCK_FAILED: ordinary database identity/recovery is not exact.'}
  foreach($tag in @($inventory.snapshot_tag,$inventory.derived_tag)){if((Invoke-HrClockProcess $Root @('image','inspect',$tag)).ExitCode-eq0){throw 'HARVEST_RIDGE_CLOCK_FAILED: owned temporary image survived recovery.'}}
  $ordinaryClock=Invoke-HrClockProcess $Root @('exec',$n.Db,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c','select extract(epoch from clock_timestamp())::bigint;')
  $epoch=[long]0;if($ordinaryClock.ExitCode-ne0-or-not[long]::TryParse($ordinaryClock.Stdout.Trim(),[ref]$epoch)-or[Math]::Abs($epoch-[datetimeoffset]::UtcNow.ToUnixTimeSeconds())-gt300){throw 'HARVEST_RIDGE_CLOCK_FAILED: ordinary database clock was not restored.'}
  try{$auth=Invoke-WebRequest -UseBasicParsing -Uri "$ApiUrl/auth/v1/health" -TimeoutSec 10;if($auth.StatusCode-ne200-or$auth.Content-notmatch'"name"\s*:\s*"GoTrue"'){throw 'not ready'}}catch{throw 'HARVEST_RIDGE_CLOCK_FAILED: ordinary Auth/gateway health was not restored.'}
  if($null-ne$primary){throw $primary}
  if($ResumeRecovery){Write-Output "HARVEST_RIDGE_CLOCK_RECOVERY_PASS $Phase $FrozenInstant"}else{Write-Output "HARVEST_RIDGE_CLOCK_PHASE_PASS $Phase $FrozenInstant"}
  return $true
}

Export-ModuleMember -Function Invoke-HarvestRidgeClockPhase
