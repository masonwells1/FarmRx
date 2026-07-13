import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { bootstrapInitialOwnerFarm, findOnlyAccessibleFarm } from './auth/bootstrapFarm'
import { RequireSession } from './auth/RequireSession'
import { FieldDetailPage, FieldFormPage, FieldsPage } from './FieldsModule'
import { GrainPage } from './GrainModule'
import { ProfitabilityPage } from './ProfitabilityModule'
import { InventoryPage } from './InventoryModule'
import { EquipmentPage, TasksPage } from './EquipmentTasksModule'
import { WeatherPage } from './WeatherModule'
import { FieldLogPage } from './FieldLogModule'
import { ScoutingPage } from './ScoutingModule'
import { HarvestPage } from './HarvestModule'
import { ProgramsPage } from './ProgramsModule'
import { NotificationsPage, NotificationBell } from './NotificationsModule'
import { equipmentTasksRepository, fieldLogRepository, fieldsRepository, generateDueProgramItems, grainServices, harvestRepository, inventoryRepository, notificationsRepository, programsRepository, replayEquipmentTasksQueue, replayFieldLocationQueue, replayFieldLogQueue, replayFieldsQueue, replayGrainQueue, replayHarvestQueue, replayInventoryQueue, replayNotificationsQueue, replayProfitabilityQueue, replayProgramsQueue, replayScoutingQueue, scoutingRepository } from './data'
import { replayProgramsThenGenerateDueItems } from './data/programDueItems'
import { getSyncStatus, retrySavedChanges, subscribeSyncStatus } from './data/syncStatus'
import type { EntityType } from './data/fields'
import { farmerError } from './lib/farmerErrors'

