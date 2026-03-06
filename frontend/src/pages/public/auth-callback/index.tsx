import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useAuthStore } from '@/shared/stores/auth.store'

export default function AuthCallbackPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { intendedPath, setIntendedPath } = useAuthStore()

  useEffect(() => {
    if (auth.isAuthenticated) {
      const dest = intendedPath || '/app/trips'
      setIntendedPath(null)
      navigate(dest, { replace: true })
    }
  }, [auth.isAuthenticated, navigate, intendedPath, setIntendedPath])

  if (auth.error) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen gap-4"
        style={{ background: 'var(--color-bg)' }}
      >
        <h1 className="text-xl font-semibold text-[#1D2430]">Authentication Failed</h1>
        <p className="text-sm text-[#526072] max-w-sm text-center">{auth.error.message}</p>
        <a href="/signin" className="text-sm text-[#2F6F73] underline">
          Try again
        </a>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen gap-3"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="w-8 h-8 border-2 border-[#2F6F73] border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-[#526072]">Completing sign in…</p>
    </div>
  )
}
