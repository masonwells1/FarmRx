$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Read-SeasonHarness([string]$RelativePath) {
  return Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $RelativePath)
}

function Assert-SeasonHarness([bool]$Condition, [string]$Failure) {
  if (-not $Condition) { throw $Failure }
}

$maple = Read-SeasonHarness 'scripts/verify-maple-august-december-disposable.ps1'
Assert-SeasonHarness (-not $maple.Contains('.GetNewClosure()')) 'Maple frozen callbacks reintroduced detached closure scope.'

$mapleBrowser = Read-SeasonHarness 'scripts/maple-season-browser.ps1'
$mapleJob = Read-SeasonHarness 'scripts/maple-season-browser-job.cs'
function Assert-MapleBrowserOwnershipShape([string]$PowerShellText,[string]$JobText) {
  $create = $JobText.IndexOf('if (!CreateProcess(')
  $assign = $JobText.IndexOf('if (!AssignProcessToJobObject(', $create)
  $verify = $JobText.IndexOf('if (!IsProcessInJob(', $assign)
  $resume = $JobText.IndexOf('if (ResumeThread(', $verify)
  Assert-SeasonHarness ($create -ge 0 -and $assign -gt $create -and $verify -gt $assign -and $resume -gt $verify) 'Maple browser root is not created suspended, assigned, verified, and resumed in exact order.'
  Assert-SeasonHarness $JobText.Contains('CreateSuspended | CreateNoWindow') 'Maple browser root no longer starts suspended.'
  Assert-SeasonHarness $JobText.Contains('limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;') 'Maple browser job lost its host-death cleanup backstop.'
  Assert-SeasonHarness $JobText.Contains('error != ErrorMoreData') 'Maple browser job PID enumeration no longer handles a full buffer fail-closed.'
  Assert-SeasonHarness ($JobText.Contains('private struct STARTUPINFOEX')-and$JobText.Contains('ProcThreadAttributeHandleList = new UIntPtr(0x00020002)')) 'Maple browser launch does not use the pointer-sized STARTUPINFOEX handle-list contract.'
  Assert-SeasonHarness ($JobText.Contains('InitializeProcThreadAttributeList(')-and$JobText.Contains('UpdateProcThreadAttribute(')-and$JobText.Contains('DeleteProcThreadAttributeList(attributeList)')) 'Maple browser launch does not initialize, update, and delete its exact process attribute list.'
  Assert-SeasonHarness ($JobText.Contains('Marshal.WriteIntPtr(inheritedHandleList, 0 * IntPtr.Size, stdinHandle)')-and$JobText.Contains('Marshal.WriteIntPtr(inheritedHandleList, 1 * IntPtr.Size, stdoutHandle)')-and$JobText.Contains('Marshal.WriteIntPtr(inheritedHandleList, 2 * IntPtr.Size, stderrHandle)')-and$JobText.Contains('new UIntPtr(checked((uint)inheritedHandleBytes))')) 'Maple browser handle list is not exactly stdin/stdout/stderr with pointer-sized storage.'
  Assert-SeasonHarness ($JobText.Contains('CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent')-and$JobText.Contains('ref STARTUPINFOEX startupInfo')) 'Maple browser launch does not pass STARTUPINFOEX with the mandatory extended creation flag.'
  Assert-SeasonHarness ($JobText.Contains('Marshal.FreeHGlobal(inheritedHandleList)')-and$JobText.Contains('Marshal.FreeHGlobal(attributeList)')) 'Maple browser launch does not free every unmanaged handle-list allocation.'
  Assert-SeasonHarness ($JobText.Contains('GetSuspendedProcessCleanupFailure(')-and$JobText.Contains('if (!terminate(process, 125))')-and$JobText.Contains('if (waitResult == WaitFailed)')-and$JobText.Contains('if (waitResult == WaitTimeout)')) 'Maple failed suspended launch can lose termination or wait failure evidence.'
  Assert-SeasonHarness $JobText.Contains('new Exception[] { primaryFailure, cleanupFailure }') 'Maple assignment and cleanup failures are not retained together.'
  $graceful = $PowerShellText.IndexOf('$gracefulDeadline = [DateTime]::UtcNow.AddMilliseconds($GracefulMilliseconds)')
  $identity = $PowerShellText.IndexOf('$identitySnapshot = @(Get-MapleSeasonJobIdentitySnapshot', $graceful)
  $recheck = $PowerShellText.IndexOf('Assert-MapleSeasonJobIdentitySnapshot', $identity)
  $terminate = $PowerShellText.IndexOf('$Job.Terminate(125)', $recheck)
  $port = $PowerShellText.IndexOf('$portDeadline = [DateTime]::UtcNow.AddMilliseconds($ForcedMilliseconds)', $terminate)
  Assert-SeasonHarness ($graceful -ge 0 -and $identity -gt $graceful -and $recheck -gt $identity -and $terminate -gt $recheck -and $port -gt $terminate) 'Maple browser cleanup does not wait, capture identity, re-check, terminate, and prove port release in exact order.'
  Assert-SeasonHarness ($PowerShellText.Contains('Get-NetTCPConnection -State Listen -ErrorAction Stop')-and$PowerShellText.Contains('[int]$_.LocalPort -eq $Port')) 'Maple browser cleanup no longer scopes its fail-closed port proof to the exact live LISTEN state.'
  $listenerStart=$PowerShellText.IndexOf('function Get-MapleSeasonBrowserListeners')
  $cleanupStart=$PowerShellText.IndexOf('function Stop-MapleSeasonOwnedBrowserJob',$listenerStart)
  $listenerBody=if($listenerStart-ge 0-and$cleanupStart-gt$listenerStart){$PowerShellText.Substring($listenerStart,$cleanupStart-$listenerStart)}else{''}
  Assert-SeasonHarness ($listenerBody.Contains('-ErrorAction Stop')-and$listenerBody.Contains('throw [InvalidOperationException]::new(')-and$listenerBody.Contains('Maple browser listener inspection failed for governed port $Port.')) 'Maple listener inspection does not fail closed on provider/query errors.'
  Assert-SeasonHarness (-not$listenerBody.Contains('SilentlyContinue')) 'Maple listener inspection suppresses provider/query errors.'
  Assert-SeasonHarness $PowerShellText.Contains('Stop-MapleSeasonOwnedBrowserJob -Job $job -Port $port -Scenario $Scenario') 'Maple browser execution no longer invokes exact cleanup from finally.'
  Assert-SeasonHarness $PowerShellText.Contains('$job.Dispose()') 'Maple browser execution no longer closes its exact job.'
  $transcriptStart=$PowerShellText.IndexOf('function Write-MapleSeasonBrowserTranscript')
  $invokeStart=$PowerShellText.IndexOf('function Invoke-MapleSeasonBrowserProof',$transcriptStart)
  $transcriptBody=if($transcriptStart-ge 0-and$invokeStart-gt$transcriptStart){$PowerShellText.Substring($transcriptStart,$invokeStart-$transcriptStart)}else{''}
  Assert-SeasonHarness ($transcriptBody.Contains('[IO.File]::ReadAllLines($Path)')-and$transcriptBody.Contains('$line | Out-Host')) 'Maple browser transcript is not retained and replayed through the Host stream.'
  Assert-SeasonHarness (-not$transcriptBody.Contains('Write-Output')) 'Maple browser transcript reintroduced success-pipeline output.'
  $exitGuard=$PowerShellText.IndexOf('if ([int]$exitCode -ne 0)',$invokeStart)
  $success=$PowerShellText.IndexOf('return $true',$exitGuard)
  $outerFinally=$PowerShellText.IndexOf('} finally {',$success)
  Assert-SeasonHarness ($exitGuard-ge 0-and$success-gt$exitGuard-and$outerFinally-gt$success) 'Maple browser success path does not return exact scalar true after every failure guard.'
  Assert-SeasonHarness (-not $PowerShellText.Contains('taskkill.exe')) 'Maple browser cleanup reintroduced broad taskkill tree termination.'
  Assert-SeasonHarness (-not $PowerShellText.Contains('Stop-Process')) 'Maple browser cleanup reintroduced PID/name-based Stop-Process termination.'
}
Assert-MapleBrowserOwnershipShape $mapleBrowser $mapleJob
$mapleBrowserMutations = @(
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('CreateSuspended | CreateNoWindow','CreateNoWindow') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('if (!AssignProcessToJobObject(','if (false && !AssignProcessToJobObject(') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('if (!IsProcessInJob(','if (false && !IsProcessInJob(') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;','limits.BasicLimitInformation.LimitFlags = 0;') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('error != ErrorMoreData','false') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('private struct STARTUPINFOEX','private struct LEGACY_STARTUPINFO') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('ProcThreadAttributeHandleList = new UIntPtr(0x00020002)','ProcThreadAttributeHandleList = UIntPtr.Zero') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('UpdateProcThreadAttribute(','UpdateProcThreadAttributeRemoved(') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('DeleteProcThreadAttributeList(attributeList)','$null = attributeList') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('Marshal.WriteIntPtr(inheritedHandleList, 2 * IntPtr.Size, stderrHandle)','Marshal.WriteIntPtr(inheritedHandleList, 2 * IntPtr.Size, stdoutHandle)') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent','CreateSuspended | CreateNoWindow') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('ref STARTUPINFOEX startupInfo','ref STARTUPINFO startupInfo') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('Marshal.FreeHGlobal(inheritedHandleList)','$null = inheritedHandleList') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('if (!terminate(process, 125))','if (false)') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('if (waitResult == WaitFailed)','if (false)') },
  [pscustomobject]@{ PowerShell=$mapleBrowser; Job=$mapleJob.Replace('if (waitResult == WaitTimeout)','if (false)') },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('-ErrorAction Stop','-ErrorAction SilentlyContinue'); Job=$mapleJob },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('throw [InvalidOperationException]::new(','return @(); <#'); Job=$mapleJob },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('Assert-MapleSeasonJobIdentitySnapshot -Job $Job -Expected $identitySnapshot -Scenario $Scenario','$true | Out-Null'); Job=$mapleJob },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('$Job.Terminate(125)','$null = $Job'); Job=$mapleJob },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('Get-NetTCPConnection -State Listen -ErrorAction Stop','Get-NetTCPConnection -ErrorAction Stop'); Job=$mapleJob },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('Stop-MapleSeasonOwnedBrowserJob -Job $job -Port $port -Scenario $Scenario','$null = $job'); Job=$mapleJob },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('$job.Dispose()','$null = $job'); Job=$mapleJob },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('$line | Out-Host','Write-Output $line'); Job=$mapleJob },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('$line | Out-Host','$null = $line'); Job=$mapleJob },
  [pscustomobject]@{ PowerShell=$mapleBrowser.Replace('return $true','return'); Job=$mapleJob }
)
foreach($mutation in $mapleBrowserMutations){
  Assert-SeasonHarness ($mutation.PowerShell -cne $mapleBrowser -or $mutation.Job -cne $mapleJob) 'Maple browser ownership mutation did not alter the source contract.'
  $rejected=$false;try{Assert-MapleBrowserOwnershipShape $mutation.PowerShell $mutation.Job}catch{$rejected=$true}
  Assert-SeasonHarness $rejected 'A weakened Maple browser ownership/cleanup mutation survived the shared static gate.'
}

