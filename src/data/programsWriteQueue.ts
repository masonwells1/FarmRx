import { normalizeProgramProductDraft, uuid, validDate, validateActualProgramProducts, validateProgramDraft, validateProgramPassDraft, validateProgramProductDraft, type ActualProgramProduct, type ProgramApplicationLink, type ProgramDraft, type ProgramPassDraft, type ProgramProductDraft } from './programs'
import type { StorageLike } from './writeQueue'
type Base = { version: 1; module: 'programs'; operationId: string; userId: string; farmId: string; enqueuedAt: string }
export type ProgramsQueueEntryV1 =
  | Base & { kind: 'save_program'; draft: ProgramDraft }
  | Base & { kind: 'save_program_pass'; programId: string; pass: ProgramPassDraft; products: ProgramProductDraft[]; placeAfterPassId: string | null }
  | Base & { kind: 'reorder_program_passes'; programId: string; orderedPassIds: string[] }
  | Base & { kind: 'delete_program_pass'; programId: string; passId: string }
  | Base & { kind: 'delete_program'; programId: string }
  | Base & { kind: 'assign_program'; programId: string; cropAssignmentIds: string[] }
  | Base & { kind: 'refresh_program_assignment'; assignmentId: string }
  | Base & { kind: 'reassign_program_assignment'; assignmentId: string; newProgramId: string; reason: string }
  | Base & { kind: 'reschedule_program_pass'; assignedPassId: string; dueOn: string; timingLabel: string | null }
  | Base & { kind: 'mark_program_pass_applied'; assignedPassId: string; appliedOn: string; appliedAcres: number; actualProducts: ActualProgramProduct[]; applicationLink: ProgramApplicationLink }
  | Base & { kind: 'skip_program_pass'; assignedPassId: string; skippedOn: string; reason: string }
  | Base & { kind: 'unassign_program'; assignmentId: string; reason: string }
