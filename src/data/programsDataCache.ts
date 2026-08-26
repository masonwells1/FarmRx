import {
  isProgramInventoryQuantity,
  uuid,
  validDate,
  type AssignedProgramPass,
  type AssignedProgramProduct,
  type CropAssignmentChoice,
  type FarmViewerRole,
  type Program,
  type ProgramApplicationRecord,
  type ProgramAssignment,
  type ProgramAssignmentCost,
  type ProgramCropCostRollup,
  type ProgramInventoryMatch,
  type ProgramInventoryProduct,
  type ProgramInventoryUnit,
  type ProgramPass,
  type ProgramProduct,
  type ProgramsData,
} from './programs'

const invalid = (): never => { throw new Error('Saved changes on this device need attention. Nothing was deleted.') }
const object = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) invalid()
  return row
}
const array = (value: unknown) => Array.isArray(value) ? value : invalid()
const string = (value: unknown, maximum: number, required = false) => typeof value === 'string' && value.length <= maximum && (!required || value.trim().length > 0) ? value : invalid()
const nullableString = (value: unknown, maximum: number) => value === null ? null : string(value, maximum)
const id = (value: unknown) => typeof value === 'string' && uuid.test(value) ? value : invalid()
const nullableId = (value: unknown) => value === null ? null : id(value)
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : invalid()
const nullableNumber = (value: unknown) => value === null ? null : number(value)
const integer = (value: unknown, minimum = 0) => { const parsed = number(value); return Number.isInteger(parsed) && parsed >= minimum ? parsed : invalid() }
const bool = (value: unknown) => typeof value === 'boolean' ? value : invalid()
const date = (value: unknown) => value === null ? null : typeof value === 'string' && validDate(value) ? value : invalid()
const stamp = (value: unknown) => { const parsed = string(value, 50, true); return Number.isNaN(Date.parse(parsed)) ? invalid() : parsed }
const unique = <T>(rows: T[], key: (row: T) => string) => { const values = rows.map(key); if (new Set(values).size !== values.length) invalid() }
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const roles = new Set<FarmViewerRole>(['owner', 'manager', 'worker', 'read_only'])
const kinds = new Set(['chemical', 'fertility', 'fungicide', 'other'])
const passTypes = new Set(['pre', 'post', 'fungicide', 'planter_fertility', 'custom'])
const activities = new Set(['spray', 'fertility', 'other'])
const statuses = new Set(['planned', 'applied', 'skipped', 'cancelled'])
const dueSources = new Set(['template_date', 'planting_offset', 'manual', 'unscheduled'])
const inventoryUnits = new Set<ProgramInventoryUnit>(['gal', 'qt', 'pt', 'fl_oz', 'l', 'ml', 'lb', 'oz', 'ton', 'kg', 'g', 'each', 'bag', 'case', 'tote', 'seed_unit', 'bulk_unit'])

