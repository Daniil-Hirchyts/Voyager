import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { config } from '@/app/config'
import { DEFAULT_VOYAGER_PREFERENCES } from '@/entities/user/preferences'
import type { RoutePreviewInput } from '@/shared/api/types'
import { ActivityMapDetailSheet, PlannerMapView } from './PlannerMapView'
import type { PlannerRecommendationsController } from './usePlannerRecommendations'
import {
  buildActivityDiscoveryItem,
  buildPlace,
  buildPlannerActivity,
  buildPlannerDay,
  buildTrip,
  buildTripAsset,
} from '@/test/fixtures/api'
import { server } from '@/test/msw/server'
import { renderWithQueryClient } from '@/test/utils'

describe('ActivityMapDetailSheet', () => {
  it('renders activity attachments in the live detail sheet', async () => {
    const activity = buildPlannerActivity({
      id: 'activity-99',
      place_id: null,
      place: null,
    })
    const assets = [
      buildTripAsset({
        id: 'asset-activity-1',
        activity_id: activity.id,
        original_filename: 'museum-ticket.pdf',
      }),
    ]

    server.use(
      http.get('http://localhost:8000/trips/:tripId/assets', ({ request }) => {
        const activityId = new URL(request.url).searchParams.get('activity_id')
        const items = assets.filter((item) => item.activity_id === activityId)
        return HttpResponse.json({
          total: items.length,
          items,
        })
      }),
    )

    const user = userEvent.setup()

    renderWithQueryClient(
      <ActivityMapDetailSheet
        open
        tripId="trip-1"
        activity={activity}
        dayLabel="Day 1"
        onClose={() => {}}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Activity' }))

    expect(await screen.findByText('Attachments')).toBeInTheDocument()
    expect(screen.getByText('museum-ticket.pdf')).toBeInTheDocument()
  })
})

function buildRecommendationsController(): PlannerRecommendationsController {
  return {
    enabled: false,
    preferences: DEFAULT_VOYAGER_PREFERENCES,
    targetDayId: 'day-1',
    setTargetDayId: () => {},
    dayOptions: [],
    destinations: [],
    discoverEntries: [],
    isLoadingDiscover: false,
    isRefreshing: false,
    addingKey: null,
    refresh: async () => {},
    addEntryToDestination: async () => null,
  }
}

function mockDomRect(rect: Partial<DOMRect>): DOMRect {
  return {
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    top: rect.top ?? 0,
    right: rect.right ?? 0,
    bottom: rect.bottom ?? 0,
    left: rect.left ?? 0,
    toJSON: () => ({}),
  } as DOMRect
}

describe('PlannerMapView', () => {
  it('renders the trip hero with collapsible budget, recommendations, and files sections', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({
      title: 'Trip to Rome',
      destination_text: 'Rome, Italy',
      budget_amount: '2400.00',
      budget_currency: 'EUR',
      route_travel_mode: 'TRANSIT',
    })
    const recommendations = {
      ...buildRecommendationsController(),
      enabled: true,
      discoverEntries: [
        {
          key: 'discover:rome-1',
          source: 'discover' as const,
          item: buildActivityDiscoveryItem({
            id: 'discover-rome-1',
            title: 'Night walk at Trevi Fountain',
            address_text: 'Trevi Fountain, Rome',
          }),
          score: null,
          rationale: null,
        },
      ],
    }

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerMapView
          trip={trip}
          tripId={trip.id}
          tripVersion={trip.version}
          days={[buildPlannerDay()]}
          inboxActivities={[]}
          selectedActivityId={null}
          selectedPlaceId={null}
          recommendations={recommendations}
          selectedRecommendation={null}
          onAddActivity={() => {}}
          onSelectActivityId={() => {}}
          onSelectPlaceId={() => {}}
          onSelectRecommendation={() => {}}
          onClearMapSelection={() => {}}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('planner-trip-hero')).toHaveTextContent('Trip to Rome')
    expect(screen.getByTestId('planner-budget-section')).toHaveTextContent('Budget')
    expect(screen.getByTestId('planner-budget-summary')).toHaveTextContent('Trip budget')
    expect(screen.getByTestId('planner-recommendations-section')).toHaveTextContent(
      'Recommendations',
    )
    expect(screen.getByText('Night walk at Trevi Fountain')).toBeInTheDocument()

    const filesSection = screen.getByTestId('planner-files-section')
    await user.click(within(filesSection).getByRole('button', { name: /Files/i }))

    expect(await screen.findByText('Trip uploads')).toBeInTheDocument()
  })

  it('splits travel and accommodation into standalone sections above the itinerary', async () => {
    const trip = buildTrip({
      title: 'Trip to Lisbon',
      destination_text: 'Lisbon, Portugal',
    })
    const mainActivity = buildPlannerActivity({
      id: 'activity-main',
      title: 'Alfama walk',
      category: 'visit',
      trip_day_id: 'day-1',
      order_index: 0,
    })
    const hotelActivity = buildPlannerActivity({
      id: 'activity-hotel',
      title: 'Hotel Atlas',
      category: 'hotel',
      trip_day_id: 'day-1',
      order_index: 1,
      place_id: null,
      place: null,
    })
    const travelActivity = buildPlannerActivity({
      id: 'activity-travel',
      title: 'Flight to Lisbon',
      category: 'travel',
      trip_day_id: 'day-1',
      order_index: 2,
      place_id: null,
      place: null,
    })
    const unassignedHotel = buildPlannerActivity({
      id: 'activity-unassigned-hotel',
      title: 'Backup hotel',
      category: 'hotel',
      trip_day_id: null,
      order_index: 0,
      place_id: null,
      place: null,
    })
    const unassignedTravel = buildPlannerActivity({
      id: 'activity-unassigned-travel',
      title: 'Airport transfer',
      category: 'travel',
      trip_day_id: null,
      order_index: 1,
      place_id: null,
      place: null,
    })
    const day = buildPlannerDay({
      id: 'day-1',
      day_index: 0,
      date: '2026-04-10',
      activities: [mainActivity, hotelActivity, travelActivity],
    })

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerMapView
          trip={trip}
          tripId={trip.id}
          tripVersion={trip.version}
          days={[day]}
          inboxActivities={[unassignedHotel, unassignedTravel]}
          selectedActivityId={null}
          selectedPlaceId={null}
          recommendations={buildRecommendationsController()}
          selectedRecommendation={null}
          onAddActivity={() => {}}
          onSelectActivityId={() => {}}
          onSelectPlaceId={() => {}}
          onSelectRecommendation={() => {}}
          onClearMapSelection={() => {}}
        />
      </MemoryRouter>,
    )

    const accommodationSection = await screen.findByTestId('planner-accommodation-section')
    const travelSection = screen.getByTestId('planner-travel-section')
    const itineraryDay = document.getElementById('planner-day-day-1')

    expect(accommodationSection).toHaveTextContent('Accommodation')
    expect(travelSection).toHaveTextContent('Travel')
    expect(within(accommodationSection).getByText('Hotel Atlas')).toBeInTheDocument()
    expect(within(accommodationSection).getByText('Backup hotel')).toBeInTheDocument()
    expect(within(accommodationSection).queryByText('Unassigned')).not.toBeInTheDocument()
    expect(within(travelSection).getByText('Flight to Lisbon')).toBeInTheDocument()
    expect(within(travelSection).getByText('Airport transfer')).toBeInTheDocument()
    expect(within(travelSection).queryByText('Unassigned')).not.toBeInTheDocument()

    expect(itineraryDay).not.toBeNull()
    expect(within(itineraryDay!).getByText('Alfama walk')).toBeInTheDocument()
    expect(within(itineraryDay!).queryByText('Hotel Atlas')).not.toBeInTheDocument()
    expect(within(itineraryDay!).queryByText('Flight to Lisbon')).not.toBeInTheDocument()
  })

  it('renders travel overlays on the map with compact markers and a curved route', async () => {
    const originalApiKey = config.map.apiKey
    const originalPolyline = globalThis.google.maps.Polyline
    const polylineOptions: Array<Record<string, unknown>> = []
    config.map.apiKey = 'test-google-maps-key'
    globalThis.google.maps.Polyline = class {
      constructor(public options: Record<string, unknown> = {}) {
        polylineOptions.push(options)
      }

      setMap() {}
      setPath() {}
    } as unknown as typeof google.maps.Polyline

    const trip = buildTrip({ id: 'trip-map-travel-overlay' })
    const travelActivity = buildPlannerActivity({
      id: 'travel-map-1',
      title: 'Paris to Lisbon',
      category: 'travel',
      trip_day_id: 'day-1',
      place_id: null,
      place: null,
      category_details: {
        origin_text: 'Paris Airport',
        destination_text: 'Lisbon Airport',
        origin_geo: { lat: 48.969, lon: 2.441 },
        destination_geo: { lat: 38.7756, lon: -9.1354 },
        travel_mode: 'flight',
      },
    })
    const day = buildPlannerDay({
      id: 'day-1',
      day_index: 0,
      date: '2026-04-10',
      activities: [travelActivity],
    })

    try {
      renderWithQueryClient(
        <MemoryRouter>
          <PlannerMapView
            trip={trip}
            tripId={trip.id}
            tripVersion={trip.version}
            days={[day]}
            inboxActivities={[]}
            selectedActivityId={travelActivity.id}
            selectedPlaceId={null}
            recommendations={buildRecommendationsController()}
            selectedRecommendation={null}
            onAddActivity={() => {}}
            onSelectActivityId={() => {}}
            onSelectPlaceId={() => {}}
            onSelectRecommendation={() => {}}
            onClearMapSelection={() => {}}
          />
        </MemoryRouter>,
      )

      expect(screen.getByTestId('google-map-stub').parentElement).toHaveClass('voyager-google-map')
      expect(
        await screen.findByTestId('planner-map-travel-travel-map-1-origin'),
      ).toBeInTheDocument()
      expect(
        screen.getByTestId('planner-map-travel-travel-map-1-destination'),
      ).toBeInTheDocument()
      expect(screen.getByTestId('planner-map-travel-travel-map-1-badge')).toBeInTheDocument()

      await waitFor(() => expect(polylineOptions).toHaveLength(2))
      expect(polylineOptions[0]).toMatchObject({
        strokeColor: '#FFFFFF',
      })

      const coloredPolyline = polylineOptions[1]
      expect(coloredPolyline).toMatchObject({
        strokeColor: '#2563EB',
      })
      const path = coloredPolyline.path as Array<{ lat: number; lng: number }>
      expect(path[0]).toEqual({ lat: 48.969, lng: 2.441 })
      expect(path.at(-1)).toEqual({ lat: 38.7756, lng: -9.1354 })
      expect(path.length).toBeGreaterThan(2)
    } finally {
      globalThis.google.maps.Polyline = originalPolyline
      config.map.apiKey = originalApiKey
    }
  })

  it('fits the selected travel route above the desktop detail sheet', async () => {
    const originalApiKey = config.map.apiKey
    config.map.apiKey = 'test-google-maps-key'

    const map = (
      globalThis as typeof globalThis & {
        __voyagerGoogleMapStub: { fitBounds: ReturnType<typeof vi.fn> }
      }
    ).__voyagerGoogleMapStub
    const fitBounds = map.fitBounds

    const destinationPlace = buildPlace({
      id: 'place-prague-airport',
      name: 'Prague Airport',
      lat: 50.1008,
      lon: 14.26,
    })
    const trip = buildTrip({ id: 'trip-map-travel-fit' })
    const travelActivity = buildPlannerActivity({
      id: 'travel-map-fit',
      title: 'Orly to Prague airport',
      category: 'travel',
      trip_day_id: 'day-1',
      place_id: destinationPlace.id,
      place: destinationPlace,
      category_details: {
        origin_text: 'Orly, France',
        destination_text: 'Prague Airport',
        origin_geo: { lat: 48.7279, lon: 2.3592 },
        destination_geo: { lat: 50.1008, lon: 14.26 },
        travel_mode: 'flight',
      },
    })
    const day = buildPlannerDay({
      id: 'day-1',
      day_index: 0,
      date: '2026-04-10',
      activities: [travelActivity],
    })

    try {
      renderWithQueryClient(
        <MemoryRouter>
          <PlannerMapView
            trip={trip}
            tripId={trip.id}
            tripVersion={trip.version}
            days={[day]}
            inboxActivities={[]}
            selectedActivityId={travelActivity.id}
            selectedPlaceId={destinationPlace.id}
            recommendations={buildRecommendationsController()}
            selectedRecommendation={null}
            onAddActivity={() => {}}
            onSelectActivityId={() => {}}
            onSelectPlaceId={() => {}}
            onSelectRecommendation={() => {}}
            onClearMapSelection={() => {}}
          />
        </MemoryRouter>,
      )

      await waitFor(() => expect(fitBounds).toHaveBeenCalled())
      fitBounds.mockClear()

      const mapContainer = screen.getByTestId('planner-map-container')
      const detailSheet = await screen.findByTestId('planner-map-detail-sheet')

      vi.spyOn(mapContainer, 'getBoundingClientRect').mockReturnValue(
        mockDomRect({
          top: 0,
          right: 1400,
          bottom: 1000,
          left: 0,
          width: 1400,
          height: 1000,
        }),
      )
      vi.spyOn(detailSheet, 'getBoundingClientRect').mockReturnValue(
        mockDomRect({
          top: 660,
          right: 1376,
          bottom: 980,
          left: 24,
          width: 1352,
          height: 320,
        }),
      )

      window.dispatchEvent(new Event('resize'))

      await waitFor(() =>
        expect(fitBounds).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ top: 120, right: 84, bottom: 352, left: 84 }),
        ),
      )
    } finally {
      config.map.apiKey = originalApiKey
    }
  })

  it('saves an inline budget update from the planner rail', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({
      id: 'trip-budget',
      version: 7,
      budget_amount: '2400.00',
      budget_currency: 'EUR',
    })
    let capturedBody: Record<string, unknown> | null = null
    let capturedVersion: string | null = null

    server.use(
      http.patch('http://localhost:8000/trips/:tripId', async ({ request }) => {
        capturedVersion = request.headers.get('if-match')
        capturedBody = (await request.json()) as Record<string, unknown>

        return HttpResponse.json(
          buildTrip({
            ...trip,
            version: trip.version + 1,
            budget_amount: '3100.00',
            budget_currency: 'USD',
          }),
        )
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerMapView
          trip={trip}
          tripId={trip.id}
          tripVersion={trip.version}
          days={[buildPlannerDay()]}
          inboxActivities={[]}
          selectedActivityId={null}
          selectedPlaceId={null}
          recommendations={buildRecommendationsController()}
          selectedRecommendation={null}
          onAddActivity={() => {}}
          onSelectActivityId={() => {}}
          onSelectPlaceId={() => {}}
          onSelectRecommendation={() => {}}
          onClearMapSelection={() => {}}
        />
      </MemoryRouter>,
    )

    const budgetSection = await screen.findByTestId('planner-budget-section')
    const budgetInput = within(budgetSection).getByLabelText('Trip budget amount')
    await user.clear(budgetInput)
    await user.type(budgetInput, '3100')

    await user.click(within(budgetSection).getByRole('combobox', { name: 'Trip budget currency' }))
    await user.click(await screen.findByText('USD'))
    await user.click(within(budgetSection).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(capturedBody).toEqual({
        budget_amount: 3100,
        budget_currency: 'USD',
      }),
    )
    expect(capturedVersion).toBe(String(trip.version))
  })

  it('requests routed geometry for every visible day route', async () => {
    const originalApiKey = config.map.apiKey
    config.map.apiKey = 'test-google-maps-key'
    const trip = buildTrip()

    const routePreviewBodies: RoutePreviewInput[] = []

    server.use(
      http.post('http://localhost:8000/routes/preview', async ({ request }) => {
        const body = (await request.json()) as RoutePreviewInput
        routePreviewBodies.push(body)
        return HttpResponse.json({
          routes: [
            {
              summary: 'Preview route',
              distance_m: 1200,
              duration_min: 18,
              static_duration_min: 18,
              path: [body.origin, ...(body.waypoints ?? []), body.destination],
            },
          ],
        })
      }),
    )

    const day1Start = buildPlace({ id: 'place-day1-start', name: 'Day 1 Start', lat: 48.8566, lon: 2.3522 })
    const day1End = buildPlace({ id: 'place-day1-end', name: 'Day 1 End', lat: 48.8601, lon: 2.3412 })
    const day2Start = buildPlace({ id: 'place-day2-start', name: 'Day 2 Start', lat: 48.8738, lon: 2.2950 })
    const day2End = buildPlace({ id: 'place-day2-end', name: 'Day 2 End', lat: 48.8867, lon: 2.3431 })

    const days = [
      buildPlannerDay({
        id: 'day-1',
        day_index: 0,
        date: '2026-04-10',
        activities: [
          buildPlannerActivity({
            id: 'activity-day1-1',
            trip_day_id: 'day-1',
            order_index: 0,
            title: 'Day 1 Start',
            place_id: day1Start.id,
            place: {
              id: day1Start.id,
              name: day1Start.name,
              category: day1Start.category,
              address_text: day1Start.address_text,
              lat: day1Start.lat,
              lon: day1Start.lon,
              photo_count: day1Start.photo_count ?? 0,
              primary_photo: day1Start.primary_photo,
            },
          }),
          buildPlannerActivity({
            id: 'activity-day1-2',
            trip_day_id: 'day-1',
            order_index: 1,
            title: 'Day 1 End',
            place_id: day1End.id,
            place: {
              id: day1End.id,
              name: day1End.name,
              category: day1End.category,
              address_text: day1End.address_text,
              lat: day1End.lat,
              lon: day1End.lon,
              photo_count: day1End.photo_count ?? 0,
              primary_photo: day1End.primary_photo,
            },
          }),
        ],
      }),
      buildPlannerDay({
        id: 'day-2',
        day_index: 1,
        date: '2026-04-11',
        activities: [
          buildPlannerActivity({
            id: 'activity-day2-1',
            trip_day_id: 'day-2',
            order_index: 0,
            title: 'Day 2 Start',
            place_id: day2Start.id,
            place: {
              id: day2Start.id,
              name: day2Start.name,
              category: day2Start.category,
              address_text: day2Start.address_text,
              lat: day2Start.lat,
              lon: day2Start.lon,
              photo_count: day2Start.photo_count ?? 0,
              primary_photo: day2Start.primary_photo,
            },
          }),
          buildPlannerActivity({
            id: 'activity-day2-2',
            trip_day_id: 'day-2',
            order_index: 1,
            title: 'Day 2 End',
            place_id: day2End.id,
            place: {
              id: day2End.id,
              name: day2End.name,
              category: day2End.category,
              address_text: day2End.address_text,
              lat: day2End.lat,
              lon: day2End.lon,
              photo_count: day2End.photo_count ?? 0,
              primary_photo: day2End.primary_photo,
            },
          }),
        ],
      }),
    ]

    try {
      renderWithQueryClient(
        <MemoryRouter>
          <PlannerMapView
            trip={trip}
            tripId="trip-1"
            tripVersion={3}
            days={days}
            inboxActivities={[]}
            selectedActivityId={null}
            selectedPlaceId={null}
            recommendations={buildRecommendationsController()}
            selectedRecommendation={null}
            onAddActivity={() => {}}
            onSelectActivityId={() => {}}
            onSelectPlaceId={() => {}}
            onSelectRecommendation={() => {}}
            onClearMapSelection={() => {}}
          />
        </MemoryRouter>,
      )

      await waitFor(() => {
        expect(routePreviewBodies).toHaveLength(2)
      })

      expect(routePreviewBodies).toEqual([
        {
          origin: { lat: day1Start.lat!, lng: day1Start.lon! },
          destination: { lat: day1End.lat!, lng: day1End.lon! },
          waypoints: [],
          travel_mode: 'WALK',
          compute_alternatives: false,
        },
        {
          origin: { lat: day2Start.lat!, lng: day2Start.lon! },
          destination: { lat: day2End.lat!, lng: day2End.lon! },
          waypoints: [],
          travel_mode: 'WALK',
          compute_alternatives: false,
        },
      ])
    } finally {
      config.map.apiKey = originalApiKey
    }
  })
})
