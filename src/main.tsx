import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { passwordRecoveryHostname } from './auth/passwordRecovery'

if ('serviceWorker' in navigator && ![passwordRecoveryHostname, 'recovery.localhost'].includes(window.location.hostname)) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined) })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider><App /></AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
