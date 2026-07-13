import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

export type AuthPhase = 'restoring' | 'signed_out' | 'signed_in'

interface AuthContextValue {
  phase: AuthPhase
  session: Session | null
  user: User | null
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// A deliberate "Sign out" and an expired session both land on /login; this flag
// lets RequireSession tell them apart so we never scold a farmer who just left.
// Read-only during render (React may render twice); cleared on the next sign-in.
let intentionalSignOut = false
export function markIntentionalSignOut() { intentionalSignOut = true }
export function clearIntentionalSignOut() { intentionalSignOut = false }
export function wasIntentionalSignOut() { return intentionalSignOut }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>('restoring')
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    let active = true
    let eventVersion = 0
    const applySession = (next: Session | null) => {
      if (!active) return
      setSession(next)
      setPhase(next ? 'signed_in' : 'signed_out')
    }
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') { eventVersion += 1; applySession(nextSession) }
    })
    const restoreVersion = eventVersion
    void supabase.auth.getSession().then(({ data, error }) => {
      if (eventVersion !== restoreVersion) return
      if (error) applySession(null); else applySession(data.session)
    }).catch(() => { if (eventVersion === restoreVersion) applySession(null) })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    phase,
    session,
    user: session?.user ?? null,
    async signIn(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error || !data.session) throw error ?? new Error('Farm Rx could not sign you in right now. Please try again.')
      clearIntentionalSignOut()
      setSession(data.session)
      setPhase('signed_in')
    },
    async signOut() {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
      markIntentionalSignOut()
      setSession(null)
      setPhase('signed_out')
    },
  }), [phase, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
