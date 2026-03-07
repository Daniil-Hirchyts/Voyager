import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import OffersWorkspace from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import {
  apiError,
  buildDay,
  buildJob,
  buildOffer,
  buildTrip,
  listResponse,
} from '@/test/fixtures/api'

function renderWorkspace(initialEntry = '/app/trips/trip-1/offers') {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/app/trips/:tripId/offers" element={<OffersWorkspace tripId="trip-1" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OffersWorkspace', () => {
  it('prefills flight and hotel forms from trip context', async () => {
    const trip = buildTrip({
      destination_text: 'Madrid, Spain',
      start_date: '2026-04-10',
      end_date: '2026-04-12',
      budget_currency: 'EUR',
    })
    const days = [
      buildDay({ id: 'day-1', date: '2026-04-10', day_index: 0 }),
      buildDay({ id: 'day-2', date: '2026-04-11', day_index: 1 }),
      buildDay({ id: 'day-3', date: '2026-04-12', day_index: 2 }),
    ]

    server.use(
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/:tripId/days', () => HttpResponse.json(listResponse(days))),
      http.get('http://localhost:8000/trips/:tripId/offers', () => HttpResponse.json(listResponse([]))),
    )

    renderWorkspace()

    await waitFor(() => {
      expect(screen.getByLabelText(/Destination/i)).toHaveValue('Madrid, Spain')
    })
    expect(screen.getByLabelText(/Origin/i)).toHaveValue('')
    await waitFor(() => {
      expect(screen.getByLabelText(/Depart/i)).toHaveTextContent('Apr 10, 2026')
      expect(screen.getByLabelText(/Return/i)).toHaveTextContent('Apr 12, 2026')
    })

    await userEvent.click(screen.getByRole('tab', { name: /hotels/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/Location/i)).toHaveValue('Madrid, Spain')
      expect(screen.getByLabelText(/Check-in/i)).toHaveTextContent('Apr 10, 2026')
      expect(screen.getByLabelText(/Check-out/i)).toHaveTextContent('Apr 12, 2026')
    })
  })

  it('prefills from a focused day and sends trip_day_id in transport search payloads', async () => {
    const trip = buildTrip({
      destination_text: 'Madrid, Spain',
      start_date: '2026-04-10',
      end_date: '2026-04-12',
    })
    const days = [
      buildDay({ id: 'day-1', date: '2026-04-10', day_index: 0 }),
      buildDay({ id: 'day-2', date: '2026-04-11', day_index: 1 }),
    ]
    const priorFlight = buildOffer({
      id: 'offer-prior',
      origin_text: 'ORY',
      destination_text: 'MAD',
      trip_day_id: 'day-1',
    })
    let searchPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/:tripId/days', () => HttpResponse.json(listResponse(days))),
      http.get('http://localhost:8000/trips/:tripId/offers', () => HttpResponse.json(listResponse([priorFlight]))),
      http.post('http://localhost:8000/offers/transport/search', async ({ request }) => {
        searchPayload = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ job_id: 'job-search' })
      }),
      http.get('http://localhost:8000/jobs/:jobId', () =>
        HttpResponse.json(buildJob({ id: 'job-search', job_type: 'offers.transport.search' })),
      ),
    )

    renderWorkspace('/app/trips/trip-1/offers?dayId=day-1')

    await waitFor(() => {
      expect(screen.getByLabelText(/Origin/i)).toHaveValue('ORY')
      expect(screen.getByLabelText(/Destination/i)).toHaveValue('MAD')
      expect(screen.getByLabelText(/Depart/i)).toHaveTextContent('Apr 10, 2026')
      expect(screen.getByLabelText(/Return/i)).toHaveTextContent('Apr 11, 2026')
    })

    await userEvent.click(screen.getByRole('button', { name: /search flights/i }))

    await waitFor(() => {
      expect(searchPayload).toMatchObject({
        trip_id: 'trip-1',
        trip_day_id: 'day-1',
        origin_text: 'ORY',
        destination_text: 'MAD',
      })
    })
  })

  it('attaches an offer to a day and shows the updated attachment badge after invalidation', async () => {
    const trip = buildTrip()
    const day = buildDay({ id: 'day-1', date: '2026-04-10', day_index: 0 })
    let offer = buildOffer({ id: 'offer-1', trip_day_id: null })
    let attachPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/:tripId/days', () => HttpResponse.json(listResponse([day]))),
      http.get('http://localhost:8000/trips/:tripId/offers', () => HttpResponse.json(listResponse([offer]))),
      http.post('http://localhost:8000/trips/:tripId/offers/:offerId/attach-day', async ({ request }) => {
        attachPayload = (await request.json()) as Record<string, unknown>
        offer = { ...offer, trip_day_id: day.id }
        return HttpResponse.json(offer)
      }),
    )

    renderWorkspace()

    expect(await screen.findByText(offer.title)).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: /attach to day/i })[0])
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: /Day 1/i }))
    await userEvent.click(screen.getByRole('button', { name: /^attach$/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/Attached · Day 1/i)[0]).toBeInTheDocument()
    })
    expect(attachPayload).toEqual({ offer_kind: offer.kind, trip_day_id: day.id })
  })

  it('shows hotel detail with map fallback and auto-refreshes empty place photos once', async () => {
    const trip = buildTrip({ destination_text: 'Paris, France' })
    const day = buildDay({ id: 'day-1', date: '2026-04-10', day_index: 0 })
    const hotelOffer = buildOffer({
      id: 'hotel-1',
      kind: 'lodging',
      title: 'Hotel du Louvre',
      lodging_details: {
        ...buildOffer({ kind: 'lodging' }).lodging_details!,
        hotel_name: 'Hotel du Louvre',
        place_id: 'place-1',
        photo_count: 0,
        primary_photo: null,
      },
    })
    let refreshCalls = 0

    server.use(
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/:tripId/days', () => HttpResponse.json(listResponse([day]))),
      http.get('http://localhost:8000/trips/:tripId/offers', () => HttpResponse.json(listResponse([hotelOffer]))),
      http.get('http://localhost:8000/places/:placeId/photos', () => HttpResponse.json(listResponse([]))),
      http.post('http://localhost:8000/places/:placeId/photos/refresh', () => {
        refreshCalls += 1
        return HttpResponse.json({ job_id: 'job-photo-refresh' })
      }),
      http.get('http://localhost:8000/jobs/:jobId', () =>
        HttpResponse.json(buildJob({ id: 'job-photo-refresh', job_type: 'places.photos.refresh' })),
      ),
    )

    renderWorkspace()

    await userEvent.click(screen.getByRole('tab', { name: /hotels/i }))

    expect((await screen.findAllByText('Hotel du Louvre')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Map unavailable/i)).toBeInTheDocument()
    expect(screen.getByText(/No photos yet/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(refreshCalls).toBe(1)
    })
  })

  it('shows an inline provider-unavailable state for transport search 503s', async () => {
    const trip = buildTrip()
    const day = buildDay()

    server.use(
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/:tripId/days', () => HttpResponse.json(listResponse([day]))),
      http.get('http://localhost:8000/trips/:tripId/offers', () => HttpResponse.json(listResponse([]))),
      http.post('http://localhost:8000/offers/transport/search', () => {
        const error = apiError(503, 'INTEGRATION_NOT_CONFIGURED', 'Provider disabled')
        return HttpResponse.json(error.body, { status: error.status })
      }),
    )

    renderWorkspace()

    await userEvent.type(await screen.findByLabelText(/Origin/i), 'CDG')
    await userEvent.type(screen.getByLabelText(/Destination/i), 'MAD')
    await userEvent.click(screen.getByRole('button', { name: /search flights/i }))

    expect(await screen.findByText('Flights are unavailable')).toBeInTheDocument()
    expect(
      screen.getByText('Provider integrations are not configured for this environment.'),
    ).toBeInTheDocument()
  })
})
