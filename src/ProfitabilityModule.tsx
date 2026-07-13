import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { profitabilityRepository, programsRepository } from './data'
import { BankerReport, LandlordReport } from './ProfitabilityReport'
import { SectionTabs } from './SectionTabs'
import type { Field } from './data/fields'
import type { BudgetCostLine, BudgetFieldAllocation, CostCategory, CropBudget, ProfitabilityMatrixStep, ProfitabilityWorkspace } from './data/profitability'
import { farmerError } from './lib/farmerErrors'
import { breakevenCellKeys, budgetAnalysis, equivalentCashRentForScenario, fieldAdjustedCostPerAcre, latestArrangementForCropYear, matrixCells, matrixProfitPerAcre, nonLandCostPerAcre, totalCostPerAcre } from './data/profitabilityCalculations'
import { extraBushelsToJustify, missingCoachCategories, planCushions, planGroup, planProfitAsBudgeted, planProfitUnderArrangement, roiPriceLadder, roiThresholdsForCommodity, roiVerdict, roiWhatIfPerAcre } from './data/planningTools'
import { FARMDOC_2026, FARMDOC_SOURCE_NOTE, farmdocCropKind, farmdocTypicalLine, type FarmdocCropKind } from './data/farmdocDefaults'
import type { Commodity } from './data/fields'
import type { ProgramsData } from './data/programs'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const categories: Array<{ value: CostCategory; label: string }> = [
  { value: 'seed', label: 'Seed' }, { value: 'chemical', label: 'Chemical' }, { value: 'fertilizer', label: 'Fertilizer' }, { value: 'fuel', label: 'Fuel' }, { value: 'repairs', label: 'Repairs' }, { value: 'labor', label: 'Labor' }, { value: 'land', label: 'Land' }, { value: 'crop_insurance', label: 'Crop insurance' }, { value: 'equipment_depreciation', label: 'Equipment' }, { value: 'interest', label: 'Interest' }, { value: 'custom', label: 'Custom' },
]
const arrangementLabels = { owned: 'Owned', cash_rent: 'Cash rent', flex_cash_rent: 'Flex cash rent', crop_share: 'Crop share' } as const
const PROFITABILITY_TABS = [{ slug: '', label: 'Overview' }, { slug: 'budgets', label: 'Budgets' }, { slug: 'plans', label: 'Compare plans' }, { slug: 'reports', label: 'Reports' }]
const numberValue = (value: string) => Number(value)
const sortedSteps = (workspace: ProfitabilityWorkspace, budgetId: string, axis: 'price' | 'yield') => workspace.matrix_steps.filter((step) => step.budget_id === budgetId && step.axis === axis).slice().sort((a, b) => a.sort_order - b.sort_order)

/** Lines seeded from the U of I budget keep a "university default" badge until the farmer
 * overwrites the amount — stored locally so a default never masquerades as their number. */
const DEFAULTS_KEY = 'farm-rx.profitability.university-defaults'
const COACH_KEY = 'farm-rx.profitability.coach-dismissed'
function readDefaultsMap(): Record<string, number> { try { return JSON.parse(window.localStorage.getItem(DEFAULTS_KEY) ?? '{}') as Record<string, number> } catch { return {} } }
function recordDefaults(entries: Record<string, number>) { try { window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ ...readDefaultsMap(), ...entries })) } catch { /* private mode: badges just won't show */ } }
function readCoachDismissed(): string[] { try { return JSON.parse(window.localStorage.getItem(COACH_KEY) ?? '[]') as string[] } catch { return [] } }

function universityBudget(farmId: string, commodity: Commodity, kind: FarmdocCropKind, cropYear: number) {
  const preset = FARMDOC_2026[kind]
  const at = new Date().toISOString()
  const budget: CropBudget = { id: crypto.randomUUID(), farm_id: farmId, crop_year: cropYear, commodity_id: commodity.id, operating_entity_id: null, enterprise_label: null, name: `${cropYear} ${commodity.name} — U of I start`, expected_yield_per_acre: preset.expected_yield_per_acre, expected_price_per_bushel: preset.expected_price_per_bushel, copied_from_budget_id: null, created_at: at, updated_at: at }
  const lines: BudgetCostLine[] = preset.lines.map((line) => ({ id: crypto.randomUUID(), budget_id: budget.id, category: line.category, name: line.name, amount_per_acre: line.amount_per_acre, created_at: at, updated_at: at }))
  recordDefaults(Object.fromEntries(lines.map((line) => [line.id, line.amount_per_acre])))
  return { budget, lines }
}

function matrixColor(value: number, max: number) {
  const intensity = Math.min(1, Math.abs(value) / Math.max(max, 1))
  if (value < 0) return `rgb(${198 + Math.round(45 * (1 - intensity))} ${40 + Math.round(75 * (1 - intensity))} ${40 + Math.round(45 * (1 - intensity))})`
  if (value > 0) return `rgb(${40 + Math.round(130 * (1 - intensity))} ${128 + Math.round(34 * (1 - intensity))} ${88 + Math.round(64 * (1 - intensity))})`
  return 'var(--warn-bg)'
}

function stepsFromRange(budgetId: string, axis: 'price' | 'yield', min: number, max: number, step: number): ProfitabilityMatrixStep[] {
  if (![min, max, step].every(Number.isFinite) || min <= 0 || max <= min || step <= 0) throw new Error('Enter a sensible low, high, and step for the matrix.')
  const values: number[] = []; for (let value = min; value <= max + step / 1000 && values.length < 10; value += step) values.push(Number(value.toFixed(4)))
  if (values.length < 2) throw new Error('Use at least two steps on each matrix axis.')
  return values.map((value, sort_order) => ({ id: crypto.randomUUID(), budget_id: budgetId, axis, value, sort_order }))
}

