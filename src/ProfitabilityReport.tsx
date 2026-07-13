import { useEffect } from 'react'
import type { Arrangement, CropAssignment, Field } from './data/fields'
import type { BudgetCostLine, BudgetFieldAllocation, CropBudget, ProfitabilityWorkspace } from './data/profitability'
import type { ProgramsData } from './data/programs'
import { budgetAnalysis, landlordExpenseBuckets, landlordPaidInputCost, matrixProfitPerAcre, resolveFieldYearLand, settlementArrangementForCropYear, totalCostPerAcre, type FieldYearLandBudgetFallback, type FieldYearLandOverride } from './data/profitabilityCalculations'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const categoryLabels: Record<string, string> = { seed: 'Seed', chemical: 'Chemical', fertilizer: 'Fertilizer', fuel: 'Fuel', repairs: 'Repairs', labor: 'Labor', land: 'Land', crop_insurance: 'Crop insurance', equipment_depreciation: 'Equipment', interest: 'Interest', custom: 'Custom' }

export interface ReportFieldRow { allocationId: string; field: Field; acres: number; yieldPerAcre: number; price: number; costPerAcre: number | null; netPerAcre: number | null; blockedReason: string | null }

/** Pure report path: budget binding and field-year lease math stay testable outside React. */
export function calculateReportFieldRows(workspace: ProfitabilityWorkspace, budget: CropBudget, costs: BudgetCostLine[]): ReportFieldRow[] {
  const assignments = workspace.fields.crop_assignments.filter((item) => item.crop_year === budget.crop_year && item.commodity_id === budget.commodity_id)
  return workspace.allocations.filter((item) => item.budget_id === budget.id).flatMap<ReportFieldRow>((allocation) => {
    const assignment = assignments.find((item) => item.id === allocation.crop_assignment_id)
    const field = assignment && workspace.fields.fields.find((item) => item.id === assignment.field_id)
    if (!field) return []
    const fieldAssignments = workspace.fields.crop_assignments.filter((item) => item.field_id === field.id && item.crop_year === budget.crop_year)
    const budgetLines = new Map<string, BudgetCostLine[] | undefined>()
    const overrides: FieldYearLandOverride[] = []
    const budgetFallbacks: FieldYearLandBudgetFallback[] = []
    let ambiguity: string | null = null
    for (const item of fieldAssignments) {
      const bindings = workspace.allocations.filter((candidate) => candidate.crop_assignment_id === item.id)
      const budgetIds = [...new Set(bindings.map((binding) => binding.budget_id))]
      if (budgetIds.length > 1) ambiguity ??= 'More than one budget plan is allocated to this field crop — remove the extra allocation.'
      if (budgetIds.length === 1) budgetLines.set(item.id, workspace.cost_lines.filter((line) => line.budget_id === budgetIds[0]))
      const binding = bindings[0]
      const boundBudget = budgetIds.length === 1 ? workspace.budgets.find((candidate) => candidate.id === budgetIds[0]) : null
      if (bindings.length > 1 && bindings.some((candidate) => candidate.expected_yield_override !== binding.expected_yield_override || candidate.expected_price_override !== binding.expected_price_override)) ambiguity ??= 'This crop has conflicting allocation yield or price overrides. Use one field-crop allocation before calculating land costs.'
      if (boundBudget) budgetFallbacks.push({ cropAssignmentId: item.id, expectedYieldPerAcre: boundBudget.expected_yield_per_acre, expectedPricePerBushel: boundBudget.expected_price_per_bushel })
      if (binding && (binding.expected_yield_override !== null || binding.expected_price_override !== null)) overrides.push({ allocationId: binding.id, cropAssignmentId: item.id, allocatedAcres: binding.allocated_acres, expectedYieldPerAcre: binding.expected_yield_override, expectedPricePerBushel: binding.expected_price_override })
    }
    const resolved = ambiguity ? { status: 'blocked' as const, reason: ambiguity } : resolveFieldYearLand(field, workspace.fields.arrangements, fieldAssignments, budget.crop_year, budgetLines, { overrides, budgetFallbacks })
    const resolvedAssignment = resolved.status === 'resolved' ? resolved.perAssignmentAllocation.find((item) => item.cropAssignmentId === assignment.id) : null
    const yieldPerAcre = resolvedAssignment?.yieldPerAcre ?? 0
    const price = resolvedAssignment?.pricePerBushel ?? 0
    if (resolved.status === 'blocked') return [{ allocationId: allocation.id, field, acres: allocation.allocated_acres, yieldPerAcre, price, costPerAcre: null, netPerAcre: null, blockedReason: resolved.reason }]
    const land = resolved.perAssignmentAllocation.find((item) => item.cropAssignmentId === assignment.id)
    if (!land) return [{ allocationId: allocation.id, field, acres: allocation.allocated_acres, yieldPerAcre, price, costPerAcre: null, netPerAcre: null, blockedReason: 'Farm Rx could not match this crop to the field-year land calculation.' }]
    const costPerAcre = costs.filter((line) => line.category !== 'land').reduce((total, line) => total + line.amount_per_acre, 0) + land.rentPerAssignedAcre
    return [{ allocationId: allocation.id, field, acres: allocation.allocated_acres, yieldPerAcre, price, costPerAcre, netPerAcre: matrixProfitPerAcre(price, yieldPerAcre, costPerAcre), blockedReason: null }]
  })
}

