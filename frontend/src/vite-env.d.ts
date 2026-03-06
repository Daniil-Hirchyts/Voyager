/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KEYCLOAK_ISSUER: string
  readonly VITE_KEYCLOAK_CLIENT_ID: string
  readonly VITE_OIDC_REDIRECT_URI: string
  readonly VITE_OIDC_SILENT_REDIRECT_URI: string
  readonly VITE_API_BASE_URL: string
  readonly VITE_MAP_STYLE_URL: string
  readonly VITE_ENABLE_MAP_UI: string
  readonly VITE_ENABLE_LANDING_MOTION: string
  readonly VITE_ENABLE_OFFERS_UI: string
  readonly VITE_ENABLE_EVENTS_UI: string
  readonly VITE_ENABLE_PROPOSALS_UI: string
  readonly VITE_ENABLE_EXPORTS_UI: string
  readonly VITE_ENABLE_AUDIT_UI: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css'
