Set-StrictMode -Version Latest

if(-not('MapleAtomicMove' -as [type])){Add-Type @'
using System; using System.Runtime.InteropServices;
public static class MapleAtomicMove { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool MoveFileEx(string from, string to, int flags); }
'@}
function Assert-MapleSwapInventory {
  param([hashtable]$Inventory,[hashtable]$ExpectedContract)
  $required = @('base_digest','contract_hash','network_id','original_id','original_image_id','snapshot_tag','derived_tag','volume_name')
  if ((@($Inventory.Keys | Sort-Object) -join '|') -cne (@($required | Sort-Object) -join '|')) {
    throw 'MAPLE_DB_SWAP_REFUSED: journal inventory schema is not exact.'
  }
  foreach ($key in @('contract_hash','network_id','original_id')) { if ($Inventory[$key] -notmatch '^[0-9a-f]{64}$') { throw "MAPLE_DB_SWAP_REFUSED: invalid $key." } }
  if ($Inventory.original_image_id -notmatch '^sha256:[0-9a-f]{64}$') { throw 'MAPLE_DB_SWAP_REFUSED: invalid original_image_id.' }
  if($Inventory.base_digest-notmatch'^public\.ecr\.aws/supabase/postgres@sha256:[0-9a-f]{64}$'){throw'MAPLE_DB_SWAP_REFUSED: invalid base_digest.'}
  if ($Inventory.snapshot_tag -notmatch '^farmrx-clock-snapshot:[0-9a-f]{12}$' -or $Inventory.derived_tag -notmatch '^farmrx-frozen-clock-swap:2027(0[7-9]|1[0-2])[0-3][0-9]-[0-9a-f]{8}$') { throw 'MAPLE_DB_SWAP_REFUSED: invalid image tag.' }
  $productionVolume='supabase_db_farmrx-farmer-simplicity-2027-local'
  $expectedVolume=if($ExpectedContract.ContainsKey('test_only_expected_volume')){$ExpectedContract.test_only_expected_volume}else{$productionVolume}
  if($ExpectedContract.ContainsKey('test_only_expected_volume')-and$expectedVolume-ceq$productionVolume){throw'MAPLE_DB_SWAP_REFUSED: synthetic mode cannot select the production volume.'}
  if ($Inventory.volume_name -cne $expectedVolume) { throw 'MAPLE_DB_SWAP_REFUSED: invalid volume.' }
  $date=[datetime]::MinValue
  if(-not[datetime]::TryParseExact($Inventory.derived_tag.Split(':')[1].Split('-')[0],'yyyyMMdd',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$date)){throw'MAPLE_DB_SWAP_REFUSED: invalid derived date.'}
  $expectedKeys=@($required);if($ExpectedContract.ContainsKey('test_only_expected_volume')){$expectedKeys+='test_only_expected_volume'}
  if ((@($ExpectedContract.Keys | Sort-Object) -join '|') -cne (@($expectedKeys | Sort-Object) -join '|')) { throw 'MAPLE_DB_SWAP_REFUSED: expected contract schema is not exact.' }
  foreach($key in $required){if($Inventory[$key]-cne$ExpectedContract[$key]){throw"MAPLE_DB_SWAP_REFUSED: $key does not match fresh attestation."}}
  $baseHash=$Inventory.base_digest.Split(':')[-1];if($Inventory.original_image_id-cne"sha256:$baseHash"-or-not$Inventory.derived_tag.EndsWith('-'+$baseHash.Substring(0,8))-or-not$Inventory.snapshot_tag.EndsWith(':'+$Inventory.original_id.Substring(0,12))){throw'MAPLE_DB_SWAP_REFUSED: attested image/tag lineage mismatch.'}
  return $true
}

function Write-MapleSwapJournalAtomic {
  param([string]$Path,[string]$Phase,[string]$IntendedNextAction,[hashtable]$Inventory,[hashtable]$ExpectedContract)
  Assert-MapleSwapInventory $Inventory $ExpectedContract | Out-Null
  $directory=[IO.Path]::GetDirectoryName($Path); if(-not [IO.Directory]::Exists($directory)){throw 'MAPLE_DB_SWAP_REFUSED: journal directory is missing.'}
  $temp=Join-Path $directory ('.'+[IO.Path]::GetFileName($Path)+'.'+[guid]::NewGuid().ToString('N')+'.tmp')
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(([ordered]@{version=1;phase=$Phase;intended_next_action=$IntendedNextAction;inventory=$Inventory}|ConvertTo-Json -Depth 5))
  try {
    $stream=[IO.FileStream]::new($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
    try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    if($env:OS -ceq 'Windows_NT'){$null=& icacls $temp /inheritance:r /grant:r "$env:USERNAME`:(F)";if($LASTEXITCODE-ne 0){throw 'MAPLE_DB_SWAP_REFUSED: journal ACL failed.'}}
    if($env:OS-ceq'Windows_NT'){if(-not[MapleAtomicMove]::MoveFileEx($temp,$Path,9)){throw"MAPLE_DB_SWAP_REFUSED: atomic journal move failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."}}else{[IO.File]::Move($temp,$Path)}
  } finally { if([IO.File]::Exists($temp)){[IO.File]::Delete($temp)} }
  return $true
}

function Invoke-CheckedSwapMutation {
  param([hashtable]$Adapter,[hashtable]$Inventory,[string]$Phase,[string]$Next,[scriptblock]$Mutation,[scriptblock]$Postcondition)
  if((& $Adapter['WriteJournal'] $Phase $Next $Inventory)-ne $true){throw "MAPLE_DB_SWAP_FAILED: journal callback was not exactly true at $Phase."}
  & $Mutation
  $actual=& $Adapter['InspectActualState']
  if(-not (& $Postcondition $actual)){throw "MAPLE_DB_SWAP_FAILED: inspected postcondition failed after $Phase."}
  return $actual
}

function Invoke-MapleSwapRecovery {
  param([hashtable]$Adapter,[hashtable]$Inventory)
  try { Assert-MapleSwapInventory $Inventory $Adapter.ExpectedContract | Out-Null } catch {
    return [pscustomobject]@{Restored=$false;Failures=@("recovery inventory refused: $($_.Exception.Message)");JournalRetained=$true}
  }
  $failures=[Collections.Generic.List[string]]::new();$actual=&$Adapter['InspectActualState']
  if($actual.ReplacementExists){
    if($actual.ReplacementOwned -ne $true){$failures.Add('ambiguous replacement ownership');return [pscustomobject]@{Restored=$false;Failures=$failures;JournalRetained=$true}}
    try{$actual=Invoke-CheckedSwapMutation $Adapter $Inventory recovery_remove_replacement inspect_after_removal ($Adapter['RemoveReplacement']) {param($s)-not$s.ReplacementExists}}catch{$failures.Add($_.Exception.Message);return [pscustomobject]@{Restored=$false;Failures=$failures;JournalRetained=$true}}
  }
  $actual=&$Adapter['InspectActualState']
  if($actual.OriginalParked){try{$actual=Invoke-CheckedSwapMutation $Adapter $Inventory recovery_restore_name inspect_after_restore_name ($Adapter['RestoreOriginalName']) {param($s)$s.OriginalCanonical-and-not$s.OriginalParked}}catch{$failures.Add($_.Exception.Message)}}
  $actual=&$Adapter['InspectActualState']
  if($actual.OriginalCanonical-and-not$actual.OriginalRunning){try{$actual=Invoke-CheckedSwapMutation $Adapter $Inventory recovery_start_original inspect_after_original_start ($Adapter['StartOriginal']) {param($s)$s.OriginalCanonical-and$s.OriginalRunning-and$s.OriginalHealthy}}catch{$failures.Add($_.Exception.Message)}}
  $actual=&$Adapter['InspectActualState']
  if($actual.OriginalRunning){try{if((&$Adapter['WriteJournal'] 'recovery_restart_postgrest' 'inspect_postgrest_recovery' $Inventory)-ne$true){throw 'Journal callback was not exactly true.'};if((&$Adapter['RestartPostgrest'])-ne$true){throw 'PostgREST restart callback was not exactly true.'};$actual=&$Adapter['InspectActualState'];if(-not$actual.PostgrestRecovered){throw 'PostgREST recovery inspection failed.'}}catch{$failures.Add($_.Exception.Message)}}
  $actual=&$Adapter['InspectActualState']
  $verified=$failures.Count-eq 0-and$actual.OriginalCanonical-and$actual.OriginalRunning-and$actual.OriginalHealthy-and$actual.PostgrestRecovered-and-not$actual.ReplacementExists
  if($verified){
    $cleanupChecks=@(
      [pscustomobject]@{Action='RemoveDerivedImageIfOwned';Property='DerivedOwned'},
      [pscustomobject]@{Action='RemoveSnapshotImageIfOwned';Property='SnapshotOwned'}
    )
    foreach($cleanup in $cleanupChecks){
      try{
        if((&$Adapter['WriteJournal'] "recovery_$($cleanup.Action)" 'inspect_cleanup' $Inventory)-ne$true){throw 'Journal callback was not exactly true.'}
        if((&$Adapter[$cleanup.Action])-ne$true){throw "$($cleanup.Action) was not exactly true."}
        $actual=&$Adapter['InspectActualState']
        if($actual.($cleanup.Property)){throw "$($cleanup.Action) inspected postcondition failed."}
      }catch{$failures.Add($_.Exception.Message)}
    }
    if($failures.Count-eq 0){
      try{
        if((&$Adapter['WriteJournal'] 'recovery_remove_journal' 'inspect_journal_removal' $Inventory)-ne$true){throw 'Journal callback was not exactly true.'}
        if((&$Adapter['RemoveJournal'])-ne$true){throw 'RemoveJournal was not exactly true.'}
        $actual=&$Adapter['InspectActualState'];if($actual.JournalExists){throw 'RemoveJournal inspected postcondition failed.'}
      }catch{$failures.Add($_.Exception.Message)}
    }
  }
  $actual=&$Adapter['InspectActualState']
  [pscustomobject]@{Restored=($verified-and$failures.Count-eq 0);Failures=$failures;JournalRetained=[bool]$actual.JournalExists}
}

function Invoke-MapleSwapStateMachine {
  param([hashtable]$Adapter,[hashtable]$Inventory)
  Assert-MapleSwapInventory $Inventory $Adapter.ExpectedContract|Out-Null
  $primaryFailure=$null
  $completed=$false
  try {
    $actual=&$Adapter['InspectActualState'];if(-not$actual.OriginalCanonical-or-not$actual.OriginalRunning-or$actual.ReplacementExists-or$actual.OriginalParked){throw 'MAPLE_DB_SWAP_REFUSED: initial actual state is not exact.'}
    $actual=Invoke-CheckedSwapMutation $Adapter $Inventory stop_original inspect_stopped ($Adapter['StopOriginal']) {param($s)$s.OriginalCanonical-and-not$s.OriginalRunning-and$s.OriginalExitCode-eq 0-and-not$s.OriginalOomKilled-and$s.ExclusiveVolume}
    $actual=Invoke-CheckedSwapMutation $Adapter $Inventory snapshot_original inspect_snapshot ($Adapter['SnapshotOriginal']) {param($s)$s.SnapshotOwned}
    $actual=Invoke-CheckedSwapMutation $Adapter $Inventory build_derived inspect_derived ($Adapter['BuildDerived']) {param($s)$s.DerivedOwned}
    $actual=Invoke-CheckedSwapMutation $Adapter $Inventory park_original inspect_parked ($Adapter['ParkOriginal']) {param($s)$s.OriginalParked-and-not$s.OriginalCanonical}
    $actual=Invoke-CheckedSwapMutation $Adapter $Inventory create_replacement inspect_created ($Adapter['CreateReplacement']) {param($s)$s.ReplacementExists-and$s.ReplacementOwned}
    $actual=Invoke-CheckedSwapMutation $Adapter $Inventory start_replacement inspect_started ($Adapter['StartReplacement']) {param($s)$s.ReplacementRunning-and$s.ReplacementHealthy}
    if((&$Adapter['ProveRouteClockAndLineage'])-ne$true){throw 'MAPLE_DB_SWAP_FAILED: route/clock/lineage proof was not exactly true.'}
    $completed=$true
  } catch {
    $primaryFailure=$_.Exception
  } finally {
    try{$recovery=Invoke-MapleSwapRecovery $Adapter $Inventory}catch{$recovery=[pscustomobject]@{Restored=$false;Failures=@("recovery inspection/state failure: $($_.Exception.Message)");JournalRetained=$true;Exception=$_.Exception}}
  }
  if(-not$recovery.Restored){
    $recoveryExceptionProperty=$recovery.PSObject.Properties['Exception'];$recoveryFailure=if($recoveryExceptionProperty-and$recoveryExceptionProperty.Value){$recoveryExceptionProperty.Value}else{[Exception]::new("MAPLE_DB_SWAP_RECOVERY_INCOMPLETE: $($recovery.Failures -join '; ')")}
    if($null-ne$primaryFailure){throw [AggregateException]::new('Swap failed and recovery was incomplete.',[Exception[]]@($primaryFailure,$recoveryFailure))}
    throw $recoveryFailure
  }
  if($null-ne$primaryFailure){throw $primaryFailure}
  if(-not$completed){throw 'MAPLE_DB_SWAP_FAILED: state machine ended without completion.'}
  return 'MAPLE_DB_CLOCK_SWAP_ADAPTER_PASS'
}
Export-ModuleMember -Function Assert-MapleSwapInventory,Write-MapleSwapJournalAtomic,Invoke-CheckedSwapMutation,Invoke-MapleSwapRecovery,Invoke-MapleSwapStateMachine
