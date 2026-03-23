import { useAuth } from 'react-oidc-context';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/shared/stores/auth.store';
import { useDelayedLoading } from '@/shared/hooks/useDelayedLoading';
import { VoyagerLoader } from '@/widgets/app-shell/logo';
import { startKeycloakSignIn } from './signin';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const setIntendedPath = useAuthStore((s) => s.setIntendedPath);
  const redirectStartedRef = useRef(false);

  const showLoading = useDelayedLoading(auth.isLoading, 250);

  useEffect(() => {
    if (auth.isLoading || auth.isAuthenticated || redirectStartedRef.current) {
      return;
    }

    const intendedPath = `${location.pathname}${location.search}${location.hash}`;
    redirectStartedRef.current = true;

    void startKeycloakSignIn({
      auth,
      intendedPath,
      setIntendedPath,
    }).catch(() => {
      redirectStartedRef.current = false;
    });
  }, [
    auth,
    auth.isAuthenticated,
    auth.isLoading,
    location.hash,
    location.pathname,
    location.search,
    setIntendedPath,
  ]);

  if (auth.isLoading) {
    if (!showLoading) return null;
    return (
      <div
        className="animate-in fade-in flex min-h-screen items-center justify-center duration-300"
        style={{ background: 'var(--color-bg)' }}
      >
        <div className="text-center">
          <VoyagerLoader className="mx-auto mb-4 size-10 text-[#2F6F73]" />
          <p className="text-sm text-[#526072]">Loading...</p>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <div
        className="animate-in fade-in flex min-h-screen items-center justify-center duration-300"
        style={{ background: 'var(--color-bg)' }}
      >
        <div className="text-center">
          <VoyagerLoader className="mx-auto mb-4 size-10 text-[#2F6F73]" />
          <p className="text-sm text-[#526072]">Redirecting to sign in...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
