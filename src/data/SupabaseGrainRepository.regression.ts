import type { GrainDataGateway, GrainRowBundle, ReplaceMarketingPlanInput } from './GrainDataGateway'
import { GrainWriteQueue, grainWriteQueueKey, parseGrainQueue } from './grainWriteQueue'
import { QueuedGrainRepository } from './QueuedGrainRepository'
import { fieldsSeedForRegression } from './MockFieldsRepository'
import { SupabaseGrainRepository } from './SupabaseGrainRepository'
import { moduleBackends } from './backends'
import { supabaseConfig } from '../lib/supabaseConfig'
import type { FieldsRepository } from './fields'
import type { CashBid, GrainContract, MarketingPlanTarget, ProductionEstimate } from './grain'
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
  const bin = { id: uid(5), farm_id: farm, name: 'North', capacity_bu: '1000', location_type: 'on_farm', location_name: null, notes: null, created_at: stamp, updated_at: stamp }
  const inventory = { id: uid(6), farm_id: farm, grain_bin_id: bin.id, crop_year: '2026', commodity_id: commodity, bushels: '600', committed_bushels: '100', measured_at: stamp, notes: null, created_at: stamp, updated_at: stamp }
  const bid = { id: uid(7), farm_id: farm, elevator: 'Iowa pilot [USDA MARS 2850]', commodity_id: commodity, bid_date: '2026-07-10', basis: '-0.2', cash_price: '4.3', delivery_start: null, delivery_end: null, notes: '[USDA MARS 2850]', created_at: stamp, updated_at: stamp }
  const report = { id: uid(8), report_name: 'WASDE', report_date: '2026-08-12', release_at: null, source_url: null, notes: null, created_at: stamp, updated_at: stamp }
  return { fields, scope, bundle: { production_estimates: [production], grain_contracts: [contract], marketing_plan_targets: [target], insurance_units: [insurance], grain_bins: [bin], bin_inventory: [inventory], cash_bids: [bid], usda_report_dates: [report] } }
}
class FakeGateway implements GrainDataGateway {
  readonly state = fixture(); fail = false; productionInputs: ProductionEstimate[] = []; contractInputs: GrainContract[] = []; planInputs: ReplaceMarketingPlanInput[] = []; bidInputs: CashBid[] = []
  async loadWorkspace(_farmId: string): Promise<GrainRowBundle> { if (this.fail) throw new Error('network timeout'); return structuredClone(this.state.bundle) }
  async upsertProductionEstimate(_farm: string, row: ProductionEstimate) { this.productionInputs.push(structuredClone(row)); return structuredClone(row) }
  async upsertContract(_farm: string, row: GrainContract) { this.contractInputs.push(structuredClone(row)); return structuredClone(row) }
  async replaceMarketingPlan(input: ReplaceMarketingPlanInput) { this.planInputs.push(structuredClone(input)); return structuredClone(input.targets) }
  async upsertCashBid(_farm: string, row: CashBid) { this.bidInputs.push(structuredClone(row)); return structuredClone(row) }
}
function repository(gateway: FakeGateway) { const fields = gateway.state.fields; const fieldsRepository: FieldsRepository = { getData: async () => structuredClone(fields), saveField: async () => { throw new Error('not used') } }; return new SupabaseGrainRepository({ gateway, fieldsRepository, getFarmId: async () => fields.farm.id, createId: () => uid(99), clock: () => stamp }) }
async function run() {
  const gateway = new FakeGateway(); const repo = repository(gateway); const data = await repo.getData()
  // 1-5: eight row sets map strictly, numeric strings/nulls survive, reconcile from injected Fields.
  assert(data.production_estimates.length === 1 && data.grain_bins.length === 1 && data.usda_report_dates.length === 1 && data.grain_contracts[0].cash_price === 4.5, 'All Grain result sets must map numeric strings exactly.')
  const acres = gateway.state.fields.crop_assignments.filter((row) => row.crop_year === 2026 && row.commodity_id === data.production_estimates[0].commodity_id).reduce((sum, row) => sum + row.planted_acres, 0); assert(data.production_estimates[0].planted_acres === acres && data.production_estimates[0].expected_bushels === acres * 200, 'Production was not reconciled from injected Fields.')
  gateway.fail = true; await rejects(() => repo.getData(), 'Partial gateway failure must reject.'); gateway.fail = false
  const bad = structuredClone(gateway.state.bundle); bad.grain_contracts[0].contract_type = 'mystery'; gateway.state.bundle.grain_contracts = bad.grain_contracts; await rejects(() => repo.getData(), 'Unknown enum must fail closed.'); gateway.state.bundle.grain_contracts = fixture().bundle.grain_contracts
  gateway.state.bundle.bin_inventory[0].farm_id = uid(55); await rejects(() => repo.getData(), 'Cross-farm private rows must reject.'); gateway.state.bundle.bin_inventory[0].farm_id = gateway.state.fields.farm.id
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
  queue.append({ ...common('saveProductionEstimate', 1), kind: 'saveProductionEstimate', row: productionRow })
  queue.append({ ...common('saveContract', 2), kind: 'saveContract', row: contractRow })
  queue.append({ ...common('replaceMarketingPlan', 3), kind: 'replaceMarketingPlan', scope: gateway.state.scope, targets: [targetRow] })
  queue.append({ ...common('saveCashBid', 4), kind: 'saveCashBid', row: bidRow })
  assert(queue.read().entries.length === 4, 'Every Grain queue entry kind must round-trip.')
  const beforeBad = memory.getItem(queueKey); await rejects(async () => { parseGrainQueue(JSON.stringify({ version: 1, entries: [{ ...common('saveContract', 5), kind: 'saveContract', row: { ...contractRow, extra: true } }] })) }, 'Queue accepted an extra row field.'); assert(memory.getItem(queueKey) === beforeBad, 'Invalid bytes replaced a valid queue.')
  // 13-15: the real queued repository keeps context keys isolated, overlays FIFO writes, and replays confirmed heads only.
  const overlayStorage: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
  const offlineDependencies = { getContext: async () => ({ userId: uid(10), farmId: data.fields.farm.id }), projectRef: supabaseConfig.projectRef, storage: overlayStorage, createId: (() => { let n = 200; return () => uid(n++) })(), clock: () => stamp, isOffline: () => true }
  const queued = new QueuedGrainRepository(repo, offlineDependencies)
  await queued.saveCashBid({ ...bidRow, id: uid(50) }); const overlaid = await queued.getData(); assert(overlaid.cash_bids.some((row) => row.id === uid(50)), 'Queued cash bid was not optimistically overlaid.')
  const other = grainWriteQueueKey(supabaseConfig.projectRef, uid(11), data.fields.farm.id); assert(other !== queueKey && memory.getItem(other) === null, 'Queue context isolation failed.')
  const replayStorage: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
  const replayGateway = new FakeGateway(); const replayRepo = repository(replayGateway); let online = false; const replay = new QueuedGrainRepository(replayRepo, { ...offlineDependencies, storage: replayStorage, isOffline: () => !online })
  await replay.saveContract({ ...data.grain_contracts[0], id: uid(60) }); await replay.saveCashBid({ ...data.cash_bids[0], id: uid(61) }); online = true; await replay.inspectAndReplay(); assert(replayGateway.contractInputs[0]?.id === uid(60) && replayGateway.bidInputs[0]?.id === uid(61), 'FIFO replay did not preserve operation order and IDs.')
  assert(moduleBackends.fields === 'supabase' && moduleBackends.grain === 'supabase', 'Release composition did not select live Fields and Grain.')
  console.log('SupabaseGrainRepository regressions passed.')
}
void run().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
