import type { GrainDataGateway, GrainRowBundle, ReplaceMarketingPlanInput } from './GrainDataGateway'
import { GrainWriteQueue, grainWriteQueueKey, parseGrainQueue } from './grainWriteQueue'
import { QueuedGrainRepository } from './QueuedGrainRepository'
import { fieldsSeedForRegression } from './MockFieldsRepository'
import { SupabaseGrainRepository } from './SupabaseGrainRepository'
import { moduleBackends } from './backends'
import { supabaseConfig } from '../lib/supabaseConfig'
import { getSyncStatus } from './syncStatus'
import { readNeedsAttention } from './needsAttentionStore'
import { isMarsBid, latestBasis } from './basisMath'
import { farmerError } from '../lib/farmerErrors'
import { PRE_BASELINE_BIN_MOVEMENT_MESSAGE } from './binLedger'
import { FILLED_OFFER_DELETE_MESSAGE } from './firmOffers'
import type { FieldsRepository } from './fields'
import type { BinTransaction, CashBid, FirmOffer, GrainAlertSettings, GrainBin, GrainContract, GrainWorkspace, MarketingAlertRule, MarketingPlanTarget, ProductionEstimate } from './grain'
import type { StorageLike } from './writeQueue'

const stamp = '2026-07-11T00:00:00.000Z'; const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }
function fixture() {
  const fields = fieldsSeedForRegression(); const farm = fields.farm.id; const commodity = fields.commodities[0].id; const scope = { farm_id: farm, crop_year: 2026, commodity_id: commodity, operating_entity_id: null, enterprise_label: null }; const base = { ...scope, created_at: stamp, updated_at: stamp }
  const production = { ...base, id: uid(1), planted_acres: '999', aph_yield: '200', expected_bushels: '1', actual_bushels: null, drives_math: 'projected', notes: null }
  const contract = { ...base, id: uid(2), contract_type: 'forward_cash', buyer: 'Buyer', bushels: '100', futures_price: null, basis: null, cash_price: '4.50', delivery_start: '2026-09-01', delivery_end: '2026-10-01', contract_number: null, premium_cents_per_bu: '0', notes: null }
  const target = { ...base, id: uid(3), target_month: '2026-09-01', target_pct_of_production: '20', target_price: '5', breakeven_relative_pct: null, deadline: '2026-09-15', notes: null }
  const insurance = { ...base, id: uid(4), unit_name: 'Enterprise', insured_acres: '10', aph: '200', coverage_level_pct: '80', revenue_guarantee_per_acre: '500', guarantee_per_bu: '2.5', notes: null }
  const bin = { id: uid(5), farm_id: farm, name: 'North', capacity_bu: '1000', location_type: 'on_farm', location_name: null, notes: null, moisture_pct: '15', moisture_checked_on: '2026-07-10', created_at: stamp, updated_at: stamp }
  const inventory = { id: uid(6), farm_id: farm, grain_bin_id: bin.id, crop_year: '2026', commodity_id: commodity, bushels: '600', committed_bushels: '100', measured_at: stamp, notes: null, created_at: stamp, updated_at: stamp }
  const bid = { id: uid(7), farm_id: farm, elevator: 'Iowa pilot [USDA MARS 2850]', commodity_id: commodity, bid_date: '2026-07-10', basis: '-0.2', cash_price: '4.3', delivery_start: null, delivery_end: null, notes: '[USDA MARS 2850]', created_at: stamp, updated_at: stamp }
  const report = { id: uid(8), report_name: 'WASDE', report_date: '2026-08-12', release_at: null, source_url: null, notes: null, created_at: stamp, updated_at: stamp }
  return { fields, scope, bundle: { production_estimates: [production], grain_contracts: [contract], grain_contract_deliveries: [], marketing_plan_targets: [target], insurance_units: [insurance], grain_bins: [bin], bin_inventory: [inventory], bin_transactions: [] as unknown[], cash_bids: [bid], usda_report_dates: [report], marketing_alert_rules: [], firm_offers: [], grain_alert_settings: null } }
}
/** Lets tests perturb what the "server" hands back, independent of what was sent, to prove the repository
 * confirms the canonical response rather than trusting its own request. Unset (null) by default so every
 * existing test keeps its original round-trip behavior. */
