$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$project='farmrx-farmer-simplicity-2027-local'
$db="supabase_db_$project";$gateway="supabase_kong_$project";$parked="$db-ordinary-parked"
$apiUrl='http://127.0.0.1:55321';$authHealthUri="$apiUrl/auth/v1/health"
$fixture=Join-Path $root 'tests/season/pine-hill-2027-start.sql'
$verify=Join-Path $root 'tests/season/pine-hill-2027.verify.sql'
$playwrightCli=Join-Path $root 'node_modules/@playwright/test/cli.js'
. (Join-Path $root 'scripts/maple-season-credential.ps1')
Import-Module (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1') -Force

function Wait-PineAuth {
  for($attempt=1;$attempt-le30;$attempt++){
    try{$health=Invoke-WebRequest -UseBasicParsing -Uri $authHealthUri -TimeoutSec 2;if($health.StatusCode-eq200-and$health.Content-match'"name"\s*:\s*"GoTrue"'){return}}catch{}
    if($attempt-lt30){Start-Sleep -Milliseconds 500}
  }
  throw 'Pine Hill disposable Auth did not become healthy.'
}

function Invoke-PineSql([string]$Sql) {
  $output=@($Sql|docker exec -i $db psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1)
  if($LASTEXITCODE-ne0){throw "Pine Hill focused SQL failed.`n$([string]::Join("`n",[string[]]$output))"}
  return [string]::Join("`n",[string[]]$output)
}

function Get-PineFileSha256([string]$Path) {
  $sha=[Security.Cryptography.SHA256]::Create()
  try {
    $stream=[IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))-replace'-','') }
    finally { $stream.Dispose() }
  } finally { $sha.Dispose() }
}

function Get-PineAccessToken([string]$PublishableKey) {
  $password=$env:FARMRX_SEASON_OWNER_PASSWORD;$payload=$null;$response=$null
  if($password-notmatch'^[0-9a-f]{64}$'){throw 'Pine Hill synthetic credential is unavailable.'}
  try {
    $payload=@{email='pine.owner@farmrx.local.test';password=$password}|ConvertTo-Json -Compress
    $response=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$apiUrl/auth/v1/token?grant_type=password" -Headers @{apikey=$PublishableKey} -ContentType 'application/json' -Body $payload -TimeoutSec 10
    $token=($response.Content|ConvertFrom-Json -ErrorAction Stop).access_token
    if([string]::IsNullOrWhiteSpace($token)){throw 'missing token'}
    return [string]$token
  } catch { throw 'Pine Hill could not obtain a synthetic loopback access token.' }
  finally{$password=$null;$payload=$null;$response=$null}
}

function Get-PineSnapshot([hashtable]$WhereOverrides=@{}) {
  $tables=@((Invoke-PineSql "select tablename from pg_catalog.pg_tables where schemaname='public' order by tablename;")-split"`r?`n"|Where-Object{$_})
  $lines=[Collections.Generic.List[string]]::new()
  foreach($table in $tables){
    if($table-notmatch'^[a-z][a-z0-9_]*$'){throw 'Pine Hill snapshot found an unsafe public table name.'}
    $where=if($WhereOverrides.ContainsKey($table)){[string]$WhereOverrides[$table]}else{'true'}
    if($where-notmatch'^[a-z0-9_ <>=:''().-]+$'){throw 'Pine Hill snapshot override is unsafe.'}
    $json=Invoke-PineSql "select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text from (select * from public.`"$table`" where $where) r;"
    $lines.Add("$table|$json")
  }
  $sequenceJson=Invoke-PineSql "select coalesce(jsonb_agg(jsonb_build_object('name',sequencename,'last_value',last_value) order by sequencename),'[]'::jsonb)::text from pg_catalog.pg_sequences where schemaname='public';"
  $lines.Add("__public_sequences|$sequenceJson")
  return [string]::Join("`n",$lines)
}

function Invoke-PineBrowser {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Instant,
    [Parameter(Mandatory)][string]$StateOut,
    [string]$StateIn,
    [string]$FenceToken,
    [ValidateSet('desktop','phone')][string]$Viewport='desktop'
  )
  $priorIn=$env:FARMRX_PH_STATE_IN;$priorOut=$env:FARMRX_PH_STATE_OUT;$priorInstant=$env:FARMRX_PH_CLIENT_INSTANT;$priorToken=$env:FARMRX_PH_FENCE_TOKEN;$priorViewport=$env:FARMRX_PH_VIEWPORT
  try {
    if($StateIn){$env:FARMRX_PH_STATE_IN=$StateIn}else{Remove-Item Env:FARMRX_PH_STATE_IN -ErrorAction SilentlyContinue}
    $env:FARMRX_PH_STATE_OUT=$StateOut;$env:FARMRX_PH_CLIENT_INSTANT=$Instant;$env:FARMRX_PH_VIEWPORT=$Viewport
    if($FenceToken){$env:FARMRX_PH_FENCE_TOKEN=$FenceToken}else{Remove-Item Env:FARMRX_PH_FENCE_TOKEN -ErrorAction SilentlyContinue}
    & node $playwrightCli test --config playwright.pine-hill.config.ts --grep "@pine-hill-$Name" | Out-Host
    if($LASTEXITCODE-ne0){throw "Pine Hill browser phase failed: $Name"}
    if(-not(Test-Path -LiteralPath $StateOut)){throw "Pine Hill browser phase did not persist state: $Name"}
  } finally {
    if($null-eq$priorIn){Remove-Item Env:FARMRX_PH_STATE_IN -ErrorAction SilentlyContinue}else{$env:FARMRX_PH_STATE_IN=$priorIn}
    if($null-eq$priorOut){Remove-Item Env:FARMRX_PH_STATE_OUT -ErrorAction SilentlyContinue}else{$env:FARMRX_PH_STATE_OUT=$priorOut}
    if($null-eq$priorInstant){Remove-Item Env:FARMRX_PH_CLIENT_INSTANT -ErrorAction SilentlyContinue}else{$env:FARMRX_PH_CLIENT_INSTANT=$priorInstant}
    if($null-eq$priorToken){Remove-Item Env:FARMRX_PH_FENCE_TOKEN -ErrorAction SilentlyContinue}else{$env:FARMRX_PH_FENCE_TOKEN=$priorToken}
    if($null-eq$priorViewport){Remove-Item Env:FARMRX_PH_VIEWPORT -ErrorAction SilentlyContinue}else{$env:FARMRX_PH_VIEWPORT=$priorViewport}
  }
}

