$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'maple-season-db-clock-swap-adapter.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'maple-season-db-clock-docker-adapter.psm1') -Force

function Assert-True([bool]$Value, [string]$Message) { if (-not $Value) { throw "ASSERTION_FAILED: $Message" } }
function Assert-Throws([scriptblock]$Action, [string]$Message) {
    try { & $Action; $threw = $false } catch { $threw = $true }
    Assert-True $threw $Message
}
function Assert-ArgvSeen($Calls,[string[]]$Expected,[string]$Message){
    $match=@($Calls|Where-Object{($_.Argv.Count-eq$Expected.Count)-and(($_.Argv-join"`0")-ceq($Expected-join"`0"))})
    Assert-True ($match.Count-ge 1) $Message
}

$hash = '9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5'
$originalId = 'c' * 64
$networkId = 'b' * 64
$owner = 'd' * 64
$prefix = 'maple-synthetic-regression'
$namespace = @{
    Mode='Synthetic'; Prefix=$prefix; OwnershipToken=$owner
    Db="$prefix-db"; Rest="$prefix-rest"; Parked="$prefix-parked"
    Network="$prefix-network"; Volume="$prefix-volume"; Port='65432'; ApiPort='65431'
}
$inventory = @{
    base_digest="public.ecr.aws/supabase/postgres@sha256:$hash"; contract_hash=('a' * 64)
    network_id=$networkId; original_id=$originalId; original_image_id="sha256:$hash"
    snapshot_tag="farmrx-clock-snapshot:$($originalId.Substring(0,12))"
    derived_tag='farmrx-frozen-clock-swap:20270709-9faa7279'; volume_name=$namespace.Volume
}
$contract = @{
    Id=$originalId; ImageId="sha256:$hash"; NetworkId=$networkId; VolumeName=$namespace.Volume
    Project='maple-synthetic'; ContractHash=('a' * 64); FrozenInstant='2027-07-09 21:10:00+00:00'
}
$proof = @{
    ArtifactImageRef='maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7@sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746'; ArtifactImageId='sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746'
    ApiPath='/rest/v1/maple_clock_proof?select=result'; ClockProofSql='clock proof sql'
    Database='postgres'; DbUser='postgres'; ExpectedApiResult='expected-row'
    ExpectedClockSample='2027-07-09|2027-07-09 21:10:00+00|2027-07-09 16:10:00-05'
    ExpectedRestDbHost=$namespace.Db; ExpectedRestDbUser='authenticator'
    PollAttempts=[int]4; PollMilliseconds=[int]100; WaitMilliseconds=[int]500
}