export function BankerReport({ workspace, budget, onClose }: { workspace: ProfitabilityWorkspace; budget: CropBudget; onClose: () => void }) {
  const costs = workspace.cost_lines.filter((line) => line.budget_id === budget.id)
  const costsPerAcre = totalCostPerAcre(costs)
  const analysis = budgetAnalysis(budget, costsPerAcre)
  const commodity = workspace.fields.commodities.find((item) => item.id === budget.commodity_id)
  const rows = calculateReportFieldRows(workspace, budget, costs)
  const resolvedRows = rows.filter((row): row is ReportFieldRow & { costPerAcre: number; netPerAcre: number } => row.costPerAcre !== null && row.netPerAcre !== null)
  const totalAcres = resolvedRows.reduce((sum, row) => sum + row.acres, 0)
  const totalNet = resolvedRows.reduce((sum, row) => sum + row.netPerAcre * row.acres, 0)
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
          <tbody>{rows.map((row, index) => <tr key={`${row.field.id}-${index}`}><td>{row.field.name}{row.blockedReason && <small className="report-note settlement-block">{row.blockedReason}</small>}</td><td className="numeric">{decimal.format(row.acres)}</td><td className="numeric">{row.blockedReason ? 'Unavailable' : decimal.format(row.yieldPerAcre)}</td><td className="numeric">{row.blockedReason ? 'Unavailable' : money.format(row.price)}</td><td className="numeric">{row.costPerAcre === null ? 'Unavailable' : money.format(row.costPerAcre)}</td><td className={`numeric${row.netPerAcre !== null && row.netPerAcre < 0 ? ' negative' : ''}`}>{row.netPerAcre === null ? 'Unavailable' : money.format(row.netPerAcre)}</td><td className={`numeric${row.netPerAcre !== null && row.netPerAcre < 0 ? ' negative' : ''}`}>{row.netPerAcre === null ? 'Unavailable' : money.format(row.netPerAcre * row.acres)}</td></tr>)}</tbody>
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
  allocation: BudgetFieldAllocation | null
  commodityName: string | null
  budget: CropBudget | null
  costs: BudgetCostLine[]
  inputs: LandlordInput[]
  budgetMessage: string | null
  entityWarning: string | null
  entityName: string | null
}
type LandlordField = { field: Field; arrangement: Arrangement | null; arrangementMessage: string | null; plantings: LandlordPlanting[] }
type SettlementScenario = { yieldPerAcre: number | null; pricePerBushel: number | null; cropValue: number | null }