function inventoryUnit(value: unknown) { const parsed = string(value, 30, true); return inventoryUnits.has(parsed as ProgramInventoryUnit) ? parsed as ProgramInventoryUnit : invalid() }
function programProduct(value: unknown, farmId: string, passId: string): ProgramProduct {
  const row = object(value, ['id', 'farm_id', 'program_pass_id', 'sequence', 'product_name', 'rate_text', 'unit_text', 'estimated_cost_per_acre', 'notes', 'is_archived'])
  const result: ProgramProduct = { id: id(row.id), farm_id: id(row.farm_id), program_pass_id: id(row.program_pass_id), sequence: integer(row.sequence, 1), product_name: string(row.product_name, 200, true), rate_text: string(row.rate_text, 80, true), unit_text: string(row.unit_text, 80, true), estimated_cost_per_acre: nullableNumber(row.estimated_cost_per_acre), notes: nullableString(row.notes, 1000), is_archived: bool(row.is_archived) }
  if (result.farm_id !== farmId || result.program_pass_id !== passId || result.is_archived || result.estimated_cost_per_acre !== null && result.estimated_cost_per_acre < 0) invalid()
  return result
}
function programPass(value: unknown, farmId: string, programId: string): ProgramPass {
  const row = object(value, ['id', 'farm_id', 'program_id', 'sequence', 'name', 'pass_type', 'activity_type', 'timing_label', 'target_date', 'planting_offset_days', 'reminder_lead_days', 'notes', 'is_archived', 'products'])
  const passType = string(row.pass_type, 30, true); const activity = string(row.activity_type, 20, true)
  const result: ProgramPass = { id: id(row.id), farm_id: id(row.farm_id), program_id: id(row.program_id), sequence: integer(row.sequence, 1), name: string(row.name, 120, true), pass_type: passTypes.has(passType) ? passType as ProgramPass['pass_type'] : invalid(), activity_type: activities.has(activity) ? activity as ProgramPass['activity_type'] : invalid(), timing_label: nullableString(row.timing_label, 160), target_date: date(row.target_date), planting_offset_days: nullableNumber(row.planting_offset_days), reminder_lead_days: integer(row.reminder_lead_days), notes: nullableString(row.notes, 2000), is_archived: bool(row.is_archived), products: [] }
  result.products = array(row.products).map((product) => programProduct(product, farmId, result.id))
  unique(result.products, (product) => product.id); unique(result.products, (product) => String(product.sequence))
  if (result.farm_id !== farmId || result.program_id !== programId || result.is_archived || result.reminder_lead_days > 60 || result.target_date !== null && result.planting_offset_days !== null || result.planting_offset_days !== null && (!Number.isInteger(result.planting_offset_days) || result.planting_offset_days < -120 || result.planting_offset_days > 365)) invalid()
  return result
}
function program(value: unknown, farmId: string): Program {
  const row = object(value, ['id', 'farm_id', 'name', 'program_kind', 'commodity_id', 'crop_year', 'notes', 'revision', 'is_archived', 'passes'])
  const kind = nullableString(row.program_kind, 20)
  const result: Program = { id: id(row.id), farm_id: id(row.farm_id), name: string(row.name, 160, true), program_kind: kind === null ? null : kinds.has(kind) ? kind as Program['program_kind'] : invalid(), commodity_id: nullableString(row.commodity_id, 100), crop_year: nullableNumber(row.crop_year), notes: nullableString(row.notes, 4000), revision: integer(row.revision, 1), is_archived: bool(row.is_archived), passes: [] }
  result.passes = array(row.passes).map((pass) => programPass(pass, farmId, result.id))
  unique(result.passes, (pass) => pass.id); unique(result.passes, (pass) => String(pass.sequence))
  if (result.farm_id !== farmId || result.crop_year !== null && (!Number.isInteger(result.crop_year) || result.crop_year < 1900 || result.crop_year > 2200)) invalid()
  return result
}
function crop(value: unknown, farmId: string): CropAssignmentChoice {
  const row = object(value, ['id', 'farm_id', 'field_id', 'field_name', 'commodity_id', 'commodity_name', 'crop_year', 'planting_sequence', 'planting_date', 'planted_acres', 'latitude', 'longitude'])
  const result: CropAssignmentChoice = { id: id(row.id), farm_id: id(row.farm_id), field_id: id(row.field_id), field_name: string(row.field_name, 160, true), commodity_id: string(row.commodity_id, 100, true), commodity_name: string(row.commodity_name, 100, true), crop_year: integer(row.crop_year, 1900), planting_sequence: integer(row.planting_sequence, 1), planting_date: date(row.planting_date), planted_acres: number(row.planted_acres), latitude: nullableNumber(row.latitude), longitude: nullableNumber(row.longitude) }
  if (result.farm_id !== farmId || result.crop_year > 2200 || result.planted_acres < 0 || (result.latitude === null) !== (result.longitude === null) || result.latitude !== null && (result.latitude < -90 || result.latitude > 90 || result.longitude! < -180 || result.longitude! > 180)) invalid()
  return result
}
function application(value: unknown, farmId: string): ProgramApplicationRecord {
  const row = object(value, ['id', 'farm_id', 'crop_assignment_id', 'application_date', 'applied_acres', 'status'])
  const status = string(row.status, 20, true)
  const result: ProgramApplicationRecord = { id: id(row.id), farm_id: id(row.farm_id), crop_assignment_id: id(row.crop_assignment_id), application_date: date(row.application_date) ?? invalid(), applied_acres: number(row.applied_acres), status: status === 'draft' || status === 'completed' ? status : invalid() }
  if (result.farm_id !== farmId || result.applied_acres <= 0) invalid()
  return result
}
function costBase(row: Record<string, unknown>, farmId: string) {
  const result = { farm_id: id(row.farm_id), crop_assignment_id: id(row.crop_assignment_id), planned_cost_is_complete: bool(row.planned_cost_is_complete), planned_cost_per_acre: nullableNumber(row.planned_cost_per_acre), planned_known_cost_per_acre: nullableNumber(row.planned_known_cost_per_acre), total_planned_cost: nullableNumber(row.total_planned_cost), actual_cost_is_complete: bool(row.actual_cost_is_complete), actual_cost_per_acre: nullableNumber(row.actual_cost_per_acre), actual_known_cost_per_acre: nullableNumber(row.actual_known_cost_per_acre), total_actual_cost: nullableNumber(row.total_actual_cost) }
  const coherent = (complete: boolean, perAcre: number | null, total: number | null) => complete ? perAcre !== null && total !== null : perAcre === null && total === null
  if (result.farm_id !== farmId || [result.planned_known_cost_per_acre, result.actual_known_cost_per_acre].some((amount) => amount !== null && amount < 0) || !coherent(result.planned_cost_is_complete, result.planned_cost_per_acre, result.total_planned_cost) || !coherent(result.actual_cost_is_complete, result.actual_cost_per_acre, result.total_actual_cost)) invalid()
  return result
}
function assignmentCost(value: unknown, farmId: string): ProgramAssignmentCost {
  const row = object(value, ['assignment_id', 'farm_id', 'crop_assignment_id', 'planned_cost_is_complete', 'planned_cost_per_acre', 'planned_known_cost_per_acre', 'total_planned_cost', 'actual_cost_is_complete', 'actual_cost_per_acre', 'actual_known_cost_per_acre', 'total_actual_cost'])
  return { assignment_id: id(row.assignment_id), ...costBase(row, farmId) }
}
function cropCost(value: unknown, farmId: string): ProgramCropCostRollup {
  const row = object(value, ['farm_id', 'crop_assignment_id', 'planted_acres', 'planned_cost_is_complete', 'planned_cost_per_acre', 'planned_known_cost_per_acre', 'total_planned_cost', 'actual_cost_is_complete', 'actual_cost_per_acre', 'actual_known_cost_per_acre', 'total_actual_cost'])
  const planted_acres = number(row.planted_acres); if (planted_acres < 0) invalid()
  return { ...costBase(row, farmId), planted_acres }
}
function inventoryProduct(value: unknown, farmId: string): ProgramInventoryProduct {
  const row = object(value, ['id', 'farm_id', 'name', 'inventory_unit', 'is_active'])
  const result = { id: id(row.id), farm_id: id(row.farm_id), name: string(row.name, 200, true), inventory_unit: inventoryUnit(row.inventory_unit), is_active: bool(row.is_active) }
  if (result.farm_id !== farmId) invalid()
  return result
}
function inventoryMatch(value: unknown, farmId: string): ProgramInventoryMatch {
  const row = object(value, ['farm_id', 'assigned_product_id', 'inventory_product_id', 'quantity_in_inventory_unit', 'inventory_product_name_snapshot', 'inventory_unit_snapshot', 'operation_id', 'confirmed_by', 'confirmed_at'])
  const result = { farm_id: id(row.farm_id), assigned_product_id: id(row.assigned_product_id), inventory_product_id: id(row.inventory_product_id), quantity_in_inventory_unit: number(row.quantity_in_inventory_unit), inventory_product_name_snapshot: string(row.inventory_product_name_snapshot, 200, true), inventory_unit_snapshot: inventoryUnit(row.inventory_unit_snapshot), operation_id: id(row.operation_id), confirmed_by: id(row.confirmed_by), confirmed_at: stamp(row.confirmed_at) }
  if (result.farm_id !== farmId || !isProgramInventoryQuantity(result.quantity_in_inventory_unit)) invalid()
  return result
}
function assignedProduct(value: unknown, farmId: string, passId: string): { product: AssignedProgramProduct; cachedMatch: ProgramInventoryMatch | null } {
  const legacyKeys = ['id', 'farm_id', 'assigned_pass_id', 'source_program_pass_product_id', 'sequence', 'product_name', 'rate_text', 'unit_text', 'estimated_cost_per_acre', 'notes', 'actual_product_name', 'actual_rate_text', 'actual_unit_text', 'actual_cost_per_acre']
  const currentKeys = [...legacyKeys, 'inventory_match']
  const shape = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid()
  const row = object(shape, Object.hasOwn(shape, 'inventory_match') ? currentKeys : legacyKeys)
  const cachedMatch = Object.hasOwn(row, 'inventory_match') && row.inventory_match !== null ? inventoryMatch(row.inventory_match, farmId) : null
  const product: AssignedProgramProduct = { id: id(row.id), farm_id: id(row.farm_id), assigned_pass_id: id(row.assigned_pass_id), source_program_pass_product_id: nullableId(row.source_program_pass_product_id), sequence: integer(row.sequence, 1), product_name: string(row.product_name, 200, true), rate_text: string(row.rate_text, 80, true), unit_text: string(row.unit_text, 80, true), estimated_cost_per_acre: nullableNumber(row.estimated_cost_per_acre), notes: nullableString(row.notes, 1000), actual_product_name: nullableString(row.actual_product_name, 200), actual_rate_text: nullableString(row.actual_rate_text, 80), actual_unit_text: nullableString(row.actual_unit_text, 80), actual_cost_per_acre: nullableNumber(row.actual_cost_per_acre), inventory_match: null }
  if (product.farm_id !== farmId || product.assigned_pass_id !== passId || product.estimated_cost_per_acre !== null && product.estimated_cost_per_acre < 0 || product.actual_cost_per_acre !== null && product.actual_cost_per_acre < 0 || !!product.actual_product_name !== !!product.actual_rate_text || !!product.actual_product_name !== !!product.actual_unit_text || cachedMatch && cachedMatch.assigned_product_id !== product.id) invalid()
  return { product, cachedMatch }
}
function assignedPass(value: unknown, farmId: string, assignmentId: string, cachedMatches: Map<string, ProgramInventoryMatch | null>): AssignedProgramPass {
  const row = object(value, ['id', 'assignment_id', 'source_program_pass_id', 'source_revision', 'sequence', 'name', 'pass_type', 'activity_type', 'timing_label', 'target_date', 'planting_offset_days', 'reminder_lead_days', 'notes', 'due_on', 'due_source', 'is_field_override', 'status', 'applied_on', 'applied_acres', 'skipped_on', 'skip_reason', 'cancelled_at', 'cancel_reason', 'application_record_id', 'products'])
  const passType = string(row.pass_type, 30, true); const activity = string(row.activity_type, 20, true); const status = string(row.status, 20, true); const dueSource = string(row.due_source, 30, true)
  const result: AssignedProgramPass = { id: id(row.id), assignment_id: id(row.assignment_id), source_program_pass_id: nullableId(row.source_program_pass_id), source_revision: integer(row.source_revision, 1), sequence: integer(row.sequence, 1), name: string(row.name, 120, true), pass_type: passTypes.has(passType) ? passType as AssignedProgramPass['pass_type'] : invalid(), activity_type: activities.has(activity) ? activity as AssignedProgramPass['activity_type'] : invalid(), timing_label: nullableString(row.timing_label, 160), target_date: date(row.target_date), planting_offset_days: nullableNumber(row.planting_offset_days), reminder_lead_days: integer(row.reminder_lead_days), notes: nullableString(row.notes, 2000), due_on: date(row.due_on), due_source: dueSources.has(dueSource) ? dueSource as AssignedProgramPass['due_source'] : invalid(), is_field_override: bool(row.is_field_override), status: statuses.has(status) ? status as AssignedProgramPass['status'] : invalid(), applied_on: date(row.applied_on), applied_acres: nullableNumber(row.applied_acres), skipped_on: date(row.skipped_on), skip_reason: nullableString(row.skip_reason, 1000), cancelled_at: row.cancelled_at === null ? null : stamp(row.cancelled_at), cancel_reason: nullableString(row.cancel_reason, 1000), application_record_id: nullableId(row.application_record_id), products: [] }
  if (result.assignment_id !== assignmentId || result.reminder_lead_days > 60 || result.target_date !== null && result.planting_offset_days !== null || result.planting_offset_days !== null && (!Number.isInteger(result.planting_offset_days) || result.planting_offset_days < -120 || result.planting_offset_days > 365)) invalid()
  const decoded = array(row.products).map((product) => assignedProduct(product, farmId, result.id)); result.products = decoded.map(({ product }) => product)
  unique(result.products, (product) => product.id); unique(result.products, (product) => String(product.sequence)); for (const item of decoded) cachedMatches.set(item.product.id, item.cachedMatch)
  const actualsComplete = result.products.every((product) => product.actual_product_name !== null && product.actual_rate_text !== null && product.actual_unit_text !== null)
  const actualsEmpty = result.products.every((product) => product.actual_product_name === null && product.actual_rate_text === null && product.actual_unit_text === null && product.actual_cost_per_acre === null)
  if (result.status === 'planned' && (result.applied_on !== null || result.applied_acres !== null || result.skipped_on !== null || result.skip_reason !== null || result.cancelled_at !== null || result.cancel_reason !== null || result.application_record_id !== null || !actualsEmpty)) invalid()
  if (result.status === 'applied' && (result.applied_on === null || result.applied_acres === null || result.applied_acres <= 0 || result.skipped_on !== null || result.skip_reason !== null || result.cancelled_at !== null || result.cancel_reason !== null || !actualsComplete)) invalid()
  if (result.status === 'skipped' && (result.applied_on !== null || result.applied_acres !== null || result.skipped_on === null || result.skip_reason === null || result.cancelled_at !== null || result.cancel_reason !== null || result.application_record_id !== null || !actualsEmpty)) invalid()
  if (result.status === 'cancelled' && (result.applied_on !== null || result.applied_acres !== null || result.skipped_on !== null || result.skip_reason !== null || result.cancelled_at === null || result.cancel_reason === null || result.application_record_id !== null || !actualsEmpty)) invalid()
  return result
}
function assignment(value: unknown, farmId: string, cachedMatches: Map<string, ProgramInventoryMatch | null>): ProgramAssignment {
  const row = object(value, ['id', 'farm_id', 'field_id', 'field_name', 'commodity_id', 'commodity_name', 'crop_year', 'planting_sequence', 'planting_date', 'planted_acres', 'latitude', 'longitude', 'assignment_id', 'program_id', 'program_name_snapshot', 'program_kind_snapshot', 'assignment_status', 'template_revision', 'current_template_revision', 'passes', 'cost'])
  const base = crop({ id: row.id, farm_id: row.farm_id, field_id: row.field_id, field_name: row.field_name, commodity_id: row.commodity_id, commodity_name: row.commodity_name, crop_year: row.crop_year, planting_sequence: row.planting_sequence, planting_date: row.planting_date, planted_acres: row.planted_acres, latitude: row.latitude, longitude: row.longitude }, farmId)
  const kind = nullableString(row.program_kind_snapshot, 20); const assignmentId = id(row.assignment_id)
  const result: ProgramAssignment = { ...base, assignment_id: assignmentId, program_id: id(row.program_id), program_name_snapshot: string(row.program_name_snapshot, 160, true), program_kind_snapshot: kind === null ? null : kinds.has(kind) ? kind as ProgramAssignment['program_kind_snapshot'] : invalid(), assignment_status: row.assignment_status === 'active' || row.assignment_status === 'archived' ? row.assignment_status : invalid(), template_revision: integer(row.template_revision, 1), current_template_revision: integer(row.current_template_revision, 1), passes: [], cost: row.cost === null ? null : assignmentCost(row.cost, farmId) }
  result.passes = array(row.passes).map((pass) => assignedPass(pass, farmId, assignmentId, cachedMatches))
  unique(result.passes, (pass) => pass.id); unique(result.passes, (pass) => String(pass.sequence)); unique(result.passes.filter((pass) => pass.source_program_pass_id !== null), (pass) => pass.source_program_pass_id!)
  for (const pass of result.passes) { unique(pass.products.filter((product) => product.source_program_pass_product_id !== null), (product) => product.source_program_pass_product_id!); if (pass.source_revision > result.template_revision) invalid() }
  if (result.cost && (result.cost.assignment_id !== assignmentId || result.cost.crop_assignment_id !== result.id)) invalid()
  return result
}