function New-Simulator {
    param([string]$Fault = '', [hashtable]$Overrides = @{})
    $simNamespace = $namespace.Clone()
    $simNetworkId = [string]$networkId
    $simOwner = [string]$owner
    $simOriginalId = [string]$originalId
    $simInventory = $inventory.Clone()
    $simProof = $proof.Clone()
    $state = @{
        Canonical='original'; OriginalRunning=$true; Parked=$false; ReplacementRunning=$false
        Snapshot=$false; Derived=$false; RestPid=20; RestRestart=0; BackendPid=100
        BackendStart='2027-01-01 00:00:00+00'; ClockCalls=0; RouteProofs=0
        Fault=$Fault; FaultUsed=$false; FaultSeen=0; FaultAt=1; JournalWrites=0
        SimOwner=$simOwner
        OriginalImage="sha256:$hash"; ReplacementImage=('2' * 64 | ForEach-Object { "sha256:$_" })
        SnapshotId=('1' * 64 | ForEach-Object { "sha256:$_" }); DerivedId=('2' * 64 | ForEach-Object { "sha256:$_" })
        OriginalRestart='unless-stopped'; ReplacementRestart='no'; DbAliases=@('db','db.supabase.internal')
        MountSource="/var/lib/docker/volumes/$($simNamespace.Volume)/_data"; MountName=$simNamespace.Volume
        NetworkId=$simNetworkId; HostPort=$simNamespace.Port; HealthTest=@('CMD','pg_isready','-U','postgres','-h','127.0.0.1','-p','5432')
        VolumeExtra=@(); InspectDaemonFailure=$false; HttpStatus=200; StaleBackend=$false; DriftClock=$false
        DbReadyAfter=0; DbInspectAfterStart=0; RestReadyAfter=0; RestInspectAfterRestart=0; BackendReadyAfter=0; BackendPollAfterRestart=0; Restarted=$false
        SyntheticNetworkOwner=$simOwner; SyntheticVolumeOwner=$simOwner
        ContainerNotFound='container'; ImageNotFound='image'; SyntheticInspectFailure=$false
        ArtifactMissing=$false;ArtifactInspectFailure=$false;ArtifactMalformed=$false;ArtifactId='sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746'
        ArtifactLabels=@{'farmrx.synthetic-bootstrap'='225c197c34164c90b08a4c8b6b10e6c7';'farmrx.synthetic-owner'='maple-faketime-bootstrap';'farmrx.synthetic-role'='faketime-artifacts';'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev'}
        ArtifactTagMissing=$false;ArtifactTagInspectFailure=$false;ArtifactTagMalformed=$false;ArtifactTagId='sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746'
        ArtifactTagLabels=@{'farmrx.synthetic-bootstrap'='225c197c34164c90b08a4c8b6b10e6c7';'farmrx.synthetic-owner'='maple-faketime-bootstrap';'farmrx.synthetic-role'='faketime-artifacts';'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev'}
    }
    foreach ($key in $Overrides.Keys) { $state[$key] = $Overrides[$key] }
    $calls = [Collections.Generic.List[object]]::new()

    $containerJson = {
        param([string]$Kind)
        if ($Kind -ceq 'missing') { return $null }
        $isRest = $Kind -ceq 'rest'; $isReplacement = $Kind -ceq 'replacement'
        $id = if ($isRest) { 'f' * 64 } elseif ($isReplacement) { '9' * 64 } else { $simOriginalId }
        $running = if ($isRest) { $true } elseif ($isReplacement) { $state.ReplacementRunning } else { $state.OriginalRunning }
        $image = if ($isRest) { 'sha256:' + ('7' * 64) } elseif ($isReplacement) { $state.ReplacementImage } else { $state.OriginalImage }
        $restart = if ($isRest) { 'unless-stopped' } elseif ($isReplacement) { $state.ReplacementRestart } else { $state.OriginalRestart }
        $labels = if ($isReplacement) { @{ 'farmrx.maple-clock-swap'=$state.SimOwner } } else { @{} }
        $aliases = if ($isRest) { @($simNamespace.Rest) } else { @($state.DbAliases) }
        $mounts = if ($isRest) { @() } else { @(@{ Type='volume'; Name=$state.MountName; Source=$state.MountSource; Destination='/var/lib/postgresql/data'; RW=$true }) }
        $ports = if ($isRest) { @{} } else { @{ '5432/tcp'=@(@{ HostIp=''; HostPort=$state.HostPort }) } }
        $health = if ($isRest) { $null } else { @{ Test=@($state.HealthTest); Interval=10000000000; Timeout=2000000000; Retries=3 } }
        $ip = if ($isRest) { '172.30.0.7' } elseif ($isReplacement) { '172.30.0.9' } else { '172.30.0.8' }
        if(-not$isRest-and$running){$state.DbInspectAfterStart++;$healthy=$state.DbInspectAfterStart-gt$state.DbReadyAfter}
        elseif($isRest-and$state.Restarted){$state.RestInspectAfterRestart++;$healthy=$state.RestInspectAfterRestart-gt$state.RestReadyAfter}
        else{$healthy=$running}
        return (@{
            Id=$id; Name="/$Kind"; Image=$image; Running=$running; ExitCode=0; OomKilled=$false
            Pid=if ($isRest) { $state.RestPid } elseif ($running) { 10 } else { 0 }
            Health=if ($healthy) { 'healthy' } else { 'starting' }; RestartCount=if ($isRest) { $state.RestRestart } else { 0 }
            RestartPolicy=$restart; Labels=$labels; Mounts=$mounts
            Networks=@{ $simNamespace.Network=@{ NetworkID=$state.NetworkId; IPAddress=$ip; Aliases=$aliases } }
            Ports=$ports; Healthcheck=$health
        } | ConvertTo-Json -Compress -Depth 9)
    }.GetNewClosure()

    $maybeFail = {
        param([string]$Operation)
        if ($state.Fault -ceq $Operation) {
            $state.FaultSeen++
            if (-not $state.FaultUsed -and $state.FaultSeen -eq $state.FaultAt) { $state.FaultUsed=$true; return $true }
        }
        return $false
    }.GetNewClosure()

    $invoke = {
        param([string]$Kind,[string[]]$Argv)
        $calls.Add([pscustomobject]@{ Kind=$Kind; Argv=@($Argv) })
        if ($Kind -ceq 'http_get') {
            return [pscustomobject]@{ ExitCode=0; Stdout=''; Stderr=''; StatusCode=$state.HttpStatus; Data=[pscustomobject]@{ ContractHash=('a'*64); Result='expected-row' } }
        }
        $command = $Argv[0]
        if ($command -ceq 'inspect') {
            if ($state.InspectDaemonFailure) { return [pscustomobject]@{ ExitCode=1; Stdout=''; Stderr='permission denied' } }
            $name=$Argv[-1]
            $which = if ($name -ceq $simNamespace.Rest) { 'rest' } elseif ($name -ceq $simNamespace.Parked -and $state.Parked) { 'original' } elseif ($name -ceq $simNamespace.Db -and $state.Canonical -ceq 'original') { 'original' } elseif ($name -ceq $simNamespace.Db -and $state.Canonical -ceq 'replacement') { 'replacement' } else { 'missing' }
            $json = & $containerJson $which
            if ($null -eq $json) {
                $stderr=switch($state.ContainerNotFound){'object'{"Error: No such object: $name"}'daemon-object'{"Error response from daemon: No such object: $name"}default{"Error: No such container: $name"}}
                return [pscustomobject]@{ ExitCode=1; Stdout=''; Stderr=$stderr }
            }
            return [pscustomobject]@{ ExitCode=0; Stdout=$json; Stderr='' }
        }
        if ($command -ceq 'image' -and $Argv[1] -ceq 'inspect') {
            $tag=$Argv[-1]; $exists=($tag -ceq $simInventory.snapshot_tag -and $state.Snapshot) -or ($tag -ceq $simInventory.derived_tag -and $state.Derived)
            if($tag-ceq$simProof.ArtifactImageRef){if($state.ArtifactInspectFailure){return [pscustomobject]@{ExitCode=1;Stdout='';Stderr='permission denied'}};if($state.ArtifactMissing){return [pscustomobject]@{ExitCode=1;Stdout='';Stderr="Error response from daemon: No such image: $tag"}};if($state.ArtifactMalformed){return [pscustomobject]@{ExitCode=0;Stdout='{';Stderr=''}};return [pscustomobject]@{ExitCode=0;Stdout=(@{Id=$state.ArtifactId;Labels=$state.ArtifactLabels}|ConvertTo-Json -Compress -Depth 5);Stderr=''}}
            if($tag-ceq'maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7:synthetic'){if($state.ArtifactTagInspectFailure){return [pscustomobject]@{ExitCode=1;Stdout='';Stderr='permission denied'}};if($state.ArtifactTagMissing){return [pscustomobject]@{ExitCode=1;Stdout='';Stderr="Error response from daemon: No such image: $tag"}};if($state.ArtifactTagMalformed){return [pscustomobject]@{ExitCode=0;Stdout='{';Stderr=''}};return [pscustomobject]@{ExitCode=0;Stdout=(@{Id=$state.ArtifactTagId;Labels=$state.ArtifactTagLabels}|ConvertTo-Json -Compress -Depth 5);Stderr=''}}
            if (-not $exists) {$stderr=if($state.ImageNotFound-ceq'object'){"Error response from daemon: No such object: $tag"}else{"Error response from daemon: No such image: $tag"};return [pscustomobject]@{ ExitCode=1; Stdout=''; Stderr=$stderr } }
            $imageId=if ($tag -ceq $simInventory.snapshot_tag) { $state.SnapshotId } else { $state.DerivedId }
            $labels=@{'farmrx.maple-clock-swap'=$state.SimOwner;'farmrx.maple-original-id'=$simOriginalId;'farmrx.maple-contract-hash'=('a'*64)}
            if($tag-ceq$simInventory.snapshot_tag){$labels.'farmrx.maple-clock-role'='ordinary-snapshot'}else{$labels.'farmrx.maple-clock-role'='frozen-derived';$labels.'farmrx.maple-clock-snapshot-id'=$state.SnapshotId}
            return [pscustomobject]@{ ExitCode=0; Stdout=(@{ Id=$imageId; Labels=$labels }|ConvertTo-Json -Compress); Stderr='' }
        }
        if($command -in @('network','volume') -and $Argv[1]-ceq'inspect'){
            if($state.SyntheticInspectFailure){return [pscustomobject]@{ExitCode=1;Stdout='';Stderr='permission denied'}}
            $resourceOwner=if($command-ceq'network'){$state.SyntheticNetworkOwner}else{$state.SyntheticVolumeOwner}
            $object=if($command-ceq'network'){@{Id=$state.NetworkId;Labels=@{'farmrx.maple-clock-swap'=$resourceOwner;'farmrx.maple-synthetic-prefix'=$simNamespace.Prefix}}}else{@{Name=$state.MountName;Labels=@{'farmrx.maple-clock-swap'=$resourceOwner;'farmrx.maple-synthetic-prefix'=$simNamespace.Prefix}}}
            return [pscustomobject]@{ExitCode=0;Stdout=($object|ConvertTo-Json -Compress -Depth 4);Stderr=''}
        }
        if ($command -ceq 'ps') {
            $users=@($simOriginalId); if ($state.Canonical -ceq 'replacement') { $users += '9'*64 }; $users += @($state.VolumeExtra)
            return [pscustomobject]@{ ExitCode=0; Stdout=($users -join [Environment]::NewLine); Stderr='' }
        }

        $operation = $command
        switch ($command) {
            'stop' { if ($state.Canonical -ceq 'original') { $state.OriginalRunning=$false } else { $state.ReplacementRunning=$false } }
            'commit' { $state.Snapshot=$true }
            'build' { $state.Derived=$true }
            'rename' { if ($Argv[1] -ceq $simNamespace.Db) { $state.Canonical='missing';$state.Parked=$true } else { $state.Parked=$false;$state.Canonical='original' } }
            'create' { $state.Canonical='replacement' }
            'start' { $state.DbInspectAfterStart=0;if ($state.Canonical -ceq 'replacement') { $state.ReplacementRunning=$true } else { $state.OriginalRunning=$true } }
            'restart' { $state.RestPid++;$state.RestRestart++;$state.Restarted=$true;$state.RestInspectAfterRestart=0;$state.BackendPollAfterRestart=0 }
            'rm' { $state.Canonical='missing';$state.ReplacementRunning=$false }
            'exec' {
                if ($Argv[2] -ceq 'getent') {
                    $dbIp = if ($state.Canonical -ceq 'replacement') { '172.30.0.9' } else { '172.30.0.8' }
                    return [pscustomobject]@{ ExitCode=0; Stdout="$dbIp $($Argv[-1])"; Stderr='' }
                }
                if (($Argv -join ' ') -match 'pg_stat_activity') {
                    if($state.Restarted){$state.BackendPollAfterRestart++;if(-not$state.StaleBackend-and$state.BackendPollAfterRestart-gt$state.BackendReadyAfter){$state.BackendPid++;$state.BackendStart="2027-01-01 00:00:$($state.BackendPid)+00";$state.Restarted=$false}}
                    return [pscustomobject]@{ ExitCode=0; Stdout="$($state.BackendPid)|$($state.BackendStart)|postgres|authenticator|172.30.0.7"; Stderr='' }
                }
                $state.ClockCalls++; $clock=if ($state.DriftClock -and $state.ClockCalls -ge 2) { 'drifted' } else { $simProof.ExpectedClockSample }
                return [pscustomobject]@{ ExitCode=0; Stdout=$clock; Stderr='' }
            }
            'image' { if ($Argv[1] -ceq 'rm') { if ($Argv[-1] -ceq $simInventory.snapshot_tag) { $state.Snapshot=$false } else { $state.Derived=$false } } }
        }
        if (& $maybeFail $operation) { return [pscustomobject]@{ ExitCode=17; Stdout=''; Stderr='simulated failure' } }
        return [pscustomobject]@{ ExitCode=0; Stdout=''; Stderr='' }
    }.GetNewClosure()
    $wait = { param([int]$Milliseconds); return ($Milliseconds -in @(100,500)) }.GetNewClosure()
    return [pscustomobject]@{ State=$state; Calls=$calls; Invoke=$invoke; Wait=$wait }
}

