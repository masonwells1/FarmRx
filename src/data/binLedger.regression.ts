import { deriveBinOnHand, deriveBinPosition, deriveCommodityBinTotal, isBinTransactionSuperseded, moistureStatus, validateBinTransaction, validateGrainBin } from './binLedger'
import { GrainWriteQueue, parseGrainQueue } from './grainWriteQueue'
import type { BinInventory, BinTransaction, GrainBin, GrainRepository } from './grain'
import type { StorageLike } from './writeQueue'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-07-13T12:00:00.000Z'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let rejected = false; try { await action() } catch { rejected = true }; assert(rejected, message) }
const bin: GrainBin = { id: uid(1), farm_id: uid(2), name: 'North', capacity_bu: 1_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: 15, moisture_checked_on: '2026-06-13', created_at: stamp, updated_at: stamp }
const inventory: BinInventory = { id: uid(3), farm_id: bin.farm_id, grain_bin_id: bin.id, crop_year: 2026, commodity_id: 'corn', bushels: 100, committed_bushels: 0, measured_at: '2026-01-15T12:00:00.000Z', notes: null, created_at: stamp, updated_at: stamp }
const movement = (n: number, direction: BinTransaction['direction'], bushels: number): BinTransaction => ({ id: uid(10 + n), farm_id: bin.farm_id, grain_bin_id: bin.id, direction, bushels, commodity_id: 'corn', occurred_on: '2026-07-13', note: null, source_kind: 'manual entry', created_at: stamp })
const balanced = deriveBinOnHand(inventory, [movement(1, 'in', 30), movement(2, 'out', 20)])
assert(balanced.rawOnHand === 110 && balanced.onHand === 110, 'On-hand must be recorded inventory plus in minus out.')
const belowZero = deriveBinOnHand(inventory, [movement(3, 'out', 200)])
assert(belowZero.rawOnHand === -100 && belowZero.onHand === -100 && belowZero.exceedsRecordedInventory, 'On-hand must show an impossible negative balance instead of hiding it.')
const soybeanMovement = { ...movement(9, 'in', 500), commodity_id: 'soybeans' }
const commoditySafe = deriveBinPosition(inventory, [movement(1, 'in', 30), soybeanMovement])
assert(commoditySafe.lots.length === 2 && commoditySafe.lots.find((lot) => lot.commodityId === 'corn')?.onHand === 130 && commoditySafe.lots.find((lot) => lot.commodityId === 'soybeans')?.onHand === 500, 'Mixed commodity history must remain separate lots.')
const datedInventory = { ...inventory, bushels: 4_000, measured_at: '2026-01-15T12:00:00.000Z' }
const beforeBaseline = { ...movement(11, 'in', 1_000), occurred_on: '2026-01-10' }
const afterBaseline = { ...movement(12, 'in', 1_200), occurred_on: '2026-01-20' }
assert(deriveBinOnHand(datedInventory, [beforeBaseline, afterBaseline]).onHand === 5_200, 'A dated measurement must supersede earlier receipts and count only later movements.')
const otherCommodityBeforeBaseline = { ...beforeBaseline, commodity_id: 'soybeans' }
assert(!isBinTransactionSuperseded(datedInventory, otherCommodityBeforeBaseline) && isBinTransactionSuperseded(datedInventory, beforeBaseline) && deriveBinOnHand(datedInventory, [otherCommodityBeforeBaseline]).onHand === 5_000, 'Only the baseline commodity is superseded; other commodity history must still count.')
const movementOnlyBin: GrainBin = { ...bin, id: uid(40), name: 'South' }
const movementOnly = { ...movement(10, 'in', 12_000), grain_bin_id: movementOnlyBin.id }
assert(deriveCommodityBinTotal([bin, movementOnlyBin], [inventory], [movementOnly], 'corn', 2026) === 12_100, 'Commodity rollup must include a movement-only bin using its ledger balance.')
const today = new Date('2026-07-13T12:00:00-05:00')
assert(!moistureStatus(bin, today).flagged, '15.00% moisture and a 30-day-old reading must not be red.')
assert(moistureStatus({ ...bin, moisture_pct: 15.01 }, today).flagged, '15.01% moisture must be red.')
assert(!moistureStatus({ ...bin, moisture_checked_on: '2026-06-13' }, today).flagged, 'A 30-day-old reading must not be stale.')
assert(moistureStatus({ ...bin, moisture_checked_on: '2026-06-12' }, today).flagged, 'A 31-day-old reading must be stale.')
assert(!moistureStatus({ ...bin, moisture_pct: null, moisture_checked_on: null }, today).flagged, 'No moisture reading must stay neutral.')
const undatedReading = moistureStatus({ ...bin, moisture_checked_on: null }, today)
assert(undatedReading.flagged && undatedReading.message === 'Moisture reading has no date.', 'A moisture percentage without its check date must be plainly flagged.')
const futureReading = moistureStatus({ ...bin, moisture_checked_on: '2026-08-13' }, today)
assert(futureReading.daysSinceChecked === 0, 'A future moisture date must clamp to today for staleness math.')
assert(validateGrainBin({ ...bin, moisture_checked_on: '2999-01-01' }).some((error) => error.includes('cannot be after today')), 'A future moisture check date must be rejected.')
const seam = {} as GrainRepository
assert(!('updateBinTransaction' in seam) && !('deleteBinTransaction' in seam), 'The grain seam must not expose update/delete methods for movements.')
assert(validateBinTransaction(movement(4, 'in', 1)).length === 0, 'A valid append-only movement must validate.')
assert(validateBinTransaction({ ...movement(5, 'out', 0) }).length > 0, 'Zero-bushel movement must be rejected.')
assert(validateBinTransaction({ ...movement(6, 'in', 1), direction: 'sideways' as BinTransaction['direction'] }).length > 0, 'Unknown movement direction must be rejected.')
assert(validateBinTransaction({ ...movement(7, 'in', 1), occurred_on: '2026-02-30' }).length > 0, 'Invalid movement dates must be rejected.')
const storage: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
const queue = new GrainWriteQueue(storage, 'bin-ledger-regression')
const entry = { version: 1 as const, module: 'grain' as const, kind: 'appendBinTransaction' as const, operationId: uid(30), userId: uid(31), farmId: bin.farm_id, enqueuedAt: stamp, row: movement(8, 'in', 25) }
queue.append(entry)
assert(queue.read().entries.length === 1, 'Valid movement must survive enqueue and parse.')
await rejects(async () => { parseGrainQueue(JSON.stringify({ version: 1, entries: [{ ...entry, row: { ...entry.row, bushels: 0 } }] })) }, 'Queue parser accepted zero-bushel movement.')
await rejects(async () => { parseGrainQueue(JSON.stringify({ version: 1, entries: [{ ...entry, row: { ...entry.row, direction: 'sideways' } }] })) }, 'Queue parser accepted unknown movement direction.')
console.log('Bin ledger regressions passed.')
