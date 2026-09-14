import { useEffect, useMemo, useRef, useState } from 'react'
import { bestMonth, carryRow, verdict, type CarryRow, type CarrySettings } from './data/costOfCarry'
import type { GrainCarryGrid, GrainCarrySettings, GrainWorkspace, ProductionEstimate } from './data/grain'
import { CARRY_GRID_ROWS, normalizeGrainCarrySettings, stableGrainCarryGridId, validateGrainCarrySettings } from './data/grainSettings'
import { boundedDecimal } from './data/decimal'
import { quarantineTiedSettingsDrafts } from './data/revokedFarmRecovery'
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
function forgetStoredSettings(farmId: string) { try { window.localStorage.removeItem(settingsKey(farmId)) } catch { /* nothing to remove, or storage blocked: the key is retried on the next confirmed save */ } }
function readStoredSettings(farmId: string): CarrySettings | null {
  try {
    if (window.localStorage.getItem(settingsKey(farmId)) === null) return null
    const stored = readSettings(farmId)
    // The old screen accepted any non-negative rate; the farm's table refuses, for one, an interest rate above 100 %. Such a value
    // would leave the farm pending on a save that can never succeed, so it is not adopted (the caller then drops the key).
    return validateGrainCarrySettings(settingsToRow(farmId, stored, new Date().toISOString())).length === 0 ? stored : null
  } catch { return null }
}
// `sent` is the content of the last row this screen saved for the part, kept with the draft so a remount still recognises its own
// write coming back (a queued save replayed with a newer version) and rebases the draft instead of replacing it.
type CarrySettingsDraft = { draft: CarrySettings; base: string | null; sent?: GrainCarrySettings | null }
type CarryGridDraft = { estimateId: string; draft: CommodityCarry; base: string | null; sent?: GrainCarryGrid | null }
// A kept draft is used only when its shape is the one this screen writes; anything else (an older release, a damaged entry) is dropped.
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isCarrySettings = (value: unknown): value is CarrySettings => isObject(value) && (value.mode === 'monthly' || value.mode === 'flat') && finiteNumber(value.monthlyRateCentsPerBuMonth) && finiteNumber(value.flatRatePerBu) && finiteNumber(value.interestRatePct) && finiteNumber(value.truckingPerBu)
const isPriceRow = (value: unknown): value is PriceRow => isObject(value) && typeof value.marketPrice === 'string' && typeof value.basis === 'string'
const isCommodityCarry = (value: unknown): value is CommodityCarry => isObject(value) && Number.isInteger(value.harvestMonth) && (value.harvestMonth as number) >= 0 && (value.harvestMonth as number) <= 11 && typeof value.defaultBasis === 'string' && Array.isArray(value.rows) && value.rows.length === CARRY_GRID_ROWS && value.rows.every(isPriceRow)
const validBase = (value: unknown) => value === null || typeof value === 'string'
// The lineage is the row the last save returned; only a complete row of the right kind is accepted, so the resync's content
// comparison never reads a field that is not there.
const isSentSettings = (value: unknown): value is GrainCarrySettings => isObject(value) && typeof value.farm_id === 'string' && (value.mode === 'monthly' || value.mode === 'flat') && finiteNumber(value.monthly_rate_cents_per_bu_month) && finiteNumber(value.flat_rate_per_bu) && finiteNumber(value.interest_rate_pct) && finiteNumber(value.trucking_per_bu) && typeof value.updated_at === 'string'
const isSentGridRow = (value: unknown) => isObject(value) && (value.market_price === null || finiteNumber(value.market_price)) && (value.basis === null || finiteNumber(value.basis))
const isSentGrid = (value: unknown): value is GrainCarryGrid => isObject(value) && typeof value.id === 'string' && typeof value.farm_id === 'string' && typeof value.production_estimate_id === 'string' && Number.isInteger(value.harvest_month) && finiteNumber(value.default_basis) && Array.isArray(value.rows) && value.rows.length === CARRY_GRID_ROWS && value.rows.every(isSentGridRow) && typeof value.updated_at === 'string'
const validSent = (value: unknown, isRow: (row: unknown) => boolean) => value === undefined || value === null || isRow(value)
export const isCarryDraft = (key: string, payload: unknown): boolean => key === 'carry-settings'
  ? isObject(payload) && isCarrySettings(payload.draft) && validBase(payload.base) && validSent(payload.sent, isSentSettings)
  : key.startsWith('carry-grid:') && isObject(payload) && typeof payload.estimateId === 'string' && payload.estimateId === key.slice('carry-grid:'.length) && isCommodityCarry(payload.draft) && validBase(payload.base) && validSent(payload.sent, isSentGrid)
