/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSWORD_EMAIL_DELIVERY_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
