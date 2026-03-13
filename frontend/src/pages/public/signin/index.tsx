import { useEffect, useRef } from 'react'
import { Compass } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useAuthStore } from '@/shared/stores/auth.store'
import { VoyagerLogo } from '@/widgets/app-shell/logo'
import { startKeycloakSignIn } from '@/app/auth/signin'

export default function SignInPage() {
  const auth = useAuth()
  const intendedPath = useAuthStore((s) => s.intendedPath)
  const setIntendedPath = useAuthStore((s) => s.setIntendedPath)
  const redirectStartedRef = useRef(false)

  useEffect(() => {
    if (auth.isLoading || auth.isAuthenticated || auth.error || redirectStartedRef.current) {
      return
    }

    redirectStartedRef.current = true
    void startKeycloakSignIn({
      auth,
      intendedPath,
      setIntendedPath,
    }).catch(() => {
      redirectStartedRef.current = false
    })
  }, [auth, auth.error, auth.isAuthenticated, auth.isLoading, intendedPath, setIntendedPath])

  if (auth.isAuthenticated) {
    return <Navigate to={intendedPath || '/app/trips'} replace />
  }

  const handleRetry = () => {
    void startKeycloakSignIn({
      auth,
      intendedPath,
      setIntendedPath,
    })
  }

  return (
    <div className="voyager-container flex min-h-[100dvh] items-center justify-center py-10">
      <div className="w-full max-w-md">
        <section className="voyager-panel-strong overflow-hidden p-8 md:p-10 flex flex-col items-center text-center relative">
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />

          <div className="flex size-16 items-center justify-center rounded-[20px] bg-[var(--color-cta)] text-white shadow-xl shadow-[var(--color-cta)]/20 mb-8 mt-2">
            <VoyagerLogo className="size-8" />
          </div>

          <div className="flex flex-col gap-2 items-center mb-8">
            <h1 className="voyager-heading-lg mt-2">
              Redirecting to Keycloak
            </h1>
            <p className="voyager-copy max-w-sm mt-3 text-[var(--color-text-muted)]">
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
                  className="size-2 rounded-full bg-[var(--color-cta)] opacity-70 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          )}

          {auth.error ? (
            <div className="w-full mt-4">
              <button
                type="button"
                onClick={handleRetry}
                className="group relative flex h-14 w-full items-center justify-center gap-3 rounded-[20px] bg-[var(--color-text)] px-6 text-base font-medium text-white shadow-[0_24px_52px_-28px_rgba(26,22,21,0.75)] transition-all duration-300 hover:bg-[var(--color-cta)] disabled:cursor-not-allowed disabled:opacity-60 overflow-hidden"
              >
                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <Compass className="size-5" />
                <span>Try again</span>
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
