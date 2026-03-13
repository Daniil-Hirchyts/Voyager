import { describe, expect, it, vi } from 'vitest'
import { createSessionExpiryHandler, getBrowserPath } from './auth-session'

describe('auth-session', () => {
  it('builds the full browser path including search params and hash', () => {
    expect(
      getBrowserPath({
        pathname: '/app/trips/trip-1/plan',
        search: '?day=2',
        hash: '#board',
      }),
    ).toBe('/app/trips/trip-1/plan?day=2#board')
  })

  it('stores the current app path before redirecting to sign in', async () => {
    const removeUser = vi.fn(async () => {})
    const startSignin = vi.fn(async () => {})

    const handleSessionExpiry = createSessionExpiryHandler({
      getCurrentPath: () => '/app/trips/trip-1/plan?day=2#board',
      getCurrentPathname: () => '/app/trips/trip-1/plan',
      removeUser,
      startSignin,
    })

    await handleSessionExpiry()

    expect(removeUser).toHaveBeenCalledOnce()
    expect(startSignin).toHaveBeenCalledOnce()
    expect(startSignin).toHaveBeenCalledWith('/app/trips/trip-1/plan?day=2#board')
  })

  it('skips storing intended path for public routes', async () => {
    const removeUser = vi.fn(async () => {})
    const startSignin = vi.fn(async () => {})

    const handleSessionExpiry = createSessionExpiryHandler({
      getCurrentPath: () => '/signin',
      getCurrentPathname: () => '/signin',
      removeUser,
      startSignin,
    })

    await handleSessionExpiry()

    expect(removeUser).toHaveBeenCalledOnce()
    expect(startSignin).toHaveBeenCalledOnce()
    expect(startSignin).toHaveBeenCalledWith(null)
  })

  it('coalesces repeated expiry triggers into a single logout flow', async () => {
    const startSignin = vi.fn(async () => {})
    let resolveRemoveUser: (() => void) | null = null
    const removeUser = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRemoveUser = resolve
        }),
    )

    const handleSessionExpiry = createSessionExpiryHandler({
      getCurrentPath: () => '/app/trips/trip-1/plan',
      getCurrentPathname: () => '/app/trips/trip-1/plan',
      removeUser,
      startSignin,
    })

    const first = handleSessionExpiry()
    const second = handleSessionExpiry()

    expect(removeUser).toHaveBeenCalledOnce()

    expect(resolveRemoveUser).not.toBeNull()
    resolveRemoveUser!()
    await Promise.all([first, second])

    expect(startSignin).toHaveBeenCalledOnce()
    expect(startSignin).toHaveBeenCalledWith('/app/trips/trip-1/plan')
  })
})
