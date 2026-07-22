$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$project='farmrx-farmer-simplicity-2027-local';$db="supabase_db_$project";$gateway="supabase_kong_$project";$parked="$db-ordinary-parked"
$apiUrl='http://127.0.0.1:55321';$authHealthUri="$apiUrl/auth/v1/health"
$fixture=Join-Path $root 'tests/season/harvest-ridge-2027-start.sql';$verify=Join-Path $root 'tests/season/harvest-ridge-2027.verify.sql';$reverseVerify=Join-Path $root 'tests/season/harvest-ridge-2027.reverse.verify.sql'
. (Join-Path $root 'scripts/maple-season-credential.ps1')
Import-Module (Join-Path $root 'scripts/harvest-ridge-db-clock.psm1') -Force

function Wait-HarvestRidgeAuth {
  for($attempt=1;$attempt-le30;$attempt++){
    try{$health=Invoke-WebRequest -UseBasicParsing -Uri $authHealthUri -TimeoutSec 2;if($health.StatusCode-eq200-and$health.Content-match'"name"\s*:\s*"GoTrue"'){return}}catch{}
    if($attempt-lt30){Start-Sleep -Milliseconds 500}
  }
  throw 'Harvest Ridge disposable Auth did not become healthy.'
}

function Get-HarvestRidgeAccessToken([string]$PublishableKey){
  $password=$env:FARMRX_SEASON_OWNER_PASSWORD;$payload=$null;$response=$null
  if($password-notmatch'^[0-9a-f]{64}$'){throw 'Harvest Ridge synthetic credential is unavailable.'}
  try{
    $payload=@{email='harvest.owner@farmrx.local.test';password=$password}|ConvertTo-Json -Compress
    $response=Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$apiUrl/auth/v1/token?grant_type=password" -Headers @{apikey=$PublishableKey} -ContentType 'application/json' -Body $payload -TimeoutSec 10
    $token=($response.Content|ConvertFrom-Json -ErrorAction Stop).access_token
    if([string]::IsNullOrWhiteSpace($token)){throw 'missing token'}
    return [string]$token
  }catch{throw 'Harvest Ridge could not obtain a synthetic loopback access token.'}
  finally{$password=$null;$payload=$null;$response=$null}
}

function Invoke-HarvestRidgeSql([string]$Sql){
  $output=@($Sql|docker exec -i $db psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1);if($LASTEXITCODE-ne0){throw 'Harvest Ridge focused SQL assertion failed.'};return [string]::Join("`n",[string[]]$output)
}