function NavGlyph({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
}

const navigation = [
  { label: 'Fields', path: '/fields', icon: <NavGlyph d="M4 4h16v16H4zM4 12h16M12 4v16" /> },
  { label: 'Grain', path: '/grain', icon: <NavGlyph d="M3 20h18M6 20V8l6-4 6 4v12" /> },
  { label: 'Inventory', path: '/inventory', icon: <NavGlyph d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" /> },
  { label: 'Profitability', path: '/profitability', icon: <NavGlyph d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /> },
  { label: 'Equipment', path: '/equipment', icon: <NavGlyph d="M7 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10 16h4M4 13V7h9l3 5h4v4" /> },
  { label: 'Tasks', path: '/tasks', icon: <NavGlyph d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /> },
  { label: 'Weather', path: '/weather', icon: <NavGlyph d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" /> },
  { label: 'Field Log', path: '/field-log', icon: <NavGlyph d="M4 6h16M4 12h16M4 18h10" /> },
  { label: 'Scouting', path: '/scouting', icon: <NavGlyph d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" /> },
  { label: 'Harvest', path: '/harvest', icon: <NavGlyph d="M12 3v6M12 9c-3 0-5 2-5 5v7h10v-7c0-3-2-5-5-5zM9 3c0 2 1 3 3 3s3-1 3-3" /> },
  { label: 'Programs', path: '/programs', icon: <NavGlyph d="M8 4h12M8 12h12M8 20h12M4 4h.01M4 12h.01M4 20h.01" /> },
  { label: 'Alerts', path: '/notifications', icon: <NavGlyph d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /> },
]

function AppLayout() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [farmName, setFarmName] = useState<string | null>(null)
  useEffect(() => { let active = true; void findOnlyAccessibleFarm().then((farm) => { if (active) setFarmName(farm?.name ?? null) }).catch(() => { if (active) setFarmName(null) }); return () => { active = false } }, [])
  async function handleSignOut() {
    setSigningOut(true); setSignOutError(null)
    try { await signOut(); navigate('/login', { replace: true }) } catch { setSignOutError('Farm Rx could not sign you out right now. Please try again.') } finally { setSigningOut(false) }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Farm Rx navigation">
        <div className="farm-lockup">
          {farmName && <div className="farm-name">{farmName}</div>}
          <div className="farm-logo-note">Your farm</div>
        </div>
        <Navigation className="sidebar-nav" />
        <div className="powered-by">
          <div className="powered-mark">Crop <span>RX</span></div>
          <div>Powered by Crop RX</div>
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div className="product-name">Farm <span>Rx</span></div>
          {farmName && <div className="farm-summary">{farmName}</div>}
          <div className="topbar-actions"><NotificationBell repository={notificationsRepository} generateDueItems={generateDueProgramItems} /><button className="sign-out" type="button" onClick={handleSignOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div>
        </header>
        {signOutError && <p className="auth-error" role="alert">{signOutError}</p>}
        <SyncNotice />
        <div className="content-area">
          <Routes>
            <Route path="/fields" element={<FieldsPage />} />
            <Route path="/fields/new" element={<FieldFormPage />} />
            <Route path="/fields/:id" element={<FieldDetailPage />} />
            <Route path="/fields/:id/edit" element={<FieldFormPage />} />
            <Route path="/grain/*" element={<GrainPage services={grainServices} />} />
            <Route path="/inventory" element={<InventoryPage repository={inventoryRepository} />} />
            <Route path="/profitability/*" element={<ProfitabilityPage />} />
            <Route path="/equipment" element={<EquipmentPage repository={equipmentTasksRepository} />} />
            <Route path="/tasks" element={<TasksPage repository={equipmentTasksRepository} />} />
            <Route path="/weather" element={<WeatherPage />} />
            <Route path="/field-log" element={<FieldLogPage fieldLogRepository={fieldLogRepository} fieldsRepository={fieldsRepository} />} />
            <Route path="/scouting" element={<ScoutingPage scoutingRepository={scoutingRepository} fieldsRepository={fieldsRepository} />} />
            <Route path="/harvest" element={<HarvestPage harvestRepository={harvestRepository} />} />
            <Route path="/programs" element={<ProgramsPage repository={programsRepository} generateDueItems={generateDueProgramItems} />} />
            <Route path="/notifications" element={<NotificationsPage repository={notificationsRepository} generateDueItems={generateDueProgramItems} />} />
            <Route path="*" element={<Navigate to="/fields" replace />} />
          </Routes>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Farm Rx navigation">
        <Navigation className="mobile-nav-list" />
      </nav>
    </div>
  )
}

function SyncNotice() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus)
  if (status.kind === 'synced') return <div className="sync-notice synced" role="status">All changes synced.</div>
  if (status.kind === 'pending') return <div className="sync-notice pending" role="status">Saved on this device — waiting for signal. {status.pending} change{status.pending === 1 ? '' : 's'} pending.</div>
  if (status.kind === 'syncing') return <div className="sync-notice syncing" role="status">Sending saved changes…</div>
  return <div className="sync-notice blocked" role="alert"><span>{status.pending} saved change{status.pending === 1 ? '' : 's'} needs attention. Nothing was deleted.</span><button type="button" onClick={retrySavedChanges}>Try again</button></div>
}

function FarmAccessGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [state, setState] = useState<'checking' | 'ready' | 'setup' | 'blocked'>('checking')
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    const replayOnReconnect = () => { void (async () => { await replayFieldsQueue(); await replayProgramsThenGenerateDueItems(replayProgramsQueue, generateDueProgramItems); await replayHarvestQueue(); void replayGrainQueue(); void replayInventoryQueue(); void replayProfitabilityQueue(); void replayEquipmentTasksQueue(); await replayFieldLocationQueue(); await replayFieldLogQueue(); await replayScoutingQueue(); await replayNotificationsQueue() })() }
    window.addEventListener('online', replayOnReconnect)
    void findOnlyAccessibleFarm().then((farm) => {
      if (!active) return
      if (farm) { setState('ready'); replayOnReconnect() }
      else if (user?.app_metadata.initial_farm_owner === true) setState('setup')
      else { setMessage('Crop RX needs to finish your farm setup.'); setState('blocked') }
    }).catch((error: unknown) => {
      if (!active) return
      setMessage(farmerError(error, 'open your farm'))
      setState('blocked')
    })
    return () => { active = false; window.removeEventListener('online', replayOnReconnect) }
  }, [user?.app_metadata.initial_farm_owner, user?.id])
  if (state === 'checking') return <main className="login-page"><p className="opening-farm">Opening your farm…</p></main>
  if (state === 'setup' && user) return <InitialFarmSetup onComplete={() => setState('ready')} />
  if (state === 'blocked') return <main className="login-page"><section className="login-panel"><p className="opening-farm">{message}</p></section></main>
  return <>{children}</>
}

