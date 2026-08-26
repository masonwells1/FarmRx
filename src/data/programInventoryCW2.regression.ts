import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProgramsDataGateway } from './ProgramsDataGateway'
import { SupabaseProgramsRepository } from './SupabaseProgramsRepository'
import { canonicalProgramInventoryProduct, confirmedProgramInventoryActuals, formatProgramInventoryQuantity, isProgramInventoryQuantity, parseProgramInventoryQuantityInput, programApplyConfirmation, PROGRAM_INVENTORY_QUANTITY_MAX, validateActualProgramProducts, type ActualProgramProduct, type ProgramInventoryProduct } from './programs'
import { parseProgramsQueue } from './programsWriteQueue'
import { decodeProgramsDataCache } from './programsDataCache'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1); const actor = uid(2); const passId = uid(3); const assignmentId = uid(4); const cropId = uid(5); const fieldId = uid(6); const assignedOne = uid(7); const assignedTwo = uid(8); const inventoryOne = uid(9); const operationId = uid(10); const programId = uid(12); const stamp = '2026-08-11T18:30:00.000Z'
const context = { projectRef: 'cw2', userId: actor, farmId: farm, generation: 1, token: uid(11), serverEpoch: 7 }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let rejected = false; try { await action() } catch { rejected = true }; assert(rejected, message) }
async function rejectsWith(action: () => Promise<unknown>, pattern: RegExp, message: string) { try { await action() } catch (error) { assert(error instanceof Error && pattern.test(error.message), message); return }; throw new Error(message) }

const inventoryProduct = (patch: Partial<ProgramInventoryProduct> = {}): ProgramInventoryProduct => ({ id: inventoryOne, farm_id: farm, name: 'Exact Product', inventory_unit: 'gal', is_active: true, ...patch })
const actuals = (match: ActualProgramProduct['inventory_match']): ActualProgramProduct[] => [
  { id: assignedOne, actual_product_name: ' Exact Product ', actual_rate_text: '1.0', actual_unit_text: 'qt/ac', actual_cost_per_acre: 12, ...(match === undefined ? {} : { inventory_match: match }) },
  { id: assignedTwo, actual_product_name: 'Free typed substitute', actual_rate_text: '2.0', actual_unit_text: 'pt/ac', actual_cost_per_acre: null },
]
const confirmedMatch = { inventory_product_id: inventoryOne, quantity_in_inventory_unit: 4.25, inventory_unit: 'gal' as const }

class CW2Gateway implements ProgramsDataGateway {
  inventoryProducts: any[] = [inventoryProduct()]
  inventoryMatches: any[] = []
  additionalPasses: any[] = []
  calls = 0
  loseResponseOnce = false
  legacyResponse = false
  private receipts = new Map<string, { request: string; result: unknown }>()
  private pass: any = {
    id: passId, assignment_id: assignmentId, source_program_pass_id: null, source_revision: 1, sequence: 1, name: 'CW-2 pass', pass_type: 'post', activity_type: 'spray', timing_label: null, target_date: null, planting_offset_days: null, reminder_lead_days: 3, notes: null, due_on: null, due_source: 'unscheduled', is_field_override: false, status: 'planned', applied_on: null, applied_acres: null, skipped_on: null, skip_reason: null, cancelled_at: null, cancel_reason: null, application_record_id: null,
    products: [
      { id: assignedOne, farm_id: farm, assigned_pass_id: passId, source_program_pass_product_id: null, sequence: 1, product_name: 'Planned one', rate_text: '1', unit_text: 'qt/ac', estimated_cost_per_acre: 10, notes: null, actual_product_name: null, actual_rate_text: null, actual_unit_text: null, actual_cost_per_acre: null },
      { id: assignedTwo, farm_id: farm, assigned_pass_id: passId, source_program_pass_product_id: null, sequence: 2, product_name: 'Planned two', rate_text: '2', unit_text: 'pt/ac', estimated_cost_per_acre: null, notes: null, actual_product_name: null, actual_rate_text: null, actual_unit_text: null, actual_cost_per_acre: null },
    ],
  }
  async loadPrograms() { return [{ id: programId, farm_id: farm, name: 'CW-2', program_kind: 'chemical', commodity_id: 'corn', crop_year: 2027, notes: null, revision: 1, is_archived: false }] }
  async loadPasses() { return [] }
  async loadProducts() { return [] }
  async loadAssignments() { return [{ assignment_id: assignmentId, farm_id: farm, program_id: programId, program_name_snapshot: 'CW-2', program_kind_snapshot: 'chemical', assignment_status: 'active', template_revision: 1, current_template_revision: 1, crop_assignment_id: cropId, field_id: fieldId, field_name: 'North', commodity_id: 'corn', commodity_name: 'Corn', crop_year: 2027, planting_sequence: 1, planting_date: null, planted_acres: 100, passes: [structuredClone(this.pass), ...structuredClone(this.additionalPasses)] }] }
  async loadCropAssignments() { return [{ id: cropId, farm_id: farm, field_id: fieldId, commodity_id: 'corn', crop_year: 2027, planting_sequence: 1, planting_date: null, planted_acres: 100, fields: { name: 'North', latitude: null, longitude: null }, commodities: { name: 'Corn' } }] }
  async loadApplicationRecords() { return [] }
  async loadAssignmentCosts() { return [] }
  async loadCropCostRollups() { return [] }
  async loadInventoryProducts() { return structuredClone(this.inventoryProducts) }
  async loadInventoryMatches() { return structuredClone(this.inventoryMatches) }
  async loadViewerRole() { return { role: 'worker' } }
  async markProgramPassApplied(input: { farmId: string; operationId: string; assignedPassId: string; appliedOn: string; appliedAcres: number; actualProducts: ActualProgramProduct[]; applicationRecordId: string | null; createApplicationRecord: boolean }) {
    this.calls += 1
    const request = JSON.stringify(input)
    const receipt = this.receipts.get(input.operationId)
    if (receipt) { if (receipt.request !== request) throw new Error('operation ID was already used for a different request'); return structuredClone(receipt.result) }
    if (this.pass.status !== 'planned') throw new Error('planned pass required')
    const matches = input.actualProducts.filter((actual) => actual.inventory_match).map((actual) => {
      const requested = actual.inventory_match!; const product = this.inventoryProducts.find((candidate) => candidate.id === requested.inventory_product_id)
      if (!product || !product.is_active || product.farm_id !== input.farmId || product.inventory_unit !== requested.inventory_unit || product.name.trim() !== actual.actual_product_name.trim() || this.inventoryProducts.filter((candidate) => candidate.farm_id === input.farmId && candidate.is_active && candidate.name.trim() === actual.actual_product_name.trim()).length !== 1) throw new Error('forged inventory match')
      const row = { farm_id: farm, assigned_product_id: actual.id, inventory_product_id: product.id, quantity_in_inventory_unit: requested.quantity_in_inventory_unit, inventory_product_name_snapshot: product.name.trim(), inventory_unit_snapshot: product.inventory_unit, operation_id: input.operationId, confirmed_by: actor, confirmed_at: stamp }
      this.inventoryMatches.push(row); return row
    })
    this.pass.products = this.pass.products.map((product: any) => { const actual = input.actualProducts.find((candidate) => candidate.id === product.id); if (!actual) return product; const { inventory_match: _match, ...fields } = actual; return { ...product, ...fields, actual_product_name: fields.actual_product_name.trim(), actual_rate_text: fields.actual_rate_text.trim(), actual_unit_text: fields.actual_unit_text.trim() } })
    Object.assign(this.pass, { status: 'applied', applied_on: input.appliedOn, applied_acres: input.appliedAcres })
    const result = this.legacyResponse
      ? { pass: structuredClone(this.pass), inventory_matched: false, inventory_on_hand_changed: false }
      : { pass: structuredClone(this.pass), request_fingerprint: input.operationId.replaceAll('-', ''), inventory_matched: matches.length > 0, inventory_on_hand_changed: matches.length > 0, inventory_match_count: matches.length, inventory_matches: matches }
    this.receipts.set(input.operationId, { request, result: structuredClone(result) })
    if (this.loseResponseOnce) { this.loseResponseOnce = false; throw new TypeError('fetch failed after commit') }
    return result
  }
  async saveProgram(): Promise<unknown> { throw new Error('unused') }
  async saveProgramPass(): Promise<unknown> { throw new Error('unused') }
  async reorderProgramPasses(): Promise<unknown> { throw new Error('unused') }
  async deleteProgramPass(): Promise<unknown> { throw new Error('unused') }
  async deleteProgram(): Promise<unknown> { throw new Error('unused') }
  async assignProgram(): Promise<unknown> { throw new Error('unused') }
  async refreshProgramAssignment(): Promise<unknown> { throw new Error('unused') }
  async reassignProgramAssignment(): Promise<unknown> { throw new Error('unused') }
  async rescheduleProgramPass(): Promise<unknown> { throw new Error('unused') }
  async skipProgramPass(): Promise<unknown> { throw new Error('unused') }
  async unassignProgram(): Promise<unknown> { throw new Error('unused') }
}

function repository(gateway: CW2Gateway, verify = async () => undefined) { return new SupabaseProgramsRepository({ gateway, getFarmId: async () => farm, getUserId: async () => actor, getOperationContext: async () => context, verifyOperationContext: verify, createId: () => operationId }) }

