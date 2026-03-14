import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '@/test/msw/server'
import { buildPlace, buildTrip } from '@/test/fixtures/api'

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: toastInfo,
  },
}))

vi.mock('./useTripListCoverPhotos', () => ({
  useTripListCoverPhotos: () => new Map(),
}))

vi.mock('@/components/ui/animated-number', () => ({
  AnimatedNumber: ({ value }: { value: number | null | undefined }) => <>{value ?? null}</>,
}))

import TripsPage from './index'

type CreatedTripRequest = {
  destination_text: string
  start_date: string
  end_date: string
  budget_amount: number
  budget_currency: string
  trip_type: string
  route_travel_mode: 'WALK' | 'DRIVE' | 'BICYCLE' | 'TRANSIT'
  editorial_route_id?: string | null
}

type CreatedPlaceRequest = {
  name: string
  address_text: string
  lat: number
  lon: number
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
      },
      mutations: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/trips']}>
        <TripsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TripsPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    toastSuccess.mockReset()
    toastError.mockReset()
    toastInfo.mockReset()
  })

  it('renders the new trips workspace sections', async () => {
    const trips = [
      buildTrip({
        id: 'trip-board-1',
        title: 'Lisbon Return',
        destination_text: 'Lisbon, Portugal',
        start_date: '2026-05-10',
        end_date: '2026-05-15',
      }),
    ]

    server.use(
      http.get('http://localhost:8000/trips', () =>
        HttpResponse.json({
          items: trips,
          total: trips.length,
          limit: 12,
          offset: 0,
        }),
      ),
    )

    renderPage()

    expect(await screen.findByRole('heading', { name: /plan the next route without leaving the board/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /trips worth opening again/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /curated routes ready to drop into your board/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /a map section for scouting the next board/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /keep the board warm for the next departure/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /lisbon return/i })).toBeInTheDocument()
  })

  it('adds a curated destination to trips and stores the seeded cover metadata', async () => {
    const trips = [
      buildTrip({
        id: 'trip-board-1',
        title: 'Paris Atlas',
        destination_text: 'Paris, France',
      }),
    ]
    let createdTripId = 'trip-created-kyoto'
    let capturedTripBody: Record<string, unknown> | null = null
    let capturedCoverPatchBody: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? String(trips.length || 12))
        const offset = Number(url.searchParams.get('offset') ?? '0')

        return HttpResponse.json({
          items: trips.slice(offset, offset + limit),
          total: trips.length,
          limit,
          offset,
        })
      }),
      http.post('http://localhost:8000/trips', async ({ request }) => {
        const body = await request.json() as CreatedTripRequest
        capturedTripBody = body

        const destinationText = body.destination_text
        const city = destinationText.split(',')[0]?.trim() || 'Destination'
        const createdTrip = buildTrip({
          id: createdTripId,
          title: `Trip to ${city}`,
          destination_text: destinationText,
          start_date: body.start_date,
          end_date: body.end_date,
          budget_amount: String(body.budget_amount),
          budget_currency: body.budget_currency,
          trip_type: body.trip_type,
          route_travel_mode: body.route_travel_mode,
          version: 1,
        })

        trips.unshift(createdTrip)
        return HttpResponse.json(createdTrip, { status: 201 })
      }),
      http.post('http://localhost:8000/places', async ({ request }) => {
        const body = await request.json() as CreatedPlaceRequest
        return HttpResponse.json(
          buildPlace({
            id: 'place-seeded-1',
            name: body.name,
            address_text: body.address_text,
            lat: body.lat,
            lon: body.lon,
          }),
          { status: 201 },
        )
      }),
      http.patch('http://localhost:8000/trips/:tripId/cover-preference', async ({ request }) => {
        capturedCoverPatchBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          buildTrip({
            id: createdTripId,
            title: 'Trip to Kyoto',
            destination_text: 'Kyoto, Japan',
          }),
        )
      }),
    )

    renderPage()

    const proposalHeading = await screen.findByRole('heading', { name: 'Kyoto' })
    const proposalCard = proposalHeading.closest('article')
    expect(proposalCard).not.toBeNull()

    await userEvent.click(within(proposalCard!).getByRole('button', { name: /add to trips/i }))

    await waitFor(() => {
      expect(capturedTripBody).toMatchObject({
        destination_text: 'Kyoto, Japan',
        start_date: '2026-04-18',
        end_date: '2026-04-24',
        budget_amount: 2400,
        budget_currency: 'USD',
        trip_type: 'culture',
        route_travel_mode: 'WALK',
        editorial_route_id: 'kyoto-lantern-week',
      })
    })

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Kyoto added to your trips')
    })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /trip to kyoto/i })).toBeInTheDocument()
    })

    expect(capturedCoverPatchBody).toMatchObject({
      place_id: 'place-seeded-1',
      place_label: 'Kyoto, Japan',
      place_lat: 35.0116,
      place_lng: 135.7681,
      photo_id: null,
      fallback_image_url: '/images/trips/kyoto-lantern-week.jpg',
    })
  })
})
