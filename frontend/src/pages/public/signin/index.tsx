import { ArrowRight, Compass, ShieldCheck } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useAuthStore } from '@/shared/stores/auth.store'
import { VoyagerLogo } from '@/widgets/app-shell/logo'

export default function SignInPage() {
  const auth = useAuth()
  const intendedPath = useAuthStore((s) => s.intendedPath)

  if (auth.isAuthenticated) {
    return <Navigate to={intendedPath || '/app/trips'} replace />
  }

  const handleSignIn = () => {
    auth.signinRedirect({
      state: { intendedPath: intendedPath || '/app/trips' },
    })
  }

  return (
    <div className="voyager-container flex min-h-[100dvh] items-center py-10">
      <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,0.92fr)]">
        <section className="voyager-panel-strong voyager-noise overflow-hidden p-8 md:p-10">
          <div className="flex flex-col gap-8">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-full bg-[var(--color-cta)] text-white">
                <VoyagerLogo className="size-5" />
              </span>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Voyager
                </p>
                <p className="text-xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
                  Landing-derived workspace
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <span className="voyager-eyebrow w-fit">Secure access</span>
              <h1 className="voyager-heading-lg max-w-2xl">
                Sign in to continue planning with the same design language you started with.
              </h1>
              <p className="voyager-copy max-w-xl">
                The visual redesign now carries from the public surface into the authenticated
                product, so your first interaction and your daily planning environment feel like
                the same system.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[24px] border border-white/60 bg-white/62 p-5">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Structured planning
                </p>
                <p className="mt-3 text-base leading-7 text-[var(--color-text)]">
                  Sign in to access trip boards, maps, offers, exports, and audit history.
                </p>
              </div>
              <div className="rounded-[24px] border border-white/60 bg-white/62 p-5">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Protected identity
                </p>
                <p className="mt-3 text-base leading-7 text-[var(--color-text)]">
                  Voyager uses OpenID Connect with Keycloak and returns you to the exact route you
                  intended to open.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="voyager-panel-solid flex flex-col justify-center p-8 md:p-10">
          <span className="voyager-eyebrow w-fit">
            <ShieldCheck className="size-4" />
            Authentication
          </span>
          <h2 className="mt-5 text-4xl font-semibold tracking-[-0.05em] text-[var(--color-text)]">
            Welcome back
          </h2>
          <p className="mt-3 text-base leading-7 text-[var(--color-text-muted)]">
            Sign in to continue from where you left off.
          </p>

          {auth.isLoading ? (
            <div className="mt-6 rounded-[22px] border border-[var(--color-border-strong)] bg-white/72 px-4 py-4 text-sm text-[var(--color-text-muted)]">
              Connecting to authentication…
            </div>
          ) : null}

          {auth.error ? (
            <div className="mt-6 rounded-[22px] border border-[rgba(196,95,79,0.22)] bg-[rgba(255,240,238,0.92)] px-4 py-4 text-sm text-[var(--color-danger)]">
              Authentication error: {auth.error.message}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleSignIn}
            disabled={auth.isLoading}
            className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-[20px] bg-[var(--color-cta)] px-6 text-base font-medium text-white shadow-[0_24px_52px_-28px_rgba(26,22,21,0.75)] transition-transform duration-200 hover:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Compass className="size-4" />
            Continue with Keycloak
            <ArrowRight className="size-4" />
          </button>

          <div className="mt-8 rounded-[24px] border border-[var(--color-border-strong)] bg-white/64 p-5">
            <p className="text-sm font-semibold text-[var(--color-text)]">About sign in</p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
              Voyager authenticates through Keycloak using OpenID Connect. After sign-in you are
              redirected back to the route you originally requested.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
