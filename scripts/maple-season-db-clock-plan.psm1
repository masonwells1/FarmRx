Set-StrictMode -Version Latest

$script:MapleClockProject = 'farmrx-farmer-simplicity-2027-local'
$script:MapleClockDbContainer = "supabase_db_$script:MapleClockProject"
$script:MapleClockRestContainer = "supabase_rest_$script:MapleClockProject"
$script:MapleClockNetwork = "supabase_network_$script:MapleClockProject"
$script:MapleClockVolume = "supabase_db_$script:MapleClockProject"

function Assert-MapleClockPlanAttestation {
  param([Parameter(Mandatory)][hashtable]$Attestation)
  $expected = @{ ProjectId=$script:MapleClockProject; DbContainer=$script:MapleClockDbContainer; RestContainer=$script:MapleClockRestContainer; Network=$script:MapleClockNetwork; Volume=$script:MapleClockVolume; VolumeDestination='/var/lib/postgresql/data'; ApiUrl='http://127.0.0.1:55321' }
  foreach ($key in $expected.Keys) { if (-not $Attestation.ContainsKey($key) -or $Attestation[$key] -cne $expected[$key]) { throw "MAPLE_CLOCK_PLAN_REFUSED: $key is not the exact disposable-local value." } }
  if (-not $Attestation.ContainsKey('DbImage') -or $Attestation.DbImage -notmatch '^.+@sha256:[0-9a-f]{64}$' -or -not $Attestation.ContainsKey('DbImageId') -or $Attestation.DbImageId -notmatch '^sha256:[0-9a-f]{64}$') { throw 'MAPLE_CLOCK_PLAN_REFUSED: the database image identity is not exact and digest-pinned.' }
  if (-not $Attestation.ContainsKey('RestNetwork') -or $Attestation.RestNetwork -cne $expected.Network -or -not $Attestation.ContainsKey('RestDbHost') -or $Attestation.RestDbHost -cne $expected.DbContainer) { throw 'MAPLE_CLOCK_PLAN_REFUSED: PostgREST is not connected to the exact disposable database.' }
  if (-not $Attestation.ContainsKey('RestImage') -or $Attestation.RestImage -notmatch '^.+@sha256:[0-9a-f]{64}$' -or -not $Attestation.ContainsKey('RestImageId') -or $Attestation.RestImageId -notmatch '^sha256:[0-9a-f]{64}$' -or -not $Attestation.ContainsKey('RestProcess') -or $Attestation.RestProcess -cne 'postgrest') { throw 'MAPLE_CLOCK_PLAN_REFUSED: the PostgREST process/container identity is not exact.' }
  return $true
}

function New-MapleFrozenClockFeasibilityPlan {
  param([Parameter(Mandatory)][hashtable]$Attestation, [Parameter(Mandatory)][datetimeoffset]$Instant)
  Assert-MapleClockPlanAttestation $Attestation | Out-Null
  $utc = $Instant.ToUniversalTime().ToString('yyyy-MM-dd HH:mm:sszzz'); $date = $Instant.ToUniversalTime().ToString('yyyy-MM-dd')
  $proofSql = @"
do `$maple_clock_proof`$
declare v_inserted timestamptz;
begin
  if current_date <> date '$date' then raise exception 'MAPLE_CLOCK_PROOF_FAILED: current_date'; end if;
  if statement_timestamp() <> timestamptz '$utc' then raise exception 'MAPLE_CLOCK_PROOF_FAILED: statement_timestamp'; end if;
  if clock_timestamp() <> timestamptz '$utc' then raise exception 'MAPLE_CLOCK_PROOF_FAILED: clock_timestamp'; end if;
  create temporary table maple_clock_default_probe(stamped_at timestamptz default now()) on commit drop;
  insert into maple_clock_default_probe default values returning stamped_at into v_inserted;
  if v_inserted <> timestamptz '$utc' then raise exception 'MAPLE_CLOCK_PROOF_FAILED: default inserted timestamp'; end if;
end;
`$maple_clock_proof`$;
"@
  $steps = @(
    [ordered]@{ Step='reset-requirement'; Description='A future executor would reset only the attested disposable stack before replacement.' },
    [ordered]@{ Step='post-reset-attestation-requirement'; Checks=@('project','loopback-api','db-container','db-image-digest','db-image-id','network','volume','volume-destination','rest-container','rest-image-digest','rest-image-id','rest-process','rest-network','rest-db-host') },
    [ordered]@{ Step='derived-image-contract'; Dockerfile='tests/season/frozen-postgres-clock-spike.Dockerfile'; BaseImage=$Attestation.DbImage; FrozenInstant=$utc },
    [ordered]@{ Step='unsupported-replacement-boundary'; Refusal='Supabase CLI 2.106.0 has no supported local database-image override. This feasibility plan cannot replace a container.' },
    [ordered]@{ Step='postgrest-identity-proof-requirement'; DbContainer=$script:MapleClockDbContainer; RestContainer=$script:MapleClockRestContainer; Network=$script:MapleClockNetwork; Checks=@('reinspect-rest-image-digest','reinspect-rest-image-id','reinspect-rest-process','reinspect-rest-network','reinspect-rest-db-uri-host','resolve-db-host-to-replacement-container','prove-loopback-rest-endpoint-reaches-replacement-db') },
    [ordered]@{ Step='database-clock-proof-contract'; Database='postgres'; Sql=$proofSql },
    [ordered]@{ Step='restore-requirement'; Description='Any future executor must restore the exact inspected image, network, volume, and container identity even after failure.' },
    [ordered]@{ Step='cleanup-requirement'; Description='Any future executor must remove only its exact derived image even after failure.' },
    [ordered]@{ Step='post-restore-attestation-requirement'; Checks=@('db-image-digest','db-image-id','network','volume','rest-db-host','ordinary-clock') }
  )
  return [pscustomobject]@{ Kind='non-executing-feasibility-plan'; Executable=$false; UnsupportedBoundary='unsupported-replacement-boundary'; Steps=$steps }
}

Export-ModuleMember -Function Assert-MapleClockPlanAttestation, New-MapleFrozenClockFeasibilityPlan