function New-TestAdapter($Simulator, [string]$JournalPath) {
    $invokeBlock=$Simulator.Invoke; $waitBlock=$Simulator.Wait
    New-MapleDockerSwapAdapter -Contract $contract -Inventory $inventory -ProofContract $proof -JournalPath $JournalPath -Invoke $invokeBlock -Wait $waitBlock -ResourceNamespace $namespace
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ('maple-docker-adapter-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp) | Out-Null
try {
    # Complete swap and recovery proves exact argv, stable two-sample clock, and journal-last cleanup.
    $sim=New-Simulator; $adapter=New-TestAdapter $sim (Join-Path $temp 'success.json')
    $successResult=Invoke-MapleSwapStateMachine $adapter $inventory
    Assert-True ($successResult -ceq 'MAPLE_DB_CLOCK_SWAP_ADAPTER_PASS') 'full state machine failed'
    Assert-True ($sim.State.Canonical -ceq 'original' -and $sim.State.OriginalRunning -and -not $sim.State.Snapshot -and -not $sim.State.Derived) 'recovery did not restore ordinary state'
    Assert-True ($sim.State.ClockCalls -eq 2) 'clock proof was not exactly two samples'
    $argvText=($sim.Calls | ForEach-Object { $_.Argv -join ' ' }) -join '|'
    Assert-True ($argvText -match 'ps -aq --no-trunc --filter') 'volume inspection omitted --no-trunc'
    Assert-True (-not ($argvText -match '(?i)rm -f|\bkill\b|POSTGRES_PASSWORD|JWT_SECRET|pgsodium|docker-entrypoint')) 'unsafe command or secret appeared'
    $snapshotChanges=@("LABEL farmrx.maple-clock-swap=$owner",'LABEL farmrx.maple-clock-role=ordinary-snapshot',"LABEL farmrx.maple-original-id=$originalId",("LABEL farmrx.maple-contract-hash="+('a'*64)))
    $expectedCommit=@('commit');foreach($change in $snapshotChanges){$expectedCommit+=@('--change',$change)};$expectedCommit+=@($namespace.Db,$inventory.snapshot_tag)
    Assert-ArgvSeen $sim.Calls $expectedCommit 'commit argv was not exact'
    $expectedBuild=@('build','--no-cache','--network=none','--pull=false','--label',"farmrx.maple-clock-swap=$owner",'--label','farmrx.maple-clock-role=frozen-derived','--label',"farmrx.maple-original-id=$originalId",'--label',("farmrx.maple-contract-hash="+('a'*64)),'--label',"farmrx.maple-clock-snapshot-id=$($sim.State.SnapshotId)",'--build-arg',"BASE_IMAGE=$($inventory.snapshot_tag)",'--build-arg','FAKETIME_ARTIFACTS_IMAGE=maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7:synthetic','--build-arg','FROZEN_INSTANT=2027-07-09 21:10:00+00:00','-f','tests/season/frozen-postgres-clock-spike.Dockerfile','-t',$inventory.derived_tag,'.')
    Assert-ArgvSeen $sim.Calls $expectedBuild 'build argv was not exact'
    $expectedCreate=@('create','--name',$namespace.Db,'--label',"farmrx.maple-clock-swap=$owner",'--label','com.docker.compose.project=maple-synthetic','--label','com.supabase.cli.project=maple-synthetic','--restart','no','--network',$namespace.Network,'--network-alias','db','--network-alias','db.supabase.internal','--publish','65432:5432','--volume',"$($namespace.Volume):/var/lib/postgresql/data:z",$inventory.derived_tag)
    Assert-ArgvSeen $sim.Calls $expectedCreate 'create argv was not exact'
    foreach($expected in @(@('restart','--time','60',$namespace.Rest),@('rm',$namespace.Db),@('image','rm',$inventory.derived_tag),@('image','rm',$inventory.snapshot_tag))){Assert-ArgvSeen $sim.Calls $expected "cleanup/restart argv missing: $($expected-join' ')"}
    foreach($expected in @(
        @('stop','--time','60',$namespace.Db),@('rename',$namespace.Db,$namespace.Parked),@('rename',$namespace.Parked,$namespace.Db),@('start',$namespace.Db),
        @('exec',$namespace.Rest,'getent','hosts',$namespace.Db),@('exec',$namespace.Rest,'getent','hosts','db'),@('exec',$namespace.Rest,'getent','hosts','db.supabase.internal'),
        @('exec',$namespace.Db,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',"select pid||'|'||backend_start||'|'||datname||'|'||usename||'|'||client_addr from pg_stat_activity where application_name ilike '%postgrest%' order by pid;"),
        @('exec',$namespace.Db,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',$proof.ClockProofSql)
    )){Assert-ArgvSeen $sim.Calls $expected "exact lifecycle/proof argv missing: $($expected-join' ')"}
    Assert-ArgvSeen (@($sim.Calls|Where-Object Kind -ceq 'http_get')) @("http://127.0.0.1:65431$($proof.ApiPath)",'authenticated-expected-contract') 'HTTP proof argv was not exact'
    $containerFormat='{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Running":{{json .State.Running}},"ExitCode":{{json .State.ExitCode}},"OomKilled":{{json .State.OOMKilled}},"Pid":{{json .State.Pid}},"Health":{{json .State.Health.Status}},"RestartCount":{{json .RestartCount}},"RestartPolicy":{{json .HostConfig.RestartPolicy.Name}},"Labels":{{json .Config.Labels}},"Mounts":{{json .Mounts}},"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .HostConfig.PortBindings}},"Healthcheck":{{json .Config.Healthcheck}}}'
    $imageFormat='{"Id":{{json .Id}},"Labels":{{json .Config.Labels}}}'
    $networkFormat='{"Id":{{json .Id}},"Labels":{{json .Labels}}}';$volumeFormat='{"Name":{{json .Name}},"Labels":{{json .Labels}}}'
    foreach($expected in @(
        @('inspect','--type','container','--format',$containerFormat,$namespace.Db),@('inspect','--type','container','--format',$containerFormat,$namespace.Parked),@('inspect','--type','container','--format',$containerFormat,$namespace.Rest),
        @('image','inspect','--format',$imageFormat,$inventory.snapshot_tag),@('image','inspect','--format',$imageFormat,$inventory.derived_tag),@('image','inspect','--format',$imageFormat,$proof.ArtifactImageRef),@('image','inspect','--format',$imageFormat,'maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7:synthetic'),
        @('network','inspect','--format',$networkFormat,$namespace.Network),@('volume','inspect','--format',$volumeFormat,$namespace.Volume)
    )){Assert-ArgvSeen $sim.Calls $expected "exact inspect argv missing: $($expected-join' ')"}

    # Bounded readiness polling supports delayed readiness and fails closed at timeout.
    $delayed=New-Simulator -Overrides @{DbReadyAfter=2;RestReadyAfter=2;BackendReadyAfter=2};$delayedAdapter=New-TestAdapter $delayed (Join-Path $temp 'delayed.json')
    Assert-True ((Invoke-MapleSwapStateMachine $delayedAdapter $inventory)-ceq'MAPLE_DB_CLOCK_SWAP_ADAPTER_PASS') 'delayed readiness did not converge'
    $timeout=New-Simulator -Overrides @{DbReadyAfter=99};$timeoutAdapter=New-TestAdapter $timeout (Join-Path $temp 'timeout.json')
    Assert-Throws{Invoke-MapleSwapStateMachine $timeoutAdapter $inventory|Out-Null}'database readiness timeout was accepted'

    # A brand-new adapter reconstructs image/replacement identity at each crash-persisted phase.
    $phases=@(
        @{Name='stopped';Values=@{Canonical='original';OriginalRunning=$false}},
        @{Name='snapshot';Values=@{Canonical='original';OriginalRunning=$false;Snapshot=$true}},
        @{Name='derived';Values=@{Canonical='original';OriginalRunning=$false;Snapshot=$true;Derived=$true}},
        @{Name='parked';Values=@{Canonical='missing';OriginalRunning=$false;Parked=$true;Snapshot=$true;Derived=$true}},
        @{Name='created';Values=@{Canonical='replacement';OriginalRunning=$false;Parked=$true;Snapshot=$true;Derived=$true;ReplacementRunning=$false}},
        @{Name='started';Values=@{Canonical='replacement';OriginalRunning=$false;Parked=$true;Snapshot=$true;Derived=$true;ReplacementRunning=$true}}
    )
    foreach($phase in $phases){
        $crash=New-Simulator -Overrides $phase.Values;$journal=Join-Path $temp "crash-$($phase.Name).json";[IO.File]::WriteAllText($journal,'{}')
        $fresh=New-TestAdapter $crash $journal;$recovery=Invoke-MapleSwapRecovery $fresh $inventory
        Assert-True $recovery.Restored "fresh adapter recovery failed at $($phase.Name): $($recovery.Failures -join '; ')"
        Assert-True (-not[IO.File]::Exists($journal)) "fresh adapter retained journal after $($phase.Name) recovery"
    }

    # Every mutation may report failure after taking effect; recovery must still restore safely.
    foreach ($fault in @('stop','commit','build','rename','create','start','restart','rm','image')) {
        $case=New-Simulator -Fault $fault; $journal=Join-Path $temp "fault-$fault.json"; $caseAdapter=New-TestAdapter $case $journal
        Assert-Throws { Invoke-MapleSwapStateMachine $caseAdapter $inventory | Out-Null } "after-mutation $fault failure was accepted"
        if ($fault -notin @('rm','image')) { Assert-True ($case.State.Canonical -ceq 'original' -and $case.State.OriginalRunning) "$fault failure did not recover original" }
    }
    foreach ($recoveryFault in @(
        @{Command='stop';At=2}, @{Command='rename';At=2}, @{Command='start';At=2},
        @{Command='restart';At=2}, @{Command='rm';At=1}, @{Command='image';At=1}
    )) {
        $case=New-Simulator -Fault $recoveryFault.Command -Overrides @{FaultAt=$recoveryFault.At}
        $journal=Join-Path $temp "recovery-$($recoveryFault.Command)-$($recoveryFault.At).json"
        $caseAdapter=New-TestAdapter $case $journal
        Assert-Throws { Invoke-MapleSwapStateMachine $caseAdapter $inventory | Out-Null } "recovery $($recoveryFault.Command) failure was accepted"
        Assert-True ([IO.File]::Exists($journal)) "recovery $($recoveryFault.Command) failure removed its journal"
    }

    # Inspection differentiates exact not-found from daemon/permission failure.
    $daemon=New-Simulator -Overrides @{InspectDaemonFailure=$true}; $daemonAdapter=New-TestAdapter $daemon (Join-Path $temp 'daemon.json')
    Assert-Throws { & $daemonAdapter.InspectActualState | Out-Null } 'daemon inspection failure was treated as missing'
    foreach($style in @('object','daemon-object')){$case=New-Simulator -Overrides @{ContainerNotFound=$style;ImageNotFound='object'};$a=New-TestAdapter $case (Join-Path $temp "notfound-$style.json");Assert-True ((&$a.InspectActualState).OriginalCanonical) "exact $style not-found variant was rejected"}

    # Runtime/image/config spoofing and unsafe volume ownership fail closed.
    $negative=@(
        @{Name='original image';Overrides=@{OriginalImage='sha256:'+('8'*64)}},
        @{Name='restart policy';Overrides=@{OriginalRestart='always'}},
        @{Name='published port';Overrides=@{HostPort='60000'}},
        @{Name='network id';Overrides=@{NetworkId=('3'*64)}},
        @{Name='aliases';Overrides=@{DbAliases=@('db')}},
        @{Name='health';Overrides=@{HealthTest=@('CMD','true')}},
        @{Name='mount source';Overrides=@{MountSource='/tmp/not-owned'}},
        @{Name='unexpected volume user';Overrides=@{VolumeExtra=@('4'*64)}},
        @{Name='truncated volume user';Overrides=@{VolumeExtra=@('123456789abc')}}
        @{Name='foreign synthetic network';Overrides=@{SyntheticNetworkOwner=('5'*64)}},
        @{Name='foreign synthetic volume';Overrides=@{SyntheticVolumeOwner=('6'*64)}},
        @{Name='missing synthetic network owner';Overrides=@{SyntheticNetworkOwner=$null}},
        @{Name='missing synthetic volume owner';Overrides=@{SyntheticVolumeOwner=$null}},
        @{Name='synthetic inspect daemon';Overrides=@{SyntheticInspectFailure=$true}}
    )
    foreach($item in $negative){$case=New-Simulator -Overrides $item.Overrides;$a=New-TestAdapter $case (Join-Path $temp (($item.Name-replace' ','-')+'.json'));Assert-Throws{&$a.InspectActualState|Out-Null}"$($item.Name) spoof accepted"}

    # Route proof negatives: HTTP 500, stale backend, and second clock drift.
    foreach($item in @(
        @{Name='http500';Overrides=@{HttpStatus=500}},
        @{Name='stale-backend';Overrides=@{StaleBackend=$true}},
        @{Name='clock-drift';Overrides=@{DriftClock=$true}}
    )){
        $case=New-Simulator -Overrides $item.Overrides;$a=New-TestAdapter $case (Join-Path $temp "$($item.Name).json")
        Assert-Throws{Invoke-MapleSwapStateMachine $a $inventory|Out-Null}"$($item.Name) route proof accepted"
    }

    # An already-stopped owned replacement is removed without another stop and without force.
    $stopped=New-Simulator;$stopped.State.Canonical='replacement';$stopped.State.OriginalRunning=$false;$stopped.State.Parked=$true;$stopped.State.ReplacementRunning=$false;$stopped.State.Snapshot=$true;$stopped.State.Derived=$true
    $stoppedAdapter=New-TestAdapter $stopped (Join-Path $temp 'stopped.json')
    $before=$stopped.Calls.Count; Assert-True ((&$stoppedAdapter.RemoveReplacement)-eq $true) 'stopped replacement removal failed'
    $removalCalls=@($stopped.Calls | Select-Object -Skip $before);Assert-True (@($removalCalls|Where-Object{$_.Argv[0]-ceq'stop'}).Count-eq 0) 'stopped replacement was stopped again'
    Assert-True (@($removalCalls|Where-Object{($_.Argv -join ' ') -match 'rm -f'}).Count-eq 0) 'force removal used'

    # Synthetic namespace is explicit, prefix-owned, and rejects every production reserved value even when permuted.
    $reservedNames=@('supabase_db_farmrx-farmer-simplicity-2027-local','supabase_rest_farmrx-farmer-simplicity-2027-local','supabase_db_farmrx-farmer-simplicity-2027-local-ordinary-parked','supabase_network_farmrx-farmer-simplicity-2027-local')
    foreach($field in @('Db','Rest','Parked','Network','Volume')){foreach($value in $reservedNames){$bad=$namespace.Clone();$bad[$field]=$value;$localSim=New-Simulator;Assert-Throws{New-MapleDockerSwapAdapter -Contract $contract -Inventory $inventory -ProofContract $proof -JournalPath (Join-Path $temp 'reserved.json') -Invoke $localSim.Invoke -Wait $localSim.Wait -ResourceNamespace $bad|Out-Null}"reserved value $value accepted in $field"}}
    foreach($field in @('Port','ApiPort')){foreach($value in @('55322','55321')){$bad=$namespace.Clone();$bad[$field]=$value;$localSim=New-Simulator;Assert-Throws{New-MapleDockerSwapAdapter -Contract $contract -Inventory $inventory -ProofContract $proof -JournalPath (Join-Path $temp 'reserved-port.json') -Invoke $localSim.Invoke -Wait $localSim.Wait -ResourceNamespace $bad|Out-Null}"reserved port $value accepted in $field"}}
    $badPrefix=$namespace.Clone();$badPrefix.Db='arbitrary-real-local-db';$localSim=New-Simulator;Assert-Throws{New-MapleDockerSwapAdapter -Contract $contract -Inventory $inventory -ProofContract $proof -JournalPath (Join-Path $temp 'prefix.json') -Invoke $localSim.Invoke -Wait $localSim.Wait -ResourceNamespace $badPrefix|Out-Null}'unowned synthetic name accepted'
    $badProof=$proof.Clone();$badProof.ExpectedRestDbUser='postgres';$localSim=New-Simulator
    Assert-Throws{New-MapleDockerSwapAdapter -Contract $contract -Inventory $inventory -ProofContract $badProof -JournalPath (Join-Path $temp 'bad-rest-user.json') -Invoke $localSim.Invoke -Wait $localSim.Wait -ResourceNamespace $namespace|Out-Null}'non-authenticator PostgREST user accepted'
    foreach($mutation in @(@{Key='ArtifactImageRef';Value='maple-faketime-artifacts:latest'},@{Key='ArtifactImageRef';Value='maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7@sha256:'+('a'*64)},@{Key='ArtifactImageId';Value='sha256:'+('a'*64)},@{Key='ArtifactImageId';Value=$null})){$badProof=$proof.Clone();$badProof[$mutation.Key]=$mutation.Value;$localSim=New-Simulator;Assert-Throws{New-MapleDockerSwapAdapter -Contract $contract -Inventory $inventory -ProofContract $badProof -JournalPath (Join-Path $temp 'bad-artifact.json') -Invoke $localSim.Invoke -Wait $localSim.Wait -ResourceNamespace $namespace|Out-Null}"unsafe $($mutation.Key) artifact identity accepted"}
    $artifactCases=@(@{Name='missing';Overrides=@{Snapshot=$true;ArtifactMissing=$true}},@{Name='wrong-id';Overrides=@{Snapshot=$true;ArtifactId='sha256:'+('a'*64)}},@{Name='malformed';Overrides=@{Snapshot=$true;ArtifactMalformed=$true}},@{Name='daemon';Overrides=@{Snapshot=$true;ArtifactInspectFailure=$true}})
    $exactArtifactLabels=@{'farmrx.synthetic-bootstrap'='225c197c34164c90b08a4c8b6b10e6c7';'farmrx.synthetic-owner'='maple-faketime-bootstrap';'farmrx.synthetic-role'='faketime-artifacts';'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev'}
    foreach($label in @($exactArtifactLabels.Keys)){foreach($mode in @('missing','wrong')){$labels=$exactArtifactLabels.Clone();if($mode-ceq'missing'){$labels.Remove($label)}else{$labels[$label]='wrong'};$artifactCases+=@{Name="$mode-$label";Overrides=@{Snapshot=$true;ArtifactLabels=$labels}}}}
    foreach($case in $artifactCases){$localSim=New-Simulator -Overrides $case.Overrides;$a=New-TestAdapter $localSim (Join-Path $temp ("artifact-"+$case.Name+'.json'));Assert-Throws{& $a.BuildDerived|Out-Null}"artifact inspect case accepted: $($case.Name)"}
    $tagCases=@(@{Name='tag-missing';Overrides=@{Snapshot=$true;ArtifactTagMissing=$true}},@{Name='tag-wrong-id';Overrides=@{Snapshot=$true;ArtifactTagId='sha256:'+('a'*64)}},@{Name='tag-malformed';Overrides=@{Snapshot=$true;ArtifactTagMalformed=$true}},@{Name='tag-daemon';Overrides=@{Snapshot=$true;ArtifactTagInspectFailure=$true}})
    foreach($label in @($exactArtifactLabels.Keys)){foreach($mode in @('missing','wrong')){$labels=$exactArtifactLabels.Clone();if($mode-ceq'missing'){$labels.Remove($label)}else{$labels[$label]='wrong'};$tagCases+=@{Name="tag-$mode-$label";Overrides=@{Snapshot=$true;ArtifactTagLabels=$labels}}}}
    foreach($case in $tagCases){$localSim=New-Simulator -Overrides $case.Overrides;$a=New-TestAdapter $localSim (Join-Path $temp ($case.Name+'.json'));Assert-Throws{& $a.BuildDerived|Out-Null}"tag artifact inspect case accepted: $($case.Name)";Assert-True (@($localSim.Calls|Where-Object{$_.Kind-ceq'docker'-and$_.Argv[0]-ceq'build'}).Count-eq0)"build recorded after tag refusal: $($case.Name)"}

    # Route attestation is reset by every topology mutation.
    $route=New-Simulator;$routeAdapter=New-TestAdapter $route (Join-Path $temp 'route-reset.json');$null=&$routeAdapter.ProveRouteClockAndLineage
    Assert-True ((&$routeAdapter.InspectActualState).PostgrestRecovered) 'route proof did not attest';$null=&$routeAdapter.StopOriginal
    Assert-True (-not (&$routeAdapter.InspectActualState).PostgrestRecovered) 'topology mutation did not reset shared route attestation'

    Write-Output 'MAPLE_SEASON_DB_CLOCK_DOCKER_ADAPTER_REGRESSION_PASS'
}
finally {
    Get-ChildItem -LiteralPath $temp -Force -ErrorAction SilentlyContinue | Remove-Item -Force
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}
