import { useEffect, useMemo, useRef, useState } from 'react'
import { bestMonth, carryRow, verdict, type CarryRow, type CarrySettings } from './data/costOfCarry'
import type { GrainCarryGrid, GrainCarrySettings, GrainWorkspace, ProductionEstimate } from './data/grain'
import { CARRY_GRID_ROWS } from './data/grainSettings'
import { beginPendingSettingsWork, registerPendingSettingsFlush } from './data/pendingSettingsWork'
import { clearSettingsDraft, readSettingsDrafts, writeSettingsDraft, type SettingsDraftScope } from './data/settingsDrafts'

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
/** The per-device rates a farm saved before its settings table was live, or null when this device never stored any. */
function readStoredSettings(farmId: string): CarrySettings | null { try { return window.localStorage.getItem(settingsKey(farmId)) === null ? null : readSettings(farmId) } catch { return null } }
// `sent` is the content of the last row this screen saved for the part, kept with the draft so a remount still recognises its own
// write coming back (a queued save replayed with a newer version) and rebases the draft instead of replacing it.
type CarrySettingsDraft = { draft: CarrySettings; base: string | null; sent?: GrainCarrySettings | null }
type CarryGridDraft = { estimateId: string; draft: CommodityCarry; base: string | null; sent?: GrainCarryGrid | null }
function sameSettingsContent(a: GrainCarrySettings, b: GrainCarrySettings): boolean { return a.mode === b.mode && a.monthly_rate_cents_per_bu_month === b.monthly_rate_cents_per_bu_month && a.flat_rate_per_bu === b.flat_rate_per_bu && a.interest_rate_pct === b.interest_rate_pct && a.trucking_per_bu === b.trucking_per_bu }
function sameGridContent(a: GrainCarryGrid, b: GrainCarryGrid): boolean { return a.harvest_month === b.harvest_month && a.default_basis === b.default_basis && a.rows.length === b.rows.length && a.rows.every((row, index) => row.market_price === b.rows[index]?.market_price && row.basis === b.rows[index]?.basis) }
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
export type GrainCarryPersistence = { saveSettings: (settings: GrainCarrySettings) => Promise<GrainCarrySettings | void>; saveGrid: (grid: GrainCarryGrid) => Promise<GrainCarryGrid | void>; createId: () => string; draftScope?: SettingsDraftScope }