export interface ProgramsQueueEnvelopeV1 { version: 1; entries: ProgramsQueueEntryV1[] }
const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key))
const base = ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt']
const goodBase = (v: Record<string, unknown>) => v.version === 1 && v.module === 'programs' && ['operationId', 'userId', 'farmId'].every((key) => typeof v[key] === 'string' && uuid.test(v[key])) && typeof v.enqueuedAt === 'string' && !Number.isNaN(Date.parse(v.enqueuedAt))
const uuidValue = (value: unknown) => typeof value === 'string' && uuid.test(value)
const reason = (value: unknown) => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 1000
function valid(v: unknown): v is ProgramsQueueEntryV1 { if (!rec(v) || !goodBase(v)) return false
  if (v.kind === 'save_program') return exact(v, [...base, 'draft']) && rec(v.draft) && validateProgramDraft(v.draft as unknown as ProgramDraft) === null
  if (v.kind === 'save_program_pass') return exact(v, [...base, 'programId', 'pass', 'products', 'placeAfterPassId']) && uuidValue(v.programId) && rec(v.pass) && validateProgramPassDraft(v.pass as unknown as ProgramPassDraft) === null && Array.isArray(v.products) && v.products.every((product) => rec(product) && validateProgramProductDraft(product as unknown as ProgramProductDraft) === null) && (v.placeAfterPassId === null || uuidValue(v.placeAfterPassId))
  if (v.kind === 'reorder_program_passes') return exact(v, [...base, 'programId', 'orderedPassIds']) && uuidValue(v.programId) && Array.isArray(v.orderedPassIds) && v.orderedPassIds.length > 0 && v.orderedPassIds.every(uuidValue) && new Set(v.orderedPassIds).size === v.orderedPassIds.length
  if (v.kind === 'delete_program_pass') return exact(v, [...base, 'programId', 'passId']) && uuidValue(v.programId) && uuidValue(v.passId)
  if (v.kind === 'delete_program') return exact(v, [...base, 'programId']) && uuidValue(v.programId)
  if (v.kind === 'assign_program') return exact(v, [...base, 'programId', 'cropAssignmentIds']) && uuidValue(v.programId) && Array.isArray(v.cropAssignmentIds) && v.cropAssignmentIds.length > 0 && v.cropAssignmentIds.length <= 200 && v.cropAssignmentIds.every(uuidValue) && new Set(v.cropAssignmentIds).size === v.cropAssignmentIds.length
  if (v.kind === 'refresh_program_assignment') return exact(v, [...base, 'assignmentId']) && uuidValue(v.assignmentId)
  if (v.kind === 'reassign_program_assignment') return exact(v, [...base, 'assignmentId', 'newProgramId', 'reason']) && uuidValue(v.assignmentId) && uuidValue(v.newProgramId) && reason(v.reason)
  if (v.kind === 'reschedule_program_pass') return exact(v, [...base, 'assignedPassId', 'dueOn', 'timingLabel']) && uuidValue(v.assignedPassId) && typeof v.dueOn === 'string' && validDate(v.dueOn) && (v.timingLabel === null || typeof v.timingLabel === 'string' && v.timingLabel.length <= 160)
  if (v.kind === 'mark_program_pass_applied') { const link = v.applicationLink; const validLink = rec(link) && ((link.kind === 'none' && exact(link, ['kind'])) || (link.kind === 'create' && exact(link, ['kind', 'applicationRecordId']) && uuidValue(link.applicationRecordId)) || (link.kind === 'link' && uuidValue(link.applicationRecordId) && ((exact(link, ['kind', 'applicationRecordId'])) || (exact(link, ['kind', 'applicationRecordId', 'canonicalAppliedOn', 'canonicalAppliedAcres']) && typeof link.canonicalAppliedOn === 'string' && validDate(link.canonicalAppliedOn) && typeof link.canonicalAppliedAcres === 'number' && Number.isFinite(link.canonicalAppliedAcres) && link.canonicalAppliedAcres > 0)))); return exact(v, [...base, 'assignedPassId', 'appliedOn', 'appliedAcres', 'actualProducts', 'applicationLink']) && uuidValue(v.assignedPassId) && typeof v.appliedOn === 'string' && validDate(v.appliedOn) && typeof v.appliedAcres === 'number' && Number.isFinite(v.appliedAcres) && v.appliedAcres > 0 && Array.isArray(v.actualProducts) && validateActualProgramProducts(v.actualProducts as ActualProgramProduct[]) === null && validLink }
  if (v.kind === 'skip_program_pass') return exact(v, [...base, 'assignedPassId', 'skippedOn', 'reason']) && uuidValue(v.assignedPassId) && typeof v.skippedOn === 'string' && validDate(v.skippedOn) && reason(v.reason)
  return v.kind === 'unassign_program' && exact(v, [...base, 'assignmentId', 'reason']) && uuidValue(v.assignmentId) && reason(v.reason)
}
export function parseProgramsQueue(serialized: string): ProgramsQueueEnvelopeV1 { let value: unknown; try { value = JSON.parse(serialized) } catch { throw new Error(blocked) } if (!rec(value) || !exact(value, ['version', 'entries']) || value.version !== 1 || !Array.isArray(value.entries) || !value.entries.every(valid)) throw new Error(blocked); return value as unknown as ProgramsQueueEnvelopeV1 }
export class ProgramsWriteQueue { constructor(private readonly storage: StorageLike, readonly key: string) {} hasStoredData() { return this.storage.getItem(this.key) !== null } read() { const raw = this.storage.getItem(this.key); return raw === null ? { version: 1 as const, entries: [] } : parseProgramsQueue(raw) } private persist(next: ProgramsQueueEnvelopeV1) { const raw = JSON.stringify(next); parseProgramsQueue(raw); this.storage.setItem(this.key, raw); if (this.storage.getItem(this.key) !== raw) throw new Error('This program change could not be saved on this device. Keep this screen open and try again.') } append(entry: ProgramsQueueEntryV1) { const normalized = entry.kind === 'save_program_pass' ? { ...entry, products: entry.products.map(normalizeProgramProductDraft) } : entry; const next = { version: 1 as const, entries: [...this.read().entries, normalized] } as ProgramsQueueEnvelopeV1; this.persist(next); return next } removeConfirmedHead(operationId: string) { const current = this.read(); if (current.entries[0]?.operationId !== operationId) throw new Error(blocked); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next } }
export const programsWriteQueueKey = (projectRef: string, userId: string, farmId: string) => `farm-rx-programs-write-queue:v1:${projectRef}:${userId}:${farmId}`