export function ProfitabilityPage() {
  const [workspace, setWorkspace] = useState<ProfitabilityWorkspace | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [pickedCell, setPickedCell] = useState<{ price: number; yield: number } | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [landlordReportOpen, setLandlordReportOpen] = useState(false)
  const [landlordName, setLandlordName] = useState('all')
  const [programs, setPrograms] = useState<ProgramsData | null>(null)
  const [applicationRecordsAvailable, setApplicationRecordsAvailable] = useState(true)
  const [newCost, setNewCost] = useState({ name: '', category: 'seed' as CostCategory, amount: '' })
  const [savingAllocation, setSavingAllocation] = useState(false)
  const [overviewYear, setOverviewYear] = useState<number | null>(null)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<CostCategory>>(() => new Set())
  const allocationInFlight = useRef(false)
  const navigate = useNavigate()
  const rawTab = useLocation().pathname.split('/')[2] ?? ''
  const tabPath = ['budgets', 'plans', 'reports'].includes(rawTab) ? rawTab : ''
  const refresh = async () => { try { const [data, programResult] = await Promise.all([profitabilityRepository.getWorkspace(), programsRepository.getData().then((value) => ({ available: true as const, value })).catch(() => ({ available: false as const, value: null }))]); setWorkspace(data); setPrograms(programResult.value); setApplicationRecordsAvailable(programResult.available); setSelectedId((current) => data.budgets.some((budget) => budget.id === current) ? current : data.budgets[0]?.id ?? ''); setError('') } catch (caught) { setError(caught instanceof Error && caught.message.includes('private on this farm') ? caught.message : farmerError(caught, 'open profitability')) } }
  useEffect(() => { void refresh() }, [])
  useEffect(() => { const budget = workspace?.budgets.find((item) => item.id === selectedId); if (budget) setPickedCell({ price: budget.expected_price_per_bushel, yield: budget.expected_yield_per_acre }) }, [selectedId])
  useEffect(() => { const years = [...new Set(workspace?.budgets.map((item) => item.crop_year) ?? [])].sort((left, right) => right - left); setOverviewYear((current) => current !== null && years.includes(current) ? current : years[0] ?? null) }, [workspace])
  const save = async (work: () => Promise<void>) => { try { setError(''); await work(); await refresh(); setSaved('Saved'); window.setTimeout(() => setSaved(''), 1800) } catch (caught) { setError(farmerError(caught, 'save profitability')) } }
  const saveAllocation = async (allocation: BudgetFieldAllocation) => { if (allocationInFlight.current) return; allocationInFlight.current = true; setSavingAllocation(true); try { await save(() => profitabilityRepository.saveAllocation(allocation)) } finally { allocationInFlight.current = false; setSavingAllocation(false) } }
  if (!workspace) return <section className="page profitability-page"><h1>Profitability</h1><p role="status">{error || 'Opening your budgets…'}</p></section>
  const budget = workspace.budgets.find((item) => item.id === selectedId)
  if (!budget) { const commodity = workspace.fields.commodities[0]; return <section className="page profitability-page"><h1>Profitability</h1>{error && <p className="profitability-error" role="alert">{error}</p>}<p>Start a budget to see what every acre needs to earn.</p><button className="primary-action" type="button" disabled={!commodity} onClick={() => { if (!commodity) { setError('Add a crop in Fields before starting a budget.'); return }; const at = new Date().toISOString(); const next: CropBudget = { id: crypto.randomUUID(), farm_id: workspace.fields.farm.id, crop_year: new Date().getFullYear(), commodity_id: commodity.id, operating_entity_id: null, enterprise_label: null, name: `${new Date().getFullYear()} ${commodity.name}`, expected_yield_per_acre: 180, expected_price_per_bushel: 4.5, copied_from_budget_id: null, created_at: at, updated_at: at }; void save(() => profitabilityRepository.createBudget(next)).then(() => setSelectedId(next.id)) }}>Create first budget</button>{(() => { const starter = workspace.fields.commodities.map((item) => ({ item, kind: farmdocCropKind(item.crop_family ?? item.name) })).find((entry) => entry.kind !== null); if (!starter) return null; return <button className="secondary-action" type="button" onClick={() => { const created = universityBudget(workspace.fields.farm.id, starter.item, starter.kind!, new Date().getFullYear()); void save(async () => { await profitabilityRepository.createBudget(created.budget); for (const line of created.lines) await profitabilityRepository.saveCostLine(line) }).then(() => setSelectedId(created.budget.id)) }}>Start from the 2026 U of I budget</button> })()}</section> }
  const costs = workspace.cost_lines.filter((line) => line.budget_id === budget.id)
  const costsPerAcre = totalCostPerAcre(costs)
  const prices = sortedSteps(workspace, budget.id, 'price'); const yields = sortedSteps(workspace, budget.id, 'yield')
  const selected = pickedCell ?? { price: budget.expected_price_per_bushel, yield: budget.expected_yield_per_acre }
  const selectedProfit = matrixProfitPerAcre(selected.price, selected.yield, costsPerAcre)
  const selectedAcres = workspace.allocations.filter((item) => item.budget_id === budget.id).reduce((sum, item) => sum + item.allocated_acres, 0)
  const plans = planGroup(workspace.budgets, budget)
  const commodity = workspace.fields.commodities.find((item) => item.id === budget.commodity_id)
  const cropKind = farmdocCropKind(commodity?.crop_family ?? commodity?.name ?? '')
  const defaultsMap = readDefaultsMap()
  const overviewYears = [...new Set(workspace.budgets.map((item) => item.crop_year))].sort((left, right) => right - left)
  const currentOverviewYear = overviewYear ?? overviewYears[0]
  const overviewBudgets = workspace.budgets.filter((item) => item.crop_year === currentOverviewYear)
  const wholeFarm = wholeFarmTotals(workspace, overviewBudgets)
  const createUniversityBudget = (kind: FarmdocCropKind, forCommodity: Commodity, cropYear: number) => { const created = universityBudget(workspace.fields.farm.id, forCommodity, kind, cropYear); void save(async () => { await profitabilityRepository.createBudget(created.budget); for (const line of created.lines) await profitabilityRepository.saveCostLine(line) }).then(() => setSelectedId(created.budget.id)) }
  return <section className="page profitability-page">
    <div className="page-heading profitability-heading"><div><h1>Profitability</h1><p>Put the price and yield together before you make the call.</p></div><div className="profitability-heading-actions"><span className="saved-whisper" aria-live="polite">{saved}</span></div></div>
    <SectionTabs base="/profitability" tabs={PROFITABILITY_TABS} />
    {reportOpen && <BankerReport workspace={workspace} budget={budget} onClose={() => setReportOpen(false)} />}
    {landlordReportOpen && <LandlordReport workspace={workspace} budget={budget} landlordName={landlordName} programs={programs} applicationRecordsAvailable={applicationRecordsAvailable} onClose={() => setLandlordReportOpen(false)} />}
    {error && <p className="profitability-error" role="alert">{error}</p>}
    {tabPath === 'budgets' && <BudgetControls workspace={workspace} budget={budget} selectedId={selectedId} onSelect={setSelectedId} onSave={(next) => save(() => profitabilityRepository.saveBudget(next))} onCreate={(next) => save(() => profitabilityRepository.createBudget(next)).then(() => setSelectedId(next.id))} onCopy={(sourceId, copy) => save(() => profitabilityRepository.copyBudget(sourceId, copy)).then(() => setSelectedId(copy.id))} cropKind={cropKind} onCreateUniversity={(kind) => commodity && createUniversityBudget(kind, commodity, budget.crop_year)} />}
    {tabPath === '' && <>
    {wholeFarm.budgetCount >= 2 && wholeFarm.overlap && <p className="university-note">Two of this year's budgets allocate the same field, so whole-farm totals would count those acres twice. Keep each field in one plan to see farm totals.</p>}
    {wholeFarm.budgetCount >= 2 && !wholeFarm.overlap && <section className="whole-farm-kpis" aria-label={`${currentOverviewYear} whole-farm results`}><WholeFarmKpi label="Total allocated acres" value={`${decimal.format(wholeFarm.acres)} ac`} /><WholeFarmKpi label="Total expected income" value={money.format(wholeFarm.income)} /><WholeFarmKpi label="Total expected costs" value={money.format(wholeFarm.costs)} /><WholeFarmKpi label="Total expected profit" value={money.format(wholeFarm.profit)} alert={wholeFarm.profit < 0} /></section>}
    <section className="overview-budgets" aria-labelledby="overview-budgets-title"><div className="overview-budgets-heading"><div><span className="eyebrow">Crop budgets</span><h2 id="overview-budgets-title">How the year looks</h2><p>Choose a crop to see its price and yield picture below.</p></div><label>Crop year<select value={currentOverviewYear ?? ''} onChange={(event) => { const year = numberValue(event.target.value); setOverviewYear(year); const inYear = workspace.budgets.filter((item) => item.crop_year === year); if (!inYear.some((item) => item.id === selectedId) && inYear[0]) setSelectedId(inYear[0].id) }}>{overviewYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label></div><div className="overview-budget-grid">{overviewBudgets.map((item) => <OverviewBudgetCard key={item.id} budget={item} commodity={workspace.fields.commodities.find((entry) => entry.id === item.commodity_id)} costs={workspace.cost_lines.filter((line) => line.budget_id === item.id)} allocatedAcres={workspace.allocations.filter((allocation) => allocation.budget_id === item.id).reduce((sum, allocation) => sum + allocation.allocated_acres, 0)} selected={item.id === selectedId} onSelect={() => setSelectedId(item.id)} onView={() => { setSelectedId(item.id); navigate('/profitability/budgets') }} />)}</div></section>
    </>}
    {tabPath === 'plans' && <>
    <PlanComparison workspace={workspace} plans={plans} selected={budget} onSelect={setSelectedId} />
    {plans.length > 1 && <RoiAnalyzer workspace={workspace} plans={plans} cropKind={cropKind} commodityLabel={commodity?.name ?? 'this crop'} />}
    </>}
    {tabPath === 'reports' && <ReportsLauncher workspace={workspace} budget={budget} landlordName={landlordName} onLandlordChange={setLandlordName} onOpenBanker={() => setReportOpen(true)} onOpenLandlord={() => setLandlordReportOpen(true)} />}
    {tabPath === '' && <section className="profitability-card matrix-card" aria-labelledby="matrix-title"><div className="section-heading"><div><span className="eyebrow">Profitability matrix</span><h2 id="matrix-title">See the whole picture</h2><p>Showing {budget.name}. Tap any square for the plain-English answer.</p></div></div><MatrixControls budget={budget} prices={prices} yields={yields} onSave={(priceSteps, yieldSteps) => save(() => profitabilityRepository.replaceMatrixSteps(budget.id, [...priceSteps, ...yieldSteps]))} onError={setError} /><ProfitabilityMatrix prices={prices} yields={yields} cost={costsPerAcre} selected={selected} onPick={setPickedCell} /><p className="matrix-answer" aria-live="polite">At {money.format(selected.price)}/bu and {whole.format(selected.yield)} bu/ac you {selectedProfit >= 0 ? 'make' : 'lose'} {money.format(Math.abs(selectedProfit))}/ac{selectedAcres > 0 ? `, ${money.format(Math.abs(selectedProfit) * selectedAcres)} on ${decimal.format(selectedAcres)} ac` : ''}.</p></section>}
    {tabPath === 'budgets' && <>
    <section className="profitability-card costs-card" aria-labelledby="cost-title"><div className="section-heading"><div><span className="eyebrow">Per-acre costs</span><h2 id="cost-title">What each bushel has to cover</h2><p>Add your seed cost to see bushels to cover.</p></div></div><div className="table-scroll"><table><thead><tr><th>Cost</th><th>Category</th><th className="numeric">$/ac</th><th className="numeric">BU TO COVER</th><th><span className="sr-only">Remove</span></th></tr></thead><CostLineGroups costs={costs} price={budget.expected_price_per_bushel} defaultsMap={defaultsMap} collapsed={collapsedCategories} onToggle={(category) => setCollapsedCategories((current) => { const next = new Set(current); if (next.has(category)) next.delete(category); else next.add(category); return next })} onSave={(next) => save(() => profitabilityRepository.saveCostLine(next))} onRemove={(id) => save(() => profitabilityRepository.deleteCostLine(id))} /></table></div><div className="cost-add-row"><input aria-label="New cost name" value={newCost.name} placeholder="Add a cost" onChange={(event) => setNewCost({ ...newCost, name: event.target.value })} /><select aria-label="New cost category" value={newCost.category} onChange={(event) => setNewCost({ ...newCost, category: event.target.value as CostCategory })}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select><input aria-label="New cost dollars per acre" inputMode="decimal" value={newCost.amount} placeholder="$/ac" onChange={(event) => setNewCost({ ...newCost, amount: event.target.value })} /><button className="secondary-action" type="button" onClick={() => { const amount = numberValue(newCost.amount); if (!newCost.name.trim() || !Number.isFinite(amount) || amount < 0) { setError('Enter a cost name and a dollar amount per acre.'); return }; const at = new Date().toISOString(); void save(() => profitabilityRepository.saveCostLine({ id: crypto.randomUUID(), budget_id: budget.id, category: newCost.category, name: newCost.name.trim(), amount_per_acre: amount, created_at: at, updated_at: at })).then(() => setNewCost({ name: '', category: 'seed', amount: '' })) }}>Add cost</button></div><div className="total-bar"><span>Total cost / acre</span><strong>{money.format(costsPerAcre)}</strong></div>{costs.some((line) => defaultsMap[line.id] !== undefined) && <p className="university-note">{FARMDOC_SOURCE_NOTE}</p>}<CoachNudge budget={budget} costs={costs} cropKind={cropKind} onAdd={(lines) => save(async () => { for (const line of lines) await profitabilityRepository.saveCostLine(line) })} /></section>
    <FieldAllocation workspace={workspace} budget={budget} costs={costs} saving={savingAllocation} onSave={saveAllocation} onRemove={(id) => save(() => profitabilityRepository.deleteAllocation(id))} />
    </>}
  </section>
}

function WholeFarmKpi({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={`whole-farm-kpi${alert ? ' alert' : ''}`}><span>{label}</span><strong>{value}</strong></div>
}

function ReportsLauncher({ workspace, budget, landlordName, onLandlordChange, onOpenBanker, onOpenLandlord }: { workspace: ProfitabilityWorkspace; budget: CropBudget; landlordName: string; onLandlordChange: (name: string) => void; onOpenBanker: () => void; onOpenLandlord: () => void }) {
  const namesByKey = new Map<string, string>()
  for (const arrangement of workspace.fields.arrangements) {
    const name = arrangement.landlord_name?.trim() ?? ''
    const key = name.toLowerCase()
    if (name && latestArrangementForCropYear(workspace.fields.arrangements, arrangement.field_id, budget.crop_year)?.id === arrangement.id && !namesByKey.has(key)) namesByKey.set(key, name)
  }
  const landlords = [...namesByKey.values()].sort((left, right) => left.localeCompare(right))
  useEffect(() => { if (landlordName !== 'all' && !namesByKey.has(landlordName.trim().toLowerCase())) onLandlordChange('all') }, [landlordName, landlords, onLandlordChange])
  return <section className="profitability-card reports-card"><div className="section-heading"><div><span className="eyebrow">Reports</span><h2>Share your numbers</h2><p>Print-ready pages built from the budget picked on Overview.</p></div></div><div className="report-launcher"><div className="report-launcher-row"><button className="primary-action" type="button" onClick={onOpenBanker}>Open banker report — {budget.name}</button><p>Projected cost, break-even, and per-field numbers formatted for a lender meeting.</p></div><div className="report-launcher-row"><label>Landlord<select value={landlordName} onChange={(event) => onLandlordChange(event.target.value)} disabled={!landlords.length}><option value="all">All landlords</option>{landlords.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><button className="primary-action" type="button" onClick={onOpenLandlord} disabled={!landlords.length}>Open landlord report</button><p>{landlords.length ? 'Planting, yield, applied inputs, and the crop-share settlement for each landlord field.' : `Add a landlord name to a ${budget.crop_year} field arrangement to print a settlement report.`}</p></div></div></section>
}

function OverviewBudgetCard({ budget, commodity, costs, allocatedAcres, selected, onSelect, onView }: { budget: CropBudget; commodity?: Commodity; costs: BudgetCostLine[]; allocatedAcres: number; selected: boolean; onSelect: () => void; onView: () => void }) {
  const costPerAcre = totalCostPerAcre(costs)
  const analysis = budgetAnalysis(budget, costPerAcre)
  const nonLandBreakeven = costPerAcre - nonLandCostPerAcre(costs) > 0 && budget.expected_yield_per_acre > 0 ? nonLandCostPerAcre(costs) / budget.expected_yield_per_acre : null
  const topCategories = categories.map((category, order) => ({ ...category, order, amount: costs.filter((line) => line.category === category.value).reduce((sum, line) => sum + line.amount_per_acre, 0) })).filter((category) => category.amount > 0).sort((left, right) => right.amount - left.amount || left.order - right.order).slice(0, 3)
  const largestCategory = topCategories[0]?.amount ?? 1
  const selectFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }
  return <article className={`overview-budget-card${selected ? ' selected' : ''}`}><div className="overview-budget-main" role="button" tabIndex={0} aria-pressed={selected} aria-label={`Show the ${budget.name} matrix`} onClick={onSelect} onKeyDown={selectFromKeyboard}><header><span>{commodity?.name ?? 'Crop'}</span><h3>{budget.name}</h3></header><div className={`overview-profit${analysis.expectedProfitPerAcre < 0 ? ' negative' : ''}`}><span>Profit / ac</span><strong>{money.format(analysis.expectedProfitPerAcre)}</strong></div><dl className="overview-budget-metrics"><div><dt>Cost / ac</dt><dd>{money.format(costPerAcre)}</dd></div><div><dt>Break-even price</dt><dd>{money.format(analysis.breakevenPricePerBushel)}/bu{nonLandBreakeven !== null && <em>{money.format(nonLandBreakeven)}/bu before land</em>}</dd></div><div><dt>Break-even yield</dt><dd>{decimal.format(analysis.breakevenYieldPerAcre)} bu/ac</dd></div></dl><div className="overview-cost-bars" aria-label="Top cost categories"><span className="overview-cost-bars-title">Top costs</span>{topCategories.length > 0 ? topCategories.map((category) => <div key={category.value} className="overview-cost-bar"><span>{category.label}</span><div aria-hidden="true"><i style={{ width: `${category.amount / largestCategory * 100}%` }} /></div><strong>{money.format(category.amount)}/ac</strong></div>) : <p>No costs added yet.</p>}</div></div><footer><span>{decimal.format(allocatedAcres)} ac allocated · {decimal.format(budget.expected_yield_per_acre)} bu/ac · {money.format(budget.expected_price_per_bushel)}/bu</span><button className="overview-view-budget" type="button" onClick={onView}>View budget →</button></footer></article>
}

function CostLineGroups({ costs, price, defaultsMap, collapsed, onToggle, onSave, onRemove }: { costs: BudgetCostLine[]; price: number; defaultsMap: Record<string, number>; collapsed: Set<CostCategory>; onToggle: (category: CostCategory) => void; onSave: (line: BudgetCostLine) => void; onRemove: (id: string) => void }) {
  return <>{categories.map((category) => { const lines = costs.filter((line) => line.category === category.value); if (lines.length === 0) return null; const isCollapsed = collapsed.has(category.value); const subtotal = totalCostPerAcre(lines); return <tbody key={category.value} className="cost-category-group"><tr className="cost-category-subtotal"><th scope="rowgroup" colSpan={2}><span>{category.label}</span><small>{whole.format(lines.length)} {lines.length === 1 ? 'item' : 'items'}</small></th><td className="numeric">{money.format(subtotal)}</td><td colSpan={2}><button className="cost-category-toggle" type="button" aria-expanded={!isCollapsed} onClick={() => onToggle(category.value)}><span className="sr-only">{isCollapsed ? `Show ${category.label} costs` : `Hide ${category.label} costs`}</span><span aria-hidden="true">{isCollapsed ? '⌄' : '⌃'}</span></button></td></tr>{!isCollapsed && lines.map((line) => <CostLine key={line.id} line={line} price={price} defaultAmount={defaultsMap[line.id]} onSave={onSave} onRemove={() => onRemove(line.id)} />)}</tbody> })}</>
}

function BudgetControls({ workspace, budget, selectedId, onSelect, onSave, onCreate, onCopy, cropKind, onCreateUniversity }: { workspace: ProfitabilityWorkspace; budget: CropBudget; selectedId: string; onSelect: (value: string) => void; onSave: (budget: CropBudget) => void; onCreate: (budget: CropBudget) => void; onCopy: (sourceId: string, copy: CropBudget) => void; cropKind: FarmdocCropKind | null; onCreateUniversity: (kind: FarmdocCropKind) => void }) {
  const [copyFrom, setCopyFrom] = useState('')
  const update = (patch: Partial<CropBudget>) => onSave({ ...budget, ...patch })
  return <section className="budget-controls profitability-card"><label>Budget<select value={selectedId} onChange={(event) => onSelect(event.target.value)}>{workspace.budgets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Budget name<input key={`${budget.id}-name`} defaultValue={budget.name} onBlur={(event) => event.target.value.trim() && update({ name: event.target.value.trim() })} /></label><label>Crop year<input key={`${budget.id}-year`} defaultValue={budget.crop_year} inputMode="numeric" onBlur={(event) => { const value = numberValue(event.target.value); if (Number.isInteger(value)) update({ crop_year: value }) }} /></label><label>Commodity<select value={budget.commodity_id} onChange={(event) => update({ commodity_id: event.target.value })}>{workspace.fields.commodities.map((commodity) => <option key={commodity.id} value={commodity.id}>{commodity.name}</option>)}</select></label><label>Expected yield (bu/ac)<input key={`${budget.id}-yield`} defaultValue={budget.expected_yield_per_acre} inputMode="decimal" onBlur={(event) => { const value = numberValue(event.target.value); if (value > 0) update({ expected_yield_per_acre: value }) }} /></label><label>Expected price ($/bu)<input key={`${budget.id}-price`} defaultValue={budget.expected_price_per_bushel} inputMode="decimal" onBlur={(event) => { const value = numberValue(event.target.value); if (value > 0) update({ expected_price_per_bushel: value }) }} /></label><button className="secondary-action" type="button" onClick={() => { const at = new Date().toISOString(); onCreate({ ...budget, id: crypto.randomUUID(), name: `New ${budget.name}`, copied_from_budget_id: null, created_at: at, updated_at: at }) }}>New budget</button>{cropKind && <button className="secondary-action" type="button" onClick={() => onCreateUniversity(cropKind)}>Start from 2026 U of I budget</button>}<label>Copy from another budget<select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}><option value="">Choose a budget</option>{workspace.budgets.filter((item) => item.id !== budget.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="secondary-action" type="button" disabled={!copyFrom} onClick={() => { const source = workspace.budgets.find((item) => item.id === copyFrom); if (!source) return; const at = new Date().toISOString(); onCopy(source.id, { ...source, id: crypto.randomUUID(), name: `${source.name} copy`, copied_from_budget_id: source.id, created_at: at, updated_at: at }) }}>Copy budget</button></section>
}

function MatrixControls({ budget, prices, yields, onSave, onError }: { budget: CropBudget; prices: ProfitabilityMatrixStep[]; yields: ProfitabilityMatrixStep[]; onSave: (priceSteps: ProfitabilityMatrixStep[], yieldSteps: ProfitabilityMatrixStep[]) => void; onError: (message: string) => void }) {
  const [values, setValues] = useState(() => ({ pMin: prices[0]?.value ?? 3, pMax: prices.at(-1)?.value ?? 6, pStep: prices.length > 1 ? prices[1].value - prices[0].value : .25, yMin: yields[0]?.value ?? 150, yMax: yields.at(-1)?.value ?? 250, yStep: yields.length > 1 ? yields[1].value - yields[0].value : 10 }))
  useEffect(() => setValues({ pMin: prices[0]?.value ?? 3, pMax: prices.at(-1)?.value ?? 6, pStep: prices.length > 1 ? prices[1].value - prices[0].value : .25, yMin: yields[0]?.value ?? 150, yMax: yields.at(-1)?.value ?? 250, yStep: yields.length > 1 ? yields[1].value - yields[0].value : 10 }), [budget.id])
  return <div className="matrix-controls"><span>Price range</span><input aria-label="Lowest price" value={values.pMin} inputMode="decimal" onChange={(event) => setValues({ ...values, pMin: numberValue(event.target.value) })} /><input aria-label="Highest price" value={values.pMax} inputMode="decimal" onChange={(event) => setValues({ ...values, pMax: numberValue(event.target.value) })} /><input aria-label="Price step" value={values.pStep} inputMode="decimal" onChange={(event) => setValues({ ...values, pStep: numberValue(event.target.value) })} /><span>Yield range</span><input aria-label="Lowest yield" value={values.yMin} inputMode="decimal" onChange={(event) => setValues({ ...values, yMin: numberValue(event.target.value) })} /><input aria-label="Highest yield" value={values.yMax} inputMode="decimal" onChange={(event) => setValues({ ...values, yMax: numberValue(event.target.value) })} /><input aria-label="Yield step" value={values.yStep} inputMode="decimal" onChange={(event) => setValues({ ...values, yStep: numberValue(event.target.value) })} /><button className="secondary-action" type="button" onClick={() => { try { onError(''); onSave(stepsFromRange(budget.id, 'price', values.pMin, values.pMax, values.pStep), stepsFromRange(budget.id, 'yield', values.yMin, values.yMax, values.yStep)) } catch (caught) { onError(caught instanceof Error ? caught.message : 'Enter a sensible low, high, and step for the matrix.') } }}>Update matrix</button></div>
}

function ProfitabilityMatrix({ prices, yields, cost, selected, onPick }: { prices: ProfitabilityMatrixStep[]; yields: ProfitabilityMatrixStep[]; cost: number; selected: { price: number; yield: number }; onPick: (cell: { price: number; yield: number }) => void }) {
  const cells = matrixCells(prices, yields, cost); const max = Math.max(...cells.map((cell) => Math.abs(cell.profit)), 1); const breakeven = breakevenCellKeys(cells)
  return <div className="matrix-scroll"><table className="profit-matrix"><thead><tr><th>Yield \ Price</th>{prices.map((price) => <th key={price.id}>{money.format(price.value)}</th>)}</tr></thead><tbody>{yields.slice().reverse().map((yieldStep) => <tr key={yieldStep.id}><th>{whole.format(yieldStep.value)} bu</th>{prices.map((price) => { const profit = matrixProfitPerAcre(price.value, yieldStep.value, cost); const nearZero = breakeven.has(`${price.value}|${yieldStep.value}`); const active = selected.price === price.value && selected.yield === yieldStep.value; return <td key={price.id}><button type="button" className={`${nearZero ? 'breakeven-cell ' : ''}${active ? 'active-cell' : ''}`} style={{ backgroundColor: matrixColor(profit, max) }} onClick={() => onPick({ price: price.value, yield: yieldStep.value })} aria-label={`At ${money.format(price.value)} and ${whole.format(yieldStep.value)} bushels per acre, ${profit >= 0 ? 'profit' : 'loss'} ${money.format(Math.abs(profit))} per acre`}>{profit < 0 ? '−' : ''}{money.format(Math.abs(profit))}</button></td> })}</tr>)}</tbody></table></div>
}

function CostLine({ line, price, defaultAmount, onSave, onRemove }: { line: BudgetCostLine; price: number; defaultAmount?: number; onSave: (line: BudgetCostLine) => void; onRemove: () => void }) { return <tr><td><input aria-label={`${line.name} name`} defaultValue={line.name} onBlur={(event) => event.target.value.trim() && onSave({ ...line, name: event.target.value.trim() })} />{defaultAmount !== undefined && defaultAmount === line.amount_per_acre && <span className="default-badge">U of I default</span>}</td><td><select aria-label={`${line.name} category`} defaultValue={line.category} onBlur={(event) => onSave({ ...line, category: event.target.value as CostCategory })}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></td><td className="numeric"><input aria-label={`${line.name} dollars per acre`} defaultValue={line.amount_per_acre} inputMode="decimal" onBlur={(event) => { const value = numberValue(event.target.value); if (value >= 0) onSave({ ...line, amount_per_acre: value }) }} /></td><td className="numeric">{decimal.format(line.amount_per_acre / price)} bu</td><td><button className="remove-cost" type="button" aria-label={`Remove ${line.name}`} onClick={onRemove}>Remove</button></td></tr> }

function FieldAllocation({ workspace, budget, costs, saving, onSave, onRemove }: { workspace: ProfitabilityWorkspace; budget: CropBudget; costs: BudgetCostLine[]; saving: boolean; onSave: (allocation: BudgetFieldAllocation) => void; onRemove: (id: string) => void }) {
  const assignments = workspace.fields.crop_assignments.filter((item) => item.crop_year === budget.crop_year && item.commodity_id === budget.commodity_id)
  const allocations = workspace.allocations.filter((item) => item.budget_id === budget.id)
  const allocatedAcres = allocations.reduce((sum, item) => sum + item.allocated_acres, 0); const plantedAcres = assignments.reduce((sum, item) => sum + item.planted_acres, 0)
  const allocatedTotalCost = allocations.reduce((total, allocation) => total + (allocationFinancials(workspace, budget, costs, allocation)?.costTotal ?? 0), 0)
  return <section className="profitability-card allocation-card" aria-labelledby="field-cost-title"><div className="section-heading"><div><span className="eyebrow">Field allocation</span><h2 id="field-cost-title">Cost per acre by field</h2><p>Land in the budget is replaced by the field agreement here, so it is never counted twice.</p></div></div>{plantedAcres > allocatedAcres + .01 && <p className="allocation-nudge">{decimal.format(plantedAcres - allocatedAcres)} planted ac are not allocated yet. Pick a field below when you are ready.</p>}<div className="allocation-list">{assignments.map((assignment) => { const allocation = allocations.find((item) => item.crop_assignment_id === assignment.id); const field = workspace.fields.fields.find((item) => item.id === assignment.field_id); if (!field) return null; if (!allocation) return <div className="allocation-row" key={assignment.id}><div><strong>{field.name}</strong><span>{decimal.format(assignment.planted_acres)} planted ac</span></div><button className="secondary-action" type="button" disabled={saving} onClick={() => { const at = new Date().toISOString(); onSave({ id: crypto.randomUUID(), budget_id: budget.id, crop_assignment_id: assignment.id, allocated_acres: assignment.planted_acres, expected_yield_override: null, expected_price_override: null, created_at: at, updated_at: at }) }}>{saving ? 'Saving…' : 'Allocate field'}</button></div>; const figures = allocationFinancials(workspace, budget, costs, allocation); if (!figures) return null; return <div className="allocated-field" key={allocation.id}><div className="field-edit"><strong>{field.name}</strong><span>{decimal.format(allocation.allocated_acres)} ac allocated</span><label>Acres<input defaultValue={allocation.allocated_acres} inputMode="decimal" disabled={saving} onBlur={(event) => { const value = numberValue(event.target.value); if (value > 0 && value <= assignment.planted_acres) onSave({ ...allocation, allocated_acres: value }) }} /></label><label>Yield<input defaultValue={figures.yieldPerAcre} inputMode="decimal" disabled={saving} onBlur={(event) => { const value = numberValue(event.target.value); if (value > 0) onSave({ ...allocation, expected_yield_override: value }) }} /></label><label>Price<input defaultValue={figures.price} inputMode="decimal" disabled={saving} onBlur={(event) => { const value = numberValue(event.target.value); if (value > 0) onSave({ ...allocation, expected_price_override: value }) }} /></label></div><div className="field-results"><span>Cost/ac <strong>{money.format(figures.costPerAcre)}</strong></span><span>Total cost <strong>{money.format(figures.costTotal)}</strong></span><span>Net/ac <strong className={figures.profitPerAcre < 0 ? 'negative' : ''}>{money.format(figures.profitPerAcre)}</strong></span><span>Total net <strong className={figures.profitTotal < 0 ? 'negative' : ''}>{money.format(figures.profitTotal)}</strong></span><button className="remove-cost" type="button" disabled={saving} onClick={() => onRemove(allocation.id)}>Remove</button></div><ArrangementComparison workspace={workspace} field={field} budget={budget} costs={costs} yieldPerAcre={figures.yieldPerAcre} price={figures.price} /></div> })}</div>{allocations.length > 0 && <div className="total-bar"><span>Total cost across allocated acres</span><strong>{money.format(allocatedTotalCost)}</strong></div>}</section>
}

function allocationFinancials(workspace: ProfitabilityWorkspace, budget: CropBudget, costs: BudgetCostLine[], allocation: BudgetFieldAllocation) {
  const assignment = workspace.fields.crop_assignments.find((item) => item.id === allocation.crop_assignment_id)
  const field = assignment && workspace.fields.fields.find((item) => item.id === assignment.field_id)
  if (!field) return null
  const yieldPerAcre = allocation.expected_yield_override ?? budget.expected_yield_per_acre
  const price = allocation.expected_price_override ?? budget.expected_price_per_bushel
  const costPerAcre = fieldAdjustedCostPerAcre(costs, allocationRent(workspace, field, budget, costs, yieldPerAcre, price))
  const incomePerAcre = price * yieldPerAcre
  const profitPerAcre = matrixProfitPerAcre(price, yieldPerAcre, costPerAcre)
  return { yieldPerAcre, price, costPerAcre, incomePerAcre, profitPerAcre, incomeTotal: incomePerAcre * allocation.allocated_acres, costTotal: costPerAcre * allocation.allocated_acres, profitTotal: profitPerAcre * allocation.allocated_acres }
}

function wholeFarmTotals(workspace: ProfitabilityWorkspace, budgets: CropBudget[]) {
  const totals = { budgetCount: 0, acres: 0, income: 0, costs: 0, profit: 0, overlap: false }
  const assignmentBudget = new Map<string, string>()
  for (const budget of budgets) {
    const costs = workspace.cost_lines.filter((line) => line.budget_id === budget.id)
    const allocations = workspace.allocations.filter((allocation) => allocation.budget_id === budget.id)
    let hasValidAllocation = false
    for (const allocation of allocations) {
      const figures = allocationFinancials(workspace, budget, costs, allocation)
      if (!figures) continue
      hasValidAllocation = true
      const claimedBy = assignmentBudget.get(allocation.crop_assignment_id)
      if (claimedBy !== undefined && claimedBy !== budget.id) totals.overlap = true
      assignmentBudget.set(allocation.crop_assignment_id, budget.id)
      totals.acres += allocation.allocated_acres
      totals.income += figures.incomeTotal
      totals.costs += figures.costTotal
      totals.profit += figures.profitTotal
    }
    if (hasValidAllocation) totals.budgetCount += 1
  }
  return totals
}

function allocationRent(workspace: ProfitabilityWorkspace, field: Field, budget: CropBudget, costs: BudgetCostLine[], yieldPerAcre: number, price: number) { const arrangement = latestArrangementForCropYear(workspace.fields.arrangements, field.id, budget.crop_year); return arrangement ? equivalentCashRentForScenario(arrangement, yieldPerAcre, price, costs) : null }

/** Mason's Excel "Breakeven Calculator" ported: sibling budgets (same crop year + commodity)
 * compared side by side, with a Best badge per land arrangement and margin-of-safety cushions. */
function PlanComparison({ workspace, plans, selected, onSelect }: { workspace: ProfitabilityWorkspace; plans: CropBudget[]; selected: CropBudget; onSelect: (id: string) => void }) {
  if (plans.length < 2) return <section className="profitability-card plan-compare-card"><div className="section-heading"><div><span className="eyebrow">Compare plans</span><h2>Try a second plan side by side</h2><p>Copy this budget into a "Cheap" or "Full program" version and change a few costs. The comparison shows up here with a winner for every land arrangement.</p></div></div></section>
  const linesFor = (planId: string) => workspace.cost_lines.filter((line) => line.budget_id === planId)
  const assignments = workspace.fields.crop_assignments.filter((item) => item.crop_year === selected.crop_year && item.commodity_id === selected.commodity_id)
  const seen = new Set<string>()
  const arrangementColumns = assignments.flatMap((assignment) => {
    const field = workspace.fields.fields.find((item) => item.id === assignment.field_id)
    if (!field) return []
    const arrangement = latestArrangementForCropYear(workspace.fields.arrangements, field.id, selected.crop_year)
    if (!arrangement || seen.has(arrangement.id)) return []
    seen.add(arrangement.id)
    return [{ arrangement, label: `${arrangementLabels[arrangement.arrangement_type]} — ${field.name}` }]
  })
  const asBudgeted = plans.map((plan) => planProfitAsBudgeted(plan, linesFor(plan.id)))
  const bestBudgeted = Math.max(...asBudgeted)
  const arrangementProfits = plans.map((plan) => arrangementColumns.map((column) => planProfitUnderArrangement(plan, linesFor(plan.id), column.arrangement)))
  const arrangementBest = arrangementColumns.map((_, columnIndex) => { const values = arrangementProfits.map((row) => row[columnIndex]).filter((value): value is number => value !== null); return values.length ? Math.max(...values) : null })
  return <section className="profitability-card plan-compare-card" aria-labelledby="plan-compare-title">
    <div className="section-heading"><div><span className="eyebrow">Compare plans</span><h2 id="plan-compare-title">Which plan wins on your ground?</h2><p>Same crop, different programs. The badge marks the best plan under each land arrangement.</p></div></div>
    <div className="table-scroll"><table className="plan-compare"><thead><tr><th>Plan</th><th className="numeric">Cost/ac</th><th className="numeric">BE price</th><th className="numeric">BE yield</th><th className="numeric">Price cushion</th><th className="numeric">Yield cushion</th><th className="numeric">As budgeted</th>{arrangementColumns.map((column) => <th key={column.arrangement.id} className="numeric">{column.label}</th>)}</tr></thead>
    <tbody>{plans.map((plan, planIndex) => { const lines = linesFor(plan.id); const cost = totalCostPerAcre(lines); const planNumbers = budgetAnalysis(plan, cost); const cushions = planCushions(plan, lines); return <tr key={plan.id} className={plan.id === selected.id ? 'active-plan' : ''}>
      <th scope="row"><button type="button" className="plan-name" onClick={() => onSelect(plan.id)}>{plan.name}</button><span className="plan-scenario">{money.format(plan.expected_price_per_bushel)}/bu · {whole.format(plan.expected_yield_per_acre)} bu/ac</span></th>
      <td className="numeric">{money.format(cost)}</td>
      <td className="numeric">{money.format(planNumbers.breakevenPricePerBushel)}</td>
      <td className="numeric">{decimal.format(planNumbers.breakevenYieldPerAcre)} bu</td>
      <td className={`numeric${cushions.priceCushion < 0 ? ' negative' : ''}`}>{money.format(cushions.priceCushion)}</td>
      <td className={`numeric${cushions.yieldCushion < 0 ? ' negative' : ''}`}>{decimal.format(cushions.yieldCushion)} bu</td>
      <td className={`numeric${asBudgeted[planIndex] < 0 ? ' negative' : ''}`}>{money.format(asBudgeted[planIndex])}{asBudgeted[planIndex] === bestBudgeted && <span className="winner-badge">Best</span>}</td>
      {arrangementColumns.map((column, columnIndex) => { const value = arrangementProfits[planIndex][columnIndex]; return <td key={column.arrangement.id} className={`numeric${value !== null && value < 0 ? ' negative' : ''}`}>{value === null ? 'Set up in Fields' : money.format(value)}{value !== null && value === arrangementBest[columnIndex] && <span className="winner-badge">Best</span>}</td> })}
    </tr> })}</tbody></table></div>
    <p className="plan-compare-note">Cushion = how far price or yield can fall from your expectation before that plan loses money. Arrangement columns swap each plan's land line for that agreement's equivalent rent, so land is never counted twice.</p>
  </section>
}

/** Mason's Excel "Input ROI Analyzer" ported: how many extra bushels the bigger program
 * needs to pay for itself, with the same verdict tiers, plus the personal what-if. */
function RoiAnalyzer({ workspace, plans, cropKind, commodityLabel }: { workspace: ProfitabilityWorkspace; plans: CropBudget[]; cropKind: FarmdocCropKind | null; commodityLabel: string }) {
  const linesFor = (planId: string) => workspace.cost_lines.filter((line) => line.budget_id === planId)
  const inputCost = (plan: CropBudget) => nonLandCostPerAcre(linesFor(plan.id))
  const byCost = plans.slice().sort((left, right) => inputCost(right) - inputCost(left))
  const [spendMoreId, setSpendMoreId] = useState(byCost[0].id)
  const [cheaperId, setCheaperId] = useState(byCost[1].id)
  const [extraYield, setExtraYield] = useState('')
  useEffect(() => { const ids = new Set(plans.map((plan) => plan.id)); if (!ids.has(spendMoreId) || !ids.has(cheaperId) || spendMoreId === cheaperId) { const sorted = plans.slice().sort((left, right) => inputCost(right) - inputCost(left)); setSpendMoreId(sorted[0].id); setCheaperId(sorted[1].id) } }, [plans.map((plan) => plan.id).join('|')])
  const spendMore = plans.find((plan) => plan.id === spendMoreId) ?? byCost[0]
  const cheaper = plans.find((plan) => plan.id === cheaperId && plan.id !== spendMore.id) ?? byCost.find((plan) => plan.id !== spendMore.id)!
  const difference = inputCost(spendMore) - inputCost(cheaper)
  const thresholds = roiThresholdsForCommodity(cropKind ?? commodityLabel)
  const price = spendMore.expected_price_per_bushel
  const extra = Number(extraYield)
  const whatIf = extraYield.trim() !== '' && Number.isFinite(extra) && extra >= 0 ? roiWhatIfPerAcre(difference, extra, price) : null
  const picker = (label: string, value: string, onChange: (next: string) => void) => <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} ({money.format(inputCost(plan))}/ac inputs)</option>)}</select></label>
  return <section className="profitability-card roi-card" aria-labelledby="roi-title">
    <div className="section-heading"><div><span className="eyebrow">Input ROI</span><h2 id="roi-title">Is the bigger program worth it?</h2><p>How many extra bushels the spend-more plan needs before it beats the cheaper one.</p></div></div>
    <div className="roi-controls">{picker('Spend-more plan', spendMore.id, setSpendMoreId)}{picker('Cheaper plan', cheaper.id, setCheaperId)}<div className="roi-diff"><span>Extra spend</span><strong>{money.format(difference)}/ac</strong></div></div>
    {difference <= 0 ? <p className="roi-guide">Your spend-more plan does not actually cost more on non-land inputs — it wins at any yield. Swap the two plans to test the other direction.</p> : <>
    <div className="table-scroll"><table className="plan-compare roi-table"><thead><tr><th className="numeric">At this price</th><th className="numeric">Extra bu needed</th><th>Verdict</th></tr></thead><tbody>{roiPriceLadder(price).map((ladderPrice) => { const needed = extraBushelsToJustify(difference, ladderPrice); return <tr key={ladderPrice}><td className="numeric">{money.format(ladderPrice)}</td><td className="numeric">{decimal.format(needed)} bu</td><td>{roiVerdict(needed, thresholds)}</td></tr> })}</tbody></table></div>
    <div className="roi-whatif"><label>Extra bushels you expect from {spendMore.name}<input inputMode="decimal" value={extraYield} placeholder="bu/ac" onChange={(event) => setExtraYield(event.target.value)} /></label>{whatIf !== null && <span className={`roi-verdict${whatIf < 0 ? ' negative' : ''}`} aria-live="polite">{whatIf >= 0 ? `${spendMore.name} wins by ${money.format(whatIf)}/ac` : `${cheaper.name} wins by ${money.format(Math.abs(whatIf))}/ac`}</span>}</div>
    <p className="roi-guide">Verdict scale for {cropKind === 'soybeans' ? 'soybeans' : 'corn'}: ≤{thresholds.easyYes} bu easy yes · ≤{thresholds.likely} bu likely worth it · ≤{thresholds.marginal} bu marginal. General guidance only — {cropKind === 'soybeans' ? 'fungicide alone is typically a 2–4 bu edge, premium seed treatment 1–3 bu, full vs basic 1–4 bu' : 'fungicide alone is typically an 8–15 bu edge, premium seed treatment 3–8 bu, full vs stripped program 10–17 bu'}; your results depend on weather, disease pressure, and soil.</p></>}
  </section>
}

/** Gentle "what am I forgetting?" — flags gold-standard cost lines the budget is missing. */
function CoachNudge({ budget, costs, cropKind, onAdd }: { budget: CropBudget; costs: BudgetCostLine[]; cropKind: FarmdocCropKind | null; onAdd: (lines: BudgetCostLine[]) => void }) {
  const [dismissed, setDismissed] = useState<string[]>(() => readCoachDismissed())
  const missing = missingCoachCategories(costs)
  if (missing.length === 0 || dismissed.includes(budget.id)) return null
  const suggestions = cropKind ? missing.map((category) => farmdocTypicalLine(cropKind, category)).filter((line): line is NonNullable<typeof line> => line !== null) : []
  const dismiss = () => { const next = [...dismissed, budget.id]; setDismissed(next); try { window.localStorage.setItem(COACH_KEY, JSON.stringify(next)) } catch { /* fine */ } }
  return <div className="allocation-nudge coach-nudge"><p>What am I forgetting? Full budgets usually also have: {suggestions.length > 0 ? suggestions.map((line) => `${line.name} (~$${line.amount_per_acre}/ac)`).join(', ') : missing.map((category) => categories.find((item) => item.value === category)?.label ?? category).join(', ')}. Skipping them makes your break-even look better than it is.</p><div className="coach-actions">{suggestions.length > 0 && <button className="secondary-action" type="button" onClick={() => { const at = new Date().toISOString(); const lines: BudgetCostLine[] = suggestions.map((line) => ({ id: crypto.randomUUID(), budget_id: budget.id, category: line.category, name: line.name, amount_per_acre: line.amount_per_acre, created_at: at, updated_at: at })); recordDefaults(Object.fromEntries(lines.map((line) => [line.id, line.amount_per_acre]))); onAdd(lines) }}>Add typical lines</button>}<button className="remove-cost" type="button" onClick={dismiss}>Dismiss</button></div></div>
}

function ArrangementComparison({ workspace, field, budget, costs, yieldPerAcre, price }: { workspace: ProfitabilityWorkspace; field: Field; budget: CropBudget; costs: BudgetCostLine[]; yieldPerAcre: number; price: number }) {
  const arrangement = latestArrangementForCropYear(workspace.fields.arrangements, field.id, budget.crop_year); const rows: Array<[keyof typeof arrangementLabels, number | null]> = [['owned', 0], ['cash_rent', arrangement?.arrangement_type === 'cash_rent' ? equivalentCashRentForScenario(arrangement, yieldPerAcre, price, costs) : null], ['flex_cash_rent', arrangement?.arrangement_type === 'flex_cash_rent' ? equivalentCashRentForScenario(arrangement, yieldPerAcre, price, costs) : null], ['crop_share', arrangement?.arrangement_type === 'crop_share' ? equivalentCashRentForScenario(arrangement, yieldPerAcre, price, costs) : null]]
  return <details className="arrangement-comparison"><summary>Compare land arrangements in equivalent cash rent</summary><p>The newest agreement that overlaps this crop year is used. It replaces the budget land line; it is not added on top.</p><div>{rows.map(([type, value]) => <span key={type} className={arrangement?.arrangement_type === type ? 'active-arrangement' : ''}><strong>{arrangementLabels[type]}</strong><b>{value === null ? 'Set up in Fields' : `${money.format(value)}/ac`}</b></span>)}</div></details>
}
