import { useAuth } from 'react-oidc-context'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/stores/auth.store'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  const setIntendedPath = useAuthStore((s) => s.setIntendedPath)

  if (auth.isLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
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
    setIntendedPath(location.pathname + location.search)
    return <Navigate to="/signin" replace />
  }

  return <>{children}</>
}
