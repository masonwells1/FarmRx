import { useEffect } from 'react'
import type { Field } from './data/fields'
import type { BudgetCostLine, CropBudget, ProfitabilityWorkspace } from './data/profitability'
import { budgetAnalysis, equivalentCashRentForScenario, fieldAdjustedCostPerAcre, latestArrangementForCropYear, matrixProfitPerAcre, totalCostPerAcre } from './data/profitabilityCalculations'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const categoryLabels: Record<string, string> = { seed: 'Seed', chemical: 'Chemical', fertilizer: 'Fertilizer', fuel: 'Fuel', repairs: 'Repairs', labor: 'Labor', land: 'Land', crop_insurance: 'Crop insurance', equipment_depreciation: 'Equipment', interest: 'Interest', custom: 'Custom' }

interface ReportFieldRow { field: Field; acres: number; yieldPerAcre: number; price: number; costPerAcre: number; netPerAcre: number }

function reportFieldRows(workspace: ProfitabilityWorkspace, budget: CropBudget, costs: BudgetCostLine[]): ReportFieldRow[] {
  const assignments = workspace.fields.crop_assignments.filter((item) => item.crop_year === budget.crop_year && item.commodity_id === budget.commodity_id)
  return workspace.allocations.filter((item) => item.budget_id === budget.id).flatMap((allocation) => {
    const assignment = assignments.find((item) => item.id === allocation.crop_assignment_id)
    const field = assignment && workspace.fields.fields.find((item) => item.id === assignment.field_id)
    if (!field) return []
    const yieldPerAcre = allocation.expected_yield_override ?? budget.expected_yield_per_acre
    const price = allocation.expected_price_override ?? budget.expected_price_per_bushel
    const arrangement = latestArrangementForCropYear(workspace.fields.arrangements, field.id, budget.crop_year)
    const rent = arrangement ? equivalentCashRentForScenario(arrangement, yieldPerAcre, price, costs) : null
    const costPerAcre = fieldAdjustedCostPerAcre(costs, rent)
    return [{ field, acres: allocation.allocated_acres, yieldPerAcre, price, costPerAcre, netPerAcre: matrixProfitPerAcre(price, yieldPerAcre, costPerAcre) }]
  })
}

export function BankerReport({ workspace, budget, onClose }: { workspace: ProfitabilityWorkspace; budget: CropBudget; onClose: () => void }) {
  const costs = workspace.cost_lines.filter((line) => line.budget_id === budget.id)
  const costsPerAcre = totalCostPerAcre(costs)
  const analysis = budgetAnalysis(budget, costsPerAcre)
  const commodity = workspace.fields.commodities.find((item) => item.id === budget.commodity_id)
  const rows = reportFieldRows(workspace, budget, costs)
  const totalAcres = rows.reduce((sum, row) => sum + row.acres, 0)
  const totalNet = rows.reduce((sum, row) => sum + row.netPerAcre * row.acres, 0)
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="banker-report-layer" role="dialog" aria-modal="true" aria-labelledby="banker-report-title">
    <div className="banker-report-toolbar screen-only">
      <p>Check the numbers, then save. In the print window choose "Save as PDF".</p>
      <div>
        <button className="secondary-action" type="button" onClick={onClose}>Close</button>
        <button className="primary-action" type="button" onClick={() => window.print()}>Save as PDF</button>
      </div>
    </div>
    <article className="banker-report">
      <header className="report-head">
        <div>
          <h1 id="banker-report-title">{workspace.fields.farm.name}</h1>
          <p className="report-subject">Crop budget report · {budget.name}{commodity ? ` · ${commodity.name}` : ''} · {budget.crop_year}</p>
        </div>
        <p className="report-date">Prepared {preparedOn}</p>
      </header>

      <section className="report-kpis" aria-label="Budget summary">
        <div><span>Total cost / acre</span><strong>{money.format(costsPerAcre)}</strong></div>
        <div><span>Break-even price</span><strong>{money.format(analysis.breakevenPricePerBushel)}/bu</strong></div>
        <div><span>Break-even yield</span><strong>{decimal.format(analysis.breakevenYieldPerAcre)} bu/ac</strong></div>
        <div><span>Expected profit / acre</span><strong className={analysis.expectedProfitPerAcre < 0 ? 'negative' : ''}>{money.format(analysis.expectedProfitPerAcre)}</strong></div>
      </section>
      <p className="report-assumption">Assumes {decimal.format(budget.expected_yield_per_acre)} bu/ac at {money.format(budget.expected_price_per_bushel)}/bu. All figures are the farm's own budget projections.</p>

      <section aria-label="Costs per acre">
        <h2>Costs per acre</h2>
        <table>
          <thead><tr><th>Cost</th><th>Category</th><th className="numeric">$ / acre</th><th className="numeric">Bushels to cover</th></tr></thead>
          <tbody>{costs.map((line) => <tr key={line.id}><td>{line.name}</td><td>{categoryLabels[line.category] ?? line.category}</td><td className="numeric">{money.format(line.amount_per_acre)}</td><td className="numeric">{decimal.format(line.amount_per_acre / budget.expected_price_per_bushel)} bu</td></tr>)}</tbody>
        </table>
        <div className="report-total-bar"><span>Total cost / acre</span><strong>{money.format(costsPerAcre)}</strong></div>
      </section>

      {rows.length > 0 && <section aria-label="By field">
        <h2>By field</h2>
        <p className="report-note">Each field uses its own land agreement in place of the budget land line, so land is never counted twice.</p>
        <table>
          <thead><tr><th>Field</th><th className="numeric">Acres</th><th className="numeric">Yield (bu/ac)</th><th className="numeric">Price ($/bu)</th><th className="numeric">Cost / ac</th><th className="numeric">Net / ac</th><th className="numeric">Total net</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.field.id}><td>{row.field.name}</td><td className="numeric">{decimal.format(row.acres)}</td><td className="numeric">{decimal.format(row.yieldPerAcre)}</td><td className="numeric">{money.format(row.price)}</td><td className="numeric">{money.format(row.costPerAcre)}</td><td className={`numeric${row.netPerAcre < 0 ? ' negative' : ''}`}>{money.format(row.netPerAcre)}</td><td className={`numeric${row.netPerAcre < 0 ? ' negative' : ''}`}>{money.format(row.netPerAcre * row.acres)}</td></tr>)}</tbody>
        </table>
        <div className="report-total-bar"><span>Projected net across {decimal.format(totalAcres)} allocated acres</span><strong className={totalNet < 0 ? 'negative' : ''}>{money.format(totalNet)}</strong></div>
      </section>}

      <footer className="report-foot">
        <span className="report-rx" aria-hidden="true">℞</span>
        <span>Prepared with Farm Rx · Powered by Crop RX Solutions</span>
      </footer>
    </article>
  </div>
}
