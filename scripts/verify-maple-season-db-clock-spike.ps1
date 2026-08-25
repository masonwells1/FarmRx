param([switch]$PreserveDerivedImage)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$farmDb = 'supabase_db_farmrx-farmer-simplicity-2027-local'
$baseImage = 'public.ecr.aws/supabase/postgres@sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770'
$baseImageId = 'sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770'
$artifactImage = 'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365:synthetic'
$artifactRef = 'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365@sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302'
$artifactId = 'sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302'
$artifactLabels = [ordered]@{'farmrx.synthetic-bootstrap'='b9ad08aeb66ed961e8426b2cce527365';'farmrx.synthetic-owner'='maple-faketime-bootstrap';'farmrx.synthetic-role'='faketime-artifacts';'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818';'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev'}
$derivedImage = 'farmrx-frozen-clock-spike:ba10e934-july-2027'
$volume = 'farmrx_maple_clock_spike_ba10e934'
$emptyVolume = 'farmrx_maple_clock_spike_empty_ba10e934'
$initContainer = 'farmrx-maple-clock-spike-init-ba10e934'
$clockContainer = 'farmrx-maple-clock-spike-db-ba10e934'
$emptyContainer = 'farmrx-maple-clock-spike-empty-ba10e934'
$label = 'farmrx.maple-clock-spike=ba10e934-july-2027'
$instant = '2027-07-09 21:10:00+00:00'
$created = @{ Image=$false; Volume=$false; EmptyVolume=$false; Init=$false; Clock=$false; Empty=$false }

function Invoke-Docker([string[]]$Arguments, [switch]$AllowFailure) {
  $before=$ErrorActionPreference; $ErrorActionPreference='Continue'
  try { $output = @(& docker @Arguments 2>&1); $exit = $LASTEXITCODE } finally { $ErrorActionPreference=$before }
  if (-not $AllowFailure -and $exit -ne 0) { throw "MAPLE_CLOCK_SPIKE_FAILED: docker $($Arguments[0]) failed (exit $exit)." }
  return [pscustomobject]@{ Output=$output; Exit=$exit }
}
function Assert-Absent([string]$Kind,[string]$Name) {
  $result = if($Kind -eq 'image'){ Invoke-Docker @('image','inspect',$Name) -AllowFailure }elseif($Kind -eq 'volume'){ Invoke-Docker @('volume','inspect',$Name) -AllowFailure }else{ Invoke-Docker @('container','inspect',$Name) -AllowFailure }
  if($result.Exit -eq 0){ throw "MAPLE_CLOCK_SPIKE_REFUSED: pre-existing $Kind target $Name." }
}
function Assert-ExactReusableArtifact {
  foreach($name in @($artifactRef,$artifactImage)){
    $json=(Invoke-Docker @('image','inspect','--format','{"Id":{{json .Id}},"Labels":{{json .Config.Labels}}}',$name)).Output -join ''
    try{$artifact=$json|ConvertFrom-Json}catch{throw "MAPLE_CLOCK_SPIKE_REFUSED: reusable faketime artifact $name returned malformed inspection JSON."}
    if($artifact.Id-cne$artifactId){throw "MAPLE_CLOCK_SPIKE_REFUSED: reusable faketime artifact $name did not resolve to the reviewed ID."}
    foreach($key in $artifactLabels.Keys){if($artifact.Labels.$key-cne$artifactLabels[$key]){throw "MAPLE_CLOCK_SPIKE_REFUSED: reusable faketime artifact $name label $key drifted."}}
  }
}
function Get-FarmIdentity {
  $core=(Invoke-Docker @('inspect','--format','{{.Id}}|{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}',$farmDb)).Output -join ''
  $mountsJson=(Invoke-Docker @('inspect','--format','{{json .Mounts}}',$farmDb)).Output -join ''
  $mounts=@($mountsJson | ConvertFrom-Json)
  $mount=@($mounts | Where-Object { $_.Destination -ceq '/var/lib/postgresql/data' })
  $expectedCore = '^([0-9a-f]{64})\|' + [regex]::Escape($baseImageId) + '\|true\|healthy$'
  if($core -notmatch $expectedCore -or $mount.Count -ne 1 -or $mount[0].Type -cne 'volume' -or -not $mount[0].Name){ throw 'MAPLE_CLOCK_SPIKE_REFUSED: the real FarmRx database is not on the exact base image, running and healthy with one attested data volume.' }
  return "$core|$($mount[0].Name)"
}
function Wait-Healthy([string]$Name) {
  for($i=0;$i -lt 60;$i++){ $state=(Invoke-Docker @('inspect','--format','{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',$Name)).Output -join ''; if($state -ceq 'healthy'){ return }; Start-Sleep -Milliseconds 500 }
  throw "MAPLE_CLOCK_SPIKE_FAILED: $Name did not become healthy."
}
function Remove-OwnedContainer([string]$Name,[string]$Key) {
  if(-not $created[$Key]){ return }; $json=(Invoke-Docker @('inspect','--format','{{json .Config.Labels}}',$Name) -AllowFailure).Output -join ''; $owned=($json|ConvertFrom-Json).'farmrx.maple-clock-spike'; if($owned -cne 'ba10e934-july-2027'){ throw "MAPLE_CLOCK_SPIKE_CLEANUP_REFUSED: $Name lost its ownership label." }; Invoke-Docker @('rm','-f',$Name) | Out-Null; $created[$Key]=$false
}
function Remove-OwnedVolume([string]$Name,[string]$Key) {
  if(-not $created[$Key]){ return }; $json=(Invoke-Docker @('volume','inspect','--format','{{json .Labels}}',$Name) -AllowFailure).Output -join ''; $owned=($json|ConvertFrom-Json).'farmrx.maple-clock-spike'; if($owned -cne 'ba10e934-july-2027'){ throw "MAPLE_CLOCK_SPIKE_CLEANUP_REFUSED: $Name lost its ownership label." }; Invoke-Docker @('volume','rm',$Name) | Out-Null; $created[$Key]=$false
}

