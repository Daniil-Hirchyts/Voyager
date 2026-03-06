import { useAuth } from 'react-oidc-context'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/shared/stores/auth.store'
import { ArrowRight, Compass } from 'lucide-react'

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
    <div className="min-h-screen flex" style={{ background: 'var(--color-bg)' }}>
      {/* Left panel - branding */}
      <div
        className="hidden lg:flex flex-col justify-between w-1/2 p-16 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1D2430 0%, #2F6F73 100%)' }}
      >
        {/* Background texture */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 40px, #FFFFFF 40px, #FFFFFF 41px)`,
          }}
        />

        <div className="relative z-10">
          <span className="font-display text-3xl text-white">Voyager</span>
        </div>

        <div className="relative z-10">
          <p className="text-xs tracking-[0.3em] uppercase text-[#6EA4A6] mb-6 font-medium">
            Travel Planning
          </p>
          <h2 className="font-display text-5xl text-white leading-tight mb-6">
            Plan journeys
            <br />
            worth telling
          </h2>
          <p className="text-[#6EA4A6] leading-relaxed max-w-sm">
            AI-powered itineraries built around your preferences, then shaped by you. Every
            activity is real data you can edit, reorder, and map.
          </p>
        </div>

        <p className="text-[#526072] text-sm relative z-10">Voyager Travel Planning</p>
      </div>

      {/* Right panel - sign in */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <span className="font-display text-3xl text-[#2F6F73]">Voyager</span>
          </div>

          <h1 className="text-2xl font-semibold text-[#1D2430] mb-2">Welcome back</h1>
          <p className="text-[#526072] text-sm mb-8">
            Sign in to access your trips and planner
          </p>

          {auth.isLoading && (
            <div className="flex items-center gap-2 text-sm text-[#526072] mb-4 p-3 rounded-[10px] border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="w-4 h-4 border-2 border-[#2F6F73] border-t-transparent rounded-full animate-spin shrink-0" />
              Connecting to authentication…
            </div>
          )}

          {auth.error && (
            <div
              className="mb-4 p-3 rounded-[10px] border text-sm text-[#C56A3D]"
              style={{
                background: 'rgba(197, 106, 61, 0.08)',
                borderColor: 'rgba(197, 106, 61, 0.2)',
              }}
            >
              Authentication error: {auth.error.message}
            </div>
          )}

          <button
            onClick={handleSignIn}
            disabled={auth.isLoading}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 bg-[#2F6F73] text-white font-medium rounded-[10px] hover:bg-[#266063] transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-[#2F6F73]/20"
          >
            <Compass className="w-4 h-4" />
            Continue with Keycloak
            <ArrowRight className="w-4 h-4" />
          </button>

          <div
            className="mt-6 p-4 rounded-[10px] border text-xs text-[#526072] space-y-1"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <p className="font-medium text-[#1D2430]">About sign in</p>
            <p>
              Voyager uses OpenID Connect via Keycloak for secure authentication. You'll be
              redirected to sign in and then returned to your destination.
            </p>
          </div>

          <p className="mt-6 text-center text-xs text-[#526072]">
            Protected with OpenID Connect via Keycloak
          </p>
        </div>
      </div>
    </div>
  )
}