type ResponseMutators = { production?: (value: ProductionEstimate) => ProductionEstimate; contract?: (value: GrainContract) => GrainContract; plan?: (value: MarketingPlanTarget[]) => MarketingPlanTarget[]; bid?: (value: CashBid) => CashBid }
class FakeGateway implements GrainDataGateway {
  readonly state: { fields: ReturnType<typeof fixture>['fields']; scope: ReturnType<typeof fixture>['scope']; bundle: GrainRowBundle } = fixture(); fail = false; productionInputs: ProductionEstimate[] = []; contractInputs: GrainContract[] = []; planInputs: ReplaceMarketingPlanInput[] = []; bidInputs: CashBid[] = []; offerInputs: FirmOffer[] = []; fillInputs: Array<{ farmId: string; offerId: string; contract: GrainContract }> = []; deleteOfferIds: string[] = []; binInputs: GrainBin[] = []; movementInputs: BinTransaction[] = []
  mutate: ResponseMutators = {}; throwError: Error | null = null; movementError: Error | null = null; fillError: Error | null = null; fillResponse: { contract: GrainContract; offer: FirmOffer } | null = null
  private guard() { if (this.throwError) throw this.throwError }
  async loadWorkspace(_farmId: string): Promise<GrainRowBundle> { if (this.fail) throw new Error('network timeout'); return structuredClone(this.state.bundle) }
  async upsertProductionEstimate(_farm: string, row: ProductionEstimate) { this.guard(); this.productionInputs.push(structuredClone(row)); const response = structuredClone(row); return this.mutate.production ? this.mutate.production(response) : response }
  async upsertContract(_farm: string, row: GrainContract) { this.guard(); this.contractInputs.push(structuredClone(row)); const response = structuredClone(row); return this.mutate.contract ? this.mutate.contract(response) : response }
  async replaceMarketingPlan(input: ReplaceMarketingPlanInput) { this.guard(); this.planInputs.push(structuredClone(input)); const response = structuredClone(input.targets); return this.mutate.plan ? this.mutate.plan(response) : response }
  async upsertCashBid(_farm: string, row: CashBid) { this.guard(); this.bidInputs.push(structuredClone(row)); const response = structuredClone(row); return this.mutate.bid ? this.mutate.bid(response) : response }
  async upsertMarketingAlertRule(_farm: string, row: MarketingAlertRule) { this.guard(); return structuredClone(row) }
  async deleteMarketingAlertRule(_farm: string, _id: string) { this.guard() }
  async upsertFirmOffer(_farm: string, row: FirmOffer) { this.guard(); this.offerInputs.push(structuredClone(row)); return structuredClone(row) }
  async fillFirmOffer(farmId: string, offerId: string, row: GrainContract) { this.fillInputs.push({ farmId, offerId, contract: structuredClone(row) }); if (this.fillResponse) return structuredClone(this.fillResponse); throw this.fillError ?? Object.assign(new Error('function public.fill_firm_offer(uuid,jsonb) does not exist'), { code: '42883' }) }
  async deleteFirmOffer(_farm: string, id: string) { this.guard(); this.deleteOfferIds.push(id) }
  async upsertGrainBin(_farm: string, row: GrainBin) { this.guard(); this.binInputs.push(structuredClone(row)); return structuredClone(row) }
  async appendBinTransactionRpc(_farm: string, row: BinTransaction) { this.guard(); this.movementInputs.push(structuredClone(row)); if (this.movementError) throw this.movementError; const existing = this.state.bundle.bin_transactions.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === row.id) as BinTransaction | undefined; if (existing) { if (existing.farm_id === row.farm_id && existing.grain_bin_id === row.grain_bin_id && existing.direction === row.direction && existing.bushels === row.bushels && existing.commodity_id === row.commodity_id && existing.occurred_on === row.occurred_on && existing.note === row.note && existing.source_kind === row.source_kind) return structuredClone(existing); throw new Error('Movement id was already used with different content.') } this.state.bundle.bin_transactions = [...this.state.bundle.bin_transactions, structuredClone(row)]; return structuredClone(row) }
  async appendContractDeliveryRpc(_farm: string, row: { id: string; farm_id: string; grain_contract_id: string; bushels: number; delivered_on: string; note: string | null }, _allow: boolean) { const existing = this.state.bundle.grain_contract_deliveries.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === row.id) as typeof row | undefined; if (existing) { if (existing.farm_id === row.farm_id && existing.grain_contract_id === row.grain_contract_id && existing.bushels === row.bushels && existing.delivered_on === row.delivered_on && existing.note === row.note) return structuredClone(existing); throw new Error('Delivery id was already used with different content.') } this.state.bundle.grain_contract_deliveries = [...this.state.bundle.grain_contract_deliveries, structuredClone(row)]; return structuredClone(row) }
  async finalizeContractPriceLegRpc(_farm: string, contractId: string, leg: 'futures_price' | 'basis', value: number) { const raw = this.state.bundle.grain_contracts.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === contractId) as Record<string, unknown> | undefined; if (!raw) throw new Error('missing contract'); if (raw[leg] !== null) throw new Error('already finalized'); const future = leg === 'futures_price' ? value : Number(raw.futures_price); const basis = leg === 'basis' ? value : Number(raw.basis); const saved = { ...raw, futures_price: future, basis, cash_price: future + basis + Number(raw.premium_cents_per_bu) / 100, updated_at: stamp }; this.state.bundle.grain_contracts = this.state.bundle.grain_contracts.map((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === contractId ? saved : item); return structuredClone(saved) }
  async upsertGrainAlertSettings(_farm: string, row: GrainAlertSettings) { this.guard(); return structuredClone(row) }
}
function repository(gateway: FakeGateway) { const fields = gateway.state.fields; const fieldsRepository: FieldsRepository = { getData: async () => structuredClone(fields), saveField: async () => { throw new Error('not used') } }; return new SupabaseGrainRepository({ gateway, fieldsRepository, getFarmId: async () => fields.farm.id, createId: () => uid(99), clock: () => stamp }) }
async function run() {
  const gateway = new FakeGateway(); const repo = repository(gateway); const data = await repo.getData()
  // 1-5: eight row sets map strictly, numeric strings/nulls survive, reconcile from injected Fields.
  assert(data.production_estimates.length === 1 && data.grain_bins.length === 1 && data.usda_report_dates.length === 1 && data.grain_contracts[0].cash_price === 4.5, 'All Grain result sets must map numeric strings exactly.')
  const acres = gateway.state.fields.crop_assignments.filter((row) => row.crop_year === 2026 && row.commodity_id === data.production_estimates[0].commodity_id).reduce((sum, row) => sum + row.planted_acres, 0); assert(data.production_estimates[0].planted_acres === acres && data.production_estimates[0].expected_bushels === acres * 200, 'Production was not reconciled from injected Fields.')
  gateway.fail = true; await rejects(() => repo.getData(), 'Partial gateway failure must reject.'); gateway.fail = false
  const bad = structuredClone(gateway.state.bundle) as { grain_contracts: Array<Record<string, unknown>> }; bad.grain_contracts[0].contract_type = 'mystery'; gateway.state.bundle.grain_contracts = bad.grain_contracts; await rejects(() => repo.getData(), 'Unknown enum must fail closed.'); gateway.state.bundle.grain_contracts = fixture().bundle.grain_contracts
  const firstInventory = gateway.state.bundle.bin_inventory[0] as Record<string, unknown>; firstInventory.farm_id = uid(55); await rejects(() => repo.getData(), 'Cross-farm private rows must reject.'); firstInventory.farm_id = gateway.state.fields.farm.id
  // 6-10: all persistence shapes bind the farm and preserve client IDs.
  const production = data.production_estimates[0]; await repo.saveProductionEstimate({ ...production, farm_id: uid(88), planted_acres: 1, expected_bushels: 1 }); assert(gateway.productionInputs[0].farm_id === data.fields.farm.id && gateway.productionInputs[0].id === production.id && gateway.productionInputs[0].expected_bushels === acres * production.aph_yield, 'Production save did not bind farm and derived totals.')
  await repo.saveContract(data.grain_contracts[0]); assert(gateway.contractInputs[0].id === data.grain_contracts[0].id, 'Contract upsert lost its stable id.')
  await rejects(() => repo.saveContract({ ...data.grain_contracts[0], cash_price: null }), 'Invalid contract shape was accepted.')
  const changed: MarketingPlanTarget = { ...data.marketing_plan_targets[0], target_pct_of_production: 25 }; await repo.saveMarketingPlanTarget(changed); assert(gateway.planInputs.at(-1)?.targets.length === 1 && gateway.planInputs.at(-1)?.targets[0].id === changed.id, 'Single target edit did not become a complete scoped plan.')
  await repo.replaceMarketingPlanTargets(data.marketing_plan_targets[0], []); assert(gateway.planInputs.at(-1)?.targets.length === 0, 'Empty plan replacement was not passed to the RPC.')
  await repo.saveCashBid(data.cash_bids[0]); assert(gateway.bidInputs[0].farm_id === data.fields.farm.id && gateway.bidInputs[0].notes === '[USDA MARS 2850]', 'Cash bid save lost farm/provenance.')
  // 11: live failure stays live and no mock storage is involved.
  gateway.fail = true; await rejects(() => repo.getData(), 'Live failure must never become a mock success.'); gateway.fail = false
  const queueKey = grainWriteQueueKey(supabaseConfig.projectRef, uid(10), data.fields.farm.id); assert(queueKey.startsWith('farm-rx-grain-write-queue:v1:') && !queueKey.includes('farm-rx-write-queue:v1:'), 'Grain queue key is not isolated.')
  await rejects(async () => { parseGrainQueue('{bad') }, 'Corrupt Grain queue bytes were accepted.')
  await rejects(async () => { parseGrainQueue(JSON.stringify({ version: 2, entries: [] })) }, 'Unknown Grain queue version was accepted.')
  // 12: all four strict entry kinds round-trip before any bytes are written.
  const memory: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
  const queue = new GrainWriteQueue(memory, queueKey)
  const productionRow = data.production_estimates[0]; const contractRow = data.grain_contracts[0]; const targetRow = data.marketing_plan_targets[0]; const bidRow = data.cash_bids[0]
  const common = (kind: 'saveProductionEstimate' | 'saveContract' | 'replaceMarketingPlan' | 'saveCashBid', n: number) => ({ version: 1 as const, module: 'grain' as const, kind, operationId: uid(100 + n), userId: uid(10), farmId: data.fields.farm.id, enqueuedAt: stamp })
  const productionEntry = { ...common('saveProductionEstimate', 1), kind: 'saveProductionEstimate' as const, row: productionRow }; queue.append(productionEntry)
  queue.append({ ...common('saveContract', 2), kind: 'saveContract', row: contractRow })
  queue.append({ ...common('replaceMarketingPlan', 3), kind: 'replaceMarketingPlan', scope: gateway.state.scope, targets: [targetRow] })
  queue.append({ ...common('saveCashBid', 4), kind: 'saveCashBid', row: bidRow })
  queue.append(productionEntry)
  assert(queue.read().entries.length === 4, 'Appending the same Grain operationId twice must retain exactly one queue entry.')
  const beforeBad = memory.getItem(queueKey); await rejects(async () => { parseGrainQueue(JSON.stringify({ version: 1, entries: [{ ...common('saveContract', 5), kind: 'saveContract', row: { ...contractRow, extra: true } }] })) }, 'Queue accepted an extra row field.'); assert(memory.getItem(queueKey) === beforeBad, 'Invalid bytes replaced a valid queue.')
  // 13-15: the real queued repository keeps context keys isolated, overlays FIFO writes, and replays confirmed heads only.
  const overlayStorage: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
  const offlineDependencies = { getContext: async () => ({ userId: uid(10), farmId: data.fields.farm.id }), projectRef: supabaseConfig.projectRef, storage: overlayStorage, createId: (() => { let n = 200; return () => uid(n++) })(), clock: () => stamp, isOffline: () => true }
  const queued = new QueuedGrainRepository(repo, offlineDependencies)
  assert(await queued.getNeedsAttentionQueueKey() === queueKey, 'Grain attention discovery must use only the exact current user and farm queue key.')
  await queued.saveCashBid({ ...bidRow, id: uid(50) }); const overlaid = await queued.getData(); assert(overlaid.cash_bids.some((row) => row.id === uid(50)), 'Queued cash bid was not optimistically overlaid.')
  const other = grainWriteQueueKey(supabaseConfig.projectRef, uid(11), data.fields.farm.id); assert(other !== queueKey && memory.getItem(other) === null, 'Queue context isolation failed.')
  const replayStorage: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
  const replayGateway = new FakeGateway(); const replayRepo = repository(replayGateway); let online = false; const replay = new QueuedGrainRepository(replayRepo, { ...offlineDependencies, storage: replayStorage, isOffline: () => !online })
  await replay.saveContract({ ...data.grain_contracts[0], id: uid(60) }); await replay.saveCashBid({ ...data.cash_bids[0], id: uid(61) }); online = true; await replay.inspectAndReplay(); assert(replayGateway.contractInputs[0]?.id === uid(60) && replayGateway.bidInputs[0]?.id === uid(61), 'FIFO replay did not preserve operation order and IDs.')
  // 16: movements must never enter the offline queue; capacity needs the locked RPC.
  const binQueueKey = grainWriteQueueKey(supabaseConfig.projectRef, uid(10), data.fields.farm.id)
  const offlineBinStorage: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
  const offlineBinGateway = new FakeGateway(); const offlineBinWriter = repository(offlineBinGateway); let binsOnline = false
  const offlineBins = new QueuedGrainRepository(offlineBinWriter, { ...offlineDependencies, storage: offlineBinStorage, isOffline: () => !binsOnline })
  const queuedMovement: BinTransaction = { id: uid(62), farm_id: data.fields.farm.id, grain_bin_id: data.grain_bins[0].id, direction: 'in', bushels: 25, commodity_id: data.fields.commodities[0].id, occurred_on: '2026-07-12', note: null, source_kind: 'manual entry', created_at: stamp }
  let offlineMovementMessage = ''
  try { await offlineBins.appendBinTransaction(queuedMovement) } catch (error) { offlineMovementMessage = error instanceof Error ? error.message : '' }
  assert(offlineMovementMessage === 'Bin movements need a connection.' && new GrainWriteQueue(offlineBinStorage, binQueueKey).read().entries.length === 0, 'Offline movements must be refused and never queued.')
  binsOnline = false
  const queuedBin: GrainBin = { ...data.grain_bins[0], id: uid(63), name: 'Queued bin' }
  await offlineBins.upsertGrainBin(queuedBin)
  assert((await offlineBins.getData()).grain_bins.filter((row) => row.id === queuedBin.id).length === 1 && new GrainWriteQueue(offlineBinStorage, binQueueKey).read().entries.length === 1, 'An offline bin upsert must overlay and queue once.')
  binsOnline = true; await offlineBins.inspectAndReplay()
  assert(offlineBinGateway.binInputs.some((row) => row.id === queuedBin.id) && new GrainWriteQueue(offlineBinStorage, binQueueKey).read().entries.length === 0, 'A queued bin upsert must replay and drain.')
  // 18: canonical-confirmation rejections — the repository must confirm the server's echoed rows, never trust its own request.
  const baseTarget = data.marketing_plan_targets[0]
  gateway.mutate.plan = (rows) => rows.map((row) => ({ ...row, id: uid(940) }))
  await rejects(() => repo.replaceMarketingPlanTargets(gateway.state.scope, [baseTarget]), 'A plan response with a wrong id must reject.')
  gateway.mutate = {}
  gateway.mutate.plan = (rows) => rows.map((row) => ({ ...row, commodity_id: `${row.commodity_id}-other` }))
  await rejects(() => repo.replaceMarketingPlanTargets(gateway.state.scope, [baseTarget]), 'A plan response with a wrong scope must reject.')
  gateway.mutate = {}
  const twoTargets: MarketingPlanTarget[] = [{ ...baseTarget, id: uid(941), target_month: '2026-09-01', target_pct_of_production: 10 }, { ...baseTarget, id: uid(942), target_month: '2026-10-01', target_pct_of_production: 10 }]
  gateway.mutate.plan = (rows) => rows.slice(0, 1)
  await rejects(() => repo.replaceMarketingPlanTargets(gateway.state.scope, twoTargets), 'An incomplete plan response (fewer rows than submitted) must reject.')
  gateway.mutate = {}
  gateway.mutate.plan = (rows) => [...rows, ...rows]
  await rejects(() => repo.replaceMarketingPlanTargets(gateway.state.scope, [baseTarget]), 'A duplicated plan response (repeated rows) must reject.')
  gateway.mutate = {}
  // 17: a poisoned replay is parked locally and later FIFO entries are not wedged.
  const retentionStorage: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
  const retentionGateway = new FakeGateway(); const retentionWriter = repository(retentionGateway)
  let retentionOnline = false
  const retentionKey = grainWriteQueueKey(supabaseConfig.projectRef, uid(10), data.fields.farm.id)
  const retentionRepo = new QueuedGrainRepository(retentionWriter, { getContext: async () => ({ userId: uid(10), farmId: data.fields.farm.id }), projectRef: supabaseConfig.projectRef, storage: retentionStorage, createId: (() => { let n = 300; return () => uid(n++) })(), clock: () => stamp, isOffline: () => !retentionOnline })
  await retentionRepo.saveContract({ ...data.grain_contracts[0], id: uid(950) })
  assert(new GrainWriteQueue(retentionStorage, retentionKey).read().entries.length === 1, 'Setup for the queue-retention test failed to enqueue offline.')
  retentionGateway.mutate.contract = (row) => ({ ...row, id: uid(951) })
  retentionOnline = true
  await retentionRepo.inspectAndReplay()
  const afterWrongIdReplay = new GrainWriteQueue(retentionStorage, retentionKey).read().entries
  assert(afterWrongIdReplay.length === 0, 'A canonical-confirmation rejection must not wedge the live FIFO queue.')
  assert((readNeedsAttention(retentionStorage, retentionKey)[0]?.entry as { row: { id: string } }).row.id === uid(950), 'A canonical-confirmation rejection must be retained in the needs-attention receipt store.')
  { const status = getSyncStatus(); assert(status.kind === 'blocked' && status.pending === 1 && status.message === '1 saves need attention.', 'A parked operation must be shown as one save needing attention, not synced.') }
  // 18: a permission-shaped (403) gateway error must classify as blocked, not be retried as a transport failure.
  const permissionStorage: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
  const permissionGateway = new FakeGateway(); const permissionWriter = repository(permissionGateway)
  let permissionOnline = false
  const permissionKey = grainWriteQueueKey(supabaseConfig.projectRef, uid(10), data.fields.farm.id)
  const permissionRepo = new QueuedGrainRepository(permissionWriter, { getContext: async () => ({ userId: uid(10), farmId: data.fields.farm.id }), projectRef: supabaseConfig.projectRef, storage: permissionStorage, createId: (() => { let n = 400; return () => uid(n++) })(), clock: () => stamp, isOffline: () => !permissionOnline })
  await permissionRepo.saveCashBid({ ...data.cash_bids[0], id: uid(960) })
  assert(new GrainWriteQueue(permissionStorage, permissionKey).read().entries.length === 1, 'Setup for the 403 test failed to enqueue offline.')
  permissionGateway.throwError = Object.assign(new Error('permission denied for table grain_cash_bids'), { status: 403 })
  permissionOnline = true
  await permissionRepo.inspectAndReplay()
  const afterForbiddenReplay = new GrainWriteQueue(permissionStorage, permissionKey).read().entries
  assert(afterForbiddenReplay.length === 0, 'A non-transport failure must be parked instead of blocking later saves.')
  assert((readNeedsAttention(permissionStorage, permissionKey)[0]?.entry as { row: { id: string } }).row.id === uid(960), 'A 403/permission-shaped failure must remain available for farmer review.')
  { const status = getSyncStatus(); assert(status.kind === 'blocked' && status.pending === 1 && status.message === '1 saves need attention.', 'A parked failure must be shown as one save needing attention, not synced.') }
  // 19: plan validation must reject over-100% totals and duplicate months before ever reaching the gateway.
  const planCallsBeforeValidation = gateway.planInputs.length
  const overTotalTargets: MarketingPlanTarget[] = [{ ...baseTarget, id: uid(970), target_month: '2026-09-01', target_pct_of_production: 60 }, { ...baseTarget, id: uid(971), target_month: '2026-10-01', target_pct_of_production: 45 }]
  await rejects(() => repo.replaceMarketingPlanTargets(gateway.state.scope, overTotalTargets), 'An over-100% marketing plan must reject.')
  assert(gateway.planInputs.length === planCallsBeforeValidation, 'An over-100% marketing plan reached the gateway; it must reject before that call.')
  const dupMonthTargets: MarketingPlanTarget[] = [{ ...baseTarget, id: uid(972), target_month: '2026-09-01', target_pct_of_production: 10 }, { ...baseTarget, id: uid(973), target_month: '2026-09-01', target_pct_of_production: 10 }]
  await rejects(() => repo.replaceMarketingPlanTargets(gateway.state.scope, dupMonthTargets), 'A duplicate-month marketing plan must reject.')
  assert(gateway.planInputs.length === planCallsBeforeValidation, 'A duplicate-month marketing plan reached the gateway; it must reject before that call.')
  // 20: the extracted basisMath module must exclude MARS feed rows and use manual bids, even when MARS is the newest row.
  const marsRow: CashBid = { ...data.cash_bids[0], id: uid(980), bid_date: '2026-07-20', basis: -0.05 }
  const manualRow: CashBid = { ...data.cash_bids[0], id: uid(981), bid_date: '2026-07-12', basis: -0.18, notes: null }
  const olderManualRow: CashBid = { ...data.cash_bids[0], id: uid(982), bid_date: '2026-07-05', basis: -0.3, notes: null }
  const basisWorkspace: GrainWorkspace = { ...data, cash_bids: [marsRow, manualRow, olderManualRow] }
  assert(isMarsBid(marsRow) && !isMarsBid(manualRow) && !isMarsBid(olderManualRow), 'isMarsBid must classify MARS-tagged and manual rows correctly.')
  assert(latestBasis(basisWorkspace, gateway.state.scope) === manualRow.basis, 'latestBasis must use the latest manual bid and exclude the MARS feed row even when MARS is newest.')
  // 21: firm offers use the same bound-farm save/delete gateway seam and reject an invalid DB-check shape first.
  const offer: FirmOffer = { ...gateway.state.scope, id: uid(990), buyer: 'Buyer', offer_type: 'cash', bushels: 1000, price: 4.5, basis: null, contract_month: null, expires_on: null, delivery_location: null, notes: null, status: 'open', filled_contract_id: null, created_at: stamp, updated_at: stamp }
  let offlineFillMessage = ''
  try { await queued.fillFirmOffer(offer, { ...data.grain_contracts[0], id: uid(994) }) } catch (error) { offlineFillMessage = error instanceof Error ? error.message : '' }
  assert(offlineFillMessage === 'Connect to the internet before filling this offer.' && farmerError(new Error(offlineFillMessage), 'record this firm-offer sale') === offlineFillMessage, 'Offline firm-offer fills must preserve the farmer-facing connection message.')
  await repo.saveFirmOffer(offer)
  assert(gateway.offerInputs.length === 1 && gateway.offerInputs[0].farm_id === data.fields.farm.id && gateway.offerInputs[0].id === offer.id, 'Firm-offer save must bind the active farm and preserve the client ID.')
  const rpcContract = { ...data.grain_contracts[0], id: uid(995) }
  gateway.fillResponse = { contract: rpcContract, offer: { ...offer, status: 'filled', filled_contract_id: rpcContract.id } }
  const fallbackContractWrites = gateway.contractInputs.length; const fallbackOfferWrites = gateway.offerInputs.length
  const rpcFilled = await repo.fillFirmOffer(offer, rpcContract)
  assert(rpcFilled.contract.id === rpcContract.id && rpcFilled.offer.filled_contract_id === rpcContract.id && gateway.fillInputs.length === 1 && gateway.fillInputs[0].farmId === data.fields.farm.id && gateway.contractInputs.length === fallbackContractWrites && gateway.offerInputs.length === fallbackOfferWrites, 'A successful fill_firm_offer RPC must return its contract and offer without any fallback writes.')
  gateway.fillResponse = null
  let missingRpc = ''
  try { await repo.fillFirmOffer(offer, { ...data.grain_contracts[0], id: uid(995) }) } catch (error) { missingRpc = error instanceof Error ? error.message : '' }
  assert(missingRpc === 'FIRM_OFFER_FILL_RPC_UNAVAILABLE', 'Only the specific absent fill_firm_offer RPC error may activate the safe two-write fallback.')
  gateway.fillError = Object.assign(new Error('function public.fill_firm_offer(uuid,jsonb) does not exist'), { code: '500' })
  let serverFailure = ''
  try { await repo.fillFirmOffer(offer, { ...data.grain_contracts[0], id: uid(996) }) } catch (error) { serverFailure = error instanceof Error ? error.message : '' }
  assert(serverFailure !== 'FIRM_OFFER_FILL_RPC_UNAVAILABLE', 'A code-500 error with matching text must not activate the fallback.')
  gateway.fillError = null
  await repo.deleteFirmOffer(offer.id)
  assert(gateway.deleteOfferIds[0] === offer.id, 'Firm-offer delete must target the requested ID.')
  // Audit P3-01: a filled offer is offer-to-contract history and can never be deleted.
  const filledOffer: FirmOffer = { ...offer, id: uid(997), status: 'filled', filled_contract_id: uid(2) }
  ;(gateway.state.bundle.firm_offers as unknown[]).push(structuredClone(filledOffer))
  let filledDeleteMessage = ''
  try { await repo.deleteFirmOffer(filledOffer.id) } catch (error) { filledDeleteMessage = error instanceof Error ? error.message : '' }
  assert(filledDeleteMessage === FILLED_OFFER_DELETE_MESSAGE && !gateway.deleteOfferIds.includes(filledOffer.id), 'Deleting a filled offer must stop with the shared farmer message before any gateway delete.')
  ;(gateway.state.bundle.firm_offers as unknown[]).pop()
  await rejects(() => repo.saveFirmOffer({ ...offer, id: uid(991), price: null }), 'Cash firm offer without price must reject before the gateway.')
  assert(gateway.offerInputs.length === 1, 'Invalid firm offer reached the gateway.')
  // 22: bins are mutable, but movements use the dedicated insert-only append seam.
  const savedBin: GrainBin = data.grain_bins[0]
  await repo.upsertGrainBin({ ...savedBin, moisture_pct: 15.5, moisture_checked_on: '2026-07-12' })
  assert(gateway.binInputs.length === 1 && gateway.binInputs[0].farm_id === data.fields.farm.id && gateway.binInputs[0].moisture_pct === 15.5, 'Bin upsert must bind the active farm and preserve moisture fields.')
  const movement: BinTransaction = { id: uid(992), farm_id: uid(88), grain_bin_id: savedBin.id, direction: 'in', bushels: 25, commodity_id: gateway.state.scope.commodity_id, occurred_on: '2026-07-12', note: 'Scale ticket', source_kind: 'manual entry', created_at: stamp }
  await repo.appendBinTransaction(movement)
  assert(gateway.movementInputs.length === 1 && gateway.movementInputs[0].farm_id === data.fields.farm.id && gateway.movementInputs[0].direction === 'in', 'Movement append must bind the active farm and use the insert-only gateway seam.')
  await repo.appendBinTransaction(movement)
  assert((await repo.getData()).bin_transactions.filter((row) => row.id === movement.id).length === 1, 'Same movement UUID must replay idempotently.')
  await rejects(() => repo.appendBinTransaction({ ...movement, bushels: 26 }), 'A reused movement UUID with changed content must reject.')
  await rejects(() => repo.appendBinTransaction({ ...movement, id: uid(993), bushels: 0 }), 'Zero-bushel movement must reject before the gateway.')
  assert(gateway.movementInputs.filter(() => true).length === 3, 'Invalid movement reached the gateway.')
  // 23: capability errors fail closed with the exact farmer message; no direct-table fallback remains.
  const absentMovementGateway = new FakeGateway(); Object.defineProperty(absentMovementGateway, 'appendBinTransactionRpc', { value: undefined }); let absentMovement = ''
  try { await repository(absentMovementGateway).appendBinTransaction({ ...movement, id: uid(994) }) } catch (error) { absentMovement = error instanceof Error ? error.message : '' }
  assert(absentMovement === 'Bin movements arrive with the next database update.' && absentMovementGateway.movementInputs.length === 0 && farmerError(new Error(absentMovement), 'add this movement') === absentMovement, 'Absent movement RPC must disable the unsafe fallback with the exact message.')
  const absentDeliveryGateway = new FakeGateway(); Object.defineProperty(absentDeliveryGateway, 'appendContractDeliveryRpc', { value: undefined }); let absentDelivery = ''
  try { await repository(absentDeliveryGateway).recordContractDelivery({ id: uid(995), farm_id: data.fields.farm.id, grain_contract_id: data.grain_contracts[0].id, bushels: 1, delivered_on: '2026-07-12', note: null, created_at: stamp }) } catch (error) { absentDelivery = error instanceof Error ? error.message : '' }
  assert(absentDelivery === 'Delivery tracking arrives with the next database update.' && farmerError(new Error(absentDelivery), 'record this delivery') === absentDelivery, 'Missing delivery table/RPC must never leak a retryable generic error.')
  const absentFinalGateway = new FakeGateway(); Object.defineProperty(absentFinalGateway, 'finalizeContractPriceLegRpc', { value: undefined }); let absentFinal = ''
  try { await repository(absentFinalGateway).finalizeContractPriceLeg(data.grain_contracts[0].id, 'basis', -0.2) } catch (error) { absentFinal = error instanceof Error ? error.message : '' }
  assert(absentFinal === 'Price finalization arrives with the next database update.', 'Missing CAS RPC must disable price finalization.')
  // 24: an RPC-capable fake proves signed basis, blank/invalid guards, CAS, and exact replay behavior.
  const casGateway = new FakeGateway(); const rawHta = casGateway.state.bundle.grain_contracts[0] as Record<string, unknown>; rawHta.contract_type = 'hta'; rawHta.futures_price = '5'; rawHta.basis = null; rawHta.cash_price = null
  const casRepo = repository(casGateway); await casRepo.finalizeContractPriceLeg(String(rawHta.id), 'basis', -0.2); assert((casGateway.state.bundle.grain_contracts[0] as Record<string, unknown>).cash_price === 4.8, 'CAS finalization must preserve a negative basis and compute cash price atomically.')
  await rejects(() => casRepo.finalizeContractPriceLeg(String(rawHta.id), 'basis', -0.2), 'CAS must reject an already-finalized leg.')
  await rejects(() => casRepo.finalizeContractPriceLeg(String(rawHta.id), 'futures_price', 0), 'Blank/zero futures finalization must reject before the RPC.')
  const deliveryRepo = repository(new FakeGateway()); const deliveryRow = { id: uid(996), farm_id: data.fields.farm.id, grain_contract_id: data.grain_contracts[0].id, bushels: 25, delivered_on: '2026-07-12', note: null, created_at: stamp }; await deliveryRepo.recordContractDelivery(deliveryRow); await deliveryRepo.recordContractDelivery(deliveryRow); assert((await deliveryRepo.getData()).grain_contract_deliveries.filter((row) => row.id === deliveryRow.id).length === 1, 'Same delivery UUID must replay idempotently.')
  await rejects(() => deliveryRepo.recordContractDelivery({ ...deliveryRow, bushels: 26 }), 'A reused delivery UUID with changed content must reject.')
  const baselineGateway = new FakeGateway(); const baselineRepo = repository(baselineGateway); const baselineMovement = { ...movement, id: uid(997), occurred_on: '2026-07-11' }; let preBaselineMessage = ''; try { await baselineRepo.appendBinTransaction(baselineMovement) } catch (error) { preBaselineMessage = error instanceof Error ? error.message : '' }; assert(preBaselineMessage === PRE_BASELINE_BIN_MOVEMENT_MESSAGE && baselineGateway.movementInputs.length === 0, 'Repository must return the shared pre-baseline message before its RPC.')
  assert(moduleBackends.fields === 'supabase' && moduleBackends.grain === 'supabase', 'Release composition did not select live Fields and Grain.')
  console.log('SupabaseGrainRepository regressions passed.')
}
void run().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
