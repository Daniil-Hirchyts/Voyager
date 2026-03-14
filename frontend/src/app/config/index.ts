const mapFeatureFlag = import.meta.env.VITE_ENABLE_MAP_UI
const mapExperimentsFlag = import.meta.env.VITE_ENABLE_MAP_EXPERIMENTS
const map3DFlag = import.meta.env.VITE_ENABLE_MAP_3D
const browserOrigin =
  typeof window === 'undefined' ? 'http://localhost:5173' : window.location.origin

function resolveOidcUri(value: string | undefined, fallbackPath: string) {
  if (!value) {
    return `${browserOrigin}${fallbackPath}`
  }

  try {
    const url = new URL(value, browserOrigin)
    return `${browserOrigin}${url.pathname}${url.search}${url.hash}`
  } catch {
    return `${browserOrigin}${fallbackPath}`
  }
}

export const config = {
  keycloak: {
    issuer: import.meta.env.VITE_KEYCLOAK_ISSUER,
    clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
    redirectUri: resolveOidcUri(import.meta.env.VITE_OIDC_REDIRECT_URI, '/auth/callback'),
    silentRedirectUri: resolveOidcUri(import.meta.env.VITE_OIDC_SILENT_REDIRECT_URI, '/auth/silent'),
  },
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
  },
  map: {
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
    language: import.meta.env.VITE_GOOGLE_MAPS_LANGUAGE,
    region: import.meta.env.VITE_GOOGLE_MAPS_REGION,
  },
  features: {
    mapUI:
      mapFeatureFlag === 'false'
        ? false
        : mapFeatureFlag === 'true' || Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY),
    landingMotion: import.meta.env.VITE_ENABLE_LANDING_MOTION === 'true',
    activitiesUI: import.meta.env.VITE_ENABLE_ACTIVITIES_UI !== 'false',
    exportsUI: import.meta.env.VITE_ENABLE_EXPORTS_UI === 'true',
    mapExperiments:
      mapExperimentsFlag === 'true' ||
      (mapExperimentsFlag !== 'false' && Boolean(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID)),
    map3D:
      map3DFlag === 'false'
        ? false
        : map3DFlag === 'true' || Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY),
  },
}
