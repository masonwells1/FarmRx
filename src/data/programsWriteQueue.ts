import { normalizeProgramProductDraft, uuid, validAssignmentIdentityPlans, validDate, validateActualProgramProducts, validateProgramDraft, validateProgramPassDraft, validateProgramProductDraft, type ActualProgramProduct, type AssignmentIdentityPlan, type ProgramApplicationLink, type ProgramDraft, type ProgramPassDraft, type ProgramProductDraft } from './programs'
import type { StorageLike } from './writeQueue'
import type { PendingPassOutcome, ProgramsData } from './programs'
type Base = {
  version: 1
  module: 'programs'
  operationId: string
  userId: string
  farmId: string
  enqueuedAt: string
}
export type ProgramsQueueEntryV1 =
  | (Base & { kind: 'save_program'; draft: ProgramDraft })
  | (Base & {
      kind: 'save_program_pass'
      programId: string
      pass: ProgramPassDraft
      products: ProgramProductDraft[]
      placeAfterPassId: string | null
    })
  | (Base & {
      kind: 'reorder_program_passes'
      programId: string
      orderedPassIds: string[]
    })
  | (Base & { kind: 'delete_program_pass'; programId: string; passId: string })
  | (Base & { kind: 'delete_program'; programId: string })
  | (Base & {
      kind: 'assign_program'
      programId: string
      cropAssignmentIds: string[]
    })
  | (Base & {
      kind: 'assign_program'
      programId: string
      assignmentPlans: AssignmentIdentityPlan[]
    })
  | (Base & { kind: 'refresh_program_assignment'; assignmentId: string })
  | (Base & {
      kind: 'reassign_program_assignment'
      assignmentId: string
      newProgramId: string
      reason: string
    })
  | (Base & {
      kind: 'reschedule_program_pass'
      assignedPassId: string
      dueOn: string
      timingLabel: string | null
    })
  | (Base & {
      kind: 'mark_program_pass_applied'
      assignedPassId: string
      appliedOn: string
      appliedAcres: number
      actualProducts: ActualProgramProduct[]
      applicationLink: ProgramApplicationLink
    })
  | (Base & {
      kind: 'skip_program_pass'
      assignedPassId: string
      skippedOn: string
      reason: string
    })
  | (Base & { kind: 'unassign_program'; assignmentId: string; reason: string })
