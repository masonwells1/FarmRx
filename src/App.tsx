import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { bootstrapInitialOwnerFarm, findOnlyAccessibleFarm } from './auth/bootstrapFarm'
import { RequireSession } from './auth/RequireSession'
import { FieldDetailPage, FieldFormPage, FieldsPage } from './FieldsModule'
import { GrainPage } from './GrainModule'
import { ProfitabilityPage } from './ProfitabilityModule'
import { InventoryPage } from './InventoryModule'
import { grainServices, inventoryRepository, replayFieldsQueue } from './data'
import { getSyncStatus, retrySavedChanges, subscribeSyncStatus } from './data/syncStatus'
import type { EntityType } from './data/fields'
import { farmerError } from './lib/farmerErrors'

const navigation = [
  { label: 'Fields', path: '/fields', icon: '▦' },
  { label: 'Grain', path: '/grain', icon: '◒' },
  { label: 'Inventory', path: '/inventory', icon: '□' },
  { label: 'Profitability', path: '/profitability', icon: '$' },
  { label: 'Equipment', path: '/equipment', icon: '◇' },
  { label: 'Tasks', path: '/tasks', icon: '✓' },
]

const emptyStates: Record<string, { title: string; message: string; action: string }> = {
  '/grain': {
    title: 'Grain',
    message: 'Your grain position will be ready when you are.',
    action: 'Add a contract',
  },
  '/inventory': {
    title: 'Inventory',
    message: 'Keep the whole shed in one simple, trusted record.',
    action: 'Add a product',
  },
  '/profitability': {
    title: 'Profitability',
    message: 'Start with a field and see the numbers that matter.',
    action: 'Set up a scenario',
  },
  '/equipment': {
    title: 'Equipment',
    message: 'A clear place to keep every machine ready to work.',
    action: 'Add equipment',
  },
  '/tasks': {
    title: 'Tasks',
    message: 'Keep the next job clear for everyone on the farm.',
    action: 'Create a task',
  },
}

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
          <button className="sign-out" type="button" onClick={handleSignOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
        </header>
        {signOutError && <p className="auth-error" role="alert">{signOutError}</p>}
        <SyncNotice />
        <div className="content-area">
          <Routes>
            <Route path="/fields" element={<FieldsPage />} />
            <Route path="/fields/new" element={<FieldFormPage />} />
            <Route path="/fields/:id" element={<FieldDetailPage />} />
            <Route path="/fields/:id/edit" element={<FieldFormPage />} />
            <Route path="/grain" element={<GrainPage services={grainServices} />} />
            <Route path="/inventory" element={<InventoryPage repository={inventoryRepository} />} />
            <Route path="/profitability" element={<ProfitabilityPage />} />
            <Route path="/equipment" element={<EmptyPage />} />
            <Route path="/tasks" element={<EmptyPage />} />
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
    void findOnlyAccessibleFarm().then((farm) => {
      if (!active) return
      if (farm) { setState('ready'); void replayFieldsQueue() }
      else if (user?.app_metadata.initial_farm_owner === true) setState('setup')
      else { setMessage('Crop RX needs to finish your farm setup.'); setState('blocked') }
    }).catch((error: unknown) => {
      if (!active) return
      setMessage(farmerError(error, 'open your farm'))
      setState('blocked')
    })
    return () => { active = false }
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

function EmptyPage() {
  const location = useLocation()
  const state = emptyStates[location.pathname]

  return (
    <section className="page empty-page">
      <div className="empty-state">
        <h1>{state.title}</h1>
        <p>{state.message}</p>
        <button className="primary-action" type="button">{state.action}</button>
      </div>
    </section>
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