function sameSettingsContent(a: GrainCarrySettings, b: GrainCarrySettings): boolean { return a.mode === b.mode && a.monthly_rate_cents_per_bu_month === b.monthly_rate_cents_per_bu_month && a.flat_rate_per_bu === b.flat_rate_per_bu && a.interest_rate_pct === b.interest_rate_pct && a.trucking_per_bu === b.trucking_per_bu }
function sameGridContent(a: GrainCarryGrid, b: GrainCarryGrid): boolean { return a.harvest_month === b.harvest_month && a.default_basis === b.default_basis && a.rows.length === b.rows.length && a.rows.every((row, index) => row.market_price === b.rows[index]?.market_price && row.basis === b.rows[index]?.basis) }
function settingsFromRow(row: GrainCarrySettings): CarrySettings { return { mode: row.mode === 'flat' ? 'flat' : 'monthly', monthlyRateCentsPerBuMonth: nonNegative(row.monthly_rate_cents_per_bu_month, defaultSettings.monthlyRateCentsPerBuMonth), flatRatePerBu: nonNegative(row.flat_rate_per_bu, defaultSettings.flatRatePerBu), interestRatePct: nonNegative(row.interest_rate_pct, defaultSettings.interestRatePct), truckingPerBu: nonNegative(row.trucking_per_bu, defaultSettings.truckingPerBu) } }
function settingsToRow(farmId: string, settings: CarrySettings, updatedAt: string): GrainCarrySettings { return { farm_id: farmId, mode: settings.mode, monthly_rate_cents_per_bu_month: settings.monthlyRateCentsPerBuMonth, flat_rate_per_bu: settings.flatRatePerBu, interest_rate_pct: settings.interestRatePct, trucking_per_bu: settings.truckingPerBu, updated_at: updatedAt } }
function freshCommodityCarry(): CommodityCarry { return { harvestMonth: 9, defaultBasis: '0', rows: Array.from({ length: CARRY_GRID_ROWS }, () => ({ marketPrice: '', basis: '0' })) } }
function toNumber(value: string): number | null { const parsed = Number(value); return value.trim() !== '' && Number.isFinite(parsed) ? parsed : null }
type RateKey = Exclude<keyof CarrySettings, 'mode'>
/** Why the farm's table would refuse this rate, in the farmer's words, or null when it can be saved. Checked before the edit is kept
 * or queued, so a value no save could ever land (an interest rate above 100 %, a rate too large for its column) never becomes a
 * pending draft that every flush retries and a confirmed farm switch refuses. */