export interface ProgramsQueueEnvelopeV1 {
  version: 1
  entries: ProgramsQueueEntryV1[]
}
const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key))
const base = ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt']
const goodBase = (v: Record<string, unknown>) => v.version === 1 && v.module === 'programs' && ['operationId', 'userId', 'farmId'].every((key) => typeof v[key] === 'string' && uuid.test(v[key])) && typeof v.enqueuedAt === 'string' && !Number.isNaN(Date.parse(v.enqueuedAt))
const uuidValue = (value: unknown) => typeof value === 'string' && uuid.test(value)
const reason = (value: unknown) => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 1000
function valid(v: unknown): v is ProgramsQueueEntryV1 {
  if (!rec(v) || !goodBase(v)) return false
  if (v.kind === 'save_program') return exact(v, [...base, 'draft']) && rec(v.draft) && validateProgramDraft(v.draft as unknown as ProgramDraft) === null
  if (v.kind === 'save_program_pass') return exact(v, [...base, 'programId', 'pass', 'products', 'placeAfterPassId']) && uuidValue(v.programId) && rec(v.pass) && validateProgramPassDraft(v.pass as unknown as ProgramPassDraft) === null && Array.isArray(v.products) && v.products.every((product) => rec(product) && validateProgramProductDraft(product as unknown as ProgramProductDraft) === null) && (v.placeAfterPassId === null || uuidValue(v.placeAfterPassId))
  if (v.kind === 'reorder_program_passes') return exact(v, [...base, 'programId', 'orderedPassIds']) && uuidValue(v.programId) && Array.isArray(v.orderedPassIds) && v.orderedPassIds.length > 0 && v.orderedPassIds.every(uuidValue) && new Set(v.orderedPassIds).size === v.orderedPassIds.length
  if (v.kind === 'delete_program_pass') return exact(v, [...base, 'programId', 'passId']) && uuidValue(v.programId) && uuidValue(v.passId)
  if (v.kind === 'delete_program') return exact(v, [...base, 'programId']) && uuidValue(v.programId)
  if (v.kind === 'assign_program') return uuidValue(v.programId) && ((exact(v, [...base, 'programId', 'assignmentPlans']) && validAssignmentIdentityPlans(v.assignmentPlans)) || (exact(v, [...base, 'programId', 'cropAssignmentIds']) && Array.isArray(v.cropAssignmentIds) && v.cropAssignmentIds.length > 0 && v.cropAssignmentIds.length <= 200 && v.cropAssignmentIds.every(uuidValue) && new Set(v.cropAssignmentIds).size === v.cropAssignmentIds.length))
  if (v.kind === 'refresh_program_assignment') return exact(v, [...base, 'assignmentId']) && uuidValue(v.assignmentId)
  if (v.kind === 'reassign_program_assignment') return exact(v, [...base, 'assignmentId', 'newProgramId', 'reason']) && uuidValue(v.assignmentId) && uuidValue(v.newProgramId) && reason(v.reason)
  if (v.kind === 'reschedule_program_pass') return exact(v, [...base, 'assignedPassId', 'dueOn', 'timingLabel']) && uuidValue(v.assignedPassId) && typeof v.dueOn === 'string' && validDate(v.dueOn) && (v.timingLabel === null || (typeof v.timingLabel === 'string' && v.timingLabel.length <= 160))
  if (v.kind === 'mark_program_pass_applied') {
    const link = v.applicationLink
    const validLink = rec(link) && ((link.kind === 'none' && exact(link, ['kind'])) || (link.kind === 'create' && exact(link, ['kind', 'applicationRecordId']) && uuidValue(link.applicationRecordId)) || (link.kind === 'link' && uuidValue(link.applicationRecordId) && (exact(link, ['kind', 'applicationRecordId']) || (exact(link, ['kind', 'applicationRecordId', 'canonicalAppliedOn', 'canonicalAppliedAcres']) && typeof link.canonicalAppliedOn === 'string' && validDate(link.canonicalAppliedOn) && typeof link.canonicalAppliedAcres === 'number' && Number.isFinite(link.canonicalAppliedAcres) && link.canonicalAppliedAcres > 0))))
    const actualProducts = Array.isArray(v.actualProducts) ? v.actualProducts as ActualProgramProduct[] : null
    return exact(v, [...base, 'assignedPassId', 'appliedOn', 'appliedAcres', 'actualProducts', 'applicationLink']) && uuidValue(v.assignedPassId) && typeof v.appliedOn === 'string' && validDate(v.appliedOn) && typeof v.appliedAcres === 'number' && Number.isFinite(v.appliedAcres) && v.appliedAcres > 0 && actualProducts !== null && validateActualProgramProducts(actualProducts) === null && validLink && (link.kind === 'none' || !actualProducts.some((product) => product.inventory_match))
  }
  if (v.kind === 'skip_program_pass') return exact(v, [...base, 'assignedPassId', 'skippedOn', 'reason']) && uuidValue(v.assignedPassId) && typeof v.skippedOn === 'string' && validDate(v.skippedOn) && reason(v.reason)
  return v.kind === 'unassign_program' && exact(v, [...base, 'assignmentId', 'reason']) && uuidValue(v.assignmentId) && reason(v.reason)
}
export function parseProgramsQueue(serialized: string): ProgramsQueueEnvelopeV1 {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error(blocked)
  }
  if (!rec(value) || !exact(value, ['version', 'entries']) || value.version !== 1 || !Array.isArray(value.entries) || !value.entries.every(valid)) throw new Error(blocked)
  return value as unknown as ProgramsQueueEnvelopeV1
}
export class ProgramsWriteQueue {
  constructor(
    private readonly storage: StorageLike,
    readonly key: string,
  ) {}
  hasStoredData() {
    return this.storage.getItem(this.key) !== null
  }
  read() {
    const raw = this.storage.getItem(this.key)
    return raw === null ? { version: 1 as const, entries: [] } : parseProgramsQueue(raw)
  }
  private persist(next: ProgramsQueueEnvelopeV1) {
    const raw = JSON.stringify(next)
    parseProgramsQueue(raw)
    this.storage.setItem(this.key, raw)
    if (this.storage.getItem(this.key) !== raw) throw new Error('This program change could not be saved on this device. Keep this screen open and try again.')
  }
  append(entry: ProgramsQueueEntryV1) {
    const normalized =
      entry.kind === 'save_program_pass'
        ? {
            ...entry,
            products: entry.products.map(normalizeProgramProductDraft),
          }
        : entry
    const next = {
      version: 1 as const,
      entries: [...this.read().entries, normalized],
    } as ProgramsQueueEnvelopeV1
    this.persist(next)
    return next
  }
  replaceHead(operationId: string, replacement: ProgramsQueueEntryV1) {
    const current = this.read()
    if (current.entries[0]?.operationId !== operationId || replacement.operationId !== operationId) throw new Error(blocked)
    const next = {
      version: 1 as const,
      entries: [replacement, ...current.entries.slice(1)],
    }
    this.persist(next)
    return next
  }
  removeConfirmedHead(operationId: string) {
    const current = this.read()
    if (current.entries[0]?.operationId !== operationId) throw new Error(blocked)
    const next = { version: 1 as const, entries: current.entries.slice(1) }
    this.persist(next)
    return next
  }
}
export const unresolvedAssignmentMessage = 'A program change saved on this device could not be checked against your programs.'
/** What the assignment-level projection needs from a read-only Programs snapshot: the assignments with their passes and planting
 * dates, and the programs with their template passes. */
