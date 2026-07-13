import { useEffect } from 'react'
import type { Arrangement, CropAssignment, Field } from './data/fields'
import type { BudgetCostLine, CropBudget, ProfitabilityWorkspace } from './data/profitability'
import type { ProgramsData } from './data/programs'
import { budgetAnalysis, equivalentCashRentForField, equivalentCashRentForScenario, fieldAdjustedCostPerAcre, landlordPaidInputCost, latestArrangementForCropYear, matrixProfitPerAcre, totalCostPerAcre } from './data/profitabilityCalculations'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
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

type LandlordInput = { product: string; rate: string; appliedOn: string }
type LandlordPlanting = {
  assignment: CropAssignment | null
  commodityName: string | null
  budget: CropBudget | null
  costs: BudgetCostLine[]
  inputs: LandlordInput[]
}
type LandlordField = { field: Field; arrangement: Arrangement; plantings: LandlordPlanting[] }
type SettlementScenario = { yieldPerAcre: number | null; pricePerBushel: number | null; cropValue: number | null }

const expenseShares: Array<{ label: string; categories: BudgetCostLine['category'][]; percent: (arrangement: Arrangement) => number }> = [
  { label: 'Seed', categories: ['seed'], percent: (arrangement) => arrangement.landlord_seed_pct },
  { label: 'Fertilizer', categories: ['fertilizer'], percent: (arrangement) => arrangement.landlord_fertilizer_pct },
  { label: 'Chemical', categories: ['chemical'], percent: (arrangement) => arrangement.landlord_chemical_pct },
  { label: 'Fuel', categories: ['fuel'], percent: (arrangement) => arrangement.landlord_fuel_pct },
  { label: 'Labor & custom', categories: ['labor'], percent: (arrangement) => arrangement.landlord_labor_custom_pct },
  { label: 'Crop insurance', categories: ['crop_insurance'], percent: (arrangement) => arrangement.landlord_crop_insurance_pct },
  { label: 'Equipment & repairs', categories: ['equipment_depreciation', 'repairs'], percent: (arrangement) => arrangement.landlord_equipment_pct },
  { label: 'Interest', categories: ['interest'], percent: (arrangement) => arrangement.landlord_interest_pct },
  { label: 'Other inputs', categories: ['custom'], percent: (arrangement) => arrangement.landlord_other_input_pct },
]

