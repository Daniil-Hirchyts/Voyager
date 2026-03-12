import { afterEach, describe, expect, it, vi } from 'vitest'
import { setUnauthorizedHandler, toApiError } from './client'

describe('api client unauthorized handling', () => {
  afterEach(() => {
    setUnauthorizedHandler(null)
  })

  it('invokes the unauthorized handler for 401 responses', async () => {
    const handler = vi.fn(async () => {})

    setUnauthorizedHandler(handler)

    await toApiError(
      new Response(JSON.stringify({ error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid token' } }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    expect(handler).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent 401 responses into a single unauthorized callback', async () => {
    let resolveHandler: (() => void) | null = null
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve
        }),
    )

    setUnauthorizedHandler(handler)

    const first = toApiError(
      new Response(JSON.stringify({ error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid token' } }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )
    const second = toApiError(
      new Response(JSON.stringify({ error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid token' } }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    expect(handler).toHaveBeenCalledOnce()

    expect(resolveHandler).not.toBeNull()
    resolveHandler!()
    await Promise.all([first, second])
  })

  it('does not invoke the unauthorized handler for non-401 responses', async () => {
    const handler = vi.fn(async () => {})

    setUnauthorizedHandler(handler)

    await toApiError(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Missing' } }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('still returns an ApiError if the unauthorized handler fails', async () => {
    const handler = vi.fn(async () => {
      throw new Error('logout failed')
    })

    setUnauthorizedHandler(handler)

    const error = await toApiError(
      new Response(JSON.stringify({ error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid token' } }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    expect(handler).toHaveBeenCalledOnce()
    expect(error.status).toBe(401)
    expect(error.code).toBe('AUTH_INVALID_TOKEN')
  })
})
