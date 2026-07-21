param([Parameter(Mandatory)][string]$FrozenInstant,[switch]$Execute)
$ErrorActionPreference='Stop'; $root=Split-Path -Parent $PSScriptRoot; Import-Module (Join-Path $PSScriptRoot 'maple-season-db-clock-swap.psm1') -Force
$db='supabase_db_farmrx-farmer-simplicity-2027-local'; $digest='public.ecr.aws/supabase/postgres@sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5'; $journal=Join-Path $env:TEMP 'farmrx-maple-db-clock-swap-journal.json'; $envFile=Join-Path $env:TEMP 'farmrx-maple-db-clock-swap.env'
$inspect=@(docker inspect $db 2>$null|ConvertFrom-Json); if($LASTEXITCODE-ne 0){throw 'MAPLE_DB_SWAP_REFUSED: exact ordinary database is unavailable.'}
$repoDigests=@(docker image inspect $inspect[0].Image --format '{{json .RepoDigests}}' 2>$null|ConvertFrom-Json); if($LASTEXITCODE-ne 0-or $repoDigests.Count-ne 1-or $repoDigests[0]-cne$digest){throw 'MAPLE_DB_SWAP_REFUSED: the ordinary database image repository digest is not exact.'}
$contract=Get-MapleDbSwapContract $inspect $repoDigests[0]; $plan=New-MapleDbSwapPlan $contract $FrozenInstant $journal $envFile
if(-not $Execute){$safe=[pscustomobject]@{Executable=$plan.Executable;OriginalId=$plan.OriginalId;DerivedTag=$plan.DerivedTag;ParkedName=$plan.ParkedName;Steps=$plan.Steps;Recovery=$plan.Recovery}; $safe|ConvertTo-Json -Depth 6; exit 0}
# Execution remains locked until a reviewed adapter can create and clean an opaque,
# local docker-commit snapshot of the stopped original writable layer. That layer
# contains generated PostgreSQL config/key material and must never be inspected,
# exported, logged, or reconstructed from the base image plus PGDATA.
throw 'MAPLE_DB_SWAP_REFUSED: secure stopped-container snapshot adapter not yet reviewed; use the mocked plan proof only.'
