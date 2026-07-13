import type { GrainData } from './grain'
import { MockGrainRepository, readGrain, writeGrainEnvelope } from './MockGrainRepository'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }

/**
 * Exact #1 regression sequence: migrate v1 Fields, save Grain, edit Fields,
 * save Grain again. The current Fields edit must survive and grain must never
 * contain a nested Fields copy.
 */
export function regression_fieldsRemainAuthoritativeAfterGrainSave(grain: GrainData): void {
  const migratedV1 = { version: 2, fields: { fields: [{ id: 'field-1', name: 'Before edit' }] } }
  const staleWorkspace = { ...grain, fields: migratedV1.fields }
  const firstGrainSave = writeGrainEnvelope(JSON.stringify(migratedV1), staleWorkspace)
  const afterFieldEdit = JSON.parse(firstGrainSave) as { version: 2; fields: { fields: Array<{ id: string; name: string }> }; grain: GrainData }
  afterFieldEdit.fields.fields[0].name = 'Edited in Fields'
  const secondGrainSave = writeGrainEnvelope(JSON.stringify(afterFieldEdit), { ...grain, fields: migratedV1.fields })
  const result = JSON.parse(secondGrainSave) as { fields: { fields: Array<{ name: string }> }; grain: GrainData & { fields?: unknown } }
  assert(result.fields.fields[0].name === 'Edited in Fields', 'Grain save overwrote the authoritative Fields edit.')
  assert(!('fields' in result.grain), 'Grain payload contains a forbidden nested Fields copy.')
  assert(Array.isArray(result.grain.firm_offers), 'Mock grain persistence must retain the firm-offer slice.')
}

regression_fieldsRemainAuthoritativeAfterGrainSave({ production_estimates: [], grain_contracts: [], marketing_plan_targets: [], insurance_units: [], grain_bins: [], bin_inventory: [], bin_transactions: [], cash_bids: [], usda_report_dates: [], marketing_alert_rules: [], firm_offers: [], grain_alert_settings: null })
const oldGrain = { production_estimates: [{ id: 'kept-estimate' }], grain_contracts: [{ id: 'kept-contract' }], marketing_plan_targets: [], insurance_units: [], grain_bins: [], bin_inventory: [], cash_bids: [], marketing_alert_rules: [] }
const migratedOldGrain = readGrain(oldGrain)
assert(migratedOldGrain?.production_estimates[0]?.id === 'kept-estimate' && migratedOldGrain.grain_contracts[0]?.id === 'kept-contract' && migratedOldGrain.firm_offers.length === 0, 'An older local Grain envelope without firm_offers must retain its existing data and add an empty offer list.')
assert(typeof MockGrainRepository.prototype.upsertGrainBin === 'function' && typeof MockGrainRepository.prototype.appendBinTransaction === 'function', 'Mock grain repository must expose the bin and append-only movement seam.')
console.log('MockGrainRepository regressions passed.')
