import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import { AlertCircle, Compass } from 'lucide-react';
import { useAuthStore } from '@/shared/stores/auth.store';
import { VoyagerLogo } from '@/widgets/app-shell/logo';
import { startKeycloakSignIn } from '@/app/auth/signin';

export default function AuthCallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { intendedPath, setIntendedPath } = useAuthStore();
  const handleRetry = () => {
    void startKeycloakSignIn({
      auth,
      intendedPath,
      setIntendedPath,
    });
  };

  useEffect(() => {
    if (auth.isAuthenticated) {
      const dest = intendedPath || '/app/trips';
      setIntendedPath(null);
      navigate(dest, { replace: true });
    }
  }, [auth.isAuthenticated, navigate, intendedPath, setIntendedPath]);

  if (auth.error) {
    return (
      <div className="voyager-container flex min-h-[100dvh] items-center justify-center py-10">
        <div className="w-full max-w-md">
          <section className="voyager-panel-strong relative flex flex-col items-center overflow-hidden p-8 text-center md:p-10">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />

            <div className="mt-2 mb-8 flex size-16 items-center justify-center rounded-[20px] bg-[rgba(196,95,79,0.12)] text-[var(--color-danger)]">
              <AlertCircle className="size-8" />
            </div>

            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
              Authentication failed
            </h1>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--color-text-muted)]">
              {auth.error.message}
            </p>

            <button
              type="button"
              onClick={handleRetry}
              className="mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-[16px] bg-[var(--color-text)] px-6 text-sm font-medium text-white transition-all duration-200 hover:bg-[var(--color-cta)]"
            >
              <Compass className="size-4" />
              Try again
            </button>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="voyager-container flex min-h-[100dvh] items-center justify-center py-10">
      <div className="w-full max-w-md">
        <section className="voyager-panel-strong relative flex flex-col items-center overflow-hidden p-8 text-center md:p-10">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />

          <div className="/20 mt-2 mb-8 flex size-16 items-center justify-center rounded-[20px] bg-[var(--color-cta)] text-white">
            <VoyagerLogo className="size-8" />
          </div>

          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
            Signing you in…
          </h1>
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            Completing authentication, just a moment.
          </p>

          <div className="mt-8 flex items-center justify-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-2 animate-bounce rounded-full bg-[var(--color-cta)] opacity-70"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
