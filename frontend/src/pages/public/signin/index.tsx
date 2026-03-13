import { useEffect, useRef } from 'react'
import { ArrowRight, Compass } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useAuthStore } from '@/shared/stores/auth.store'
import { VoyagerLogo } from '@/widgets/app-shell/logo'
import gsap from 'gsap'
import { toast } from 'sonner'

export default function SignInPage() {
  const auth = useAuth()
  const intendedPath = useAuthStore((s) => s.intendedPath)
  const containerRef = useRef<HTMLDivElement>(null)
  const loadingToastIdRef = useRef<string | number | null>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.animate-item',
        { opacity: 0, y: 30, filter: 'blur(10px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.8,
          stagger: 0.1,
          ease: 'power3.out',
          delay: 0.1,
        }
      )
      
      gsap.fromTo(
        '.animate-bg',
        { opacity: 0, scale: 0.95 },
        { opacity: 1, scale: 1, duration: 1.5, ease: 'power2.out' }
      )
    }, containerRef)

    return () => ctx.revert()
  }, [])

  useEffect(() => {
    if (auth.isLoading) {
      if (loadingToastIdRef.current == null) {
        loadingToastIdRef.current = toast.loading('Connecting to authentication…')
      }
      return
    }

    if (loadingToastIdRef.current != null) {
      toast.dismiss(loadingToastIdRef.current)
      loadingToastIdRef.current = null
    }
  }, [auth.isLoading])

  useEffect(() => {
    return () => {
      if (loadingToastIdRef.current != null) {
        toast.dismiss(loadingToastIdRef.current)
      }
    }
  }, [])

  if (auth.isAuthenticated) {
    return <Navigate to={intendedPath || '/app/trips'} replace />
  }

  const handleSignIn = () => {
    auth.signinRedirect({
      state: { intendedPath: intendedPath || '/app/trips' },
    })
  }

  return (
    <div 
      ref={containerRef}
      className="voyager-container animate-bg flex min-h-[100dvh] items-center justify-center py-10"
    >
      <div className="w-full max-w-md">
        <section className="voyager-panel-strong shadow-2xl overflow-hidden p-8 md:p-10 flex flex-col items-center text-center relative">
          
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
          
          <div className="animate-item flex size-16 items-center justify-center rounded-[20px] bg-[var(--color-cta)] text-white shadow-xl shadow-[var(--color-cta)]/20 mb-8 mt-2">
            <VoyagerLogo className="size-8" />
          </div>

          <div className="animate-item flex flex-col gap-2 items-center mb-8">
            <h1 className="voyager-heading-lg mt-2">
              Welcome to Voyager
            </h1>
            <p className="voyager-copy max-w-sm mt-3 text-[var(--color-text-muted)]">
              Sign in to continue planning and mapping your journeys.
            </p>
          </div>

          {auth.error ? (
            <div className="animate-item mt-4 w-full rounded-[20px] border border-[rgba(196,95,79,0.22)] bg-[rgba(255,240,238,0.92)] px-4 py-4 text-sm text-[var(--color-danger)]">
              Authentication error: {auth.error.message}
            </div>
          ) : null}

          <div className="animate-item w-full mt-4">
            <button
              type="button"
              onClick={handleSignIn}
              disabled={auth.isLoading}
              className="group relative flex h-14 w-full items-center justify-center gap-3 rounded-[20px] bg-[var(--color-text)] px-6 text-base font-medium text-white shadow-[0_24px_52px_-28px_rgba(26,22,21,0.75)] transition-all duration-300 hover:scale-[1.02] hover:bg-[var(--color-cta)] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60 overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <Compass className="size-5 transition-transform duration-300 group-hover:rotate-45" />
              <span>Continue with Keycloak</span>
              <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
          </div>
          
        </section>
      </div>
    </div>
  )
}
