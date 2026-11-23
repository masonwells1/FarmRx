import { useState } from 'react'
import { Navigate } from 'react-router'
import { useFarmAccess, type FarmAccessContextValue } from './auth/FarmAccessContext'

export function isGradeRxPilot(access: FarmAccessContextValue | null): boolean {
  const pilot = import.meta.env?.VITE_GRADE_RX_PILOT_USER_ID
  return Boolean(pilot && access && access.profile.userId === pilot &&
    access.profile.farmId === access.activeFarm.id && access.profile.capabilities.canManageFarm)
}

const workspacePath = '/grade-rx-app/index.html'

function GradeRxWorkspace({ scope }: { scope: string }) {
  const [unavailable, setUnavailable] = useState(false)
  if (unavailable) return <div role="alert"><p>Grade Rx could not load. Reload Farm Rx and try again.</p><button className="secondary-action" type="button" onClick={() => window.location.reload()}>Reload Farm Rx</button></div>

  return <iframe
    className="grade-rx-workspace"
    title="Grade Rx drainage workspace"
    src={workspacePath}
    data-grade-scope={scope}
    onLoad={(event) => {
      const document = event.currentTarget.contentDocument
      if (document?.URL === 'about:blank') return
      if (document?.title !== 'GradeRx · Crop RX Solutions') setUnavailable(true)
    }}
  />
}

export function GradeRxPage() {
  const access = useFarmAccess()
  if (!isGradeRxPilot(access)) return <Navigate to="/fields" replace />

  const scope = `${access.profile.userId}:${access.activeFarm.id}`
  return <section className="page" aria-labelledby="grade-rx-title">
    <div className="page-heading">
      <div>
        <h1 id="grade-rx-title">Grade Rx</h1>
        <p>Plans for {access.activeFarm.name} stay in this browser. Save a copy to keep a backup.</p>
      </div>
    </div>
    {access.source === 'live' ? <GradeRxWorkspace key={scope} scope={scope} /> : <p role="status">Connect to the internet and check your farm access to open Grade Rx.</p>}
  </section>
}
