import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EquipmentCostImporter } from '../../src/ProfitabilityModule'
import type { CropBudget, EquipmentCostSnapshotPreview, EquipmentCostSnapshotRequest, ProfitabilityEquipment } from '../../src/data/profitability'
import '../../src/styles/app.css'

const farmId = '20000000-0000-4000-8000-000000000001'
const budgetId = '20000000-0000-4000-8000-000000000002'
const equipmentId = '20000000-0000-4000-8000-000000000003'
const stamp = '2027-12-31T12:00:00.000000+00:00'
const budget: CropBudget = { id: budgetId, farm_id: farmId, crop_year: 2027, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, name: '2027 Corn', expected_yield_per_acre: 200, expected_price_per_bushel: 4.5, rp_coverage_pct: null, rp_aph_yield: null, rp_projected_price: null, rp_premium_per_acre: null, copied_from_budget_id: null, created_at: stamp, updated_at: stamp }
const equipment: ProfitabilityEquipment[] = [{ id: equipmentId, farm_id: farmId, name: 'North Proof Sprayer', status: 'active' }]

function Harness() {
  const [saved, setSaved] = useState(0)
  const [error, setError] = useState('')
  const [lastAction, setLastAction] = useState('none')
  const repository = {
    async previewEquipmentCostSnapshot(request: EquipmentCostSnapshotRequest): Promise<EquipmentCostSnapshotPreview> {
      return {
        candidate: { line_id: request.line_id, budget_id: request.budget_id, equipment_id: request.equipment_id, equipment_name: 'North Proof Sprayer', category: 'repairs', label: 'North Proof Sprayer service costs 2027-01-01 to 2027-12-31', amount_per_acre: String(300.75 / request.allocation_acres), period_start: request.period_start, period_end: request.period_end, total_source_amount: '300.75', allocation_acres: String(request.allocation_acres), included_row_count: 2, excluded_null_cost_count: 1, captured_at: stamp },
        existing: null,
      }
    },
    async saveEquipmentCostSnapshot(request: EquipmentCostSnapshotRequest, action: 'insert' | 'replace') {
      if (request.expected?.total_source_amount !== '300.75' || request.expected.included_row_count !== 2 || request.expected.excluded_null_cost_count !== 1) throw new Error('review fence failed')
      setSaved((value) => value + 1)
      setLastAction(action)
      return 'saved' as const
    },
  }
  return (
    <div className="app-content">
      <h1>Equipment cost browser proof</h1>
      <p data-testid="harness-state">Saved snapshots: {saved}; last action: {lastAction}</p>
      {error && <p role="alert">{error}</p>}
      <EquipmentCostImporter budget={budget} equipment={equipment} budgetAcres={100} onSaved={async () => undefined} onError={setError} repository={repository} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