$cedar = Read-SeasonHarness 'scripts/verify-cedar-creek-disposable.ps1'
Assert-SeasonHarness $cedar.Contains('$verifySql = Get-Content -Raw -Encoding UTF8 -LiteralPath $verify') 'Cedar does not capture verification SQL before entering the frozen callback.'
Assert-SeasonHarness $cedar.Contains('$verifyOutput = @($verifySql | docker exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off 2>&1)') 'Cedar frozen verification does not execute its captured SQL directly.'
Assert-SeasonHarness $cedar.Contains("-notmatch 'CEDAR_CREEK_2027_VERIFY_PASS'") 'Cedar frozen verification does not require its exact terminal SQL marker.'
Assert-SeasonHarness (-not $cedar.Contains('Invoke-MapleSeasonSqlFile -Path $verify')) 'Cedar reintroduced the helper call that failed inside the frozen callback.'
function Assert-CedarNativeCaptureShape([string]$Text) {
  $prior = $Text.IndexOf('$priorErrorActionPreference = $ErrorActionPreference')
  $try = $Text.IndexOf('try {',$prior)
  $continue = $Text.IndexOf("`$ErrorActionPreference = 'Continue'",$try)
  $playwright = $Text.IndexOf('$browserOutput = @(& npx playwright test --config playwright.cedar-creek.config.ts 2>&1)',$continue)
  $exit = $Text.IndexOf('$browserExit = $LASTEXITCODE',$playwright)
  $finally = $Text.IndexOf('} finally {',$exit)
  $restore = $Text.IndexOf('$ErrorActionPreference = $priorErrorActionPreference',$finally)
  $output = $Text.IndexOf('$browserOutput | Out-Host',$restore)
  $guard = $Text.IndexOf("if (`$browserExit -ne 0 -or `$browserText -match '(?m)^\s*\d+ failed\s*`$')",$output)
  Assert-SeasonHarness ($prior -ge 0 -and $try -gt $prior -and $continue -gt $try -and $playwright -gt $continue -and $exit -gt $playwright -and $finally -gt $exit -and $restore -gt $finally -and $output -gt $restore -and $guard -gt $output) 'Cedar native Playwright capture does not set, scope, restore, emit, and check error state in exact order.'
  Assert-SeasonHarness ([regex]::Matches($Text,[regex]::Escape("`$ErrorActionPreference = 'Continue'")).Count -eq 1) 'Cedar native Playwright capture does not contain exactly one narrow Continue preference.'
  Assert-SeasonHarness $Text.Contains('throw "CEDAR_CREEK_BROWSER_FAILED:$viewport:exit=$browserExit"') 'Cedar browser capture does not fail closed on its explicit result guard.'
}
Assert-CedarNativeCaptureShape $cedar
$cedarCaptureMutations = @(
  $cedar.Replace('$priorErrorActionPreference = $ErrorActionPreference', '$priorErrorActionPreference = $null'),
  $cedar.Replace("`$ErrorActionPreference = 'Continue'", "`$ErrorActionPreference = 'Stop'"),
  $cedar.Replace('$browserExit = $LASTEXITCODE', '$browserExit = 0'),
  $cedar.Replace('$ErrorActionPreference = $priorErrorActionPreference', "`$ErrorActionPreference = 'Continue'"),
  $cedar.Replace('$browserExit -ne 0 -or ', ''),
  $cedar.Replace("`$browserText -match '(?m)^\s*\d+ failed\s*`$'", '$false')
)
foreach ($mutation in $cedarCaptureMutations) {
  Assert-SeasonHarness ($mutation -cne $cedar) 'Cedar native-capture mutation did not alter the source contract.'
  $rejected = $false
  try { Assert-CedarNativeCaptureShape $mutation } catch { $rejected = $true }
  Assert-SeasonHarness $rejected 'Cedar native-capture mutation survived the static guard.'
}

