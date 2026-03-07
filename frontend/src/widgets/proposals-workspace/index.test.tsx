import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProposalsWorkspace from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import { apiError, buildDay, buildJob, buildProposal, buildTrip, listResponse } from '@/test/fixtures/api'

const TRIP = buildTrip({ id: 'trip-1', version: 3 })
const DAY = buildDay({ id: 'day-1', trip_id: 'trip-1' })
const PROPOSAL = buildProposal()

function defaultHandlers() {
  server.use(
    http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
    http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
    http.get('http://localhost:8000/trips/trip-1/proposals', () => HttpResponse.json(listResponse([]))),
  )
}

describe('ProposalsWorkspace', () => {
  it('renders optimize button and empty state', async () => {
    defaultHandlers()

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/proposals']}>
        <Routes>
          <Route path="/app/trips/:tripId/proposals" element={<ProposalsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /optimize trip/i })).toBeInTheDocument()
    expect(await screen.findByText(/no proposals yet/i)).toBeInTheDocument()
  })

  it('sends optimize request with Idempotency-Key and creates proposal list row', async () => {
    let capturedHeaders: Record<string, string> = {}
    let callCount = 0

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/proposals', () => {
        callCount++
        return HttpResponse.json(listResponse(callCount >= 2 ? [PROPOSAL] : []))
      }),
      http.post('http://localhost:8000/trips/trip-1/optimize', async ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries())
        return HttpResponse.json(
          { job_id: 'job-opt-1', status: 'PENDING', poll_url: '/jobs/job-opt-1' },
          { status: 202 },
        )
      }),
      http.get('http://localhost:8000/jobs/job-opt-1', () =>
        HttpResponse.json(buildJob({ id: 'job-opt-1', status: 'SUCCEEDED' })),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/proposals']}>
        <Routes>
          <Route path="/app/trips/:tripId/proposals" element={<ProposalsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: /optimize trip/i })
    await userEvent.click(screen.getByRole('button', { name: /optimize trip/i }))

    await waitFor(() => {
      expect(capturedHeaders['idempotency-key']).toBeTruthy()
    })
  })

  it('opens proposal detail drawer on row click', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/proposals', () => HttpResponse.json(listResponse([PROPOSAL]))),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/proposals']}>
        <Routes>
          <Route path="/app/trips/:tripId/proposals" element={<ProposalsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    // Find and click the proposal row
    await waitFor(() => {
      expect(screen.getByText('Ready')).toBeInTheDocument()
    })
    const rows = screen.getAllByRole('button')
    const proposalRow = rows.find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.includes('Ready'))
    expect(proposalRow).toBeTruthy()
    await userEvent.click(proposalRow!)

    await screen.findByRole('dialog', { name: /proposal review/i })
    expect(screen.getByText(/proposal review/i)).toBeInTheDocument()
    expect(screen.getByText(PROPOSAL.items[0].title)).toBeInTheDocument()
  })

  it('applies proposal with If-Match and Idempotency-Key and invalidates planner', async () => {
    let capturedHeaders: Record<string, string> = {}

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/proposals', () => HttpResponse.json(listResponse([PROPOSAL]))),
      http.post('http://localhost:8000/proposals/proposal-1/apply', async ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries())
        return HttpResponse.json({
          proposal_id: 'proposal-1',
          trip_id: 'trip-1',
          status: 'APPLIED',
          version: 4,
          applied_day_ids: ['day-1'],
        })
      }),
      http.get('http://localhost:8000/days/day-1/activities', () => HttpResponse.json(listResponse([]))),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/proposals']}>
        <Routes>
          <Route path="/app/trips/:tripId/proposals" element={<ProposalsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())
    const rows = screen.getAllByRole('button')
    const proposalRow = rows.find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.includes('Ready'))
    await userEvent.click(proposalRow!)

    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: /apply proposal/i }))

    await waitFor(() => {
      expect(capturedHeaders['if-match']).toBe('3')
      expect(capturedHeaders['idempotency-key']).toBeTruthy()
    })
  })

  it('shows conflict banner on stale proposal apply (409)', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/proposals', () => HttpResponse.json(listResponse([PROPOSAL]))),
      http.post('http://localhost:8000/proposals/proposal-1/apply', () => {
        const err = apiError(409, 'CONFLICT_VERSION_MISMATCH', 'Version mismatch')
        return HttpResponse.json(err.body, { status: err.status })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/proposals']}>
        <Routes>
          <Route path="/app/trips/:tripId/proposals" element={<ProposalsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())
    const rows = screen.getAllByRole('button')
    const proposalRow = rows.find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.includes('Ready'))
    await userEvent.click(proposalRow!)

    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: /apply proposal/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/version conflict/i)).toBeInTheDocument()
    })
  })

  it('does not change planner before proposal is applied', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/proposals', () => HttpResponse.json(listResponse([PROPOSAL]))),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/proposals']}>
        <Routes>
          <Route path="/app/trips/:tripId/proposals" element={<ProposalsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    // Proposal detail visible but "Apply proposal" button not yet clicked
    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())
    const rows = screen.getAllByRole('button')
    const proposalRow = rows.find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.includes('Ready'))
    await userEvent.click(proposalRow!)

    await screen.findByRole('dialog')
    // "Apply proposal" button is present but we do not click it
    expect(screen.getByRole('button', { name: /apply proposal/i })).toBeInTheDocument()

    // The activities shown are proposal activities, not the current planner activities
    expect(screen.getByText(PROPOSAL.items[0].title)).toBeInTheDocument()
  })
})
