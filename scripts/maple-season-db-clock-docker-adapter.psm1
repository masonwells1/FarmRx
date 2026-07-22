Set-StrictMode -Version Latest

$script:ProductionNamespace = [ordered]@{
    Db      = 'supabase_db_farmrx-farmer-simplicity-2027-local'
    Rest    = 'supabase_rest_farmrx-farmer-simplicity-2027-local'
    Parked  = 'supabase_db_farmrx-farmer-simplicity-2027-local-ordinary-parked'
    Network = 'supabase_network_farmrx-farmer-simplicity-2027-local'
    Volume  = 'supabase_db_farmrx-farmer-simplicity-2027-local'
    Port    = '55322'
    ApiPort = '55321'
}

function Assert-ExactKeys {
    param([hashtable]$Value, [string[]]$Keys, [string]$Name)
    if ((@($Value.Keys | Sort-Object) -join '|') -cne (@($Keys | Sort-Object) -join '|')) {
        throw "MAPLE_DOCKER_ADAPTER_REFUSED: $Name schema is not exact."
    }
}

function Assert-SyntheticNamespace {
    param([hashtable]$Namespace)

    $keys = @('Mode','Prefix','OwnershipToken','Db','Rest','Parked','Network','Volume','Port','ApiPort')
    Assert-ExactKeys $Namespace $keys 'synthetic namespace'
    if ($Namespace.Mode -cne 'Synthetic') { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: synthetic mode must be explicit.' }
    if ($Namespace.Prefix -notmatch '^maple-synthetic-[a-z0-9][a-z0-9-]{7,40}$') { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: invalid synthetic prefix.' }
    if ($Namespace.OwnershipToken -notmatch '^[0-9a-f]{64}$') { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: invalid synthetic ownership token.' }

    $reserved = @($script:ProductionNamespace.Values)
    foreach ($key in @('Db','Rest','Parked','Network','Volume','Port','ApiPort')) {
        $value = [string]$Namespace[$key]
        if ([string]::IsNullOrWhiteSpace($value)) { throw "MAPLE_DOCKER_ADAPTER_REFUSED: blank synthetic $key." }
        if (@($reserved | Where-Object { $_ -ieq $value }).Count -ne 0) { throw "MAPLE_DOCKER_ADAPTER_REFUSED: synthetic $key selects a production-reserved value." }
    }
    foreach ($key in @('Db','Rest','Parked','Network','Volume')) {
        if (-not ([string]$Namespace[$key]).StartsWith($Namespace.Prefix + '-', [StringComparison]::Ordinal)) {
            throw "MAPLE_DOCKER_ADAPTER_REFUSED: synthetic $key is outside its owned prefix."
        }
    }
    if ($Namespace.Port -notmatch '^6[0-9]{4}$' -or $Namespace.ApiPort -notmatch '^6[0-9]{4}$' -or $Namespace.Port -ceq $Namespace.ApiPort) {
        throw 'MAPLE_DOCKER_ADAPTER_REFUSED: synthetic ports are not isolated.'
    }
}

function New-MapleDockerSwapAdapter {
    param(
        [Parameter(Mandatory)][hashtable]$Contract,
        [Parameter(Mandatory)][hashtable]$Inventory,
        [Parameter(Mandatory)][hashtable]$ProofContract,
        [Parameter(Mandatory)][string]$JournalPath,
        [Parameter(Mandatory)][scriptblock]$Invoke,
        [Parameter(Mandatory)][scriptblock]$Wait,
        [hashtable]$ResourceNamespace
    )

    if ($null -eq $Invoke -or $null -eq $Wait) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: reviewed argv invoker and bounded wait are required.' }
    $contractKeys = @('Id','ImageId','NetworkId','VolumeName','Project','ContractHash','FrozenInstant')
    $proofKeys = @('ApiPath','ArtifactImageId','ArtifactImageRef','ClockProofSql','Database','DbUser','ExpectedApiResult','ExpectedClockSample','ExpectedRestDbHost','ExpectedRestDbUser','PollAttempts','PollMilliseconds','WaitMilliseconds')
    Assert-ExactKeys $Contract $contractKeys 'swap contract'
    Assert-ExactKeys $ProofContract $proofKeys 'proof contract'
    $frozen=[datetimeoffset]::MinValue
    $frozenFormat='yyyy-MM-dd HH:mm:sszzz'
    $frozenParsed=[datetimeoffset]::TryParseExact($Contract.FrozenInstant,$frozenFormat,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$frozen)
    if (-not $frozenParsed -or $frozen.Year -ne 2027 -or $frozen.Month -lt 7 -or $frozen.Month -gt 12 -or $frozen.Offset -ne [timespan]::Zero -or
        $Contract.FrozenInstant -cne $frozen.ToString($frozenFormat,[Globalization.CultureInfo]::InvariantCulture)) {
        throw 'MAPLE_DOCKER_ADAPTER_REFUSED: frozen instant must be an exact July-December 2027 UTC value.'
    }
    if ($ProofContract.WaitMilliseconds -isnot [int] -or $ProofContract.WaitMilliseconds -lt 250 -or $ProofContract.WaitMilliseconds -gt 5000) {
        throw 'MAPLE_DOCKER_ADAPTER_REFUSED: proof wait is not bounded.'
    }
    if ($ProofContract.PollMilliseconds -isnot [int] -or $ProofContract.PollMilliseconds -lt 100 -or $ProofContract.PollMilliseconds -gt 2000 -or
        $ProofContract.PollAttempts -isnot [int] -or $ProofContract.PollAttempts -lt 2 -or $ProofContract.PollAttempts -gt 60) {
        throw 'MAPLE_DOCKER_ADAPTER_REFUSED: readiness poll is not bounded.'
    }
    foreach ($key in @('ApiPath','ClockProofSql','Database','DbUser','ExpectedApiResult','ExpectedClockSample','ExpectedRestDbHost','ExpectedRestDbUser')) {
        if ([string]::IsNullOrWhiteSpace([string]$ProofContract[$key])) { throw "MAPLE_DOCKER_ADAPTER_REFUSED: blank proof $key." }
    }
    if ($ProofContract.ExpectedRestDbUser -cne 'authenticator') { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: PostgREST database user must be authenticator.' }
    $artifactRef='maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7@sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746'
    $artifactId='sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746'
    $artifactLocalTag='maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7:synthetic'
    $artifactExpectedLabels=[ordered]@{'farmrx.synthetic-bootstrap'='225c197c34164c90b08a4c8b6b10e6c7';'farmrx.synthetic-owner'='maple-faketime-bootstrap';'farmrx.synthetic-role'='faketime-artifacts';'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev'}
    if($ProofContract.ArtifactImageRef-cne$artifactRef-or$ProofContract.ArtifactImageId-cne$artifactId){throw 'MAPLE_DOCKER_ADAPTER_REFUSED: faketime artifact identity is not the reviewed literal.'}

    $names = if ($null -eq $ResourceNamespace) { $script:ProductionNamespace.Clone() } else { Assert-SyntheticNamespace $ResourceNamespace; $ResourceNamespace.Clone() }
    if ($Contract.Id -cne $Inventory.original_id -or $Contract.ImageId -cne $Inventory.original_image_id -or
        $Contract.NetworkId -cne $Inventory.network_id -or $Contract.VolumeName -cne $Inventory.volume_name -or
        $Contract.ContractHash -cne $Inventory.contract_hash) {
        throw 'MAPLE_DOCKER_ADAPTER_REFUSED: contract and inventory do not match.'
    }
    if ($names.Volume -cne $Inventory.volume_name) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: namespace volume is not attested.' }
    if ($ProofContract.ExpectedRestDbHost -cne $names.Db) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: PostgREST host proof is not canonical.' }

    $owner = if ($null -eq $ResourceNamespace) { $Inventory.original_id } else { $ResourceNamespace.OwnershipToken }
    $ownerLabel = "farmrx.maple-clock-swap=$owner"
    $route = @{ Attested = $false }
    $metadata = @{
        Owner=$owner; Original=$Inventory.original_id; Contract=$Inventory.contract_hash
        SnapshotRole='ordinary-snapshot'; DerivedRole='frozen-derived'
    }

    $call = {
        param([string]$Kind, [string[]]$Argv)
        $result = & $Invoke $Kind $Argv
        if ($null -eq $result -or $null -eq $result.PSObject.Properties['ExitCode'] -or
            $null -eq $result.PSObject.Properties['Stdout'] -or $null -eq $result.PSObject.Properties['Stderr']) {
            throw "MAPLE_DOCKER_ADAPTER_FAILED: malformed $Kind result."
        }
        return $result
    }.GetNewClosure()

    $checked = {
        param([string]$Kind, [string[]]$Argv, [string]$Operation)
        $result = & $call $Kind $Argv
        if ($result.ExitCode -ne 0) { throw "MAPLE_DOCKER_ADAPTER_FAILED: $Operation failed." }
        return $result
    }.GetNewClosure()

    $parseJson = {
        param($Result, [string]$What)
        try { return $Result.Stdout | ConvertFrom-Json -ErrorAction Stop }
        catch { throw "MAPLE_DOCKER_ADAPTER_REFUSED: malformed $What inspection." }
    }.GetNewClosure()
    $getLabel = {
        param($Object,[string]$Name)
        if ($null -eq $Object -or $null -eq $Object.Labels) { return $null }
        $property = $Object.Labels.PSObject.Properties | Where-Object { $_.Name -ceq $Name } | Select-Object -First 1
        if ($null -eq $property) { return $null }
        return [string]$property.Value
    }.GetNewClosure()
    $assertArtifactIdentity={
        param($Artifact,[string]$Reference)
        if($null-eq$Artifact-or$Artifact.Id-cne$artifactId){throw "MAPLE_DOCKER_ADAPTER_REFUSED: reviewed faketime artifact is missing or has the wrong ID: $Reference."}
        foreach($name in $artifactExpectedLabels.Keys){if((& $getLabel $Artifact $name)-cne$artifactExpectedLabels[$name]){throw "MAPLE_DOCKER_ADAPTER_REFUSED: reviewed faketime artifact label mismatch: $name."}}
        $true
    }.GetNewClosure()

    $containerFormat = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Running":{{json .State.Running}},"ExitCode":{{json .State.ExitCode}},"OomKilled":{{json .State.OOMKilled}},"Pid":{{json .State.Pid}},"Health":{{json .State.Health.Status}},"RestartCount":{{json .RestartCount}},"RestartPolicy":{{json .HostConfig.RestartPolicy.Name}},"Labels":{{json .Config.Labels}},"Mounts":{{json .Mounts}},"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .HostConfig.PortBindings}},"Healthcheck":{{json .Config.Healthcheck}}}'
    $imageFormat = '{"Id":{{json .Id}},"Labels":{{json .Config.Labels}}}'

    $inspectContainer = {
        param([string]$Name)
        $result = & $call docker @('inspect','--type','container','--format',$containerFormat,$Name)
        if ($result.ExitCode -eq 0) { return & $parseJson $result "container $Name" }
        $notFound = @("Error: No such container: $Name","Error: No such object: $Name","Error response from daemon: No such container: $Name","Error response from daemon: No such object: $Name")
        if ($result.ExitCode -eq 1 -and ([string]$result.Stderr).Trim() -cin $notFound) { return $null }
        throw "MAPLE_DOCKER_ADAPTER_FAILED: container inspection failed for $Name."
    }.GetNewClosure()

    $inspectImage = {
        param([string]$Name)
        $result = & $call docker @('image','inspect','--format',$imageFormat,$Name)
        if ($result.ExitCode -eq 0) { return & $parseJson $result "image $Name" }
        $notFound = @("Error: No such image: $Name","Error: No such object: $Name","Error response from daemon: No such image: $Name","Error response from daemon: No such object: $Name")
        if ($result.ExitCode -eq 1 -and ([string]$result.Stderr).Trim() -cin $notFound) { return $null }
        throw "MAPLE_DOCKER_ADAPTER_FAILED: image inspection failed for $Name."
    }.GetNewClosure()

    $assertSyntheticResources = {
        if ($null -eq $ResourceNamespace) { return }
        foreach ($resource in @(
            @{Kind='network';Name=$names.Network;Format='{"Id":{{json .Id}},"Labels":{{json .Labels}}}'},
            @{Kind='volume';Name=$names.Volume;Format='{"Name":{{json .Name}},"Labels":{{json .Labels}}}'}
        )) {
            $result = & $checked docker @($resource.Kind,'inspect','--format',$resource.Format,$resource.Name) "synthetic $($resource.Kind) inspection"
            $object = & $parseJson $result "synthetic $($resource.Kind)"
            if ((& $getLabel $object 'farmrx.maple-clock-swap') -cne $owner -or
                (& $getLabel $object 'farmrx.maple-synthetic-prefix') -cne $names.Prefix) {
                throw "MAPLE_DOCKER_ADAPTER_REFUSED: synthetic $($resource.Kind) ownership mismatch."
            }
            if ($resource.Kind -ceq 'network' -and $object.Id -cne $Inventory.network_id) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: synthetic network id mismatch.' }
            if ($resource.Kind -ceq 'volume' -and $object.Name -cne $Inventory.volume_name) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: synthetic volume name mismatch.' }
        }
    }.GetNewClosure()

    $assertMount = {
        param($State)
        if (@($State.Mounts).Count -ne 1) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: database mount count mismatch.' }
        $mount = $State.Mounts[0]
        if ($mount.Type -cne 'volume' -or $mount.Name -cne $names.Volume -or $mount.Source -cne "/var/lib/docker/volumes/$($names.Volume)/_data" -or
            $mount.Destination -cne '/var/lib/postgresql/data' -or $mount.RW -ne $true) {
            throw 'MAPLE_DOCKER_ADAPTER_REFUSED: database mount ownership mismatch.'
        }
    }.GetNewClosure()

    $assertNetwork = {
        param($State)
        $network = $State.Networks.($names.Network)
        if ($null -eq $network -or $network.NetworkID -cne $Inventory.network_id) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: database network mismatch.' }
        $aliases = @($network.Aliases | Sort-Object)
        if (($aliases -join '|') -cne ((@('db','db.supabase.internal') | Sort-Object) -join '|')) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: database aliases mismatch.' }
    }.GetNewClosure()

    $assertHealth = {
        param($State)
        $test = @($State.Healthcheck.Test)
        if (($test -join '|') -cne 'CMD|pg_isready|-U|postgres|-h|127.0.0.1|-p|5432' -or
            [long]$State.Healthcheck.Interval -ne 10000000000 -or [long]$State.Healthcheck.Timeout -ne 2000000000 -or
            [int]$State.Healthcheck.Retries -ne 3) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: database healthcheck mismatch.' }
    }.GetNewClosure()

    $assertPort = {
        param($State)
        $binding = $State.Ports.PSObject.Properties['5432/tcp']
        if ($null -eq $binding -or @($binding.Value).Count -ne 1 -or $binding.Value[0].HostIp -cne '' -or $binding.Value[0].HostPort -cne $names.Port) {
            throw 'MAPLE_DOCKER_ADAPTER_REFUSED: database published port mismatch.'
        }
    }.GetNewClosure()

    $inspectActualState = {
        & $assertSyntheticResources
        $canonical = & $inspectContainer $names.Db
        $parked = & $inspectContainer $names.Parked
        $rest = & $inspectContainer $names.Rest
        $snapshot = & $inspectImage $Inventory.snapshot_tag
        $derived = & $inspectImage $Inventory.derived_tag

        $restNetwork = if ($null -ne $rest) { $rest.Networks.($names.Network) } else { $null }
        if ($null -eq $restNetwork -or $restNetwork.NetworkID -cne $Inventory.network_id) {
            throw 'MAPLE_DOCKER_ADAPTER_REFUSED: PostgREST network identity mismatch.'
        }

        foreach ($db in @($canonical,$parked) | Where-Object { $null -ne $_ }) { & $assertMount $db; & $assertNetwork $db; & $assertHealth $db; & $assertPort $db }
        $canonicalOriginal = $null -ne $canonical -and $canonical.Id -ceq $Inventory.original_id
        $parkedOriginal = $null -ne $parked -and $parked.Id -ceq $Inventory.original_id
        if ($canonicalOriginal -and $null -ne $parked) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: canonical and parked ownership conflict.' }
        if ($null -ne $parked -and -not $parkedOriginal) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: parked ownership is ambiguous.' }
        if ($canonicalOriginal -and ($canonical.Image -cne $Inventory.original_image_id -or $canonical.RestartPolicy -cne 'unless-stopped')) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: original runtime identity mismatch.' }

        $snapshotOwned = $null -ne $snapshot -and
            (& $getLabel $snapshot 'farmrx.maple-clock-swap') -ceq $metadata.Owner -and
            (& $getLabel $snapshot 'farmrx.maple-clock-role') -ceq $metadata.SnapshotRole -and
            (& $getLabel $snapshot 'farmrx.maple-original-id') -ceq $metadata.Original -and
            (& $getLabel $snapshot 'farmrx.maple-contract-hash') -ceq $metadata.Contract
        $derivedOwned = $null -ne $derived -and $snapshotOwned -and
            (& $getLabel $derived 'farmrx.maple-clock-swap') -ceq $metadata.Owner -and
            (& $getLabel $derived 'farmrx.maple-clock-role') -ceq $metadata.DerivedRole -and
            (& $getLabel $derived 'farmrx.maple-original-id') -ceq $metadata.Original -and
            (& $getLabel $derived 'farmrx.maple-contract-hash') -ceq $metadata.Contract -and
            (& $getLabel $derived 'farmrx.maple-clock-snapshot-id') -ceq $snapshot.Id -and $derived.Id -cne $snapshot.Id

        $replacement = $null -ne $canonical -and -not $canonicalOriginal
        $replacementOwned = $false
        if ($replacement) {
            if ((& $getLabel $canonical 'farmrx.maple-clock-swap') -cne $owner) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: replacement owner label mismatch.' }
            if (-not $derivedOwned -or $canonical.Image -cne $derived.Id) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: replacement image identity mismatch.' }
            if ($canonical.RestartPolicy -cne 'no') { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: replacement restart policy mismatch.' }
            $replacementOwned = $true
        }

        $volumeResult = & $checked docker @('ps','-aq','--no-trunc','--filter',"volume=$($names.Volume)") 'volume-user inspection'
        $volumeUsers = @(([string]$volumeResult.Stdout -split "`r?`n") | Where-Object { $_ -ne '' })
        foreach ($containerId in $volumeUsers) { if ($containerId -notmatch '^[0-9a-f]{64}$') { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: truncated or invalid volume user.' } }
        $allowed = @($Inventory.original_id)
        if ($replacement) { $allowed += $canonical.Id }
        if (@($volumeUsers | Where-Object { $_ -cnotin $allowed }).Count -ne 0 -or @($volumeUsers | Select-Object -Unique).Count -ne $volumeUsers.Count) {
            throw 'MAPLE_DOCKER_ADAPTER_REFUSED: unexpected or duplicate volume user.'
        }

        [pscustomobject]@{
            OriginalCanonical = [bool]$canonicalOriginal
            OriginalParked = [bool]$parkedOriginal
            OriginalRunning = [bool](($canonicalOriginal -and $canonical.Running) -or ($parkedOriginal -and $parked.Running))
            OriginalHealthy = [bool](($canonicalOriginal -and $canonical.Health -ceq 'healthy') -or ($parkedOriginal -and $parked.Health -ceq 'healthy'))
            OriginalExitCode = if ($canonicalOriginal) { $canonical.ExitCode } elseif ($parkedOriginal) { $parked.ExitCode } else { $null }
            OriginalOomKilled = if ($canonicalOriginal) { $canonical.OomKilled } elseif ($parkedOriginal) { $parked.OomKilled } else { $null }
            ExclusiveVolume = [bool]($volumeUsers.Count -eq 1 -and $volumeUsers[0] -ceq $Inventory.original_id)
            ReplacementExists = [bool]$replacement
            ReplacementOwned = [bool]$replacementOwned
            ReplacementRunning = [bool]($replacement -and $canonical.Running)
            ReplacementHealthy = [bool]($replacement -and $canonical.Health -ceq 'healthy')
            DbIp = if ($null -ne $canonical) { $canonical.Networks.($names.Network).IPAddress } else { $null }
            RestIp = if ($null -ne $rest) { $rest.Networks.($names.Network).IPAddress } else { $null }
            PostgrestId = if ($null -ne $rest) { $rest.Id } else { $null }
            PostgrestPid = if ($null -ne $rest) { $rest.Pid } else { 0 }
            PostgrestRestartCount = if ($null -ne $rest) { $rest.RestartCount } else { -1 }
            PostgrestHealthy = [bool]($null -ne $rest -and $rest.Running -and $rest.Health -ceq 'healthy')
            PostgrestRecovered = [bool]($null -ne $rest -and $rest.Running -and $route.Attested)
            SnapshotOwned = [bool]$snapshotOwned
            DerivedOwned = [bool]$derivedOwned
            JournalExists = [IO.File]::Exists($JournalPath)
            ReplacementWasRunning = [bool]($replacement -and $canonical.Running)
        }
    }.GetNewClosure()

    $invokeTrue = { param([string[]]$Argv,[string]$Name); $null = & $checked docker $Argv $Name; return $true }.GetNewClosure()
    $resetRoute = { $route.Attested = $false }.GetNewClosure()

    $pollContainerHealthy = {
        param([string]$Name,[string]$Operation)
        for($attempt=1;$attempt -le $ProofContract.PollAttempts;$attempt++){
            $state=& $inspectContainer $Name
            if($null-ne$state -and $state.Running -and $state.Health -ceq'healthy'){return $true}
            if($attempt-lt$ProofContract.PollAttempts -and (& $Wait $ProofContract.PollMilliseconds)-ne$true){throw "MAPLE_DOCKER_ADAPTER_FAILED: $Operation poll wait failed."}
        }
        throw "MAPLE_DOCKER_ADAPTER_FAILED: $Operation readiness timed out."
    }.GetNewClosure()

    $queryBackend = {
        $sql = "select pid||'|'||backend_start||'|'||datname||'|'||usename||'|'||client_addr from pg_stat_activity where application_name ilike '%postgrest%' order by pid;"
        $result = & $checked docker @('exec',$names.Db,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U',$ProofContract.DbUser,'-d',$ProofContract.Database,'-c',$sql) 'PostgREST backend proof'
        $rows = @(([string]$result.Stdout -split "`r?`n") | Where-Object { $_ -ne '' })
        if ($rows.Count -ne 1) { throw 'MAPLE_DOCKER_ADAPTER_FAILED: exact PostgREST backend cardinality failed.' }
        $parts = @($rows[0] -split '\|')
        if ($parts.Count -ne 5 -or $parts[0] -notmatch '^[1-9][0-9]*$' -or [string]::IsNullOrWhiteSpace($parts[1]) -or
            $parts[2] -cne $ProofContract.Database -or $parts[3] -cne $ProofContract.ExpectedRestDbUser) { throw 'MAPLE_DOCKER_ADAPTER_FAILED: PostgREST backend identity failed.' }
        [pscustomobject]@{ Pid=$parts[0]; BackendStart=$parts[1]; ClientIp=$parts[4] }
    }.GetNewClosure()

    $proveRoute = {
        param([bool]$IncludeClock)
        & $resetRoute
        $beforeState = & $inspectActualState
        $beforeBackend = & $queryBackend
        $null = & $checked docker @('restart','--time','60',$names.Rest) 'PostgREST restart'
        $afterState=$null;$afterBackend=$null
        for($attempt=1;$attempt-le$ProofContract.PollAttempts;$attempt++){
            $candidateState=&$inspectActualState
            try{
                $candidateBackend=&$queryBackend
                $ready=$candidateState.PostgrestHealthy-and$candidateState.PostgrestId-ceq$beforeState.PostgrestId-and$candidateState.PostgrestPid-gt0-and$candidateState.PostgrestPid-ne$beforeState.PostgrestPid-and$candidateState.PostgrestRestartCount-gt$beforeState.PostgrestRestartCount-and
                    -not($candidateBackend.Pid-ceq$beforeBackend.Pid-and$candidateBackend.BackendStart-ceq$beforeBackend.BackendStart)-and$candidateBackend.ClientIp-ceq$candidateState.RestIp
                if($ready){$afterState=$candidateState;$afterBackend=$candidateBackend;break}
            }catch{}
            if($attempt-lt$ProofContract.PollAttempts-and(&$Wait $ProofContract.PollMilliseconds)-ne$true){throw 'MAPLE_DOCKER_ADAPTER_FAILED: PostgREST poll wait failed.'}
        }
        if($null-eq$afterState-or$null-eq$afterBackend){throw'MAPLE_DOCKER_ADAPTER_FAILED: PostgREST readiness/backend lineage timed out.'}
        foreach ($hostName in @($names.Db,'db','db.supabase.internal')) {
            $dns = & $checked docker @('exec',$names.Rest,'getent','hosts',$hostName) "DNS proof for $hostName"
            $tokens = @(([string]$dns.Stdout -split '\s+') | Where-Object { $_ -ne '' })
            if ($tokens.Count -lt 2 -or $tokens[0] -cne $afterState.DbIp -or $tokens[1] -cne $hostName) { throw "MAPLE_DOCKER_ADAPTER_FAILED: exact DNS proof failed for $hostName." }
        }
        $api = & $checked http_get @("http://127.0.0.1:$($names.ApiPort)$($ProofContract.ApiPath)",'authenticated-expected-contract') 'authenticated API read'
        if ($api.StatusCode -lt 200 -or $api.StatusCode -ge 300 -or $api.Data.ContractHash -cne $Contract.ContractHash -or $api.Data.Result -cne $ProofContract.ExpectedApiResult) {
            throw 'MAPLE_DOCKER_ADAPTER_FAILED: authenticated API proof failed.'
        }
        if ($IncludeClock) {
            $clockArgv = @('exec',$names.Db,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U',$ProofContract.DbUser,'-d',$ProofContract.Database,'-c',$ProofContract.ClockProofSql)
            $sampleOne = (& $checked docker $clockArgv 'first clock proof').Stdout.Trim()
            if ($sampleOne -cne $ProofContract.ExpectedClockSample) { throw 'MAPLE_DOCKER_ADAPTER_FAILED: first clock proof failed.' }
            if ((& $Wait $ProofContract.WaitMilliseconds) -ne $true) { throw 'MAPLE_DOCKER_ADAPTER_FAILED: bounded wait failed.' }
            $sampleTwo = (& $checked docker $clockArgv 'second clock proof').Stdout.Trim()
            if ($sampleTwo -cne $ProofContract.ExpectedClockSample -or $sampleTwo -cne $sampleOne) { throw 'MAPLE_DOCKER_ADAPTER_FAILED: stable clock proof failed.' }
        }
        $route.Attested = $true
        return $true
    }.GetNewClosure()

    $expectedInventory = $Inventory.Clone()
    if ($null -ne $ResourceNamespace) { $expectedInventory.test_only_expected_volume = $names.Volume }
    $adapter = @{ ExpectedContract=$expectedInventory; InspectActualState=$inspectActualState }
    $adapter.WriteJournal = { param($phase,$next,$inv); Write-MapleSwapJournalAtomic $JournalPath $phase $next $inv $expectedInventory }.GetNewClosure()
    $adapter.StopOriginal = { & $resetRoute; & $invokeTrue @('stop','--time','60',$names.Db) 'graceful original stop' }.GetNewClosure()
    $adapter.SnapshotOriginal = {
        if ($null -ne (& $inspectImage $Inventory.snapshot_tag)) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: snapshot tag already exists.' }
        $changes=@(
            "LABEL $ownerLabel",
            "LABEL farmrx.maple-clock-role=$($metadata.SnapshotRole)",
            "LABEL farmrx.maple-original-id=$($metadata.Original)",
            "LABEL farmrx.maple-contract-hash=$($metadata.Contract)"
        )
        $argv=@('commit');foreach($change in $changes){$argv+=@('--change',$change)};$argv+=@($names.Db,$Inventory.snapshot_tag)
        $null = & $checked docker $argv 'snapshot creation'
        $image = & $inspectImage $Inventory.snapshot_tag
        if ($null -eq $image -or (& $getLabel $image 'farmrx.maple-clock-swap') -cne $owner -or (& $getLabel $image 'farmrx.maple-clock-role') -cne $metadata.SnapshotRole) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: snapshot identity is not owned.' }
        return $true
    }.GetNewClosure()
    $adapter.BuildDerived = {
        if ($null -ne (& $inspectImage $Inventory.derived_tag)) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: derived tag already exists.' }
        $snapshot=& $inspectImage $Inventory.snapshot_tag
        if ($null -eq $snapshot -or (& $getLabel $snapshot 'farmrx.maple-clock-role') -cne $metadata.SnapshotRole) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: owned snapshot missing before build.' }
        $artifactByRef=& $inspectImage $artifactRef;& $assertArtifactIdentity $artifactByRef $artifactRef|Out-Null
        $artifactByTag=& $inspectImage $artifactLocalTag;& $assertArtifactIdentity $artifactByTag $artifactLocalTag|Out-Null
        if($artifactByRef.Id-cne$artifactByTag.Id){throw 'MAPLE_DOCKER_ADAPTER_REFUSED: artifact ref and local tag do not resolve to the same image.'}
        $labels=@($ownerLabel,"farmrx.maple-clock-role=$($metadata.DerivedRole)","farmrx.maple-original-id=$($metadata.Original)","farmrx.maple-contract-hash=$($metadata.Contract)","farmrx.maple-clock-snapshot-id=$($snapshot.Id)")
        $argv=@('build','--no-cache','--network=none','--pull=false');foreach($label in $labels){$argv+=@('--label',$label)};$argv+=@('--build-arg',"BASE_IMAGE=$($Inventory.snapshot_tag)",'--build-arg',"FAKETIME_ARTIFACTS_IMAGE=$artifactLocalTag",'--build-arg',"FROZEN_INSTANT=$($Contract.FrozenInstant)",'-f','tests/season/frozen-postgres-clock-spike.Dockerfile','-t',$Inventory.derived_tag,'.')
        $null = & $checked docker $argv 'derived image build'
        $image = & $inspectImage $Inventory.derived_tag
        if ($null -eq $image -or (& $getLabel $image 'farmrx.maple-clock-swap') -cne $owner -or (& $getLabel $image 'farmrx.maple-clock-snapshot-id') -cne $snapshot.Id -or $image.Id -ceq $snapshot.Id) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: derived image identity is not exact.' }
        return $true
    }.GetNewClosure()
    $adapter.ParkOriginal = { & $resetRoute; & $invokeTrue @('rename',$names.Db,$names.Parked) 'park original' }.GetNewClosure()
    $create = @('create','--name',$names.Db,'--label',$ownerLabel,'--label',"com.docker.compose.project=$($Contract.Project)",'--label',"com.supabase.cli.project=$($Contract.Project)",'--restart','no','--network',$names.Network,'--network-alias','db','--network-alias','db.supabase.internal','--publish',"$($names.Port):5432",'--volume',"$($names.Volume):/var/lib/postgresql/data:z",$Inventory.derived_tag)
    $adapter.CreateReplacement = { & $resetRoute; & $invokeTrue $create 'replacement creation' }.GetNewClosure()
    $adapter.StartReplacement = { & $resetRoute; $null=&$invokeTrue @('start',$names.Db) 'replacement start'; &$pollContainerHealthy $names.Db 'replacement'; $true }.GetNewClosure()
    $adapter.ProveRouteClockAndLineage = { & $proveRoute $true }.GetNewClosure()
    $adapter.RemoveReplacement = {
        & $resetRoute
        $state = & $inspectActualState
        if (-not $state.ReplacementExists -or -not $state.ReplacementOwned) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: replacement removal ownership failed.' }
        if ($state.ReplacementRunning) { $null = & $checked docker @('stop','--time','60',$names.Db) 'graceful replacement stop' }
        $null = & $checked docker @('rm',$names.Db) 'replacement removal'
        return $true
    }.GetNewClosure()
    $adapter.RestoreOriginalName = { & $resetRoute; & $invokeTrue @('rename',$names.Parked,$names.Db) 'original name restore' }.GetNewClosure()
    $adapter.StartOriginal = { & $resetRoute; $null=&$invokeTrue @('start',$names.Db) 'original start'; &$pollContainerHealthy $names.Db 'original'; $true }.GetNewClosure()
    $adapter.RestartPostgrest = { & $proveRoute $false }.GetNewClosure()
    $adapter.RemoveDerivedImageIfOwned = {
        if($null-eq(& $inspectImage $Inventory.derived_tag)){return $true}
        $state = & $inspectActualState
        if (-not $state.DerivedOwned) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: derived image cleanup ownership failed.' }
        & $invokeTrue @('image','rm',$Inventory.derived_tag) 'derived image cleanup'
    }.GetNewClosure()
    $adapter.RemoveSnapshotImageIfOwned = {
        if($null-eq(& $inspectImage $Inventory.snapshot_tag)){return $true}
        $state = & $inspectActualState
        if (-not $state.SnapshotOwned) { throw 'MAPLE_DOCKER_ADAPTER_REFUSED: snapshot image cleanup ownership failed.' }
        & $invokeTrue @('image','rm',$Inventory.snapshot_tag) 'snapshot image cleanup'
    }.GetNewClosure()
    $adapter.RemoveJournal = { if ([IO.File]::Exists($JournalPath)) { [IO.File]::Delete($JournalPath) }; return $true }.GetNewClosure()
    return $adapter
}

Export-ModuleMember -Function New-MapleDockerSwapAdapter
