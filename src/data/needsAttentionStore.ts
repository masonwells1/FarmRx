import type { StorageLike } from './writeQueue'

export type NeedsAttentionReason = 'database_update_required'
export interface NeedsAttentionRecord { id: string; module: string; createdAt: string; message: string; entry: unknown; reason?: NeedsAttentionReason }
interface Envelope { version: 1; records: NeedsAttentionRecord[] }
const valid = (value: unknown): value is NeedsAttentionRecord => !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).id === 'string' && typeof (value as Record<string, unknown>).module === 'string' && typeof (value as Record<string, unknown>).createdAt === 'string' && typeof (value as Record<string, unknown>).message === 'string' && Object.hasOwn(value as object, 'entry') && (!Object.hasOwn(value as object, 'reason') || (value as Record<string, unknown>).reason === 'database_update_required')
const listeners = new Set<() => void>()
let version = 0
const changed = () => { version += 1; listeners.forEach((listener) => listener()) }
export function getNeedsAttentionVersion() { return version }
export function subscribeNeedsAttention(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
function parse(value: string | null): Envelope {
  if (value === null) return { version: 1, records: [] }
  try { const parsed: unknown = JSON.parse(value); if (!!parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1 && Array.isArray((parsed as { records?: unknown }).records) && (parsed as { records: unknown[] }).records.every(valid)) return parsed as Envelope } catch { /* handled below */ }
  console.warn('Farm Rx discarded a corrupt saved-needs-attention record on this device.')
  return { version: 1, records: [] }
}
export function needsAttentionKey(queueKey: string) { return `${queueKey}:needs-attention` }
export function readNeedsAttention(storage: StorageLike, queueKey: string) { return parse(storage.getItem(needsAttentionKey(queueKey))).records }
export function appendNeedsAttention(storage: StorageLike, queueKey: string, record: NeedsAttentionRecord) {
  const current = readNeedsAttention(storage, queueKey)
  const next: Envelope = { version: 1, records: current.some((item) => item.id === record.id) ? current.map((item) => item.id === record.id ? record : item) : [...current, record] }
  const bytes = JSON.stringify(next); storage.setItem(needsAttentionKey(queueKey), bytes)
  const readBack = storage.getItem(needsAttentionKey(queueKey)); if (readBack !== bytes || !readBack || !parse(readBack).records.some((item) => item.id === record.id)) throw new Error('This save could not be retained for review on this device. Keep this screen open and try again.')
  changed(); return next.records
}
export function dismissNeedsAttention(storage: StorageLike, queueKey: string, id: string) {
  const next: Envelope = { version: 1, records: readNeedsAttention(storage, queueKey).filter((item) => item.id !== id) }
  const bytes = JSON.stringify(next); storage.setItem(needsAttentionKey(queueKey), bytes)
  if (storage.getItem(needsAttentionKey(queueKey)) !== bytes) throw new Error('This save could not be dismissed on this device.')
  changed()
}
