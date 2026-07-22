$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'maple-season-db-clock-swap-adapter.psm1') -Force
function Assert-True($v,$m){if(-not$v){throw $m}}
$baseHash='9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5';$inventory=@{base_digest="public.ecr.aws/supabase/postgres@sha256:$baseHash";contract_hash=('a'*64);network_id=('b'*64);original_id=('c'*64);original_image_id="sha256:$baseHash";snapshot_tag=('farmrx-clock-snapshot:'+('c'*12));derived_tag='farmrx-frozen-clock-swap:20270709-9faa7279';volume_name='supabase_db_farmrx-farmer-simplicity-2027-local'}

function New-Mock([string]$FailAction='',[string]$FailWhen=''){
  $state=@{OriginalCanonical=$true;OriginalRunning=$true;OriginalHealthy=$true;OriginalExitCode=0;OriginalOomKilled=$false;OriginalRestartPolicy='unless-stopped';OriginalStopAttested=$false;ExclusiveVolume=$true;OriginalParked=$false;SnapshotOwned=$false;DerivedOwned=$false;JournalExists=$true;ReplacementExists=$false;ReplacementOwned=$false;ReplacementRunning=$false;ReplacementHealthy=$false;PostgrestRecovered=$true}
  $log=[Collections.Generic.List[string]]::new();$a=@{ExpectedContract=$inventory.Clone()}
  $a.InspectActualState={ $log.Add('inspect'); [pscustomobject]$state }.GetNewClosure()
  $a.WriteJournal={param($phase,$next,$inv)$log.Add("journal:$phase->$next");$true}.GetNewClosure()
  function New-Mutation($name,[scriptblock]$effect,$actionLog,$injectedAction,$injectedWhen){$n=$name;$e=$effect;$l=$actionLog;$fa=$injectedAction;$fw=$injectedWhen;{ $l.Add($n);if($fa-ceq$n-and$fw-ceq'before'){throw "BEFORE:$n"};&$e;if($fa-ceq$n-and$fw-ceq'after'){throw "AFTER:$n"};$true}.GetNewClosure()}
  $a.StopOriginal=New-Mutation stop ({$state.OriginalRunning=$false;$state.OriginalHealthy=$false;$state.OriginalExitCode=0;$state.OriginalStopAttested=$true}.GetNewClosure()) $log $FailAction $FailWhen
  $a.SnapshotOriginal=New-Mutation snapshot ({$state.SnapshotOwned=$true}.GetNewClosure()) $log $FailAction $FailWhen
  $a.BuildDerived=New-Mutation build ({$state.DerivedOwned=$true}.GetNewClosure()) $log $FailAction $FailWhen
  $a.ParkOriginal=New-Mutation park ({$state.OriginalCanonical=$false;$state.OriginalParked=$true}.GetNewClosure()) $log $FailAction $FailWhen
  $a.CreateReplacement=New-Mutation create ({$state.ReplacementExists=$true;$state.ReplacementOwned=$true}.GetNewClosure()) $log $FailAction $FailWhen
  $a.StartReplacement=New-Mutation start ({$state.ReplacementRunning=$true;$state.ReplacementHealthy=$true;$state.PostgrestRecovered=$false}.GetNewClosure()) $log $FailAction $FailWhen
  $a.ProveRouteClockAndLineage={$log.Add('prove-route-clock');$true}.GetNewClosure()
  $a.RemoveReplacement={if(-not$state.ReplacementOwned){throw 'AMBIGUOUS'};$log.Add('remove-replacement');$state.ReplacementExists=$false;$state.ReplacementRunning=$false;$true}.GetNewClosure()
  $a.RestoreOriginalName={$log.Add('restore-name');$state.OriginalParked=$false;$state.OriginalCanonical=$true;$true}.GetNewClosure()
  $a.RestoreOriginalRestartPolicy={$log.Add('restore-policy');$state.OriginalRestartPolicy='unless-stopped';$true}.GetNewClosure()
  $a.StartOriginal={$log.Add('start-original');$state.OriginalRunning=$true;$state.OriginalHealthy=$true;$state.OriginalExitCode=0;$state.OriginalStopAttested=$false;$true}.GetNewClosure()
  $a.RestartPostgrest={$log.Add('restart-rest');$state.PostgrestRecovered=$true;$true}.GetNewClosure()
  $a.RemoveDerivedImageIfOwned={$log.Add('cleanup-derived');$state.DerivedOwned=$false;$true}.GetNewClosure();$a.RemoveSnapshotImageIfOwned={$log.Add('cleanup-snapshot');$state.SnapshotOwned=$false;$true}.GetNewClosure();$a.RemoveJournal={$log.Add('cleanup-journal');$state.JournalExists=$false;$true}.GetNewClosure()
  @{Adapter=$a;State=$state;Log=$log}
}