function displayDate(value: string | null) {
  if (!value) return null
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function normalizedLandlordName(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function settlementScenario(planting: LandlordPlanting): SettlementScenario {
  const { assignment, budget } = planting
  if (!assignment) return { yieldPerAcre: null, pricePerBushel: null, cropValue: null }
  const harvested = assignment.harvested_bushels
  const yieldPerAcre = harvested === null
    ? assignment.expected_yield_per_acre ?? budget?.expected_yield_per_acre ?? null
    : assignment.planted_acres > 0 ? harvested / assignment.planted_acres : null
  const pricePerBushel = assignment.actual_price_per_bu ?? assignment.expected_price_per_bu ?? budget?.expected_price_per_bushel ?? null
  const cropValue = pricePerBushel === null ? null : harvested !== null
    ? harvested * pricePerBushel
    : yieldPerAcre === null ? null : yieldPerAcre * assignment.planted_acres * pricePerBushel
  return { yieldPerAcre, pricePerBushel, cropValue }
}

function applicationInputsByCropAssignment(programs: ProgramsData | null) {
  const grouped = new Map<string, Map<string, LandlordInput[]>>()
  const add = (cropAssignmentId: string, key: string, inputs: LandlordInput[], replace = false) => {
    const events = grouped.get(cropAssignmentId) ?? new Map<string, LandlordInput[]>()
    const current = events.get(key) ?? []
    const unique = new Map(current.map((input) => [`${input.product}|${input.rate}|${input.appliedOn}`, input]))
    for (const input of inputs) unique.set(`${input.product}|${input.rate}|${input.appliedOn}`, input)
    events.set(key, replace ? inputs : [...unique.values()])
    grouped.set(cropAssignmentId, events)
  }
  for (const record of programs?.applicationRecords ?? []) {
    if (record.status !== 'completed') continue
    add(record.crop_assignment_id, `record:${record.id}`, [{ product: 'Completed application record', rate: `${decimal.format(record.applied_acres)} ac applied`, appliedOn: record.application_date }])
  }
  for (const assignment of programs?.assignments ?? []) {
    for (const pass of assignment.passes.filter((item) => item.status === 'applied' && item.applied_on)) {
      const inputs = pass.products.map((product) => ({
        product: product.actual_product_name ?? product.product_name,
        rate: `${product.actual_rate_text ?? product.rate_text} ${product.actual_unit_text ?? product.unit_text}`.trim(),
        appliedOn: pass.applied_on!,
      }))
      if (!inputs.length) continue
      const key = pass.application_record_id ? `record:${pass.application_record_id}` : `program-pass:${pass.id}`
      add(assignment.id, key, inputs, Boolean(pass.application_record_id))
    }
  }
  return new Map([...grouped].map(([cropAssignmentId, events]) => [cropAssignmentId, [...events.values()].flat()]))
}

function landlordFields(workspace: ProfitabilityWorkspace, selectedBudget: CropBudget, landlordName: string, programs: ProgramsData | null): LandlordField[] {
  const applicationInputs = applicationInputsByCropAssignment(programs)
  return workspace.fields.fields.flatMap((field) => {
    const arrangement = latestArrangementForCropYear(workspace.fields.arrangements, field.id, selectedBudget.crop_year)
    if (!arrangement || normalizedLandlordName(arrangement.landlord_name) !== normalizedLandlordName(landlordName)) return []
    const assignments = workspace.fields.crop_assignments.filter((item) => item.field_id === field.id && item.crop_year === selectedBudget.crop_year).sort((left, right) => left.planting_sequence - right.planting_sequence)
    return [{
      field,
      arrangement,
      plantings: assignments.length ? assignments.map((assignment) => {
        const budget = workspace.budgets.find((item) => item.id === selectedBudget.id && item.commodity_id === assignment.commodity_id && item.crop_year === assignment.crop_year)
          ?? workspace.budgets.filter((item) => item.commodity_id === assignment.commodity_id && item.crop_year === assignment.crop_year).sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null
        return { assignment, commodityName: workspace.fields.commodities.find((item) => item.id === assignment.commodity_id)?.name ?? null, budget, costs: budget ? workspace.cost_lines.filter((line) => line.budget_id === budget.id) : [], inputs: applicationInputs.get(assignment.id) ?? [] }
      }) : [{ assignment: null, commodityName: null, budget: null, costs: [], inputs: [] }],
    }]
  })
}

function LandlordPlantingSection({ planting, arrangement, applicationRecordsAvailable }: { planting: LandlordPlanting; arrangement: Arrangement; applicationRecordsAvailable: boolean }) {
  const { assignment, commodityName, budget, costs, inputs } = planting
  const harvested = assignment?.harvested_bushels ?? null
  const scenario = settlementScenario(planting)
  const cropShare = arrangement.landlord_crop_pct ?? 0
  const expenseRows = expenseShares.map((share) => ({ ...share, percentage: share.percent(arrangement), amount: costs.filter((line) => share.categories.includes(line.category)).reduce((sum, line) => sum + line.amount_per_acre, 0) * (assignment?.planted_acres ?? 0) * share.percent(arrangement) / 100 })).filter((share) => share.percentage > 0)
  const expenseTotal = landlordPaidInputCost(costs, arrangement) * (assignment?.planted_acres ?? 0)
  const hasExpenseShares = expenseRows.length > 0
  const hasBudgetCosts = budget !== null && costs.length > 0
  const cropValueUnavailableMessage = scenario.yieldPerAcre === null && scenario.pricePerBushel === null
    ? 'Record a harvested or projected yield and an actual or projected price to show the crop value.'
    : scenario.yieldPerAcre === null
      ? 'Record a harvested or projected yield to show the crop value.'
      : 'Record an actual or projected price to show the crop value.'
  return <section className="landlord-planting" aria-label={commodityName ?? 'Planting'}>
    <div className="landlord-detail-grid">
      <section><h3>Planting</h3>{assignment ? <dl><div><dt>Crop</dt><dd>{commodityName ?? 'Not recorded'}</dd></div>{assignment.variety && <div><dt>Variety</dt><dd>{assignment.variety}</dd></div>}{assignment.planting_date && <div><dt>Planted</dt><dd>{displayDate(assignment.planting_date)}</dd></div>}<div><dt>Planted acres</dt><dd>{decimal.format(assignment.planted_acres)} ac</dd></div></dl> : <p className="report-note">No planting record for this field yet.</p>}</section>
      <section><h3>Yield</h3>{assignment && (harvested !== null || scenario.yieldPerAcre !== null) ? <dl>{harvested !== null && <div><dt>Harvested</dt><dd>{whole.format(harvested)} bu</dd></div>}<div><dt>{harvested === null ? 'Projected yield' : 'Yield'}</dt><dd>{harvested !== null && assignment.planted_acres <= 0 ? '—' : `${decimal.format(scenario.yieldPerAcre!)} bu/ac`}</dd></div>{assignment.harvest_date && <div><dt>Harvest date</dt><dd>{displayDate(assignment.harvest_date)}</dd></div>}</dl> : <p className="report-note">No yield record for this field yet.</p>}</section>
    </div>
    <section className="landlord-inputs"><h3>Inputs applied</h3>{inputs.length ? <table><thead><tr><th>Product</th><th>Rate</th><th>Date</th></tr></thead><tbody>{inputs.map((input, index) => <tr key={`${input.product}-${input.appliedOn}-${index}`}><td>{input.product}</td><td>{input.rate}</td><td>{displayDate(input.appliedOn)}</td></tr>)}</tbody></table> : <p className="report-note">{applicationRecordsAvailable ? 'No applied product records available for this field in Farm Rx.' : 'Application records could not be loaded.'}</p>}</section>
    {arrangement.arrangement_type === 'crop_share' && <section className="landlord-settlement"><h3>Crop-share settlement</h3>{budget && <p className="report-note">Using budget: {budget.name}</p>}{assignment && scenario.cropValue !== null ? <><table><thead><tr><th>Settlement item</th><th className="numeric">Share</th><th className="numeric">Landlord amount</th></tr></thead><tbody><tr><td>Crop value</td><td className="numeric">{decimal.format(cropShare)}%</td><td className="numeric">{money.format(scenario.cropValue * cropShare / 100)}</td></tr>{hasBudgetCosts && expenseRows.map((row) => <tr key={row.label}><td>{row.label}</td><td className="numeric">{decimal.format(row.percentage)}%</td><td className="numeric">{money.format(row.amount)}</td></tr>)}</tbody></table>{hasBudgetCosts ? <p className="report-total-bar"><span>Landlord share of expenses: {money.format(expenseTotal)} · Landlord share of crop: {decimal.format(cropShare)}%</span></p> : hasExpenseShares ? <p className="report-note">Expense shares need a matching crop budget with cost lines.</p> : null}</> : <p className="report-note">{cropValueUnavailableMessage}</p>}</section>}
  </section>
}

function LandlordFieldSection({ item, applicationRecordsAvailable }: { item: LandlordField; applicationRecordsAvailable: boolean }) {
  const { field, arrangement, plantings } = item
  const assignments = plantings.flatMap((planting) => planting.assignment ? [{ ...planting.assignment, expected_yield_per_acre: settlementScenario(planting).yieldPerAcre, expected_price_per_bu: settlementScenario(planting).pricePerBushel }] : [])
  const missingRentInputs = plantings.flatMap((planting) => {
    const scenario = settlementScenario(planting)
    if (!planting.assignment || scenario.yieldPerAcre !== null && scenario.pricePerBushel !== null) return []
    const crop = planting.commodityName ?? 'this crop'
    if (scenario.yieldPerAcre === null && scenario.pricePerBushel === null) return [`${crop} needs a harvested or projected yield and an actual or projected price`]
    return [scenario.yieldPerAcre === null ? `${crop} needs a harvested or projected yield` : `${crop} needs an actual or projected price`]
  })
  const rentPerAcre = arrangement.arrangement_type === 'owned' ? 0 : equivalentCashRentForField(field, assignments, arrangement, plantings[0]?.costs ?? [])
  const rentUnavailableMessage = missingRentInputs.length ? `Rent is not available because ${missingRentInputs.join('; ')}.` : assignments.length === 0 ? 'Rent is not available because this field has no planting record.' : 'Rent is not available because the flex-rent formula is incomplete.'
  return <section className="landlord-field" aria-label={field.name}>
    <header className="landlord-field-head"><div><h2>{field.name}</h2><p>{decimal.format(field.total_acres)} field acres</p></div><span>{arrangement.arrangement_type === 'crop_share' ? 'Crop share' : arrangement.arrangement_type === 'cash_rent' ? 'Cash rent' : arrangement.arrangement_type === 'flex_cash_rent' ? 'Flex cash rent' : 'Owned ground'}</span></header>
    {plantings.map((planting, index) => <LandlordPlantingSection key={planting.assignment?.id ?? index} planting={planting} arrangement={arrangement} applicationRecordsAvailable={applicationRecordsAvailable} />)}
    {arrangement.arrangement_type !== 'crop_share' && <section className="landlord-rent"><h3>Rent</h3><p>{arrangement.arrangement_type === 'owned' ? 'Owned ground · $0.00 rent' : rentPerAcre === null ? rentUnavailableMessage : `${money.format(rentPerAcre)} / ac · ${money.format(rentPerAcre * field.total_acres)} for ${decimal.format(field.total_acres)} field acres`}</p></section>}
  </section>
}

function LandlordReportPage({ workspace, budget, landlordName, programs, applicationRecordsAvailable }: { workspace: ProfitabilityWorkspace; budget: CropBudget; landlordName: string; programs: ProgramsData | null; applicationRecordsAvailable: boolean }) {
  const fields = landlordFields(workspace, budget, landlordName, programs)
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return <article className="banker-report landlord-report-page">
    <header className="report-head"><div><h1>{workspace.fields.farm.name}</h1><p className="report-subject">Landlord settlement report · {landlordName} · {budget.crop_year}</p></div><p className="report-date">Prepared {preparedOn}</p></header>
    {fields.length ? fields.map((field) => <LandlordFieldSection key={field.field.id} item={field} applicationRecordsAvailable={applicationRecordsAvailable} />) : <p className="report-note landlord-empty">No fields with an active {budget.crop_year} arrangement were found for this landlord.</p>}
    <footer className="report-foot"><span className="report-rx" aria-hidden="true">℞</span><span>Prepared with Farm Rx · {preparedOn}</span></footer>
  </article>
}

export function LandlordReport({ workspace, budget, landlordName, programs, applicationRecordsAvailable, onClose }: { workspace: ProfitabilityWorkspace; budget: CropBudget; landlordName: string; programs: ProgramsData | null; applicationRecordsAvailable: boolean; onClose: () => void }) {
  const firstLandlordNameByKey = new Map<string, string>()
  for (const arrangement of workspace.fields.arrangements) {
    const displayName = arrangement.landlord_name?.trim() ?? ''
    const key = normalizedLandlordName(displayName)
    if (displayName && key && latestArrangementForCropYear(workspace.fields.arrangements, arrangement.field_id, budget.crop_year)?.id === arrangement.id && !firstLandlordNameByKey.has(key)) firstLandlordNameByKey.set(key, displayName)
  }
  const landlordNames = landlordName === 'all' ? [...firstLandlordNameByKey.values()].sort((left, right) => left.localeCompare(right)) : [landlordName]
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  return <div className="banker-report-layer" role="dialog" aria-modal="true" aria-labelledby="landlord-report-title">
    <div className="banker-report-toolbar screen-only"><p id="landlord-report-title">Check the numbers, then save. In the print window choose “Save as PDF”.</p><div><button className="secondary-action" type="button" onClick={onClose}>Close</button><button className="primary-action" type="button" onClick={() => window.print()}>Save as PDF</button></div></div>
    <div className="landlord-report-pages">{landlordNames.map((name) => <LandlordReportPage key={normalizedLandlordName(name)} workspace={workspace} budget={budget} landlordName={name} programs={programs} applicationRecordsAvailable={applicationRecordsAvailable} />)}</div>
  </div>
}