const expenseShares: Array<{ label: string; categories: readonly string[]; percent: (arrangement: Arrangement) => number }> = [
  { label: 'Seed', categories: landlordExpenseBuckets.seed, percent: (arrangement) => arrangement.landlord_seed_pct },
  { label: 'Fertilizer', categories: landlordExpenseBuckets.fertilizer, percent: (arrangement) => arrangement.landlord_fertilizer_pct },
  { label: 'Chemical', categories: landlordExpenseBuckets.chemical, percent: (arrangement) => arrangement.landlord_chemical_pct },
  { label: 'Fuel', categories: landlordExpenseBuckets.fuel, percent: (arrangement) => arrangement.landlord_fuel_pct },
  { label: 'Labor & custom work', categories: landlordExpenseBuckets.labor_custom, percent: (arrangement) => arrangement.landlord_labor_custom_pct },
  { label: 'Crop insurance', categories: landlordExpenseBuckets.crop_insurance, percent: (arrangement) => arrangement.landlord_crop_insurance_pct },
  { label: 'Equipment & repairs', categories: landlordExpenseBuckets.equipment, percent: (arrangement) => arrangement.landlord_equipment_pct },
  { label: 'Interest', categories: landlordExpenseBuckets.interest, percent: (arrangement) => arrangement.landlord_interest_pct },
  { label: 'Other inputs', categories: landlordExpenseBuckets.other_input, percent: (arrangement) => arrangement.landlord_other_input_pct },
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
    const arrangementResolution = settlementArrangementForCropYear(workspace.fields.arrangements, field.id, selectedBudget.crop_year)
    const names = arrangementResolution.overlapping.map((arrangement) => normalizedLandlordName(arrangement.landlord_name))
    if (!names.includes(normalizedLandlordName(landlordName))) return []
    const arrangement = arrangementResolution.status === 'resolved' ? arrangementResolution.arrangement : null
    const arrangementMessage = arrangementResolution.status === 'blocked'
      ? `Settlement is blocked: ${selectedBudget.crop_year} has more than one agreement. Settlement needs the lease's own split or proration rule before Farm Rx can show land costs.`
      : arrangementResolution.status === 'missing'
        ? `Settlement is blocked because no arrangement covers ${selectedBudget.crop_year}. Add the field’s arrangement history before using this report.`
        : null
    const assignments = workspace.fields.crop_assignments.filter((item) => item.field_id === field.id && item.crop_year === selectedBudget.crop_year).sort((left, right) => left.planting_sequence - right.planting_sequence)
    return [{
      field,
      arrangement,
      arrangementMessage,
      plantings: assignments.length ? assignments.map((assignment) => {
        const allocations = workspace.allocations.filter((item) => item.crop_assignment_id === assignment.id)
        const budgetIds = [...new Set(allocations.map((item) => item.budget_id))]
        const budget = budgetIds.length === 1 ? workspace.budgets.find((item) => item.id === budgetIds[0]) ?? null : null
        const budgetMessage = budget ? null : budgetIds.length === 0
          ? 'Allocate this field to a budget plan on the Budgets page, then reopen this report.'
          : 'More than one budget plan is allocated to this field crop — remove the extra allocation.'
        const entityWarning = budget?.operating_entity_id && budget.operating_entity_id !== field.operating_entity_id ? 'Warning: this budget plan belongs to a different operating entity than this field.' : null
        return { assignment, allocation: allocations.length === 1 ? allocations[0] : null, commodityName: workspace.fields.commodities.find((item) => item.id === assignment.commodity_id)?.name ?? null, budget, costs: budget ? workspace.cost_lines.filter((line) => line.budget_id === budget.id) : [], inputs: applicationInputs.get(assignment.id) ?? [], budgetMessage, entityWarning, entityName: workspace.fields.entities.find((entity) => entity.id === field.operating_entity_id)?.name ?? null }
      }) : [{ assignment: null, allocation: null, commodityName: null, budget: null, costs: [], inputs: [], budgetMessage: 'Settlement is blocked because this field has no planting record.', entityWarning: null, entityName: workspace.fields.entities.find((entity) => entity.id === field.operating_entity_id)?.name ?? null }],
    }]
  })
}

