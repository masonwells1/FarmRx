import { useEffect, useMemo, useRef, useState } from 'react'
import { bestMonth, carryRow, verdict, type CarryRow, type CarrySettings } from './data/costOfCarry'
import type { GrainCarryGrid, GrainCarrySettings, GrainWorkspace, ProductionEstimate } from './data/grain'
import { CARRY_GRID_ROWS } from './data/grainSettings'
import { beginPendingSettingsWork, registerPendingSettingsFlush } from './data/pendingSettingsWork'

// Legacy device-only storage, used until the farm's settings tables exist on the live database.
// Keyed per farm: one device can serve several farms and their storage costs differ.
const settingsKey = (farmId: string) => `farm-rx.grain.carry-settings.v1.${farmId}`
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
type PriceRow = { marketPrice: string; basis: string }
type CommodityCarry = { harvestMonth: number; defaultBasis: string; rows: PriceRow[] }
const defaultSettings: CarrySettings = { mode: 'monthly', monthlyRateCentsPerBuMonth: 4, flatRatePerBu: 0.18, interestRatePct: 7, truckingPerBu: 0.12 }
const SAVE_DELAY_MS = 600

// Costs and rates can never be negative: a stored negative would subtract carry and
// flip the verdict to a false "Store".
function nonNegative(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback }
function readSettings(farmId: string): CarrySettings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(settingsKey(farmId)) ?? '{}') as Partial<CarrySettings>
    return { mode: saved.mode === 'flat' ? 'flat' : 'monthly', monthlyRateCentsPerBuMonth: nonNegative(saved.monthlyRateCentsPerBuMonth, defaultSettings.monthlyRateCentsPerBuMonth), flatRatePerBu: nonNegative(saved.flatRatePerBu, defaultSettings.flatRatePerBu), interestRatePct: nonNegative(saved.interestRatePct, defaultSettings.interestRatePct), truckingPerBu: nonNegative(saved.truckingPerBu, defaultSettings.truckingPerBu) }
  } catch { return defaultSettings }
}
function settingsFromRow(row: GrainCarrySettings): CarrySettings { return { mode: row.mode === 'flat' ? 'flat' : 'monthly', monthlyRateCentsPerBuMonth: nonNegative(row.monthly_rate_cents_per_bu_month, defaultSettings.monthlyRateCentsPerBuMonth), flatRatePerBu: nonNegative(row.flat_rate_per_bu, defaultSettings.flatRatePerBu), interestRatePct: nonNegative(row.interest_rate_pct, defaultSettings.interestRatePct), truckingPerBu: nonNegative(row.trucking_per_bu, defaultSettings.truckingPerBu) } }
function settingsToRow(farmId: string, settings: CarrySettings, updatedAt: string): GrainCarrySettings { return { farm_id: farmId, mode: settings.mode, monthly_rate_cents_per_bu_month: settings.monthlyRateCentsPerBuMonth, flat_rate_per_bu: settings.flatRatePerBu, interest_rate_pct: settings.interestRatePct, trucking_per_bu: settings.truckingPerBu, updated_at: updatedAt } }
function freshCommodityCarry(): CommodityCarry { return { harvestMonth: 9, defaultBasis: '0', rows: Array.from({ length: CARRY_GRID_ROWS }, () => ({ marketPrice: '', basis: '0' })) } }
function toNumber(value: string): number | null { const parsed = Number(value); return value.trim() !== '' && Number.isFinite(parsed) ? parsed : null }
function carryFromGrid(grid: GrainCarryGrid): CommodityCarry {
  const rows = grid.rows.slice(0, CARRY_GRID_ROWS).map((row) => ({ marketPrice: row.market_price === null ? '' : String(row.market_price), basis: row.basis === null ? '' : String(row.basis) }))
  while (rows.length < CARRY_GRID_ROWS) rows.push({ marketPrice: '', basis: String(grid.default_basis) })
  return { harvestMonth: grid.harvest_month, defaultBasis: String(grid.default_basis), rows }
}
function carryToGrid(carry: CommodityCarry, base: { id: string; farm_id: string; production_estimate_id: string; updated_at: string }): GrainCarryGrid {
  return { ...base, harvest_month: carry.harvestMonth, default_basis: toNumber(carry.defaultBasis) ?? 0, rows: carry.rows.map((row) => ({ market_price: toNumber(row.marketPrice), basis: toNumber(row.basis) })) }
}
function displayMonth(cropYear: number, harvestMonth: number, monthsStored: number) { return new Date(Date.UTC(cropYear, harvestMonth + monthsStored, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) }
function signedMoney(value: number) { return `${value > 0 ? '+' : value < 0 ? '−' : ''}${money.format(Math.abs(value))}` }

/** Farm-level persistence for the calculator. Absent (or unsupported by the live database) means device-only behavior. */
export type GrainCarryPersistence = { saveSettings: (settings: GrainCarrySettings) => Promise<GrainCarrySettings | void>; saveGrid: (grid: GrainCarryGrid) => Promise<GrainCarryGrid | void>; createId: () => string }

export function GrainCostOfCarry({ workspace, selectedEstimate, selectedEstimateId, onSelectEstimate, persistence }: { workspace: GrainWorkspace; selectedEstimate: ProductionEstimate; selectedEstimateId: string; onSelectEstimate: (id: string) => void; persistence?: GrainCarryPersistence }) {
  const farmId = workspace.fields.farm.id
  const persisted = !!persistence && workspace.capabilities?.persisted_settings === true
  const initialSettings = () => persisted ? (workspace.grain_carry_settings ? settingsFromRow(workspace.grain_carry_settings) : defaultSettings) : readSettings(farmId)
  const initialGrids = () => persisted ? Object.fromEntries(workspace.grain_carry_grids.map((grid) => [grid.production_estimate_id, carryFromGrid(grid)])) : {}
  const [settings, setSettings] = useState<CarrySettings>(initialSettings)
  const [byEstimate, setByEstimate] = useState<Record<string, CommodityCarry>>(initialGrids)
  // The row version each displayed draft was derived from. A save sends this version, so a row changed
  // on another device conflicts instead of being silently overwritten by a stale draft.
  const baseVersions = useRef<{ settings: string | null; grids: Record<string, string | null> }>({ settings: workspace.grain_carry_settings?.updated_at ?? null, grids: Object.fromEntries(workspace.grain_carry_grids.map((grid) => [grid.production_estimate_id, grid.updated_at])) })
  // One stable empty grid per mount so the calculation memo is not invalidated on every render.
  const emptyCarry = useRef(freshCommodityCarry()).current
  const carry = byEstimate[selectedEstimateId] ?? emptyCarry
  // Latest props for the debounced savers; saves run one after another so each carries the freshest updated_at.
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace
  const persistenceRef = useRef(persistence); persistenceRef.current = persistence
  const settingsRef = useRef(settings); settingsRef.current = settings
  const byEstimateRef = useRef(byEstimate); byEstimateRef.current = byEstimate
  const chain = useRef(Promise.resolve())
  const settingsDirty = useRef(false)
  const gridsDirty = useRef(new Set<string>())
  const newGridIds = useRef<Record<string, string>>({})
  // Every queued save (and any unflushed edit) keeps the farm marked pending for the farm switcher until it has run.
  // A save that fails before reaching the server or the durable queue marks its token failed, so a confirmed farm switch stops instead of discarding the edit.
  const enqueue = (work: () => Promise<void>) => { const done = beginPendingSettingsWork(workspaceRef.current.fields.farm.id); chain.current = chain.current.then(() => work().then(() => done(), (error: unknown) => done(error ?? new Error('Settings save failed.')))) }
  const unflushed = useRef<(() => void) | null>(null)
  const markUnflushed = () => { unflushed.current ??= beginPendingSettingsWork(workspaceRef.current.fields.farm.id) }
  const settleUnflushed = () => { if (!settingsDirty.current && gridsDirty.current.size === 0) { unflushed.current?.(); unflushed.current = null } }
  const flushSettings = () => {
    if (!persisted || !settingsDirty.current) return
    settingsDirty.current = false
    settleUnflushed()
    const snapshot = settingsRef.current
    enqueue(async () => { const current = workspaceRef.current; const saved = await persistenceRef.current?.saveSettings(settingsToRow(current.fields.farm.id, snapshot, baseVersions.current.settings ?? new Date().toISOString())); if (saved) baseVersions.current.settings = saved.updated_at })
  }
  const flushGrids = () => {
    if (!persisted) return
    const ids = [...gridsDirty.current]; gridsDirty.current.clear()
    settleUnflushed()
    for (const estimateId of ids) {
      const snapshot = byEstimateRef.current[estimateId]
      if (!snapshot) continue
      enqueue(async () => {
        const current = workspaceRef.current; const active = persistenceRef.current
        if (!active || !current.production_estimates.some((estimate) => estimate.id === estimateId)) return
        const existing = current.grain_carry_grids.find((grid) => grid.production_estimate_id === estimateId)
        const id = existing?.id ?? (newGridIds.current[estimateId] ??= active.createId())
        const saved = await active.saveGrid(carryToGrid(snapshot, { id, farm_id: current.fields.farm.id, production_estimate_id: estimateId, updated_at: baseVersions.current.grids[estimateId] ?? existing?.updated_at ?? new Date().toISOString() }))
        if (saved) baseVersions.current.grids[estimateId] = saved.updated_at
      })
    }
  }
  useEffect(() => { setSettings(initialSettings()); setByEstimate(initialGrids()); settingsDirty.current = false; gridsDirty.current.clear(); baseVersions.current = { settings: workspace.grain_carry_settings?.updated_at ?? null, grids: Object.fromEntries(workspace.grain_carry_grids.map((grid) => [grid.production_estimate_id, grid.updated_at])) } }, [farmId, persisted]) // eslint-disable-line react-hooks/exhaustive-deps
  // Rows changed elsewhere (another device, or a refresh after another Grain save) replace a pristine draft and its version;
  // a draft still being edited keeps its original version so its save conflicts rather than overwriting the newer row.
  useEffect(() => {
    if (!persisted) return
    const row = workspace.grain_carry_settings; const version = row?.updated_at ?? null
    if (version !== baseVersions.current.settings && !settingsDirty.current) { baseVersions.current.settings = version; setSettings(row ? settingsFromRow(row) : defaultSettings) }
    for (const grid of workspace.grain_carry_grids) {
      if (grid.updated_at !== (baseVersions.current.grids[grid.production_estimate_id] ?? null) && !gridsDirty.current.has(grid.production_estimate_id)) { baseVersions.current.grids[grid.production_estimate_id] = grid.updated_at; setByEstimate((current) => ({ ...current, [grid.production_estimate_id]: carryFromGrid(grid) })) }
    }
  }, [workspace.grain_carry_settings, workspace.grain_carry_grids, persisted])
  useEffect(() => { if (persisted) return; try { window.localStorage.setItem(settingsKey(farmId), JSON.stringify(settings)) } catch { /* private mode: calculator still works this visit */ } }, [farmId, settings, persisted])
  useEffect(() => { if (!persisted || !settingsDirty.current) return; const timer = setTimeout(flushSettings, SAVE_DELAY_MS); return () => clearTimeout(timer) }, [settings, persisted]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!persisted || gridsDirty.current.size === 0) return; const timer = setTimeout(flushGrids, SAVE_DELAY_MS); return () => clearTimeout(timer) }, [byEstimate, persisted]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { flushSettings(); flushGrids() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // A confirmed farm switch sends unflushed edits through here and then waits for the chain before the farm changes.
  useEffect(() => persisted ? registerPendingSettingsFlush(farmId, () => { flushSettings(); flushGrids() }) : undefined, [farmId, persisted]) // eslint-disable-line react-hooks/exhaustive-deps
  const changeSettings = (change: (current: CarrySettings) => CarrySettings) => { settingsDirty.current = true; if (persisted) markUnflushed(); setSettings(change) }
  // Discrete choices (the storage-mode buttons) save as soon as React has committed the click, not after the typing pause.
  const chooseMode = (mode: CarrySettings['mode']) => { changeSettings((current) => ({ ...current, mode })); setTimeout(flushSettings, 0) }
  const updateCarry = (change: (current: CommodityCarry) => CommodityCarry) => { gridsDirty.current.add(selectedEstimateId); if (persisted) markUnflushed(); setByEstimate((current) => ({ ...current, [selectedEstimateId]: change(current[selectedEstimateId] ?? freshCommodityCarry()) })) }
  const calculated = useMemo(() => {
    const harvestMarket = toNumber(carry.rows[0]?.marketPrice ?? '')
    const harvestBasis = toNumber(carry.rows[0]?.basis ?? '')
    const harvestCash = harvestMarket === null || harvestBasis === null ? null : harvestMarket + harvestBasis
    return carry.rows.map((row, index) => {
      const marketPrice = toNumber(row.marketPrice); const basis = toNumber(row.basis)
      const result = harvestCash === null || marketPrice === null || basis === null ? null : carryRow({ monthsStored: index, harvestCashPrice: harvestCash, cashPrice: marketPrice + basis, settings })
      return { index, cashPrice: marketPrice === null || basis === null ? null : marketPrice + basis, result }
    })
  }, [carry, settings])
  const validRows = calculated.flatMap((row) => row.result ? [row.result] : [])
  const storedRows = validRows.filter((row) => row.monthsStored > 0)
  const harvestCash = calculated[0]?.cashPrice ?? null
  const best = bestMonth(validRows)
  const decision = storedRows.length ? verdict(validRows) : null
  const bestDate = best ? displayMonth(selectedEstimate.crop_year, carry.harvestMonth, best.monthsStored) : null
  const verdictDate = decision?.month === undefined ? null : displayMonth(selectedEstimate.crop_year, carry.harvestMonth, decision.month)
  const footer = harvestCash === null || !decision ? 'Enter your harvest and delivery prices to compare storage against harvest delivery.' : decision.kind === 'harvest' ? `Harvest delivery wins — no stored month beats ${money.format(harvestCash)}/bu after storage, interest, and trucking.` : `Storing until ${verdictDate} nets ${signedMoney(decision.netPerBu)}/bu over harvest delivery.`
  const setRate = (key: Exclude<keyof CarrySettings, 'mode'>, value: string) => { const parsed = Number(value); changeSettings((current) => ({ ...current, [key]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 })) }
  const updateRow = (index: number, key: keyof PriceRow, value: string) => updateCarry((current) => ({ ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) }))
  const changeDefaultBasis = (value: string) => updateCarry((current) => ({ ...current, defaultBasis: value, rows: current.rows.map((row) => row.basis === current.defaultBasis ? { ...row, basis: value } : row) }))
  const storageNote = persisted ? 'Your rates and prices are saved for this farm on every device as you type.' : 'Your rates and prices stay on this device until the farm settings update is live.'

  return <>
    <section className="grain-section carry-settings-card" aria-labelledby="carry-settings-title">
      <div className="section-heading"><div><span className="eyebrow">Carry costs</span><h2 id="carry-settings-title">How do you pay for storage?</h2><p>Monthly rate accumulates — the longer you store, the higher the cost. {storageNote}</p></div></div>
      <div className="carry-settings"><div className="carry-toggle" role="group" aria-label="Storage payment method"><button type="button" className={settings.mode === 'monthly' ? 'active' : ''} onClick={() => chooseMode('monthly')}>Option A — Monthly</button><button type="button" className={settings.mode === 'flat' ? 'active' : ''} onClick={() => chooseMode('flat')}>Option B — Flat rate</button></div>{settings.mode === 'monthly' ? <label>Monthly storage rate ¢/bu/mo<input aria-label="Monthly storage rate cents per bushel per month" type="number" min="0" step="0.1" inputMode="decimal" value={settings.monthlyRateCentsPerBuMonth} onChange={(event) => setRate('monthlyRateCentsPerBuMonth', event.target.value)} onBlur={flushSettings} /></label> : <label>Flat storage rate $/bu<input aria-label="Flat storage rate dollars per bushel" type="number" min="0" step="0.01" inputMode="decimal" value={settings.flatRatePerBu} onChange={(event) => setRate('flatRatePerBu', event.target.value)} onBlur={flushSettings} /></label>}<label>Interest rate %<input type="number" min="0" step="0.1" inputMode="decimal" value={settings.interestRatePct} onChange={(event) => setRate('interestRatePct', event.target.value)} onBlur={flushSettings} /></label><label>2nd-haul trucking $/bu<input type="number" min="0" step="0.01" inputMode="decimal" value={settings.truckingPerBu} onChange={(event) => setRate('truckingPerBu', event.target.value)} onBlur={flushSettings} /></label></div>
    </section>
    <section className="grain-section carry-calculator" aria-labelledby="carry-title">
      <div className="section-heading"><div><span className="eyebrow">Your numbers</span><h2 id="carry-title">Store or deliver at harvest</h2><p>Type the prices you can get. These manual prices run the math; delayed market quotes do not.</p></div><label className="commodity-picker"><span>Commodity</span><select value={selectedEstimateId} onChange={(event) => onSelectEstimate(event.target.value)}>{workspace.production_estimates.map((estimate) => <option key={estimate.id} value={estimate.id}>{workspace.fields.commodities.find((commodity) => commodity.id === estimate.commodity_id)?.name ?? estimate.commodity_id}</option>)}</select></label></div>
      <div className="carry-crop-controls"><label>Harvest month<select value={carry.harvestMonth} onChange={(event) => updateCarry((current) => ({ harvestMonth: Number(event.target.value), defaultBasis: current.defaultBasis, rows: Array.from({ length: CARRY_GRID_ROWS }, () => ({ marketPrice: '', basis: current.defaultBasis })) }))} onBlur={flushGrids}>{monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}</select></label><label>Default basis $/bu<input type="number" step="0.01" inputMode="decimal" value={carry.defaultBasis} onChange={(event) => changeDefaultBasis(event.target.value)} onBlur={flushGrids} /></label></div>
      <div className="carry-kpis" aria-label="Cost of carry results"><article className="stat-card"><span className="stat-label">Harvest cash / bu</span><strong className="stat-value">{harvestCash === null ? '—' : money.format(harvestCash)}</strong></article><article className="stat-card"><span className="stat-label">Best stored month</span><strong className="stat-value">{bestDate ?? '—'}</strong></article><article className="stat-card"><span className="stat-label">Best net vs harvest</span><strong className={`stat-value${best && best.netVsHarvest < 0 ? ' negative' : ''}`}>{best ? signedMoney(best.netVsHarvest) : '—'}</strong></article><article className="stat-card"><span className="stat-label">Verdict</span><strong className="stat-value carry-verdict">{!decision ? 'Enter prices' : decision.kind === 'harvest' ? 'Deliver at harvest' : `Store until ${verdictDate}`}</strong></article></div>
      <div className="table-scroll carry-table-scroll"><table className="carry-table phone-stack"><thead><tr><th>Delivery month</th><th className="numeric">Market price $/bu</th><th className="numeric">Basis $/bu</th><th className="numeric">Cash price</th><th className="numeric">Months stored</th><th className="numeric">Storage</th><th className="numeric">Interest</th><th className="numeric">Trucking</th><th className="numeric">Total carry</th><th className="numeric">Net vs harvest</th></tr></thead><tbody>{calculated.map((row) => { const isHarvest = row.index === 0; const result: CarryRow | null = row.result; const label = displayMonth(selectedEstimate.crop_year, carry.harvestMonth, row.index); return <tr key={row.index} className={isHarvest ? 'harvest-row' : undefined}><th scope="row"><strong>{label}</strong>{isHarvest && <span>★ Harvest delivery</span>}</th><td className="numeric" data-label="Market price $/bu"><input aria-label={`${label} market price per bushel`} type="number" step="0.01" inputMode="decimal" placeholder="0.00" value={carry.rows[row.index]?.marketPrice ?? ''} onChange={(event) => updateRow(row.index, 'marketPrice', event.target.value)} onBlur={flushGrids} /></td><td className="numeric" data-label="Basis $/bu"><input aria-label={`${label} basis per bushel`} type="number" step="0.01" inputMode="decimal" value={carry.rows[row.index]?.basis ?? carry.defaultBasis} onChange={(event) => updateRow(row.index, 'basis', event.target.value)} onBlur={flushGrids} /></td><td className="numeric" data-label="Cash price">{row.cashPrice === null ? '—' : money.format(row.cashPrice)}</td><td className="numeric" data-label="Months stored">{row.index}</td><td className="numeric" data-label="Storage">{result ? money.format(result.storageCost) : '—'}</td><td className="numeric" data-label="Interest">{result ? money.format(result.interestCost) : '—'}</td><td className="numeric" data-label="Trucking">{result ? money.format(result.truckingCost) : '—'}</td><td className="numeric" data-label="Total carry">{result ? money.format(result.totalCarry) : '—'}</td><td className={`numeric phone-full${result && result.netVsHarvest < 0 ? ' negative' : result && result.netVsHarvest > 0 ? ' positive' : ''}`} data-label="Net vs harvest">{result ? signedMoney(result.netVsHarvest) : '—'}</td></tr> })}</tbody></table></div>
      <p className="carry-footer" aria-live="polite">{footer}</p>
    </section>
  </>
}
