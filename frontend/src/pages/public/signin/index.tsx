import { useEffect, useRef } from 'react';
import { Compass } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import { useAuthStore } from '@/shared/stores/auth.store';
import { VoyagerLogo } from '@/widgets/app-shell/logo';
import { startKeycloakSignIn } from '@/app/auth/signin';

export default function SignInPage() {
  const auth = useAuth();
  const intendedPath = useAuthStore((s) => s.intendedPath);
  const setIntendedPath = useAuthStore((s) => s.setIntendedPath);
  const redirectStartedRef = useRef(false);

  useEffect(() => {
    if (auth.isLoading || auth.isAuthenticated || auth.error || redirectStartedRef.current) {
      return;
    }

    redirectStartedRef.current = true;
    void startKeycloakSignIn({
      auth,
      intendedPath,
      setIntendedPath,
    }).catch(() => {
      redirectStartedRef.current = false;
    });
  }, [auth, auth.error, auth.isAuthenticated, auth.isLoading, intendedPath, setIntendedPath]);

  if (auth.isAuthenticated) {
    return <Navigate to={intendedPath || '/app/trips'} replace />;
  }

  const handleRetry = () => {
    void startKeycloakSignIn({
      auth,
      intendedPath,
      setIntendedPath,
    });
  };

  return (
    <div className="voyager-container flex min-h-[100dvh] items-center justify-center py-10">
      <div className="w-full max-w-md">
        <section className="voyager-panel-strong relative flex flex-col items-center overflow-hidden p-8 text-center md:p-10">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />

          <div className="/20 mt-2 mb-8 flex size-16 items-center justify-center rounded-[20px] bg-[var(--color-cta)] text-white">
            <VoyagerLogo className="size-8" />
          </div>

          <div className="mb-8 flex flex-col items-center gap-2">
            <h1 className="voyager-heading-lg mt-2">Redirecting to Keycloak</h1>
            <p className="voyager-copy mt-3 max-w-sm text-[var(--color-text-muted)]">
              Opening the hosted sign-in flow for Voyager.
            </p>
          </div>

          {auth.error ? (
            <div className="mt-4 w-full rounded-[20px] border border-[rgba(196,95,79,0.22)] bg-[rgba(255,240,238,0.92)] px-4 py-4 text-sm text-[var(--color-danger)]">
              Authentication error: {auth.error.message}
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-2 animate-bounce rounded-full bg-[var(--color-cta)] opacity-70"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          )}

          {auth.error ? (
            <div className="mt-4 w-full">
              <button
                type="button"
                onClick={handleRetry}
                className="group relative flex h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-[20px] bg-[var(--color-text)] px-6 text-base font-medium text-white transition-all duration-300 hover:bg-[var(--color-cta)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="absolute inset-0 bg-white/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <Compass className="size-5" />
                <span>Try again</span>
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
