import { useAuth } from 'react-oidc-context'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/stores/auth.store'
import { useDelayedLoading } from '@/shared/hooks/useDelayedLoading'
import { startKeycloakSignIn } from './signin'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  const setIntendedPath = useAuthStore((s) => s.setIntendedPath)
  const redirectStartedRef = useRef(false)

  const showLoading = useDelayedLoading(auth.isLoading, 250)

  useEffect(() => {
    if (auth.isLoading || auth.isAuthenticated || redirectStartedRef.current) {
      return
    }

    const intendedPath = `${location.pathname}${location.search}${location.hash}`
    redirectStartedRef.current = true

    void startKeycloakSignIn({
      auth,
      intendedPath,
      setIntendedPath,
    }).catch(() => {
      redirectStartedRef.current = false
    })
  }, [
    auth,
    auth.isAuthenticated,
    auth.isLoading,
    location.hash,
    location.pathname,
    location.search,
    setIntendedPath,
  ])

  if (auth.isLoading) {
    if (!showLoading) return null
    return (
      <div
        className="flex items-center justify-center min-h-screen animate-in fade-in duration-300"
        style={{ background: 'var(--color-bg)' }}
      >
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#2F6F73] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#526072]">Loading...</p>
        </div>
      </div>
    )
  }

  if (!auth.isAuthenticated) {
    return (
      <div
        className="flex items-center justify-center min-h-screen animate-in fade-in duration-300"
        style={{ background: 'var(--color-bg)' }}
      >
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#2F6F73] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#526072]">Redirecting to sign in...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
