import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_INTENDED_PATH, resolveIntendedPath, startKeycloakSignIn } from './signin'

describe('signin helpers', () => {
  it('falls back to the default app destination', () => {
    expect(resolveIntendedPath(null)).toBe(DEFAULT_INTENDED_PATH)
    expect(resolveIntendedPath('')).toBe(DEFAULT_INTENDED_PATH)
  })

  it('stores and forwards the intended path to the OIDC redirect', async () => {
    const signinRedirect = vi.fn(async () => {})
    const setIntendedPath = vi.fn()

    const resolvedPath = await startKeycloakSignIn({
      auth: { signinRedirect },
      intendedPath: '/app/trips/trip-123/plan',
      setIntendedPath,
    })

    expect(resolvedPath).toBe('/app/trips/trip-123/plan')
    expect(setIntendedPath).toHaveBeenCalledWith('/app/trips/trip-123/plan')
    expect(signinRedirect).toHaveBeenCalledWith({
      state: { intendedPath: '/app/trips/trip-123/plan' },
    })
  })
})
