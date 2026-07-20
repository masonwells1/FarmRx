/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSWORD_EMAIL_DELIVERY_ENABLED?: string
  readonly VITE_LOCAL_SUPABASE_PROJECT_REF?: string
  readonly VITE_LOCAL_SUPABASE_URL?: string
  readonly VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
