export const config = {
  keycloak: {
    issuer: import.meta.env.VITE_KEYCLOAK_ISSUER,
    clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
    redirectUri: import.meta.env.VITE_OIDC_REDIRECT_URI,
    silentRedirectUri: import.meta.env.VITE_OIDC_SILENT_REDIRECT_URI,
  },
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  },
  map: {
    styleUrl: import.meta.env.VITE_MAP_STYLE_URL,
  },
  features: {
    mapUI: import.meta.env.VITE_ENABLE_MAP_UI === 'true',
    landingMotion: import.meta.env.VITE_ENABLE_LANDING_MOTION === 'true',
    offersUI: import.meta.env.VITE_ENABLE_OFFERS_UI === 'true',
    eventsUI: import.meta.env.VITE_ENABLE_EVENTS_UI === 'true',
    proposalsUI: import.meta.env.VITE_ENABLE_PROPOSALS_UI === 'true',
    exportsUI: import.meta.env.VITE_ENABLE_EXPORTS_UI === 'true',
    auditUI: import.meta.env.VITE_ENABLE_AUDIT_UI === 'true',
  },
}
