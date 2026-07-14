export type FarmViewerRole = 'owner' | 'manager' | 'worker' | 'read_only'
export type ProgramKind = 'chemical' | 'fertility' | 'fungicide' | 'other'
export type ProgramPassType = 'pre' | 'post' | 'fungicide' | 'planter_fertility' | 'custom'
export type ProgramActivityType = 'spray' | 'fertility' | 'other'
export type AssignedPassStatus = 'planned' | 'applied' | 'skipped' | 'cancelled'

export interface ProgramProductDraft { id: string | null; product_name: string; rate_text: string; unit_text: string; estimated_cost_per_acre: number | null; notes: string | null }
export interface ProgramPassDraft { id: string | null; name: string; pass_type: ProgramPassType; activity_type: ProgramActivityType; timing_label: string | null; target_date: string | null; planting_offset_days: number | null; reminder_lead_days: number; notes: string | null }
export interface ProgramDraft { id: string | null; name: string; program_kind: ProgramKind | null; commodity_id: string | null; crop_year: number | null; notes: string | null }
export interface ProgramProduct extends Omit<ProgramProductDraft, 'id'> { id: string; farm_id: string; program_pass_id: string; sequence: number; is_archived: boolean }
export interface ProgramPass extends Omit<ProgramPassDraft, 'id'> { id: string; farm_id: string; program_id: string; sequence: number; is_archived: boolean; products: ProgramProduct[]; pending?: boolean }
export interface Program extends Omit<ProgramDraft, 'id'> { id: string; farm_id: string; revision: number; is_archived: boolean; passes: ProgramPass[]; pending?: boolean }
export interface CropAssignmentChoice { id: string; farm_id: string; field_id: string; field_name: string; commodity_id: string; commodity_name: string; crop_year: number; planting_sequence: number; planting_date: string | null; planted_acres: number; latitude: number | null; longitude: number | null }
export interface AssignedProgramProduct { id: string; farm_id: string; assigned_pass_id: string; sequence: number; product_name: string; rate_text: string; unit_text: string; estimated_cost_per_acre: number | null; notes: string | null; actual_product_name: string | null; actual_rate_text: string | null; actual_unit_text: string | null; actual_cost_per_acre: number | null }
export interface ActualProgramProduct { id: string; actual_product_name: string; actual_rate_text: string; actual_unit_text: string; actual_cost_per_acre: number | null }
export interface AssignedProgramPass { id: string; assignment_id: string; source_program_pass_id: string | null; source_revision: number; sequence: number; name: string; pass_type: ProgramPassType; activity_type: ProgramActivityType; timing_label: string | null; target_date: string | null; planting_offset_days: number | null; reminder_lead_days: number; notes: string | null; due_on: string | null; due_source: 'template_date' | 'planting_offset' | 'manual' | 'unscheduled'; is_field_override: boolean; status: AssignedPassStatus; applied_on: string | null; applied_acres: number | null; skipped_on: string | null; skip_reason: string | null; cancelled_at: string | null; cancel_reason: string | null; application_record_id: string | null; products: AssignedProgramProduct[]; pending?: boolean }
export interface ProgramApplicationRecord { id: string; farm_id: string; crop_assignment_id: string; application_date: string; applied_acres: number; status: 'draft' | 'completed' }
export interface ProgramAssignmentCost { assignment_id: string; farm_id: string; crop_assignment_id: string; planned_cost_is_complete: boolean; planned_cost_per_acre: number | null; planned_known_cost_per_acre: number | null; total_planned_cost: number | null; actual_cost_is_complete: boolean; actual_cost_per_acre: number | null; actual_known_cost_per_acre: number | null; total_actual_cost: number | null }
export interface ProgramCropCostRollup { crop_assignment_id: string; farm_id: string; planted_acres: number; planned_cost_is_complete: boolean; planned_cost_per_acre: number | null; planned_known_cost_per_acre: number | null; total_planned_cost: number | null; actual_cost_is_complete: boolean; actual_cost_per_acre: number | null; actual_known_cost_per_acre: number | null; total_actual_cost: number | null }
export interface ProgramAssignment extends CropAssignmentChoice { assignment_id: string; program_id: string; program_name_snapshot: string; program_kind_snapshot: ProgramKind | null; assignment_status: 'active' | 'archived'; template_revision: number; current_template_revision: number; passes: AssignedProgramPass[]; cost?: ProgramAssignmentCost | null; pending?: boolean }
export interface ProgramsData { programs: Program[]; assignments: ProgramAssignment[]; cropAssignments: CropAssignmentChoice[]; applicationRecords: ProgramApplicationRecord[]; assignmentCosts: ProgramAssignmentCost[]; cropCostRollups: ProgramCropCostRollup[]; viewer: { user_id: string; role: FarmViewerRole } }
export type ProgramApplicationLink = { kind: 'none' } | { kind: 'link'; applicationRecordId: string; canonicalAppliedOn?: string; canonicalAppliedAcres?: number } | { kind: 'create'; applicationRecordId: string }
export interface ProgramsRepository { getData(includeArchived?: boolean): Promise<ProgramsData>; saveProgram(draft: ProgramDraft): Promise<Program>; saveProgramPass(programId: string, pass: ProgramPassDraft, products: ProgramProductDraft[], placeAfterPassId: string | null): Promise<ProgramPass>; reorderProgramPasses(programId: string, orderedPassIds: string[]): Promise<string[]>; deleteProgramPass(programId: string, passId: string): Promise<void>; deleteProgram(programId: string): Promise<Program>; assignProgram(programId: string, cropAssignmentIds: string[]): Promise<ProgramAssignment[]>; refreshProgramAssignment(assignmentId: string): Promise<ProgramAssignment>; reassignProgramAssignment(assignmentId: string, newProgramId: string, reason: string): Promise<ProgramAssignment>; rescheduleProgramPass(assignedPassId: string, dueOn: string, timingLabel: string | null): Promise<AssignedProgramPass>; markProgramPassApplied(assignedPassId: string, appliedOn: string, appliedAcres: number, actualProducts: ActualProgramProduct[], applicationLink?: ProgramApplicationLink): Promise<AssignedProgramPass>; skipProgramPass(assignedPassId: string, skippedOn: string, reason: string): Promise<AssignedProgramPass>; unassignProgram(assignmentId: string, reason: string): Promise<void> }

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const date = /^\d{4}-\d{2}-\d{2}$/
const exact = (value: object, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const text = (value: unknown, maximum: number, required = false) => typeof value === 'string' && value.length <= maximum && (!required || value.trim().length > 0)
const nullableText = (value: unknown, maximum: number) => value === null || text(value, maximum)
export function roundDecimalHalfUp(value: number, places = 4) { if (!Number.isFinite(value)) return value; const factor = 10 ** places; const shifted = Number((Math.abs(value) * factor).toPrecision(15)); return Math.sign(value) * Math.floor(shifted + 0.5) / factor }
export function canEditPrograms(role: FarmViewerRole) { return role === 'owner' || role === 'manager' || role === 'worker' }
/** Audit P2-15: at the moment of confirming a pass, the farmer must see exactly what the
 * save does and does not do — program progress is never a spray record or an on-hand change. */
export type ProgramApplyRecordChoice = 'none' | 'create' | 'link'
export function programApplyConfirmation(choice: ProgramApplyRecordChoice): string {
  if (choice === 'none') return 'Progress only: this marks the pass done in your program plan. It does NOT create a spray/application record and does NOT change inventory on hand.'
  if (choice === 'create') return 'This marks the pass done AND creates a new draft application record. Inventory on hand still does not change — products here are free-typed, not matched to your shelf.'
  return 'This marks the pass done and links it to the application record you chose. Inventory on hand does not change here.'
}
export function validDate(value: string) { if (!date.test(value)) return false; const parsed = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(parsed.getTime()) && `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}` === value }
export function validateProgramDraft(value: ProgramDraft | Record<string, unknown>): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exact(value, ['id', 'name', 'program_kind', 'commodity_id', 'crop_year', 'notes'])) return 'This program is incomplete. Please reopen it and try again.'
  const draft = value as ProgramDraft
  if (draft.id !== null && !uuid.test(draft.id)) return 'This program is invalid. Please reopen it and try again.'
  if (!text(draft.name, 160, true)) return 'Program name is required and must be 160 characters or less.'
  if (draft.program_kind !== null && !['chemical', 'fertility', 'fungicide', 'other'].includes(draft.program_kind)) return 'Choose a program category.'
  if (draft.commodity_id !== null && (!text(draft.commodity_id, 100, true))) return 'The crop choice is invalid.'
  if (draft.crop_year !== null && (!Number.isInteger(draft.crop_year) || draft.crop_year < 1900 || draft.crop_year > 2200)) return 'Enter a crop year from 1900 through 2200.'
  if (!nullableText(draft.notes, 4000)) return 'Program notes must be 4,000 characters or less.'
  return null
}
export function validateProgramPassDraft(value: ProgramPassDraft | Record<string, unknown>): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exact(value, ['id', 'name', 'pass_type', 'activity_type', 'timing_label', 'target_date', 'planting_offset_days', 'reminder_lead_days', 'notes'])) return 'This pass is incomplete. Please reopen it and try again.'
  const draft = value as ProgramPassDraft
  if (draft.id !== null && !uuid.test(draft.id)) return 'This pass is invalid. Please reopen it and try again.'
  if (!text(draft.name, 120, true)) return 'Pass name is required and must be 120 characters or less.'
  if (!['pre', 'post', 'fungicide', 'planter_fertility', 'custom'].includes(draft.pass_type)) return 'Choose a pass type.'
  if (!['spray', 'fertility', 'other'].includes(draft.activity_type)) return 'Choose what this pass does.'
  if (!nullableText(draft.timing_label, 160)) return 'Timing label must be 160 characters or less.'
  if (draft.target_date !== null && !validDate(draft.target_date)) return 'Enter a valid target date.'
  if (draft.target_date !== null && draft.planting_offset_days !== null) return 'Choose either a target date or days from planting, not both.'
  if (draft.planting_offset_days !== null && (!Number.isInteger(draft.planting_offset_days) || draft.planting_offset_days < -120 || draft.planting_offset_days > 365)) return 'Days from planting must be between -120 and 365.'
  if (!Number.isInteger(draft.reminder_lead_days) || draft.reminder_lead_days < 0 || draft.reminder_lead_days > 60) return 'Reminder lead time must be between 0 and 60 days.'
  if (!nullableText(draft.notes, 2000)) return 'Pass notes must be 2,000 characters or less.'
  return null
}
export function validateProgramProductDraft(value: ProgramProductDraft | Record<string, unknown>): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exact(value, ['id', 'product_name', 'rate_text', 'unit_text', 'estimated_cost_per_acre', 'notes'])) return 'One product line is incomplete. Please reopen the pass and try again.'
  const product = value as ProgramProductDraft
  if (product.id !== null && !uuid.test(product.id)) return 'One product line is invalid. Please reopen the pass and try again.'
  if (!text(product.product_name, 200, true)) return 'Product name is required and must be 200 characters or less.'
  if (!text(product.rate_text, 80, true) || !text(product.unit_text, 80, true)) return 'Enter a rate and unit, each 80 characters or less.'
  if (product.estimated_cost_per_acre !== null && (!Number.isFinite(product.estimated_cost_per_acre) || product.estimated_cost_per_acre < 0)) return 'Estimated cost per acre cannot be negative.'
  if (!nullableText(product.notes, 1000)) return 'Product notes must be 1,000 characters or less.'
  return null
}
export function validateActualProgramProducts(value: ActualProgramProduct[]): string | null { if (!Array.isArray(value) || new Set(value.map((p) => p.id)).size !== value.length || value.some((p) => !uuid.test(p.id) || !text(p.actual_product_name, 200, true) || !text(p.actual_rate_text, 80, true) || !text(p.actual_unit_text, 80, true) || p.actual_cost_per_acre !== null && (!Number.isFinite(p.actual_cost_per_acre) || p.actual_cost_per_acre < 0))) return 'Check every actual product name, rate, unit, and cost.'; return null }
export function normalizeProgramProductDraft(product: ProgramProductDraft): ProgramProductDraft { return { ...product, product_name: product.product_name.trim(), rate_text: product.rate_text.trim(), unit_text: product.unit_text.trim(), notes: product.notes?.trim() || null, estimated_cost_per_acre: product.estimated_cost_per_acre === null ? null : roundDecimalHalfUp(product.estimated_cost_per_acre) } }