export function GrainCostOfCarry({ workspace, selectedEstimate, selectedEstimateId, onSelectEstimate, persistence }: { workspace: GrainWorkspace; selectedEstimate: ProductionEstimate; selectedEstimateId: string; onSelectEstimate: (id: string) => void; persistence?: GrainCarryPersistence }) {
  const farmId = workspace.fields.farm.id
  const persisted = !!persistence && workspace.capabilities?.persisted_settings === true
  // Where the browser draft for this account and farm lives (see settingsDrafts.ts); absent when the page has no account context yet.
  const draftScope = persisted ? persistence?.draftScope : undefined
  const draftScopeRef = useRef(draftScope); draftScopeRef.current = draftScope
  // The revision of the browser draft this screen last wrote or adopted, per part: a save clears only that revision.
  const draftRevisions = useRef<{ settings: string | null; grids: Record<string, string | null> }>({ settings: null, grids: {} })
  // The content of the last row each save sent. A refreshed row with the same content and a newer version is this screen's own
  // write coming back (a queued save replayed, its version advanced by the server): a draft still being edited is rebased onto it.
  const sentRows = useRef<{ settings: GrainCarrySettings | null; grids: Record<string, GrainCarryGrid | undefined> }>({ settings: null, grids: {} })
  // A farm with no row yet starts from the rates this device stored before the table was live (saved for the farm below), else the defaults.
  const initialSettings = () => persisted ? (workspace.grain_carry_settings ? settingsFromRow(workspace.grain_carry_settings) : readStoredSettings(farmId) ?? defaultSettings) : readSettings(farmId)
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
  // Drafts whose last save failed: they stay dirty and pending so the next flush (or a confirmed farm switch) retries them,
  // and a newer row arriving from the recovery refresh replaces them like a pristine draft instead of being held back.
  const failedSettings = useRef(false)
  const failedGrids = useRef(new Set<string>())
  const mounted = useRef(true)
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
    const snapshot = settingsRef.current; const revision = draftRevisions.current.settings
    enqueue(async () => {
      const current = workspaceRef.current; const scope = draftScopeRef.current
      try {
        const sent = settingsToRow(current.fields.farm.id, snapshot, baseVersions.current.settings ?? new Date().toISOString())
        const saved = await persistenceRef.current?.saveSettings(sent)
        if (saved) { baseVersions.current.settings = saved.updated_at; sentRows.current.settings = saved }
        failedSettings.current = false
        // Confirmed by the server or the durable queue: the browser draft is no longer needed unless the farmer typed more meanwhile,
        // in which case the newer draft is rewritten on top of the saved version so a reload cannot mistake this save for an outside change.
        if (scope && revision && !settingsDirty.current) clearSettingsDraft(scope, 'carry-settings', revision)
        else if (scope && settingsDirty.current) draftRevisions.current.settings = writeSettingsDraft(scope, 'carry-settings', { draft: settingsRef.current, base: baseVersions.current.settings, sent: sentRows.current.settings } satisfies CarrySettingsDraft)
      } catch (error) {
        // The browser draft stays until a later save is confirmed; a mounted screen also keeps the draft dirty and pending here.
        if (mounted.current) { settingsDirty.current = true; failedSettings.current = true; markUnflushed() }
        throw error
      }
    })
  }
  const flushGrids = () => {
    if (!persisted) return
    const ids = [...gridsDirty.current]; gridsDirty.current.clear()
    settleUnflushed()
    for (const estimateId of ids) {
      const snapshot = byEstimateRef.current[estimateId]; const revision = draftRevisions.current.grids[estimateId] ?? null
      if (!snapshot) continue
      enqueue(async () => {
        const current = workspaceRef.current; const active = persistenceRef.current; const scope = draftScopeRef.current
        if (!active || !current.production_estimates.some((estimate) => estimate.id === estimateId)) return
        const existing = current.grain_carry_grids.find((grid) => grid.production_estimate_id === estimateId)
        const id = existing?.id ?? (newGridIds.current[estimateId] ??= active.createId())
        try {
          const saved = await active.saveGrid(carryToGrid(snapshot, { id, farm_id: current.fields.farm.id, production_estimate_id: estimateId, updated_at: baseVersions.current.grids[estimateId] ?? existing?.updated_at ?? new Date().toISOString() }))
          if (saved) { baseVersions.current.grids[estimateId] = saved.updated_at; sentRows.current.grids[estimateId] = saved }
          failedGrids.current.delete(estimateId)
          if (scope && revision && !gridsDirty.current.has(estimateId)) clearSettingsDraft(scope, `carry-grid:${estimateId}`, revision)
          else if (scope && gridsDirty.current.has(estimateId)) { const newer = byEstimateRef.current[estimateId]; if (newer) draftRevisions.current.grids[estimateId] = writeSettingsDraft(scope, `carry-grid:${estimateId}`, { estimateId, draft: newer, base: baseVersions.current.grids[estimateId] ?? null, sent: sentRows.current.grids[estimateId] ?? null } satisfies CarryGridDraft) }
        } catch (error) {
          if (mounted.current) { gridsDirty.current.add(estimateId); failedGrids.current.add(estimateId); markUnflushed() }
          throw error
        }
      })
    }
  }
  useEffect(() => {
    setSettings(initialSettings()); setByEstimate(initialGrids()); settingsDirty.current = false; gridsDirty.current.clear(); failedSettings.current = false; failedGrids.current.clear(); settleUnflushed()
    baseVersions.current = { settings: workspace.grain_carry_settings?.updated_at ?? null, grids: Object.fromEntries(workspace.grain_carry_grids.map((grid) => [grid.production_estimate_id, grid.updated_at])) }
    if (!persisted) return
    // Rates this device stored before the farm's table was live, where the farm has no row yet: save them for the farm now.
    const legacy = workspace.grain_carry_settings ? null : readStoredSettings(farmId)
    if (legacy) { settingsDirty.current = true; markUnflushed(); if (draftScope) draftRevisions.current.settings = writeSettingsDraft(draftScope, 'carry-settings', { draft: legacy, base: null, sent: null } satisfies CarrySettingsDraft) }
    // Drafts this browser kept for this account and farm (an edit cut short by a reload, or a save that failed after the screen was
    // left) come back dirty and pending, marked like a failed draft so a newer row from elsewhere replaces them in the resync below.
    if (!draftScope) return
    for (const entry of readSettingsDrafts(draftScope, 'carry-')) {
      if (entry.key === 'carry-settings') { const kept = entry.payload as CarrySettingsDraft; setSettings(kept.draft); settingsRef.current = kept.draft; baseVersions.current.settings = kept.base; sentRows.current.settings = kept.sent ?? null; draftRevisions.current.settings = entry.revision; settingsDirty.current = true; failedSettings.current = true; markUnflushed() }
      else { const kept = entry.payload as CarryGridDraft; setByEstimate((current) => ({ ...current, [kept.estimateId]: kept.draft })); byEstimateRef.current = { ...byEstimateRef.current, [kept.estimateId]: kept.draft }; baseVersions.current.grids[kept.estimateId] = kept.base; if (kept.sent) sentRows.current.grids[kept.estimateId] = kept.sent; draftRevisions.current.grids[kept.estimateId] = entry.revision; gridsDirty.current.add(kept.estimateId); failedGrids.current.add(kept.estimateId); markUnflushed() }
    }
  }, [farmId, persisted, draftScope?.userId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Rows changed elsewhere (another device, or a refresh after another Grain save) replace a pristine draft and its version;
  // a draft still being edited keeps its original version so its save conflicts rather than overwriting the newer row.
  useEffect(() => {
    if (!persisted) return
    const row = workspace.grain_carry_settings; const version = row?.updated_at ?? null
    if (version !== baseVersions.current.settings && settingsDirty.current && row && sentRows.current.settings && sameSettingsContent(row, sentRows.current.settings)) {
      // This screen's own queued save came back with its replayed version (even after a remount, since the lineage travels with the
      // draft): keep the draft being edited and rebase it.
      baseVersions.current.settings = version; failedSettings.current = false
      if (draftScope) draftRevisions.current.settings = writeSettingsDraft(draftScope, 'carry-settings', { draft: settingsRef.current, base: version, sent: sentRows.current.settings } satisfies CarrySettingsDraft)
    } else if (version !== baseVersions.current.settings && (!settingsDirty.current || failedSettings.current)) { baseVersions.current.settings = version; setSettings(row ? settingsFromRow(row) : defaultSettings); settingsDirty.current = false; failedSettings.current = false; settleUnflushed(); if (draftScope && draftRevisions.current.settings) clearSettingsDraft(draftScope, 'carry-settings', draftRevisions.current.settings) }
    for (const grid of workspace.grain_carry_grids) {
      const estimateId = grid.production_estimate_id
      const sent = sentRows.current.grids[estimateId]
      if (grid.updated_at !== (baseVersions.current.grids[estimateId] ?? null) && gridsDirty.current.has(estimateId) && sent && sameGridContent(grid, sent)) {
        baseVersions.current.grids[estimateId] = grid.updated_at; failedGrids.current.delete(estimateId)
        const draft = byEstimateRef.current[estimateId]
        if (draftScope && draft) draftRevisions.current.grids[estimateId] = writeSettingsDraft(draftScope, `carry-grid:${estimateId}`, { estimateId, draft, base: grid.updated_at, sent } satisfies CarryGridDraft)
      } else if (grid.updated_at !== (baseVersions.current.grids[estimateId] ?? null) && (!gridsDirty.current.has(estimateId) || failedGrids.current.has(estimateId))) { baseVersions.current.grids[estimateId] = grid.updated_at; setByEstimate((current) => ({ ...current, [estimateId]: carryFromGrid(grid) })); gridsDirty.current.delete(estimateId); failedGrids.current.delete(estimateId); settleUnflushed(); const revision = draftRevisions.current.grids[estimateId]; if (draftScope && revision) clearSettingsDraft(draftScope, `carry-grid:${estimateId}`, revision) }
    }
  }, [workspace.grain_carry_settings, workspace.grain_carry_grids, persisted, draftScope?.userId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (persisted) return; try { window.localStorage.setItem(settingsKey(farmId), JSON.stringify(settings)) } catch { /* private mode: calculator still works this visit */ } }, [farmId, settings, persisted])
  useEffect(() => { if (!persisted || !settingsDirty.current) return; const timer = setTimeout(flushSettings, SAVE_DELAY_MS); return () => clearTimeout(timer) }, [settings, persisted]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!persisted || gridsDirty.current.size === 0) return; const timer = setTimeout(flushGrids, SAVE_DELAY_MS); return () => clearTimeout(timer) }, [byEstimate, persisted]) // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the screen sends whatever is still unflushed; a save that fails after that leaves the browser draft for the next visit.
  useEffect(() => () => { mounted.current = false; flushSettings(); flushGrids() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // A confirmed farm switch sends unflushed edits through here and then waits for the chain before the farm changes.
  useEffect(() => persisted ? registerPendingSettingsFlush(farmId, () => { flushSettings(); flushGrids() }) : undefined, [farmId, persisted]) // eslint-disable-line react-hooks/exhaustive-deps
  // Every edit is written to the browser draft at once, before the save pause, so a reload or closed tab cannot lose it.
  // If the browser refuses the draft (private mode, blocked or full storage), the edit is not kept anywhere durable: save it at once instead of waiting.
  const keepDraft = (key: string, payload: unknown, flush: () => void): string | null => { if (!draftScope) return null; const revision = writeSettingsDraft(draftScope, key, payload); if (revision === null) { clearSettingsDraft(draftScope, key); setTimeout(flush, 0) } return revision }
  const changeSettings = (change: (current: CarrySettings) => CarrySettings) => { const next = change(settingsRef.current); settingsRef.current = next; settingsDirty.current = true; failedSettings.current = false; if (persisted) markUnflushed(); draftRevisions.current.settings = keepDraft('carry-settings', { draft: next, base: baseVersions.current.settings, sent: sentRows.current.settings } satisfies CarrySettingsDraft, flushSettings); setSettings(next) }
  // Discrete choices (the storage-mode buttons) save as soon as React has committed the click, not after the typing pause.
  const chooseMode = (mode: CarrySettings['mode']) => { changeSettings((current) => ({ ...current, mode })); setTimeout(flushSettings, 0) }
  const updateCarry = (change: (current: CommodityCarry) => CommodityCarry) => { const next = change(byEstimateRef.current[selectedEstimateId] ?? freshCommodityCarry()); byEstimateRef.current = { ...byEstimateRef.current, [selectedEstimateId]: next }; gridsDirty.current.add(selectedEstimateId); failedGrids.current.delete(selectedEstimateId); if (persisted) markUnflushed(); draftRevisions.current.grids[selectedEstimateId] = keepDraft(`carry-grid:${selectedEstimateId}`, { estimateId: selectedEstimateId, draft: next, base: baseVersions.current.grids[selectedEstimateId] ?? null, sent: sentRows.current.grids[selectedEstimateId] ?? null } satisfies CarryGridDraft, flushGrids); setByEstimate((current) => ({ ...current, [selectedEstimateId]: next })) }
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