async function run() {
  const candidates = [inventoryProduct()]
  assert(canonicalProgramInventoryProduct(' Exact Product ', farm, candidates)?.id === inventoryOne, 'Only one active same-farm trimmed exact case-sensitive name may be suggested.')
  assert(canonicalProgramInventoryProduct('exact product', farm, candidates) === null, 'Case-only similarity must not match.')
  assert(canonicalProgramInventoryProduct('Exact Product', farm, [inventoryProduct(), inventoryProduct({ id: uid(13) })]) === null, 'Duplicate active exact names must be ambiguous.')
  assert(canonicalProgramInventoryProduct('Exact Product', farm, [inventoryProduct({ is_active: false })]) === null, 'Inactive products must not match.')
  assert(canonicalProgramInventoryProduct('Exact Product', farm, [inventoryProduct({ farm_id: uid(14) })]) === null, 'Foreign-farm products must not match.')

  assert(validateActualProgramProducts(actuals(undefined)) === null && validateActualProgramProducts(actuals(null)) === null && validateActualProgramProducts(actuals(confirmedMatch)) === null, 'Legacy five-key, explicit null, and strict confirmed-match shapes must remain accepted.')
  const confirmedCopy = programApplyConfirmation('none', 1, 'Exact Product · 0.001 gal')
  const unmatchedCopy = programApplyConfirmation('none')
  const namesInventoryNonWrite = (copy: string) => /does not change inventory on hand/i.test(copy)
  assert(confirmedCopy.includes('without adding an application record') && confirmedCopy.includes('Exact Product · 0.001 gal') && confirmedCopy.includes('1 exact Inventory match will reduce on hand') && namesInventoryNonWrite(unmatchedCopy) && programApplyConfirmation('create', 1).includes('Choose “Do not add an application record”'), 'Apply confirmation copy must identify the exact no-record Inventory draw-down while keeping unmatched and application-record paths distinct.')
  assert(!namesInventoryNonWrite(unmatchedCopy.replace(/does not change inventory on hand/i, 'changes inventory on hand')), 'Removing the unmatched Inventory non-write claim must turn the focused mutation red.')
  assert(!programApplyConfirmation('create', 1, 'Exact Product · 0.001 gal').includes('Exact Product') && !programApplyConfirmation('link', 1, 'Exact Product · 0.001 gal').includes('Exact Product'), 'Application-record choices must refuse the confirmed Inventory summary.')
  const malformed = actuals(confirmedMatch) as any[]
  assert(validateActualProgramProducts([{ ...malformed[0], extra: true }, malformed[1]]) !== null, 'Extra actual-product keys must fail closed.')
  assert(validateActualProgramProducts([{ ...malformed[0], inventory_match: { ...confirmedMatch, extra: true } }, malformed[1]]) !== null, 'Extra nested match keys must fail closed.')
  for (const quantity of [0, -1, Number.NaN, 0.000000001, PROGRAM_INVENTORY_QUANTITY_MAX + 0.00000001]) assert(validateActualProgramProducts([{ ...malformed[0], inventory_match: { ...confirmedMatch, quantity_in_inventory_unit: quantity } }, malformed[1]]) !== null, 'Zero, negative, non-finite, ninth-decimal, and over-cap quantities must fail closed.')
  const pendingQuantityActuals = actuals({ ...confirmedMatch, quantity_in_inventory_unit: Number.NaN })
  assert(confirmedProgramInventoryActuals(pendingQuantityActuals).length === 0 && !programApplyConfirmation('none', confirmedProgramInventoryActuals(pendingQuantityActuals).length).includes('will reduce on hand'), 'Checking a match before entering a valid quantity must not count or claim an Inventory reduction.')
  assert(confirmedProgramInventoryActuals(actuals(confirmedMatch)).length === 1, 'A valid confirmed Inventory quantity must remain eligible for the final reduction summary.')
  for (const [raw, expected] of [['0.00000001', 0.00000001], ['0.001', 0.001], ['9999999.99999999', 9999999.99999999], ['10000000', 10000000]] as const) { const quantity = parseProgramInventoryQuantityInput(raw); assert(quantity === expected && isProgramInventoryQuantity(quantity), `The exact safe quantity boundary ${raw} must round-trip.`) }
  for (const raw of ['0', '-1', '0.000000001', '10000000.00000001', '1e-8', 'NaN', 'Infinity']) assert(parseProgramInventoryQuantityInput(raw) === null, `Unsafe raw quantity ${raw} must fail before Number conversion.`)
  assert(formatProgramInventoryQuantity(0.00000001) === '0.00000001' && formatProgramInventoryQuantity(9999999.99999999) === '9,999,999.99999999', 'The full supported quantity domain must display without losing permitted decimals.')
  const malformedRuntime = new CW2Gateway(); await rejectsWith(() => repository(malformedRuntime).markProgramPassAppliedOperation(passId, '2027-06-01', 80, [null] as unknown as ActualProgramProduct[], { kind: 'none' }, uid(18), context), /Farm Rx found invalid program data/, 'Malformed runtime product input must reach the controlled validator before normalization.'); assert(malformedRuntime.calls === 0, 'Malformed runtime product input reached the Program Apply gateway.')

  const legacy = new CW2Gateway(); const legacyApplied = await repository(legacy).markProgramPassAppliedOperation(passId, '2027-06-01', 80, actuals(undefined), { kind: 'none' }, uid(20), context)
  assert(legacyApplied.products.every((product) => product.inventory_match === null) && legacy.inventoryMatches.length === 0, 'Legacy/no-confirm apply must leave Inventory unchanged and confirm no durable match.')
  const oldReceipt = new CW2Gateway(); oldReceipt.legacyResponse = true; const oldReceiptApplied = await repository(oldReceipt).markProgramPassAppliedOperation(passId, '2027-06-01', 80, actuals(undefined), { kind: 'none' }, uid(19), context); assert(oldReceiptApplied.products.every((product) => product.inventory_match === null), 'A legacy unmatched receipt without a fingerprint must remain readable without implying Inventory confirmation.')

  const subset = new CW2Gateway(); const subsetApplied = await repository(subset).markProgramPassAppliedOperation(passId, '2027-06-02', 80, actuals(confirmedMatch), { kind: 'none' }, operationId, context)
  assert(subsetApplied.products[0].inventory_match?.quantity_in_inventory_unit === 4.25 && subsetApplied.products[1].inventory_match === null && subset.inventoryMatches.length === 1, 'An exhaustive actual list may confirm only an explicit subset; unmatched lines must remain unchanged.')

  for (const productPatch of [{ inventory_unit: 'qt' }, { is_active: false }, { farm_id: uid(15) }] as Array<Record<string, unknown>>) { const gateway = new CW2Gateway(); gateway.inventoryProducts = [inventoryProduct(productPatch as Partial<ProgramInventoryProduct>)]; await rejects(() => repository(gateway).markProgramPassAppliedOperation(passId, '2027-06-03', 80, actuals(confirmedMatch), { kind: 'none' }, uid(21), context), 'Stale-unit, inactive, and foreign candidate matches must be rejected before mutation.') }
  const ambiguous = new CW2Gateway(); ambiguous.inventoryProducts.push(inventoryProduct({ id: uid(16) })); await rejects(() => repository(ambiguous).markProgramPassAppliedOperation(passId, '2027-06-03', 80, actuals(confirmedMatch), { kind: 'none' }, uid(22), context), 'Ambiguous exact-name matches must be rejected before mutation.')
  const forged = new CW2Gateway(); await rejects(() => repository(forged).markProgramPassAppliedOperation(passId, '2027-06-03', 80, actuals({ ...confirmedMatch, inventory_product_id: uid(17) }), { kind: 'none' }, uid(23), context), 'A forged inventory product ID must be rejected before mutation.')
  for (const applicationLink of [{ kind: 'link' as const, applicationRecordId: uid(33) }, { kind: 'create' as const, applicationRecordId: uid(34) }]) { const gateway = new CW2Gateway(); await rejects(() => repository(gateway).markProgramPassAppliedOperation(passId, '2027-06-03', 80, actuals(confirmedMatch), applicationLink, uid(35), context), 'A confirmed Inventory match with any application record path must fail closed.'); assert(gateway.calls === 0 && gateway.inventoryMatches.length === 0 && (gateway as any).pass?.status !== 'applied', 'A rejected application-record match must produce zero gateway, match, or pass writes.') }

  const lost = new CW2Gateway(); lost.loseResponseOnce = true; const lostRepo = repository(lost); await rejects(() => lostRepo.markProgramPassAppliedOperation(passId, '2027-06-04', 80, actuals(confirmedMatch), { kind: 'none' }, uid(24), context), 'A lost post-commit response must remain retryable.'); const replayed = await lostRepo.markProgramPassAppliedOperation(passId, '2027-06-04', 80, actuals(confirmedMatch), { kind: 'none' }, uid(24), context)
  assert(lost.calls === 2 && lost.inventoryMatches.length === 1 && replayed.products[0].inventory_match?.operation_id === uid(24), 'The same operation replay must return one durable match without double subtraction.')
  await rejects(() => lostRepo.markProgramPassAppliedOperation(passId, '2027-06-04', 80, actuals({ ...confirmedMatch, quantity_in_inventory_unit: 5 }), { kind: 'none' }, uid(24), context), 'The same operation ID with a different request must fail closed.')

  const queued = { version: 1, entries: [{ version: 1, module: 'programs', kind: 'mark_program_pass_applied', operationId: uid(25), userId: actor, farmId: farm, enqueuedAt: stamp, assignedPassId: passId, appliedOn: '2027-06-05', appliedAcres: 80, actualProducts: actuals(confirmedMatch), applicationLink: { kind: 'none' } }] }
  const parsed = parseProgramsQueue(JSON.stringify(queued)); const queuedActual = parsed.entries[0]?.kind === 'mark_program_pass_applied' ? parsed.entries[0].actualProducts[0] : null
  assert(queuedActual?.inventory_match?.inventory_product_id === inventoryOne && queuedActual.inventory_match.quantity_in_inventory_unit === 4.25, 'The V1 queue must preserve the exact nested confirmed-match input.')
  const legacyQueued = structuredClone(queued); delete (legacyQueued.entries[0].actualProducts[0] as any).inventory_match; assert(parseProgramsQueue(JSON.stringify(legacyQueued)).entries.length === 1, 'Legacy V1 Apply entries without inventory_match must remain readable.')
  for (const applicationLink of [{ kind: 'create', applicationRecordId: uid(36) }, { kind: 'link', applicationRecordId: uid(37) }]) { const forgedQueue: any = structuredClone(queued); forgedQueue.entries[0].applicationLink = applicationLink; await rejects(() => Promise.resolve(parseProgramsQueue(JSON.stringify(forgedQueue))), 'A durable queue entry must reject a confirmed match with create/link before replay.') }

  let verifyCalls = 0; const fencedGateway = new CW2Gateway(); await rejects(() => repository(fencedGateway, async () => { verifyCalls += 1; throw new Error('FARM_ACCESS_EPOCH_CHANGED') }).markProgramPassAppliedOperation(passId, '2027-06-05', 80, actuals(undefined), { kind: 'none' }, uid(26), context), 'A changed operation context/access epoch must block before the RPC.'); assert(verifyCalls === 1 && fencedGateway.calls === 0, 'Context/epoch fencing must run before any Program Apply write.')

  const malformedCanonical = new CW2Gateway(); malformedCanonical.inventoryMatches = [{ farm_id: farm, assigned_product_id: assignedOne, inventory_product_id: inventoryOne, quantity_in_inventory_unit: 0, inventory_product_name_snapshot: 'Exact Product', inventory_unit_snapshot: 'gal', operation_id: uid(27), confirmed_by: actor, confirmed_at: stamp }]; await rejects(() => repository(malformedCanonical).getData(true), 'Malformed durable match quantities must fail closed.')
  const foreignCanonical = new CW2Gateway(); foreignCanonical.inventoryProducts = [inventoryProduct({ farm_id: uid(28) })]; await rejects(() => repository(foreignCanonical).getData(true), 'Foreign canonical inventory rows must fail closed.')
  const orphanCanonical = new CW2Gateway(); orphanCanonical.inventoryMatches = [{ farm_id: farm, assigned_product_id: uid(29), inventory_product_id: inventoryOne, quantity_in_inventory_unit: 1, inventory_product_name_snapshot: 'Exact Product', inventory_unit_snapshot: 'gal', operation_id: uid(30), confirmed_by: actor, confirmed_at: stamp }]; await rejects(() => repository(orphanCanonical).getData(true), 'Orphan durable match rows must fail closed.')
  const duplicateCanonical = new CW2Gateway(); duplicateCanonical.inventoryMatches = [{ farm_id: farm, assigned_product_id: assignedOne, inventory_product_id: inventoryOne, quantity_in_inventory_unit: 1, inventory_product_name_snapshot: 'Exact Product', inventory_unit_snapshot: 'gal', operation_id: uid(31), confirmed_by: actor, confirmed_at: stamp }, { farm_id: farm, assigned_product_id: assignedOne, inventory_product_id: inventoryOne, quantity_in_inventory_unit: 2, inventory_product_name_snapshot: 'Exact Product', inventory_unit_snapshot: 'gal', operation_id: uid(32), confirmed_by: actor, confirmed_at: stamp }]; await rejects(() => repository(duplicateCanonical).getData(true), 'Duplicate durable rows for one assigned product must fail closed.')
  const linkedCanonical = new CW2Gateway(); await repository(linkedCanonical).markProgramPassAppliedOperation(passId, '2027-06-02', 80, actuals(confirmedMatch), { kind: 'none' }, uid(38), context); (linkedCanonical as any).pass.application_record_id = uid(39); await rejects(() => repository(linkedCanonical).getData(true), 'A canonical confirmed match attached to an application record must fail closed.')
  const groupedCanonical = () => {
    const gateway = new CW2Gateway()
    Object.assign((gateway as any).pass, { status: 'applied', applied_on: '2027-06-02', applied_acres: 80 })
    Object.assign((gateway as any).pass.products[0], { actual_product_name: 'Exact Product', actual_rate_text: '1.0', actual_unit_text: 'qt/ac', actual_cost_per_acre: 12 })
    Object.assign((gateway as any).pass.products[1], { actual_product_name: 'Second Exact Product', actual_rate_text: '2.0', actual_unit_text: 'pt/ac', actual_cost_per_acre: null })
    gateway.inventoryProducts.push(inventoryProduct({ id: uid(56), name: 'Second Exact Product' }))
    gateway.inventoryMatches = [
      { farm_id: farm, assigned_product_id: assignedOne, inventory_product_id: inventoryOne, quantity_in_inventory_unit: 1, inventory_product_name_snapshot: 'Exact Product', inventory_unit_snapshot: 'gal', operation_id: uid(57), confirmed_by: actor, confirmed_at: stamp },
      { farm_id: farm, assigned_product_id: assignedTwo, inventory_product_id: uid(56), quantity_in_inventory_unit: 2, inventory_product_name_snapshot: 'Second Exact Product', inventory_unit_snapshot: 'gal', operation_id: uid(57), confirmed_by: actor, confirmed_at: stamp },
    ]
    return gateway
  }
  const coherentCanonical = groupedCanonical(); assert((await repository(coherentCanonical).getData(true)).inventoryMatches.length === 2, 'Live canonical mapping must accept one coherent multi-product operation on one owning pass.')
  const conflictingCanonicalConfirmer = groupedCanonical(); conflictingCanonicalConfirmer.inventoryMatches[1].confirmed_by = uid(58)
  const conflictingCanonicalStamp = groupedCanonical(); conflictingCanonicalStamp.inventoryMatches[1].confirmed_at = '2026-08-11T18:30:01.000Z'
  const crossPassCanonical = groupedCanonical(); const crossPass = structuredClone((crossPassCanonical as any).pass); crossPass.id = uid(59); crossPass.sequence = 2; crossPass.products = [structuredClone(crossPass.products[1])]; crossPass.products[0].id = uid(60); crossPass.products[0].assigned_pass_id = crossPass.id; (crossPassCanonical as any).pass.products = [(crossPassCanonical as any).pass.products[0]]; crossPassCanonical.inventoryMatches[1].assigned_product_id = uid(60); crossPassCanonical.additionalPasses = [crossPass]
  for (const corrupt of [conflictingCanonicalConfirmer, conflictingCanonicalStamp, crossPassCanonical]) await rejects(() => repository(corrupt).getData(true), 'Live canonical operation provenance must reject cross-pass, conflicting-confirmer, and conflicting-timestamp reuse.')

  const cacheGateway = new CW2Gateway(); const validCache = await repository(cacheGateway).getData(true); assert(decodeProgramsDataCache(validCache, { farmId: farm, userId: actor }).viewer.user_id === actor, 'A complete canonical Programs cache must decode into a new context-bound workspace.')
  const corruptCaches: unknown[] = []
  corruptCaches.push({ ...structuredClone(validCache), extra: true })
  const wrongViewer = structuredClone(validCache); wrongViewer.viewer.user_id = uid(40); corruptCaches.push(wrongViewer)
  const duplicateInventory = structuredClone(validCache); duplicateInventory.inventoryProducts.push(structuredClone(duplicateInventory.inventoryProducts[0])); corruptCaches.push(duplicateInventory)
  const wrongFarm = structuredClone(validCache); wrongFarm.assignments[0].farm_id = uid(41); corruptCaches.push(wrongFarm)
  const badStatus = structuredClone(validCache); badStatus.assignments[0].passes[0].applied_on = '2027-06-01'; corruptCaches.push(badStatus)
  const passOverAcreage = structuredClone(validCache); Object.assign(passOverAcreage.assignments[0].passes[0], { status: 'applied', applied_on: '2027-06-01', applied_acres: 100.00000001 }); for (const product of passOverAcreage.assignments[0].passes[0].products) Object.assign(product, { actual_product_name: product.product_name, actual_rate_text: product.rate_text, actual_unit_text: product.unit_text }); corruptCaches.push(passOverAcreage)
  const applicationOverAcreage = structuredClone(validCache); applicationOverAcreage.applicationRecords.push({ id: uid(44), farm_id: farm, crop_assignment_id: cropId, application_date: '2027-06-01', applied_acres: 100.00000001, status: 'draft' }); corruptCaches.push(applicationOverAcreage)
  const extraNested = structuredClone(validCache) as any; extraNested.assignments[0].passes[0].products[0].extra = true; corruptCaches.push(extraNested)
  const futureSourceRevision = structuredClone(validCache); futureSourceRevision.assignments[0].passes[0].source_revision = futureSourceRevision.assignments[0].template_revision + 1; corruptCaches.push(futureSourceRevision)
  const danglingSourcePass = structuredClone(validCache); danglingSourcePass.assignments[0].passes[0].source_program_pass_id = uid(61); corruptCaches.push(danglingSourcePass)
  const danglingSourceProduct = structuredClone(validCache); danglingSourceProduct.assignments[0].passes[0].products[0].source_program_pass_product_id = uid(62); corruptCaches.push(danglingSourceProduct)
  for (const corrupt of corruptCaches) await rejects(() => Promise.resolve(decodeProgramsDataCache(corrupt, { farmId: farm, userId: actor })), 'Forged root, viewer, ownership, status, uniqueness, and nested cache shapes must fail closed.')
  const activeArchivedProgramCache = structuredClone(validCache); activeArchivedProgramCache.programs = []
  assert(decodeProgramsDataCache(activeArchivedProgramCache, { farmId: farm, userId: actor }).assignments[0].assignment_status === 'active', 'An active assignment must remain available from its stored snapshot when its owning Program was archived.')
  const linkedBoundaryCache = structuredClone(validCache); const linkedBoundaryPass = linkedBoundaryCache.assignments[0].passes[0]; Object.assign(linkedBoundaryPass, { status: 'applied' as const, applied_on: '2027-06-10', applied_acres: 100, application_record_id: uid(55) }); for (const product of linkedBoundaryPass.products) Object.assign(product, { actual_product_name: product.product_name, actual_rate_text: product.rate_text, actual_unit_text: product.unit_text }); linkedBoundaryCache.applicationRecords.push({ id: uid(55), farm_id: farm, crop_assignment_id: cropId, application_date: '2027-06-10', applied_acres: 100, status: 'draft' })
  assert(decodeProgramsDataCache(linkedBoundaryCache, { farmId: farm, userId: actor }).assignments[0].passes[0].applied_acres === 100, 'An application-linked pass and record may decode at the exact planted-acre boundary when canonical date and acreage agree.')
  const linkedDateMismatch = structuredClone(linkedBoundaryCache); linkedDateMismatch.applicationRecords[0].application_date = '2027-06-11'
  const linkedAcreageMismatch = structuredClone(linkedBoundaryCache); linkedAcreageMismatch.applicationRecords[0].applied_acres = 99.99999999
  for (const corrupt of [linkedDateMismatch, linkedAcreageMismatch]) await rejects(() => Promise.resolve(decodeProgramsDataCache(corrupt, { farmId: farm, userId: actor })), 'An application-linked cached record must exactly match the pass canonical date and acreage.')
  const matchedCacheGateway = new CW2Gateway(); await repository(matchedCacheGateway).markProgramPassAppliedOperation(passId, '2027-06-02', 80, actuals(confirmedMatch), { kind: 'none' }, uid(42), context); const matchedCache = await repository(matchedCacheGateway).getData(true); assert(decodeProgramsDataCache(matchedCache, { farmId: farm, userId: actor }).assignments[0].passes[0].products[0].inventory_match?.quantity_in_inventory_unit === 4.25, 'A coherent one-to-one confirmed cache match must survive strict decoding.')
  const orphanedNested = structuredClone(matchedCache); orphanedNested.assignments[0].passes[0].products[0].inventory_match = null
  const linkedMatched = structuredClone(matchedCache); linkedMatched.assignments[0].passes[0].application_record_id = uid(43)
  const overCapCache = structuredClone(matchedCache); overCapCache.inventoryMatches[0].quantity_in_inventory_unit = PROGRAM_INVENTORY_QUANTITY_MAX + 1; overCapCache.assignments[0].passes[0].products[0].inventory_match!.quantity_in_inventory_unit = PROGRAM_INVENTORY_QUANTITY_MAX + 1
  for (const corrupt of [orphanedNested, linkedMatched, overCapCache]) await rejects(() => Promise.resolve(decodeProgramsDataCache(corrupt, { farmId: farm, userId: actor })), 'Orphaned, application-linked, or unsafe confirmed cache facts must fail closed.')
  const groupedCache = structuredClone(matchedCache); const secondProduct = groupedCache.assignments[0].passes[0].products[1]; const secondInventory = { id: uid(45), farm_id: farm, name: secondProduct.actual_product_name!, inventory_unit: 'gal' as const, is_active: true }; const secondMatch = { ...structuredClone(groupedCache.inventoryMatches[0]), assigned_product_id: secondProduct.id, inventory_product_id: secondInventory.id, inventory_product_name_snapshot: secondInventory.name }; groupedCache.inventoryProducts.push(secondInventory); groupedCache.inventoryMatches.push(secondMatch); secondProduct.inventory_match = structuredClone(secondMatch)
  assert(decodeProgramsDataCache(groupedCache, { farmId: farm, userId: actor }).inventoryMatches.length === 2, 'One operation may coherently confirm multiple products on its single owning pass.')
  const conflictingConfirmer = structuredClone(groupedCache); conflictingConfirmer.inventoryMatches[1].confirmed_by = uid(46); conflictingConfirmer.assignments[0].passes[0].products[1].inventory_match!.confirmed_by = uid(46)
  const conflictingStamp = structuredClone(groupedCache); conflictingStamp.inventoryMatches[1].confirmed_at = '2026-08-11T18:30:01.000Z'; conflictingStamp.assignments[0].passes[0].products[1].inventory_match!.confirmed_at = '2026-08-11T18:30:01.000Z'
  const crossPassOperation = structuredClone(matchedCache); const clonedPass = structuredClone(crossPassOperation.assignments[0].passes[0]); clonedPass.id = uid(47); clonedPass.sequence = 2; clonedPass.products = [structuredClone(clonedPass.products[0])]; clonedPass.products[0].id = uid(48); clonedPass.products[0].assigned_pass_id = clonedPass.id; const crossMatch = { ...structuredClone(crossPassOperation.inventoryMatches[0]), assigned_product_id: clonedPass.products[0].id }; clonedPass.products[0].inventory_match = structuredClone(crossMatch); crossPassOperation.assignments[0].passes.push(clonedPass); crossPassOperation.inventoryMatches.push(crossMatch)
  for (const corrupt of [conflictingConfirmer, conflictingStamp, crossPassOperation]) await rejects(() => Promise.resolve(decodeProgramsDataCache(corrupt, { farmId: farm, userId: actor })), 'An operation receipt group must have one owning pass, confirmer, and confirmation timestamp.')

  const migration = readFileSync(new URL('../../supabase/migrations/20260813133808_connect_workflows_program_inventory.sql', import.meta.url), 'utf8')
  const fkIndexMigration = readFileSync(new URL('../../supabase/migrations/20260820135357_add_program_inventory_match_fk_indexes.sql', import.meta.url), 'utf8')
  const fkIndexMigrationSha256 = createHash('sha256').update(fkIndexMigration).digest('hex')
  const exactFkIndexMigration = (source: string) => {
    const assigned = /^\s*create\s+index\s+program_inventory_matches_assigned_product_farm_idx\s*\r?\n\s*on\s+public\.program_inventory_matches\s*\(\s*assigned_product_id\s*,\s*farm_id\s*\)\s*;/gm
    const inventory = /^\s*create\s+index\s+program_inventory_matches_inventory_product_farm_idx\s*\r?\n\s*on\s+public\.program_inventory_matches\s*\(\s*inventory_product_id\s*,\s*farm_id\s*\)\s*;/gm
    const assignedMatches = [...source.matchAll(assigned)]
    const inventoryMatches = [...source.matchAll(inventory)]
    return assignedMatches.length === 1 && inventoryMatches.length === 1 && (assignedMatches[0].index ?? -1) < (inventoryMatches[0].index ?? -1)
  }
  assert(fkIndexMigrationSha256 === 'bf6fbc84c5389e1122ce7ccf63c37dacb2dfc21d881216bbbb5241b203fa5589' && exactFkIndexMigration(fkIndexMigration), 'The follow-up CW-2 migration must be byte-pinned and contain exactly the two FK-covering indexes in referencing-key order.')
  // CW2_FK_INDEX_FOCUSED_PROOF_BEGIN
  const assignedFkIndex = 'create index program_inventory_matches_assigned_product_farm_idx\n  on public.program_inventory_matches (assigned_product_id, farm_id);'
  const inventoryFkIndex = 'create index program_inventory_matches_inventory_product_farm_idx\n  on public.program_inventory_matches (inventory_product_id, farm_id);'
  const semanticFkIndexMutation = (name: string, source: string) => ({ name, source, expectedSha256: createHash('sha256').update(source).digest('hex') })
  const fkIndexMigrationMutations = [
    semanticFkIndexMutation('assigned index removed', fkIndexMigration.replace(assignedFkIndex, `-- ${assignedFkIndex}`)),
    semanticFkIndexMutation('assigned index columns reordered', fkIndexMigration.replace('(assigned_product_id, farm_id)', '(farm_id, assigned_product_id)')),
    semanticFkIndexMutation('assigned index renamed', fkIndexMigration.replace('program_inventory_matches_assigned_product_farm_idx', 'program_inventory_matches_assigned_product_wrong_idx')),
    semanticFkIndexMutation('assigned index misdirected', fkIndexMigration.replace('on public.program_inventory_matches (assigned_product_id, farm_id);', 'on public.assigned_program_pass_products (id, farm_id);')),
    semanticFkIndexMutation('assigned partial predicate added', fkIndexMigration.replace('(assigned_product_id, farm_id);', '(assigned_product_id, farm_id) where farm_id is not null;')),
    semanticFkIndexMutation('assigned wider index added', fkIndexMigration.replace('(assigned_product_id, farm_id);', '(assigned_product_id, farm_id, confirmed_at);')),
    semanticFkIndexMutation('inventory index removed', fkIndexMigration.replace(inventoryFkIndex, `-- ${inventoryFkIndex}`)),
    semanticFkIndexMutation('inventory index columns reordered', fkIndexMigration.replace('(inventory_product_id, farm_id)', '(farm_id, inventory_product_id)')),
    semanticFkIndexMutation('inventory index renamed', fkIndexMigration.replace('program_inventory_matches_inventory_product_farm_idx', 'program_inventory_matches_inventory_product_wrong_idx')),
    semanticFkIndexMutation('inventory index misdirected', fkIndexMigration.replace('on public.program_inventory_matches (inventory_product_id, farm_id);', 'on public.inventory_products (id, farm_id);')),
    semanticFkIndexMutation('inventory partial predicate added', fkIndexMigration.replace('(inventory_product_id, farm_id);', '(inventory_product_id, farm_id) where farm_id is not null;')),
    semanticFkIndexMutation('inventory wider index added', fkIndexMigration.replace('(inventory_product_id, farm_id);', '(inventory_product_id, farm_id, confirmed_at);')),
    semanticFkIndexMutation('follow-up migration omitted', ''),
    semanticFkIndexMutation('foreign-key index order swapped', fkIndexMigration.replace(assignedFkIndex, 'CW2_ASSIGNED_INDEX_TEMP').replace(inventoryFkIndex, assignedFkIndex).replace('CW2_ASSIGNED_INDEX_TEMP', inventoryFkIndex)),
    { name: 'follow-up migration hash drift', source: fkIndexMigration, expectedSha256: '0000000000000000000000000000000000000000000000000000000000000000' },
  ] as const
  assert(fkIndexMigrationMutations.length === 15, 'The FK-index migration mutation block is incomplete.')
  let executedFkIndexMigrationMutations = 0
  for (const mutation of fkIndexMigrationMutations) {
    assert(!(exactFkIndexMigration(mutation.source) && createHash('sha256').update(mutation.source).digest('hex') === mutation.expectedSha256), `The ${mutation.name} FK-index migration mutation must turn the focused contract red.`)
    executedFkIndexMigrationMutations += 1
  }
  assert(executedFkIndexMigrationMutations === fkIndexMigrationMutations.length, 'Every FK-index migration mutation must execute.')
  const fkIndexRunnerSource = readFileSync(new URL('../../scripts/verify-connect-workflows-cw2-disposable.ps1', import.meta.url), 'utf8')
  const exactOnce = (source: string, needle: string) => source.split(needle).length === 2
  const completeArchivedBaselineExclusion = (source: string) => [
    '$archivedMigrations = @(',
    '(Join-Path $taskTemp "supabase/migrations/$migration"),',
    '(Join-Path $taskTemp "supabase/migrations/$fkIndexMigration")',
    'foreach ($archivedMigration in $archivedMigrations) {',
    'if (Test-Path -LiteralPath $archivedMigration) { Remove-Item -LiteralPath $archivedMigration }',
    'Assert-Cw2BaselineArchiveAttestation -ArchiveRoot $resolvedTemp -ArchivedMigrations $archivedMigrations -LogPath $LogPath',
  ].every((needle) => exactOnce(source, needle))
  assert(completeArchivedBaselineExclusion(fkIndexRunnerSource), 'The archived baseline must remove and attest both CW migrations before reset.')
  const archivedBaselineMutations = [
    { name: 'follow-up archived migration removal omitted', source: fkIndexRunnerSource.replace('      (Join-Path $taskTemp "supabase/migrations/$fkIndexMigration")', '') },
    { name: 'archived removal loop bypassed', source: fkIndexRunnerSource.replace('foreach ($archivedMigration in $archivedMigrations) {', 'foreach ($archivedMigration in @($archivedMigrations[0])) {') },
    { name: 'archived migration removal omitted', source: fkIndexRunnerSource.replace('if (Test-Path -LiteralPath $archivedMigration) { Remove-Item -LiteralPath $archivedMigration }', 'if (Test-Path -LiteralPath $archivedMigration) { Write-Output $archivedMigration }') },
    { name: 'archived migration attestation narrowed', source: fkIndexRunnerSource.replace('-ArchivedMigrations $archivedMigrations', '-ArchivedMigrations @($archivedMigrations[0])') },
  ] as const
  assert(archivedBaselineMutations.length === 4, 'The archived-baseline migration mutation block is incomplete.')
  for (const mutation of archivedBaselineMutations) assert(!completeArchivedBaselineExclusion(mutation.source), `The ${mutation.name} mutation must turn the archived-baseline contract red.`)
  // CW2_FK_INDEX_FOCUSED_PROOF_END
  assert(/where ap\.status = 'applied'\s+and ap\.application_record_id is not null\s+and app\.is_active;/.test(migration), 'The existing Program application view must remain limited to passes linked to a real application record.')
  assert(/create or replace function public\.protect_inventory_product_unit\(\)[\s\S]*public\.program_inventory_matches program_match[\s\S]*program_match\.inventory_product_id = old\.id/.test(migration), 'Program draw-down history must prevent later Inventory unit relabelling.')
  assert(/v_requested_match_count > 0\s+and \(p_application_record_id is not null or p_create_application_record\)/.test(migration), 'Any application record create/link path must reject a confirmed Inventory draw-down.')
  assert(/from public\.program_inventory_matches match[\s\S]*where assigned_pass\.status = 'applied'\s+and assigned_pass\.application_record_id is null/.test(migration), 'Inventory accounting must ignore any contradictory linked-application Program match to prevent a double draw.')
  assert(/quantity_in_inventory_unit > 0[\s\S]*quantity_in_inventory_unit <= 10000000[\s\S]*quantity_in_inventory_unit = round\(quantity_in_inventory_unit, 8\)/.test(migration) && /v_quantity > 10000000[\s\S]*v_quantity <> round\(v_quantity, 8\)/.test(migration), 'The table and RPC must share the 10,000,000 and eight-decimal quantity boundary.')
  const inventoryCatalogTriggerFunction = `create or replace function public.lock_inventory_products_catalog()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_farm_id uuid;
begin
  v_farm_id := case when tg_op = 'DELETE' then old.farm_id else new.farm_id end;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtext(v_farm_id::text),
    pg_catalog.hashtext('inventory-products-catalog')
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;`
  const inventoryCatalogTrigger = `create trigger inventory_products_catalog_lock
before insert or update or delete on public.inventory_products
for each row execute function public.lock_inventory_products_catalog();`
  const inventoryCatalogLock = "pg_catalog.hashtext('inventory-products-catalog')"
  const inventoryCatalogLockStatement = /\n    perform pg_advisory_xact_lock\(\n      pg_catalog\.hashtext\(p_farm_id::text\),\n      pg_catalog\.hashtext\('inventory-products-catalog'\)\n    \);/
  const candidateRowScan = 'perform inventory_product.id'
  const exactCandidateCount = 'select count(*) into v_exact_inventory_count'
  const catalogLockPrecedesCandidateValidation = (source: string) => { const request = source.indexOf('if v_requested_match_count > 0 then'); const triggerFunction = source.indexOf(inventoryCatalogTriggerFunction); const trigger = source.indexOf(inventoryCatalogTrigger); const lock = source.indexOf(inventoryCatalogLock, request); const scan = source.indexOf(candidateRowScan); const count = source.indexOf(exactCandidateCount); return triggerFunction >= 0 && trigger > triggerFunction && request >= 0 && lock > request && lock < scan && scan < count }
  assert(catalogLockPrecedesCandidateValidation(migration), 'A farm-scoped catalog trigger and advisory lock must block same-farm direct writes before both the candidate row scan and exact-name count.')
  assert(!catalogLockPrecedesCandidateValidation(migration.replace('before insert or update or delete on public.inventory_products', 'before update on public.inventory_products')), 'Reducing the trigger to UPDATE must turn the catalog concurrency guard red.')
  assert(!catalogLockPrecedesCandidateValidation(migration.replace('execute function public.lock_inventory_products_catalog();', 'execute function public.prevent_farm_id_change();')), 'Redirecting the trigger away from the catalog lock function must turn the catalog concurrency guard red.')
  assert(!catalogLockPrecedesCandidateValidation(migration.replace('perform pg_advisory_xact_lock(', 'perform pg_try_advisory_xact_lock(')), 'Making the catalog lock non-blocking must turn the catalog concurrency guard red.')
  assert(!catalogLockPrecedesCandidateValidation(migration.replace(inventoryCatalogLockStatement, '')), 'Removing the confirmation-side farm catalog lock must turn the ordering guard red.')
  const normalizedSql = (source: string) => source.replace(/\s+/g, ' ')
  const exactCaseComparison = 'btrim(inventory_product.name) collate "C" = btrim(v_item ->> \'actual_product_name\') collate "C"'
  const caseSensitiveServerMatch = (source: string) => normalizedSql(source).split(exactCaseComparison).length - 1 === 2
  assert(caseSensitiveServerMatch(migration), 'Both server candidate checks must use exact C-collation case-sensitive equality.')
  assert(!caseSensitiveServerMatch(migration.replaceAll('collate "C"', '')), 'Removing C collation must turn the server case-sensitivity mutation red.')
  assert(!caseSensitiveServerMatch(migration.replaceAll('collate "C" =', 'collate "C" ilike')), 'Replacing exact equality with case-insensitive matching must turn the server case-sensitivity mutation red.')
  const staleUnitGuard = "if v_inventory_unit::text is distinct from (v_item #>> '{inventory_match,inventory_unit}') then raise exception 'confirmed inventory unit is stale'; end if;"
  const exactStaleUnitServerGuard = (source: string) => normalizedSql(source).split(staleUnitGuard).length - 1 === 1
  assert(exactStaleUnitServerGuard(migration), 'The server must reject a requested Inventory unit that differs from the current canonical product unit.')
  const staleUnitMigrationMutations = [
    { name: 'remove exact stale-unit guard', source: normalizedSql(migration).replace(staleUnitGuard, '') },
    { name: 'accept equal instead of distinct unit', source: normalizedSql(migration).replace(staleUnitGuard, staleUnitGuard.replace('is distinct from', '=')) },
    { name: 'compare stale unit to actual line unit', source: normalizedSql(migration).replace(staleUnitGuard, staleUnitGuard.replace("v_item #>> '{inventory_match,inventory_unit}'", "v_item ->> 'actual_unit_text'")) },
    { name: 'remove stale-unit denial exception', source: normalizedSql(migration).replace(staleUnitGuard, staleUnitGuard.replace("raise exception 'confirmed inventory unit is stale';", 'null;')) },
  ]
  assert(staleUnitMigrationMutations.length === 4, 'The stale-unit server mutation block is incomplete.')
  for (const mutation of staleUnitMigrationMutations) assert(!exactStaleUnitServerGuard(mutation.source), `The ${mutation.name} mutation must turn the stale-unit server guard red.`)
  const fingerprintBindings = [
    "'farm_id', p_farm_id", "'operation_id', p_operation_id", "'user_id', v_caller", "'access_epoch', v_access_epoch",
    "'assigned_pass_id', p_assigned_pass_id", "'applied_on', p_applied_on", "'applied_acres', p_applied_acres",
    "'actual_products', v_canonical_actuals", "'application_record_id', p_application_record_id", "'create_application_record', p_create_application_record",
    "'id', 'actual_product_name', 'actual_rate_text', 'actual_unit_text", "'actual_cost_per_acre', 'inventory_match'",
    "'inventory_product_id', 'quantity_in_inventory_unit', 'inventory_unit'",
  ]
  const completeFingerprintContract = (source: string) => fingerprintBindings.every((binding) => source.includes(binding)) && source.includes("jsonb_agg(actual.value order by actual.value ->> 'id')") && source.includes("if v_receipt_user <> v_caller") && source.includes("v_receipt_fingerprint is distinct from v_request_fingerprint") && source.includes('legacy operation receipt cannot confirm an inventory match')
  assert(completeFingerprintContract(migration), 'The RPC fingerprint must bind complete ordered product, farm, operation, user, epoch, pass, applied, and record-choice context.')
  for (const binding of fingerprintBindings) assert(!completeFingerprintContract(migration.replace(binding, 'CW2_REMOVED_BINDING')), `Removing fingerprint component ${binding} must turn the static mutation red.`)

  const programsSource = readFileSync(new URL('../ProgramsModule.tsx', import.meta.url), 'utf8')
  const programsContractSource = readFileSync(new URL('./programs.ts', import.meta.url), 'utf8')
  assert(programsSource.includes('Confirm exact Inventory product: {candidate.name}') && programsSource.includes('Quantity to remove ({candidate.inventory_unit})') && programsSource.includes('Farm Rx will not convert the Program rate or unit.'), 'The Program UI must require an explicit exact-product confirmation and positive quantity in the canonical Inventory unit without conversion.')
  assert(programsSource.includes('No single active Inventory product exactly matches this product name. Inventory on hand will not change for this line.') && programsSource.includes('Inventory changes only after the server confirms sync.'), 'Unmatched and pending Program presentation must state that Inventory has not changed.')
  assert(programsSource.includes('const { inventory_match: _staleMatch, ...unmatched } = product') && programsSource.includes('const { inventory_match: _clearedMatch, ...unmatched } = item') && programsSource.includes('if (next !== "none")'), 'Stale candidates, edited product names, and every application-record choice must clear prior Inventory confirmation.')
  assert(programsSource.includes('Choose “Do not add an application record” to confirm a Program-to-Inventory draw-down.') && programsSource.includes('Inventory reduced by {formatProgramInventoryQuantity'), 'The Program UI must explain the no-record invariant and show exact confirmed facts only from canonical applied state.')
  const pendingConfirmationMarkers = ['const confirmedInventoryActuals = confirmedProgramInventoryActuals(submittedActuals)', 'const confirmedInventoryMatches = confirmedInventoryActuals.length', 'const confirmedInventorySummary = confirmedInventoryActuals.flatMap']
  const validPendingConfirmationSource = (moduleSource: string, contractSource: string) => pendingConfirmationMarkers.every((marker) => moduleSource.includes(marker)) && contractSource.includes('isProgramInventoryQuantity(product.inventory_match.quantity_in_inventory_unit)')
  assert(validPendingConfirmationSource(programsSource, programsContractSource), 'Only matches with a valid canonical quantity may count or render as confirmed Inventory reductions.')
  for (const marker of pendingConfirmationMarkers) assert(!validPendingConfirmationSource(programsSource.replace(marker, 'CW2_REMOVED_PENDING_CONFIRMATION_GUARD'), programsContractSource), `Removing pending-confirmation UI guard ${marker} must turn the mutation red.`)
  assert(!validPendingConfirmationSource(programsSource, programsContractSource.replace('isProgramInventoryQuantity(product.inventory_match.quantity_in_inventory_unit)', 'true')), 'Removing canonical quantity validation from confirmed-match selection must turn the mutation red.')
  const inventorySource = readFileSync(new URL('../InventoryModule.tsx', import.meta.url), 'utf8')
  assert(inventorySource.includes('Program passes linked to application records do not draw Inventory through Program matching.') && !inventorySource.includes('product.inventory_matched ? ` · Inventory reduced by'), 'Application-linked Inventory history must never claim the no-record Program draw-down; canonical matched history remains in Programs.')
  const inventoryRepositorySource = readFileSync(new URL('./SupabaseInventoryRepository.ts', import.meta.url), 'utf8')
  const strictInventoryBooleanMarkers = ["const bool = (value: unknown): boolean => typeof value === 'boolean' ? value : fail()", "const matched = bool(required(r, 'inventory_matched'))", 'result.inventory_matched || matchFacts.some((fact) => fact !== null)']
  const hasStrictInventoryBooleanGuard = (source: string) => strictInventoryBooleanMarkers.every((marker) => source.includes(marker))
  assert(hasStrictInventoryBooleanGuard(inventoryRepositorySource), 'The application-linked Inventory mapper must fail closed on every non-boolean match flag or impossible match fact.')
  for (const marker of strictInventoryBooleanMarkers) assert(!hasStrictInventoryBooleanGuard(inventoryRepositorySource.replace(marker, 'CW2_REMOVED_STRICT_BOOLEAN_GUARD')), `Removing strict Inventory boolean guard ${marker} must turn the mutation red.`)
  const cacheSource = readFileSync(new URL('./programsDataCache.ts', import.meta.url), 'utf8')
  const cacheCoherenceMarkers = ["pass.status === 'applied' && pass.applied_acres! > item.planted_acres", 'record.applied_acres > owner.planted_acres', 'record.application_date !== pass.applied_on', 'record.applied_acres !== pass.applied_acres', 'const operationOwners = new Map', 'operationOwner.passId !== target.pass.id', 'operationOwner.confirmedBy !== match.confirmed_by', 'operationOwner.confirmedAt !== match.confirmed_at']
  const completeCacheCoherence = (source: string) => cacheCoherenceMarkers.every((marker) => source.includes(marker))
  assert(completeCacheCoherence(cacheSource), 'Cached Programs data must enforce crop acreage ceilings and one coherent owning pass/confirmer/timestamp per operation.')
  for (const marker of cacheCoherenceMarkers) assert(!completeCacheCoherence(cacheSource.replace(marker, 'CW2_REMOVED_CACHE_GUARD')), `Removing cache guard ${marker} must turn the mutation red.`)
  const queuedProgramsSource = readFileSync(new URL('./QueuedProgramsRepository.ts', import.meta.url), 'utf8')
  assert(queuedProgramsSource.includes('decodeProgramsDataCache(cached.data, context)') && queuedProgramsSource.includes("applicationLink.kind !== 'none' && actualProducts.some"), 'Offline caches must use the complete context-bound decoder and queued application-record matches must fail before storage.')
  const programsRepositorySource = readFileSync(new URL('./SupabaseProgramsRepository.ts', import.meta.url), 'utf8')
  const liveOperationMarkers = ['const operationOwners = new Map', 'operationOwner.passId !== target.pass.id', 'operationOwner.confirmedBy !== match.confirmed_by', 'operationOwner.confirmedAt !== match.confirmed_at', 'operationOwners.set(match.operation_id']
  const completeLiveOperationGuard = (source: string) => liveOperationMarkers.every((marker) => source.includes(marker))
  assert(programsRepositorySource.includes("target.pass.application_record_id !== null") && programsRepositorySource.includes("applicationLink.kind !== 'none' && actualProducts.some") && completeLiveOperationGuard(programsRepositorySource), 'Canonical reads and Program Apply writes must reject application-linked matches and incoherent live operation provenance.')
  for (const marker of liveOperationMarkers) assert(!completeLiveOperationGuard(programsRepositorySource.replace(marker, 'CW2_REMOVED_LIVE_OPERATION_GUARD')), `Removing live operation guard ${marker} must turn the mutation red.`)
  const stableSnapshotMarkers = [
    'const programInventorySnapshotReadLimit = 3',
    'const rawAssignments = await this.d.gateway.loadAssignments(context.farmId)\n    await this.d.verifyOperationContext(context)\n    const rawInventoryMatches = await this.d.gateway.loadInventoryMatches(context.farmId)\n    await this.d.verifyOperationContext(context)',
    'let previous = await this.readProgramInventorySnapshot(context)',
    'const current = await this.readProgramInventorySnapshot(context)',
    'current.canonical === previous.canonical', 'previous = current', 'throw new ProgramInventorySnapshotConsistencyError()',
    'context: { projectRef: context.projectRef, userId: context.userId, farmId: context.farmId, generation: context.generation, token: context.token, serverEpoch: context.serverEpoch }',
    'const canonicalAssignments = assignments.map((assignment) => ({\n    ...assignment,\n    passes: [...assignment.passes].sort((left, right) => left.id.localeCompare(right.id)).map((pass) => ({ ...pass, products: [...pass.products].sort((left, right) => left.id.localeCompare(right.id)) }))',
    'left.assignment_id.localeCompare(right.assignment_id)', 'left.id.localeCompare(right.id)',
    'left.assigned_product_id.localeCompare(right.assigned_product_id) || left.inventory_product_id.localeCompare(right.inventory_product_id)',
    'this.stableProgramInventorySnapshot(context)',
  ]
  const stableCacheMarkers = ['const stableWorkspace = await this.live.getData(true)', 'this.workspace = stableWorkspace', 'if (error instanceof ProgramInventorySnapshotConsistencyError) throw error']
  const completeStableSnapshotGuard = (repository: string, queued: string) => {
    const stableRead = repository.indexOf('this.stableProgramInventorySnapshot(context)')
    const coherence = repository.indexOf('const operationOwners = new Map')
    const workspaceRead = queued.indexOf('const stableWorkspace = await this.live.getData(true)')
    const workspacePublish = queued.indexOf('this.workspace = stableWorkspace')
    return stableSnapshotMarkers.every((marker) => repository.includes(marker)) && stableCacheMarkers.every((marker) => queued.includes(marker))
      && stableRead >= 0 && coherence > stableRead && workspaceRead >= 0 && workspacePublish > workspaceRead
      && !/Promise\.all\([\s\S]{0,200}loadAssignments/.test(repository.slice(repository.indexOf('private async readProgramInventorySnapshot'), repository.indexOf('private async stableProgramInventorySnapshot')))
  }
  assert(completeStableSnapshotGuard(programsRepositorySource, queuedProgramsSource), 'Programs live reads must stabilize two consecutive complete sequential Program/Inventory snapshots before coherence validation or cache publication.')
  const stableSnapshotMutations = [
    { name: 'parallel coupled reads', repository: programsRepositorySource.replace(stableSnapshotMarkers[1], 'const [rawAssignments, rawInventoryMatches] = await Promise.all([this.d.gateway.loadAssignments(context.farmId), this.d.gateway.loadInventoryMatches(context.farmId)])'), queued: queuedProgramsSource },
    ...stableSnapshotMarkers.slice(2).map((marker) => ({ name: `remove snapshot guard ${marker}`, repository: programsRepositorySource.replace(marker, 'CW2_REMOVED_SNAPSHOT_STABILITY_GUARD'), queued: queuedProgramsSource })),
    ...stableCacheMarkers.map((marker) => ({ name: `remove stable cache guard ${marker}`, repository: programsRepositorySource, queued: queuedProgramsSource.replace(marker, 'CW2_REMOVED_STABLE_CACHE_GUARD') })),
  ]
  assert(stableSnapshotMutations.length === 15, 'The live snapshot stabilization mutation block is incomplete.')
  for (const mutation of stableSnapshotMutations) assert(!completeStableSnapshotGuard(mutation.repository, mutation.queued), `The ${mutation.name} mutation must turn the owning contract red.`)
  const programsRepositoryRegressionSource = readFileSync(new URL('./SupabaseProgramsRepository.regression.ts', import.meta.url), 'utf8')
  const exhaustiveSignatureFieldPaths = [
    'context.projectRef', 'context.userId', 'context.farmId', 'context.generation', 'context.token', 'context.serverEpoch',
    'assignment.id', 'assignment.farm_id', 'assignment.field_id', 'assignment.field_name', 'assignment.commodity_id', 'assignment.commodity_name', 'assignment.crop_year', 'assignment.planting_sequence', 'assignment.planting_date', 'assignment.planted_acres', 'assignment.latitude', 'assignment.longitude', 'assignment.assignment_id', 'assignment.program_id', 'assignment.program_name_snapshot', 'assignment.program_kind_snapshot', 'assignment.assignment_status', 'assignment.template_revision', 'assignment.current_template_revision', 'assignment.cost',
    'pass.id', 'pass.assignment_id', 'pass.source_program_pass_id', 'pass.source_revision', 'pass.sequence', 'pass.name', 'pass.pass_type', 'pass.activity_type', 'pass.timing_label', 'pass.target_date', 'pass.planting_offset_days', 'pass.reminder_lead_days', 'pass.notes', 'pass.due_on', 'pass.due_source', 'pass.is_field_override', 'pass.status', 'pass.applied_on', 'pass.applied_acres', 'pass.skipped_on', 'pass.skip_reason', 'pass.cancelled_at', 'pass.cancel_reason', 'pass.application_record_id',
    'product.id', 'product.farm_id', 'product.assigned_pass_id', 'product.source_program_pass_product_id', 'product.sequence', 'product.product_name', 'product.rate_text', 'product.unit_text', 'product.estimated_cost_per_acre', 'product.notes', 'product.actual_product_name', 'product.actual_rate_text', 'product.actual_unit_text', 'product.actual_cost_per_acre', 'product.inventory_match',
    'match.farm_id', 'match.assigned_product_id', 'match.inventory_product_id', 'match.quantity_in_inventory_unit', 'match.inventory_product_name_snapshot', 'match.inventory_unit_snapshot', 'match.operation_id', 'match.confirmed_by', 'match.confirmed_at',
  ] as const
  const completeExhaustiveSignatureMutationProof = (source: string) => {
    const table = source.slice(source.indexOf('const signatureFieldMutations = ['), source.indexOf('] as const satisfies readonly string[]'))
    const alternates = source.slice(source.indexOf('const alternates: Record<SignatureFieldPath, unknown> = {'), source.indexOf('\n  }\n  const next = alternates[path]'))
    const expected = source.slice(source.indexOf('const expectedSignatureFieldPaths = new Set(['), source.indexOf('] satisfies SignatureFieldPath[])'))
    return exhaustiveSignatureFieldPaths.length === 74
      && exhaustiveSignatureFieldPaths.every((path) => [table, alternates, expected].every((block) => block.split(`'${path}'`).length - 1 === 1))
      && ['signatureFieldMutations.length === 74', 'expectedSignatureFieldPaths.size === 74', 'new Set([', 'for (const [index, path] of signatureFieldMutations.entries())', 'canonicalProgramInventorySnapshot(changedContext, changedAssignments, changedMatches) !== stableSignature', 'executedSignatureCases === signatureFieldMutations.length'].every((marker) => source.includes(marker))
  }
  assert(completeExhaustiveSignatureMutationProof(programsRepositoryRegressionSource), 'The Programs regression must enumerate, uniquely check, execute, and compare every canonical assignment/pass/product/match/context signature field.')
  for (const path of exhaustiveSignatureFieldPaths) assert(!completeExhaustiveSignatureMutationProof(programsRepositoryRegressionSource.replace(`'${path}'`, `'CW2_REMOVED_${path}'`)), `Removing exhaustive signature case ${path} must turn the proof-of-proof red.`)
  for (const marker of ['signatureFieldMutations.length === 74', 'expectedSignatureFieldPaths.size === 74', 'for (const [index, path] of signatureFieldMutations.entries())', 'canonicalProgramInventorySnapshot(changedContext, changedAssignments, changedMatches) !== stableSignature', 'executedSignatureCases === signatureFieldMutations.length']) assert(!completeExhaustiveSignatureMutationProof(programsRepositoryRegressionSource.replace(marker, 'CW2_REMOVED_EXHAUSTIVE_SIGNATURE_GUARD')), `Removing exhaustive signature guard ${marker} must turn the proof-of-proof red.`)
  const packageSource = readFileSync(new URL('../../package.json', import.meta.url), 'utf8'); const inventoryRegressionLane = 'tsx src/data/SupabaseInventoryRepository.regression.ts'
  const packageIncludesInventoryRegression = (source: string) => source.includes(inventoryRegressionLane)
  assert(packageIncludesInventoryRegression(packageSource) && !packageIncludesInventoryRegression(packageSource.replace(inventoryRegressionLane, '')), 'The full regression command must include the Inventory reader that consumes confirmed Program match facts.')
  const replacementArtifact = {
    token: 'b9ad08aeb66ed961e8426b2cce527365',
    id: 'sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302',
    tag: 'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365:synthetic',
    ref: 'maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365@sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302',
  }
  const retiredArtifact = {
    token: '225c197c34164c90b08a4c8b6b10e6c7',
    id: 'sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746',
    tag: 'maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7:synthetic',
  }
  const harvestClockSource = readFileSync(new URL('../../scripts/harvest-ridge-db-clock.psm1', import.meta.url), 'utf8')
  const clockAdapterSource = readFileSync(new URL('../../scripts/maple-season-db-clock-docker-adapter.psm1', import.meta.url), 'utf8')
  const clockAdapterRegressionSource = readFileSync(new URL('../../scripts/maple-season-db-clock-docker-adapter.regression.ps1', import.meta.url), 'utf8')
  const topologyPlanSource = readFileSync(new URL('../../scripts/maple-synthetic-docker-topology-plan.ps1', import.meta.url), 'utf8')
  const topologyPlanRegressionSource = readFileSync(new URL('../../scripts/maple-synthetic-docker-topology-plan.regression.ps1', import.meta.url), 'utf8')
  const canonicalManifestRegressionSource = readFileSync(new URL('../../scripts/faketime-artifact-replacement-manifest.regression.ps1', import.meta.url), 'utf8')
  const clockSpikeRunnerSource = readFileSync(new URL('../../scripts/verify-maple-season-db-clock-spike.ps1', import.meta.url), 'utf8')
  const artifactEvidenceSource = readFileSync(new URL('../../docs/season-readiness/FAKETIME-ARTIFACT-EVIDENCE.md', import.meta.url), 'utf8')
  const frozenArtifactEvidenceSource = readFileSync(new URL('../../docs/season-readiness/FROZEN-OFFLINE-BUILD-EVIDENCE.md', import.meta.url), 'utf8')
  const artifactEvidenceManifestSource = readFileSync(new URL('../../docs/season-readiness/FAKETIME-ARTIFACT-REPLACEMENT-MANIFEST.json', import.meta.url), 'utf8')
  const frozenClockDockerfileSource = readFileSync(new URL('../../tests/season/frozen-postgres-clock-spike.Dockerfile', import.meta.url), 'utf8')
  const completeFaketimeArtifactReplacementContract = (sources: readonly string[]) => {
    const [harvest, adapter, adapterRegression, topology, topologyRegression, canonicalManifestRegression, spike, evidence, frozenEvidence, evidenceManifest, dockerfile] = sources
    const liveSources = [harvest, adapter, adapterRegression, topology, topologyRegression, spike]
    const cleanupSource = adapter.slice(adapter.indexOf('$adapter.RemoveDerivedImageIfOwned = {'), adapter.indexOf('return $adapter'))
    const cleanupTargets = [...cleanupSource.matchAll(/@\('image','rm',([^\)]+)\)/g)].map((match) => match[1])
    return liveSources.every((source) => !source.includes(retiredArtifact.id) && !source.includes(retiredArtifact.token) && !source.includes(retiredArtifact.tag))
      && harvest.includes(replacementArtifact.ref) && harvest.includes(replacementArtifact.id) && harvest.includes(replacementArtifact.tag) && harvest.includes(replacementArtifact.token)
      && adapter.includes(replacementArtifact.ref) && adapter.includes(replacementArtifact.id) && adapter.includes(replacementArtifact.tag) && adapter.includes(replacementArtifact.token)
      && adapterRegression.includes(replacementArtifact.ref) && adapterRegression.includes(replacementArtifact.id) && adapterRegression.includes(replacementArtifact.tag) && adapterRegression.includes(replacementArtifact.token)
      && topology.split(replacementArtifact.ref).length - 1 === 2 && topology.split(replacementArtifact.id).length - 1 === 4 && topology.includes('Observed=$true;LabelsVerified=$true') && topologyRegression.split(replacementArtifact.ref).length - 1 === 1
      && canonicalManifestRegression.includes('$paths.Sort([StringComparer]::Ordinal)') && canonicalManifestRegression.includes('HashSet[string]') && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_REPLACEMENT_CANONICAL_MANIFEST_PASS') && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_REPLACEMENT_CLEAN_FALLBACK_PASS') && canonicalManifestRegression.includes("@('diff-tree','--no-commit-id','--name-status','-r','-z','-M100%','HEAD^','HEAD')") && canonicalManifestRegression.includes("if($status-ceq'R100')") && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DELETION_REFUSED') && canonicalManifestRegression.includes('FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY') && !canonicalManifestRegression.includes('Sort-Object')
      && spike.includes(replacementArtifact.tag) && spike.includes(replacementArtifact.ref) && spike.includes(replacementArtifact.id) && spike.split('Assert-ExactReusableArtifact').length === 3 && [
        "'farmrx.synthetic-bootstrap'='b9ad08aeb66ed961e8426b2cce527365'", "'farmrx.synthetic-owner'='maple-faketime-bootstrap'", "'farmrx.synthetic-role'='faketime-artifacts'", "'farmrx.source-digest'='debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818'", "'farmrx.package-contract'='libfaketime=0.9.10-2.1;gcc;libc6-dev'"
      ].every((label) => spike.includes(label))
      && adapter.includes('$artifactByRef=& $inspectImage $artifactRef') && adapter.includes('$artifactByTag=& $inspectImage $artifactLocalTag')
      && cleanupTargets.length === 2 && cleanupTargets.includes('$Inventory.derived_tag') && cleanupTargets.includes('$Inventory.snapshot_tag')
      && !/artifact(?:LocalTag|Ref|Id)|(?:image|system)\s+prune|@\('image','prune'/.test(cleanupSource)
      && evidence.includes(retiredArtifact.id) && evidence.includes(replacementArtifact.ref) && evidence.includes('No continuity')
      && frozenEvidence.includes(retiredArtifact.tag) && frozenEvidence.includes(replacementArtifact.tag) && frozenEvidence.includes('historical')
      && evidenceManifest.includes(replacementArtifact.ref) && evidenceManifest.includes(replacementArtifact.id) && evidenceManifest.includes(replacementArtifact.tag) && evidenceManifest.includes('d8b95bfa5a83c56b3236a5579ad33043456e0fb5b09d1f93005efb1ec48e4276') && evidenceManifest.includes('97cbbca788a38b14b11e7780fdeb00b6852a224bf39076174ef626f7411e29de') && evidenceManifest.includes('5ee6803f958a960c0ee11b423e63b81d6bcfb1f5301afe99f8fa86531eaeff48') && evidenceManifest.includes('9ecb1ceb867d28184bd21187901c909e9901a71b7cf86f2c3cadcf332bf1bed8') && evidenceManifest.includes('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') && evidenceManifest.includes('aed05d2f6937223d8bbd53ea79a3043ce79a4436ce7e29d7569c04c66d77dbf2') && evidenceManifest.includes('historical-untracked-record-only; raw files are not an executable input. Current proof validates these tracked build-input pins and independently inspects the reusable artifact.') && evidenceManifest.split('historical-untracked-record-only; raw files are not an executable input. Current proof validates the tracked artifact identity and performs a fresh reusable-artifact inspection.').length === 3 && evidenceManifest.includes('evidence.files, derived_image_proof.files, reusable_postcleanup_attestation.files, and their combined SHA-256 values are historical untracked records only; current proof requires the tracked build-input pins and fresh reusable-artifact inspection.') && evidenceManifest.includes('clear-ld-preload.c') && evidenceManifest.includes('b6d9b439ccbfdf88f87b9c2f2d89b560d2370964074759373949c2bbb67cd66e') && evidenceManifest.includes('derived_image_proof') && evidenceManifest.includes('0ba1615005224ec79d44fcdb3998021d') && evidenceManifest.includes('sha256:ac2901f891cd4a96d70cde28c9dd9f1db6ca518f4d9e5db821518ecb518a0f74') && evidenceManifest.includes('eb43ca8c6035e8125e9ddbd7498f3bea8674a5a34c164c4e7ac4a1d1c9fc06d1') && evidenceManifest.includes('reusable_postcleanup_attestation') && evidenceManifest.includes('5469560cee6b3f5f863ea84aaab8376a38b3a909d2b2145e03671a32e5578eb5') && evidenceManifest.includes('efd709072eb35f838fcf5b81c22da204baadf3f54e016f5dfa64e4735d073163') && evidenceManifest.includes('combined_source_artifact_identity_recipe') && evidenceManifest.includes('NUL-delimited dirty tracked, staged, and untracked existing source') && evidenceManifest.includes('refusing missing/non-rename deleted paths') && evidenceManifest.includes('accepting only Git R100 renames by their existing destination path')
      && dockerfile.includes('ARG FAKETIME_ARTIFACTS_IMAGE') && !dockerfile.includes('ARG FAKETIME_ARTIFACTS_IMAGE=') && !dockerfile.match(/apt-get|curl|wget|https?:\/\//)
  }
  const replacementArtifactSources = [harvestClockSource, clockAdapterSource, clockAdapterRegressionSource, topologyPlanSource, topologyPlanRegressionSource, canonicalManifestRegressionSource, clockSpikeRunnerSource, artifactEvidenceSource, frozenArtifactEvidenceSource, artifactEvidenceManifestSource, frozenClockDockerfileSource] as const
  assert(completeFaketimeArtifactReplacementContract(replacementArtifactSources), 'Every owning faketime path must use the exact reviewed replacement identity, preserve the retired evidence, inspect both reusable names, and never clean up the reusable artifact.')
  const focusedExecutablePath = fileURLToPath(import.meta.url)
  const focusedSourceOverride = process.env.CW2_ARTIFACT_MATRIX_SOURCE_PATH
  assert(!focusedSourceOverride || (process.env.CW2_ARTIFACT_MATRIX_CHILD === '1' && isAbsolute(focusedSourceOverride)), 'A focused matrix source override is allowed only for an explicit child and must be absolute.')
  assert((process.env.CW2_ARTIFACT_MATRIX_CHILD === '1') === Boolean(focusedSourceOverride), 'Focused matrix child mode and its explicit source path must be present together.')
  const focusedProofSourcePath = focusedSourceOverride ?? focusedExecutablePath
  if (focusedSourceOverride) assert(focusedProofSourcePath.toLowerCase().startsWith(join(tmpdir(), 'farmrx-cw2-artifact-matrix-').toLowerCase()), 'The focused matrix child source must live in its unique operating-system temp root.')
  const focusedProofSource = readFileSync(focusedProofSourcePath, 'utf8')
  const canonicalManifestDiscoveryContract = (source: string) => {
    const normalized = source.replace(/\r\n/g, '\n')
    const dirty = source.indexOf("Invoke-Cw2ArtifactGitPathList @('diff','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_DIRTY_DIFF_GIT_FAILED'")
    const staged = source.indexOf("Invoke-Cw2ArtifactGitPathList @('diff','--cached','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_STAGED_DIFF_GIT_FAILED'")
    const untracked = source.indexOf("Invoke-Cw2ArtifactGitPathList @('ls-files','--others','--exclude-standard','-z') 'FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_GIT_FAILED'")
    const fallback = source.indexOf("Invoke-Cw2ArtifactGitPathList @('diff-tree','--no-commit-id','--name-status','-r','-z','-M100%','HEAD^','HEAD') 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_GIT_FAILED'")
    const empty = source.indexOf("if($paths.Count-eq0){throw 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY'}")
    const forced = source.indexOf('$cleanFallback=Get-Cw2ArtifactCanonicalManifest -ForceCleanFallback')
    const forcedRefusal = source.indexOf("if($cleanFallback.Source-cne'exact-previous-commit-diff'-or$cleanFallback.Lines.Count-eq0-or-not$cleanFallback.Canonical.EndsWith(\"`n\")){throw 'FAKETIME_ARTIFACT_MANIFEST_CLEAN_FALLBACK_PROOF_FAILED'}")
    const forcedGitFailure = source.indexOf("try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE}")
    const forcedGitRefusal = source.indexOf("if($forcedGitFailure-notmatch'^FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=([1-9][0-9]*):detail=.+$'){throw \"FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_CAPTURE_PROOF_FAILED:$forcedGitFailure\"}")
    const forcedGitEapRefusal = source.indexOf("if($ErrorActionPreference-cne$expectedErrorActionPreference){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_EAP_RESTORE_FAILED'}")
    const forcedGitPass = source.indexOf("Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_FAILURE_CAPTURE_PASS'")
    const forcedSequence = "try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE}\n  if($forcedGitFailure-notmatch'^FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=([1-9][0-9]*):detail=.+$'){throw \"FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_CAPTURE_PROOF_FAILED:$forcedGitFailure\"}"
    const nulSplit = "@($joined.Split([char[]]@([char]0),[StringSplitOptions]::RemoveEmptyEntries))"
    const pathCustody = [
      '$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal);$paths=[Collections.Generic.List[string]]::new()',
      'if(-not(Test-Path -LiteralPath (Join-Path $root $dirtyPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_DIRTY_PATH_MISSING:$dirtyPath"}',
      'if($seen.Add($dirtyNormalized)){[void]$paths.Add($dirtyNormalized)}',
      'if(-not(Test-Path -LiteralPath (Join-Path $root $stagedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_STAGED_PATH_MISSING:$stagedPath"}',
      'if($seen.Add($stagedNormalized)){[void]$paths.Add($stagedNormalized)}',
      'if(-not(Test-Path -LiteralPath (Join-Path $root $untrackedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_PATH_MISSING:$untrackedPath"}',
      'if($seen.Add($untrackedNormalized)){[void]$paths.Add($untrackedNormalized)}',
      "if($status-ceq'R100'){",
      'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_RENAME_DESTINATION_MISSING:$previousPath',
      "}elseif($status-ceq'D'){",
      'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DELETION_REFUSED:$deletedPath',
      'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_STATUS_REFUSED:$status',
      'if($seen.Add($previousNormalized)){[void]$paths.Add($previousNormalized)}',
      '$paths.Sort([StringComparer]::Ordinal)',
    ]
    return source.includes('function Invoke-Cw2ArtifactGitPathList([string[]]$Arguments,[string]$FailureMarker)')
      && source.includes('$previousErrorActionPreference=$ErrorActionPreference')
      && source.includes("try{$ErrorActionPreference='Continue';$output=@(& $gitExe -C $root @Arguments 2>&1);$exitCode=$LASTEXITCODE}finally{$ErrorActionPreference=$previousErrorActionPreference}")
      && source.includes('if($exitCode-ne0){$detail=')
      && source.includes('throw "${FailureMarker}:exit=${exitCode}:detail=${detail}"')
      && source.includes("if($ErrorActionPreference-cne$expectedErrorActionPreference){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_SUCCESS_EAP_RESTORE_FAILED'}")
      && source.includes("Write-Output 'FAKETIME_ARTIFACT_REPLACEMENT_GIT_EAP_RESTORE_PASS'")
      && source.includes('function Get-Cw2ForcedGitFailureAstContract([string]$Source)')
      && source.includes('function Invoke-Cw2ForcedGitFailureControlFlowProof([string]$Source,[pscustomobject]$Contract)')
      && source.includes('$node-is[System.Management.Automation.Language.CommandAst]')
      && source.includes('[object]::ReferenceEquals($outerTry.Parent.Parent,$ast)')
      && source.includes('$assignments.Count-ne2')
      && source.includes('$exitAssignments.Count-ne2')
      && source.includes("if(-not$forcedGitAstContract.Valid){throw 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_CONTRACT_FAILED'}")
      && source.includes('if(-not$ControlFlowChild){Invoke-Cw2ForcedGitFailureControlFlowProof $selfSource $forcedGitAstContract}')
      && source.includes('FAKETIME_ARTIFACT_REPLACEMENT_GIT_AST_CHILD_PROOF_PASS')
      && source.includes("$gitExe=[IO.Path]::GetFullPath($gitCommands[0].Source)")
      && source.includes("$matchingStarts.Count-ne1-or$matchingExits.Count-ne1")
      && source.includes("FAKETIME_ARTIFACT_REPLACEMENT_GIT_TRACE_OBSERVATION_PASS")
      && source.includes("farmrx-cw2-artifact-git-ast-")
      && source.includes("-RepositoryRoot $root -InitialErrorActionPreference $case.Preference")
      && source.includes("if([IO.File]::Exists($path)){[IO.File]::Delete($path)}")
      && source.includes("[IO.Directory]::Delete($tempRoot,$false)")
      && source.split(nulSplit).length - 1 === 1
      && pathCustody.every((needle) => source.includes(needle))
      && normalized.includes(forcedSequence)
      && source.includes('if(-not$ForceCleanFallback){')
      && dirty >= 0 && staged > dirty && untracked > staged && fallback > untracked && empty > fallback && forced > empty && forcedRefusal > forced && forcedGitFailure > forcedRefusal && forcedGitRefusal > forcedGitFailure && forcedGitEapRefusal > forcedGitRefusal && forcedGitPass > forcedGitEapRefusal
  }
  assert(canonicalManifestDiscoveryContract(canonicalManifestRegressionSource), 'The artifact manifest regression must use dirty paths first, then a captured exact HEAD^..HEAD fallback, and directly prove the clean fallback.')
  const focusedChildStart = '// CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_' + 'BEGIN'
  const focusedChildEnd = '// CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_' + 'END'
  assert(focusedProofSource.split(focusedChildStart).length - 1 === 1 && focusedProofSource.split(focusedChildEnd).length - 1 === 1, 'The focused TypeScript child proof must have one exact source boundary.')
  const focusedChildStartIndex = focusedProofSource.indexOf(focusedChildStart)
  const focusedChildEndIndex = focusedProofSource.indexOf(focusedChildEnd, focusedChildStartIndex)
  const focusedChildSpan = focusedProofSource.slice(focusedChildStartIndex, focusedChildEndIndex + focusedChildEnd.length)
  const focusedMatrixChildContract = (source: string) => [
    "if (process.env.CW2_ARTIFACT_MATRIX_CHILD !== '1')",
    'const focusedMatrixTempRoot = join(tmpdir(), `farmrx-cw2-artifact-matrix-${process.pid}-${randomUUID()}`)',
    'mkdirSync(focusedMatrixTempRoot)',
    "const baselinePath = join(focusedMatrixTempRoot, 'baseline-source.txt')",
    "const omittedPath = join(focusedMatrixTempRoot, 'matrix-omitted-source.txt')",
    "CW2_ARTIFACT_MATRIX_SOURCE_PATH: baselinePath",
    "CW2_ARTIFACT_MATRIX_SOURCE_PATH: omittedPath",
    'spawnSync(process.execPath, [tsxCli, focusedExecutablePath]',
    'if (existsSync(path)) unlinkSync(path)',
    'assert(!existsSync(path), `Focused matrix child temp file remains: ${path}`)',
    'if (existsSync(focusedMatrixTempRoot)) rmdirSync(focusedMatrixTempRoot)',
    'assert(!existsSync(focusedMatrixTempRoot), `Focused matrix child temp root remains: ${focusedMatrixTempRoot}`)',
  ].every((needle) => source.includes(needle)) && !source.includes("new URL(`./programInventoryCW2.matrix-")
  assert(focusedMatrixChildContract(focusedChildSpan), 'The focused TypeScript matrix proof must use one unique operating-system temp root, execute the repository source with an explicit child source path, and clean every owned file/root fail closed.')
  // CW2_ARTIFACT_MANIFEST_DISCOVERY_MATRIX_BEGIN
  const canonicalManifestDiscoveryMutations = [
    { target: 'manifest', name: 'dirty manifest discovery bypassed before fallback', from: 'if(-not$ForceCleanFallback){', to: 'if($false){' },
    { target: 'manifest', name: 'staged manifest discovery omitted', from: "foreach($stagedPath in (Invoke-Cw2ArtifactGitPathList @('diff','--cached','--name-only','-z') 'FAKETIME_ARTIFACT_MANIFEST_STAGED_DIFF_GIT_FAILED'))", to: "foreach($stagedPath in @())" },
    { target: 'manifest', name: 'clean fallback replaced with working diff', from: "@('diff-tree','--no-commit-id','--name-status','-r','-z','-M100%','HEAD^','HEAD')", to: "@('diff','--name-only','-z')" },
    { target: 'manifest', name: 'exact rename recognition removed', from: "if($status-ceq'R100'){", to: 'if($false){' },
    { target: 'manifest', name: 'clean fallback empty refusal removed', from: "if($paths.Count-eq0){throw 'FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DIFF_EMPTY'}", to: 'if($false){throw \'CW2_REMOVED_PREVIOUS_COMMIT_EMPTY_REFUSAL\'}' },
    { target: 'manifest', name: 'git failure capture bypassed', from: '$exitCode=$LASTEXITCODE', to: '$exitCode=0' },
    { target: 'manifest', name: 'forced clean fallback proof omitted', from: '$cleanFallback=Get-Cw2ArtifactCanonicalManifest -ForceCleanFallback', to: '$cleanFallback=$canonical' },
    { target: 'manifest', name: 'forced clean fallback refusal removed', from: "if($cleanFallback.Source-cne'exact-previous-commit-diff'-or$cleanFallback.Lines.Count-eq0-or-not$cleanFallback.Canonical.EndsWith(\"`n\")){throw 'FAKETIME_ARTIFACT_MANIFEST_CLEAN_FALLBACK_PROOF_FAILED'}", to: 'if($false){throw \'CW2_REMOVED_CLEAN_FALLBACK_PROOF\'}' },
    { target: 'manifest', name: 'git failure interpolation malformed', from: 'throw "${FailureMarker}:exit=${exitCode}:detail=${detail}"', to: 'throw "$FailureMarker:exit=$exitCode:detail=$detail"' },
    { target: 'manifest', name: 'forced git failure invocation omitted', from: "try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE}", to: "$forcedGitFailure='FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=1:detail=synthetic';$forcedGitExit=1" },
    { target: 'manifest', name: 'forced git failure refusal bypassed', from: "if($forcedGitFailure-notmatch'^FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=([1-9][0-9]*):detail=.+$'){throw \"FAKETIME_ARTIFACT_MANIFEST_GIT_FAILURE_CAPTURE_PROOF_FAILED:$forcedGitFailure\"}", to: "if($false){throw 'CW2_REMOVED_GIT_FAILURE_CAPTURE_REFUSAL'}" },
    { target: 'manifest', name: 'git error scope restore removed', from: 'finally{$ErrorActionPreference=$previousErrorActionPreference}', to: 'finally{}' },
    { target: 'manifest', name: 'git error capture broadened beyond helper', from: '$previousErrorActionPreference=$ErrorActionPreference', to: "$previousErrorActionPreference='Continue'" },
    { target: 'manifest', name: 'forced git call dead with synthetic result', from: "try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE}", to: "if($false){try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE}};$forcedGitFailure='FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=1:detail=synthetic';$forcedGitExit=1" },
    { target: 'manifest', name: 'forced git synthetic result injected', from: "try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE}", to: "try{[void](Invoke-Cw2ArtifactGitPathList @('rev-parse','--verify',$forcedGitMissingRef) 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE')}catch{$forcedGitFailure=$_.Exception.Message;$forcedGitExit=$LASTEXITCODE};$forcedGitFailure='FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_FAILURE:exit=1:detail=synthetic'" },
    { target: 'manifest', name: 'forced git AST contract bypassed', from: "if(-not$forcedGitAstContract.Valid){throw 'FAKETIME_ARTIFACT_MANIFEST_FORCED_GIT_AST_CONTRACT_FAILED'}", to: "if($false){throw 'CW2_REMOVED_FORCED_GIT_AST_CONTRACT'}" },
    { target: 'manifest', name: 'forced git AST child proof omitted', from: 'if(-not$ControlFlowChild){Invoke-Cw2ForcedGitFailureControlFlowProof $selfSource $forcedGitAstContract}', to: 'if($false){Invoke-Cw2ForcedGitFailureControlFlowProof $selfSource $forcedGitAstContract}' },
    { target: 'manifest', name: 'forced git AST child cleanup weakened', from: 'if([IO.File]::Exists($path)){[IO.File]::Delete($path)}', to: 'if($false){[IO.File]::Delete($path)}' },
    { target: 'manifest', name: 'forced git trace observation bypassed', from: "if($matchingStarts.Count-ne1-or$matchingExits.Count-ne1){throw 'FAKETIME_ARTIFACT_MANIFEST_GIT_TRACE_EXACT_INVOCATION_MISSING'}", to: "if($false){throw 'CW2_REMOVED_EXACT_GIT_TRACE_OBSERVATION'}" },
    { target: 'manifest', name: 'NUL delimiter parsing weakened', from: "@($joined.Split([char[]]@([char]0),[StringSplitOptions]::RemoveEmptyEntries))", to: "@($joined.Split([char[]]@([char]10),[StringSplitOptions]::RemoveEmptyEntries))" },
    { target: 'manifest', name: 'dirty path accumulation removed', from: 'if($seen.Add($dirtyNormalized)){[void]$paths.Add($dirtyNormalized)}', to: 'if($seen.Add($dirtyNormalized)){}' },
    { target: 'manifest', name: 'staged path accumulation removed', from: 'if($seen.Add($stagedNormalized)){[void]$paths.Add($stagedNormalized)}', to: 'if($seen.Add($stagedNormalized)){}' },
    { target: 'manifest', name: 'untracked path accumulation removed', from: 'if($seen.Add($untrackedNormalized)){[void]$paths.Add($untrackedNormalized)}', to: 'if($seen.Add($untrackedNormalized)){}' },
    { target: 'manifest', name: 'previous commit path accumulation removed', from: 'if($seen.Add($previousNormalized)){[void]$paths.Add($previousNormalized)}', to: 'if($seen.Add($previousNormalized)){}' },
    { target: 'manifest', name: 'dirty missing path refusal removed', from: 'if(-not(Test-Path -LiteralPath (Join-Path $root $dirtyPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_DIRTY_PATH_MISSING:$dirtyPath"}', to: 'if($false){throw "CW2_REMOVED_DIRTY_PATH_REFUSAL"}' },
    { target: 'manifest', name: 'staged missing path refusal removed', from: 'if(-not(Test-Path -LiteralPath (Join-Path $root $stagedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_STAGED_PATH_MISSING:$stagedPath"}', to: 'if($false){throw "CW2_REMOVED_STAGED_PATH_REFUSAL"}' },
    { target: 'manifest', name: 'untracked missing path refusal removed', from: 'if(-not(Test-Path -LiteralPath (Join-Path $root $untrackedPath) -PathType Leaf)){throw "FAKETIME_ARTIFACT_MANIFEST_UNTRACKED_PATH_MISSING:$untrackedPath"}', to: 'if($false){throw "CW2_REMOVED_UNTRACKED_PATH_REFUSAL"}' },
    { target: 'manifest', name: 'previous commit deletion refusal removed', from: 'throw "FAKETIME_ARTIFACT_MANIFEST_PREVIOUS_COMMIT_DELETION_REFUSED:$deletedPath"', to: 'throw "CW2_REMOVED_PREVIOUS_DELETION_REFUSAL"' },
    { target: 'manifest', name: 'path dedup comparator weakened', from: '$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)', to: '$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)' },
    { target: 'manifest', name: 'manifest path sort removed', from: '$paths.Sort([StringComparer]::Ordinal)', to: '$paths.Sort([StringComparer]::OrdinalIgnoreCase)' },
    { target: 'focused', name: 'focused child proof omitted', from: "if (process.env.CW2_ARTIFACT_MATRIX_CHILD !== '1')", to: 'if (false)' },
    { target: 'focused', name: 'focused child temp location moved into repository', from: 'const focusedMatrixTempRoot = join(tmpdir(), `farmrx-cw2-artifact-matrix-${process.pid}-${randomUUID()}`)', to: "const focusedMatrixTempRoot = join(fileURLToPath(new URL('./', import.meta.url)), `farmrx-cw2-artifact-matrix-${process.pid}-${randomUUID()}`)" },
    { target: 'focused', name: 'focused child source override removed', from: 'CW2_ARTIFACT_MATRIX_SOURCE_PATH: baselinePath', to: 'CW2_ARTIFACT_MATRIX_SOURCE_PATH: focusedExecutablePath' },
    { target: 'focused', name: 'focused child file cleanup removed', from: 'if (existsSync(path)) unlinkSync(path)', to: 'if (false) unlinkSync(path)' },
    { target: 'focused', name: 'focused child directory cleanup removed', from: 'if (existsSync(focusedMatrixTempRoot)) rmdirSync(focusedMatrixTempRoot)', to: 'if (false) rmdirSync(focusedMatrixTempRoot)' },
  ] as const
  assert(canonicalManifestDiscoveryMutations.length === 35, 'The artifact manifest discovery mutation matrix must retain NUL-delimited dirty/staged/untracked discovery, exact path accumulation/refusals/dedup/order, exact previous-commit fallback with R100-only rename destinations and deletion refusal, scoped Git stderr capture/restoration, trace/AST-bound actual forced Git failure, and repository-external focused child location/cleanup.')
  for (const mutation of canonicalManifestDiscoveryMutations) {
    const source = mutation.target === 'focused' ? focusedChildSpan : canonicalManifestRegressionSource
    const changed = source.replace(mutation.from, mutation.to)
    assert(changed !== source, `Artifact manifest discovery mutation must target source: ${mutation.name}.`)
    const survived = mutation.target === 'focused' ? focusedMatrixChildContract(changed) : canonicalManifestDiscoveryContract(changed)
    assert(!survived, `Artifact manifest discovery mutation must turn the contract red: ${mutation.name}.`)
  }
  // CW2_ARTIFACT_MANIFEST_DISCOVERY_MATRIX_END
  const discoveryMatrixStart = '// CW2_ARTIFACT_MANIFEST_DISCOVERY_' + 'MATRIX_BEGIN'
  const discoveryMatrixEnd = '// CW2_ARTIFACT_MANIFEST_DISCOVERY_' + 'MATRIX_END'
  assert(focusedProofSource.split(discoveryMatrixStart).length - 1 === 1 && focusedProofSource.split(discoveryMatrixEnd).length - 1 === 1, 'The artifact manifest discovery matrix span must have exactly one immutable boundary pair.')
  const discoveryStart = focusedProofSource.indexOf(discoveryMatrixStart)
  const discoveryEnd = focusedProofSource.indexOf(discoveryMatrixEnd, discoveryStart)
  const discoveryMatrixSpan = focusedProofSource.slice(discoveryStart, discoveryEnd + discoveryMatrixEnd.length)
  const discoveryMatrixSha256 = createHash('sha256').update(discoveryMatrixSpan).digest('hex')
  assert(discoveryMatrixSha256 === 'c7a29c368c18e24269a3f64afa75ce36bae3ad1992beca79864695ead310ce55', 'The executable artifact manifest discovery matrix bytes changed or were omitted.')
  const discoveryMatrixOmittedSource = focusedProofSource.slice(0, discoveryStart) + discoveryMatrixStart + '\n' + discoveryMatrixEnd + focusedProofSource.slice(discoveryEnd + discoveryMatrixEnd.length)
  const omittedStart = discoveryMatrixOmittedSource.indexOf(discoveryMatrixStart)
  const omittedEnd = discoveryMatrixOmittedSource.indexOf(discoveryMatrixEnd, omittedStart)
  const omittedSpan = discoveryMatrixOmittedSource.slice(omittedStart, omittedEnd + discoveryMatrixEnd.length)
  assert(createHash('sha256').update(omittedSpan).digest('hex') !== discoveryMatrixSha256, 'Deleting only the executable artifact manifest discovery matrix must turn the independent span proof red.')
  // CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_BEGIN
  if (process.env.CW2_ARTIFACT_MATRIX_CHILD !== '1') {
    const focusedMatrixTempRoot = join(tmpdir(), `farmrx-cw2-artifact-matrix-${process.pid}-${randomUUID()}`)
    mkdirSync(focusedMatrixTempRoot)
    const baselinePath = join(focusedMatrixTempRoot, 'baseline-source.txt')
    const omittedPath = join(focusedMatrixTempRoot, 'matrix-omitted-source.txt')
    const childPaths = [baselinePath, omittedPath]
    let primary: unknown = null
    const cleanupErrors: Error[] = []
    try {
      writeFileSync(baselinePath, focusedProofSource, 'utf8')
      writeFileSync(omittedPath, discoveryMatrixOmittedSource, 'utf8')
      const tsxCli = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url))
      const baselineEnv = { ...process.env, CW2_ARTIFACT_MATRIX_CHILD: '1', CW2_ARTIFACT_MATRIX_SOURCE_PATH: baselinePath }
      const omittedEnv = { ...process.env, CW2_ARTIFACT_MATRIX_CHILD: '1', CW2_ARTIFACT_MATRIX_SOURCE_PATH: omittedPath }
      const baselineChild = spawnSync(process.execPath, [tsxCli, focusedExecutablePath], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', env: baselineEnv })
      const baselineText = `${baselineChild.stdout ?? ''}\n${baselineChild.stderr ?? ''}`
      assert(baselineChild.status === 0 && baselineText.includes('Program Inventory CW2 regression passed'), `The baseline focused matrix child failed: ${baselineText}`)
      const omittedChild = spawnSync(process.execPath, [tsxCli, focusedExecutablePath], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', env: omittedEnv })
      assert(omittedChild.status !== 0, 'Deleting only the executable artifact manifest discovery matrix must turn the owning focused child regression red.')
    } catch (error) { primary = error }
    finally {
      for (const path of childPaths) {
        try { if (existsSync(path)) unlinkSync(path); assert(!existsSync(path), `Focused matrix child temp file remains: ${path}`) }
        catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error(String(error))) }
      }
      try { if (existsSync(focusedMatrixTempRoot)) rmdirSync(focusedMatrixTempRoot); assert(!existsSync(focusedMatrixTempRoot), `Focused matrix child temp root remains: ${focusedMatrixTempRoot}`) }
      catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error(String(error))) }
    }
    if (primary && cleanupErrors.length > 0) throw new AggregateError([primary, ...cleanupErrors], 'Focused matrix proof and cleanup failed.')
    if (primary) throw primary
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Focused matrix child cleanup failed.')
    console.log('Program Inventory CW2 manifest matrix outer proof passed')
  }
  // CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_END
  const artifactReplacementMutations = [
    { name: 'retired image ID restored in Harvest Ridge owner', index: 0, from: replacementArtifact.id, to: retiredArtifact.id },
    { name: 'replacement tag drifted in adapter', index: 1, from: replacementArtifact.tag, to: 'maple-faketime-artifacts-wrong:synthetic' },
    { name: 'canonical comparator weakened', index: 5, from: '$paths.Sort([StringComparer]::Ordinal)', to: '$paths.Sort([StringComparer]::OrdinalIgnoreCase)' },
    { name: 'replacement ref drifted in adapter regression', index: 2, from: replacementArtifact.ref, to: 'maple-faketime-artifacts-wrong@sha256:' + 'a'.repeat(64) },
    { name: 'replacement ref drifted in topology plan', index: 3, from: replacementArtifact.ref, to: 'maple-faketime-artifacts-wrong@sha256:' + 'b'.repeat(64) },
    { name: 'topology regression retained retired ref', index: 4, from: replacementArtifact.ref, to: `${retiredArtifact.tag.replace(':synthetic', '')}@${retiredArtifact.id}` },
    { name: 'spike runner retained retired tag', index: 6, from: replacementArtifact.tag, to: retiredArtifact.tag },
    { name: 'spike runner reusable label drifted', index: 6, from: "'farmrx.synthetic-owner'='maple-faketime-bootstrap'", to: "'farmrx.synthetic-owner'='wrong-owner'" },
    { name: 'spike runner reusable inspection invocation removed', index: 6, from: 'Assert-ExactReusableArtifact\n', to: 'CW2_REMOVED_REUSABLE_ARTIFACT_INSPECTION\n' },
    { name: 'reusable artifact tag cleanup added', index: 1, from: "$adapter.RemoveDerivedImageIfOwned = {", to: "$adapter.RemoveDerivedImageIfOwned = { & $invokeTrue @('image','rm',$artifactLocalTag) 'unsafe reusable artifact cleanup';" },
    { name: 'reusable artifact ref cleanup added', index: 1, from: "$adapter.RemoveDerivedImageIfOwned = {", to: "$adapter.RemoveDerivedImageIfOwned = { & $invokeTrue @('image','rm',$artifactRef) 'unsafe reusable artifact cleanup';" },
    { name: 'reusable artifact ID cleanup added', index: 1, from: "$adapter.RemoveDerivedImageIfOwned = {", to: "$adapter.RemoveDerivedImageIfOwned = { & $invokeTrue @('image','rm',$artifactId) 'unsafe reusable artifact cleanup';" },
    { name: 'broad image cleanup added', index: 1, from: "$adapter.RemoveDerivedImageIfOwned = {", to: "$adapter.RemoveDerivedImageIfOwned = { & $invokeTrue @('image','prune','-a') 'unsafe broad image cleanup';" },
    { name: 'historical replacement provenance removed', index: 7, from: replacementArtifact.ref, to: 'CW2_REMOVED_REPLACEMENT_PROVENANCE' },
    { name: 'durable artifact evidence manifest removed', index: 9, from: 'aed05d2f6937223d8bbd53ea79a3043ce79a4436ce7e29d7569c04c66d77dbf2', to: 'CW2_REMOVED_EVIDENCE_MANIFEST' },
    { name: 'copied preload source provenance removed', index: 9, from: 'b6d9b439ccbfdf88f87b9c2f2d89b560d2370964074759373949c2bbb67cd66e', to: 'CW2_REMOVED_PRELOAD_SOURCE_PROVENANCE' },
    { name: 'derived image proof identity removed', index: 9, from: 'sha256:ac2901f891cd4a96d70cde28c9dd9f1db6ca518f4d9e5db821518ecb518a0f74', to: 'CW2_REMOVED_DERIVED_IMAGE_PROOF' },
    { name: 'reusable postcleanup attestation removed', index: 9, from: '5469560cee6b3f5f863ea84aaab8376a38b3a909d2b2145e03671a32e5578eb5', to: 'CW2_REMOVED_REUSABLE_POSTCLEANUP' },
    { name: 'manifest discovery recipe weakened', index: 9, from: 'NUL-delimited dirty tracked, staged, and untracked existing source', to: 'newline dirty changed/untracked source' },
    { name: 'tracked-only artifact custody removed', index: 9, from: 'historical-untracked-record-only; raw files are not an executable input. Current proof validates these tracked build-input pins and independently inspects the reusable artifact.', to: 'CW2_REMOVED_TRACKED_ARTIFACT_CUSTODY' },
    { name: 'tracked-only artifact recipe custody removed', index: 9, from: 'evidence.files, derived_image_proof.files, reusable_postcleanup_attestation.files, and their combined SHA-256 values are historical untracked records only; current proof requires the tracked build-input pins and fresh reusable-artifact inspection.', to: 'CW2_REMOVED_TRACKED_ARTIFACT_RECIPE_CUSTODY' },
    { name: 'derived artifact custody removed', index: 9, from: 'historical-untracked-record-only; raw files are not an executable input. Current proof validates the tracked artifact identity and performs a fresh reusable-artifact inspection.', to: 'CW2_REMOVED_DERIVED_ARTIFACT_CUSTODY' },
    { name: 'all raw artifact recipe custody removed', index: 9, from: 'evidence.files, derived_image_proof.files, reusable_postcleanup_attestation.files, and their combined SHA-256 values are historical untracked records only; current proof requires the tracked build-input pins and fresh reusable-artifact inspection.', to: 'CW2_REMOVED_ALL_ARTIFACT_RECIPE_CUSTODY' },
  ] as const
  assert(artifactReplacementMutations.length === 23, 'The artifact replacement mutation matrix must retain every stale-identity, canonical identity, complete raw-evidence custody boundary and recipe, provenance, complete build-input evidence, derived-image proof, reusable postcleanup attestation, NUL-safe discovery recipe, standalone attestation, absence, and exact cleanup guard.')
  for (const mutation of artifactReplacementMutations) {
    const changed = [...replacementArtifactSources]; changed[mutation.index] = changed[mutation.index].replace(mutation.from, mutation.to)
    assert(!completeFaketimeArtifactReplacementContract(changed), `Artifact replacement mutation must turn the contract red: ${mutation.name}.`)
  }
  const artifactReplacementRegressionSource = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  for (const marker of ['const replacementArtifact = {', 'const retiredArtifact = {', 'const completeFaketimeArtifactReplacementContract =', 'const canonicalManifestDiscoveryContract =', 'const canonicalManifestDiscoveryMutations = [', 'canonicalManifestDiscoveryMutations.length === 35', 'for (const mutation of canonicalManifestDiscoveryMutations)', 'staged manifest discovery omitted', 'clean fallback replaced with working diff', 'exact rename recognition removed', 'forced clean fallback proof omitted', 'git failure interpolation malformed', 'forced git failure invocation omitted', 'forced git failure refusal bypassed', 'git error scope restore removed', 'git error capture broadened beyond helper', 'forced git call dead with synthetic result', 'forced git synthetic result injected', 'forced git AST contract bypassed', 'forced git AST child proof omitted', 'forced git AST child cleanup weakened', 'forced git trace observation bypassed', 'NUL delimiter parsing weakened', 'dirty path accumulation removed', 'staged path accumulation removed', 'untracked path accumulation removed', 'previous commit path accumulation removed', 'dirty missing path refusal removed', 'staged missing path refusal removed', 'untracked missing path refusal removed', 'previous commit deletion refusal removed', 'path dedup comparator weakened', 'manifest path sort removed', 'focused child proof omitted', 'focused child temp location moved into repository', 'focused child source override removed', 'focused child file cleanup removed', 'focused child directory cleanup removed', 'CW2_ARTIFACT_MANIFEST_DISCOVERY_MATRIX_BEGIN', 'CW2_ARTIFACT_MANIFEST_DISCOVERY_MATRIX_END', 'CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_BEGIN', 'CW2_ARTIFACT_MANIFEST_TS_CHILD_PROOF_END', 'Program Inventory CW2 manifest matrix outer proof passed', 'const artifactReplacementMutations = [', 'artifactReplacementMutations.length === 23', 'for (const mutation of artifactReplacementMutations)', 'trackedArtifactCustodyRunnerContract', 'trackedArtifactCustodyMutations.length === 4', 'canonical comparator weakened', 'manifest discovery recipe weakened', 'tracked-only artifact custody removed', 'tracked-only artifact recipe custody removed', 'derived artifact custody removed', 'all raw artifact recipe custody removed', 'durable artifact evidence manifest removed', 'copied preload source provenance removed', 'derived image proof identity removed', 'reusable postcleanup attestation removed', 'spike runner reusable inspection invocation removed', 'broad image cleanup added']) {
    assert(artifactReplacementRegressionSource.includes(marker), `Artifact replacement proof-of-proof marker must be present: ${marker}.`)
  }
  const disposableSource = readFileSync(new URL('../../scripts/verify-connect-workflows-cw2-disposable.ps1', import.meta.url), 'utf8')
  const trackedArtifactCustodyRunnerContract = (runner: string, manifest: string) =>
    manifest.includes('"custody": "historical-untracked-record-only; raw files are not an executable input. Current proof validates these tracked build-input pins and independently inspects the reusable artifact."') &&
    runner.includes('$historicalArtifactEvidence=$artifactEvidenceManifest.evidence') &&
    runner.includes("CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_TRACKED_CUSTODY_DRIFT") &&
    runner.includes('$trackedBuildInputs=$artifactEvidenceManifest.build_inputs') &&
    runner.includes("CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_TRACKED_BUILD_INPUT_DRIFT") &&
    runner.includes("CONNECT_WORKFLOWS_CW2_FAKETIME_ARTIFACT_TRACKED_BUILD_INPUT_SOURCE_HASH_DRIFT") &&
    runner.includes("CONNECT_WORKFLOWS_CW2_DERIVED_IMAGE_PROOF_CUSTODY_DRIFT") &&
    runner.includes("CONNECT_WORKFLOWS_CW2_REUSABLE_POSTCLEANUP_CUSTODY_DRIFT") &&
    !runner.includes('$artifactEvidenceRoot') && !runner.includes('$derivedRoot') && !runner.includes('$postcleanupRoot')
  assert(trackedArtifactCustodyRunnerContract(disposableSource, artifactEvidenceManifestSource), 'The CW-2 runner must validate tracked Faketime custody and must not depend on ignored evidence directories.')
  const trackedArtifactCustodyMutations = [
    { name: 'tracked custody declaration removed', runner: disposableSource.replace('$historicalArtifactEvidence=$artifactEvidenceManifest.evidence', '$historicalArtifactEvidence=$null'), manifest: artifactEvidenceManifestSource },
    { name: 'tracked build-input pin removed', runner: disposableSource.replace('$trackedBuildInputs=$artifactEvidenceManifest.build_inputs', '$trackedBuildInputs=$null'), manifest: artifactEvidenceManifestSource },
    { name: 'derived historical-custody refusal removed', runner: disposableSource.replace("CONNECT_WORKFLOWS_CW2_DERIVED_IMAGE_PROOF_CUSTODY_DRIFT", 'CW2_REMOVED_DERIVED_CUSTODY_REFUSAL'), manifest: artifactEvidenceManifestSource },
    { name: 'manifest historical-only custody removed', runner: disposableSource, manifest: artifactEvidenceManifestSource.replace('historical-untracked-record-only; raw files are not an executable input. Current proof validates these tracked build-input pins and independently inspects the reusable artifact.', 'CW2_REMOVED_TRACKED_CUSTODY') },
  ] as const
  assert(trackedArtifactCustodyMutations.length === 4, 'The tracked Faketime custody mutation matrix must cover the source, build-input, derived-proof, and manifest boundaries.')
  for (const mutation of trackedArtifactCustodyMutations) assert(!trackedArtifactCustodyRunnerContract(mutation.runner, mutation.manifest), `Tracked Faketime custody mutation must turn the guard red: ${mutation.name}.`)
  const cedarRunnerSource = readFileSync(new URL('../../scripts/verify-cedar-creek-disposable.ps1', import.meta.url), 'utf8')
  const migrationGitBlob = createHash('sha1').update(`blob ${Buffer.byteLength(migration)}\0`).update(migration).digest('hex')
  const pinnedMigrationBlob = (source: string) => source.match(/\$migrationBlob = '([0-9a-f]{40})'/)?.[1] ?? null
  const pinnedFkIndexMigration = (source: string) => ({
    name: source.match(/\$fkIndexMigration = '([^']+)'/)?.[1] ?? null,
    sha256: source.match(/\$fkIndexMigrationSha256 = '([0-9a-f]{64})'/)?.[1] ?? null,
  })
  const focusedFkIndexGuard = "if ((Get-Cw2Sha256 $fkIndexMigrationBytes) -cne $fkIndexMigrationSha256 -or -not (Test-Cw2FkIndexMigrationContract ([Text.UTF8Encoding]::new($false).GetString($fkIndexMigrationBytes)))) { throw 'CONNECT_WORKFLOWS_CW2_FK_INDEX_MIGRATION_CONTRACT_MISMATCH' }"
  const cedarFkIndexGuard = "if ((Get-FileHash -LiteralPath (Join-Path $root \"supabase/migrations/$fkIndexMigration\") -Algorithm SHA256).Hash.ToLowerInvariant() -cne $fkIndexMigrationSha256) { throw 'CEDAR_CREEK_FK_INDEX_MIGRATION_HASH_MISMATCH' }"
  const currentMutuallyConsistentPins = (focused: string, cedar: string) => {
    const focusedFk = pinnedFkIndexMigration(focused)
    const cedarFk = pinnedFkIndexMigration(cedar)
    return pinnedMigrationBlob(focused) === migrationGitBlob && pinnedMigrationBlob(cedar) === migrationGitBlob && pinnedMigrationBlob(focused) === pinnedMigrationBlob(cedar) &&
      focusedFk.name === '20260820135357_add_program_inventory_match_fk_indexes.sql' && cedarFk.name === focusedFk.name &&
      focusedFk.sha256 === fkIndexMigrationSha256 && cedarFk.sha256 === focusedFk.sha256 &&
      focused.split(focusedFkIndexGuard).length === 2 && cedar.split(cedarFkIndexGuard).length === 2
  }
  assert(currentMutuallyConsistentPins(disposableSource, cedarRunnerSource), 'The focused and Cedar runners must both pin the Git blob derived from the exact current migration bytes.')
  assert(!currentMutuallyConsistentPins(disposableSource.replace(migrationGitBlob, '0000000000000000000000000000000000000000'), cedarRunnerSource), 'A stale focused-runner migration pin must turn the offline mutation red.')
  assert(!currentMutuallyConsistentPins(disposableSource, cedarRunnerSource.replace(migrationGitBlob, '1111111111111111111111111111111111111111')), 'A stale Cedar migration pin must turn the offline mutation red.')
  const fkIndexPinMutations = [
    { name: 'focused follow-up migration name drift', focused: disposableSource.replace('20260820135357_add_program_inventory_match_fk_indexes.sql', '20260820135358_wrong.sql'), cedar: cedarRunnerSource },
    { name: 'Cedar follow-up migration name drift', focused: disposableSource, cedar: cedarRunnerSource.replace('20260820135357_add_program_inventory_match_fk_indexes.sql', '20260820135358_wrong.sql') },
    { name: 'focused follow-up migration hash drift', focused: disposableSource.replace(fkIndexMigrationSha256, '2222222222222222222222222222222222222222222222222222222222222222'), cedar: cedarRunnerSource },
    { name: 'Cedar follow-up migration hash drift', focused: disposableSource, cedar: cedarRunnerSource.replace(fkIndexMigrationSha256, '3333333333333333333333333333333333333333333333333333333333333333') },
    { name: 'focused follow-up migration guard removed', focused: disposableSource.replace(focusedFkIndexGuard, ''), cedar: cedarRunnerSource },
    { name: 'Cedar follow-up migration guard removed', focused: disposableSource, cedar: cedarRunnerSource.replace(cedarFkIndexGuard, '') },
  ] as const
  assert(fkIndexPinMutations.length === 6, 'The cross-runner FK-index pin mutation block is incomplete.')
  for (const mutation of fkIndexPinMutations) assert(!currentMutuallyConsistentPins(mutation.focused, mutation.cedar), `The ${mutation.name} mutation must turn the cross-runner pin contract red.`)
  const diagnosticHarnessMarkers = [
    'function Invoke-Cw2CapturedProcess', 'function Assert-Cw2CaptureSuccess', 'function Invoke-Cw2DiagnosticSelfTest',
    '[Diagnostics.ProcessStartInfo]::new()', '$startInfo.UseShellExecute = $false',
    '$nativeProcessId = $process.Id', '$process.WaitForExit(5000)',
    '$startInfo.RedirectStandardInput = $true', '$startInfo.RedirectStandardOutput = $true', '$startInfo.RedirectStandardError = $true',
    '$resolvedWorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)', '$startInfo.WorkingDirectory = $resolvedWorkingDirectory', 'explicit-working-directory', 'CONNECT_WORKFLOWS_CW2_SELFTEST_WORKING_DIRECTORY_NOT_APPLIED',
    '$process.StandardInput.BaseStream.Write($StdinBytes,0,$StdinBytes.Length)',
    '$process.StandardOutput.BaseStream.CopyToAsync($stdoutStream)', '$process.StandardError.BaseStream.CopyToAsync($stderrStream)',
    '[IO.FileOptions]::WriteThrough', '[IO.FileStream]::new($stdoutPath', '[IO.FileStream]::new($stderrPath',
    "event='native_started'", "event='native_process_started'", "event='native_timeout'", "event='native_timeout_finalized'", "event='native_finished'",
    'native_process_id', 'kill_requested', 'finalization_completed', 'post_kill_exit_code', 'stdin_sha256', 'stdout_sha256', 'stderr_sha256',
    "$ErrorActionPreference = 'Continue'", '$ErrorActionPreference = $priorErrorActionPreference',
    '$priorConsoleInputEncoding = [Console]::InputEncoding', '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)', '[Console]::InputEncoding = $priorConsoleInputEncoding',
    '$Capture.NativeExitCode -ne 0', '$Capture.StdoutText -cnotmatch $markerPattern', '$Capture.StderrText.IndexOf($RequiredMarker,[StringComparison]::Ordinal)', '$stderrMarkerIndex -ge 0', 'return $true',
    'Write-Cw2CaptureReplay $capture', '"cw2-$captureId.stdout.bin"', '"cw2-$captureId.stderr.bin"',
    'CONNECT_WORKFLOWS_CW2_DURABLE_LOG_WRITE_FAILED', 'CONNECT_WORKFLOWS_CW2_CAPTURE_FAILED',
    'byte-exact-concurrent-zero', 'stderr-nonzero', 'empty-nonzero', 'zero-no-marker', 'stderr-marker-only', 'stdout-and-stderr-marker', 'embedded-stderr-marker', 'lowercase-stdout-marker',
    'start-failure', 'timeout-missing-exit', 'CONNECT_WORKFLOWS_CW2_SELFTEST_TIMEOUT_FINALIZATION_EVIDENCE_MISSING', 'CONNECT_WORKFLOWS_CW2_SELFTEST_DURABLE_PID_FINALIZATION_RECORD_MISSING', 'finally-restore', 'evidence-native-aggregate',
    'CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_STAGE_REQUIRED', 'marker-only-nonzero', 'Invoke-Cw2BaselineRecoveryEvidenceSelfTest',
    'CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_RECORD_READBACK_FAILED', 'CONNECT_WORKFLOWS_CW2_SELFTEST_BASELINE_RECOVERY_RECORD_MISSING',
    'CONNECT_WORKFLOWS_CW2_SELFTEST_POST_IDENTITY_RECOVERY_UNKNOWN_MISSING', 'CONNECT_WORKFLOWS_CW2_SELFTEST_BASELINE_FAILURE_CODE_MASKED', 'SELFTEST_RECOVERY_WRITE_FAILURE', 'CONNECT_WORKFLOWS_CW2_SELFTEST_FALSE_RECOVERY_RECORD_ON_SUCCESS',
  ]
  const processStart = disposableSource.indexOf('function Invoke-Cw2CapturedProcess')
  const processEnd = disposableSource.indexOf('function Write-Cw2CaptureReplay')
  const sqlLaunchStart = disposableSource.indexOf('$verifyBytes = [IO.File]::ReadAllBytes($verify)')
  const sqlLaunchEnd = disposableSource.indexOf("[void](Assert-Cw2CaptureSuccess $capture 'CONNECT_WORKFLOWS_CW2_SQL_PASS')")
  const baselineResetStart = disposableSource.indexOf('function Assert-Cw2MigrationRollback')
  const baselineResetEnd = disposableSource.indexOf('\nAssert-Cw2Contract\n', baselineResetStart)
  const completeDiagnosticHarness = (source: string) => {
    const start = source.indexOf('function Invoke-Cw2CapturedProcess')
    const end = source.indexOf('function Write-Cw2CaptureReplay')
    const launchStart = source.indexOf('$verifyBytes = [IO.File]::ReadAllBytes($verify)')
    const launchEnd = source.indexOf("[void](Assert-Cw2CaptureSuccess $capture 'CONNECT_WORKFLOWS_CW2_SQL_PASS')")
    const baselineStart = source.indexOf('function Assert-Cw2MigrationRollback')
    const baselineEnd = source.indexOf('\nAssert-Cw2Contract\n', baselineStart)
    if (start < 0 || end <= start || launchStart < 0 || launchEnd <= launchStart || baselineStart < 0 || baselineEnd <= baselineStart) return false
    const processSource = source.slice(start, end)
    const launchSource = source.slice(launchStart, launchEnd)
    const baselineSource = source.slice(baselineStart, baselineEnd)
    const recoveryStart = source.indexOf('function Write-Cw2BaselineRecoveryRequired')
    const recoveryEnd = source.indexOf('function Get-Cw2AccessToken', recoveryStart)
    const recoverySource = recoveryStart < 0 || recoveryEnd <= recoveryStart ? '' : source.slice(recoveryStart, recoveryEnd)
    const captureExitStart = source.indexOf('function Assert-Cw2CaptureExitZero')
    const captureExitEnd = source.indexOf('function Assert-Cw2SelfTestThrows', captureExitStart)
    const captureExitSource = captureExitStart < 0 || captureExitEnd <= captureExitStart ? '' : source.slice(captureExitStart, captureExitEnd)
    const failurePathStart = baselineSource.indexOf('# CW2_BASELINE_RESET_FAILURE_PATH_BEGIN')
    const failurePathEnd = baselineSource.indexOf('# CW2_BASELINE_RESET_FAILURE_PATH_END')
    if (failurePathStart < 0 || failurePathEnd <= failurePathStart) return false
    const failurePathSource = baselineSource.slice(failurePathStart, failurePathEnd)
    const resetCaptureStart = failurePathSource.indexOf('# CW2_BASELINE_RESET_CAPTURE_BEGIN')
    const resetCaptureEnd = failurePathSource.indexOf('# CW2_BASELINE_RESET_CAPTURE_END')
    if (resetCaptureStart < 0 || resetCaptureEnd <= resetCaptureStart) return false
    const resetCaptureSource = failurePathSource.slice(resetCaptureStart, resetCaptureEnd)
    const resetOnlyStart = source.indexOf('# CW2_BASELINE_RESET_ONLY_BEGIN')
    const resetOnlyEnd = source.indexOf('# CW2_BASELINE_RESET_ONLY_END', resetOnlyStart)
    if (resetOnlyStart < 0 || resetOnlyEnd <= resetOnlyStart) return false
    const resetOnlySource = source.slice(resetOnlyStart, resetOnlyEnd)
    const stdoutDrain = processSource.indexOf('$process.StandardOutput.BaseStream.CopyToAsync($stdoutStream)')
    const stderrDrain = processSource.indexOf('$process.StandardError.BaseStream.CopyToAsync($stderrStream)')
    const wait = processSource.indexOf('$process.WaitForExit($TimeoutMilliseconds)')
    const nativeStarted = processSource.indexOf("event='native_started'")
    const nativeProcessStarted = processSource.indexOf("event='native_process_started'")
    const nativeTimeout = processSource.indexOf("event='native_timeout'")
    const nativeTimeoutFinalized = processSource.indexOf("event='native_timeout_finalized'")
    const processStartCall = processSource.indexOf('$process.Start()')
    const nativeFinished = processSource.indexOf("event='native_finished'")
    const archiveAttestation = baselineSource.indexOf('Assert-Cw2BaselineArchiveAttestation')
    const preIdentity = baselineSource.indexOf("-Phase 'pre-reset'")
    const capturedReset = baselineSource.indexOf("-Stage 'baseline-archived-reset'")
    const resetExit = baselineSource.indexOf("Assert-Cw2CaptureExitZero $resetCapture 'CONNECT_WORKFLOWS_CW2_BASELINE_RESET_FAILED'")
    const failedResetExit = failurePathSource.indexOf("Assert-Cw2CaptureExitZero $resetCapture 'CONNECT_WORKFLOWS_CW2_BASELINE_RESET_FAILED'")
    const failedPostIdentity = failurePathSource.indexOf("-Phase 'post-reset-failed'")
    const failedRecovery = failurePathSource.indexOf('Invoke-Cw2BaselineResetFailure -ResetFailed $true')
    const failedRethrow = recoverySource.indexOf('throw $PrimaryFailure')
    const recoveryAggregate = recoverySource.indexOf('CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_EVIDENCE_FAILED')
    const primaryAggregate = recoverySource.indexOf('PRIMARY_FAILURE:$($PrimaryFailure.ToString())', recoveryAggregate)
    const postIdentityAggregate = recoverySource.indexOf('POST_IDENTITY_FAILURE:$PostIdentityFailure', recoveryAggregate)
    const recoveryAggregateCause = recoverySource.indexOf('RECOVERY_FAILURE:$($_.Exception.ToString())', recoveryAggregate)
    const originalInnerException = recoverySource.indexOf(',$PrimaryFailure)', recoveryAggregate)
    const postIdentity = baselineSource.indexOf("-Phase 'post-reset'")
    const pass = baselineSource.indexOf("event='baseline_archived_reset_pass'")
    return diagnosticHarnessMarkers.every((marker) => source.includes(marker))
      && stdoutDrain >= 0 && stderrDrain >= 0 && stdoutDrain < wait && stderrDrain < wait
      && nativeStarted >= 0 && nativeStarted < processStartCall && processStartCall < nativeProcessStarted && nativeProcessStarted < wait
      && wait < nativeTimeout && nativeTimeout < nativeTimeoutFinalized && nativeTimeoutFinalized < nativeFinished
      && !/(Get-Content[\s\S]*\|\s*docker|2>&1|Out-String|\$LASTEXITCODE)/.test(launchSource)
      && !/(Get-Process|Stop-Process)/.test(processSource)
      && launchSource.includes('$dockerExe') && launchSource.includes('-StdinBytes $verifyBytes')
      && processSource.includes('$startInfo.WorkingDirectory = $resolvedWorkingDirectory')
      && captureExitSource.includes('${FailureCode}:cause=') && !captureExitSource.includes('$FailureCode:cause=')
      && source.includes("event='baseline_archived_stack_identity'") && source.includes("event='baseline_archived_migration_attestation'")
      && source.includes("event='baseline_archived_reset_recovery_required'") && source.includes("status='RECOVERY_REQUIRED'")
      && recoverySource.includes('$preStackIdentity = if ($null -eq $PreIdentity)')
      && recoverySource.includes('$postStackIdentity = if ($null -eq $PostIdentity)')
      && recoverySource.includes('$resetCause = if ($null -eq $Capture)')
      && recoverySource.includes("if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { throw 'CONNECT_WORKFLOWS_CW2_DURABLE_LOG_MISSING' }")
      && recoverySource.includes('$priorLineCount = @(Get-Content -LiteralPath $LogPath).Count')
      && recoverySource.includes('CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_RECORD_READBACK_FAILED')
      && recoverySource.includes('primary_failure=$primaryFailure') && recoverySource.includes('post_identity_failure=$postIdentityFailure')
      && recoverySource.includes('if (-not $ResetFailed) { return $true }')
      && recoverySource.includes('CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_EVIDENCE_FAILED')
      && recoveryAggregate >= 0 && primaryAggregate > recoveryAggregate && postIdentityAggregate > primaryAggregate && recoveryAggregateCause > postIdentityAggregate && originalInnerException > recoveryAggregateCause
      && !/=\s*\(if\s*\(/.test(recoverySource)
      && archiveAttestation >= 0 && preIdentity > archiveAttestation && capturedReset > preIdentity && resetExit > capturedReset
      && failurePathSource.indexOf("-Stage 'baseline-archived-reset'") >= 0 && failurePathSource.indexOf('try {') >= 0
      && resetCaptureSource.includes("-Stage 'baseline-archived-reset'") && resetCaptureSource.includes('--profile supabase db reset --local --no-seed --yes') && resetCaptureSource.includes('-TimeoutMilliseconds 300000') && resetCaptureSource.includes('-WorkingDirectory $resolvedTemp')
      && failedResetExit >= 0 && failedPostIdentity > failedResetExit && failedRecovery > failedPostIdentity && failedRethrow >= 0 && postIdentity > resetExit && pass > postIdentity
      && !/CLEAN_RELEASED|TOPOLOGY_RESTORED|RECOVERY_COMPLETE/.test(failurePathSource)
      && recoverySource.includes('CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_EVIDENCE_FAILED')
      && !baselineSource.includes('& $Supabase --profile supabase db reset --local --no-seed --yes')
      && resetOnlyEnd < source.indexOf("if (@(docker ps --format '{{.Names}}') -notcontains $db)", resetOnlyEnd)
      && resetOnlySource.includes('if ($BaselineResetOnly)') && resetOnlySource.includes('Assert-Cw2MigrationRollback $supabase $dockerExe $diagnosticLog')
      && resetOnlySource.includes("event='baseline_archived_reset_only_started'") && resetOnlySource.includes("event='baseline_archived_reset_only_pass'")
      && resetOnlySource.includes("Write-Output 'CONNECT_WORKFLOWS_CW2_BASELINE_RESET_ONLY_PASS'\n    return\n  }")
      && !/Enter-MapleSeasonCredential|Reset-Cw2|foreach|npx|playwright|database-assertions/.test(resetOnlySource)
  }
  assert(processStart >= 0 && processEnd > processStart && sqlLaunchStart >= 0 && sqlLaunchEnd > sqlLaunchStart && baselineResetStart >= 0 && baselineResetEnd > baselineResetStart, 'The CW-2 native process, SQL launch, and archived-reset boundaries must remain independently inspectable.')
  assert(completeDiagnosticHarness(disposableSource), 'The CW-2 diagnostic harness must preserve streams, exit, stage, timestamps, working directory, baseline reset identity, recovery evidence, and fail-closed marker handling.')
  const diagnosticHarnessMutations = [
    { name: 'pipeline SQL launch restored', from: '$verifyBytes = [IO.File]::ReadAllBytes($verify)', to: '$verifyBytes = Get-Content -Raw $verify | docker' },
    { name: 'stdin redirect removed', from: '$startInfo.RedirectStandardInput = $true', to: '$startInfo.RedirectStandardInput = $false' },
    { name: 'stdout concurrent drain removed', from: '$process.StandardOutput.BaseStream.CopyToAsync($stdoutStream)', to: 'CW2_REMOVED_STDOUT_DRAIN' },
    { name: 'stderr concurrent drain removed', from: '$process.StandardError.BaseStream.CopyToAsync($stderrStream)', to: 'CW2_REMOVED_STDERR_DRAIN' },
    { name: 'stdout write-through removed', from: '[IO.FileStream]::new($stdoutPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,[IO.FileOptions]::WriteThrough)', to: '[IO.File]::Open($stdoutPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)' },
    { name: 'stderr write-through removed', from: '[IO.FileStream]::new($stderrPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,1,[IO.FileOptions]::WriteThrough)', to: '[IO.File]::Open($stderrPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)' },
    { name: 'shared stream filenames introduced', from: '"cw2-$captureId.stderr.bin"', to: '"cw2-$captureId.stdout.bin"' },
    { name: 'native started evidence removed', from: "event='native_started'", to: "event='removed_started'" },
    { name: 'native finished evidence removed', from: "event='native_finished'", to: "event='removed_finished'" },
    { name: 'finally preference restore removed', from: '$ErrorActionPreference = $priorErrorActionPreference', to: 'CW2_REMOVED_EAP_RESTORE' },
    { name: 'console input encoding restore removed', from: '[Console]::InputEncoding = $priorConsoleInputEncoding', to: 'CW2_REMOVED_INPUT_ENCODING_RESTORE' },
    { name: 'nonzero exit accepted', from: '$Capture.NativeExitCode -ne 0', to: '$false' },
    { name: 'missing stdout marker accepted', from: '$Capture.StdoutText -cnotmatch $markerPattern', to: '$false' },
    { name: 'stderr marker anywhere accepted', from: '$stderrMarkerIndex -ge 0', to: '$false' },
    { name: 'case-insensitive stdout marker accepted', from: '$Capture.StdoutText -cnotmatch $markerPattern', to: '$Capture.StdoutText -notmatch $markerPattern' },
    { name: 'dual-stream executable denial removed', from: 'stdout-and-stderr-marker', to: 'CW2_REMOVED_DUAL_STREAM_CASE' },
    { name: 'embedded stderr marker denial removed', from: 'embedded-stderr-marker', to: 'CW2_REMOVED_EMBEDDED_STDERR_CASE' },
    { name: 'broad process kill introduced', from: '$process.Kill()', to: 'Get-Process docker | Stop-Process -Force' },
    { name: 'direct stdin byte write removed', from: '$process.StandardInput.BaseStream.Write($StdinBytes,0,$StdinBytes.Length)', to: 'CW2_REMOVED_STDIN_WRITE' },
    { name: 'timeout guard removed', from: '$process.WaitForExit($TimeoutMilliseconds)', to: '$true' },
    { name: 'evidence and native aggregate case removed', from: 'evidence-native-aggregate', to: 'CW2_REMOVED_AGGREGATE_CASE' },
    { name: 'host replay contract removed', from: 'Write-Cw2CaptureReplay $capture', to: '$capture.StdoutText' },
    { name: 'native process PID evidence removed', from: '$nativeProcessId = $process.Id', to: '$nativeProcessId = $null' },
    { name: 'native process started record removed', from: "event='native_process_started'", to: "event='removed_process_started'" },
    { name: 'native timeout record removed', from: "event='native_timeout'", to: "event='removed_native_timeout'" },
    { name: 'native timeout finalization record removed', from: "event='native_timeout_finalized'", to: "event='removed_timeout_finalized'" },
    { name: 'bounded native finalization wait removed', from: '$process.WaitForExit(5000)', to: '$true' },
    { name: 'durable PID finalization self-test removed', from: 'CONNECT_WORKFLOWS_CW2_SELFTEST_DURABLE_PID_FINALIZATION_RECORD_MISSING', to: 'CW2_REMOVED_PID_FINALIZATION_SELFTEST' },
    { name: 'captured process working directory removed', from: '$startInfo.WorkingDirectory = $resolvedWorkingDirectory', to: 'CW2_REMOVED_WORKING_DIRECTORY' },
    { name: 'working directory self-test removed', from: 'CONNECT_WORKFLOWS_CW2_SELFTEST_WORKING_DIRECTORY_NOT_APPLIED', to: 'CW2_REMOVED_WORKING_DIRECTORY_SELFTEST' },
    { name: 'archived reset capture removed', from: "-Stage 'baseline-archived-reset'", to: "-Stage 'CW2_REMOVED_BASELINE_RESET_CAPTURE'" },
    { name: 'archived reset exact argv changed', from: "--profile supabase db reset --local --no-seed --yes", to: "--profile supabase db reset --local --yes" },
    { name: 'archived reset cwd removed', from: "$resetCapture = Invoke-Cw2CapturedProcess -Stage 'baseline-archived-reset' -LogPath $LogPath -Executable $Supabase -Arguments '--profile supabase db reset --local --no-seed --yes' -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 300000 -DrainTimeoutMilliseconds 30000 -WorkingDirectory $resolvedTemp", to: "$resetCapture = Invoke-Cw2CapturedProcess -Stage 'baseline-archived-reset' -LogPath $LogPath -Executable $Supabase -Arguments '--profile supabase db reset --local --no-seed --yes' -StdinBytes ([byte[]]@()) -TimeoutMilliseconds 300000 -DrainTimeoutMilliseconds 30000 -WorkingDirectory ''" },
    { name: 'archived reset exit guard removed', from: "Assert-Cw2CaptureExitZero $resetCapture 'CONNECT_WORKFLOWS_CW2_BASELINE_RESET_FAILED'", to: '$true' },
    { name: 'baseline pre identity removed', from: "-Phase 'pre-reset'", to: "-Phase 'CW2_REMOVED_PRE_RESET_IDENTITY'" },
    { name: 'baseline failed post identity removed', from: "-Phase 'post-reset-failed'", to: "-Phase 'CW2_REMOVED_FAILED_POST_RESET_IDENTITY'" },
    { name: 'baseline recovery required removed', from: "event='baseline_archived_reset_recovery_required'", to: "event='CW2_REMOVED_RECOVERY_REQUIRED'" },
    { name: 'baseline post identity removed', from: "-Phase 'post-reset'", to: "-Phase 'CW2_REMOVED_POST_RESET_IDENTITY'" },
    { name: 'baseline pass marker removed', from: "event='baseline_archived_reset_pass'", to: "event='CW2_REMOVED_BASELINE_RESET_PASS'" },
    { name: 'failed reset recovery invocation removed', from: 'Invoke-Cw2BaselineResetFailure -ResetFailed $true', to: "Write-Output 'CW2_REMOVED_FAILED_RESET_RECOVERY'" },
    { name: 'failed reset recovery moved before post identity', from: "try { $postIdentity = Get-Cw2BaselineStackIdentity -Phase 'post-reset-failed'", to: "try { Invoke-Cw2BaselineResetFailure -ResetFailed $true; $postIdentity = Get-Cw2BaselineStackIdentity -Phase 'post-reset-failed'" },
    { name: 'failed reset false clean release claim added', from: '$primaryFailure = $_.Exception', to: "$primaryFailure = $_.Exception; Write-Output 'CLEAN_RELEASED'" },
    { name: 'failed reset primary recovery aggregation removed', from: 'CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_EVIDENCE_FAILED', to: 'CW2_REMOVED_BASELINE_RECOVERY_AGGREGATION' },
    { name: 'baseline reset-only mode omitted', from: 'if ($BaselineResetOnly)', to: 'if ($false)' },
    { name: 'baseline reset-only reset omitted', from: 'Assert-Cw2MigrationRollback $supabase $dockerExe $diagnosticLog', to: 'CW2_REMOVED_BASELINE_RESET_ONLY_PROBE' },
    { name: 'baseline reset-only pass marker removed', from: "event='baseline_archived_reset_only_pass'", to: "event='CW2_REMOVED_BASELINE_RESET_ONLY_PASS'" },
    { name: 'baseline reset-only continuation allowed', from: "Write-Output 'CONNECT_WORKFLOWS_CW2_BASELINE_RESET_ONLY_PASS'\n    return", to: "Write-Output 'CONNECT_WORKFLOWS_CW2_BASELINE_RESET_ONLY_PASS'\n    Write-Output 'CW2_BASELINE_RESET_ONLY_CONTINUED'" },
    { name: 'baseline recovery inline command-position if restored', from: '$preStackIdentity = if ($null -eq $PreIdentity)', to: '$preStackIdentity = (if($null -eq $PreIdentity)' },
    { name: 'baseline recovery durable readback removed', from: 'CONNECT_WORKFLOWS_CW2_BASELINE_RECOVERY_RECORD_READBACK_FAILED', to: 'CW2_REMOVED_BASELINE_RECOVERY_READBACK' },
    { name: 'baseline recovery primary cause omitted', from: 'primary_failure=$primaryFailure', to: 'primary_failure=$null' },
    { name: 'baseline recovery post identity cause omitted', from: 'post_identity_failure=$postIdentityFailure', to: 'post_identity_failure=$null' },
    { name: 'baseline recovery helper log guard removed', from: "if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { throw 'CONNECT_WORKFLOWS_CW2_DURABLE_LOG_MISSING' }", to: 'if ($false) { throw \'CW2_REMOVED_BASELINE_RECOVERY_LOG_GUARD\' }' },
    { name: 'baseline recovery helper failure simulation removed', from: 'SELFTEST_RECOVERY_WRITE_FAILURE', to: 'CW2_REMOVED_RECOVERY_WRITE_FAILURE_SELFTEST' },
    { name: 'baseline reset success false recovery guard removed', from: 'CONNECT_WORKFLOWS_CW2_SELFTEST_FALSE_RECOVERY_RECORD_ON_SUCCESS', to: 'CW2_REMOVED_FALSE_RECOVERY_SUCCESS_GUARD' },
    { name: 'baseline reset failure code interpolation masked', from: '${FailureCode}:cause=', to: 'CW2_REMOVED_FAILURE_CODE_INTERPOLATION' },
    { name: 'baseline recovery aggregation order inverted', from: 'PRIMARY_FAILURE:$($PrimaryFailure.ToString())`nPOST_IDENTITY_FAILURE:$PostIdentityFailure`nRECOVERY_FAILURE:$($_.Exception.ToString())', to: 'RECOVERY_FAILURE:$($_.Exception.ToString())`nPRIMARY_FAILURE:$($PrimaryFailure.ToString())`nPOST_IDENTITY_FAILURE:$PostIdentityFailure' },
    { name: 'baseline recovery post identity ordering removed', from: 'POST_IDENTITY_FAILURE:$PostIdentityFailure`n', to: '' },
    { name: 'baseline recovery original inner exception removed', from: 'RECOVERY_FAILURE:$($_.Exception.ToString())",$PrimaryFailure)', to: 'RECOVERY_FAILURE:$($_.Exception.ToString())",$null)' },
  ]
  assert(diagnosticHarnessMutations.length === 58, 'The CW-2 diagnostic harness mutation block is incomplete.')
  for (const mutation of diagnosticHarnessMutations) {
    const mutated = mutation.name === 'baseline reset failure code interpolation masked'
      ? disposableSource.replace(mutation.from, mutation.to)
      : disposableSource.replaceAll(mutation.from, mutation.to)
    assert(mutated !== disposableSource && !completeDiagnosticHarness(mutated), `The ${mutation.name} mutation must turn the diagnostic contract red.`)
  }
  const fixtureProofSource = readFileSync(new URL('../../tests/season/connect-workflows-cw2.fixture.sql', import.meta.url), 'utf8')
  const sqlProofSource = readFileSync(new URL('../../tests/season/connect-workflows-cw2.verify.sql', import.meta.url), 'utf8')
  const concurrencyFixtureProofBytes = readFileSync(new URL('../../tests/season/connect-workflows-cw2.concurrency-fixture.sql', import.meta.url))
  const concurrencyFixtureProofSource = concurrencyFixtureProofBytes.toString('utf8')
  const concurrencyFixtureProofSha256 = createHash('sha256').update(concurrencyFixtureProofBytes).digest('hex')
  const concurrencyProofBytes = readFileSync(new URL('../../tests/season/connect-workflows-cw2.concurrency.sql', import.meta.url))
  const concurrencyProofSource = concurrencyProofBytes.toString('utf8')
  const concurrencyProofSha256 = createHash('sha256').update(concurrencyProofBytes).digest('hex')
  const exactSpan = (source: string, start: string, end: string) => { const first = source.indexOf(start); const last = source.indexOf(end); return first >= 0 && last > first && source.indexOf(start, first + 1) < 0 && source.indexOf(end, last + 1) < 0 ? source.slice(first, last + end.length) : '' }
  const replaceInExactSpan = (source: string, start: string, end: string, old: string, replacement: string) => { const span = exactSpan(source, start, end); assert(span && span.split(old).length - 1 === 1, `Credential mutation target ${old} must occur once in its executable span.`); return source.replace(span, span.replace(old, replacement)) }
  const baseSpanMarkers = ['# CW2-CREDENTIAL-HANDOFF native base verify begin.', '# CW2-CREDENTIAL-HANDOFF native base verify end.'] as const
  const fixtureSpanMarkers = ['# CW2-CREDENTIAL-HANDOFF native fixture verify begin.', '# CW2-CREDENTIAL-HANDOFF native fixture verify end.'] as const
  const adminSpanMarkers = ['# CW2-CREDENTIAL-HANDOFF native verify begin.', '# CW2-CREDENTIAL-HANDOFF native verify end.'] as const
  const concurrencyMarkers = [
    '-- CW2-CREDENTIAL-HANDOFF concurrency boundary begin.', "if current_user <> 'supabase_admin'", "or session_user <> 'supabase_admin'",
    "or current_database() <> 'postgres'", 'or inet_client_addr() is not null', 'CONNECT_WORKFLOWS_CW2_LOCAL_SUPABASE_ADMIN_BOUNDARY_PASS',
    "dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000'' application_name=cw2_catalog_apply",
    "dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000 -clock_timeout=500'' application_name=cw2_catalog_writer",
    "raise exception 'CW2 catalog apply session did not enter the exact authenticated local boundary'",
    'create temporary table cw2_catalog_apply_backend(pid integer primary key)', "select pid from dblink('cw2_catalog_apply','select pg_backend_pid()') as apply_backend(pid integer)",
    "select dblink_exec('cw2_catalog_writer','begin');", "set local lock_timeout='500ms';", "or current_setting('lock_timeout',true) <> '500ms'",
    "raise exception 'CW2 catalog writer session did not enter the exact authenticated local boundary'",
    'select pg_advisory_lock(25000,2)',
    'from pg_catalog.pg_locks waiting', 'join cw2_catalog_apply_backend apply_backend on apply_backend.pid=waiting.pid', "waiting.locktype='advisory'", 'waiting.database=(select oid from pg_catalog.pg_database where datname=current_database())',
    'waiting.objsubid=2', "waiting.mode='ExclusiveLock'", 'not waiting.granted',
    'from pg_catalog.pg_locks held', 'held.pid=pg_backend_pid()', 'held.locktype=waiting.locktype', 'held.database=waiting.database',
    'held.classid=waiting.classid', 'held.objid=waiting.objid', 'held.objsubid=waiting.objsubid', 'held.mode=waiting.mode', 'held.granted', 'for i in 1..100 loop',
    'CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_BEGIN', 'CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_PASS', 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_WAIT_BEGIN',
    "set local statement_timeout='10000ms';", 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_BEGIN', 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVE_STAGE_BEGIN',
    'cw2_catalog_apply_recovery_state', 'cw2_catalog_apply_recovery_stages', 'CW2R0', 'APPLY_READINESS_NOT_OBSERVED', 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVE_STAGE_END',
    'CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_STAGE_BEGIN', 'CW2 cancel stage did not retain exact five-second timeout', 'select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled', 'CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_STAGE_END',
    'CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_STAGE_BEGIN', 'select pg_advisory_unlock(25000,2) into v_unlocked', 'CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_STAGE_END',
    'CONNECT_WORKFLOWS_CW2_APPLY_BUSY_STAGE_BEGIN', "for i in 1..100 loop select dblink_is_busy('cw2_catalog_apply') into v_busy;", 'exit when v_busy=0;', 'CONNECT_WORKFLOWS_CW2_APPLY_BUSY_STAGE_END',
    'CONNECT_WORKFLOWS_CW2_APPLY_TERMINATE_STAGE_BEGIN', 'select pg_terminate_backend(pid,5000) from cw2_catalog_apply_backend into v_terminated', 'pg_stat_activity where pid=(select apply_pid from cw2_catalog_apply_recovery_state)', 'CONNECT_WORKFLOWS_CW2_APPLY_TERMINATE_STAGE_END',
    'CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_BEGIN', "CW2 catalog apply was still busy before result drain", "dblink_get_result('cw2_catalog_apply',false) as cleanup_primary", "dblink_get_result('cw2_catalog_apply',false) as cleanup_terminal", 'CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_END',
    'CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_STAGE_BEGIN', "select dblink_disconnect('cw2_catalog_apply') into v_disconnect", 'connection_absent', 'CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_STAGE_END',
    'CONNECT_WORKFLOWS_CW2_APPLY_WRITER_ROLLBACK_STAGE_BEGIN', "select dblink_exec('cw2_catalog_writer','rollback') into v_rollback", 'CONNECT_WORKFLOWS_CW2_APPLY_WRITER_ROLLBACK_STAGE_END',
    'CONNECT_WORKFLOWS_CW2_APPLY_WRITER_DISCONNECT_STAGE_BEGIN', "select dblink_disconnect('cw2_catalog_writer') into v_disconnect", 'CONNECT_WORKFLOWS_CW2_APPLY_WRITER_DISCONNECT_STAGE_END',
    'CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_BEGIN', 'CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_STAGE:', 'CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_END', "raise exception 'CW2 catalog apply readiness recovery required: %'",
    'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_PASS', "raise exception 'CW2 catalog writer action did not activate the exact transaction-local timeout'", 'CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS',
    "select dblink_send_query('cw2_catalog_writer'", "select dblink_is_busy('cw2_catalog_writer')=0 into v_done",
    "perform dblink_cancel_query('cw2_catalog_writer')", "raise exception 'CW2 catalog writer did not finish inside the exact asynchronous wait bound'",
    "select status from dblink_get_result('cw2_catalog_writer') as setup(status text);",
    "select status from dblink_get_result('cw2_catalog_writer') as attestation(status text);",
    'result_count integer check(result_count=0)',
    "select count(status) from dblink_get_result('cw2_catalog_writer',false) as failed_action(status text);",
    "update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');",
    "(select status from cw2_catalog_writer_setup_result) <> 'SET'",
    "(select status from cw2_catalog_writer_attestation_result) <> 'DO'",
    '(select result_count from cw2_catalog_writer_result) <> 0',
    '(select message from cw2_catalog_writer_result) is null',
    'writer_terminal_results integer check(writer_terminal_results=0)',
    "select count(*) from dblink_get_result('cw2_catalog_writer') as terminal(status text);", 'CONNECT_WORKFLOWS_CW2_WRITER_ASYNC_RESULT_DRAIN_PASS',
    'CONNECT_WORKFLOWS_CW2_WRITER_LOCK_TIMEOUT_PASS', 'CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS', 'CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN',
    "rolname='authenticated' and not rolsuper and not rolbypassrls", 'terminal_results integer check(terminal_results=0)',
    "select count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);",
    'CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_DRAIN_PASS', "select dblink_disconnect('cw2_catalog_apply');",
    "select dblink_disconnect('cw2_catalog_writer');", "!~ '^ERROR:  canceling statement due to lock timeout'", "<> 'UPDATE 1'",
    "raise exception 'CW2 concurrent catalog proof did not preserve one exact no-record draw'", 'CONNECT_WORKFLOWS_CW2_SQL_PASS',
  ]
  const completeCredentialHandoff = (runner: string, baseSql: string, concurrencyFixtureSql: string, concurrencySql: string, migrationProofSource: string) => {
    const baseSpan = exactSpan(runner, ...baseSpanMarkers); const fixtureSpan = exactSpan(runner, ...fixtureSpanMarkers); const adminSpan = exactSpan(runner, ...adminSpanMarkers)
    const postCatalogStaticGuardSpan = exactSpan(runner, '# CW2_POST_CATALOG_STATIC_GUARD_BEGIN', '# CW2_POST_CATALOG_STATIC_GUARD_END')
    const outerBody = concurrencySql.match(/do \$cw2_outer_boundary\$([\s\S]*?)\$cw2_outer_boundary\$;/)?.[1] ?? ''
    const fixturePin = runner.match(/\$concurrencyFixtureVerifySha256 = '([0-9a-f]{64})'/)?.[1] ?? ''
    const concurrencyPin = runner.match(/\$concurrencyVerifySha256 = '([0-9a-f]{64})'/)?.[1] ?? ''
    const clockPhaseCallIndex = runner.indexOf('$clockResult=@(Invoke-HarvestRidgeClockPhase')
    const clockPhaseGuard = 'if ($clockResult[-1] -ne $true) { throw "CONNECT_WORKFLOWS_CW2_CLOCK_PHASE_FAILED:$viewport" }'
    const clockPhaseGuardIndex = runner.indexOf(clockPhaseGuard, clockPhaseCallIndex)
    const ordinaryClockNativeIndex = runner.indexOf('# CW2-CREDENTIAL-HANDOFF native verify begin.', clockPhaseGuardIndex)
    const fixtureTransactionIndex = concurrencyFixtureSql.indexOf("begin;\nselect set_config('request.jwt.claims'")
    const fixtureBoundaryIndex = concurrencyFixtureSql.indexOf('do $cw2_fixture_boundary$')
    const fixturePassIndex = concurrencyFixtureSql.indexOf('insert into public.assigned_program_passes (')
    const fixtureProductIndex = concurrencyFixtureSql.indexOf('insert into public.assigned_program_pass_products (')
    const fixtureCommitIndex = concurrencyFixtureSql.indexOf('commit;', fixtureProductIndex)
    const fixtureProbeKey = 'perform pg_catalog.pg_advisory_xact_lock(25000,2);'
    const fixtureProbeIndex = concurrencyFixtureSql.indexOf(fixtureProbeKey)
    const fixtureProbeTrigger = 'create trigger cw2_catalog_probe_pause before update on public.assigned_program_pass_products'
    const requestSerializationLock = 'perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text));'
    const catalogTrigger = 'create trigger inventory_products_catalog_lock'
    const catalogLock = "pg_catalog.hashtext('inventory-products-catalog')"
    const assignedProductUpdate = 'update public.assigned_program_pass_products assigned_product'
    const requestLockIndex = migrationProofSource.indexOf(requestSerializationLock)
    const catalogTriggerIndex = migrationProofSource.indexOf(catalogTrigger)
    const catalogLockIndex = migrationProofSource.indexOf(catalogLock, requestLockIndex)
    const assignedProductUpdateIndex = migrationProofSource.indexOf(assignedProductUpdate)
    const writerTransactionBoundary = "select dblink_exec('cw2_catalog_writer','begin');\nselect dblink_exec('cw2_catalog_writer',$remote$\nset role authenticated;"
    const releasedWriterBoundary = "select dblink_exec('cw2_catalog_writer','begin');\ncreate temporary table cw2_catalog_writer_released(status text);\ninsert into cw2_catalog_writer_released\nselect dblink_exec('cw2_catalog_writer',$remote$\nset role authenticated;"
    const primaryApplyResult = "insert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);"
    const terminalApplyDrain = "select count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);"
    const writerSetupResult = "select status from dblink_get_result('cw2_catalog_writer') as setup(status text);"
    const writerAttestationResult = "select status from dblink_get_result('cw2_catalog_writer') as attestation(status text);"
    const primaryWriterResult = "select count(status) from dblink_get_result('cw2_catalog_writer',false) as failed_action(status text);"
    const terminalWriterDrain = "select count(*) from dblink_get_result('cw2_catalog_writer') as terminal(status text);"
    const writerMessageCapture = "update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');"
    const writerNullMessageDenial = 'or (select message from cw2_catalog_writer_result) is null'
    const primaryApplyResultIndex = concurrencySql.indexOf(primaryApplyResult)
    const terminalApplyDrainIndex = concurrencySql.indexOf(terminalApplyDrain)
    const writerSetupResultIndex = concurrencySql.indexOf(writerSetupResult)
    const writerAttestationResultIndex = concurrencySql.indexOf(writerAttestationResult)
    const primaryWriterResultIndex = concurrencySql.indexOf(primaryWriterResult)
    const terminalWriterDrainIndex = concurrencySql.indexOf(terminalWriterDrain)
    const writerMessageCaptureIndex = concurrencySql.indexOf(writerMessageCapture)
    const writerNullMessageDenialIndex = concurrencySql.indexOf(writerNullMessageDenial)
    const releasedWriterIndex = concurrencySql.indexOf(releasedWriterBoundary)
    const applyDisconnectIndex = concurrencySql.indexOf("select dblink_disconnect('cw2_catalog_apply');")
    const applyPidCaptureIndex = concurrencySql.indexOf("select pid from dblink('cw2_catalog_apply','select pg_backend_pid()') as apply_backend(pid integer);")
    const applySendIndex = concurrencySql.indexOf("select dblink_send_query('cw2_catalog_apply'")
    const readinessServerBoundBeginIndex = concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_BEGIN')
    const readinessStatementTimeoutIndex = concurrencySql.indexOf("set local statement_timeout='10000ms';")
    const readinessDoIndex = concurrencySql.indexOf('do $wait$')
    const readinessServerBoundPassIndex = concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_PASS')
    const liveWaitIndex = concurrencySql.indexOf('join cw2_catalog_apply_backend apply_backend on apply_backend.pid=waiting.pid')
    const readinessMarkerIndex = concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS')
    const writerSendIndex = concurrencySql.indexOf("select dblink_send_query('cw2_catalog_writer'")
    const cleanupCancelIndex = concurrencySql.indexOf('select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;')
    const cleanupUnlockIndex = concurrencySql.indexOf('select pg_advisory_unlock(25000,2) into v_unlocked;')
    const cleanupBusyPollIndex = concurrencySql.indexOf("select dblink_is_busy('cw2_catalog_apply') into v_busy;")
    const cleanupBusyClearIndex = concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_APPLY_BUSY_STAGE_END')
    const cleanupDrainBeginIndex = concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_BEGIN')
    const cleanupPrimaryIndex = concurrencySql.indexOf("dblink_get_result('cw2_catalog_apply',false) as cleanup_primary")
    const cleanupTerminalIndex = concurrencySql.indexOf("dblink_get_result('cw2_catalog_apply',false) as cleanup_terminal")
    const cleanupDrainPassIndex = concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_END')
    const cleanupDisconnectIndex = concurrencySql.indexOf("select dblink_disconnect('cw2_catalog_apply') into v_disconnect;")
    const cleanupWriterRollbackIndex = concurrencySql.lastIndexOf("select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;")
    const cleanupWriterDisconnectIndex = concurrencySql.lastIndexOf("select dblink_disconnect('cw2_catalog_writer') into v_disconnect;")
    const cleanupFailureIndex = concurrencySql.indexOf("raise exception 'CW2 catalog apply readiness recovery required: %',coalesce(v_failures,'UNKNOWN_RECOVERY_FAILURE');")
    const timeoutTerminateIndex = concurrencySql.indexOf('select pg_terminate_backend(pid,5000)')
    const timeoutWriterRollbackIndex = concurrencySql.indexOf("select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;")
    const timeoutWriterDisconnectIndex = concurrencySql.indexOf("select dblink_disconnect('cw2_catalog_writer') into v_disconnect;")
    const timeoutDisconnectMarkerIndex = concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_APPLY_WRITER_CLEANUP_STAGE_END')
    const normalUnlockIndex = concurrencySql.indexOf('select pg_advisory_unlock(25000,2);')
    const liveLockIdentity = [
      'from pg_catalog.pg_locks waiting',
      '        join cw2_catalog_apply_backend apply_backend on apply_backend.pid=waiting.pid',
      "        where waiting.locktype='advisory'",
      '          and waiting.database=(select oid from pg_catalog.pg_database where datname=current_database())',
      '          and waiting.objsubid=2', "          and waiting.mode='ExclusiveLock'", '          and not waiting.granted',
      '          and exists(', '            select 1', '            from pg_catalog.pg_locks held', '            where held.pid=pg_backend_pid()', '              and held.locktype=waiting.locktype',
      '              and held.database=waiting.database', '              and held.classid=waiting.classid', '              and held.objid=waiting.objid', '              and held.objsubid=waiting.objsubid', "              and held.mode=waiting.mode", '              and held.granted',
    ].join('\n')
    const initialWriterSpan = exactSpan(concurrencySql, writerTransactionBoundary, "select dblink_send_query('cw2_catalog_apply'")
    const writerActionSpan = exactSpan(concurrencySql, "select dblink_send_query('cw2_catalog_writer',$remote$", "or (select message from cw2_catalog_writer_result) !~ '^ERROR:  canceling statement due to lock timeout'")
    const releasedWriterSpan = exactSpan(concurrencySql, releasedWriterBoundary, "select dblink_disconnect('cw2_catalog_apply');")
    const exactWriterBoundary = (span: string) => [
      'set role authenticated;',
      'set "request.jwt.claims"=\'{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}\';',
      'set "request.jwt.claim.sub"=\'27000000-0000-4000-8000-000000000001\';',
      'set "request.headers"=\'{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\\"27010000-0000-4000-8000-000000000005\\":1}"}\';',
      "set local lock_timeout='500ms';",
      "if current_user <> 'authenticated'",
      "or session_user <> 'supabase_admin'",
      "or current_database() <> 'postgres'",
      'or inet_client_addr() is not null',
      "not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated' and not rolsuper and not rolbypassrls)",
      "or current_setting('lock_timeout',true) <> '500ms'",
      "raise exception 'CW2 catalog writer session did not enter the exact authenticated local boundary'",
    ].every((marker) => span.split(marker).length - 1 === 1)
    const exactWriterActionTimeout = [
      "set local lock_timeout='500ms';",
      "if current_setting('lock_timeout',true) <> '500ms' then",
      "raise exception 'CW2 catalog writer action did not activate the exact transaction-local timeout'",
      'update public.inventory_products set name=name',
    ].every((marker) => writerActionSpan.split(marker).length - 1 === 1)
    const recoveryStages = ['readiness-observe', 'cancel-apply', 'unlock-advisory', 'busy-poll', 'terminate-apply', 'drain-apply', 'disconnect-apply', 'rollback-writer', 'disconnect-writer']
    const recoveryRecordIndex = concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_BEGIN')
    const recoveryRecordEndIndex = concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_END')
    const recoveryRecordQuery = "from cw2_catalog_apply_recovery_stages\norder by stage_order;"
    const recoveryRecordQueryIndex = concurrencySql.indexOf(recoveryRecordQuery)
    const recoveryFinalIndex = concurrencySql.indexOf("raise exception 'CW2 catalog apply readiness recovery required: %',coalesce(v_failures,'UNKNOWN_RECOVERY_FAILURE');")
    const readinessRecord = "insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('readiness-observe',1,clock_timestamp(),current_setting('statement_timeout',true));"
    const readinessRecordIndex = concurrencySql.indexOf(readinessRecord)
    const readinessStartIndex = concurrencySql.indexOf('do $wait$')
    const readinessEndIndex = concurrencySql.indexOf('$wait$;', readinessStartIndex)
    const readinessSpan = readinessStartIndex >= 0 && readinessEndIndex > readinessStartIndex
      ? concurrencySql.slice(readinessStartIndex, readinessEndIndex + '$wait$;'.length)
      : ''
    const readinessBoundIndex = readinessSpan.indexOf("current_setting('statement_timeout',true) <> '10s'")
    const readinessActionIndex = readinessSpan.indexOf('for i in 1..100 loop', readinessBoundIndex)
    const readinessCatch = "exception when query_canceled or others then\n  get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;\n  update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='readiness-observe';"
    const readinessStageOrdering = readinessRecordIndex >= 0 && readinessRecordIndex < readinessStartIndex
      && concurrencySql.split(readinessRecord).length - 1 === 1
      && readinessBoundIndex >= 0 && readinessActionIndex > readinessBoundIndex
      && readinessSpan.indexOf(readinessCatch, readinessActionIndex) > readinessActionIndex
    const boundedStageActions = [
      ['cancel-apply', 'do $cancel$', '$cancel$;', 'select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;', 2],
      ['unlock-advisory', 'do $unlock$', '$unlock$;', 'select pg_advisory_unlock(25000,2) into v_unlocked;', 3],
      ['busy-poll', 'do $busy$', '$busy$;', "for i in 1..100 loop select dblink_is_busy('cw2_catalog_apply') into v_busy;", 4],
      ['terminate-apply', 'do $terminate$', '$terminate$;', 'select pg_terminate_backend(pid,5000) from cw2_catalog_apply_backend into v_terminated;', 5],
      ['drain-apply', 'do $drain$', '$drain$;', "dblink_get_result('cw2_catalog_apply',false) as cleanup_primary", 6],
      ['disconnect-apply', 'do $disconnect$', '$disconnect$;', "select dblink_disconnect('cw2_catalog_apply') into v_disconnect;", 7],
      ['rollback-writer', 'do $writer_rollback$', '$writer_rollback$;', "select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;", 8],
      ['disconnect-writer', 'do $writer_disconnect$', '$writer_disconnect$;', "select dblink_disconnect('cw2_catalog_writer') into v_disconnect;", 9],
    ] as const
    const boundedStageOrdering = boundedStageActions.every(([stage, start, end, action, order]) => {
      const startIndex = concurrencySql.indexOf(start)
      const endIndex = concurrencySql.indexOf(end, startIndex)
      if (startIndex < 0 || endIndex <= startIndex) return false
      const stageSql = concurrencySql.slice(startIndex, endIndex + end.length)
      const recordIndex = stageSql.indexOf(`values ('${stage}',${order},clock_timestamp(),current_setting('statement_timeout',true))`)
      const boundIndex = stageSql.indexOf("current_setting('statement_timeout',true) <> '5s'", recordIndex)
      const actionIndex = stageSql.indexOf(action, boundIndex)
      const exactCatch = `exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='${stage}'; end;`
      return recordIndex >= 0 && boundIndex > recordIndex && actionIndex > boundIndex
        && stageSql.includes("begin\n    if current_setting('statement_timeout',true) <> '5s' then raise exception")
        && stageSql.indexOf(exactCatch) > actionIndex
    })
    const stagedRecoveryContract = recoveryStages.every((stage, index) => concurrencySql.split(`values ('${stage}',${index + 1},clock_timestamp(),current_setting('statement_timeout',true))`).length - 1 === 1)
      && ['CW2R0', 'APPLY_READINESS_NOT_OBSERVED', 'succeeded=v_ready', "current_setting('statement_timeout',true) <> '10s'", "current_setting('statement_timeout',true) <> '5s'", 'get stacked diagnostics', 'CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_STAGE:', 'string_agg(stage||', 'where succeeded is not true', 'order by stage_order', 'apply_pid from cw2_catalog_apply_recovery_state', "if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then raise exception 'CW2 catalog apply was still busy before result drain'; end if;"].every((marker) => concurrencySql.includes(marker))
      && concurrencySql.split("set local statement_timeout='5000ms';").length - 1 === 8
      && concurrencySql.split("current_setting('statement_timeout',true) <> '5s'").length - 1 === 8
      && (concurrencySql.match(/exception when query_canceled or others then/g) ?? []).length === 9
      && (concurrencySql.match(/get stacked diagnostics/g) ?? []).length === 9
      && !/when\s+others\s+then\s+null/i.test(concurrencySql)
      && concurrencySql.split('do $writer_rollback$').length - 1 === 1 && concurrencySql.split('do $writer_disconnect$').length - 1 === 1
      && concurrencySql.split('select not exists(select 1 from pg_catalog.pg_stat_activity where pid=(select apply_pid from cw2_catalog_apply_recovery_state)) into strict v_terminated;').length - 1 === 1
      && concurrencySql.split('pg_stat_activity').length - 1 === 1
      && readinessStageOrdering && boundedStageOrdering && recoveryRecordIndex >= 0 && recoveryRecordIndex < recoveryRecordQueryIndex && recoveryRecordQueryIndex < recoveryRecordEndIndex && recoveryRecordEndIndex < recoveryFinalIndex
    return baseSpan.includes('$baseDockerArguments = "exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off"')
    && baseSpan.includes("Assert-Cw2CaptureSuccess $baseCapture 'CONNECT_WORKFLOWS_CW2_BASE_SQL_PASS'")
    && fixtureSpan.includes('$fixtureDockerArguments = "exec -i $db psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off"')
    && fixtureSpan.includes("Assert-Cw2CaptureSuccess $fixtureCapture 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_PASS'")
    && clockPhaseCallIndex >= 0 && clockPhaseGuardIndex > clockPhaseCallIndex && ordinaryClockNativeIndex > clockPhaseGuardIndex
    && adminSpan.includes('$safeDockerArguments = "exec -i $db psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -P pager=off"')
    && adminSpan.includes('Invoke-Cw2CapturedProcess -Stage "${viewport}:ordinary-clock:concurrency"')
    && adminSpan.includes("Assert-Cw2CaptureSuccess $capture 'CONNECT_WORKFLOWS_CW2_SQL_PASS'")
    && fixturePin === createHash('sha256').update(Buffer.from(concurrencyFixtureSql, 'utf8')).digest('hex')
    && concurrencyPin === createHash('sha256').update(Buffer.from(concurrencySql, 'utf8')).digest('hex')
    && runner.includes('CONNECT_WORKFLOWS_CW2_CREDENTIAL_HANDOFF_STATIC_PASS count=181')
    && runner.includes('function Test-Cw2ApplyRecoveryStaticContract')
    && ['function ConvertTo-Cw2RecursivePostgresTokens', 'function Get-Cw2CredentialCallNames', 'function Test-Cw2CredentialExactCalls', 'function Test-Cw2CredentialNoDynamicControls', 'function Test-Cw2CredentialQuotedIdentifiers', 'function Test-Cw2CredentialNoOpaqueProceduralBodies', 'function Test-Cw2CredentialExactTokenShape', 'function Test-Cw2CredentialExactExecutableShapes', '$expectedShapes.Count -ne 6', "@('execute','format','set_config')", "@('public.mark_program_pass_applied')", "@('update','public','.','inventory_products') 1", 'unicode-quoted-identifier', 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_SQL_BYTES_CHANGED', 'outer dynamic admin write injected', 'worker dynamic role elevation injected', 'extra apply rpc injected', 'extra writer rpc injected', 'unicode quoted role elevation injected', 'unicode quoted set config injected', 'ordinary quoted rpc injected', 'single string do body injected', 'escape string do body injected', 'outer alter role createdb injected', 'outer grant truncate injected', 'worker truncate injected', 'worker create injected', 'worker drop injected', 'worker copy injected'].every((marker) => runner.includes(marker))
    && baseSql.includes('CONNECT_WORKFLOWS_CW2_BASE_SQL_PASS') && !baseSql.includes('CW2-CREDENTIAL-HANDOFF')
    && ["select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);", '"x-farm-rx-access-epochs":"{\\"27010000-0000-4000-8000-000000000005\\":1}"', "if current_user <> 'postgres'", "or auth.uid() <> '27000000-0000-4000-8000-000000000001'", 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_BOUNDARY_PASS', 'insert into public.assigned_program_passes (', 'insert into public.assigned_program_pass_products (', 'create function public.cw2_catalog_probe_pause()', fixtureProbeKey, fixtureProbeTrigger, 'CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_PASS'].every((marker) => concurrencyFixtureSql.includes(marker))
    && fixtureTransactionIndex >= 0 && fixtureTransactionIndex < fixtureBoundaryIndex && fixtureBoundaryIndex < fixturePassIndex && fixturePassIndex < fixtureProductIndex && fixtureProductIndex < fixtureCommitIndex && fixtureProbeIndex > fixtureCommitIndex
    && concurrencyFixtureSql.split(fixtureProbeTrigger).length - 1 === 1
    && requestLockIndex >= 0 && catalogTriggerIndex >= 0 && requestLockIndex < catalogLockIndex && catalogLockIndex < assignedProductUpdateIndex
    && postCatalogStaticGuardSpan.includes('$cw2CatalogTriggerFunctionIndex -lt 0')
    && postCatalogStaticGuardSpan.includes('$cw2CatalogTriggerIndex -le $cw2CatalogTriggerFunctionIndex')
    && postCatalogStaticGuardSpan.includes('$cw2AssignedProductUpdateIndex -le $cw2CatalogLockIndex')
    && !/\bset\s+(?:local\s+)?role\b|service_role|session_replication_role/i.test(concurrencyFixtureSql)
    && concurrencyMarkers.every((marker) => concurrencySql.includes(marker))
    && concurrencySql.split(writerTransactionBoundary).length - 1 === 1
    && concurrencySql.split(releasedWriterBoundary).length - 1 === 1
    && concurrencySql.split("select dblink_exec('cw2_catalog_writer','begin');").length - 1 === 2
    && concurrencySql.split('set role authenticated;').length - 1 === 7
    && concurrencySql.split("set local lock_timeout='500ms';").length - 1 === 7
    && concurrencySql.split("set local statement_timeout='10000ms';").length - 1 === 1
    && (concurrencySql.match(/dblink_get_result\('cw2_catalog_apply'(?:,false)?\)/g) ?? []).length === 4
    && concurrencySql.split("select dblink_send_query('cw2_catalog_writer'").length - 1 === 1
    && concurrencySql.split('select pg_cancel_backend(pid)').length - 1 === 1
    && concurrencySql.split("select dblink_cancel_query('cw2_catalog_apply')").length - 1 === 0
    && concurrencySql.split("select dblink_is_busy('cw2_catalog_apply') into v_busy;").length - 1 === 1
    && concurrencySql.split('select pg_terminate_backend(pid,5000)').length - 1 === 1
    && concurrencySql.split("set local statement_timeout='5000ms';").length - 1 === 8
    && !/when\s+others\s+then\s+null/i.test(concurrencySql)
    && concurrencySql.split('select not exists(select 1 from pg_catalog.pg_stat_activity where pid=(select apply_pid from cw2_catalog_apply_recovery_state)) into strict v_terminated;').length - 1 === 1
    && concurrencySql.split('pg_stat_activity').length - 1 === 1
    && stagedRecoveryContract
    && concurrencySql.split(liveLockIdentity).length - 1 === 1
    && (concurrencySql.match(/dblink_get_result\('cw2_catalog_writer'(?:,false)?\)/g) ?? []).length === 4
    && writerSetupResultIndex >= 0 && writerSetupResultIndex < writerAttestationResultIndex && writerAttestationResultIndex < primaryWriterResultIndex && primaryWriterResultIndex < writerMessageCaptureIndex && writerMessageCaptureIndex < writerNullMessageDenialIndex && writerNullMessageDenialIndex < terminalWriterDrainIndex
    && terminalWriterDrainIndex < concurrencySql.indexOf('CONNECT_WORKFLOWS_CW2_WRITER_ASYNC_RESULT_DRAIN_PASS')
    && applyPidCaptureIndex >= 0 && applyPidCaptureIndex < applySendIndex && applySendIndex < readinessStatementTimeoutIndex && readinessStatementTimeoutIndex < readinessServerBoundBeginIndex && readinessServerBoundBeginIndex < readinessDoIndex && readinessDoIndex < liveWaitIndex && liveWaitIndex < readinessServerBoundPassIndex && readinessServerBoundPassIndex < readinessMarkerIndex && readinessMarkerIndex < writerSendIndex
    && timeoutTerminateIndex >= 0 && timeoutTerminateIndex < timeoutWriterRollbackIndex && timeoutWriterRollbackIndex < timeoutWriterDisconnectIndex && timeoutWriterDisconnectIndex < timeoutDisconnectMarkerIndex
    && cleanupCancelIndex >= 0 && cleanupCancelIndex < cleanupUnlockIndex && cleanupUnlockIndex < cleanupBusyPollIndex && cleanupBusyPollIndex < cleanupBusyClearIndex && cleanupBusyClearIndex < cleanupDrainBeginIndex && cleanupDrainBeginIndex < cleanupPrimaryIndex && cleanupPrimaryIndex < cleanupTerminalIndex && cleanupTerminalIndex < cleanupDrainPassIndex && cleanupDrainPassIndex < cleanupDisconnectIndex && cleanupDisconnectIndex < cleanupWriterRollbackIndex && cleanupWriterRollbackIndex < cleanupWriterDisconnectIndex && cleanupWriterDisconnectIndex < cleanupFailureIndex
    && normalUnlockIndex >= 0 && normalUnlockIndex < primaryApplyResultIndex && primaryApplyResultIndex < terminalApplyDrainIndex && terminalApplyDrainIndex < releasedWriterIndex && releasedWriterIndex < applyDisconnectIndex
    && exactWriterBoundary(initialWriterSpan) && exactWriterActionTimeout && exactWriterBoundary(releasedWriterSpan)
    && !/(password\s*=|passfile\s*=|host(?:addr)?\s*=|dblink_connect_u|service_role|session_replication_role)/i.test(concurrencySql)
    && !/set\s+role\s+supabase_admin/i.test(concurrencySql)
    && !/U&"/.test(concurrencySql) && !/"unapproved_rpc"/.test(concurrencySql) && !/\bdo\s+(?:E)?'/i.test(concurrencySql)
    && outerBody.length > 0 && !/update\s+public\./i.test(outerBody)
  }
  assert(disposableSource.includes(`$concurrencyFixtureVerifySha256 = '${concurrencyFixtureProofSha256}'`), 'The runner must pin the exact local postgres concurrency fixture SHA-256 that this focused regression independently derives from file bytes.')
  assert(disposableSource.includes(`$concurrencyVerifySha256 = '${concurrencyProofSha256}'`), 'The runner must pin the exact concurrency proof SHA-256 that this focused regression independently derives from file bytes.')
  assert(completeCredentialHandoff(disposableSource, sqlProofSource, concurrencyFixtureProofSource, concurrencyProofSource, migration), 'The base and concurrency fixture SQL must retain their local postgres boundaries while only the separate local concurrency orchestrator uses supabase_admin and both workers prove authenticated execution.')
  const catalogDmlProofStart = '-- Direct authenticated catalog writers must share the confirmation\'s exact'
  const catalogDmlProofEnd = '\\echo CONNECT_WORKFLOWS_CW2_CATALOG_DELETE_RELEASE_PASS'
  const catalogDmlProof = exactSpan(concurrencyProofSource, catalogDmlProofStart, catalogDmlProofEnd)
  const catalogDmlFarmKey = "pg_catalog.hashtext('27010000-0000-4000-8000-000000000005'),\n  pg_catalog.hashtext('inventory-products-catalog')"
  const catalogDmlAuthenticatedHeader = `set role authenticated;
set "request.jwt.claims"='{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}';
set "request.jwt.claim.sub"='27000000-0000-4000-8000-000000000001';
set "request.headers"='{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\\"27010000-0000-4000-8000-000000000005\\":1}"}';
set local lock_timeout='500ms';`
  const completeCatalogDmlProof = (source: string) => source.length > 0
    && source.split("select dblink_connect('cw2_catalog_insert_writer'").length - 1 === 1
    && source.split(catalogDmlFarmKey).length - 1 === 4
    && source.split(catalogDmlAuthenticatedHeader).length - 1 === 4
    && source.split("select dblink_send_query('cw2_catalog_insert_writer'").length - 1 === 2
    && source.split("select dblink_is_busy('cw2_catalog_insert_writer')=0 into v_done;").length - 1 === 2
    && (source.match(/dblink_get_result\('cw2_catalog_insert_writer'(?:,false)?\)/g) ?? []).length === 4
    && source.split("message=dblink_error_message('cw2_catalog_insert_writer')").length - 1 === 2
    && source.split('cw2_catalog_insert_terminal_drain').length - 1 === 2
    && source.split('cw2_catalog_delete_terminal_drain').length - 1 === 2
    && source.split("select dblink_exec('cw2_catalog_insert_writer','rollback');").length - 1 === 2
    && source.split("select dblink_exec('cw2_catalog_insert_writer','commit');").length - 1 === 2
    && source.split("insert into public.inventory_products (id,farm_id,product_kind,name,inventory_unit,is_active)").length - 1 === 2
    && source.split('delete from public.inventory_products').length - 1 === 2
    && ['CONNECT_WORKFLOWS_CW2_CATALOG_INSERT_LOCK_TEST_BEGIN', 'CW2 catalog INSERT did not finish inside the exact asynchronous wait bound', 'CW2 catalog INSERT did not block on the exact farm lock', 'CONNECT_WORKFLOWS_CW2_CATALOG_INSERT_LOCK_TIMEOUT_PASS', 'CONNECT_WORKFLOWS_CW2_CATALOG_INSERT_RELEASE_PASS', 'CONNECT_WORKFLOWS_CW2_CATALOG_DELETE_LOCK_TEST_BEGIN', 'CW2 catalog DELETE did not finish inside the exact asynchronous wait bound', 'CW2 catalog DELETE did not block on the exact farm lock', 'CONNECT_WORKFLOWS_CW2_CATALOG_DELETE_LOCK_TIMEOUT_PASS', 'CONNECT_WORKFLOWS_CW2_CATALOG_DELETE_RELEASE_PASS', "select dblink_disconnect('cw2_catalog_insert_writer');", 'CW2 catalog DELETE release did not remove the disposable probe row'].every((marker) => source.split(marker).length - 1 === 1)
    && !/(service_role|session_replication_role|dblink_connect_u|disable\s+trigger|set\s+role\s+supabase_admin)/i.test(source)
  assert(completeCatalogDmlProof(catalogDmlProof), 'The local catalog DML proof must make authenticated INSERT and DELETE block on, then release from, the exact farm-scoped catalog lock.')
  for (const marker of [catalogDmlProofStart, catalogDmlFarmKey, catalogDmlAuthenticatedHeader, "select dblink_send_query('cw2_catalog_insert_writer'", "select dblink_is_busy('cw2_catalog_insert_writer')=0 into v_done;", "message=dblink_error_message('cw2_catalog_insert_writer')", "insert into public.inventory_products (id,farm_id,product_kind,name,inventory_unit,is_active)", 'delete from public.inventory_products', 'CW2 catalog INSERT did not block on the exact farm lock', 'CW2 catalog DELETE did not block on the exact farm lock', catalogDmlProofEnd]) {
    const mutated = concurrencyProofSource.replace(catalogDmlProof, catalogDmlProof.replace(marker, 'CW2_REMOVED_CATALOG_DML_PROOF_GUARD'))
    const start = mutated.indexOf(catalogDmlProofStart); const end = mutated.indexOf(catalogDmlProofEnd, start)
    const changed = start >= 0 && end > start ? mutated.slice(start, end + catalogDmlProofEnd.length) : ''
    assert(!completeCatalogDmlProof(changed), `Removing catalog DML proof guard ${marker} must turn the proof-of-proof red.`)
  }
  type CredentialMutation = { name: string; runner: string; sql: string; fixture?: string; concurrency: string; migration?: string }
  const credentialMutations: CredentialMutation[] = [
    { name: 'base elevated', runner: replaceInExactSpan(disposableSource, ...baseSpanMarkers, '-U postgres -d postgres -v ON_ERROR_STOP=1', '-U supabase_admin -d postgres -v ON_ERROR_STOP=1'), sql: sqlProofSource, concurrency: concurrencyProofSource },
    { name: 'outer user changed', runner: replaceInExactSpan(disposableSource, ...adminSpanMarkers, '-U supabase_admin -d postgres -v ON_ERROR_STOP=1', '-U postgres -d postgres -v ON_ERROR_STOP=1'), sql: sqlProofSource, concurrency: concurrencyProofSource },
    { name: 'fixture elevated', runner: replaceInExactSpan(disposableSource, ...fixtureSpanMarkers, '-U postgres -d postgres -v ON_ERROR_STOP=1', '-U supabase_admin -d postgres -v ON_ERROR_STOP=1'), sql: sqlProofSource, concurrency: concurrencyProofSource },
    { name: 'fixture pass setup removed', runner: disposableSource, sql: sqlProofSource, fixture: concurrencyFixtureProofSource.replace('insert into public.assigned_program_passes (', 'select true; -- removed fixture pass ('), concurrency: concurrencyProofSource },
    { name: 'fixture user context removed', runner: disposableSource, sql: sqlProofSource, fixture: concurrencyFixtureProofSource.replace("select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);", 'select true; -- removed fixture user context'), concurrency: concurrencyProofSource },
    { name: 'fixture context transaction removed', runner: disposableSource, sql: sqlProofSource, fixture: concurrencyFixtureProofSource.replace("begin;\nselect set_config('request.jwt.claims'", "select true; -- removed fixture context transaction\nselect set_config('request.jwt.claims'"), concurrency: concurrencyProofSource },
    { name: 'fixture epoch changed', runner: disposableSource, sql: sqlProofSource, fixture: concurrencyFixtureProofSource.replace('"x-farm-rx-access-epochs":"{\\"27010000-0000-4000-8000-000000000005\\":1}"', '"x-farm-rx-access-epochs":"{\\"27010000-0000-4000-8000-000000000005\\":2}"'), concurrency: concurrencyProofSource },
    { name: 'fixture boundary marker removed', runner: disposableSource, sql: sqlProofSource, fixture: concurrencyFixtureProofSource.replace('CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_BOUNDARY_PASS', 'CW2_REMOVED_FIXTURE_BOUNDARY'), concurrency: concurrencyProofSource },
    { name: 'fixture boundary moved', runner: disposableSource, sql: sqlProofSource, fixture: concurrencyFixtureProofSource.replace('\\echo CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_BOUNDARY_PASS\n\ninsert into public.assigned_program_passes (', 'insert into public.assigned_program_passes (\n\\echo CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_BOUNDARY_PASS'), concurrency: concurrencyProofSource },
    { name: 'fixture post-catalog probe key changed', runner: disposableSource, sql: sqlProofSource, fixture: concurrencyFixtureProofSource.replace('perform pg_catalog.pg_advisory_xact_lock(25000,2);', 'perform pg_catalog.pg_advisory_xact_lock(25000,3);'), concurrency: concurrencyProofSource },
    { name: 'fixture post-catalog trigger target changed', runner: disposableSource, sql: sqlProofSource, fixture: concurrencyFixtureProofSource.replace('create trigger cw2_catalog_probe_pause before update on public.assigned_program_pass_products', 'create trigger cw2_catalog_probe_pause before update on public.inventory_products'), concurrency: concurrencyProofSource },
    { name: 'post-catalog update moved before lock', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource, migration: migration.replace('if v_requested_match_count > 0 then\n    perform pg_advisory_xact_lock(', 'if v_requested_match_count > 0 then\n    update public.assigned_program_pass_products assigned_product\n    perform pg_advisory_xact_lock(') },
    { name: 'post-catalog trigger static guard weakened', runner: replaceInExactSpan(disposableSource, '# CW2_POST_CATALOG_STATIC_GUARD_BEGIN', '# CW2_POST_CATALOG_STATIC_GUARD_END', '-or $cw2CatalogTriggerFunctionIndex -lt 0', '-or $false'), sql: sqlProofSource, concurrency: concurrencyProofSource },
    { name: 'post-catalog ordering static guard weakened', runner: replaceInExactSpan(disposableSource, '# CW2_POST_CATALOG_STATIC_GUARD_BEGIN', '# CW2_POST_CATALOG_STATIC_GUARD_END', '-or $cw2AssignedProductUpdateIndex -le $cw2CatalogLockIndex', '-or $false'), sql: sqlProofSource, concurrency: concurrencyProofSource },
    { name: 'boundary removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_LOCAL_SUPABASE_ADMIN_BOUNDARY_PASS', 'CW2_REMOVED_BOUNDARY') },
    { name: 'one authenticated downgrade removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('set role authenticated;', 'select true;') },
    { name: 'apply attestation removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("raise exception 'CW2 catalog apply session did not enter the exact authenticated local boundary'", 'raise exception \'removed\'') },
    { name: 'writer attestation removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("raise exception 'CW2 catalog writer session did not enter the exact authenticated local boundary'", 'raise exception \'removed\'') },
    { name: 'writer dedicated transaction boundary removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_exec('cw2_catalog_writer','begin');\nselect dblink_exec('cw2_catalog_writer',$remote$\nset role authenticated;", "select dblink_exec('cw2_catalog_writer',$remote$\nset role authenticated;") },
    { name: 'writer setup moved before transaction boundary', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_exec('cw2_catalog_writer','begin');\nselect dblink_exec('cw2_catalog_writer',$remote$\nset role authenticated;", "select dblink_exec('cw2_catalog_writer',$remote$\nset role authenticated;\nbegin;") },
    { name: 'writer transaction-local timeout removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("set local lock_timeout='500ms';", 'select true; -- removed transaction-local timeout') },
    { name: 'writer timeout attestation weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("or current_setting('lock_timeout',true) <> '500ms'", 'or false') },
    { name: 'writer action-local timeout removed', runner: disposableSource, sql: sqlProofSource, concurrency: replaceInExactSpan(concurrencyProofSource, "select dblink_send_query('cw2_catalog_writer',$remote$", "or (select message from cw2_catalog_writer_result) !~ '^ERROR:  canceling statement due to lock timeout'", "set local lock_timeout='500ms';", 'select true; -- removed action-local timeout') },
    { name: 'writer action-local timeout attestation weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("if current_setting('lock_timeout',true) <> '500ms' then", 'if false then') },
    { name: 'writer synchronous action restored', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_send_query('cw2_catalog_writer',$remote$", "select dblink_exec('cw2_catalog_writer',$remote$") },
    { name: 'writer asynchronous busy poll removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_is_busy('cw2_catalog_writer')=0 into v_done;", 'select false into v_done;') },
    { name: 'writer asynchronous cancel removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("perform dblink_cancel_query('cw2_catalog_writer');", 'perform false; -- removed writer cancellation') },
    { name: 'writer asynchronous bound failure removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("raise exception 'CW2 catalog writer did not finish inside the exact asynchronous wait bound';", 'perform false; -- removed writer wait failure') },
    { name: 'writer primary result error capture weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("dblink_get_result('cw2_catalog_writer',false)", "dblink_get_result('cw2_catalog_writer',true)") },
    { name: 'writer setup result removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select status from dblink_get_result('cw2_catalog_writer') as setup(status text);", "select 'SET'; -- removed writer setup result") },
    { name: 'writer attestation result removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select status from dblink_get_result('cw2_catalog_writer') as attestation(status text);", "select 'DO'; -- removed writer attestation result") },
    { name: 'writer primary result count guard weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('result_count integer check(result_count=0)', 'result_count integer') },
    { name: 'writer primary null sentinel counted as a row', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select count(status) from dblink_get_result('cw2_catalog_writer',false)", "select count(*) from dblink_get_result('cw2_catalog_writer',false)") },
    { name: 'writer terminal result drain removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select count(*) from dblink_get_result('cw2_catalog_writer') as terminal(status text);", 'select 0; -- removed writer terminal drain') },
    { name: 'writer terminal result drain moved before message attestation', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select count(*) from dblink_get_result('cw2_catalog_writer') as terminal(status text);", '').replace("update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');", "select count(*) from dblink_get_result('cw2_catalog_writer') as terminal(status text);\nupdate cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');") },
    { name: 'writer asynchronous drain marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_WRITER_ASYNC_RESULT_DRAIN_PASS', 'CW2_REMOVED_WRITER_ASYNC_RESULT_DRAIN') },
    { name: 'apply connection statement timeout removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("options=''-csearch_path= -cstatement_timeout=15000'' application_name=cw2_catalog_apply", "options=-csearch_path= application_name=cw2_catalog_apply") },
    { name: 'writer connection bounds removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("options=''-csearch_path= -cstatement_timeout=15000 -clock_timeout=500'' application_name=cw2_catalog_writer", "options=-csearch_path= application_name=cw2_catalog_writer") },
    { name: 'apply backend pid capture removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("create temporary table cw2_catalog_apply_backend(pid integer primary key);\ninsert into cw2_catalog_apply_backend\nselect pid from dblink('cw2_catalog_apply','select pg_backend_pid()') as apply_backend(pid integer);", 'select true; -- removed apply backend PID capture') },
    { name: 'apply readiness waiting lock relation changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('from pg_catalog.pg_locks waiting', 'from pg_catalog.pg_locks held') },
    { name: 'apply readiness pid binding removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('join cw2_catalog_apply_backend apply_backend on apply_backend.pid=waiting.pid', 'join cw2_catalog_apply_backend apply_backend on true') },
    { name: 'apply readiness waiting lock type changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("where waiting.locktype='advisory'", "where waiting.locktype='relation'") },
    { name: 'apply readiness waiting database binding removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and waiting.database=(select oid from pg_catalog.pg_database where datname=current_database())', 'and true -- removed waiting database binding') },
    { name: 'apply readiness first advisory key changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_advisory_lock(25000,2);', 'select pg_advisory_lock(25001,2);') },
    { name: 'apply readiness second advisory key changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_advisory_lock(25000,2);', 'select pg_advisory_lock(25000,3);') },
    { name: 'apply readiness waiting advisory key kind changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and waiting.objsubid=2', 'and waiting.objsubid=1') },
    { name: 'apply readiness waiting lock mode changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("and waiting.mode='ExclusiveLock'", "and waiting.mode='ShareLock'") },
    { name: 'apply readiness waiting polarity inverted', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and not waiting.granted', 'and waiting.granted') },
    { name: 'apply readiness held lock relation changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('from pg_catalog.pg_locks held', 'from pg_catalog.pg_locks waiting') },
    { name: 'apply readiness held lock type changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and held.locktype=waiting.locktype', "and held.locktype='relation'") },
    { name: 'apply readiness held database binding removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and held.database=waiting.database', 'and true -- removed held database binding') },
    { name: 'apply readiness held first key correlation removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and held.classid=waiting.classid', 'and held.classid=0') },
    { name: 'apply readiness held second key correlation removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and held.objid=waiting.objid', 'and held.objid=0') },
    { name: 'apply readiness held advisory key kind changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and held.objsubid=waiting.objsubid', 'and held.objsubid=1') },
    { name: 'apply readiness held lock mode changed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and held.mode=waiting.mode', "and held.mode='ShareLock'") },
    { name: 'apply readiness owner polarity inverted', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('and held.granted', 'and not held.granted') },
    { name: 'apply readiness poll bound weakened', runner: disposableSource, sql: sqlProofSource, concurrency: replaceInExactSpan(concurrencyProofSource, 'do $wait$', 'CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS', 'for i in 1..100 loop\n    select\n      exists(', 'for i in 1..1000000 loop\n    select\n      exists(') },
    { name: 'writer dispatched before apply readiness', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("\\echo CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS\nselect dblink_send_query('cw2_catalog_writer',$remote$", "select dblink_send_query('cw2_catalog_writer','select true');\n\\echo CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS\nselect dblink_send_query('cw2_catalog_writer',$remote$") },
    { name: 'apply readiness cleanup cancellation removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;', 'select false into v_cancelled; -- removed exact apply cancellation') },
    { name: 'apply readiness blocking dblink cancellation restored', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;', "select dblink_cancel_query('cw2_catalog_apply') into v_cancel;") },
    { name: 'apply readiness cancellation pid binding weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;', 'select pg_cancel_backend(pg_backend_pid()) into v_cancelled;') },
    { name: 'apply readiness cleanup unlock moved after drain', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_advisory_unlock(25000,2) into v_unlocked;', "select count(*) from dblink_get_result('cw2_catalog_apply',false) as premature(result jsonb) into v_primary;\n   select pg_advisory_unlock(25000,2) into v_unlocked;") },
    { name: 'apply readiness cleanup disconnect removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_disconnect('cw2_catalog_apply') into v_disconnect;", "select 'ERROR' into v_disconnect; -- removed apply disconnect") },
    { name: 'apply readiness cleanup writer rollback removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;", "select 'ERROR' into v_rollback; -- removed writer rollback") },
    { name: 'apply readiness cleanup writer disconnect removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_disconnect('cw2_catalog_writer') into v_disconnect;", "select 'ERROR' into v_disconnect; -- removed writer disconnect") },
    { name: 'apply result collected before advisory release', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select pg_advisory_unlock(25000,2);\n\\echo CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS\n\\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN\ncreate temporary table cw2_catalog_apply_result(result jsonb);\ninsert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);", "create temporary table cw2_catalog_apply_result(result jsonb);\ninsert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);\nselect pg_advisory_unlock(25000,2);\n\\echo CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS\n\\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN") },
    { name: 'apply probe marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS', 'CW2_REMOVED_APPLY_PROBE') },
    { name: 'writer timeout marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_WRITER_LOCK_TIMEOUT_PASS', 'CW2_REMOVED_WRITER_TIMEOUT') },
    { name: 'catalog release marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS', 'CW2_REMOVED_CATALOG_RELEASE') },
    { name: 'async collection marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN', 'CW2_REMOVED_ASYNC_COLLECTION') },
    { name: 'released writer authenticated downgrade removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("insert into cw2_catalog_writer_released\nselect dblink_exec('cw2_catalog_writer',$remote$\nset role authenticated;", "insert into cw2_catalog_writer_released\nselect dblink_exec('cw2_catalog_writer',$remote$\nselect true; -- removed released writer role;") },
    { name: 'released writer attestation removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("raise exception 'CW2 catalog writer session did not enter the exact authenticated local boundary';\n  end if;\nend\n$cw2_remote_auth$;\nupdate public.inventory_products", "raise exception 'CW2 released writer attestation removed';\n  end if;\nend\n$cw2_remote_auth$;\nupdate public.inventory_products") },
    { name: 'terminal async drain removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);", 'select 0; -- removed terminal dblink drain') },
    { name: 'terminal async drain moved before primary result', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("insert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);\ncreate temporary table cw2_catalog_apply_terminal_drain(\n  terminal_results integer check(terminal_results=0)\n);\ninsert into cw2_catalog_apply_terminal_drain\nselect count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);", "create temporary table cw2_catalog_apply_terminal_drain(\n  terminal_results integer check(terminal_results=0)\n);\ninsert into cw2_catalog_apply_terminal_drain\nselect count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);\n-- moved before primary result\ninsert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);") },
    { name: 'terminal async drain nonempty guard weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('terminal_results integer check(terminal_results=0)', 'terminal_results integer') },
    { name: 'terminal async drain marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_DRAIN_PASS', 'CW2_REMOVED_ASYNC_RESULT_DRAIN') },
    { name: 'password added', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('application_name=cw2_catalog_apply', 'password=secret application_name=cw2_catalog_apply') },
    { name: 'host added', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('application_name=cw2_catalog_apply', 'host=remote.invalid application_name=cw2_catalog_apply') },
    { name: 'dblink connect u', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("dblink_connect('cw2_catalog_apply'", "dblink_connect_u('cw2_catalog_apply'") },
    { name: 'disconnect removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_disconnect('cw2_catalog_apply');", 'select true;') },
    { name: 'lock cause weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("!~ '^ERROR:  canceling statement due to lock timeout'", 'is null') },
    { name: 'released writer weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("<> 'UPDATE 1'", '<> \'UPDATE 0\'') },
    { name: 'final nonwrite weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("raise exception 'CW2 concurrent catalog proof did not preserve one exact no-record draw'", 'raise exception \'removed\'') },
    { name: 'outer dollar-body public write', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("begin\n  if current_user <> 'supabase_admin'", "begin\n  update public.inventory_products set name=name;\n  if current_user <> 'supabase_admin'") },
    { name: 'worker post-attestation elevation', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("end\n$cw2_remote_auth$\n$remote$);", "end\n$cw2_remote_auth$;\nset role supabase_admin\n$remote$);") },
    { name: 'outer dynamic admin write', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("begin\n  if current_user <> 'supabase_admin'", "begin\n  execute 'update public.inventory_products set name=name';\n  if current_user <> 'supabase_admin'") },
    { name: 'outer dynamic format', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("begin\n  if current_user <> 'supabase_admin'", "begin\n  perform pg_catalog.format('noop');\n  if current_user <> 'supabase_admin'") },
    { name: 'outer alternate rpc', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("begin\n  if current_user <> 'supabase_admin'", "begin\n  perform public.unapproved_rpc();\n  if current_user <> 'supabase_admin'") },
    { name: 'worker dynamic role elevation', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("end\n$cw2_remote_auth$\n$remote$);", "end\n$cw2_remote_auth$;\nselect pg_catalog.set_config('role','supabase_'||'admin',false)\n$remote$);") },
    { name: 'extra apply rpc', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\nselect public.unapproved_rpc()\n$remote$);") },
    { name: 'extra writer rpc', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("  and farm_id='27010000-0000-4000-8000-000000000005'\n$remote$);", "  and farm_id='27010000-0000-4000-8000-000000000005';\nselect public.unapproved_rpc()\n$remote$);") },
    { name: 'unicode quoted role elevation', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("end\n$cw2_remote_auth$\n$remote$);", "end\n$cw2_remote_auth$;\nset U&\"ro\\006ce\"='supabase_admin'\n$remote$);") },
    { name: 'unicode quoted set config', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\nselect pg_catalog.U&\"set\\005fconfig\"('role','supabase_admin',false)\n$remote$);") },
    { name: 'ordinary quoted rpc', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\nselect public.\"unapproved_rpc\"()\n$remote$);") },
    { name: 'single string do body', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ndo 'begin perform public.unapproved_rpc(); end' language plpgsql\n$remote$);") },
    { name: 'escape string do body', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ndo E'begin perform public.unapproved_rpc(); end' language plpgsql\n$remote$);") },
    { name: 'language before single do body', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ndo language plpgsql 'begin perform public.unapproved_rpc(); end'\n$remote$);") },
    { name: 'language before escape do body', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ndo language plpgsql E'begin perform public.unapproved_rpc(); end'\n$remote$);") },
    { name: 'language before unicode do body', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ndo language plpgsql U&'begin perform public.unapproved_rpc(); end'\n$remote$);") },
    { name: 'language before national do body', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ndo language plpgsql N'begin perform public.unapproved_rpc(); end'\n$remote$);") },
    { name: 'outer alter role createdb', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("begin\n  if current_user <> 'supabase_admin'", "begin\n  alter role authenticated createdb;\n  if current_user <> 'supabase_admin'") },
    { name: 'outer grant truncate', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("begin\n  if current_user <> 'supabase_admin'", "begin\n  grant truncate on public.inventory_products to authenticated;\n  if current_user <> 'supabase_admin'") },
    { name: 'worker truncate', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ntruncate table public.inventory_products\n$remote$);") },
    { name: 'worker create', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ncreate table public.cw2_unapproved(id integer)\n$remote$);") },
    { name: 'worker drop', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ndrop table public.inventory_products\n$remote$);") },
    { name: 'worker copy', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace(")\n$remote$);", ");\ncopy public.inventory_products to stdout\n$remote$);") },
    { name: 'apply dispatch begin marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_BEGIN', 'CW2_REMOVED_APPLY_DISPATCH_BEGIN') },
    { name: 'apply dispatch pass marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_PASS', 'CW2_REMOVED_APPLY_DISPATCH_PASS') },
    { name: 'apply readiness wait marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_READINESS_WAIT_BEGIN', 'CW2_REMOVED_APPLY_READINESS_WAIT_BEGIN') },
    { name: 'apply readiness server timeout removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("set local statement_timeout='10000ms';", 'select true; -- removed readiness server timeout') },
    { name: 'apply readiness server bound begin marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_BEGIN', 'CW2_REMOVED_APPLY_READINESS_SERVER_BOUND_BEGIN') },
    { name: 'apply readiness server bound pass marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_PASS', 'CW2_REMOVED_APPLY_READINESS_SERVER_BOUND_PASS') },
    { name: 'apply readiness timeout marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_READINESS_TIMEOUT_BEGIN', 'CW2_REMOVED_APPLY_READINESS_TIMEOUT') },
    { name: 'apply cancellation request begin marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_REQUEST_BEGIN', 'CW2_REMOVED_APPLY_CANCEL_REQUEST_BEGIN') },
    { name: 'apply cancellation request pass marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_REQUEST_PASS', 'CW2_REMOVED_APPLY_CANCEL_REQUEST_PASS') },
    { name: 'apply cancellation marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_PASS', 'CW2_REMOVED_APPLY_CANCEL') },
    { name: 'apply unlock marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_PASS', 'CW2_REMOVED_APPLY_UNLOCK') },
    { name: 'apply busy poll marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_BUSY_POLL_BEGIN', 'CW2_REMOVED_APPLY_BUSY_POLL') },
    { name: 'apply busy poll removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_is_busy('cw2_catalog_apply') into v_busy;", 'select 1 into v_busy; -- removed exact busy poll') },
    { name: 'apply busy poll bound weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("for i in 1..100 loop select dblink_is_busy('cw2_catalog_apply') into v_busy;", "for i in 1..1000000 loop select dblink_is_busy('cw2_catalog_apply') into v_busy;") },
    { name: 'apply busy polarity inverted', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('exit when v_busy=0;', 'exit when v_busy=1;') },
    { name: 'apply busy timeout false success', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then", 'if false then') },
    { name: 'apply exact backend termination removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_terminate_backend(pid,5000) from cw2_catalog_apply_backend into v_terminated;', 'select false into v_terminated; -- removed exact backend termination') },
    { name: 'apply termination pid binding weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_terminate_backend(pid,5000) from cw2_catalog_apply_backend into v_terminated;', 'select pg_terminate_backend(pg_backend_pid(),5000) into v_terminated;') },
    { name: 'apply busy timeout writer rollback removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;", "select 'ERROR' into v_rollback; -- removed timeout writer rollback") },
    { name: 'apply busy timeout writer disconnect removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_disconnect('cw2_catalog_writer') into v_disconnect;", "select 'ERROR' into v_disconnect; -- removed timeout writer disconnect") },
    { name: 'apply busy timeout disconnect marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_BUSY_TIMEOUT_DISCONNECT_PASS', 'CW2_REMOVED_BUSY_TIMEOUT_DISCONNECT') },
    { name: 'apply busy clear marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_BUSY_CLEAR_PASS', 'CW2_REMOVED_BUSY_CLEAR') },
    { name: 'apply result drain begin marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_RESULT_DRAIN_BEGIN', 'CW2_REMOVED_RESULT_DRAIN_BEGIN') },
    { name: 'apply result drain moved before busy clear', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then raise exception 'CW2 catalog apply was still busy before result drain'; end if;\n   select count(*) from dblink_get_result('cw2_catalog_apply',false) as cleanup_primary(result jsonb) into v_primary;", "select count(*) from dblink_get_result('cw2_catalog_apply',false) as premature(result jsonb) into v_primary;\n   if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then raise exception 'CW2 catalog apply was still busy before result drain'; end if;") },
    { name: 'apply result drain pass marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_RESULT_DRAIN_PASS', 'CW2_REMOVED_RESULT_DRAIN_PASS') },
    { name: 'apply disconnect marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_PASS', 'CW2_REMOVED_APPLY_DISCONNECT') },
    { name: 'apply readiness observed marker removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVED_PASS', 'CW2_REMOVED_READINESS_OBSERVED') },
    { name: 'apply readiness no-ready primary code removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("'CW2R0'", "'CW2REMOVED'") },
    { name: 'apply readiness no-ready primary cause removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("'APPLY_READINESS_NOT_OBSERVED'", "'CW2_REMOVED_READINESS_CAUSE'") },
    { name: 'apply readiness no-ready false success injected', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('succeeded=v_ready,', 'succeeded=true,') },
    { name: 'ordinary clock restoration guard removed', runner: disposableSource.replace('if ($clockResult[-1] -ne $true) { throw "CONNECT_WORKFLOWS_CW2_CLOCK_PHASE_FAILED:$viewport" }', 'if ($false) { throw "CW2_REMOVED_CLOCK_PHASE_GUARD" }'), sql: sqlProofSource, concurrency: concurrencyProofSource },
    { name: 'ordinary clock diagnostic provenance changed', runner: disposableSource.replace('Invoke-Cw2CapturedProcess -Stage "${viewport}:ordinary-clock:concurrency"', 'Invoke-Cw2CapturedProcess -Stage "${viewport}:frozen-clock:concurrency"'), sql: sqlProofSource, concurrency: concurrencyProofSource },
    { name: 'readiness stage record moved into caught block', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('readiness-observe',1,clock_timestamp(),current_setting('statement_timeout',true));\ndo $wait$", 'do $wait$').replace("begin\n  if current_setting('statement_timeout',true) <> '10s'", "begin\n  insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('readiness-observe',1,clock_timestamp(),current_setting('statement_timeout',true));\n  if current_setting('statement_timeout',true) <> '10s'") },
    { name: 'readiness stage failure retained on wrong row', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("where stage='readiness-observe';\nend\n$wait$;", "where stage='cancel-apply';\nend\n$wait$;") },
    { name: 'apply recovery record query removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('from cw2_catalog_apply_recovery_stages\norder by stage_order;', 'from cw2_catalog_apply_recovery_state') },
    { name: 'apply recovery record ordering moved after failure', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('\\echo CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_BEGIN', '\\echo CW2_REMOVED_RECOVERY_RECORDS_BEGIN').replace("raise exception 'CW2 catalog apply readiness recovery required: %',coalesce(v_failures,'UNKNOWN_RECOVERY_FAILURE');", "raise exception 'CW2 catalog apply readiness recovery required: %',coalesce(v_failures,'UNKNOWN_RECOVERY_FAILURE');\n\\echo CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_BEGIN") },
    { name: 'apply busy zero-before-drain guard removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then raise exception 'CW2 catalog apply was still busy before result drain'; end if;", 'select true; -- removed busy zero-before-drain guard') },
    { name: 'apply absence custody wrong pid', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('where pid=(select apply_pid from cw2_catalog_apply_recovery_state)', 'where pid=pg_backend_pid()') },
    { name: 'apply absence custody broadened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('where pid=(select apply_pid from cw2_catalog_apply_recovery_state)', 'where true') },
    { name: 'apply cancellation forced error action', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;', "raise exception 'CW2 forced cancel failure';") },
    { name: 'apply unlock forced error action', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_advisory_unlock(25000,2) into v_unlocked;', "raise exception 'CW2 forced unlock failure';") },
    { name: 'apply busy poll forced hang action', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("for i in 1..100 loop select dblink_is_busy('cw2_catalog_apply') into v_busy;", 'for i in 1..1000000 loop select 1 into v_busy;') },
    { name: 'apply terminate forced error action', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('select pg_terminate_backend(pid,5000) from cw2_catalog_apply_backend into v_terminated;', "raise exception 'CW2 forced terminate failure';") },
    { name: 'apply drain forced error action', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("dblink_get_result('cw2_catalog_apply',false) as cleanup_primary", "dblink_get_result('cw2_catalog_writer',false) as cleanup_primary") },
    { name: 'apply disconnect forced error action', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_disconnect('cw2_catalog_apply') into v_disconnect;", "raise exception 'CW2 forced apply disconnect failure';") },
    { name: 'writer rollback failure skips independent stage', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('do $writer_rollback$', 'do $writer_cleanup$') },
    { name: 'writer rollback forced error still requires disconnect stage', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;", "raise exception 'CW2 forced writer rollback failure';") },
    { name: 'writer disconnect forced error retention', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("select dblink_disconnect('cw2_catalog_writer') into v_disconnect;", "raise exception 'CW2 forced writer disconnect failure';") },
    { name: 'recovery timeout equality assertion weakened', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("current_setting('statement_timeout',true) <> '5s'", 'false') },
    { name: 'recovery timeout mismatch escapes staged retention', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("begin\n    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 cancel stage did not retain exact five-second timeout'; end if;", "if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 cancel stage did not retain exact five-second timeout'; end if;\n   begin") },
    { name: 'recovery stage failure retained on wrong row', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("where stage='disconnect-writer'; end;", "where stage='rollback-writer'; end;") },
    { name: 'recovery query canceled handler removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('exception when query_canceled or others then', 'exception when others then') },
    { name: 'recovery cleanup error diagnostics swallowed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('get stacked diagnostics', 'null; -- swallowed diagnostics') },
    { name: 'writer primary result row count set to one', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('result_count integer check(result_count=0)', 'result_count integer check(result_count=1)') },
    { name: 'writer primary result attestation set to one', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('(select result_count from cw2_catalog_writer_result) <> 0', '(select result_count from cw2_catalog_writer_result) <> 1') },
    { name: 'writer primary error message capture removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');", 'select true; -- removed writer primary error message capture') },
    { name: 'writer primary null message denial removed', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace('or (select message from cw2_catalog_writer_result) is null', 'or false') },
    { name: 'writer primary message capture moved after attestation', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');", '').replace('or (select message from cw2_catalog_writer_result) is null', "or (select message from cw2_catalog_writer_result) is null\nupdate cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');") },
    { name: 'writer primary error message read from wrong connection', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("message=dblink_error_message('cw2_catalog_writer')", "message=dblink_error_message('cw2_catalog_apply')") },
    { name: 'writer primary message capture moved before primary result', runner: disposableSource, sql: sqlProofSource, concurrency: concurrencyProofSource.replace("update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');", '').replace("select count(status) from dblink_get_result('cw2_catalog_writer',false) as failed_action(status text);", "update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');\nselect count(status) from dblink_get_result('cw2_catalog_writer',false) as failed_action(status text);") },
  ]
  assert(credentialMutations.length === 166, 'The focused credential-handoff mutation matrix is incomplete.')
  for (const mutation of credentialMutations) assert(!completeCredentialHandoff(mutation.runner, mutation.sql, mutation.fixture ?? concurrencyFixtureProofSource, mutation.concurrency, mutation.migration ?? migration), `The ${mutation.name} credential-handoff mutation must turn the focused contract red.`)
  const browserProofSource = readFileSync(new URL('../../tests/e2e/season/cedar-creek.spec.ts', import.meta.url), 'utf8')
  const browserConfigSource = readFileSync(new URL('../../playwright.connect-workflows-cw2.config.ts', import.meta.url), 'utf8')
  const staleUnitSqlMarkers = [
    '-- CW2 stale-unit database denial with exact zero-public-state proof.', "'qt'),null,false", 'v_before_public from cw2_proof.public_snapshot()',
    "status='planned' and applied_on is null and applied_acres is null and application_record_id is null", 'actual_product_name is null and actual_rate_text is null and actual_unit_text is null and actual_cost_per_acre is null',
    "program_inventory_matches where assigned_product_id='c2200000-0000-4000-8000-000000000072'", "repository_write_receipts where operation_id='c2200000-0000-4000-8000-000000000073'",
    "application_records where id='c2200000-0000-4000-8000-000000000073'", "application_products where application_id='c2200000-0000-4000-8000-000000000073'",
    '<> v_before_on_hand', 'from cw2_proof.public_snapshot()) <> v_before_public', 'CW2 stale Inventory unit did not fail with exact zero public state change',
  ]
  const staleUnitSqlBlock = (source: string) => source.slice(source.indexOf('-- CW2 stale-unit database denial with exact zero-public-state proof.'), source.indexOf("perform pg_temp.cw2_clone('c2200000-0000-4000-8000-000000000061'"))
  const completeStaleUnitSqlProof = (source: string) => { const block = staleUnitSqlBlock(source); return block.length > 0 && staleUnitSqlMarkers.every((marker) => block.includes(marker)) }
  assert(completeStaleUnitSqlProof(sqlProofSource), 'The focused SQL must deny a stale requested unit and prove every public table and derived Inventory quantity unchanged.')
  for (const marker of staleUnitSqlMarkers) { const block = staleUnitSqlBlock(sqlProofSource); const mutated = sqlProofSource.replace(block, block.replace(marker, 'CW2_REMOVED_STALE_UNIT_SQL_GUARD')); assert(!completeStaleUnitSqlProof(mutated), `Removing stale-unit SQL guard ${marker} must turn the proof-of-proof red.`) }
  const staleUnitApplicationProductAssertion = "or exists(select 1 from public.application_products where application_id='c2200000-0000-4000-8000-000000000073')"
  const exactStaleUnitApplicationProductAssertion = (source: string) => staleUnitSqlBlock(source).split(staleUnitApplicationProductAssertion).length - 1 === 1
  assert(exactStaleUnitApplicationProductAssertion(sqlProofSource), 'The stale-unit denial must prove no application_products row exists for the exact application identifier through application_id.')
  const staleUnitApplicationProductMutations = [
    { name: 'remove exact application_products non-write predicate', source: sqlProofSource.replace(staleUnitApplicationProductAssertion, 'or false') },
    { name: 'change application_products relation', source: sqlProofSource.replace(staleUnitApplicationProductAssertion, staleUnitApplicationProductAssertion.replace('public.application_products', 'public.application_records')) },
    { name: 'change application_id column', source: sqlProofSource.replace(staleUnitApplicationProductAssertion, staleUnitApplicationProductAssertion.replace('application_id=', 'application_record_id=')) },
    { name: 'weaken application_products existence predicate', source: sqlProofSource.replace(staleUnitApplicationProductAssertion, staleUnitApplicationProductAssertion.replace('or exists(', 'or not exists(')) },
    { name: 'change application identifier sentinel', source: sqlProofSource.replace(staleUnitApplicationProductAssertion, staleUnitApplicationProductAssertion.replace('000000000073', '000000000074')) },
  ]
  assert(staleUnitApplicationProductMutations.length === 5, 'The stale-unit application_products mutation block is incomplete.')
  let executedStaleUnitApplicationProductMutations = 0
  for (const mutation of staleUnitApplicationProductMutations) {
    assert(mutation.source !== sqlProofSource, `The ${mutation.name} mutation did not alter the SQL proof.`)
    assert(!exactStaleUnitApplicationProductAssertion(mutation.source), `The ${mutation.name} mutation must turn the application_products non-write assertion red.`)
    executedStaleUnitApplicationProductMutations += 1
  }
  assert(executedStaleUnitApplicationProductMutations === staleUnitApplicationProductMutations.length, 'Every stale-unit application_products mutation must execute.')
  const regressionSelfSource = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const staleUnitApplicationProductMutationStart = regressionSelfSource.indexOf('  const staleUnitApplicationProductAssertion =')
  const staleUnitApplicationProductMutationEnd = regressionSelfSource.indexOf('  const regressionSelfSource =')
  const staleUnitApplicationProductMutationBlock = staleUnitApplicationProductMutationStart >= 0 && staleUnitApplicationProductMutationEnd > staleUnitApplicationProductMutationStart
    ? regressionSelfSource.slice(staleUnitApplicationProductMutationStart, staleUnitApplicationProductMutationEnd)
    : ''
  const completeStaleUnitApplicationProductMutationProof = staleUnitApplicationProductMutationBlock.length > 0
    && staleUnitApplicationProductMutationBlock.includes('const staleUnitApplicationProductMutations = [')
    && staleUnitApplicationProductMutationBlock.includes('staleUnitApplicationProductMutations.length === 5')
    && staleUnitApplicationProductMutationBlock.includes('for (const mutation of staleUnitApplicationProductMutations)')
    && staleUnitApplicationProductMutationBlock.includes('executedStaleUnitApplicationProductMutations === staleUnitApplicationProductMutations.length')
  assert(completeStaleUnitApplicationProductMutationProof, 'The stale-unit application_products proof-of-proof mutation block may not be omitted.')
  const exactProgramProductLocator = "const productName = form.getByLabel('Product', { exact: true })"
  const exactProductTextboxLocator = (source: string) => source.split(exactProgramProductLocator).length - 1 === 1
  assert(exactProductTextboxLocator(browserProofSource), 'The CW-2 browser proof must select the Product textbox by its exact accessible name so the Inventory confirmation checkbox cannot collide.')
  const productLocatorMutations = [
    { name: 'remove exact Product accessible-name match', source: browserProofSource.replace(exactProgramProductLocator, "const productName = form.getByLabel('Product')") },
  ]
  assert(productLocatorMutations.length === 1, 'The CW-2 exact Product locator mutation block is incomplete.')
  for (const mutation of productLocatorMutations) {
    assert(mutation.source !== browserProofSource, `The ${mutation.name} mutation did not alter the browser proof.`)
    assert(!exactProductTextboxLocator(mutation.source), `The ${mutation.name} mutation must turn the owning contract red.`)
  }
  const cedarTrackerPassId = 'c2000000-0000-4000-8000-000000000005'
  const intendedTrackerPass = `and passes @> '[{"id":"${cedarTrackerPassId}","status":"planned"}]'::jsonb`
  const exactTrackerAssertion = `  if (select count(*) from public.program_assignment_tracker
      where farm_id='27010000-0000-4000-8000-000000000005'
        and assignment_id='c2000000-0000-4000-8000-000000000004'
        and passes @> '[{"id":"${cedarTrackerPassId}","status":"planned"}]'::jsonb) <> 1 then
    raise exception 'CW2 fixture did not expose one planned Program pass';
  end if;`
  const exactTrackerPassProof = (source: string) => {
    const normalized = source.replace(/\r\n?/g, '\n')
    const trackerBlocks = normalized.match(/  if \(select count\(\*\) from public\.[\s\S]*?raise exception 'CW2 fixture did not expose one planned Program pass';\n  end if;/g) ?? []
    return trackerBlocks.length === 1 && trackerBlocks[0] === exactTrackerAssertion
      && !/\band\s+status\s*=\s*'planned'/.test(trackerBlocks[0])
  }
  assert(exactTrackerPassProof(fixtureProofSource), 'The CW-2 fixture must prove the exact intended planned pass through the tracker passes JSON, never a nonexistent top-level status column.')
  const trackerFixtureMutations = [
    { name: 'top-level planned status', source: fixtureProofSource.replace(intendedTrackerPass, "and status='planned'") },
    { name: 'changed nested pass ID', source: fixtureProofSource.replace(`"id":"${cedarTrackerPassId}"`, '"id":"c2000000-0000-4000-8000-000000000099"') },
    { name: 'changed nested pass status', source: fixtureProofSource.replace('"status":"planned"', '"status":"applied"') },
    { name: 'missing nested pass ID', source: fixtureProofSource.replace(`"id":"${cedarTrackerPassId}",`, '') },
    { name: 'missing nested pass status', source: fixtureProofSource.replace(',"status":"planned"', '') },
    { name: 'wrong tracker relation', source: fixtureProofSource.replace('from public.program_assignment_tracker', 'from public.assigned_program_passes') },
    { name: 'whole tracker proof omission', source: fixtureProofSource.replace(exactTrackerAssertion, '') },
  ]
  assert(trackerFixtureMutations.length === 7, 'The CW-2 fixture tracker proof mutation block is incomplete.')
  for (const mutation of trackerFixtureMutations) assert(!exactTrackerPassProof(mutation.source), `The ${mutation.name} fixture mutation must turn the owning contract red.`)
  const futurePassDate = "1, 'CW-2 confirmed draw-down pass', 'post', 'spray', '2027-07-08', 0,"
  const futureDueDate = "'2027-07-08', 'template_date', false, 'planned',"
  const frozenPassDate = "1, 'CW-2 confirmed draw-down pass', 'post', 'spray', '2027-07-07', 0,"
  const frozenDueDate = "'2027-07-07', 'template_date', false, 'planned',"
  const occurrences = (source: string, needle: string) => source.split(needle).length - 1
  const exactFutureDueFixture = (source: string) => occurrences(source, futurePassDate) === 2 && occurrences(source, futureDueDate) === 1
  assert(exactFutureDueFixture(fixtureProofSource), 'The CW-2 target and assigned due dates must both be July 8, after the frozen July 7 browser day.')
  const futureDueFixtureMutations = [
    { name: 'restore all CW-2 pass dates to the frozen day', source: fixtureProofSource.replaceAll(futurePassDate, frozenPassDate).replace(futureDueDate, frozenDueDate) },
    { name: 'restore template target to the frozen day', source: fixtureProofSource.replace(futurePassDate, frozenPassDate) },
    { name: 'restore assigned due date to the frozen day', source: fixtureProofSource.replace(futureDueDate, frozenDueDate) },
  ]
  assert(futureDueFixtureMutations.length === 3, 'The CW-2 future-due fixture mutation block is incomplete.')
  for (const mutation of futureDueFixtureMutations) {
    assert(mutation.source !== fixtureProofSource, `The ${mutation.name} fixture mutation did not alter the fixture.`)
    assert(!exactFutureDueFixture(mutation.source), `The ${mutation.name} fixture mutation must turn the owning contract red.`)
  }
  const noDueCall = 'Assert-Cw2NoDueStartupWrite -ApiUrl $boundary.ApiUrl -PublishableKey $boundary.PublishableKey -AccessToken $token -Viewport $viewport'
  const exactNoDueStartupContract = (runner: string, browser: string) =>
    runner.includes('/rest/v1/rpc/program_due_generation_status')
    && !runner.includes('/rest/v1/rpc/generate_due_program_items_v2')
    && runner.includes("($keys -join '|') -cne 'has_due|local_date|notification_needed|task_needed'")
    && runner.includes('$status.has_due -isnot [bool] -or $status.has_due -ne $false')
    && runner.includes('$status.task_needed -isnot [bool] -or $status.task_needed -ne $false')
    && runner.includes('$status.notification_needed -isnot [bool] -or $status.notification_needed -ne $false')
    && runner.includes("$status.local_date -cne '2027-07-07'")
    && runner.replace(/\r\n?/g, '\n').includes(`\n        ${noDueCall}\n`)
    && occurrences(browser, "const network = await fence(page, ['mark_program_pass_applied'])") === 1
    && browser.includes('createSeasonRequestClassifier({ targetMutationRpcs, blockUnexpectedNonReadRequests: true })')
    && !browser.includes('generate_due_program_items_v2')
  assert(exactNoDueStartupContract(disposableSource, browserProofSource), 'The focused runner must prove no due startup write before the browser while the browser keeps its strict RPC fence.')
  const noDueStartupMutations = [
    { name: 'omit pre-browser no-due call', runner: disposableSource.replace(`        ${noDueCall}`, '        # omitted no-due assertion'), browser: browserProofSource },
    { name: 'weaken has_due false assertion', runner: disposableSource.replace('$status.has_due -isnot [bool] -or $status.has_due -ne $false', '$status.has_due -isnot [bool] -or $status.has_due -eq $false'), browser: browserProofSource },
    { name: 'replace status RPC with startup writer', runner: disposableSource.replaceAll('/rest/v1/rpc/program_due_generation_status', '/rest/v1/rpc/generate_due_program_items_v2'), browser: browserProofSource },
    { name: 'allowlist startup writer', runner: disposableSource, browser: browserProofSource.replace("['mark_program_pass_applied']", "['mark_program_pass_applied', 'generate_due_program_items_v2']") },
    { name: 'disable strict non-read fence', runner: disposableSource, browser: browserProofSource.replace('blockUnexpectedNonReadRequests: true', 'blockUnexpectedNonReadRequests: false') },
  ]
  assert(noDueStartupMutations.length === 5, 'The CW-2 no-due startup mutation block is incomplete.')
  for (const mutation of noDueStartupMutations) assert(!exactNoDueStartupContract(mutation.runner, mutation.browser), `The ${mutation.name} mutation must turn the owning contract red.`)
  for (const marker of ['CONNECT_WORKFLOWS_CW2_MIGRATION_ROLLBACK_PASS', 'CONNECT_WORKFLOWS_CW2_DISPOSABLE_PASS', 'verify-maple-august-december-disposable.ps1', 'verify-north-fork-disposable.ps1', 'verify-prairie-spray-disposable.ps1', 'verify-harvest-ridge-disposable.ps1', 'verify-cedar-creek-disposable.ps1', 'verify-pine-hill-disposable.ps1']) assert(disposableSource.includes(marker), `The CW-2 disposable runner is missing ${marker}.`)
  assert(!disposableSource.includes('npm run verify:season'), 'The CW-2 runner must not mislabel the static season contract as six-scenario runtime proof.')
  const snapshotMarkers = ["class.relkind in ('r','p')", "md5(coalesce(string_agg(to_jsonb(source)::text", 'insert into cw2_proof.browser_baseline', 'create temporary table cw2_browser_after as', "array['assigned_program_pass_products','assigned_program_passes','program_inventory_matches','repository_write_receipts']", "baseline.table_name <> all(v_changed)"]
  const completeBrowserSnapshot = (fixture: string, verify: string) => snapshotMarkers.slice(0, 3).every((marker) => fixture.includes(marker)) && snapshotMarkers.slice(3).every((marker) => verify.includes(marker))
  assert(completeBrowserSnapshot(fixtureProofSource, sqlProofSource), 'The browser proof must bracket the save with deterministic snapshots of every public base/partitioned table and an exact four-table whitelist.')
  for (const marker of snapshotMarkers) { const fixtureMutation = fixtureProofSource.replace(marker, 'CW2_REMOVED_SNAPSHOT_GUARD'); const verifyMutation = sqlProofSource.replace(marker, 'CW2_REMOVED_SNAPSHOT_GUARD'); assert(!completeBrowserSnapshot(fixtureMutation, verifyMutation), `Removing browser snapshot guard ${marker} must turn the mutation red.`) }
  for (const marker of ['CW2 browser positive wrote application records or products', 'CW2 browser changed a public table outside the exact four-table whitelist', 'CW2 stored fingerprint does not match the independent complete request oracle', 'CW2 exact or conflicting replay changed public state', 'CW2 legacy fingerprint-less receipt confirmed a match or wrote state', 'CW2 accepted-bound isolation rollback', 'CW2 legacy create/link behavior changed Inventory or failed to apply', 'CW2 late failure did not roll back the atomic transaction', 'CW2 API role directly wrote the match ledger', 'CW2 case-only Inventory name match did not fail with zero writes', '0.00000001::numeric', '9999999.99999999::numeric', '10000000::numeric', 'CONNECT_WORKFLOWS_CW2_BASE_SQL_PASS']) assert(sqlProofSource.includes(marker), `The focused base SQL proof is missing ${marker}.`)
  for (const marker of ['canceling statement due to lock timeout', "<> 'UPDATE 1'", 'cw2_catalog_writer', 'CONNECT_WORKFLOWS_CW2_SQL_PASS']) assert(concurrencyProofSource.includes(marker), `The focused concurrency SQL proof is missing ${marker}.`)
  assert(browserProofSource.includes("test('@connect-workflows-cw2 exact Program match changes Inventory only after explicit no-record confirmation'") && browserProofSource.includes("fill('0.001')") && browserProofSource.includes("toHaveText('19.999 gal')") && browserProofSource.includes("toEqual(['mark_program_pass_applied'])") && browserProofSource.includes("getByText(/exact Inventory match will reduce on hand/i)).toHaveCount(0)") && browserProofSource.includes("not.toContainText('NaN')"), 'The Cedar browser proof must cover the blank checked intermediate state, one confirmed 0.001 draw, and its exact reloaded shelf result.')
  assert(browserConfigSource.includes('grep: /@connect-workflows-cw2/') && browserConfigSource.includes("baseURL: 'http://127.0.0.1:4187'") && browserConfigSource.includes('FARMRX_CW2_VIEWPORT'), 'The dedicated CW-2 desktop/phone browser lane must remain isolated on governed port 4187.')

  const diagnosticPowerShell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
  const diagnosticSelfTest = spawnSync(diagnosticPowerShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/verify-connect-workflows-cw2-disposable.ps1', '-DiagnosticSelfTest'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' })
  const diagnosticSelfTestText = `${diagnosticSelfTest.stdout ?? ''}\n${diagnosticSelfTest.stderr ?? ''}`
  assert(diagnosticSelfTest.status === 0 && diagnosticSelfTestText.includes('CONNECT_WORKFLOWS_CW2_DIAGNOSTIC_SELFTEST_PASS'), `The executable CW-2 SQL diagnostic self-test failed closed: ${diagnosticSelfTestText}`)

  console.log('Program Inventory CW2 regression passed')
}
void run()
