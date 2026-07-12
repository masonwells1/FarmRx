import { validateHarvestDraft, type HarvestDraft } from './harvest'
import type { StorageLike } from './writeQueue'

export interface HarvestQueueEntryV1 { version: 1; module: 'harvest'; kind: 'saveHarvest'; operationId: string; userId: string; farmId: string; enqueuedAt: string; draft: HarvestDraft }
export interface HarvestQueueEnvelopeV1 { version: 1; entries: HarvestQueueEntryV1[] }
const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
function valid(value: unknown): value is HarvestQueueEntryV1 {
  if (!record(value) || !exact(value, ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt', 'draft']) || value.version !== 1 || value.module !== 'harvest' || value.kind !== 'saveHarvest' || ![value.operationId, value.userId, value.farmId].every((item) => typeof item === 'string' && uuid.test(item)) || typeof value.enqueuedAt !== 'string' || Number.isNaN(Date.parse(value.enqueuedAt)) || !record(value.draft) || validateHarvestDraft(value.draft) !== null) return false
  return true
}
export function parseHarvestQueue(serialized: string): HarvestQueueEnvelopeV1 { let parsed: unknown; try { parsed = JSON.parse(serialized) } catch { throw new Error(blocked) }; if (!record(parsed) || !exact(parsed, ['version', 'entries']) || parsed.version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(valid)) throw new Error(blocked); return parsed as unknown as HarvestQueueEnvelopeV1 }
export class HarvestWriteQueue {
  constructor(private readonly storage: StorageLike, readonly key: string) {}
  read() { const raw = this.storage.getItem(this.key); return raw === null ? { version: 1 as const, entries: [] } : parseHarvestQueue(raw) }
  private persist(next: HarvestQueueEnvelopeV1) { const raw = JSON.stringify(next); parseHarvestQueue(raw); this.storage.setItem(this.key, raw); if (this.storage.getItem(this.key) !== raw) throw new Error('This harvest entry could not be saved on this device. Keep this screen open and try again.') }
  append(entry: HarvestQueueEntryV1) { const next = { version: 1 as const, entries: [...this.read().entries, entry] }; this.persist(next); return next }
  removeConfirmedHead(operationId: string) { const current = this.read(); if (current.entries[0]?.operationId !== operationId) throw new Error(blocked); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next }
}
export const harvestWriteQueueKey = (projectRef: string, userId: string, farmId: string) => `farm-rx-harvest-write-queue:v1:${projectRef}:${userId}:${farmId}`