$harvest = Read-SeasonHarness 'scripts/verify-harvest-ridge-disposable.ps1'
Assert-SeasonHarness $harvest.Contains('function Wait-HarvestRidgeFarmApi') 'Harvest lacks authenticated farm-read readiness.'
Assert-SeasonHarness $harvest.Contains("if(`$_.Exception.Message-notmatch'authenticated API read failed'-or-not(Test-Path -LiteralPath `$journal)){throw}") 'Harvest recovery is not gated by both the exact route failure and its owned journal.'
Assert-SeasonHarness $harvest.Contains('-ResumeRecovery') 'Harvest does not resume the journaled recovery state.'
Assert-SeasonHarness $harvest.Contains('Restart-HarvestRidgeGateway $PublishableKey $AccessToken') 'Harvest does not re-prove gateway and authenticated API readiness.'

$pine = Read-SeasonHarness 'scripts/verify-pine-hill-disposable.ps1'
Assert-SeasonHarness $pine.Contains('function Wait-PineFarmApi') 'Pine lacks authenticated farm-read readiness.'
Assert-SeasonHarness $pine.Contains('function Invoke-PineClockPhase') 'Pine lacks its bounded clock-phase recovery wrapper.'
Assert-SeasonHarness $pine.Contains("if(`$_.Exception.Message-notmatch'authenticated API read failed'-or-not(Test-Path -LiteralPath `$journal)){throw}") 'Pine recovery is not gated by both the exact route failure and its owned journal.'
Assert-SeasonHarness $pine.Contains('-ResumeRecovery') 'Pine does not resume the journaled recovery state.'
$residueFence = $pine.IndexOf('Assert-PineNoClockResidue', $pine.IndexOf('function Reset-Pine'))
$resetMutation = $pine.IndexOf('--profile supabase db reset', $pine.IndexOf('function Reset-Pine'))
Assert-SeasonHarness ($residueFence -ge 0 -and $resetMutation -gt $residueFence) 'Pine does not refuse clock residue before its reset mutation.'

