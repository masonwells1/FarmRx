import { useEffect, useRef, useState } from 'react'
import { confirmDialog } from './components/ConfirmDialog'
import { useFarmAccess } from './auth/FarmAccessContext'
import type { FarmSharingRepository } from './data/farmSharing'
import { MARKET_REGIONS, marketRegionName, type FarmSettingsRepository } from './data/farmSettings'
import { createSubmitLock } from './lib/submitLock'
import { farmerError } from './lib/farmerErrors'

export function FarmPrivacyPage({ repository, settingsRepository }: { repository: FarmSharingRepository; settingsRepository: FarmSettingsRepository }) {
  const { activeFarm, profile, source, checkSignal } = useFarmAccess()
  const [confirmedFarm, setConfirmedFarm] = useState(activeFarm)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null)
  const saveLock = useRef(createSubmitLock())
  // GL-1: the market region card. Its draft follows the confirmed farm; saving mirrors the privacy toggle.
  const [regionDraft, setRegionDraft] = useState<string>(activeFarm.market_region ?? '')
  const [regionSaving, setRegionSaving] = useState(false)
  const [regionMessage, setRegionMessage] = useState<string | null>(null)
  const [regionError, setRegionError] = useState<string | null>(null)
  const regionLock = useRef(createSubmitLock())
  const refreshLock = useRef(createSubmitLock())
  const canManage = profile.capabilities.canManageFarm
  const offline = source === 'offline' || typeof navigator !== 'undefined' && navigator.onLine === false

  useEffect(() => {
    setConfirmedFarm(activeFarm)
    setMessage(null)
    setError(null)
    setRefreshWarning(null)
    setRegionDraft(activeFarm.market_region ?? '')
  }, [activeFarm])
  useEffect(() => {
    setRegionMessage(null)
    setRegionError(null)
  }, [activeFarm.id])

  async function refreshCurrentSetting() {
    if (!refreshLock.current.acquire()) return
    setChecking(true)
    setError(null)
    setRefreshWarning(null)
    try {
      await checkSignal()
    } catch (caught) {
      setError(farmerError(caught, 'check the current privacy setting'))
    } finally {
      setChecking(false)
      refreshLock.current.release()
    }
  }

  async function changeSharing(next: boolean) {
    if (!canManage || saving || !saveLock.current.acquire()) return
    if (next && !(await confirmDialog({ title: 'Turn sharing on?', body: "Your assigned Crop RX rep will be able to see this farm's grain, financial, and Soil Rx data. You can turn it off any time.", confirmLabel: 'Turn sharing on', cancelLabel: 'Keep it private' }))) {
      saveLock.current.release()
      return
    }
    setSaving(true)
    setMessage(null)
    setError(null)
    setRefreshWarning(null)
    let savedOnServer = false
    try {
      const saved = await repository.updateShareWithRep({
        farmId: confirmedFarm.id,
        shareWithRep: next,
        expectedUpdatedAt: confirmedFarm.updated_at,
      })
      savedOnServer = true
      setConfirmedFarm(saved)
      setMessage(next ? 'Sharing is on. Your assigned Crop RX rep can now see this farm\'s grain, financial, and Soil Rx data.' : 'Sharing is off. Your Crop RX rep can no longer see this farm\'s grain, financial, or Soil Rx data.')
    } catch (caught) {
      setError(farmerError(caught, 'change this privacy setting'))
    }
    if (savedOnServer) {
      try {
        await checkSignal()
      } catch {
        setRefreshWarning('The privacy change was saved, but Farm Rx could not refresh this screen. Check the current setting when your connection is steady.')
      }
    }
    setSaving(false)
    saveLock.current.release()
  }

  async function saveMarketRegion() {
    if (!canManage || regionSaving || !regionLock.current.acquire()) return
    setRegionSaving(true)
    setRegionMessage(null)
    setRegionError(null)
    const next = regionDraft === '' ? null : regionDraft
    let savedOnServer = false
    try {
      const saved = await settingsRepository.updateMarketRegion({ farmId: confirmedFarm.id, marketRegion: next, expectedUpdatedAt: confirmedFarm.updated_at })
      savedOnServer = true
      setConfirmedFarm(saved)
      setRegionDraft(saved.market_region ?? '')
      setRegionMessage(next === null ? 'Market region cleared. This farm receives no USDA cash bids.' : `Market region saved: ${marketRegionName(next) ?? next}. USDA cash bids for ${marketRegionName(next) ?? next} will appear in Grain once a verified report covers it.`)
    } catch (caught) {
      setRegionError(farmerError(caught, 'change the market region'))
    }
    if (savedOnServer) {
      try { await checkSignal() } catch { setRefreshWarning('The market region was saved, but Farm Rx could not refresh this screen. Check the current setting when your connection is steady.') }
    }
    setRegionSaving(false)
    regionLock.current.release()
  }

  const isShared = confirmedFarm.share_with_rep
  const currentRegion = confirmedFarm.market_region ?? null
  const regionDirty = (regionDraft === '' ? null : regionDraft) !== currentRegion
  return (
    <section className="page farm-privacy-page" aria-labelledby="farm-privacy-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">{confirmedFarm.name}</p>
          <h1 id="farm-privacy-title">Farm settings</h1>
          <p>Grain, financial, and Soil Rx information stays private unless you choose to share it. This page also sets which state's USDA cash bids the farm receives.</p>
        </div>
      </header>

      <article className={`privacy-card ${isShared ? 'is-shared' : 'is-private'}`}>
        <div className="privacy-status-row">
          <div>
            <p className="privacy-kicker">Crop RX rep access</p>
            <h2>{isShared ? 'Shared with your assigned rep' : 'Private'}</h2>
          </div>
          <span className="privacy-status" aria-live="polite">{isShared ? 'ON' : 'OFF'}</span>
        </div>
        <p className="privacy-explanation">
          {isShared
            ? 'Your assigned Crop RX rep can see this farm\'s grain, financial, and Soil Rx data.'
            : 'Your Crop RX rep cannot see this farm\'s grain, financial, or Soil Rx data.'}
        </p>

        {canManage ? (
          <div className="privacy-control">
            <span id="rep-sharing-label">Share my grain, financial, and Soil Rx data with my Crop RX rep</span>
            <button
              className="privacy-switch"
              type="button"
              role="switch"
              aria-labelledby="rep-sharing-label"
              aria-checked={isShared}
              disabled={saving || offline}
              onClick={() => { void changeSharing(!isShared) }}
            >
              <span aria-hidden="true" />
              {saving ? 'Saving…' : isShared ? 'ON' : 'OFF'}
            </button>
          </div>
        ) : (
          <p className="privacy-read-only">Only a farm owner or manager can change this setting.</p>
        )}

        {offline && canManage && <p className="privacy-offline">Connect to the internet to change this setting. Privacy changes are never queued offline.</p>}
        {message && <p className="save-success" role="status">{message}</p>}
        {refreshWarning && <p className="privacy-warning" role="alert">{refreshWarning}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {(error || refreshWarning) && <button className="secondary-action" type="button" disabled={checking} onClick={() => { void refreshCurrentSetting() }}>{checking ? 'Checking…' : 'Check current setting'}</button>}
      </article>

      <article className="privacy-card market-region-card" aria-labelledby="market-region-title">
        <div className="privacy-status-row">
          <div>
            <p className="privacy-kicker">USDA cash bids</p>
            <h2 id="market-region-title">Market region</h2>
          </div>
          <span className="privacy-status" aria-live="polite">{currentRegion ?? 'NOT SET'}</span>
        </div>
        <p className="privacy-explanation">
          {currentRegion
            ? `This farm receives USDA cash-grain bids for ${marketRegionName(currentRegion) ?? currentRegion}, from verified USDA reports only. They are shown as history in Grain and never change your contracts, plan, or bins.`
            : 'Pick the state whose USDA cash-grain bids this farm should receive. Nothing is guessed from your fields; with no state set, no feed bids are written.'}
        </p>
        {canManage ? (
          <div className="privacy-control market-region-control">
            <label htmlFor="market-region-select">State for USDA cash bids</label>
            <div className="market-region-actions">
              <select id="market-region-select" value={regionDraft} disabled={regionSaving || offline} onChange={(event) => { setRegionDraft(event.target.value); setRegionMessage(null); setRegionError(null) }}>
                <option value="">Not set</option>
                {MARKET_REGIONS.map((region) => <option key={region.code} value={region.code}>{region.name} ({region.code})</option>)}
              </select>
              <button className="primary-action" type="button" disabled={regionSaving || offline || !regionDirty} onClick={() => { void saveMarketRegion() }}>{regionSaving ? 'Saving…' : 'Save region'}</button>
            </div>
          </div>
        ) : (
          <p className="privacy-read-only">Only a farm owner or manager can change this setting.</p>
        )}
        {offline && canManage && <p className="privacy-offline">Connect to the internet to change this setting. It is never queued offline.</p>}
        {regionMessage && <p className="save-success" role="status">{regionMessage}</p>}
        {regionError && <p className="auth-error" role="alert">{regionError}</p>}
      </article>
    </section>
  )
}