function Invoke-PineZeroWriteBrowser {
  param([string]$Name,[string]$Instant,[string]$StateOut,[string]$StateIn,[string]$FenceToken,[string]$Viewport)
  $before=Get-PineSnapshot
  Invoke-PineBrowser $Name $Instant $StateOut $StateIn $FenceToken $Viewport
  $after=Get-PineSnapshot
  if($before-cne$after){throw "Pine Hill phase changed public state unexpectedly: $Name"}
}

function Reset-Pine([string]$Supabase) {
  & $Supabase --profile supabase db reset --local --no-seed --yes
  if($LASTEXITCODE-ne0){throw 'Pine Hill disposable reset failed.'}
  docker restart $gateway|Out-Null;if($LASTEXITCODE-ne0){throw 'Pine Hill gateway refresh failed.'}
  Wait-PineAuth
  if(-not(Invoke-MapleSeasonSqlFile -Path $fixture -ExpectedContainer $db)){throw 'Pine Hill synthetic fixture failed.'}
}

function Invoke-PineSequence {
  param([string]$Viewport,[string]$Prefix,[string]$PublishableKey,[string]$AccessToken,[string]$Temp,[ValidateSet('canonical','corrupt-active')][string]$Mode='canonical')
  $s0=Join-Path $Temp "$Prefix-init.json";$s1=Join-Path $Temp "$Prefix-ph1.json";$s2=Join-Path $Temp "$Prefix-ph2.json";$s3=Join-Path $Temp "$Prefix-ph3.json";$sCorrupt=Join-Path $Temp "$Prefix-corrupt-active.json";$s5=Join-Path $Temp "$Prefix-ph5.json";$s6=Join-Path $Temp "$Prefix-ph6.json"
  Invoke-PineZeroWriteBrowser init '2027-08-04T13:55:00-05:00' $s0 '' '27091000-0000-4000-8000-000000000001' $Viewport
  Invoke-PineZeroWriteBrowser ph1 '2027-08-04T14:00:00-05:00' $s1 $s0 '' $Viewport

  $ph2={
    $before=Get-PineSnapshot @{
      field_log_entries="id <> '27080000-0000-4000-8000-000000000001'::uuid"
      repository_write_receipts="operation_id <> '27090000-0000-4000-8000-000000000001'::uuid"
    }
    Invoke-PineBrowser ph2 '2027-08-04T14:10:00-05:00' $s2 $s1 '' $Viewport
    $after=Get-PineSnapshot @{
      field_log_entries="id <> '27080000-0000-4000-8000-000000000001'::uuid"
      repository_write_receipts="operation_id <> '27090000-0000-4000-8000-000000000001'::uuid"
    }
    if($before-cne$after){throw 'Pine PH-2 changed a row outside the exact note/receipt allowance.'}
    $proof=Invoke-PineSql "select count(*)||'|'||min(created_at)::text||'|'||(select count(*) from public.repository_write_receipts where operation_id='27090000-0000-4000-8000-000000000001') from public.field_log_entries where id='27080000-0000-4000-8000-000000000001';"
    if($proof-cnotmatch'^1\|2027-08-04 19:10:00\+00\|1$'){throw "Pine PH-2 exact write proof failed: $proof"}
    return $true
  }.GetNewClosure()
  $result=@(Invoke-HarvestRidgeClockPhase -Root $root -Phase "$Prefix-ph2" -FrozenInstant '2027-08-04 19:10:00+00:00' -ApiUrl $apiUrl -PublishableKey $PublishableKey -AccessToken $AccessToken -ProofFarmId '27010000-0000-4000-8000-000000000006' -ProofFarmName 'Pine Hill' -Action $ph2)
  if($result[-1]-ne$true){throw 'Pine PH-2 clock phase did not return exact success.'}

  Invoke-PineZeroWriteBrowser ph3 '2027-08-04T14:30:00-05:00' $s3 $s2 '' $Viewport
  $stateHash=Get-PineFileSha256 $s3
  $ph4={
    $before=Get-PineSnapshot @{
      farm_memberships="not (farm_id='27010000-0000-4000-8000-000000000006'::uuid and user_id='27000000-0000-4000-8000-000000000003'::uuid)"
      farm_access_epochs="not (farm_id='27010000-0000-4000-8000-000000000006'::uuid and user_id='27000000-0000-4000-8000-000000000003'::uuid)"
    }
    $changed=Invoke-PineSql @"
begin;
set local request.jwt.claims = '{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub = '27000000-0000-4000-8000-000000000001';
set local request.headers = '{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000006\":1}"}';
do `$ph4`$
declare
  changed_count integer;
begin
  update public.farm_memberships set status='revoked'
  where farm_id='27010000-0000-4000-8000-000000000006'
    and user_id='27000000-0000-4000-8000-000000000003'
    and status='active';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Pine PH-4 expected one active membership, changed %', changed_count;
  end if;
end
`$ph4`$;
select '1|'||
       (select access_epoch from public.farm_access_epochs where farm_id='27010000-0000-4000-8000-000000000006' and user_id='27000000-0000-4000-8000-000000000003')||'|'||
       (select updated_at::text from public.farm_memberships where farm_id='27010000-0000-4000-8000-000000000006' and user_id='27000000-0000-4000-8000-000000000003')||'|'||
       (select updated_at::text from public.farm_access_epochs where farm_id='27010000-0000-4000-8000-000000000006' and user_id='27000000-0000-4000-8000-000000000003');
commit;
"@
    if($changed-cnotmatch'^1\|2\|2027-08-04 19:35:00\+00\|2027-08-04 19:35:00\+00$'){throw "Pine PH-4 exact controller proof failed: $changed"}
    $after=Get-PineSnapshot @{
      farm_memberships="not (farm_id='27010000-0000-4000-8000-000000000006'::uuid and user_id='27000000-0000-4000-8000-000000000003'::uuid)"
      farm_access_epochs="not (farm_id='27010000-0000-4000-8000-000000000006'::uuid and user_id='27000000-0000-4000-8000-000000000003'::uuid)"
    }
    if($before-cne$after){throw 'Pine PH-4 changed a row outside the exact membership/epoch allowance.'}
    if((Get-PineFileSha256 $s3)-cne$stateHash){throw 'Pine PH-4 changed browser state.'}
    return $true
  }.GetNewClosure()
  $result=@(Invoke-HarvestRidgeClockPhase -Root $root -Phase "$Prefix-ph4" -FrozenInstant '2027-08-04 19:35:00+00:00' -ApiUrl $apiUrl -PublishableKey $PublishableKey -AccessToken $AccessToken -ProofFarmId '27010000-0000-4000-8000-000000000006' -ProofFarmName 'Pine Hill' -Action $ph4)
  if($result[-1]-ne$true){throw 'Pine PH-4 clock phase did not return exact success.'}

  if($Mode-eq'corrupt-active'){
    Invoke-PineZeroWriteBrowser corrupt-active '2027-08-04T14:45:00-05:00' $sCorrupt $s3 '27091000-0000-4000-8000-000000000002' $Viewport
    $revokedWrites=Invoke-PineSql "select (select count(*) from public.field_log_entries where id='27080000-0000-4000-8000-000000000002')||'|'||(select count(*) from public.repository_write_receipts where operation_id='27090000-0000-4000-8000-000000000002');"
    if($revokedWrites-cne'0|0'){throw "Pine corrupt-active wrote revoked work: $revokedWrites"}
    return
  }

  Invoke-PineZeroWriteBrowser ph5 '2027-08-04T14:45:00-05:00' $s5 $s3 '27091000-0000-4000-8000-000000000002' $Viewport
  Invoke-PineZeroWriteBrowser ph6 '2027-08-04T15:00:00-05:00' $s6 $s5 '' $Viewport
  Get-Content -Raw -Encoding UTF8 -LiteralPath $verify|docker exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off
  if($LASTEXITCODE-ne0){throw "Pine Hill final $Viewport SQL verification failed."}
}

