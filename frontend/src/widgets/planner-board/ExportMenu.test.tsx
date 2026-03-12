import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportMenu } from './ExportMenu'
import { server } from '@/test/msw/server'
import { renderWithQueryClient } from '@/test/utils'

describe('ExportMenu', () => {
  const createObjectUrl = vi.fn(() => 'blob:test-export')
  const revokeObjectUrl = vi.fn()
  const anchorClick = vi.fn()
  const windowOpen = vi.fn()
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  afterEach(() => {
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      })
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL')
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      })
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
    createObjectUrl.mockClear()
    revokeObjectUrl.mockClear()
    anchorClick.mockClear()
    windowOpen.mockClear()
    vi.restoreAllMocks()
  })

  it('downloads the export through fetch instead of opening the raw download URL', async () => {
    let contentRequestCount = 0

    server.use(
      http.post('http://localhost:8000/trips/:tripId/exports', () =>
        HttpResponse.json(
          {
            job_id: 'job-1',
            status: 'PENDING',
            poll_url: '/jobs/job-1',
          },
          { status: 202 },
        ),
      ),
      http.get('http://localhost:8000/jobs/job-1', () =>
        HttpResponse.json({
          id: 'job-1',
          user_id: 'user-1',
          job_type: 'export.generate.json',
          status: 'SUCCEEDED',
          payload: {},
          result: { export_id: 'export-1' },
          error: null,
          attempts: 1,
          max_attempts: 3,
          available_at: '2026-03-12T09:00:00.000Z',
          dead_lettered_at: null,
          created_at: '2026-03-12T09:00:00.000Z',
          started_at: '2026-03-12T09:00:00.000Z',
          finished_at: '2026-03-12T09:00:00.000Z',
        }),
      ),
      http.get('http://localhost:8000/exports/export-1', () =>
        HttpResponse.json({
          id: 'export-1',
          job_id: 'job-1',
          user_id: 'user-1',
          trip_id: 'trip-1',
          format: 'json',
          status: 'SUCCEEDED',
          trip_version: 3,
          content_type: 'application/json',
          size_bytes: 128,
          sha256: 'abc123',
          error: null,
          created_at: '2026-03-12T09:00:00.000Z',
          finished_at: '2026-03-12T09:00:00.000Z',
          expires_at: null,
          deleted_at: null,
          download_url: '/exports/export-1/content',
        }),
      ),
      http.get('http://localhost:8000/exports/export-1/content', () => {
        contentRequestCount += 1
        return new HttpResponse('{"trip":"atlas"}', {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="trip-1.json"',
          },
        })
      }),
    )

    vi.stubGlobal('open', windowOpen)
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick)

    renderWithQueryClient(<ExportMenu tripId="trip-1" tripVersion={3} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /export/i }))
    await user.click(screen.getByRole('menuitem', { name: /json/i }))

    await waitFor(
      () => {
        expect(contentRequestCount).toBe(1)
        expect(createObjectUrl).toHaveBeenCalledTimes(1)
        expect(anchorClick).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )
    expect(windowOpen).not.toHaveBeenCalled()
  })
})
