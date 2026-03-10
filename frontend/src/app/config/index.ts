const mapFeatureFlag = import.meta.env.VITE_ENABLE_MAP_UI
const mapExperimentsFlag = import.meta.env.VITE_ENABLE_MAP_EXPERIMENTS
const map3DFlag = import.meta.env.VITE_ENABLE_MAP_3D

export const config = {
  keycloak: {
    issuer: import.meta.env.VITE_KEYCLOAK_ISSUER,
    clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
    redirectUri: import.meta.env.VITE_OIDC_REDIRECT_URI,
    silentRedirectUri: import.meta.env.VITE_OIDC_SILENT_REDIRECT_URI,
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
    offersUI: import.meta.env.VITE_ENABLE_OFFERS_UI === 'true',
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