function Invoke-PineCorruptVaultSequence {
  param([string]$Viewport,[string]$Prefix,[string]$Temp)
  $state=Join-Path $Temp "$Prefix-corrupt-vault.json"
  Invoke-PineZeroWriteBrowser corrupt-vault '2027-08-04T14:50:00-05:00' $state '' '27091000-0000-4000-8000-000000000001' $Viewport
}

function Assert-PineNoClockResidue {
  $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try {
    $ordinary=@(docker inspect --type container --format '{{.Id}}|{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{.HostConfig.RestartPolicy.Name}}' $db 2>$null);$ordinaryExit=$LASTEXITCODE
    docker inspect --type container $parked 2>$null|Out-Null;$parkedExists=$LASTEXITCODE-eq0
    $images=@(docker image ls --format '{{.Repository}}:{{.Tag}}'|Where-Object{$_-match'^farmrx-(?:clock-snapshot|frozen-clock-swap):'})
  } finally{$ErrorActionPreference=$prior}
  $journals=@(Get-ChildItem ([IO.Path]::GetTempPath()) -Filter 'farmrx-harvest-ridge-clock-*-ph*.json' -ErrorAction SilentlyContinue)
  if($ordinaryExit-ne0-or$ordinary.Count-ne1-or$ordinary[0]-notmatch'^[0-9a-f]{64}\|sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770\|true\|healthy\|unless-stopped$'-or$parkedExists-or$images.Count-ne0-or$journals.Count-ne0){throw 'PINE_HILL_CLOCK_RECOVERY_INCOMPLETE'}
}

