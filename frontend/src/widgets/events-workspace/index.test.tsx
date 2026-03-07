import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import EventsWorkspace from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import { apiError, buildDay, buildEvent, buildJob, buildTrip, listResponse } from '@/test/fixtures/api'

const TRIP = buildTrip({ id: 'trip-1', version: 3 })
const DAY = buildDay({ id: 'day-1', trip_id: 'trip-1', day_index: 0 })
const EVENT = buildEvent()

function setup() {
  server.use(
    http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
    http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
    http.get('http://localhost:8000/trips/trip-1/events', () => HttpResponse.json(listResponse([]))),
  )

  return renderWithQueryClient(
    <MemoryRouter initialEntries={['/app/trips/trip-1/events']}>
      <Routes>
        <Route path="/app/trips/:tripId/events" element={<EventsWorkspace tripId="trip-1" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EventsWorkspace', () => {
  it('renders the search form with required date fields', async () => {
    setup()
    expect(await screen.findByLabelText(/start date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/end date/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search events/i })).toBeInTheDocument()
  })

  it('shows empty state when no events found', async () => {
    setup()
    expect(await screen.findByText(/no events found/i)).toBeInTheDocument()
  })

  it('shows provider-unavailable state on 503 INTEGRATION_NOT_CONFIGURED', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/events', () => HttpResponse.json(listResponse([]))),
      http.post('http://localhost:8000/events/search', () => {
        const err = apiError(503, 'INTEGRATION_NOT_CONFIGURED', 'Provider disabled')
        return HttpResponse.json(err.body, { status: err.status })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/events']}>
        <Routes>
          <Route path="/app/trips/:tripId/events" element={<EventsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    // Wait for trip to load and form dates to be pre-populated
    await screen.findByRole('button', { name: /search events/i })
    await userEvent.click(screen.getByRole('button', { name: /search events/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText(/not configured for this environment/i)).toBeInTheDocument()
    })
  })

  it('sends Idempotency-Key on event search submit', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/events', () => HttpResponse.json(listResponse([]))),
      http.post('http://localhost:8000/events/search', async ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries())
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          { job_id: 'job-event-1', status: 'PENDING', poll_url: '/jobs/job-event-1' },
          { status: 202 },
        )
      }),
      http.get('http://localhost:8000/jobs/job-event-1', () =>
        HttpResponse.json(buildJob({ id: 'job-event-1', status: 'SUCCEEDED' })),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/events']}>
        <Routes>
          <Route path="/app/trips/:tripId/events" element={<EventsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    // Wait for trip to load and form dates to be pre-populated from trip
    await screen.findByRole('button', { name: /search events/i })
    await userEvent.click(screen.getByRole('button', { name: /search events/i }))

    await waitFor(() => {
      expect(capturedBody?.trip_id).toBe('trip-1')
      expect(capturedHeaders['idempotency-key']).toBeTruthy()
    })
  })

  it('renders event list and shows detail panel on click', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/events', () => HttpResponse.json(listResponse([EVENT]))),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/events']}>
        <Routes>
          <Route path="/app/trips/:tripId/events" element={<EventsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(EVENT.title)).toBeInTheDocument()
    await userEvent.click(screen.getByText(EVENT.title))

    // Detail panel shows venue
    await waitFor(() => {
      expect(screen.getAllByText(EVENT.venue_name!).length).toBeGreaterThan(0)
    })
  })

  it('attaches event to day and sends If-Match + Idempotency-Key', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/events', () => HttpResponse.json(listResponse([EVENT]))),
      http.post('http://localhost:8000/trips/trip-1/events/event-1/attach-day', async ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries())
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...EVENT, trip_day_id: 'day-1' })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/events']}>
        <Routes>
          <Route path="/app/trips/:tripId/events" element={<EventsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText(EVENT.title)
    await userEvent.click(screen.getByText(EVENT.title))
    await screen.findByRole('button', { name: /attach to day/i })
    await userEvent.click(screen.getByRole('button', { name: /attach to day/i }))

    // Modal opens
    await screen.findByRole('dialog', { name: /attach event to day/i })
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }))

    await waitFor(() => {
      expect(capturedBody?.trip_day_id).toBe('day-1')
      expect(capturedHeaders['if-match']).toBe('3')
      expect(capturedHeaders['idempotency-key']).toBeTruthy()
    })
  })

  it('renders event date in provider-local timezone', async () => {
    // Event at 20:00 Europe/Paris which is 18:00 UTC
    const tzEvent = buildEvent({
      start_at: '2026-04-10T18:00:00Z',
      timezone: 'Europe/Paris',
    })

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(TRIP)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([DAY]))),
      http.get('http://localhost:8000/trips/trip-1/events', () => HttpResponse.json(listResponse([tzEvent]))),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips/trip-1/events']}>
        <Routes>
          <Route path="/app/trips/:tripId/events" element={<EventsWorkspace tripId="trip-1" />} />
        </Routes>
      </MemoryRouter>,
    )

    // Click to open detail — should show local Paris time (20:00), not UTC (18:00)
    await screen.findByText(tzEvent.title)
    await userEvent.click(screen.getByText(tzEvent.title))

    await waitFor(() => {
      const detail = screen.getAllByText(/20:00|8:00\s*PM/i)
      expect(detail.length).toBeGreaterThan(0)
    })
  })
})
