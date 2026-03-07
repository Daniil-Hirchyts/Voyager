import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ExportsWorkspace from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import { apiError, buildExport, buildJob, buildTrip } from '@/test/fixtures/api'

const TRIP = buildTrip({ id: 'trip-1', version: 3 })
const JOB_RUNNING = buildJob({ id: 'job-export-1', status: 'RUNNING', job_type: 'export' })
const JOB_DONE = buildJob({
  id: 'job-export-1',
  status: 'SUCCEEDED',
  job_type: 'export',
  result: { export_id: 'export-1' },
})
const EXPORT = buildExport()

function setup() {
  server.use(
    http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
    http.get('http://localhost:8000/jobs/job-export-1', () => HttpResponse.json(JOB_DONE)),
    http.get('http://localhost:8000/exports/export-1', () => HttpResponse.json(EXPORT)),
  )

  return renderWithQueryClient(
    <MemoryRouter initialEntries={['/app/trips/trip-1/exports']}>
      <Routes>
        <Route path="/app/trips/:tripId/exports" element={<ExportsWorkspace tripId="trip-1" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ExportsWorkspace', () => {
  it('renders format chooser with all three formats', async () => {
    setup()
    expect(await screen.findByRole('button', { name: /export json/i })).toBeInTheDocument()
    // Format card buttons contain their label text
    expect(screen.getAllByText('JSON').length).toBeGreaterThan(0)
    expect(screen.getByText('Calendar (ICS)')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
  })

  it('sends If-Match and Idempotency-Key on export submit', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.post('http://localhost:8000/trips/trip-1/exports', async ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries())
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          { job_id: 'job-export-1', status: 'PENDING', poll_url: '/jobs/job-export-1' },
          { status: 202 },
        )
      }),
      http.get('http://localhost:8000/jobs/job-export-1', () => HttpResponse.json(JOB_DONE)),
      http.get('http://localhost:8000/exports/export-1', () => HttpResponse.json(EXPORT)),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/exports']}>
        <Routes>
          <Route path="/app/trips/:tripId/exports" element={<ExportsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: /export json/i })
    await userEvent.click(screen.getByRole('button', { name: /export json/i }))

    await waitFor(() => {
      expect(capturedBody).toEqual({ format: 'json' })
      expect(capturedHeaders['if-match']).toBe('3')
      expect(capturedHeaders['idempotency-key']).toBeTruthy()
    })
  })

  it('shows conflict banner on 409 and disallows retry until resolved', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.post('http://localhost:8000/trips/trip-1/exports', () => {
        const err = apiError(409, 'CONFLICT_VERSION_MISMATCH', 'Version mismatch')
        return HttpResponse.json(err.body, { status: err.status })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/exports']}>
        <Routes>
          <Route path="/app/trips/:tripId/exports" element={<ExportsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: /export json/i })
    await userEvent.click(screen.getByRole('button', { name: /export json/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/version conflict/i)).toBeInTheDocument()
    })
  })

  it('shows success row with download button once job succeeds', async () => {
    let callCount = 0
    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.post('http://localhost:8000/trips/trip-1/exports', () =>
        HttpResponse.json(
          { job_id: 'job-export-1', status: 'PENDING', poll_url: '/jobs/job-export-1' },
          { status: 202 },
        ),
      ),
      http.get('http://localhost:8000/jobs/job-export-1', () => {
        callCount++
        return HttpResponse.json(callCount >= 2 ? JOB_DONE : JOB_RUNNING)
      }),
      http.get('http://localhost:8000/exports/export-1', () => HttpResponse.json(EXPORT)),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/exports']}>
        <Routes>
          <Route path="/app/trips/:tripId/exports" element={<ExportsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: /export json/i })
    await userEvent.click(screen.getByRole('button', { name: /export json/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument()
    }, { timeout: 8000 })
  })

  it('shows rate-limit banner on 429', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.post('http://localhost:8000/trips/trip-1/exports', () => {
        const err = apiError(429, 'RATE_LIMITED', 'Too many requests')
        return HttpResponse.json(err.body, { status: err.status })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/exports']}>
        <Routes>
          <Route path="/app/trips/:tripId/exports" element={<ExportsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: /export json/i })
    await userEvent.click(screen.getByRole('button', { name: /export json/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/being paced/i)).toBeInTheDocument()
    })
  })
})
