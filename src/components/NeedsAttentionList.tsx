import { useSyncExternalStore, useState } from 'react'
import { EquipmentTasksWriteQueue } from '../data/equipmentTasksWriteQueue'
import { GrainWriteQueue } from '../data/grainWriteQueue'
import { InventoryWriteQueue } from '../data/inventoryWriteQueue'
import { dismissNeedsAttention, getNeedsAttentionVersion, readNeedsAttention, subscribeNeedsAttention, type NeedsAttentionRecord } from '../data/needsAttentionStore'
import { ProfitabilityWriteQueue } from '../data/profitabilityWriteQueue'
import { SAVE_DURABILITY_UPDATE_MESSAGE } from '../data/saveDurability'

type Module = 'inventory' | 'grain' | 'equipment_tasks' | 'profitability'
type Row = NeedsAttentionRecord & { queueKey: string }
function records(queueKey: string | null): Row[] { return typeof window === 'undefined' || !queueKey ? [] : readNeedsAttention(window.localStorage, queueKey).map((record) => ({ ...record, queueKey })) }
function label(entry: unknown) {
  const kind = entry && typeof entry === 'object' ? String((entry as { kind?: unknown }).kind ?? '') : ''
  return ({ saveProduct: 'Product', saveReceiptBundle: 'Receipt', cancelReceipt: 'Receipt cancellation', addAdjustment: 'Count adjustment', saveApplicationBundle: 'Spray record', saveProductionEstimate: 'Production estimate', saveContract: 'Grain contract', replaceMarketingPlan: 'Marketing plan', saveCashBid: 'Cash bid', saveMarketingAlertRule: 'Marketing alert', deleteMarketingAlertRule: 'Marketing alert removal', saveFirmOffer: 'Firm offer', deleteFirmOffer: 'Firm offer removal', upsertGrainBin: 'Grain bin', appendBinTransaction: 'Bin movement', saveGrainAlertSettings: 'Alert settings', saveEquipment: 'Machine', addMeterReading: 'Meter reading', saveInterval: 'Service reminder', addServiceLogEntry: 'Service record', saveTask: 'Task', deleteTask: 'Task removal', deleteServiceLogEntry: 'Service record removal', deleteInterval: 'Service reminder removal', createBudget: 'Budget', saveBudget: 'Budget', saveCostLine: 'Budget cost', deleteCostLine: 'Budget cost removal', replaceMatrixSteps: 'Profitability matrix', saveAllocation: 'Field allocation', deleteAllocation: 'Field allocation removal', copyBudget: 'Budget copy' } as Record<string, string>)[kind] ?? 'Saved change'
}
export function cannotRetry(row: Pick<NeedsAttentionRecord, 'entry' | 'reason' | 'message'>) {
  const entry = row.entry as { kind?: unknown; legacyUnknownSnapshot?: unknown }
  return entry?.legacyUnknownSnapshot === true || row.reason === 'database_update_required' || row.message === SAVE_DURABILITY_UPDATE_MESSAGE || row.message.includes('original matrix snapshot is unknown')
}
function append(module: Module, queueKey: string, entry: unknown) {
  if (module === 'inventory') return new InventoryWriteQueue(window.localStorage, queueKey).append(entry as never)
  if (module === 'grain') return new GrainWriteQueue(window.localStorage, queueKey).append(entry as never)
  if (module === 'equipment_tasks') return new EquipmentTasksWriteQueue(window.localStorage, queueKey).append(entry as never)
  return new ProfitabilityWriteQueue(window.localStorage, queueKey).append(entry as never)
}

export function NeedsAttentionList({ module, queueKey, onChanged }: { module: Module; queueKey: string | null; onChanged: () => void | Promise<void> }) {
  useSyncExternalStore(subscribeNeedsAttention, getNeedsAttentionVersion, getNeedsAttentionVersion)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const rows = records(queueKey)
  if (!rows.length) return null
  const retry = async (row: Row) => {
    if (retrying === row.id) return
    setRetrying(row.id)
    try { append(module, row.queueKey, row.entry); dismissNeedsAttention(window.localStorage, row.queueKey, row.id); setError(''); await onChanged() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'This save could not be queued again.') }
    finally { setRetrying(null) }
  }
  const dismiss = async (row: Row) => {
    try { dismissNeedsAttention(window.localStorage, row.queueKey, row.id); setConfirming(null); setError(''); await onChanged() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'This save could not be dismissed.') }
  }
  return <section className="needs-attention-list" aria-label="Saves that need attention"><h2>Saved changes that need attention</h2><p>These changes are safely kept on this device. Review each one before removing it.</p>{error && <p className="needs-attention-error" role="alert">{error}</p>}{rows.map((row) => <article key={`${row.queueKey}:${row.id}`}><div><strong>{label(row.entry)}</strong><span>Saved {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.createdAt))}</span><p>{cannotRetry(row) ? `${row.message} Reload the app after the update.` : `${row.message} Retry sends the same saved change again.`}</p></div><div className="needs-attention-actions">{cannotRetry(row) ? <span className="needs-attention-update">Update needed</span> : <button className="secondary-action" type="button" disabled={retrying === row.id} onClick={() => void retry(row)}>{retrying === row.id ? 'Retrying…' : 'Retry'}</button>}{confirming === row.id ? <><span>Dismiss without saving?</span><button className="danger-action" type="button" onClick={() => void dismiss(row)}>Yes, dismiss</button><button type="button" onClick={() => setConfirming(null)}>Keep it</button></> : <button type="button" onClick={() => setConfirming(row.id)}>Dismiss</button>}</div></article>)}</section>
}