export function decodeProgramsDataCache(value: unknown, context: { farmId: string; userId: string }): ProgramsData {
  if (!uuid.test(context.farmId) || !uuid.test(context.userId)) invalid()
  const legacyKeys = ['programs', 'assignments', 'cropAssignments', 'applicationRecords', 'assignmentCosts', 'cropCostRollups', 'viewer']
  const currentKeys = [...legacyKeys.slice(0, 6), 'inventoryProducts', 'inventoryMatches', 'viewer']
  const shape = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid()
  const raw = object(shape, Object.hasOwn(shape, 'inventoryProducts') || Object.hasOwn(shape, 'inventoryMatches') ? currentKeys : legacyKeys)
  const row = Object.hasOwn(raw, 'inventoryProducts') && Object.hasOwn(raw, 'inventoryMatches') ? raw : { ...raw, inventoryProducts: [], inventoryMatches: [] }
  const viewerRow = object(row.viewer, ['user_id', 'role']); const role = string(viewerRow.role, 20, true); const viewer = { user_id: id(viewerRow.user_id), role: roles.has(role as FarmViewerRole) ? role as FarmViewerRole : invalid() }
  if (viewer.user_id !== context.userId) invalid()
  const programs = array(row.programs).map((item) => program(item, context.farmId)); unique(programs, (item) => item.id)
  const sourcePasses = programs.flatMap((item) => item.passes); unique(sourcePasses, (item) => item.id)
  const sourceProducts = sourcePasses.flatMap((item) => item.products); unique(sourceProducts, (item) => item.id)
  const crops = array(row.cropAssignments).map((item) => crop(item, context.farmId)); unique(crops, (item) => item.id)
  const applications = array(row.applicationRecords).map((item) => application(item, context.farmId)); unique(applications, (item) => item.id)
  const assignmentCosts = array(row.assignmentCosts).map((item) => assignmentCost(item, context.farmId)); unique(assignmentCosts, (item) => item.assignment_id)
  const cropCosts = array(row.cropCostRollups).map((item) => cropCost(item, context.farmId)); unique(cropCosts, (item) => item.crop_assignment_id)
  const products = array(row.inventoryProducts).map((item) => inventoryProduct(item, context.farmId)); unique(products, (item) => item.id)
  const matches = array(row.inventoryMatches).map((item) => inventoryMatch(item, context.farmId)); unique(matches, (item) => item.assigned_product_id)
  const cachedMatches = new Map<string, ProgramInventoryMatch | null>()
  const assignments = array(row.assignments).map((item) => assignment(item, context.farmId, cachedMatches)); unique(assignments, (item) => item.assignment_id)
  const programsById = new Map(programs.map((item) => [item.id, item])); const cropsById = new Map(crops.map((item) => [item.id, item])); const applicationsById = new Map(applications.map((item) => [item.id, item])); const assignmentById = new Map(assignments.map((item) => [item.assignment_id, item])); const inventoryById = new Map(products.map((item) => [item.id, item]))
  const assigned = new Map<string, { product: AssignedProgramProduct; pass: AssignedProgramPass; assignment: ProgramAssignment }>()
  const assignedPassIds = new Set<string>()
  for (const item of assignments) {
    const cropRow = cropsById.get(item.id)
    const owningProgram = programsById.get(item.program_id)
    const archivedTerminalHistory = item.assignment_status === 'archived' && item.passes.every((pass) => pass.status === 'applied' || pass.status === 'skipped' || pass.status === 'cancelled')
    const archivedProgramSnapshot = !owningProgram && (item.assignment_status === 'active' || archivedTerminalHistory)
    if (item.template_revision > item.current_template_revision || !owningProgram && !archivedProgramSnapshot || owningProgram && item.current_template_revision !== owningProgram.revision || !cropRow || cropRow.field_id !== item.field_id || cropRow.field_name !== item.field_name || cropRow.commodity_id !== item.commodity_id || cropRow.commodity_name !== item.commodity_name || cropRow.crop_year !== item.crop_year || cropRow.planting_sequence !== item.planting_sequence || cropRow.planting_date !== item.planting_date || cropRow.planted_acres !== item.planted_acres || cropRow.latitude !== item.latitude || cropRow.longitude !== item.longitude) invalid()
    for (const pass of item.passes) {
      if (assignedPassIds.has(pass.id)) invalid(); assignedPassIds.add(pass.id)
      if (pass.status === 'applied' && pass.applied_acres! > item.planted_acres) invalid()
      const sourcePass = pass.source_program_pass_id === null ? null : sourcePasses.find((candidate) => candidate.id === pass.source_program_pass_id)
      if (pass.source_program_pass_id !== null && (!sourcePass && !archivedProgramSnapshot || sourcePass && sourcePass.program_id !== item.program_id)) invalid()
      if (pass.application_record_id !== null) { const record = applicationsById.get(pass.application_record_id); if (!record || record.crop_assignment_id !== item.id || record.application_date !== pass.applied_on || record.applied_acres !== pass.applied_acres) invalid() }
      for (const product of pass.products) {
        const sourceProduct = product.source_program_pass_product_id === null ? null : sourceProducts.find((candidate) => candidate.id === product.source_program_pass_product_id)
        if (product.source_program_pass_product_id !== null && (!sourceProduct && !archivedProgramSnapshot || sourceProduct && (!sourcePass || sourceProduct.program_pass_id !== sourcePass.id))) invalid()
        if (assigned.has(product.id)) invalid(); assigned.set(product.id, { product, pass, assignment: item })
      }
    }
  }
  for (const record of applications) { const owner = cropsById.get(record.crop_assignment_id); if (!owner || record.applied_acres > owner.planted_acres) invalid() }
  for (const cost of assignmentCosts) { const owner = assignmentById.get(cost.assignment_id); if (!owner || owner.id !== cost.crop_assignment_id || !same(owner.cost, cost)) invalid() }
  for (const item of assignments) if (item.cost !== null && !assignmentCosts.some((cost) => cost.assignment_id === item.assignment_id)) invalid()
  for (const cost of cropCosts) if (!cropsById.has(cost.crop_assignment_id)) invalid()
  const matchesByProduct = new Map(matches.map((match) => [match.assigned_product_id, match]))
  const operationOwners = new Map<string, { passId: string; confirmedBy: string; confirmedAt: string }>()
  for (const match of matches) {
    const target = assigned.get(match.assigned_product_id) ?? invalid(); const inventory = inventoryById.get(match.inventory_product_id)
    if (target.pass.status !== 'applied' || target.pass.application_record_id !== null || !inventory || inventory.inventory_unit !== match.inventory_unit_snapshot || target.product.actual_product_name !== match.inventory_product_name_snapshot) invalid()
    const operationOwner = operationOwners.get(match.operation_id)
    if (operationOwner && (operationOwner.passId !== target.pass.id || operationOwner.confirmedBy !== match.confirmed_by || operationOwner.confirmedAt !== match.confirmed_at)) invalid()
    operationOwners.set(match.operation_id, { passId: target.pass.id, confirmedBy: match.confirmed_by, confirmedAt: match.confirmed_at })
    target.product.inventory_match = match
  }
  for (const [productId, cachedMatch] of cachedMatches) { const canonical = matchesByProduct.get(productId) ?? null; if (!same(cachedMatch, canonical)) invalid() }
  return { programs, assignments, cropAssignments: crops, applicationRecords: applications, assignmentCosts, cropCostRollups: cropCosts, inventoryProducts: products, inventoryMatches: matches, viewer }
}
