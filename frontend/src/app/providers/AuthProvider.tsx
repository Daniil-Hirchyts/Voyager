import { AuthProvider as OidcAuthProvider, useAuth } from 'react-oidc-context'
import { useEffect } from 'react'
import { config } from '@/app/config'
import { setTokenGetter } from '@/shared/api/client'

const oidcConfig = {
  authority: config.keycloak.issuer,
  client_id: config.keycloak.clientId,
  redirect_uri: config.keycloak.redirectUri,
  silent_redirect_uri: config.keycloak.silentRedirectUri,
  post_logout_redirect_uri: window.location.origin,
  scope: 'openid profile email',
  automaticSilentRenew: true,
  filterProtocolClaims: true,
  loadUserInfo: true,
}

interface Props {
  children: React.ReactNode
}

function AuthTokenInjector() {
  const auth = useAuth()

  useEffect(() => {
    setTokenGetter(() => auth.user?.access_token)
  }, [auth.user?.access_token])

  return null
}

export function AuthProvider({ children }: Props) {
  return (
    <OidcAuthProvider
      {...oidcConfig}
      onSigninCallback={() => {
        window.history.replaceState({}, document.title, window.location.pathname)
      }}
    >
      <AuthTokenInjector />
      {children}
    </OidcAuthProvider>
  )
}
