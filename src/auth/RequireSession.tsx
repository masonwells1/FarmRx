import { useRef, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth, wasIntentionalSignOut } from './AuthProvider'

export function RequireSession({ children }: { children: ReactNode }) {
  const { phase } = useAuth()
  const location = useLocation()
  const wasSignedIn = useRef(false)
  if (phase === 'restoring') return <main className="login-page"><p className="opening-farm">Opening your farm…</p></main>
  if (phase === 'signed_in') {
    wasSignedIn.current = true
    return <>{children}</>
  }
  const safePath = location.pathname.startsWith('/') && !location.pathname.startsWith('//') ? `${location.pathname}${location.search}${location.hash}` : '/fields'
  return <Navigate to="/login" replace state={{ from: safePath, expired: wasSignedIn.current && !wasIntentionalSignOut() }} />
}