function InitialFarmSetup({ onComplete }: { onComplete: () => void }) {
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError(null)
    const form = new FormData(event.currentTarget)
    try {
      await bootstrapInitialOwnerFarm({ farmName: String(form.get('farmName') ?? ''), entityName: String(form.get('entityName') ?? ''), selectedEntityType: String(form.get('entityType') ?? 'llc') as EntityType })
      onComplete()
    } catch (caught) { setError(farmerError(caught, 'finish your setup')) } finally { setSubmitting(false) }
  }
  return <main className="login-page"><section className="login-panel" aria-labelledby="setup-title"><div className="login-brand"><h1 id="setup-title">Set up your farm</h1><p>Tell us the farm and operating name to get started.</p></div><form className="login-card" onSubmit={submit}><label htmlFor="farmName">Farm name</label><input id="farmName" name="farmName" required disabled={submitting} /><label htmlFor="entityName">Operating name</label><input id="entityName" name="entityName" required disabled={submitting} /><label htmlFor="entityType">Entity type</label><select id="entityType" name="entityType" defaultValue="llc" disabled={submitting}><option value="individual">Individual</option><option value="sole_proprietorship">Sole proprietorship</option><option value="partnership">Partnership</option><option value="llc">LLC</option><option value="corporation">Corporation</option><option value="trust">Trust</option></select>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-action" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save farm'}</button></form></section></main>
}

function Navigation({ className }: { className: string }) {
  return (
    <div className={className}>
      {navigation.map((item) => (
        <NavLink key={item.path} className="nav-link" to={item.path}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  )
}

function LoginPage() {
  const { phase, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (phase === 'restoring') return <main className="login-page"><p className="opening-farm">Opening your farm…</p></main>
  if (phase === 'signed_in') {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from?.startsWith('/') && !from.startsWith('//') ? from : '/fields'} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true); setError(null)
    const form = new FormData(event.currentTarget)
    try {
      await signIn(String(form.get('email') ?? ''), String(form.get('password') ?? ''))
      const from = (location.state as { from?: string } | null)?.from
      navigate(from?.startsWith('/') && !from.startsWith('//') ? from : '/fields', { replace: true })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message.toLowerCase() : ''
      if (/invalid login credentials|invalid.*password|invalid.*email/.test(message)) setError('That email or password did not work. Check both and try again.')
      else if (/rate limit|too many requests/.test(message)) setError('Too many tries. Wait a few minutes, then try again.')
      else if (/network|fetch|timeout|timed out|connection/.test(message)) setError('We could not reach Farm Rx. Check your signal and try again.')
      else setError('Farm Rx could not sign you in right now. Please try again.')
    } finally { setSubmitting(false) }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="rx-mark" aria-hidden="true">℞</div>
          <h1 id="login-title">Farm <span>Rx</span></h1>
          <p>Farm records made clear.</p>
        </div>
        <form className="login-card" onSubmit={handleSubmit}>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="you@farm.com" disabled={submitting} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" disabled={submitting} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          {(location.state as { expired?: boolean } | null)?.expired && !error && <p className="auth-error" role="alert">Your sign-in ended. Please sign in again.</p>}
          <button className="primary-action" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="slogan">INNOVATIVE SOLUTIONS. UNMATCHED RESULTS.</p>
        <p className="byline">by Crop RX Solutions</p>
      </section>
    </main>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<RequireSession><FarmAccessGate><AppLayout /></FarmAccessGate></RequireSession>} />
    </Routes>
  )
}
