$ErrorActionPreference = 'Stop'

function Get-Slice([string]$Text, [string]$Start, [string]$End) {
  $startIndex = $Text.IndexOf($Start, [System.StringComparison]::Ordinal)
  if ($startIndex -lt 0) { throw "Missing start marker: $Start" }
  $endIndex = $Text.IndexOf($End, $startIndex + $Start.Length, [System.StringComparison]::Ordinal)
  if ($endIndex -lt 0) { throw "Missing end marker: $End" }
  $Text.Substring($startIndex, $endIndex - $startIndex)
}

function Assert-Guard([string]$Name, [bool]$Condition) {
  if (-not $Condition) { throw "STATIC GUARD FAILED: $Name" }
  $script:passed += 1
  Write-Output "PASS $($script:passed)/11 $Name"
}

$fieldsText = Get-Content -Raw 'src/data/QueuedFieldsRepository.ts'
$equipmentText = Get-Content -Raw 'src/data/QueuedEquipmentTasksRepository.ts'
$cacheText = Get-Content -Raw 'src/data/workspaceCache.ts'
$fields = Get-Slice $fieldsText 'async getSnapshot(' 'async saveField('
$equipment = Get-Slice $equipmentText 'async getSnapshot(' 'private receiptId('
$pureCache = Get-Slice $cacheText 'export async function readWorkspaceCachePure' 'export async function deleteUserWorkspaceCaches'
$passed = 0

Assert-Guard 'Fields snapshot uses the dedicated pure writer path' ($fields.Contains('writer.getSnapshot(operationContext)'))
Assert-Guard 'Fields snapshot uses the non-creating pure cache path' ($fields.Contains('readWorkspaceCachePure<FieldsData>'))
Assert-Guard 'Fields snapshot never replays queued writes' (-not $fields.Contains('replayCurrent'))
Assert-Guard 'Fields snapshot never writes workspace cache' (-not $fields.Contains('writeWorkspaceCache('))
Assert-Guard 'Fields snapshot does not mutate retained workspace, receipts, or sync state' (-not ($fields -match 'this\.workspace\s*=|this\.workspaceCapturedAt\s*=|receiptFieldIds\.|setModuleSyncStatus'))
Assert-Guard 'Equipment snapshot uses the dedicated pure writer path' ($equipment.Contains('writer.getSnapshot(operationContext)'))
Assert-Guard 'Equipment snapshot uses the non-creating pure cache path' ($equipment.Contains('readWorkspaceCachePure<EquipmentTasksWorkspace>'))
Assert-Guard 'Equipment snapshot never replays writes or generates due work' (-not ($equipment -match 'replayCurrent|generateDue|inspectAndReplay'))
Assert-Guard 'Equipment snapshot never writes workspace cache' (-not $equipment.Contains('writeWorkspaceCache('))
Assert-Guard 'Equipment snapshot does not mutate retained workspace, receipts, or sync state' (-not ($equipment -match 'this\.workspace\s*=|this\.workspaceCapturedAt\s*=|setSaveReceipt|setModuleSyncStatus'))
Assert-Guard 'Pure cache read opens only existing storage, stays readonly, and never publishes or writes' ($pureCache.Contains('openExisting(scope.projectRef)') -and $pureCache.Contains("transaction(storeName, 'readonly')") -and -not ($pureCache -match 'publish\(|\.put\(|readwrite|open\(scope\.projectRef\)'))

Write-Output 'STATIC_GUARDS_PASS 11/11'
