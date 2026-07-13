import type { GrainData } from './grain'
import { writeGrainEnvelope } from './MockGrainRepository'

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
}

regression_fieldsRemainAuthoritativeAfterGrainSave({ production_estimates: [], grain_contracts: [], marketing_plan_targets: [], insurance_units: [], grain_bins: [], bin_inventory: [], cash_bids: [], usda_report_dates: [], marketing_alert_rules: [], grain_alert_settings: null })
console.log('MockGrainRepository regressions passed.')
