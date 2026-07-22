$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'maple-season-db-clock-plan.psm1') -Force
function Assert-True([bool]$Value,[string]$Message){ if(-not $Value){ throw $Message } }
function Assert-Refused([scriptblock]$Probe,[string]$Message){ $refused=$false; try{ & $Probe | Out-Null }catch{ $refused=$_.Exception.Message -like 'MAPLE_CLOCK_PLAN_REFUSED:*' }; Assert-True $refused $Message }

$project='farmrx-farmer-simplicity-2027-local'
$valid=@{ ProjectId=$project; DbContainer="supabase_db_$project"; RestContainer="supabase_rest_$project"; Network="supabase_network_$project"; Volume="supabase_db_$project"; VolumeDestination='/var/lib/postgresql/data'; ApiUrl='http://127.0.0.1:55321'; DbImage='example/db@sha256:'+('a'*64); DbImageId='sha256:'+('b'*64); RestNetwork="supabase_network_$project"; RestDbHost="supabase_db_$project"; RestImage='example/rest@sha256:'+('c'*64); RestImageId='sha256:'+('d'*64); RestProcess='postgrest' }
Assert-True (Assert-MapleClockPlanAttestation $valid) 'Exact disposable attestation should pass.'
foreach($mutation in @(@{Key='ProjectId';Value='production'},@{Key='DbContainer';Value='other'},@{Key='RestContainer';Value='other'},@{Key='Network';Value='bridge'},@{Key='Volume';Value='live'},@{Key='VolumeDestination';Value='/tmp'},@{Key='ApiUrl';Value='https://example.supabase.co'},@{Key='DbImage';Value='db:latest'},@{Key='DbImageId';Value='unknown'},@{Key='RestNetwork';Value='bridge'},@{Key='RestDbHost';Value='live'},@{Key='RestImage';Value='rest:latest'},@{Key='RestImageId';Value='unknown'},@{Key='RestProcess';Value='sh'})){ $candidate=$valid.Clone();$candidate[$mutation.Key]=$mutation.Value;Assert-Refused { Assert-MapleClockPlanAttestation $candidate } "Unsafe $($mutation.Key) was accepted." }

