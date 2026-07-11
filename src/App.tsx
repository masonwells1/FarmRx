import type { FormEvent } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

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

const fields = [
  { name: 'North Home', entity: 'Wells Farms LLC', crop: 'Corn', acres: 1240 },
  { name: 'River Bottom', entity: 'Wells Farms LLC', crop: 'Soybeans', acres: 980 },
  { name: 'West Ridge', entity: 'Wells Family Farms', crop: 'Corn', acres: 860 },
  { name: 'Cedar Creek', entity: 'Wells Family Farms', crop: 'Soybeans', acres: 740 },
  { name: 'Other fields', entity: 'Wells Land Co.', crop: 'Mixed', acres: 1000 },
]

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function AppLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Farm Rx navigation">
        <div className="farm-lockup">
          <div className="farm-name">Wells Farm Group</div>
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
          <div className="farm-summary">Wells Farm Group · <span className="numeric">4,820 ac</span></div>
        </header>
        <div className="content-area">
          <Routes>
            <Route path="/fields" element={<FieldsPage />} />
            <Route path="/grain" element={<EmptyPage />} />
            <Route path="/inventory" element={<EmptyPage />} />
            <Route path="/profitability" element={<EmptyPage />} />
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

function FieldsPage() {
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <h1>Fields</h1>
          <p>Every acre in one clear view.</p>
        </div>
        <button className="primary-action" type="button">Add a field</button>
      </div>

      <div className="stats-grid" aria-label="Farm totals">
        <StatCard label="Total acres" value="4,820" unit="ac" />
        <StatCard label="Fields" value="37" />
        <StatCard label="Entities" value="3" />
      </div>

      <section className="data-card" aria-labelledby="field-list-heading">
        <div className="card-heading" id="field-list-heading">Field list</div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Entity</th>
                <th scope="col">Crop</th>
                <th className="align-right" scope="col">Acres</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.name}>
                  <td className="field-name">{field.name}</td>
                  <td>{field.entity}</td>
                  <td>{field.crop}</td>
                  <td className="align-right numeric">{formatNumber(field.acres)} ac</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-total">
          <span>Total acres</span>
          <span className="numeric">4,820 ac</span>
        </div>
      </section>
    </section>
  )
}

function StatCard({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value numeric">{value}{unit && <span className="stat-unit"> {unit}</span>}</div>
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
  const navigate = useNavigate()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // TODO: Replace mock submission with Supabase Auth.
    navigate('/fields')
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
          <input id="email" name="email" type="email" autoComplete="email" placeholder="you@farm.com" />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" />
          <button className="primary-action" type="submit">Sign in</button>
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
      <Route path="/*" element={<AppLayout />} />
    </Routes>
  )
}