if(-not(Get-Command docker -ErrorAction SilentlyContinue)){throw 'Docker CLI is required for Pine Hill proof.'}
if(-not(Test-Path -LiteralPath $playwrightCli)){throw 'Repository-pinned Playwright CLI is required for Pine Hill proof.'}
$supabase=(Get-Command supabase -ErrorAction Stop).Source
$temp=Join-Path ([IO.Path]::GetTempPath()) "farmrx-pine-hill-proof-$PID-$([guid]::NewGuid().ToString('N'))"
$boundary=$null;$token=$null
New-Item -ItemType Directory -Path $temp|Out-Null
Push-Location $root
try {
  if(@(docker ps --format '{{.Names}}')-notcontains$db){&$supabase --profile supabase start;if($LASTEXITCODE-ne0){throw 'Disposable local Supabase start failed.'}}
  $boundary=Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $project -ExpectedContainer $db
  Enter-MapleSeasonCredential
  $env:VITE_LOCAL_SUPABASE_PROJECT_REF='farmrxlocalsimplicity2027';$env:VITE_LOCAL_SUPABASE_URL=$boundary.ApiUrl;$env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY=$boundary.PublishableKey

  Reset-Pine $supabase;$token=Get-PineAccessToken $boundary.PublishableKey
  Invoke-PineSequence desktop desktop $boundary.PublishableKey $token $temp
  Reset-Pine $supabase;$token=Get-PineAccessToken $boundary.PublishableKey
  Invoke-PineSequence phone phone $boundary.PublishableKey $token $temp
  Reset-Pine $supabase;$token=Get-PineAccessToken $boundary.PublishableKey
  Invoke-PineSequence phone corrupt-active-phone $boundary.PublishableKey $token $temp -Mode corrupt-active
  Reset-Pine $supabase;$token=Get-PineAccessToken $boundary.PublishableKey
  Invoke-PineCorruptVaultSequence phone corrupt-vault-phone $temp
  Write-Output 'PINE_HILL_2027_DISPOSABLE_PASS'
} finally {
  $token=$null;$boundary=$null
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue;Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue;Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  try{Assert-PineNoClockResidue}finally{
    Pop-Location
    $resolved=[IO.Path]::GetFullPath($temp);$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if($resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)-and[IO.Directory]::Exists($resolved)){Remove-Item -LiteralPath $resolved -Recurse -Force}
  }
}