$plan=New-MapleFrozenClockFeasibilityPlan $valid ([datetimeoffset]'2027-07-09T21:10:00Z')
Assert-True ($plan.Kind -ceq 'non-executing-feasibility-plan' -and $plan.Executable -eq $false) 'The spike must identify itself as non-executing.'
$steps=@($plan.Steps|ForEach-Object Step);$expected=@('reset-requirement','post-reset-attestation-requirement','derived-image-contract','unsupported-replacement-boundary','postgrest-identity-proof-requirement','database-clock-proof-contract','restore-requirement','cleanup-requirement','post-restore-attestation-requirement')
Assert-True (($steps-join '|') -ceq ($expected-join '|')) 'Feasibility plan order changed.'
Assert-True ($plan.UnsupportedBoundary -ceq 'unsupported-replacement-boundary' -and $plan.Steps[3].Refusal.Contains('cannot replace')) 'Unsupported replacement must explicitly refuse.'
$restChecks=@($plan.Steps[4].Checks)
foreach($required in @('reinspect-rest-image-digest','reinspect-rest-image-id','reinspect-rest-process','reinspect-rest-network','reinspect-rest-db-uri-host','resolve-db-host-to-replacement-container','prove-loopback-rest-endpoint-reaches-replacement-db')){ Assert-True ($restChecks -ccontains $required) "PostgREST identity proof is missing: $required" }
$sql=$plan.Steps[5].Sql
foreach($required in @("raise exception 'MAPLE_CLOCK_PROOF_FAILED: current_date'","raise exception 'MAPLE_CLOCK_PROOF_FAILED: statement_timestamp'","raise exception 'MAPLE_CLOCK_PROOF_FAILED: clock_timestamp'","raise exception 'MAPLE_CLOCK_PROOF_FAILED: default inserted timestamp'",'insert into maple_clock_default_probe default values returning stamped_at')){ Assert-True $sql.Contains($required) "Fail-closed SQL is missing: $required" }
Assert-True ($sql.Contains("end;`n`$maple_clock_proof`$;")) 'The fail-closed PostgreSQL block must terminate as executable SQL.'
Assert-True ($plan.Steps[2].BaseImage -ceq $valid.DbImage -and $plan.Steps[2].FrozenInstant -ceq '2027-07-09 21:10:00+00:00') 'Derived image contract is not exact.'
$seasonDir=Join-Path (Split-Path $PSScriptRoot -Parent) 'tests/season'
$root=Split-Path $PSScriptRoot -Parent
$dockerfile=Get-Content -Raw (Join-Path $seasonDir 'frozen-postgres-clock-spike.Dockerfile')
$entrypoint=Get-Content -Raw (Join-Path $seasonDir 'frozen-postgres-entrypoint.sh')
$clearPreload=Get-Content -Raw (Join-Path $seasonDir 'clear-ld-preload.c')
Assert-True ($dockerfile.Contains('ARG FAKETIME_ARTIFACTS_IMAGE=maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7@sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746') -and $dockerfile.Contains('FROM ${FAKETIME_ARTIFACTS_IMAGE} AS faketime-artifacts') -and $dockerfile.Contains('FROM ${BASE_IMAGE}') -and $dockerfile.Contains('COPY --from=faketime-artifacts /artifacts/libfaketime.so.1') -and $dockerfile.Contains('COPY --from=faketime-artifacts /artifacts/libclear-ld-preload.so') -and $dockerfile.Contains('ENTRYPOINT ["/usr/local/bin/frozen-postgres-entrypoint"]') -and $dockerfile.Contains('CMD ["postgres", "-D", "/etc/postgresql"]') -and -not ($dockerfile -match 'apt-get|curl|wget|https?://')) 'Frozen-image feasibility contract changed.'
Assert-True ($entrypoint.Contains('an initialized disposable PostgreSQL data directory is required') -and $entrypoint.Contains("`${1:-}`" != 'postgres'") -and $entrypoint.Contains('exec gosu postgres "$0" "$@"') -and $entrypoint.Contains('/usr/local/lib/faketime/libfaketime.so.1:/usr/local/lib/faketime/libclear-ld-preload.so') -and $entrypoint.Contains('FAKETIME_DONT_FAKE_MONOTONIC=1') -and $entrypoint.Contains('FAKETIME_NO_CACHE=1') -and -not $entrypoint.Contains('FAKETIME=@')) 'Frozen PostgreSQL wrapper contract changed.'
Assert-True ($clearPreload.Contains('__attribute__((constructor))') -and $clearPreload.Contains('unsetenv("LD_PRELOAD")')) 'The preload scrubber must prevent incompatible inheritance by exec children.'
$attributes=Get-Content -Raw (Join-Path $root '.gitattributes')
Assert-True ($attributes.Contains('tests/season/frozen-postgres-entrypoint.sh text eol=lf')) 'The Linux entrypoint must remain LF on Windows checkouts.'
Assert-True (-not (($plan.Steps | ConvertTo-Json -Depth 8) -match 'AlwaysRun|MustSucceed|Tool')) 'A data-only plan must not imply executor guarantees or commands.'
$smoke=Get-Content -Raw (Join-Path $PSScriptRoot 'verify-maple-season-db-clock-spike.ps1')
foreach($required in @("'--network','none'",'MAPLE_SEASON_DB_CLOCK_SPIKE_PASS','MAPLE_CLOCK_SPIKE_REFUSED: pre-existing','Get-FarmIdentity','MAPLE_CLOCK_PROOF_FAILED: default inserted timestamp','Start-Sleep -Seconds 2','-cne $farmBefore','exit 64','Remove-OwnedContainer','Remove-OwnedVolume')){ Assert-True $smoke.Contains($required) "Standalone smoke contract is missing: $required" }
Assert-True (-not ($smoke -match 'rm'',''-f'',\$farmDb|stop'',\$farmDb|volume'',''rm'',\$farmDb')) 'The standalone smoke must never mutate the FarmRx database target.'
Write-Output 'MAPLE_SEASON_DB_CLOCK_PLAN_REGRESSION_PASS'
