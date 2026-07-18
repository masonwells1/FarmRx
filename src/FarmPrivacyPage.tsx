import { useEffect, useRef, useState } from 'react'
import { useFarmAccess } from './auth/FarmAccessContext'
import type { FarmSharingRepository } from './data/farmSharing'
import { createSubmitLock } from './lib/submitLock'
import { farmerError } from './lib/farmerErrors'

export function FarmPrivacyPage({ repository }: { repository: FarmSharingRepository }) {
  const { activeFarm, profile, source, checkSignal } = useFarmAccess()
  const [confirmedFarm, setConfirmedFarm] = useState(activeFarm)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null)
  const saveLock = useRef(createSubmitLock())
  const refreshLock = useRef(createSubmitLock())
  const canManage = profile.capabilities.canManageFarm
  const offline = source === 'offline' || typeof navigator !== 'undefined' && navigator.onLine === false

  useEffect(() => {
    setConfirmedFarm(activeFarm)
    setMessage(null)
    setError(null)
    setRefreshWarning(null)
  }, [activeFarm])

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
    if (next && !window.confirm('Turn sharing on? Your assigned Crop RX rep will be able to see this farm\'s grain position and private financial information.')) {
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
      setMessage(next ? 'Sharing is on. Your assigned Crop RX rep can now see this farm\'s private grain information.' : 'Sharing is off. Your Crop RX rep can no longer see this farm\'s private grain information.')
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

  const isShared = confirmedFarm.share_with_rep
  return (
    <section className="page farm-privacy-page" aria-labelledby="farm-privacy-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">{confirmedFarm.name}</p>
          <h1 id="farm-privacy-title">Farm privacy</h1>
          <p>Grain and financial information stays private unless you choose to share it.</p>
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
            ? 'Your assigned Crop RX rep can see this farm\'s grain position and private financial information.'
            : 'Your Crop RX rep cannot see this farm\'s grain position or private financial information.'}
        </p>

        {canManage ? (
          <div className="privacy-control">
            <span id="rep-sharing-label">Share my grain position with my Crop RX rep</span>
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
    </section>
  )
}