$season = Read-SeasonHarness 'scripts/verify-season.ps1'
$soilSeasonBridge = "  Invoke-SeasonLane { & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/season-shared-harness-repair.regression.ps1 } 'Season shared harness repair regression failed.' | Out-Null"
function Assert-SoilSeasonBridgeShape([string]$Text) {
  $contract = $Text.IndexOf("  Invoke-SeasonLane { & node scripts/verify-season-contract.regression.mjs } 'Season fixture contract regression failed.'")
  $bridge = $Text.IndexOf($soilSeasonBridge)
  $pass = $Text.IndexOf("  Write-Output 'Farm Rx season contract gate: PASS (contract/isolation only; disposable-backend and browser workflow proof not yet run)'")
  Assert-SeasonHarness ($contract -ge 0 -and $bridge -gt $contract -and $pass -gt $bridge) 'Soil season shared-harness bridge is not between contract regression and contract-only PASS.'
  Assert-SeasonHarness ([regex]::Matches($Text,[regex]::Escape($soilSeasonBridge)).Count -eq 1) 'Soil season shared-harness bridge is not exactly one guarded invocation.'
  Assert-SeasonHarness ([regex]::Matches($Text,[regex]::Escape('scripts/season-shared-harness-repair.regression.ps1')).Count -eq 1) 'Soil season shared-harness path is duplicated or invoked outside its guard.'
}
Assert-SoilSeasonBridgeShape $season
$soilSeasonBridgeMutations = [ordered]@{
  deletion = $season.Replace("$soilSeasonBridge`r`n",'').Replace("$soilSeasonBridge`n",'')
  duplication = $season.Replace($soilSeasonBridge,"$soilSeasonBridge`n$soilSeasonBridge")
  wrong_path = $season.Replace('scripts/season-shared-harness-repair.regression.ps1','scripts/season-shared-harness.regression.ps1')
  wrong_failure = $season.Replace('Season shared harness repair regression failed.','Season harness failed.')
  raw_invocation = $season.Replace($soilSeasonBridge,'  & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/season-shared-harness-repair.regression.ps1')
  after_pass = $season.Replace("$soilSeasonBridge`r`n",'').Replace("$soilSeasonBridge`n",'').Replace("  Write-Output 'Farm Rx season contract gate: PASS (contract/isolation only; disposable-backend and browser workflow proof not yet run)'","  Write-Output 'Farm Rx season contract gate: PASS (contract/isolation only; disposable-backend and browser workflow proof not yet run)'`n$soilSeasonBridge")
  success_stream_pollution = $season.Replace("$soilSeasonBridge","  Invoke-SeasonLane { & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/season-shared-harness-repair.regression.ps1 } 'Season shared harness repair regression failed.'")
}
$soilSeasonBridgeRejected = 0
foreach ($entry in $soilSeasonBridgeMutations.GetEnumerator()) {
  Assert-SeasonHarness ($entry.Value -cne $season) "Soil season bridge mutation did not alter source: $($entry.Key)"
  $rejected = $false
  try { Assert-SoilSeasonBridgeShape $entry.Value } catch { $rejected = $true }
  Assert-SeasonHarness $rejected "Soil season bridge mutation survived: $($entry.Key)"
  $soilSeasonBridgeRejected++
}
Assert-SeasonHarness ($soilSeasonBridgeRejected -eq 7) 'Soil season bridge mutation count drifted.'

Write-Output 'SEASON_SHARED_HARNESS_REPAIR_REGRESSION_PASS'