if(-not (Get-Command docker -ErrorAction SilentlyContinue)){ throw 'Docker CLI is required.' }
$farmBefore=Get-FarmIdentity
if($farmBefore.EndsWith("|$volume") -or $farmBefore.EndsWith("|$emptyVolume")){ throw 'MAPLE_CLOCK_SPIKE_REFUSED: a spike volume aliases the FarmRx database volume.' }
foreach($name in @($initContainer,$clockContainer,$emptyContainer)){ Assert-Absent container $name }
foreach($name in @($volume,$emptyVolume)){ Assert-Absent volume $name }
Assert-Absent image $derivedImage
Assert-ExactReusableArtifact

Push-Location $root
try {
  Invoke-Docker @('build','--pull=false','--label',$label,'--build-arg',"BASE_IMAGE=$baseImage",'--build-arg',"FAKETIME_ARTIFACTS_IMAGE=$artifactImage",'--build-arg',"FROZEN_INSTANT=$instant",'-f','tests/season/frozen-postgres-clock-spike.Dockerfile','-t',$derivedImage,'.') | Out-Null; $created.Image=$true
  Invoke-Docker @('volume','create','--label',$label,$volume) | Out-Null; $created.Volume=$true
  Invoke-Docker @('run','-d','--name',$initContainer,'--label',$label,'--network','none','-e','POSTGRES_PASSWORD=maple-clock-spike-synthetic-only','-v',"${volume}:/var/lib/postgresql/data",$baseImage) | Out-Null; $created.Init=$true
  Wait-Healthy $initContainer
  Remove-OwnedContainer $initContainer 'Init'

  Invoke-Docker @('run','-d','--name',$clockContainer,'--label',$label,'--network','none','-v',"${volume}:/var/lib/postgresql/data",$derivedImage) | Out-Null; $created.Clock=$true
  Wait-Healthy $clockContainer
  $proof=@"
do `$maple_clock_proof`$
declare v_inserted timestamptz;
begin
 if current_date <> date '2027-07-09' then raise exception 'MAPLE_CLOCK_PROOF_FAILED: current_date'; end if;
 if statement_timestamp() <> timestamptz '$instant' then raise exception 'MAPLE_CLOCK_PROOF_FAILED: statement_timestamp'; end if;
 if clock_timestamp() <> timestamptz '$instant' then raise exception 'MAPLE_CLOCK_PROOF_FAILED: clock_timestamp'; end if;
 create temporary table maple_clock_default_probe(stamped_at timestamptz default now()) on commit drop;
 insert into maple_clock_default_probe default values returning stamped_at into v_inserted;
 if v_inserted <> timestamptz '$instant' then raise exception 'MAPLE_CLOCK_PROOF_FAILED: default inserted timestamp'; end if;
end;
`$maple_clock_proof`$;
"@
  $proofResult=@($proof | docker exec -i $clockContainer psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1); if($LASTEXITCODE -ne 0){ throw 'MAPLE_CLOCK_SPIKE_FAILED: fail-closed PostgreSQL clock/default proof failed.' }
  $persistentSql="create table public.maple_clock_persistent_probe(id integer primary key, stamped_at timestamptz not null default now()); insert into public.maple_clock_persistent_probe(id) values(1);"
  Invoke-Docker @('exec',$clockContainer,'timeout','15','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',$persistentSql) | Out-Null
  $persistent=((Invoke-Docker @('exec',$clockContainer,'timeout','15','psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',"select count(*)::text||'|'||min(stamped_at)::text from public.maple_clock_persistent_probe;")).Output -join '')
  if($persistent-cne'1|2027-07-09 21:10:00+00'){throw 'MAPLE_CLOCK_SPIKE_FAILED: persistent commit/default timestamp proof failed.'}
  Invoke-Docker @('exec',$clockContainer,'timeout','15','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c','drop table public.maple_clock_persistent_probe;') | Out-Null
  $repeatSql="select current_date::text||'|'||statement_timestamp()::text||'|'||clock_timestamp()::text;"
  $first=((Invoke-Docker @('exec',$clockContainer,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',$repeatSql)).Output -join "`n"); Start-Sleep -Seconds 2
  $second=((Invoke-Docker @('exec',$clockContainer,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',$repeatSql)).Output -join "`n"); if($first -cne $second){ throw 'MAPLE_CLOCK_SPIKE_FAILED: frozen PostgreSQL output changed after two host seconds.' }

  Invoke-Docker @('volume','create','--label',$label,$emptyVolume) | Out-Null; $created.EmptyVolume=$true
  $emptyRun=Invoke-Docker @('run','--name',$emptyContainer,'--label',$label,'--network','none','-v',"${emptyVolume}:/var/lib/postgresql/data",$derivedImage) -AllowFailure; $created.Empty=$true
  $emptyExit=((Invoke-Docker @('inspect','--format','{{.State.ExitCode}}',$emptyContainer)).Output -join ''); if($emptyRun.Exit -ne 64 -or $emptyExit -cne '64'){ throw 'MAPLE_CLOCK_SPIKE_FAILED: the derived image did not refuse an empty volume with exit 64.' }
  if((Get-FarmIdentity) -cne $farmBefore){ throw 'MAPLE_CLOCK_SPIKE_FAILED: the real FarmRx database identity or health changed.' }
  Write-Output 'MAPLE_SEASON_DB_CLOCK_SPIKE_PASS'
} finally {
  try { Remove-OwnedContainer $emptyContainer 'Empty' } finally { try { Remove-OwnedContainer $clockContainer 'Clock' } finally { try { Remove-OwnedContainer $initContainer 'Init' } finally { try { Remove-OwnedVolume $emptyVolume 'EmptyVolume' } finally { Remove-OwnedVolume $volume 'Volume' } } } }
  if($created.Image -and -not $PreserveDerivedImage){ $json=(Invoke-Docker @('image','inspect','--format','{{json .Config.Labels}}',$derivedImage) -AllowFailure).Output -join ''; $owned=($json|ConvertFrom-Json).'farmrx.maple-clock-spike'; if($owned -cne 'ba10e934-july-2027'){ throw 'MAPLE_CLOCK_SPIKE_CLEANUP_REFUSED: derived image lost its ownership label.' }; Invoke-Docker @('image','rm',$derivedImage) | Out-Null; $created.Image=$false }
  if((Get-FarmIdentity) -cne $farmBefore){ throw 'MAPLE_CLOCK_SPIKE_FAILED: the real FarmRx database identity or health changed during cleanup.' }
  Pop-Location
}
