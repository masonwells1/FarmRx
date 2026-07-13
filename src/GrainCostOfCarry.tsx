import { useEffect, useMemo, useState } from 'react'
import { bestMonth, carryRow, verdict, type CarryRow, type CarrySettings } from './data/costOfCarry'
import type { GrainWorkspace, ProductionEstimate } from './data/grain'

// Keyed per farm: one device can serve several farms and their storage costs differ.
const settingsKey = (farmId: string) => `farm-rx.grain.carry-settings.v1.${farmId}`
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
type PriceRow = { marketPrice: string; basis: string }
type CommodityCarry = { harvestMonth: number; defaultBasis: string; rows: PriceRow[] }
const defaultSettings: CarrySettings = { mode: 'monthly', monthlyRateCentsPerBuMonth: 4, flatRatePerBu: 0.18, interestRatePct: 7, truckingPerBu: 0.12 }

// Costs and rates can never be negative: a stored negative would subtract carry and
// flip the verdict to a false "Store".
function nonNegative(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback }
function readSettings(farmId: string): CarrySettings {
  try {
    const saved = JSON.parse(window.localStorage.getItem(settingsKey(farmId)) ?? '{}') as Partial<CarrySettings>
    return { mode: saved.mode === 'flat' ? 'flat' : 'monthly', monthlyRateCentsPerBuMonth: nonNegative(saved.monthlyRateCentsPerBuMonth, defaultSettings.monthlyRateCentsPerBuMonth), flatRatePerBu: nonNegative(saved.flatRatePerBu, defaultSettings.flatRatePerBu), interestRatePct: nonNegative(saved.interestRatePct, defaultSettings.interestRatePct), truckingPerBu: nonNegative(saved.truckingPerBu, defaultSettings.truckingPerBu) }
  } catch { return defaultSettings }
}
function freshCommodityCarry(): CommodityCarry { return { harvestMonth: 9, defaultBasis: '0', rows: Array.from({ length: 13 }, () => ({ marketPrice: '', basis: '0' })) } }
function toNumber(value: string): number | null { const parsed = Number(value); return value.trim() !== '' && Number.isFinite(parsed) ? parsed : null }
function displayMonth(cropYear: number, harvestMonth: number, monthsStored: number) { return new Date(Date.UTC(cropYear, harvestMonth + monthsStored, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) }
function signedMoney(value: number) { return `${value > 0 ? '+' : value < 0 ? '−' : ''}${money.format(Math.abs(value))}` }

export function GrainCostOfCarry({ workspace, selectedEstimate, selectedEstimateId, onSelectEstimate }: { workspace: GrainWorkspace; selectedEstimate: ProductionEstimate; selectedEstimateId: string; onSelectEstimate: (id: string) => void }) {
  const farmId = workspace.fields.farm.id
  const [settings, setSettings] = useState<CarrySettings>(() => readSettings(farmId))
  const [byEstimate, setByEstimate] = useState<Record<string, CommodityCarry>>({})
  const carry = byEstimate[selectedEstimateId] ?? freshCommodityCarry()
  useEffect(() => { setSettings(readSettings(farmId)) }, [farmId])
  useEffect(() => { try { window.localStorage.setItem(settingsKey(farmId), JSON.stringify(settings)) } catch { /* private mode: calculator still works this visit */ } }, [farmId, settings])
  const updateCarry = (change: (current: CommodityCarry) => CommodityCarry) => setByEstimate((current) => ({ ...current, [selectedEstimateId]: change(current[selectedEstimateId] ?? freshCommodityCarry()) }))
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
  const setRate = (key: Exclude<keyof CarrySettings, 'mode'>, value: string) => { const parsed = Number(value); setSettings((current) => ({ ...current, [key]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 })) }
  const updateRow = (index: number, key: keyof PriceRow, value: string) => updateCarry((current) => ({ ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) }))
  const changeDefaultBasis = (value: string) => updateCarry((current) => ({ ...current, defaultBasis: value, rows: current.rows.map((row) => row.basis === current.defaultBasis ? { ...row, basis: value } : row) }))

  return <>
    <section className="grain-section carry-settings-card" aria-labelledby="carry-settings-title">
      <div className="section-heading"><div><span className="eyebrow">Carry costs</span><h2 id="carry-settings-title">How do you pay for storage?</h2><p>Monthly rate accumulates — the longer you store, the higher the cost.</p></div></div>
      <div className="carry-settings"><div className="carry-toggle" role="group" aria-label="Storage payment method"><button type="button" className={settings.mode === 'monthly' ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, mode: 'monthly' }))}>Option A — Monthly</button><button type="button" className={settings.mode === 'flat' ? 'active' : ''} onClick={() => setSettings((current) => ({ ...current, mode: 'flat' }))}>Option B — Flat rate</button></div>{settings.mode === 'monthly' ? <label>Monthly storage rate ¢/bu/mo<input aria-label="Monthly storage rate cents per bushel per month" type="number" min="0" step="0.1" inputMode="decimal" value={settings.monthlyRateCentsPerBuMonth} onChange={(event) => setRate('monthlyRateCentsPerBuMonth', event.target.value)} /></label> : <label>Flat storage rate $/bu<input aria-label="Flat storage rate dollars per bushel" type="number" min="0" step="0.01" inputMode="decimal" value={settings.flatRatePerBu} onChange={(event) => setRate('flatRatePerBu', event.target.value)} /></label>}<label>Interest rate %<input type="number" min="0" step="0.1" inputMode="decimal" value={settings.interestRatePct} onChange={(event) => setRate('interestRatePct', event.target.value)} /></label><label>2nd-haul trucking $/bu<input type="number" min="0" step="0.01" inputMode="decimal" value={settings.truckingPerBu} onChange={(event) => setRate('truckingPerBu', event.target.value)} /></label></div>
    </section>
    <section className="grain-section carry-calculator" aria-labelledby="carry-title">
      <div className="section-heading"><div><span className="eyebrow">Your numbers</span><h2 id="carry-title">Store or deliver at harvest</h2><p>Type the prices you can get. These manual prices run the math; delayed market quotes do not.</p></div><label className="commodity-picker"><span>Commodity</span><select value={selectedEstimateId} onChange={(event) => onSelectEstimate(event.target.value)}>{workspace.production_estimates.map((estimate) => <option key={estimate.id} value={estimate.id}>{workspace.fields.commodities.find((commodity) => commodity.id === estimate.commodity_id)?.name ?? estimate.commodity_id}</option>)}</select></label></div>
      <div className="carry-crop-controls"><label>Harvest month<select value={carry.harvestMonth} onChange={(event) => updateCarry((current) => ({ harvestMonth: Number(event.target.value), defaultBasis: current.defaultBasis, rows: Array.from({ length: 13 }, () => ({ marketPrice: '', basis: current.defaultBasis })) }))}>{monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}</select></label><label>Default basis $/bu<input type="number" step="0.01" inputMode="decimal" value={carry.defaultBasis} onChange={(event) => changeDefaultBasis(event.target.value)} /></label></div>
      <div className="carry-kpis" aria-label="Cost of carry results"><article className="stat-card"><span className="stat-label">Harvest cash / bu</span><strong className="stat-value">{harvestCash === null ? '—' : money.format(harvestCash)}</strong></article><article className="stat-card"><span className="stat-label">Best stored month</span><strong className="stat-value">{bestDate ?? '—'}</strong></article><article className="stat-card"><span className="stat-label">Best net vs harvest</span><strong className={`stat-value${best && best.netVsHarvest < 0 ? ' negative' : ''}`}>{best ? signedMoney(best.netVsHarvest) : '—'}</strong></article><article className="stat-card"><span className="stat-label">Verdict</span><strong className="stat-value carry-verdict">{!decision ? 'Enter prices' : decision.kind === 'harvest' ? 'Deliver at harvest' : `Store until ${verdictDate}`}</strong></article></div>
      <div className="table-scroll carry-table-scroll"><table className="carry-table"><thead><tr><th>Delivery month</th><th className="numeric">Market price $/bu</th><th className="numeric">Basis $/bu</th><th className="numeric">Cash price</th><th className="numeric">Mo</th><th className="numeric">Storage</th><th className="numeric">Interest</th><th className="numeric">Trucking</th><th className="numeric">Total carry</th><th className="numeric">Net vs harvest</th></tr></thead><tbody>{calculated.map((row) => { const isHarvest = row.index === 0; const result: CarryRow | null = row.result; const label = displayMonth(selectedEstimate.crop_year, carry.harvestMonth, row.index); return <tr key={row.index} className={isHarvest ? 'harvest-row' : undefined}><th scope="row"><strong>{label}</strong>{isHarvest && <span>★ Harvest delivery</span>}</th><td className="numeric"><input aria-label={`${label} market price per bushel`} type="number" step="0.01" inputMode="decimal" placeholder="0.00" value={carry.rows[row.index]?.marketPrice ?? ''} onChange={(event) => updateRow(row.index, 'marketPrice', event.target.value)} /></td><td className="numeric"><input aria-label={`${label} basis per bushel`} type="number" step="0.01" inputMode="decimal" value={carry.rows[row.index]?.basis ?? carry.defaultBasis} onChange={(event) => updateRow(row.index, 'basis', event.target.value)} /></td><td className="numeric">{row.cashPrice === null ? '—' : money.format(row.cashPrice)}</td><td className="numeric">{row.index}</td><td className="numeric">{result ? money.format(result.storageCost) : '—'}</td><td className="numeric">{result ? money.format(result.interestCost) : '—'}</td><td className="numeric">{result ? money.format(result.truckingCost) : '—'}</td><td className="numeric">{result ? money.format(result.totalCarry) : '—'}</td><td className={`numeric${result && result.netVsHarvest < 0 ? ' negative' : result && result.netVsHarvest > 0 ? ' positive' : ''}`}>{result ? signedMoney(result.netVsHarvest) : '—'}</td></tr> })}</tbody></table></div>
      <p className="carry-footer" aria-live="polite">{footer}</p>
    </section>
  </>
}