function Get-HarvestRidgePhaseSnapshot {
  param([hashtable]$ExcludedRows=@{})
  $tables=@((Invoke-HarvestRidgeSql "select tablename from pg_catalog.pg_tables where schemaname='public' order by tablename;")-split"`r?`n"|Where-Object{$_})
  $lines=[Collections.Generic.List[string]]::new()
  foreach($table in $tables){
    if($table-notmatch'^[a-z][a-z0-9_]*$'){throw 'Harvest Ridge snapshot found an unsafe public table name.'}
    $where='true'
    if($ExcludedRows.ContainsKey($table)){
      $clauses=foreach($entry in @($ExcludedRows[$table])){$parts=@([string]$entry-split':',2);if($parts.Count-ne2-or$parts[0]-cnotin@('id','operation_id')-or$parts[1]-notmatch'^[0-9a-f]{8}-[0-9a-f-]{27}$'){throw 'Harvest Ridge snapshot exclusion is invalid.'};"$($parts[0]) <> '$($parts[1])'::uuid"}
      $where=$clauses-join' and '
    }
    $json=Invoke-HarvestRidgeSql "select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text from (select * from public.`"$table`" where $where) r;"
    $lines.Add("$table|$json")
  }
  $sequenceJson=Invoke-HarvestRidgeSql "select coalesce(jsonb_agg(jsonb_build_object('name',sequencename,'last_value',last_value) order by sequencename),'[]'::jsonb)::text from pg_catalog.pg_sequences where schemaname='public';"
  $lines.Add("__public_sequences|$sequenceJson")
  return [string]::Join("`n",$lines)
}

function Invoke-HarvestRidgePhase {
  param([string]$Name,[string]$FrozenUtc,[string]$ClientInstant,[string]$Grep,[hashtable]$ExcludedRows,[string]$AssertionSql,[string]$PublishableKey,[string]$AccessToken)
  $action={
    $before=Get-HarvestRidgePhaseSnapshot $ExcludedRows
    $prior=[Environment]::GetEnvironmentVariable('FARMRX_HR_CLIENT_INSTANT',[EnvironmentVariableTarget]::Process)
    try{
      [Environment]::SetEnvironmentVariable('FARMRX_HR_CLIENT_INSTANT',$ClientInstant,[EnvironmentVariableTarget]::Process)
      npx playwright test --config playwright.harvest-ridge.config.ts --grep $Grep|Out-Host
      if($LASTEXITCODE-ne0){throw "Harvest Ridge browser phase failed: $Name"}
    }finally{[Environment]::SetEnvironmentVariable('FARMRX_HR_CLIENT_INSTANT',$prior,[EnvironmentVariableTarget]::Process)}
    Invoke-HarvestRidgeSql $AssertionSql|Out-Null
    $after=Get-HarvestRidgePhaseSnapshot $ExcludedRows
    if($before-cne$after){throw "Harvest Ridge phase changed a row outside its exact allowance: $Name"}
    return $true
  }.GetNewClosure()
  $result=@(Invoke-HarvestRidgeClockPhase -Root $root -Phase $Name -FrozenInstant $FrozenUtc -ApiUrl $apiUrl -PublishableKey $PublishableKey -AccessToken $AccessToken -Action $action)
  foreach($line in @($result|Where-Object{$_-is[string]})){Write-Output $line}
  if($result[-1]-ne$true){throw "Harvest Ridge clock phase did not return exact success: $Name"}
}

function Reset-HarvestRidge([string]$Supabase){
  & $Supabase --profile supabase db reset --local --no-seed --yes;if($LASTEXITCODE-ne0){throw 'Harvest Ridge disposable reset failed.'}
  docker restart $gateway|Out-Null;if($LASTEXITCODE-ne0){throw 'Harvest Ridge gateway refresh failed.'}
  Wait-HarvestRidgeAuth
  if(-not(Invoke-MapleSeasonSqlFile -Path $fixture -ExpectedContainer $db)){throw 'Harvest Ridge synthetic fixture failed.'}
}

function Assert-HarvestRidgeNoClockResidue {
  $priorPreference=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{
    $ordinary=@(docker inspect --type container --format '{{.Id}}|{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{.HostConfig.RestartPolicy.Name}}' $db 2>$null);$ordinaryExit=$LASTEXITCODE
    docker inspect --type container $parked 2>$null|Out-Null;$parkedExists=$LASTEXITCODE-eq0
    $images=@(docker image ls --format '{{.Repository}}:{{.Tag}}'|Where-Object{$_-match'^farmrx-(?:clock-snapshot|frozen-clock-swap):'})
  }finally{$ErrorActionPreference=$priorPreference}
  $journals=@(Get-ChildItem ([IO.Path]::GetTempPath()) -Filter 'farmrx-harvest-ridge-clock-*.json' -ErrorAction SilentlyContinue)
  if($ordinaryExit-ne0-or$ordinary.Count-ne1-or$ordinary[0]-notmatch'^[0-9a-f]{64}\|sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5\|true\|healthy\|unless-stopped$'-or$parkedExists-or$images.Count-ne0-or$journals.Count-ne0){throw 'HARVEST_RIDGE_CLOCK_RECOVERY_INCOMPLETE: swapped, parked, image, journal, or restart-policy residue remains.'}
}

if(-not(Get-Command docker -ErrorAction SilentlyContinue)){throw 'Docker CLI is required for Harvest Ridge proof.'}
if(-not(Get-Command npx -ErrorAction SilentlyContinue)){throw 'Node.js/npm with npx is required for Harvest Ridge proof.'}
$supabase=if($env:SUPABASE_GO_BINARY){$env:SUPABASE_GO_BINARY}else{(Get-Command supabase -ErrorAction Stop).Source}
$boundary=$null;$token=$null
Push-Location $root
try{
  if(@(docker ps --format '{{.Names}}')-notcontains$db){&$supabase --profile supabase start;if($LASTEXITCODE-ne0){throw 'Disposable local Supabase start failed.'}}
  $boundary=Assert-MapleSeasonLocalBoundary -Root $root -Supabase $supabase -ExpectedProjectId $project -ExpectedContainer $db
  Enter-MapleSeasonCredential
  Reset-HarvestRidge $supabase
  $token=Get-HarvestRidgeAccessToken $boundary.PublishableKey
  $env:VITE_LOCAL_SUPABASE_PROJECT_REF='farmrxlocalsimplicity2027';$env:VITE_LOCAL_SUPABASE_URL=$boundary.ApiUrl;$env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY=$boundary.PublishableKey

  Invoke-HarvestRidgePhase hr1 '2027-10-11 22:30:00+00:00' '2027-10-11T17:30:00-05:00' '@harvest-ridge-canonical-hr1' @{crop_assignments=@('id:27030000-0000-4000-8000-000000000004');repository_write_receipts=@('operation_id:27076000-0000-4000-8000-000000000004')} @"
do `$hr`$ begin
 if (select harvested_bushels from public.crop_assignments where id='27030000-0000-4000-8000-000000000004') <> 27600 then raise exception 'HR-1 harvest'; end if;
 if (select updated_at from public.crop_assignments where id='27030000-0000-4000-8000-000000000004') <> timestamptz '2027-10-11 22:30:00+00' then raise exception 'HR-1 server updated_at'; end if;
 if (select count(*) from public.repository_write_receipts where operation_id='27076000-0000-4000-8000-000000000004' and completed_at=timestamptz '2027-10-11 22:30:00+00' and result->>'id'='27030000-0000-4000-8000-000000000004') <> 1 then raise exception 'HR-1 receipt timestamp/content'; end if;
 if (select actual_bushels from public.production_estimates where id='27070000-0000-4000-8000-000000000004') is not null then raise exception 'HR-1 reconciled automatically'; end if;
 if exists(select 1 from public.bin_transactions) or exists(select 1 from public.grain_contract_deliveries) then raise exception 'HR-1 hidden grain write'; end if;
end `$hr`$;
"@ $boundary.PublishableKey $token

  Invoke-HarvestRidgePhase hr2 '2027-10-11 22:40:00+00:00' '2027-10-11T17:40:00-05:00' '@harvest-ridge-canonical-hr2' @{} "select 1 where (select actual_bushels from public.production_estimates where id='27070000-0000-4000-8000-000000000004') is null;" $boundary.PublishableKey $token

  Invoke-HarvestRidgePhase hr3 '2027-10-11 22:45:00+00:00' '2027-10-11T17:45:00-05:00' '@harvest-ridge-canonical-hr3' @{production_estimates=@('id:27070000-0000-4000-8000-000000000004')} @"
do `$hr`$ begin if not exists(select 1 from public.production_estimates where id='27070000-0000-4000-8000-000000000004' and actual_bushels=27600 and drives_math='actual' and updated_at=timestamptz '2027-10-11 22:45:00+00') then raise exception 'HR-3 exact reconciliation/server timestamp'; end if; if (select updated_at from public.crop_assignments where id='27030000-0000-4000-8000-000000000004') <> timestamptz '2027-10-11 22:30:00+00' then raise exception 'HR-3 changed harvest'; end if; end `$hr`$;
"@ $boundary.PublishableKey $token

  Invoke-HarvestRidgePhase ext-bin '2027-11-06 14:50:00+00:00' '2027-11-06T08:50:00-06:00' '@harvest-ridge-canonical-extension-bin' @{grain_bins=@('id:27073000-0000-4000-8000-000000000005')} "do `$hr`$ begin if (select count(*) from public.grain_bins where id='27073000-0000-4000-8000-000000000005' and name='Harvest Ridge Proof Bin' and created_at=timestamptz '2027-11-06 14:50:00+00' and updated_at=timestamptz '2027-11-06 14:50:00+00') <> 1 then raise exception 'HR extension bin/server timestamps'; end if; if exists(select 1 from public.bin_transactions) then raise exception 'HR extension bin moved grain'; end if; end `$hr`$;" $boundary.PublishableKey $token

  Invoke-HarvestRidgePhase ext-in '2027-11-06 14:55:00+00:00' '2027-11-06T08:55:00-06:00' '@harvest-ridge-canonical-extension-in' @{bin_transactions=@('id:27074000-0000-4000-8000-000000000005')} "do `$hr`$ begin if (select count(*) from public.bin_transactions where id='27074000-0000-4000-8000-000000000005' and grain_bin_id='27073000-0000-4000-8000-000000000005' and direction='in' and bushels=2600 and commodity_id='corn_yellow' and created_at=timestamptz '2027-11-06 14:55:00+00') <> 1 then raise exception 'HR extension inbound/server timestamp'; end if; if exists(select 1 from public.grain_contract_deliveries) then raise exception 'HR extension inbound delivered contract'; end if; end `$hr`$;" $boundary.PublishableKey $token

  Invoke-HarvestRidgePhase ext-contract '2027-11-06 14:58:00+00:00' '2027-11-06T08:58:00-06:00' '@harvest-ridge-canonical-extension-contract' @{grain_contracts=@('id:27071000-0000-4000-8000-000000000005')} "do `$hr`$ begin if (select count(*) from public.grain_contracts where id='27071000-0000-4000-8000-000000000005' and contract_number='HR-2027-PROOF-001' and bushels=2600 and created_at=timestamptz '2027-11-06 14:58:00+00' and updated_at=timestamptz '2027-11-06 14:58:00+00') <> 1 then raise exception 'HR extension contract/server timestamps'; end if; if (select count(*) from public.bin_transactions) <> 1 then raise exception 'HR extension contract changed bins'; end if; end `$hr`$;" $boundary.PublishableKey $token

  Invoke-HarvestRidgePhase hr4 '2027-11-06 15:00:00+00:00' '2027-11-06T09:00:00-06:00' '@harvest-ridge-canonical-hr4' @{bin_transactions=@('id:27074000-0000-4000-8000-000000000004')} "do `$hr`$ begin if (select count(*) from public.bin_transactions where id='27074000-0000-4000-8000-000000000004' and grain_bin_id='27073000-0000-4000-8000-000000000004' and direction='out' and bushels=5000 and created_at=timestamptz '2027-11-06 15:00:00+00') <> 1 then raise exception 'HR-4 out/server timestamp'; end if; if exists(select 1 from public.grain_contract_deliveries) then raise exception 'HR-4 delivered contract'; end if; end `$hr`$;" $boundary.PublishableKey $token

  Invoke-HarvestRidgePhase hr5 '2027-11-06 15:05:00+00:00' '2027-11-06T09:05:00-06:00' '@harvest-ridge-canonical-hr5' @{grain_contract_deliveries=@('id:27072000-0000-4000-8000-000000000004')} "do `$hr`$ begin if (select count(*) from public.grain_contract_deliveries where id='27072000-0000-4000-8000-000000000004' and grain_contract_id='27071000-0000-4000-8000-000000000004' and bushels=5000 and created_at=timestamptz '2027-11-06 15:05:00+00') <> 1 then raise exception 'HR-5 delivery/server timestamp'; end if; if (select count(*) from public.bin_transactions) <> 2 then raise exception 'HR-5 changed bin ledger'; end if; end `$hr`$;" $boundary.PublishableKey $token

  Invoke-HarvestRidgePhase phone '2027-11-06 15:05:00+00:00' '2027-11-06T09:05:00-06:00' '@harvest-ridge-canonical-phone' @{} "select 1;" $boundary.PublishableKey $token
  Get-Content -Raw -Encoding UTF8 -LiteralPath $verify|docker exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off;if($LASTEXITCODE-ne0){throw 'Harvest Ridge final canonical database assertions failed.'}

  Reset-HarvestRidge $supabase;$token=Get-HarvestRidgeAccessToken $boundary.PublishableKey
  Invoke-HarvestRidgePhase reverse-hr5 '2027-11-06 15:05:00+00:00' '2027-11-06T09:05:00-06:00' '@harvest-ridge-reverse-hr5' @{grain_contract_deliveries=@('id:27072000-0000-4000-8000-000000000005')} "do `$hr`$ begin if (select count(*) from public.grain_contract_deliveries where id='27072000-0000-4000-8000-000000000005' and created_at=timestamptz '2027-11-06 15:05:00+00') <> 1 then raise exception 'HR reverse delivery/server timestamp'; end if; if exists(select 1 from public.bin_transactions) then raise exception 'HR reverse delivery changed bin'; end if; end `$hr`$;" $boundary.PublishableKey $token
  Invoke-HarvestRidgePhase reverse-hr4 '2027-11-06 15:00:00+00:00' '2027-11-06T09:00:00-06:00' '@harvest-ridge-reverse-hr4' @{bin_transactions=@('id:27074000-0000-4000-8000-000000000006')} "do `$hr`$ begin if (select count(*) from public.bin_transactions where id='27074000-0000-4000-8000-000000000006' and created_at=timestamptz '2027-11-06 15:00:00+00') <> 1 then raise exception 'HR reverse out/server timestamp'; end if; if (select created_at from public.grain_contract_deliveries where id='27072000-0000-4000-8000-000000000005') <> timestamptz '2027-11-06 15:05:00+00' then raise exception 'HR reverse delivery instant changed'; end if; end `$hr`$;" $boundary.PublishableKey $token
  Get-Content -Raw -Encoding UTF8 -LiteralPath $reverseVerify|docker exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off;if($LASTEXITCODE-ne0){throw 'Harvest Ridge final reverse database assertions failed.'}
  Write-Output 'HARVEST_RIDGE_2027_DISPOSABLE_PASS'
}finally{
  $token=$null;$boundary=$null
  Remove-Item Env:VITE_LOCAL_SUPABASE_PROJECT_REF -ErrorAction SilentlyContinue;Remove-Item Env:VITE_LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue;Remove-Item Env:VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue;Remove-Item Env:FARMRX_HR_CLIENT_INSTANT -ErrorAction SilentlyContinue
  Exit-MapleSeasonCredential
  try{Assert-HarvestRidgeNoClockResidue}finally{Pop-Location}
}
