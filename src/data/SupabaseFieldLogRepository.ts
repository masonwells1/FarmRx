import type { FieldLogDataGateway } from './FieldLogDataGateway'
import { validateFieldLogDraft, type FarmViewerRole, type FieldLogData, type FieldLogEntry, type FieldLogEntryDraft, type FieldLogRepository } from './fieldLog'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail = (): never => { throw new Error('Farm Rx found invalid field log data. Please contact support.') }
const object = (value: unknown) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown> }
const id = (value: unknown) => typeof value === 'string' && uuid.test(value) ? value : fail()
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value : fail()
const nullableText = (value: unknown, max: number) => value === null ? null : text(value, max)
const number = (value: unknown) => { const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isFinite(n) ? n : fail() }
const nullableNumber = (value: unknown) => value === null ? null : number(value)
const date = (value: unknown) => { const result = text(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(result) && !Number.isNaN(Date.parse(`${result}T00:00:00Z`)) ? result : fail() }
const stamp = (value: unknown) => { const result = text(value, 64); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) && !Number.isNaN(Date.parse(result)) ? result : fail() }
const roles = new Set<FarmViewerRole>(['owner', 'manager', 'worker', 'read_only'])

export function mapFieldLogEntry(value: unknown, expected?: { farmId: string; entry?: FieldLogEntryDraft }): FieldLogEntry {
  const row = object(value); const type = text(row.entry_type, 20); const result: FieldLogEntry = { id: id(row.id), farm_id: id(row.farm_id), field_id: id(row.field_id), entry_type: type === 'rainfall' || type === 'note' ? type : fail(), observed_on: date(row.observed_on), rainfall_in: nullableNumber(row.rainfall_in), note: nullableText(row.note, 500), created_by: id(row.created_by), created_at: stamp(row.created_at), updated_at: stamp(row.updated_at) }
  if ((result.entry_type === 'rainfall' && (result.rainfall_in === null || result.rainfall_in < 0 || result.rainfall_in > 100)) || (result.entry_type === 'note' && (result.rainfall_in !== null || !result.note?.trim()))) fail()
  if (expected && (result.farm_id !== expected.farmId || (expected.entry && (result.field_id !== expected.entry.field_id || result.entry_type !== expected.entry.entry_type || result.observed_on !== expected.entry.observed_on || result.rainfall_in !== expected.entry.rainfall_in || result.note !== expected.entry.note || (expected.entry.id !== undefined && result.id !== expected.entry.id))))) fail()
  return result
}
export function mapFieldLogDeleteEcho(value: unknown, expected: { id: string }) { const row = object(value); if (id(row.id) !== expected.id || row.deleted !== true || Object.keys(row).length !== 2) fail(); return { id: expected.id, deleted: true as const } }
export function canEditFieldLog(role: FarmViewerRole) { return role === 'owner' || role === 'manager' || role === 'worker' }

export class SupabaseFieldLogRepository implements FieldLogRepository {
  constructor(private readonly d: { gateway: FieldLogDataGateway; getFarmId: () => Promise<string>; getUserId: () => Promise<string>; createId: () => string }) {}
  async getData(fieldId?: string): Promise<FieldLogData> {
    const [farmId, userId] = await Promise.all([this.d.getFarmId(), this.d.getUserId()]); const [entries, rawViewer] = await Promise.all([this.d.gateway.loadEntries(farmId, fieldId), this.d.gateway.loadViewerRole(farmId, userId)])
    const viewer = object(rawViewer); const role = text(viewer.role, 20); if (!roles.has(role as FarmViewerRole)) fail()
    return { entries: entries.map((entry) => mapFieldLogEntry(entry, { farmId })).filter((entry) => !fieldId || entry.field_id === fieldId), viewer: { user_id: userId, role: role as FarmViewerRole } }
  }
  async saveEntry(draft: FieldLogEntryDraft) { return this.saveEntryOperation(draft, this.d.createId()) }
  async saveEntryOperation(draft: FieldLogEntryDraft, operationId: string) {
    if (!uuid.test(operationId) || validateFieldLogDraft(draft) !== null) fail()
    const farmId = await this.d.getFarmId(); return mapFieldLogEntry(await this.d.gateway.saveEntry({ farmId, operationId, entry: draft }), { farmId, entry: draft })
  }
  async deleteEntry(idValue: string) { if (!uuid.test(idValue)) fail(); const farmId = await this.d.getFarmId(); mapFieldLogDeleteEcho(await this.d.gateway.deleteEntry({ farmId, entryId: idValue }), { id: idValue }); return { id: idValue, deleted: true as const } }
}