foreach($action in @('stop','snapshot','build','park','create','start')){
  foreach($when in @('before','after')){
    $m=New-Mock $action $when
    try{Invoke-MapleSwapStateMachine $m.Adapter $inventory|Out-Null}catch{}
    Assert-True ($m.State.OriginalCanonical-and$m.State.OriginalRunning-and-not$m.State.OriginalParked-and-not$m.State.ReplacementExists) "actual model not restored after $action/$when"
    Assert-True (($m.Log|Where-Object {$_-like'journal:*'}).Count-gt 0) 'journal was not written before the attempted mutation'
    Assert-True (($m.Log-join'|')-match'inspect.*cleanup-journal') 'restore inspection/order missing'
  }
}
$primary=New-Mock 'stop' 'after';try{Invoke-MapleSwapStateMachine $primary.Adapter $inventory|Out-Null;$primaryMessage=''}catch{$primaryMessage=$_.Exception.Message};Assert-True($primaryMessage-ceq'AFTER:stop')'successful recovery masked the initiating failure'
$held=New-Mock;$heldAction={$held.Log.Add('frozen-action');Assert-True($held.State.ReplacementExists-and$held.State.ReplacementRunning-and$held.State.ReplacementHealthy)'frozen action did not run on the proved replacement';$true}.GetNewClosure()
Assert-True((Invoke-MapleSwapStateMachine $held.Adapter $inventory $heldAction)-ceq'MAPLE_DB_CLOCK_SWAP_ADAPTER_PASS')'held frozen action state machine failed'
$heldText=$held.Log-join'|';Assert-True($heldText-match'prove-route-clock\|journal:run_frozen_action->prove_after_frozen_action\|frozen-action\|prove-route-clock\|inspect\|journal:recovery_remove_replacement')'frozen action was not bracketed by proof and recovery'
$failedAction=New-Mock;$actionFailure={throw 'FROZEN_ACTION_FAILED'};try{Invoke-MapleSwapStateMachine $failedAction.Adapter $inventory $actionFailure|Out-Null;$actionFailureMessage=''}catch{$actionFailureMessage=$_.Exception.Message};Assert-True($actionFailureMessage-ceq'FROZEN_ACTION_FAILED'-and$failedAction.State.OriginalCanonical-and$failedAction.State.OriginalRunning-and-not$failedAction.State.ReplacementExists)'frozen action failure was masked or not recovered'
$amb=New-Mock;$amb.State.OriginalCanonical=$false;$amb.State.OriginalParked=$true;$amb.State.OriginalRunning=$false;$amb.State.ReplacementExists=$true;$amb.State.ReplacementOwned=$false;$result=Invoke-MapleSwapRecovery $amb.Adapter $inventory;Assert-True(-not$result.Restored-and$result.JournalRetained)'ambiguous ownership did not retain journal';Assert-True(-not(($amb.Log-join'|')-match'restore-name'))'ambiguous ownership allowed volume-conflicting restore'
$cleanup=New-Mock;$cleanup.Adapter.RemoveDerivedImageIfOwned={$false};$cleanupResult=Invoke-MapleSwapRecovery $cleanup.Adapter $inventory;Assert-True(-not$cleanupResult.Restored-and$cleanupResult.JournalRetained-and$cleanup.State.JournalExists)'cleanup failure removed the recovery journal'
$extra=$inventory.Clone();$extra.extra='x'
foreach($bad in @($extra,@{contract_hash='bad';network_id=('b'*64);original_id=('c'*64);original_image_id=('sha256:'+('d'*64));snapshot_tag=('farmrx-clock-snapshot:'+('e'*12));derived_tag='farmrx-frozen-clock-swap:20270200-9faa7279';volume_name='supabase_db_farmrx-farmer-simplicity-2027-local'})){try{Assert-MapleSwapInventory $bad $inventory|Out-Null;$accepted=$true}catch{$accepted=$false};Assert-True(-not$accepted)'invalid inventory accepted'}
foreach($field in @('contract_hash','network_id')){$stale=$inventory.Clone();$stale[$field]=('f'*64);try{Assert-MapleSwapInventory $stale $inventory|Out-Null;$accepted=$true}catch{$accepted=$false};Assert-True(-not$accepted)"valid-shaped stale $field accepted"}
foreach($field in @('contract_hash','network_id','original_id')){$stale=$inventory.Clone();$stale[$field]=('f'*64);$recoveryMock=New-Mock;$recoveryResult=Invoke-MapleSwapRecovery $recoveryMock.Adapter $stale;Assert-True(-not$recoveryResult.Restored-and$recoveryResult.JournalRetained-and$recoveryResult.Failures[0]-match'recovery inventory refused')"direct recovery accepted stale $field";Assert-True($recoveryMock.Log.Count-eq 0)"direct recovery inspected or mutated state for stale $field"}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('maple-journal-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp)|Out-Null
try{
  $path=Join-Path $temp 'journal.json'
  Assert-True ((Write-MapleSwapJournalAtomic $path captured stop $inventory $inventory)-eq$true) 'atomic write failed'
  Assert-True ((Write-MapleSwapJournalAtomic $path stopped snapshot $inventory $inventory)-eq$true) 'atomic overwrite failed'
  $j=Get-Content -Raw $path|ConvertFrom-Json
  Assert-True ($j.phase-ceq'stopped'-and$j.intended_next_action-ceq'snapshot') 'atomic overwrite content wrong'
  if($env:OS-ceq'Windows_NT'){$acl=(& icacls $path)-join"`n";Assert-True($acl-match[regex]::Escape($env:USERNAME))'journal ACL was not preserved'}
  Assert-True (@(Get-ChildItem $temp -Filter '*.tmp').Count-eq 0) 'temp journal leaked'
  if($env:OS-ceq'Windows_NT'){$acl=Get-Acl $path;$unexpected=@($acl.Access|Where-Object{$_.IdentityReference.Value-notlike"*$env:USERNAME"});Assert-True($unexpected.Count-eq 0)'journal ACL grants an unexpected identity'}
}finally{Remove-Item -LiteralPath $temp -Recurse -Force}
$both=New-Mock;$both.Adapter.StopOriginal={throw 'PRIMARY_STOP'};$counter=@{n=0};$both.Adapter.InspectActualState={$counter.n++;if($counter.n-ge 2){throw 'RECOVERY_INSPECT'};[pscustomobject]$both.State}.GetNewClosure();try{Invoke-MapleSwapStateMachine $both.Adapter $inventory|Out-Null}catch{$aggregate=$_.Exception};$aggregateEvidence="$($aggregate.GetType().FullName)|$($aggregate.Message)|$($aggregate.InnerExceptions.Message-join'|')";Assert-True($aggregate-is[AggregateException]-and$aggregate.InnerExceptions.Count-eq 2-and$aggregateEvidence-match'PRIMARY_STOP'-and$aggregateEvidence-match'RECOVERY_INSPECT')"primary and recovery errors were not aggregated: $aggregateEvidence"
Write-Output 'MAPLE_SEASON_DB_CLOCK_SWAP_ADAPTER_REGRESSION_PASS'