export type ProgramsSnapshotView = Pick<ProgramsData, 'assignments' | 'programs'>
const addDays = (date: string, days: number) => { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10) }
/** The outcome each assigned pass carries in this device's queue, projected the way the server will land each entry, in order:
 * applied and skipped close the pass; a reschedule moves its due date; unassigning or reassigning a program cancels every planned
 * pass of the assignment; taking program updates (refresh) cancels a planned, non-overridden pass whose template pass is gone,
 * gives the others the template's date (a target date, else planting date plus offset, else none), and leaves a pass unscheduled
 * when that date went away. Assignment-level entries name only the assignment, so the caller supplies a read-only Programs
 * snapshot; when it cannot, or the snapshot lacks the assignment or its program, the outcomes are unknowable and this throws
 * rather than guess. A pass already given a closing outcome earlier in the queue is not planned on the server by the time a later
 * entry lands, and one rescheduled earlier in the queue is a field override there, so both are left as they are. A later entry
 * for the same pass otherwise overrides an earlier one, as replay applies them in order. Pure over the entries and snapshot. */
export function pendingPassOutcomes(entries: readonly ProgramsQueueEntryV1[], snapshot: ProgramsSnapshotView | null): Map<string, PendingPassOutcome> {
  const outcomes = new Map<string, PendingPassOutcome>()
  const assignmentOf = (assignmentId: string) => { const assignment = snapshot?.assignments.find((item) => item.assignment_id.toLowerCase() === assignmentId.toLowerCase()); if (!assignment) throw new Error(unresolvedAssignmentMessage); return assignment }
  const settled = (passId: string) => { const current = outcomes.get(passId.toLowerCase()); return current !== undefined && current.kind !== 'rescheduled' }
  const overridden = (passId: string) => outcomes.get(passId.toLowerCase())?.kind === 'rescheduled'
  for (const entry of entries) {
    if (entry.kind === 'mark_program_pass_applied') outcomes.set(entry.assignedPassId.toLowerCase(), { kind: 'applied' })
    else if (entry.kind === 'skip_program_pass') outcomes.set(entry.assignedPassId.toLowerCase(), { kind: 'skipped' })
    else if (entry.kind === 'reschedule_program_pass') outcomes.set(entry.assignedPassId.toLowerCase(), { kind: 'rescheduled', dueOn: entry.dueOn })
    else if (entry.kind === 'unassign_program' || entry.kind === 'reassign_program_assignment') {
      for (const pass of assignmentOf(entry.assignmentId).passes) if (pass.status === 'planned' && !settled(pass.id)) outcomes.set(pass.id.toLowerCase(), { kind: 'cancelled' })
    } else if (entry.kind === 'refresh_program_assignment') {
      const assignment = assignmentOf(entry.assignmentId)
      const program = snapshot?.programs.find((item) => item.id.toLowerCase() === assignment.program_id.toLowerCase())
      if (!program) throw new Error(unresolvedAssignmentMessage)
      for (const pass of assignment.passes) {
        if (pass.status !== 'planned' || pass.is_field_override || settled(pass.id) || overridden(pass.id)) continue
        const template = pass.source_program_pass_id === null ? undefined : program.passes.find((item) => item.id.toLowerCase() === pass.source_program_pass_id!.toLowerCase() && !item.is_archived)
        if (!template) { outcomes.set(pass.id.toLowerCase(), { kind: 'cancelled' }); continue }
        const dueOn = template.target_date ?? (template.planting_offset_days !== null && assignment.planting_date ? addDays(assignment.planting_date, template.planting_offset_days) : null)
        if (dueOn === pass.due_on) continue
        outcomes.set(pass.id.toLowerCase(), dueOn === null ? { kind: 'unscheduled' } : { kind: 'rescheduled', dueOn })
      }
    }
  }
  return outcomes
}
/** Whether the queue holds an entry whose pass outcomes need the Programs snapshot to resolve. */
export function needsAssignmentResolution(entries: readonly ProgramsQueueEntryV1[]) { return entries.some((entry) => entry.kind === 'unassign_program' || entry.kind === 'reassign_program_assignment' || entry.kind === 'refresh_program_assignment') }
export const programsWriteQueueKey = (projectRef: string, userId: string, farmId: string) => `farm-rx-programs-write-queue:v1:${projectRef}:${userId}:${farmId}`
