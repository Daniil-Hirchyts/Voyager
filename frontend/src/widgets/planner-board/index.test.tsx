import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { config } from '@/app/config'
import PlannerBoard from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import {
  buildActivityDiscoveryItem,
  buildPlace,
  buildPlannerActivity,
  buildPlannerDay,
  buildPlannerResponse,
  buildTrip,
  listResponse,
} from '@/test/fixtures/api'

describe('PlannerBoard', () => {
  it('renders inbox activities separately from untimed day activities in kanban view', async () => {
    const trip = buildTrip()
    const inboxActivity = buildPlannerActivity({
      id: 'planner-activity-inbox',
      title: 'Inbox museum shortlist',
      trip_day_id: null,
      start_time: null,
    })
    const untimedDayActivity = buildPlannerActivity({
      id: 'planner-activity-untimed',
      title: 'Flexible coffee stop',
      trip_day_id: 'day-1',
      start_time: null,
      duration_min: 45,
    })
    const day = buildPlannerDay({ activities: [untimedDayActivity] })
    const planner = buildPlannerResponse({ trip, inbox_activities: [inboxActivity], days: [day] })
    let offersRequestCount = 0

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/offers', () => {
        offersRequestCount += 1
        return HttpResponse.json(listResponse([]))
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText(inboxActivity.title)).toBeInTheDocument()
    expect(screen.getByText(untimedDayActivity.title)).toBeInTheDocument()
    expect(screen.queryByText('Untimed')).not.toBeInTheDocument()
    expect(screen.getByText('Inbox')).toBeInTheDocument()
    expect(offersRequestCount).toBe(0)
  })

  it('renders travel estimates between consecutive day activities', async () => {
    const trip = buildTrip()
    const firstActivity = buildPlannerActivity({
      id: 'activity-a',
      title: 'Old Town Square',
      trip_day_id: 'day-1',
      order_index: 0,
      place_id: 'place-a',
      place: {
        id: 'place-a',
        name: 'Old Town Square',
        category: 'landmark',
        address_text: 'Prague Old Town',
        lat: 50.087,
        lon: 14.4208,
        photo_count: 0,
        primary_photo: null,
      },
    })
    const secondActivity = buildPlannerActivity({
      id: 'activity-b',
      title: 'Charles Bridge',
      trip_day_id: 'day-1',
      order_index: 1,
      place_id: 'place-b',
      place: {
        id: 'place-b',
        name: 'Charles Bridge',
        category: 'landmark',
        address_text: 'Prague 1',
        lat: 50.0865,
        lon: 14.4114,
        photo_count: 0,
        primary_photo: null,
      },
    })
    const day = buildPlannerDay({ id: 'day-1', activities: [firstActivity, secondActivity] })
    const planner = buildPlannerResponse({ trip, days: [day] })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText(firstActivity.title)).toBeInTheDocument()
    expect(screen.getByTestId('planner-travel-leg-activity-b')).toHaveTextContent(/min/i)
    expect(screen.getByTestId('planner-travel-leg-activity-b')).toHaveTextContent(/km/i)
    expect(screen.getByTestId('planner-day-travel-summary-day-1')).toHaveTextContent(/km/i)
  })

  it('opens the activity details drawer when a card is clicked', async () => {
    const trip = buildTrip()
    const activity = buildPlannerActivity({
      id: 'planner-activity-details',
      title: 'Seine riverside walk',
      notes: 'Golden hour is best here.',
    })
    const day = buildPlannerDay({ activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day] })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    await userEvent.click((await screen.findAllByRole('button', { name: activity.title }))[0])

    expect(await screen.findByRole('dialog', { name: activity.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit activity' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete activity' })).toBeInTheDocument()
  })

  it('creates a manual travel activity from the planner drawer', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-manual-travel' })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    let createPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.post('http://localhost:8000/trips/:tripId/planner/activities', async ({ request }) => {
        createPayload = (await request.json()) as Record<string, unknown>
        const created = buildPlannerActivity({
          id: 'travel-activity-1',
          trip_day_id: day.id,
          category: 'travel',
          title: String(createPayload.title ?? 'Travel'),
          category_details: (createPayload.category_details as Record<string, unknown>) ?? {},
          place_id: null,
          place: null,
          source: 'manual',
        })
        planner.days[0] = { ...planner.days[0], activities: [created] }
        return HttpResponse.json(created, { status: 201 })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    await user.click((await screen.findAllByRole('button', { name: 'Add activity' }))[0])
    await user.click(screen.getByText('Travel').closest('button')!)
    await user.click(screen.getByRole('button', { name: 'Continue to activity details' }))
    await user.type(screen.getByLabelText('Origin'), 'Paris')
    await user.type(screen.getByLabelText('Destination'), 'Lisbon')
    await user.type(screen.getByLabelText('Travel mode'), 'Flight')

    await expect
      .poll(() => (screen.getByLabelText('Title') as HTMLInputElement).value)
      .toBe('Paris to Lisbon')

    await user.click(screen.getByRole('button', { name: 'Create activity' }))

    await expect.poll(() => createPayload).not.toBeNull()
    expect(createPayload).toMatchObject({
      category: 'travel',
      title: 'Paris to Lisbon',
      category_details: {
        origin_text: 'Paris',
        destination_text: 'Lisbon',
        travel_mode: 'Flight',
        origin_place_id: null,
        destination_place_id: null,
      },
      place_id: null,
    })
    expect(await screen.findByText('Paris to Lisbon')).toBeInTheDocument()
  })

  it('creates a manual hotel activity from the planner drawer', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-manual-hotel' })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    let createPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.post('http://localhost:8000/trips/:tripId/planner/activities', async ({ request }) => {
        createPayload = (await request.json()) as Record<string, unknown>
        const created = buildPlannerActivity({
          id: 'hotel-activity-1',
          trip_day_id: day.id,
          category: 'hotel',
          title: String(createPayload.title ?? 'Hotel'),
          category_details: (createPayload.category_details as Record<string, unknown>) ?? {},
          place_id: null,
          place: null,
          source: 'manual',
        })
        planner.days[0] = { ...planner.days[0], activities: [created] }
        return HttpResponse.json(created, { status: 201 })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    await user.click((await screen.findAllByRole('button', { name: 'Add activity' }))[0])
    await user.click(screen.getByText('Hotel').closest('button')!)
    await user.click(screen.getByRole('button', { name: 'Continue to activity details' }))
    await user.type(screen.getByLabelText('Hotel name'), 'Hotel Atlas')
    await user.type(screen.getByLabelText('Address'), '12 Rue de Rivoli, Paris')
    await user.type(screen.getByLabelText('Check-in date'), '2026-04-10')
    await user.type(screen.getByLabelText('Checkout date'), '2026-04-12')
    await user.type(screen.getByLabelText('Room type'), 'Deluxe suite')

    await expect
      .poll(() => (screen.getByLabelText('Title') as HTMLInputElement).value)
      .toBe('Hotel Atlas')

    await user.click(screen.getByRole('button', { name: 'Create activity' }))

    await expect.poll(() => createPayload).not.toBeNull()
    expect(createPayload).toMatchObject({
      category: 'hotel',
      title: 'Hotel Atlas',
      category_details: {
        hotel_name: 'Hotel Atlas',
        address_text: '12 Rue de Rivoli, Paris',
        checkin_date: '2026-04-10',
        checkout_date: '2026-04-12',
        room_type: 'Deluxe suite',
        place_id: null,
      },
    })
    expect(await screen.findByText('Hotel Atlas')).toBeInTheDocument()
  })

  it('round-trips manual travel edits without offer linkage', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-edit-travel' })
    const activity = buildPlannerActivity({
      id: 'travel-edit-1',
      title: 'Paris to Lisbon',
      category: 'travel',
      category_details: {
        origin_text: 'Paris',
        destination_text: 'Lisbon',
        travel_mode: 'Flight',
      },
      place_id: null,
      place: null,
      source: 'manual',
    })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    let patchPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.patch('http://localhost:8000/activities/:activityId', async ({ request }) => {
        patchPayload = (await request.json()) as Record<string, unknown>
        planner.days[0] = {
          ...planner.days[0],
          activities: [
            buildPlannerActivity({
              ...activity,
              title: String(patchPayload.title ?? activity.title),
              category: 'travel',
              category_details:
                (patchPayload.category_details as Record<string, unknown>) ??
                activity.category_details,
              place_id: null,
              place: null,
              source: 'manual',
            }),
          ],
        }
        return HttpResponse.json(planner.days[0].activities[0])
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    await user.click((await screen.findAllByRole('button', { name: activity.title }))[0])
    await user.click(await screen.findByRole('button', { name: 'Edit activity' }))
    await user.clear(screen.getByLabelText('Travel mode'))
    await user.type(screen.getByLabelText('Travel mode'), 'Train')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await expect.poll(() => patchPayload).not.toBeNull()
    expect(patchPayload).toMatchObject({
      category: 'travel',
      category_details: {
        origin_text: 'Paris',
        destination_text: 'Lisbon',
        travel_mode: 'Train',
      },
      place_id: null,
    })
  })

  it('round-trips manual hotel edits without offer linkage', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-edit-hotel' })
    const activity = buildPlannerActivity({
      id: 'hotel-edit-1',
      title: 'Hotel Atlas',
      category: 'hotel',
      category_details: {
        hotel_name: 'Hotel Atlas',
        address_text: '12 Rue de Rivoli, Paris',
        checkin_date: '2026-04-10',
        checkout_date: '2026-04-12',
        room_type: 'Standard room',
      },
      place_id: null,
      place: null,
      source: 'manual',
    })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    let patchPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.patch('http://localhost:8000/activities/:activityId', async ({ request }) => {
        patchPayload = (await request.json()) as Record<string, unknown>
        planner.days[0] = {
          ...planner.days[0],
          activities: [
            buildPlannerActivity({
              ...activity,
              title: String(patchPayload.title ?? activity.title),
              category: 'hotel',
              category_details:
                (patchPayload.category_details as Record<string, unknown>) ??
                activity.category_details,
              place_id: null,
              place: null,
              source: 'manual',
            }),
          ],
        }
        return HttpResponse.json(planner.days[0].activities[0])
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    await user.click((await screen.findAllByRole('button', { name: activity.title }))[0])
    await user.click(await screen.findByRole('button', { name: 'Edit activity' }))
    await user.clear(screen.getByLabelText('Room type'))
    await user.type(screen.getByLabelText('Room type'), 'Deluxe suite')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await expect.poll(() => patchPayload).not.toBeNull()
    expect(patchPayload).toMatchObject({
      category: 'hotel',
      category_details: {
        hotel_name: 'Hotel Atlas',
        address_text: '12 Rue de Rivoli, Paris',
        checkin_date: '2026-04-10',
        checkout_date: '2026-04-12',
        room_type: 'Deluxe suite',
        place_id: null,
      },
    })
  })

  it('opens the recommendation drawer and adds a live discovery item after choosing a day', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-recommendations' })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    const discoverItem = buildActivityDiscoveryItem({
      id: 'discover-1',
      snapshot_id: null,
      provider_ref: 'tripadvisor-discover-1',
      title: 'Musee Carnavalet',
    })
    let saveCalls = 0
    let attachCalls = 0

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/activities/discover', () =>
        HttpResponse.json({
          total: 1,
          limit: 6,
          offset: 0,
          page: 1,
          entity_type: 'attraction',
          items: [discoverItem],
        }),
      ),
      http.get('http://localhost:8000/trips/:tripId/activities', () =>
        HttpResponse.json(listResponse([])),
      ),
      http.post('http://localhost:8000/trips/:tripId/activities/save', () => {
        saveCalls += 1
        return HttpResponse.json(
          buildActivityDiscoveryItem({
            ...discoverItem,
            id: 'snapshot-discover-1',
            snapshot_id: 'snapshot-discover-1',
          }),
          { status: 201 },
        )
      }),
      http.post('http://localhost:8000/trips/:tripId/activities/:snapshotId/attach-day', () => {
        attachCalls += 1
        return HttpResponse.json(buildPlannerActivity({ event_snapshot_id: 'snapshot-discover-1' }))
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(screen.queryByTestId('planner-recommendations-sheet')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Recommendations' }))

    expect(await screen.findByTestId('planner-recommendations-sheet')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Discover' })).toBeInTheDocument()
    expect(screen.getByText('Musee Carnavalet')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Saved fits' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText(/tripadvisor/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    expect(screen.queryByText('Refresh')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh recommendations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close recommendations' })).toBeInTheDocument()

    const discoverCard = screen.getByText('Musee Carnavalet').closest('article')
    expect(discoverCard).not.toBeNull()
    await user.click(within(discoverCard!).getByRole('button', { name: /add/i }))
    await user.click(await screen.findByText('Friday, Apr 10'))

    await expect.poll(() => saveCalls).toBe(1)
    await expect.poll(() => attachCalls).toBe(1)
  })

  it('keeps the recommendation sheet closed by default in map view', async () => {
    const trip = buildTrip({ id: 'trip-map-recommendations' })
    const activity = buildPlannerActivity({
      id: 'map-activity-1',
      trip_day_id: 'day-1',
      title: 'Grand Palais',
      place_id: 'place-grand-palais',
    })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/activities/discover', () =>
        HttpResponse.json({
          total: 1,
          limit: 6,
          offset: 0,
          page: 1,
          entity_type: 'attraction',
          items: [buildActivityDiscoveryItem({ title: 'Musee Rodin' })],
        }),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter
        initialEntries={[
          '/app/trips/trip-map-recommendations/plan?view=map&activityId=map-activity-1&placeId=place-grand-palais',
        ]}
      >
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Day 1')).toBeInTheDocument()
    expect(screen.queryByTestId('planner-recommendations-sheet')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens map search and layers controls accessibly and uses the bottom sheet for saved marker details', async () => {
    const user = userEvent.setup()
    const originalMapApiKey = config.map.apiKey
    config.map.apiKey = 'test-key'

    try {
      const trip = buildTrip({ id: 'trip-map-controls' })
      const place = buildPlace({
        id: 'place-grand-palais',
        source: 'google_places',
        external_id: 'google-place-grand-palais',
        name: 'Grand Palais',
        category: 'museum',
        address_text: '3 Av. du Général Eisenhower, Paris',
        lat: 48.8661,
        lon: 2.3125,
        metadata: { google_place_id: 'google-place-grand-palais' },
      })
      const activity = buildPlannerActivity({
        id: 'map-activity-grand-palais',
        trip_day_id: 'day-1',
        title: 'Grand Palais',
        place_id: place.id,
        place: {
          id: place.id,
          name: place.name,
          category: place.category,
          address_text: place.address_text,
          lat: place.lat,
          lon: place.lon,
          photo_count: place.photo_count,
          primary_photo: place.primary_photo,
        },
      })
      const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [activity] })
      const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })

      server.use(
        http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
        http.get('http://localhost:8000/places/:placeId', () => HttpResponse.json(place)),
        http.get('http://localhost:8000/trips/:tripId/planner-map/places/:placeId/detail', () =>
          HttpResponse.json({
            place,
            summary: 'Cached Voyager summary',
            rating: 4.2,
            review_count: 88,
            status_text: 'Open now',
            price_label: '$$',
            photos: [],
            reviews: [],
            hours: [],
            booking_links: [],
            tags: ['Museum'],
            mentions: [],
            related_activities: [
              {
                activity_id: activity.id,
                trip_day_id: activity.trip_day_id,
                order_index: activity.order_index,
                title: activity.title,
                category: activity.category,
                visited_at: null,
              },
            ],
          }),
        ),
        http.get('http://localhost:8000/places/google/:placeId/detail', () =>
          HttpResponse.json({
            place: {
              place_id: 'google-place-grand-palais',
              label: place.address_text,
              name: place.name,
              address_text: place.address_text,
              category: place.category,
              country: 'France',
              region: 'Ile-de-France',
              lat: place.lat,
              lon: place.lon,
              timezone: 'Europe/Paris',
              metadata: {
                google_maps_uri: 'https://maps.google.com/?cid=grand-palais',
                website_uri: 'https://www.grandpalais.fr',
              },
            },
            summary: 'Fresh Google summary for Grand Palais.',
            rating: 4.8,
            review_count: 1204,
            status_text: 'Open now',
            price_label: '$$',
            photos: [
              {
                image_url: 'https://images.example.com/grand-palais.jpg',
                thumbnail_url: 'https://images.example.com/grand-palais-thumb.jpg',
                width: 1600,
                height: 1000,
                caption: 'Facade',
              },
            ],
            reviews: [],
            hours: [{ day: 'Monday', times: [{ open: '10:00 AM - 8:00 PM', close: null }] }],
            booking_links: [{ label: 'Website', url: 'https://www.grandpalais.fr' }],
            tags: ['Museum', 'Art Gallery'],
            mentions: [{ label: 'Google Maps', url: 'https://maps.google.com/?cid=grand-palais' }],
          }),
        ),
      )

      renderWithQueryClient(
        <MemoryRouter initialEntries={[`/app/trips/${trip.id}/plan?view=map`]}>
          <PlannerBoard tripId={trip.id} />
        </MemoryRouter>,
      )

      expect(await screen.findByText('Day 1')).toBeInTheDocument()

      await user.click(screen.getByTestId('planner-map-search-trigger'))
      expect(await screen.findByPlaceholderText('Search a place')).toBeInTheDocument()
      await user.keyboard('{Escape}')

      const layersTrigger = screen.getByTestId('planner-map-layers-trigger')
      layersTrigger.focus()
      await user.keyboard('{Enter}')
      expect(await screen.findByText('Categories')).toBeInTheDocument()

      const marker = screen
        .getAllByTestId('google-advanced-marker-stub')
        .find((element) => element.getAttribute('aria-label') === 'Grand Palais')
      expect(marker).toBeDefined()

      await user.click(marker!)
      const detailSheet = await screen.findByTestId('planner-map-detail-sheet')
      expect(detailSheet).toBeInTheDocument()
      expect(screen.getByTestId('planner-map-container')).toContainElement(detailSheet)
      expect(screen.getByText('Fresh Google summary for Grand Palais.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    } finally {
      config.map.apiKey = originalMapApiKey
    }
  })

  it('opens the map bottom sheet with live Google detail for search results', async () => {
    const user = userEvent.setup()
    const originalMapApiKey = config.map.apiKey
    config.map.apiKey = 'test-key'

    try {
      const trip = buildTrip({ id: 'trip-map-google-search' })
      const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [] })
      const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
      let createdPlaceCalls = 0
      let addedTripDayId: string | null | undefined

      server.use(
        http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
        http.get('http://localhost:8000/places/search', () =>
          HttpResponse.json(listResponse([])),
        ),
        http.get('http://localhost:8000/places/google-search', () =>
          HttpResponse.json({
            total: 1,
            limit: 6,
            offset: 0,
            items: [
              {
                place_id: 'google-basilica-1',
                label: 'Basilique Saint-Jean-de-Latran, Rome',
                name: 'Basilique Saint-Jean-de-Latran',
                address_text: 'P.za San Giovanni In Laterano, Rome',
                category: 'church',
                country: 'Italy',
                region: 'Lazio',
                lat: 41.8862,
                lon: 12.5052,
                timezone: 'Europe/Rome',
                metadata: {
                  google_maps_uri: 'https://maps.google.com/?cid=basilica',
                },
              },
            ],
          }),
        ),
        http.get('http://localhost:8000/places/google/:placeId/detail', () =>
          HttpResponse.json({
            place: {
              place_id: 'google-basilica-1',
              label: 'Basilique Saint-Jean-de-Latran, Rome',
              name: 'Basilique Saint-Jean-de-Latran',
              address_text: 'P.za San Giovanni In Laterano, Rome',
              category: 'church',
              country: 'Italy',
              region: 'Lazio',
              lat: 41.8862,
              lon: 12.5052,
              timezone: 'Europe/Rome',
              metadata: {
                google_maps_uri: 'https://maps.google.com/?cid=basilica',
              },
            },
            summary: 'Historic cathedral of Rome with extensive basilica interiors.',
            rating: 4.8,
            review_count: 32447,
            status_text: 'Open now',
            price_label: null,
            photos: [
              {
                image_url:
                  '/places/google-photo-asset?name=places%2Fgoogle-basilica-1%2Fphotos%2Fphoto-1&max_width_px=1600',
                thumbnail_url:
                  '/places/google-photo-asset?name=places%2Fgoogle-basilica-1%2Fphotos%2Fphoto-1&max_width_px=480',
                width: 1400,
                height: 900,
                caption: 'Facade',
              },
            ],
            reviews: [],
            hours: [],
            booking_links: [{ label: 'Google Maps', url: 'https://maps.google.com/?cid=basilica' }],
            tags: ['Church', 'Landmark'],
            mentions: [{ label: 'Google Maps', url: 'https://maps.google.com/?cid=basilica' }],
          }),
        ),
        http.post('http://localhost:8000/places', () => {
          createdPlaceCalls += 1
          return HttpResponse.json(
            buildPlace({
              id: 'place-basilica-1',
              source: 'google_places',
              external_id: 'google-basilica-1',
              name: 'Basilique Saint-Jean-de-Latran',
              category: 'church',
              address_text: 'P.za San Giovanni In Laterano, Rome',
              lat: 41.8862,
              lon: 12.5052,
              metadata: { google_place_id: 'google-basilica-1' },
            }),
            { status: 201 },
          )
        }),
        http.get('http://localhost:8000/trips/:tripId/planner-map/places/:placeId/detail', () =>
          HttpResponse.json({
            place: buildPlace({
              id: 'place-basilica-1',
              source: 'google_places',
              external_id: 'google-basilica-1',
              name: 'Basilique Saint-Jean-de-Latran',
              category: 'church',
              address_text: 'P.za San Giovanni In Laterano, Rome',
              lat: 41.8862,
              lon: 12.5052,
              metadata: { google_place_id: 'google-basilica-1' },
            }),
            summary: null,
            rating: null,
            review_count: null,
            status_text: null,
            price_label: null,
            photos: [],
            reviews: [],
            hours: [],
            booking_links: [],
            tags: [],
            mentions: [],
            related_activities: [],
          }),
        ),
        http.post('http://localhost:8000/trips/:tripId/planner/activities', async ({ request }) => {
          const body = (await request.json()) as { trip_day_id?: string | null }
          addedTripDayId = body.trip_day_id ?? null
          return HttpResponse.json(
            buildPlannerActivity({
              id: 'planner-activity-basilica-1',
              trip_day_id: body.trip_day_id ?? null,
              title: 'Basilique Saint-Jean-de-Latran',
              place_id: 'place-basilica-1',
            }),
            { status: 201 },
          )
        }),
      )

      renderWithQueryClient(
        <MemoryRouter initialEntries={[`/app/trips/${trip.id}/plan?view=map`]}>
          <PlannerBoard tripId={trip.id} />
        </MemoryRouter>,
      )

      expect(await screen.findByText('Day 1')).toBeInTheDocument()

      await user.click(screen.getByTestId('planner-map-search-trigger'))
      const searchInput = await screen.findByPlaceholderText('Search a place')
      await user.type(searchInput, 'Lateran')
      await user.click(await screen.findByRole('button', { name: /Basilique Saint-Jean-de-Latran/i }))

      const detailSheet = await screen.findByTestId('planner-map-detail-sheet')
      expect(detailSheet).toBeInTheDocument()
      expect(screen.getByTestId('planner-map-container')).toContainElement(detailSheet)
      expect(
        screen.getByText('Historic cathedral of Rome with extensive basilica interiors.'),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add to trip' })).toBeInTheDocument()

      const heroImage = screen.getByAltText('Basilique Saint-Jean-de-Latran') as HTMLImageElement
      expect(heroImage.src).toContain('http://localhost:8000/places/google-photo-asset')

      await user.click(screen.getByRole('button', { name: 'Add to trip' }))
      const destinationMenu = await screen.findByRole('menu')
      expect(within(destinationMenu).getByText('Where should this go?')).toBeInTheDocument()
      await user.click(within(destinationMenu).getByText('Inbox'))

      await expect.poll(() => createdPlaceCalls).toBe(1)
      await expect.poll(() => addedTripDayId).toBeNull()
    } finally {
      config.map.apiKey = originalMapApiKey
    }
  })
})