function rateProblem(farmId: string, current: CarrySettings, key: RateKey, value: number): string | null {
  const row = settingsToRow(farmId, { ...current, [key]: value }, new Date().toISOString())
  const [error] = validateGrainCarrySettings(row); if (error) return error
  try { normalizeGrainCarrySettings(row); return null } catch (caught) { return refusalMessage(caught, 'That rate cannot be saved.') }
}
/** Why the farm's table would refuse this grid number (a price or basis beyond its column), or null when it can be saved or is blank. */
function cellProblem(value: string, label: string): string | null {
  const parsed = toNumber(value); if (parsed === null) return null
  try { boundedDecimal(parsed, { precision: 10, scale: 4, label }); return null } catch (caught) { return refusalMessage(caught, 'That number cannot be saved.') }
}
function refusalMessage(caught: unknown, fallback: string): string { const message = caught instanceof Error ? caught.message : fallback; return message.charAt(0).toUpperCase() + message.slice(1) }
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
export type GrainCarryPersistence = { saveSettings: (settings: GrainCarrySettings) => Promise<GrainCarrySettings | void>; saveGrid: (grid: GrainCarryGrid) => Promise<GrainCarryGrid | void>; draftScope?: SettingsDraftScope; /** False for a member who may read but not write the farm's settings: nothing is saved on their behalf (the legacy-rate adoption in particular). */ writable?: boolean }

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
  // A number the farm's table would refuse (a rate, a price, a basis) stays in its field with the reason while it is typed and is
  // neither kept nor queued; leaving the field puts the last accepted value back and keeps the reason on screen until a number that
  // can be saved is typed there.
  const [refused, setRefused] = useState<{ field: string; text: string | null; message: string } | null>(null)
  const newGridIds = useRef<Record<string, string>>({})
  // Every queued save (and any unflushed edit) keeps the farm marked pending for the farm switcher until it has run.
  // A save that fails before reaching the server or the durable queue marks its token failed, so a confirmed farm switch stops instead of discarding the edit.
  const pendingScope = () => { const scope = draftScopeRef.current; return scope ? { userId: scope.userId, farmId: scope.farmId } : null }
  const enqueue = (work: () => Promise<void>) => { const scope = pendingScope(); const done = scope ? beginPendingSettingsWork(scope) : () => undefined; chain.current = chain.current.then(() => work().then(() => done(), (error: unknown) => done(error ?? new Error('Settings save failed.')))) }
  const unflushed = useRef<(() => void) | null>(null)
  const markUnflushed = () => { const scope = pendingScope(); if (scope) unflushed.current ??= beginPendingSettingsWork(scope) }
  const settleUnflushed = () => { if (!settingsDirty.current && gridsDirty.current.size === 0) { unflushed.current?.(); unflushed.current = null } }
  // Every draft write goes through here. If the browser refuses the draft (private mode, blocked or full storage), the edit is not
  // kept anywhere durable: the stale entry is cleared and the part is re-sent at once from its newest snapshot, whether it was still
  // being typed or already queued behind an earlier save (the resend marks the part dirty so the flush is never a no-op).
  const keepDraft = (key: string, payload: unknown, resend: () => void): string | null => { const scope = draftScopeRef.current; if (!scope) return null; const previous = key === 'carry-settings' ? draftRevisions.current.settings : draftRevisions.current.grids[key.slice('carry-grid:'.length)]; const revision = writeSettingsDraft(scope, key, payload); if (revision === null) { if (previous) clearSettingsDraft(scope, key, previous); setTimeout(resend, 0) } return revision }
  const resendSettings = () => { settingsDirty.current = true; flushSettings() }
  const resendGrid = (estimateId: string) => () => { gridsDirty.current.add(estimateId); flushGrids() }
  // A save queued while the member could write must not go out after edit access was lost (offline it would be queued and replayed
  // later, online it would be refused and re-mark the farm pending with no flusher left): the draft stays in storage, nothing is sent.
  const readOnly = () => persistenceRef.current?.writable === false
  const flushSettings = () => {
    if (!persisted || !settingsDirty.current || readOnly()) return
    settingsDirty.current = false
    settleUnflushed()
    const snapshot = settingsRef.current
    enqueue(async () => {
      if (readOnly()) return
      const current = workspaceRef.current; const scope = draftScopeRef.current
      try {
        const sent = settingsToRow(current.fields.farm.id, snapshot, baseVersions.current.settings ?? new Date().toISOString())
        const saved = await persistenceRef.current?.saveSettings(sent)
        if (saved) { baseVersions.current.settings = saved.updated_at; sentRows.current.settings = saved }
        failedSettings.current = false
        // Confirmed by the server or the durable queue: the device-only rates this farm may have adopted are superseded and removed.
        forgetStoredSettings(current.fields.farm.id)
        // Confirmed by the server or the durable queue: the browser draft is no longer needed unless a newer draft exists (the farmer
        // typed more, or a successor edit already flushed and is queued behind this save), in which case the newer draft is rewritten
        // on top of the saved version so a reload cannot mistake this save for an outside change.
        const newer = settingsDirty.current || JSON.stringify(settingsRef.current) !== JSON.stringify(snapshot)
        // Nothing newer was typed: the screen adopts the row as saved (rates rounded to the column's four decimals), so the figures
        // on screen are the figures the farm holds. The resync effect cannot do this, since the save's own version is already the base.
        if (!newer && saved) { const adopted = settingsFromRow(saved); settingsRef.current = adopted; setSettings(adopted) }
        if (scope) {
          if (!newer) { const revision = draftRevisions.current.settings; if (revision) clearSettingsDraft(scope, 'carry-settings', revision); draftRevisions.current.settings = null }
          else draftRevisions.current.settings = keepDraft('carry-settings', { draft: settingsRef.current, base: baseVersions.current.settings, sent: sentRows.current.settings } satisfies CarrySettingsDraft, resendSettings)
        }
      } catch (error) {
        // The browser draft stays until a later save is confirmed; a mounted screen that may still write also keeps the draft dirty and pending here.
        if (mounted.current && !readOnly()) { settingsDirty.current = true; failedSettings.current = true; markUnflushed() }
        throw error
      }
    })
  }
  const flushGrids = () => {
    if (!persisted || readOnly()) return
    const ids = [...gridsDirty.current]; gridsDirty.current.clear()
    settleUnflushed()
    for (const estimateId of ids) {
      const snapshot = byEstimateRef.current[estimateId]
      if (!snapshot) continue
      enqueue(async () => {
        const current = workspaceRef.current; const active = persistenceRef.current; const scope = draftScopeRef.current
        if (!active || readOnly() || !current.production_estimates.some((estimate) => estimate.id === estimateId)) return
        const existing = current.grain_carry_grids.find((grid) => grid.production_estimate_id === estimateId)
        // A first insert takes the id derived from the farm and the estimate, so another tab's first insert of the same grid is the same row.
        const id = existing?.id ?? (newGridIds.current[estimateId] ??= await stableGrainCarryGridId(current.fields.farm.id, estimateId))
        try {
          const saved = await active.saveGrid(carryToGrid(snapshot, { id, farm_id: current.fields.farm.id, production_estimate_id: estimateId, updated_at: baseVersions.current.grids[estimateId] ?? existing?.updated_at ?? new Date().toISOString() }))
          if (saved) { baseVersions.current.grids[estimateId] = saved.updated_at; sentRows.current.grids[estimateId] = saved }
          failedGrids.current.delete(estimateId)
          const latest = byEstimateRef.current[estimateId]
          const newer = gridsDirty.current.has(estimateId) || JSON.stringify(latest) !== JSON.stringify(snapshot)
          // Nothing newer was typed in this grid: the screen adopts the rows as saved (prices and bases rounded to four decimals).
          if (!newer && saved) { const adopted = carryFromGrid(saved); byEstimateRef.current = { ...byEstimateRef.current, [estimateId]: adopted }; setByEstimate((current) => ({ ...current, [estimateId]: adopted })) }
          if (scope) {
            if (!newer) { const revision = draftRevisions.current.grids[estimateId]; if (revision) clearSettingsDraft(scope, `carry-grid:${estimateId}`, revision); draftRevisions.current.grids[estimateId] = null }
            else if (latest) draftRevisions.current.grids[estimateId] = keepDraft(`carry-grid:${estimateId}`, { estimateId, draft: latest, base: baseVersions.current.grids[estimateId] ?? null, sent: sentRows.current.grids[estimateId] ?? null } satisfies CarryGridDraft, resendGrid(estimateId))
          }
        } catch (error) {
          if (mounted.current && !readOnly()) { gridsDirty.current.add(estimateId); failedGrids.current.add(estimateId); markUnflushed() }
          throw error
        }
      })
    }
  }
  useEffect(() => {
    setSettings(initialSettings()); setByEstimate(initialGrids()); settingsDirty.current = false; gridsDirty.current.clear(); failedSettings.current = false; failedGrids.current.clear(); settleUnflushed()
    baseVersions.current = { settings: workspace.grain_carry_settings?.updated_at ?? null, grids: Object.fromEntries(workspace.grain_carry_grids.map((grid) => [grid.production_estimate_id, grid.updated_at])) }
    if (!persisted) return
    // Rates this device stored before the farm's table was live, where the farm has no row yet: save them for the farm now, but only
    // for a member who may write them (a read-only viewer would see every such save refused and the farm stuck as pending).
    // Once the farm has its own row, the rates this device stored before the table was live are superseded and are removed: the key
    // names neither the account nor the project, so the revocation quarantine cannot claim it, and nothing reads it again.
    if (workspace.grain_carry_settings) forgetStoredSettings(farmId)
    const legacy = workspace.grain_carry_settings || persistence?.writable === false ? null : readStoredSettings(farmId)
    // A device value the farm's table would refuse cannot be migrated: it is dropped and the screen starts from the defaults.
    if (!workspace.grain_carry_settings && persistence?.writable !== false && legacy === null) forgetStoredSettings(farmId)
    if (legacy) { settingsDirty.current = true; markUnflushed(); if (draftScope) draftRevisions.current.settings = keepDraft('carry-settings', { draft: legacy, base: null, sent: null } satisfies CarrySettingsDraft, resendSettings) }
    // Drafts this browser kept for this account and farm (an edit cut short by a reload, or a save that failed after the screen was
    // left) come back dirty and pending, marked like a failed draft so a newer row from elsewhere replaces them in the resync below.
    // A member who may read but not write leaves them in storage, untouched and unsent, until edit access returns (this effect then
    // runs again and adopts them); nothing is saved on their behalf.
    if (!draftScope || persistence?.writable === false) return
    // Two tabs that wrote the same draft at the same moment: the write read back is restored below; the other goes to the recovery
    // vault for the farmer to check (it stays in storage, reported again next time, if the vault cannot be written).
    const toVault = (_kept: unknown, tied: Parameters<typeof quarantineTiedSettingsDrafts>[2]) => { try { quarantineTiedSettingsDrafts(window.localStorage, draftScope, tied) } catch { /* the tied writes stay in storage */ } }
    for (const entry of readSettingsDrafts(draftScope, 'carry-', isCarryDraft, toVault)) {
      if (entry.key === 'carry-settings') { const kept = entry.payload as CarrySettingsDraft; setSettings(kept.draft); settingsRef.current = kept.draft; baseVersions.current.settings = kept.base; sentRows.current.settings = kept.sent ?? null; draftRevisions.current.settings = entry.revision; settingsDirty.current = true; failedSettings.current = true; markUnflushed() }
      else { const kept = entry.payload as CarryGridDraft; setByEstimate((current) => ({ ...current, [kept.estimateId]: kept.draft })); byEstimateRef.current = { ...byEstimateRef.current, [kept.estimateId]: kept.draft }; baseVersions.current.grids[kept.estimateId] = kept.base; if (kept.sent) sentRows.current.grids[kept.estimateId] = kept.sent; draftRevisions.current.grids[kept.estimateId] = entry.revision; gridsDirty.current.add(kept.estimateId); failedGrids.current.add(kept.estimateId); markUnflushed() }
    }
  }, [farmId, persisted, draftScope?.userId, persistence?.writable]) // eslint-disable-line react-hooks/exhaustive-deps
  // Rows changed elsewhere (another device, or a refresh after another Grain save) replace a pristine draft and its version;
  // a draft still being edited keeps its original version so its save conflicts rather than overwriting the newer row.
  useEffect(() => {
    if (!persisted) return
    const row = workspace.grain_carry_settings; const version = row?.updated_at ?? null
    // Whatever brought the row (this screen's save, another device's row after a conflict, a replay), it supersedes the device-only rates.
    if (row) forgetStoredSettings(farmId)
    if (version !== baseVersions.current.settings && settingsDirty.current && row && sentRows.current.settings && sameSettingsContent(row, sentRows.current.settings)) {
      // This screen's own queued save came back with its replayed version (even after a remount, since the lineage travels with the
      // draft): keep the draft being edited and rebase it.
      baseVersions.current.settings = version; failedSettings.current = false
      if (draftScope) draftRevisions.current.settings = keepDraft('carry-settings', { draft: settingsRef.current, base: version, sent: sentRows.current.settings } satisfies CarrySettingsDraft, resendSettings)
    } else if (version !== baseVersions.current.settings && (!settingsDirty.current || failedSettings.current)) { baseVersions.current.settings = version; setSettings(row ? settingsFromRow(row) : defaultSettings); settingsDirty.current = false; failedSettings.current = false; settleUnflushed(); if (draftScope && draftRevisions.current.settings) clearSettingsDraft(draftScope, 'carry-settings', draftRevisions.current.settings) }
    for (const grid of workspace.grain_carry_grids) {
      const estimateId = grid.production_estimate_id
      const sent = sentRows.current.grids[estimateId]
      if (grid.updated_at !== (baseVersions.current.grids[estimateId] ?? null) && gridsDirty.current.has(estimateId) && sent && sameGridContent(grid, sent)) {
        baseVersions.current.grids[estimateId] = grid.updated_at; failedGrids.current.delete(estimateId)
        const draft = byEstimateRef.current[estimateId]
        if (draftScope && draft) draftRevisions.current.grids[estimateId] = keepDraft(`carry-grid:${estimateId}`, { estimateId, draft, base: grid.updated_at, sent } satisfies CarryGridDraft, resendGrid(estimateId))
      } else if (grid.updated_at !== (baseVersions.current.grids[estimateId] ?? null) && (!gridsDirty.current.has(estimateId) || failedGrids.current.has(estimateId))) { baseVersions.current.grids[estimateId] = grid.updated_at; setByEstimate((current) => ({ ...current, [estimateId]: carryFromGrid(grid) })); gridsDirty.current.delete(estimateId); failedGrids.current.delete(estimateId); settleUnflushed(); const revision = draftRevisions.current.grids[estimateId]; if (draftScope && revision) clearSettingsDraft(draftScope, `carry-grid:${estimateId}`, revision) }
    }
  }, [workspace.grain_carry_settings, workspace.grain_carry_grids, persisted, draftScope?.userId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (persisted) return; try { window.localStorage.setItem(settingsKey(farmId), JSON.stringify(settings)) } catch { /* private mode: calculator still works this visit */ } }, [farmId, settings, persisted])
  useEffect(() => { if (!persisted || !settingsDirty.current) return; const timer = setTimeout(flushSettings, SAVE_DELAY_MS); return () => clearTimeout(timer) }, [settings, persisted]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!persisted || gridsDirty.current.size === 0) return; const timer = setTimeout(flushGrids, SAVE_DELAY_MS); return () => clearTimeout(timer) }, [byEstimate, persisted]) // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the screen sends whatever is still unflushed; a save that fails after that leaves the browser draft for the next visit.
  // The flag is set on every setup, not only at first render: React's development StrictMode runs setup, cleanup, setup once, and a flag
  // left false after that would make every later failed save skip its retry bookkeeping while the screen is still on.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; flushSettings(); flushGrids() } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // A confirmed farm switch sends unflushed edits through here and then waits for the chain before the farm changes.
  // A member who may not write has nothing to send (the reset effect above settled the registry and left the drafts in storage).
  useEffect(() => persisted && draftScope && persistence?.writable !== false ? registerPendingSettingsFlush({ userId: draftScope.userId, farmId }, () => { flushSettings(); flushGrids() }) : undefined, [farmId, persisted, draftScope?.userId, persistence?.writable]) // eslint-disable-line react-hooks/exhaustive-deps
  // Every edit is written to the browser draft at once, before the save pause, so a reload or closed tab cannot lose it.
  // If the browser refuses the draft (private mode, blocked or full storage), the edit is not kept anywhere durable: save it at once instead of waiting.
  // Only the revision this tab wrote before is removed then; a newer draft another tab wrote under the same key stays.
  const changeSettings = (change: (current: CarrySettings) => CarrySettings) => { const next = change(settingsRef.current); settingsRef.current = next; settingsDirty.current = true; failedSettings.current = false; if (persisted) markUnflushed(); draftRevisions.current.settings = keepDraft('carry-settings', { draft: next, base: baseVersions.current.settings, sent: sentRows.current.settings } satisfies CarrySettingsDraft, resendSettings); setSettings(next) }
  // Discrete choices (the storage-mode buttons) save as soon as React has committed the click, not after the typing pause.
  const chooseMode = (mode: CarrySettings['mode']) => { changeSettings((current) => ({ ...current, mode })); setTimeout(flushSettings, 0) }
  const updateCarry = (change: (current: CommodityCarry) => CommodityCarry) => { const next = change(byEstimateRef.current[selectedEstimateId] ?? freshCommodityCarry()); byEstimateRef.current = { ...byEstimateRef.current, [selectedEstimateId]: next }; gridsDirty.current.add(selectedEstimateId); failedGrids.current.delete(selectedEstimateId); if (persisted) markUnflushed(); draftRevisions.current.grids[selectedEstimateId] = keepDraft(`carry-grid:${selectedEstimateId}`, { estimateId: selectedEstimateId, draft: next, base: baseVersions.current.grids[selectedEstimateId] ?? null, sent: sentRows.current.grids[selectedEstimateId] ?? null } satisfies CarryGridDraft, resendGrid(selectedEstimateId)); setByEstimate((current) => ({ ...current, [selectedEstimateId]: next })) }
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
  const refuse = (field: string, text: string, message: string) => setRefused({ field, text, message })
  // Any number that can be saved, in any field, clears the note: the farmer has moved on from the refused one.
  const accept = () => setRefused(null)
  // Leaving a refused field: the last accepted value shows again and the reason says so, until a number that can be saved is typed.
  const leave = (field: string, kept: string, flush: () => void) => { setRefused((current) => current && current.field === field ? { ...current, text: null, message: `${current.message} The field went back to ${kept === '' ? 'blank' : kept}.` } : current); flush() }
  const shown = (field: string, value: string | number) => refused?.field === field && refused.text !== null ? refused.text : value
  const invalid = (field: string) => refused?.field === field && refused.text !== null ? true : undefined
  const describedBy = (field: string, note: string) => refused?.field === field ? note : undefined
  const setRate = (key: RateKey, value: string) => {
    const parsed = Number(value); const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    const problem = rateProblem(workspaceRef.current.fields.farm.id, settingsRef.current, key, next)
    if (problem) { refuse(`rate:${key}`, value, problem); return }
    accept()
    changeSettings((current) => ({ ...current, [key]: next }))
  }
  const rateField = (key: RateKey, label: string, step: string, ariaLabel?: string) => <label>{label}<input aria-label={ariaLabel} aria-invalid={invalid(`rate:${key}`)} aria-describedby={describedBy(`rate:${key}`, 'carry-refused-rate')} type="number" min="0" step={step} inputMode="decimal" value={shown(`rate:${key}`, settings[key])} onChange={(event) => setRate(key, event.target.value)} onBlur={() => leave(`rate:${key}`, String(settingsRef.current[key]), flushSettings)} /></label>
  const updateRow = (index: number, key: keyof PriceRow, value: string) => {
    const field = `cell:${index}:${key}`; const problem = cellProblem(value, key === 'marketPrice' ? 'a market price' : 'a basis')
    if (problem) { refuse(field, value, problem); return }
    accept()
    updateCarry((current) => ({ ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) }))
  }
  const changeDefaultBasis = (value: string) => {
    const problem = cellProblem(value, 'the default basis')
    if (problem) { refuse('default-basis', value, problem); return }
    accept()
    updateCarry((current) => ({ ...current, defaultBasis: value, rows: current.rows.map((row) => row.basis === current.defaultBasis ? { ...row, basis: value } : row) }))
  }
  const refusedNote = (id: string, fields: (field: string) => boolean, className: string) => refused && fields(refused.field) ? <p className={className} id={id} role="alert">{refused.message}</p> : null
  const storageNote = persisted ? 'Your rates and prices are saved for this farm on every device as you type.' : 'Your rates and prices stay on this device until the farm settings update is live.'

  return <>
    <section className="grain-section carry-settings-card" aria-labelledby="carry-settings-title">
      <div className="section-heading"><div><span className="eyebrow">Carry costs</span><h2 id="carry-settings-title">How do you pay for storage?</h2><p>Monthly rate accumulates — the longer you store, the higher the cost. {storageNote}</p></div></div>
      <div className="carry-settings"><div className="carry-toggle" role="group" aria-label="Storage payment method"><button type="button" className={settings.mode === 'monthly' ? 'active' : ''} onClick={() => chooseMode('monthly')}>Option A — Monthly</button><button type="button" className={settings.mode === 'flat' ? 'active' : ''} onClick={() => chooseMode('flat')}>Option B — Flat rate</button></div>{settings.mode === 'monthly' ? rateField('monthlyRateCentsPerBuMonth', 'Monthly storage rate ¢/bu/mo', '0.1', 'Monthly storage rate cents per bushel per month') : rateField('flatRatePerBu', 'Flat storage rate $/bu', '0.01', 'Flat storage rate dollars per bushel')}{rateField('interestRatePct', 'Interest rate %', '0.1')}{rateField('truckingPerBu', '2nd-haul trucking $/bu', '0.01')}{refusedNote('carry-refused-rate', (field) => field.startsWith('rate:'), 'carry-refused')}</div>
    </section>
    <section className="grain-section carry-calculator" aria-labelledby="carry-title">
      <div className="section-heading"><div><span className="eyebrow">Your numbers</span><h2 id="carry-title">Store or deliver at harvest</h2><p>Type the prices you can get. These manual prices run the math; delayed market quotes do not.</p></div><label className="commodity-picker"><span>Commodity</span><select value={selectedEstimateId} onChange={(event) => onSelectEstimate(event.target.value)}>{workspace.production_estimates.map((estimate) => <option key={estimate.id} value={estimate.id}>{workspace.fields.commodities.find((commodity) => commodity.id === estimate.commodity_id)?.name ?? estimate.commodity_id}</option>)}</select></label></div>
      <div className="carry-crop-controls"><label>Harvest month<select value={carry.harvestMonth} onChange={(event) => updateCarry((current) => ({ harvestMonth: Number(event.target.value), defaultBasis: current.defaultBasis, rows: Array.from({ length: CARRY_GRID_ROWS }, () => ({ marketPrice: '', basis: current.defaultBasis })) }))} onBlur={flushGrids}>{monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}</select></label><label>Default basis $/bu<input type="number" step="0.01" inputMode="decimal" aria-invalid={invalid('default-basis')} aria-describedby={describedBy('default-basis', 'carry-refused-grid')} value={shown('default-basis', carry.defaultBasis)} onChange={(event) => changeDefaultBasis(event.target.value)} onBlur={() => leave('default-basis', byEstimateRef.current[selectedEstimateId]?.defaultBasis ?? '', flushGrids)} /></label></div>{refusedNote('carry-refused-grid', (field) => field.startsWith('cell:') || field === 'default-basis', 'carry-refused in-calculator')}
      <div className="carry-kpis" aria-label="Cost of carry results"><article className="stat-card"><span className="stat-label">Harvest cash / bu</span><strong className="stat-value">{harvestCash === null ? '—' : money.format(harvestCash)}</strong></article><article className="stat-card"><span className="stat-label">Best stored month</span><strong className="stat-value">{bestDate ?? '—'}</strong></article><article className="stat-card"><span className="stat-label">Best net vs harvest</span><strong className={`stat-value${best && best.netVsHarvest < 0 ? ' negative' : ''}`}>{best ? signedMoney(best.netVsHarvest) : '—'}</strong></article><article className="stat-card"><span className="stat-label">Verdict</span><strong className="stat-value carry-verdict">{!decision ? 'Enter prices' : decision.kind === 'harvest' ? 'Deliver at harvest' : `Store until ${verdictDate}`}</strong></article></div>
      <div className="table-scroll carry-table-scroll"><table className="carry-table phone-stack"><thead><tr><th>Delivery month</th><th className="numeric">Market price $/bu</th><th className="numeric">Basis $/bu</th><th className="numeric">Cash price</th><th className="numeric">Months stored</th><th className="numeric">Storage</th><th className="numeric">Interest</th><th className="numeric">Trucking</th><th className="numeric">Total carry</th><th className="numeric">Net vs harvest</th></tr></thead><tbody>{calculated.map((row) => { const isHarvest = row.index === 0; const result: CarryRow | null = row.result; const label = displayMonth(selectedEstimate.crop_year, carry.harvestMonth, row.index); return <tr key={row.index} className={isHarvest ? 'harvest-row' : undefined}><th scope="row"><strong>{label}</strong>{isHarvest && <span>★ Harvest delivery</span>}</th><td className="numeric" data-label="Market price $/bu"><input aria-label={`${label} market price per bushel`} type="number" step="0.01" inputMode="decimal" placeholder="0.00" aria-invalid={invalid(`cell:${row.index}:marketPrice`)} aria-describedby={describedBy(`cell:${row.index}:marketPrice`, 'carry-refused-grid')} value={shown(`cell:${row.index}:marketPrice`, carry.rows[row.index]?.marketPrice ?? '')} onChange={(event) => updateRow(row.index, 'marketPrice', event.target.value)} onBlur={() => leave(`cell:${row.index}:marketPrice`, byEstimateRef.current[selectedEstimateId]?.rows[row.index]?.marketPrice ?? '', flushGrids)} /></td><td className="numeric" data-label="Basis $/bu"><input aria-label={`${label} basis per bushel`} type="number" step="0.01" inputMode="decimal" aria-invalid={invalid(`cell:${row.index}:basis`)} aria-describedby={describedBy(`cell:${row.index}:basis`, 'carry-refused-grid')} value={shown(`cell:${row.index}:basis`, carry.rows[row.index]?.basis ?? carry.defaultBasis)} onChange={(event) => updateRow(row.index, 'basis', event.target.value)} onBlur={() => leave(`cell:${row.index}:basis`, byEstimateRef.current[selectedEstimateId]?.rows[row.index]?.basis ?? carry.defaultBasis, flushGrids)} /></td><td className="numeric" data-label="Cash price">{row.cashPrice === null ? '—' : money.format(row.cashPrice)}</td><td className="numeric" data-label="Months stored">{row.index}</td><td className="numeric" data-label="Storage">{result ? money.format(result.storageCost) : '—'}</td><td className="numeric" data-label="Interest">{result ? money.format(result.interestCost) : '—'}</td><td className="numeric" data-label="Trucking">{result ? money.format(result.truckingCost) : '—'}</td><td className="numeric" data-label="Total carry">{result ? money.format(result.totalCarry) : '—'}</td><td className={`numeric phone-full${result && result.netVsHarvest < 0 ? ' negative' : result && result.netVsHarvest > 0 ? ' positive' : ''}`} data-label="Net vs harvest">{result ? signedMoney(result.netVsHarvest) : '—'}</td></tr> })}</tbody></table></div>
      <p className="carry-footer" aria-live="polite">{footer}</p>
    </section>
  </>
}
