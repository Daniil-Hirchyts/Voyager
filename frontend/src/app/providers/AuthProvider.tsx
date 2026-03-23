import { WebStorageStateStore } from 'oidc-client-ts';
import { AuthProvider as OidcAuthProvider, useAuth } from 'react-oidc-context';
import { useEffect, useMemo } from 'react';
import { config } from '@/app/config';
import { setTokenGetter, setUnauthorizedHandler } from '@/shared/api/client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { createSessionExpiryHandler, getBrowserPath } from './auth-session';
import { startKeycloakSignIn } from '@/app/auth/signin';

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
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
};

interface Props {
  children: React.ReactNode;
}

function AuthSessionManager() {
  const auth = useAuth();
  const setIntendedPath = useAuthStore((s) => s.setIntendedPath);
  const startSignin = useMemo(
    () => (intendedPath?: string | null) =>
      startKeycloakSignIn({
        auth,
        intendedPath,
        setIntendedPath,
      }),
    [auth, setIntendedPath],
  );

  const handleSessionExpired = useMemo(
    () =>
      createSessionExpiryHandler({
        getCurrentPath: () => getBrowserPath(),
        getCurrentPathname: () => window.location.pathname,
        removeUser: () => auth.removeUser(),
        startSignin,
      }),
    [auth.removeUser, startSignin],
  );

  useEffect(() => {
    setTokenGetter(() => auth.user?.access_token);
    return () => {
      setTokenGetter(() => undefined);
    };
  }, [auth.user?.access_token]);

  useEffect(() => {
    return setUnauthorizedHandler(() => handleSessionExpired());
  }, [handleSessionExpired]);

  useEffect(() => {
    const removeAccessTokenExpired = auth.events.addAccessTokenExpired(() => {
      void handleSessionExpired();
    });
    const removeSilentRenewError = auth.events.addSilentRenewError(() => {
      void handleSessionExpired();
    });

    return () => {
      removeAccessTokenExpired();
      removeSilentRenewError();
    };
  }, [auth.events, handleSessionExpired]);

  return null;
}

export function AuthProvider({ children }: Props) {
  return (
    <OidcAuthProvider
      {...oidcConfig}
      onSigninCallback={() => {
        window.history.replaceState({}, document.title, window.location.pathname);
      }}
    >
      <AuthSessionManager />
      {children}
    </OidcAuthProvider>
  );
}