function LandlordPlantingSection({ planting, arrangement, applicationRecordsAvailable }: { planting: LandlordPlanting; arrangement: Arrangement; applicationRecordsAvailable: boolean }) {
  const { assignment, commodityName, budget, costs, inputs, budgetMessage, entityWarning, entityName } = planting
  const harvested = assignment?.harvested_bushels ?? null
  const scenario = settlementScenario(planting)
  const cropShare = arrangement.landlord_crop_pct ?? 0
  const expenseRows = expenseShares.map((share) => ({ ...share, percentage: share.percent(arrangement), amount: costs.filter((line) => share.categories.includes(line.category)).reduce((sum, line) => sum + line.amount_per_acre, 0) * (assignment?.planted_acres ?? 0) * share.percent(arrangement) / 100 })).filter((share) => share.percentage > 0)
  const expenseTotal = landlordPaidInputCost(costs, arrangement) * (assignment?.planted_acres ?? 0)
  const landlordCropAmount = scenario.cropValue === null ? null : scenario.cropValue * cropShare / 100
  const netDue = landlordCropAmount === null || !budget ? null : landlordCropAmount - expenseTotal
  const hasExpenseShares = expenseRows.length > 0
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
    {arrangement.arrangement_type === 'crop_share' && <section className="landlord-settlement"><h3>Crop-share settlement</h3>{budgetMessage ? <p className="report-note settlement-block">{budgetMessage}</p> : <><p className="report-note">Budget plan: {budget?.name} · Operating entity: {entityName ?? 'Not recorded'}</p>{entityWarning && <p className="report-note settlement-block">{entityWarning}</p>}<p className="report-note">Percentages used: crop {decimal.format(cropShare)}%; seed {decimal.format(arrangement.landlord_seed_pct)}%; fertilizer {decimal.format(arrangement.landlord_fertilizer_pct)}%; chemical {decimal.format(arrangement.landlord_chemical_pct)}%; fuel {decimal.format(arrangement.landlord_fuel_pct)}%; labor & custom work {decimal.format(arrangement.landlord_labor_custom_pct)}%; crop insurance {decimal.format(arrangement.landlord_crop_insurance_pct)}%; equipment & repairs {decimal.format(arrangement.landlord_equipment_pct)}%; interest {decimal.format(arrangement.landlord_interest_pct)}%; other inputs {decimal.format(arrangement.landlord_other_input_pct)}%.</p>{arrangement.landlord_other_input_pct > 0 && <p className="report-note">Not used yet — budgets don't have an 'Other' cost category. Custom work is now shared under Labor & custom work.</p>}{assignment && scenario.cropValue !== null ? <><table><thead><tr><th>Settlement item</th><th className="numeric">Share</th><th className="numeric">Landlord amount</th></tr></thead><tbody><tr><td>Crop value</td><td className="numeric">{decimal.format(cropShare)}%</td><td className="numeric">{money.format(landlordCropAmount!)}</td></tr>{expenseRows.map((row) => <tr key={row.label}><td>{row.label}</td><td className="numeric">{decimal.format(row.percentage)}%</td><td className="numeric">{money.format(row.amount)}</td></tr>)}</tbody></table><p className="report-total-bar"><span>Landlord share of expenses: {money.format(expenseTotal)} · Landlord share of crop: {decimal.format(cropShare)}%</span></p><p className="landlord-net">{netDue! > 0 ? `Due to landlord: ${money.format(netDue!)}` : netDue! < 0 ? `Due from landlord: ${money.format(Math.abs(netDue!))}` : 'Settled even: $0.00'}</p>{hasExpenseShares && costs.length === 0 && <p className="report-note">No matching budget cost lines were entered, so landlord-paid expenses are $0.00.</p>}</> : <p className="report-note">{cropValueUnavailableMessage}</p>}</>}</section>}
  </section>
}

function LandlordFieldSection({ item, applicationRecordsAvailable }: { item: LandlordField; applicationRecordsAvailable: boolean }) {
  const { field, arrangement, plantings } = item
  if (!arrangement) return <section className="landlord-field" aria-label={field.name}><header className="landlord-field-head"><div><h2>{field.name}</h2><p>{decimal.format(field.total_acres)} field acres</p></div><span>Settlement blocked</span></header><p className="report-note settlement-block">{item.arrangementMessage}</p></section>
  const assignments = plantings.flatMap((planting) => planting.assignment ? [planting.assignment] : [])
  const missingRentInputs = plantings.flatMap((planting) => {
    const scenario = settlementScenario(planting)
    if (!planting.assignment || scenario.yieldPerAcre !== null && scenario.pricePerBushel !== null) return []
    const crop = planting.commodityName ?? 'this crop'
    if (scenario.yieldPerAcre === null && scenario.pricePerBushel === null) return [`${crop} needs a harvested or projected yield and an actual or projected price`]
    return [scenario.yieldPerAcre === null ? `${crop} needs a harvested or projected yield` : `${crop} needs an actual or projected price`]
  })
  const boundBudgets = new Map(plantings.flatMap((planting) => planting.assignment && planting.budget ? [[planting.assignment.id, planting.costs] as const] : []))
  const budgetFallbacks = plantings.flatMap((planting) => planting.assignment && planting.budget ? [{
    cropAssignmentId: planting.assignment.id,
    expectedYieldPerAcre: planting.assignment.expected_yield_per_acre === null ? planting.budget.expected_yield_per_acre : undefined,
    expectedPricePerBushel: planting.assignment.expected_price_per_bu === null ? planting.budget.expected_price_per_bushel : undefined,
  }] : [])
  const overrides = plantings.flatMap((planting) => {
    const scenario = settlementScenario(planting)
    if (!planting.assignment || !planting.allocation || scenario.yieldPerAcre === null || scenario.pricePerBushel === null) return []
    if (scenario.yieldPerAcre === planting.assignment.expected_yield_per_acre && scenario.pricePerBushel === planting.assignment.expected_price_per_bu) return []
    return [{ allocationId: planting.allocation.id, cropAssignmentId: planting.assignment.id, allocatedAcres: planting.allocation.allocated_acres, expectedYieldPerAcre: scenario.yieldPerAcre, expectedPricePerBushel: scenario.pricePerBushel }]
  })
  const resolvedLand = resolveFieldYearLand(field, [arrangement], assignments, assignments[0]?.crop_year ?? new Date().getFullYear(), boundBudgets, { overrides, budgetFallbacks })
  const rentPerAcre = resolvedLand.status === 'resolved' ? resolvedLand.rentPerFieldAcre : null
  const cropRevenue = plantings.map((planting) => settlementScenario(planting).cropValue)
  const totalRevenue = cropRevenue.reduce<number | null>((total, value) => total === null || value === null ? null : total + value, 0)
  const rentUnavailableMessage = missingRentInputs.length ? `Rent is not available because ${missingRentInputs.join('; ')}.` : resolvedLand.status === 'blocked' ? resolvedLand.reason : 'Rent is not available because this field has no planting record.'
  return <section className="landlord-field" aria-label={field.name}>
    <header className="landlord-field-head"><div><h2>{field.name}</h2><p>{decimal.format(field.total_acres)} field acres</p></div><span>{arrangement.arrangement_type === 'crop_share' ? 'Crop share' : arrangement.arrangement_type === 'cash_rent' ? 'Cash rent' : arrangement.arrangement_type === 'flex_cash_rent' ? 'Flex cash rent' : 'Owned ground'}</span></header>
    {plantings.map((planting, index) => <LandlordPlantingSection key={planting.assignment?.id ?? index} planting={planting} arrangement={arrangement} applicationRecordsAvailable={applicationRecordsAvailable} />)}
    {arrangement.arrangement_type !== 'crop_share' && <section className="landlord-rent"><h3>Rent</h3><p>{arrangement.arrangement_type === 'owned' ? 'Owned ground · $0.00 rent' : rentPerAcre === null ? rentUnavailableMessage : `${money.format(rentPerAcre)} / ac · ${money.format(rentPerAcre * field.total_acres)} for ${decimal.format(field.total_acres)} field acres`}</p>{rentPerAcre !== null && totalRevenue !== null && totalRevenue > 0 && plantings.length > 1 && <table><thead><tr><th>Crop rent allocation</th><th className="numeric">Revenue share</th><th className="numeric">Allocated rent</th></tr></thead><tbody>{plantings.map((planting, index) => <tr key={planting.assignment?.id ?? index}><td>{planting.commodityName ?? 'Crop'}</td><td className="numeric">{decimal.format(cropRevenue[index]! / totalRevenue * 100)}%</td><td className="numeric">{money.format(rentPerAcre * field.total_acres * cropRevenue[index]! / totalRevenue)}</td></tr>)}</tbody></table>}</section>}
  </section>
}

function LandlordReportPage({ workspace, budget, landlordName, programs, applicationRecordsAvailable }: { workspace: ProfitabilityWorkspace; budget: CropBudget; landlordName: string; programs: ProgramsData | null; applicationRecordsAvailable: boolean }) {
  const fields = landlordFields(workspace, budget, landlordName, programs)
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return <article className="banker-report landlord-report-page">
    <header className="report-head"><div><h1>{workspace.fields.farm.name}</h1><p className="report-subject">Landlord settlement worksheet (estimate) · {landlordName} · {budget.crop_year}</p></div><p className="report-date">Prepared {preparedOn}</p></header>
    {fields.length ? fields.map((field) => <LandlordFieldSection key={field.field.id} item={field} applicationRecordsAvailable={applicationRecordsAvailable} />) : <p className="report-note landlord-empty">No fields with an active {budget.crop_year} arrangement were found for this landlord.</p>}
    <section className="landlord-disclosure"><p>Not included: crop insurance indemnities, government program payments, drying/storage/hauling, real estate taxes — settle these per your written lease.</p><p>Estimate only: figures come from entered budgets; the written lease governs.</p></section>
    <footer className="report-foot"><span className="report-rx" aria-hidden="true">℞</span><span>Prepared with Farm Rx · {preparedOn}</span></footer>
  </article>
}

function UnassignedFieldsPage({ workspace, budget }: { workspace: ProfitabilityWorkspace; budget: CropBudget }) {
  const fields = workspace.fields.fields.flatMap((field) => {
    const hasPlanting = workspace.fields.crop_assignments.some((assignment) => assignment.field_id === field.id && assignment.crop_year === budget.crop_year)
    if (!hasPlanting) return []
    const resolution = settlementArrangementForCropYear(workspace.fields.arrangements, field.id, budget.crop_year)
    if (resolution.status === 'resolved') return []
    return [{ field, reason: resolution.status === 'missing' ? `No agreement covers ${budget.crop_year}.` : `${budget.crop_year} has more than one agreement; settlement needs the lease's own split or proration rule.` }]
  })
  if (!fields.length) return null
  return <article className="banker-report landlord-report-page">
    <header className="report-head"><div><h1>{workspace.fields.farm.name}</h1><p className="report-subject">Unassigned fields · {budget.crop_year}</p></div></header>
    <section className="landlord-field"><p className="report-note">These fields have plantings but no single agreement Farm Rx can settle for this year.</p><ul>{fields.map(({ field, reason }) => <li key={field.id}><strong>{field.name}</strong> — {reason}</li>)}</ul></section>
  </article>
}

export function LandlordReport({ workspace, budget, landlordName, programs, applicationRecordsAvailable, onClose }: { workspace: ProfitabilityWorkspace; budget: CropBudget; landlordName: string; programs: ProgramsData | null; applicationRecordsAvailable: boolean; onClose: () => void }) {
  const firstLandlordNameByKey = new Map<string, string>()
  for (const arrangement of workspace.fields.arrangements) {
    const displayName = arrangement.landlord_name?.trim() ?? ''
    const key = normalizedLandlordName(displayName)
    if (displayName && key && settlementArrangementForCropYear(workspace.fields.arrangements, arrangement.field_id, budget.crop_year).overlapping.some((item) => item.id === arrangement.id) && !firstLandlordNameByKey.has(key)) firstLandlordNameByKey.set(key, displayName)
  }
  const landlordNames = landlordName === 'all' ? [...firstLandlordNameByKey.values()].sort((left, right) => left.localeCompare(right)) : [landlordName]
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  return <div className="banker-report-layer" role="dialog" aria-modal="true" aria-labelledby="landlord-report-title">
    <div className="banker-report-toolbar screen-only"><p id="landlord-report-title">Check the numbers, then save. In the print window choose “Save as PDF”.</p><div><button className="secondary-action" type="button" onClick={onClose}>Close</button><button className="primary-action" type="button" onClick={() => window.print()}>Save as PDF</button></div></div>
    <div className="landlord-report-pages">{landlordNames.map((name) => <LandlordReportPage key={normalizedLandlordName(name)} workspace={workspace} budget={budget} landlordName={name} programs={programs} applicationRecordsAvailable={applicationRecordsAvailable} />)}{landlordName === 'all' && <UnassignedFieldsPage workspace={workspace} budget={budget} />}</div>
  </div>
}
