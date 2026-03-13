import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { config } from '@/app/config'
import { setUnauthorizedHandler } from '@/shared/api/client'
import { usePlannerStore } from '@/shared/stores/planner.store'
import PlannerBoard, { resolveDragPreviewSize } from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import {
  buildActivityDiscoveryItem,
  buildPlace,
  buildPlannerActivity,
  buildPlannerDay,
  buildPlannerResponse,
  buildTrip,
  buildTripAsset,
  listResponse,
} from '@/test/fixtures/api'

async function selectDateFromPicker(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  dateLabel: RegExp,
) {
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole('button', { name: dateLabel }))
}

describe('PlannerBoard', () => {
  afterEach(() => {
    setUnauthorizedHandler(null)
  })

  it('captures the dragged card rect for the overlay preview size', () => {
    expect(
      resolveDragPreviewSize({
        active: {
          rect: {
            current: {
              initial: {
                width: 286,
                height: 142,
                top: 0,
                left: 0,
                right: 286,
                bottom: 142,
              },
              translated: null,
            },
          },
        },
      } as never),
    ).toEqual({
      width: 286,
      height: 142,
    })
  })

  it('falls back to the source card element when the dnd rect is unavailable', () => {
    const article = document.createElement('article')
    const handle = document.createElement('button')
    article.append(handle)
    document.body.append(article)

    Object.defineProperty(article, 'getBoundingClientRect', {
      value: () => ({
        width: 304,
        height: 156,
        top: 0,
        left: 0,
        right: 304,
        bottom: 156,
      }),
    })

    expect(
      resolveDragPreviewSize({
        active: {
          rect: {
            current: {
              initial: null,
              translated: null,
            },
          },
        },
        activatorEvent: new MouseEvent('pointerdown', { bubbles: true }),
      } as never),
    ).toBeNull()

    expect(
      resolveDragPreviewSize({
        active: {
          rect: {
            current: {
              initial: null,
              translated: null,
            },
          },
        },
        activatorEvent: { target: handle },
      } as never),
    ).toEqual({
      width: 304,
      height: 156,
    })

    article.remove()
  })

  it('shows auth recovery instead of the planner error when the session has expired', async () => {
    const trip = buildTrip({ id: 'trip-auth-recovery' })
    const handleUnauthorized = vi.fn(async () => {})
    setUnauthorizedHandler(handleUnauthorized)

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () =>
        HttpResponse.json(
          { error: { code: 'AUTH_INVALID_TOKEN', message: 'Invalid token' } },
          { status: 401 },
        ),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={[`/app/trips/${trip.id}/plan`]}>
        <Routes>
          <Route path="/app/trips/:tripId/plan" element={<PlannerBoard tripId={trip.id} />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(handleUnauthorized).toHaveBeenCalledOnce()
    })

    expect(screen.getByText('Redirecting to sign in...')).toBeInTheDocument()
    expect(screen.queryByText('Failed to load the planner workspace.')).not.toBeInTheDocument()
  })

  it('returns to trips when the planner trip can no longer be loaded', async () => {
    const trip = buildTrip({ id: 'trip-missing-planner' })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () =>
        HttpResponse.json(
          { error: { code: 'RESOURCE_NOT_FOUND', message: 'Trip not found' } },
          { status: 404 },
        ),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={[`/app/trips/${trip.id}/plan`]}>
        <Routes>
          <Route path="/app/trips" element={<div>Trips home</div>} />
          <Route path="/app/trips/:tripId/plan" element={<PlannerBoard tripId={trip.id} />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Trips home')).toBeInTheDocument()
    expect(screen.queryByText('Failed to load the planner workspace.')).not.toBeInTheDocument()
  })

  it('renders inbox activities separately from untimed day activities in kanban view', async () => {
    const user = userEvent.setup()
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

    await screen.findByTestId('planner-trip-hero')

    if (!screen.queryByText(inboxActivity.title)) {
      await user.click(screen.getByTestId('planner-map-day-trigger-inbox'))
    }
    if (!screen.queryByText(untimedDayActivity.title)) {
      await user.click(screen.getByTestId('planner-map-day-trigger-day-1'))
    }

    expect(await screen.findByText(inboxActivity.title)).toBeInTheDocument()
    expect(screen.getByText(untimedDayActivity.title)).toBeInTheDocument()
    expect(screen.queryByText('Untimed')).not.toBeInTheDocument()
    expect(screen.getByText('Inbox')).toBeInTheDocument()
    expect(offersRequestCount).toBe(0)
  })

  it('renders travel estimates between consecutive day activities', async () => {
    const user = userEvent.setup()
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

    await screen.findByTestId('planner-trip-hero')

    if (!screen.queryByText(firstActivity.title)) {
      await user.click(screen.getByTestId('planner-map-day-trigger-day-1'))
    }

    expect(await screen.findByText(firstActivity.title)).toBeInTheDocument()
    expect(screen.getByTestId('planner-map-travel-leg-activity-b')).toHaveTextContent(/min/i)
    expect(screen.getByTestId('planner-map-travel-leg-activity-b')).toHaveTextContent(/km/i)
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

  it('opens the standalone travel section add flow with travel preselected', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-section-travel' })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    let createPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/places/google-search', ({ request }) => {
        const query = new URL(request.url).searchParams.get('q')?.toLowerCase() ?? ''

        if (query.includes('paris')) {
          return HttpResponse.json({
            total: 1,
            limit: 6,
            offset: 0,
            items: [
              {
                place_id: 'google-paris-airport',
                label: 'Paris Airport',
                name: 'Paris Airport',
                address_text: 'Paris Airport',
                category: 'airport',
                country: 'France',
                region: 'Paris',
                lat: 48.969,
                lon: 2.441,
                timezone: 'Europe/Paris',
                metadata: {},
              },
            ],
          })
        }

        if (query.includes('lisbon')) {
          return HttpResponse.json({
            total: 1,
            limit: 6,
            offset: 0,
            items: [
              {
                place_id: 'google-lisbon-airport',
                label: 'Lisbon Airport',
                name: 'Lisbon Airport',
                address_text: 'Lisbon Airport',
                category: 'airport',
                country: 'Portugal',
                region: 'Lisbon',
                lat: 38.7756,
                lon: -9.1354,
                timezone: 'Europe/Lisbon',
                metadata: {},
              },
            ],
          })
        }

        return HttpResponse.json({
          total: 0,
          limit: 6,
          offset: 0,
          items: [],
        })
      }),
      http.post('http://localhost:8000/places', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        const externalId = String(body.external_id ?? 'manual-place')

        return HttpResponse.json(
          buildPlace({
            id: `place-${externalId}`,
            source: String(body.source ?? 'google_places'),
            external_id: externalId,
            name: String(body.name ?? 'Place'),
            address_text:
              typeof body.address_text === 'string' ? body.address_text : null,
            category: typeof body.category === 'string' ? body.category : null,
            lat: typeof body.lat === 'number' ? body.lat : null,
            lon: typeof body.lon === 'number' ? body.lon : null,
          }),
          { status: 201 },
        )
      }),
      http.post('http://localhost:8000/trips/:tripId/planner/activities', async ({ request }) => {
        createPayload = (await request.json()) as Record<string, unknown>
        const created = buildPlannerActivity({
          id: 'travel-section-activity-1',
          trip_day_id: null,
          category: 'travel',
          title: String(createPayload.title ?? 'Travel'),
          category_details: (createPayload.category_details as Record<string, unknown>) ?? {},
          place_id: null,
          place: null,
          source: 'manual',
        })
        planner.inbox_activities = [created]
        return HttpResponse.json(created, { status: 201 })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: 'Add travel' }))

    expect(screen.getByText('Create travel')).toBeInTheDocument()
    expect(screen.queryByText('Choose the itinerary activity type.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue to activity details' })).not.toBeInTheDocument()
    expect(screen.queryByText('Not assigned')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Origin address'), 'Paris Airport')
    await user.click(await screen.findByRole('button', { name: /Paris Airport/i }))
    await user.type(screen.getByLabelText('Destination address'), 'Lisbon Airport')
    await user.click(await screen.findByRole('button', { name: /Lisbon Airport/i }))

    await expect
      .poll(() => (screen.getByLabelText('Title') as HTMLInputElement).value)
      .toBe('Paris Airport to Lisbon Airport')

    await user.click(screen.getByRole('button', { name: 'Create travel' }))

    await expect.poll(() => createPayload).not.toBeNull()
    expect(createPayload).toMatchObject({
      category: 'travel',
      title: 'Paris Airport to Lisbon Airport',
      trip_day_id: null,
      start_time: '09:00',
      category_details: {
        origin_text: 'Paris Airport',
        destination_text: 'Lisbon Airport',
        travel_mode: 'flight',
        origin_place_id: 'place-google-paris-airport',
        destination_place_id: 'place-google-lisbon-airport',
      },
    })
  })

  it('opens the standalone accommodation section add flow with hotel preselected', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-section-hotel' })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    let createPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.post('http://localhost:8000/trips/:tripId/planner/activities', async ({ request }) => {
        createPayload = (await request.json()) as Record<string, unknown>
        const created = buildPlannerActivity({
          id: 'hotel-section-activity-1',
          trip_day_id: null,
          category: 'hotel',
          title: String(createPayload.title ?? 'Hotel'),
          category_details: (createPayload.category_details as Record<string, unknown>) ?? {},
          place_id: null,
          place: null,
          source: 'manual',
        })
        planner.inbox_activities = [created]
        return HttpResponse.json(created, { status: 201 })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: 'Add accommodation' }))

    expect(screen.getByText('Create accommodation')).toBeInTheDocument()
    expect(screen.queryByText('Choose the itinerary activity type.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue to activity details' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Assigned day')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Hotel name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Room type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Duration (min)')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Title'), 'Hotel Atlas')
    await user.type(screen.getByLabelText('Address'), '12 Rue de Rivoli, Paris')
    await selectDateFromPicker(user, 'Check-in date', /April 10.*2026/i)
    await selectDateFromPicker(user, 'Checkout date', /April 12.*2026/i)
    await user.click(screen.getByRole('button', { name: 'Create accommodation' }))

    await expect.poll(() => createPayload).not.toBeNull()
    expect(createPayload).toMatchObject({
      category: 'hotel',
      title: 'Hotel Atlas',
      trip_day_id: null,
    })
  })

  it('creates a manual itinerary activity from the planner drawer without hotel or travel options', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-manual-itinerary' })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    let createPayload: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/places/google-search', () =>
        HttpResponse.json({
          total: 1,
          limit: 6,
          offset: 0,
          items: [
            {
              place_id: 'google-louvre-1',
              label: 'Louvre Museum, Paris',
              name: 'Louvre Museum',
              address_text: 'Rue de Rivoli, Paris',
              category: 'museum',
              country: 'France',
              region: 'Ile-de-France',
              lat: 48.8606,
              lon: 2.3376,
              timezone: 'Europe/Paris',
              metadata: {},
            },
          ],
        }),
      ),
      http.post('http://localhost:8000/places', () =>
        HttpResponse.json(
          buildPlace({
            id: 'place-louvre-1',
            name: 'Louvre Museum',
            address_text: 'Rue de Rivoli, Paris',
            category: 'museum',
            lat: 48.8606,
            lon: 2.3376,
          }),
          { status: 201 },
        ),
      ),
      http.post('http://localhost:8000/trips/:tripId/planner/activities', async ({ request }) => {
        createPayload = (await request.json()) as Record<string, unknown>
        const created = buildPlannerActivity({
          id: 'visit-activity-1',
          trip_day_id: day.id,
          category: 'visit',
          title: String(createPayload.title ?? 'Visit'),
          category_details: (createPayload.category_details as Record<string, unknown>) ?? {},
          place_id: 'place-louvre-1',
          place: {
            id: 'place-louvre-1',
            name: 'Louvre Museum',
            address_text: 'Rue de Rivoli, Paris',
            category: 'museum',
            lat: 48.8606,
            lon: 2.3376,
            photo_count: 0,
            primary_photo: null,
          },
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

    await user.click(await screen.findByRole('button', { name: 'Add activity to Day 1' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Create itinerary activity')).toBeInTheDocument()
    expect(within(dialog).queryByText('Hotel')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Travel')).not.toBeInTheDocument()

    await user.click(within(dialog).getByText('Visit').closest('button')!)
    await user.type(
      within(dialog).getByPlaceholderText('Search Google visit places'),
      'Louvre',
    )
    await user.click(await screen.findByText('Louvre Museum'))
    await user.type(screen.getByLabelText('Description'), 'Morning museum visit')
    await user.click(screen.getByRole('button', { name: 'Create itinerary activity' }))

    await expect.poll(() => createPayload).not.toBeNull()
    expect(createPayload).toMatchObject({
      category: 'visit',
      title: 'Louvre Museum',
      description: 'Morning museum visit',
      trip_day_id: 'day-1',
      place_id: 'place-louvre-1',
    })
    expect(await screen.findByText('Louvre Museum')).toBeInTheDocument()
  })

  it('creates a manual hotel activity from the accommodation drawer', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-manual-hotel' })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    let createPayload: Record<string, unknown> | null = null
    const uploadedAssets: Array<{ activityId: string | null; filename: string }> = []

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.post('http://localhost:8000/trips/:tripId/planner/activities', async ({ request }) => {
        createPayload = (await request.json()) as Record<string, unknown>
        const created = buildPlannerActivity({
          id: 'hotel-activity-1',
          trip_day_id: null,
          category: 'hotel',
          title: String(createPayload.title ?? 'Hotel'),
          category_details: (createPayload.category_details as Record<string, unknown>) ?? {},
          place_id: null,
          place: null,
          source: 'manual',
        })
        planner.inbox_activities = [created]
        return HttpResponse.json(created, { status: 201 })
      }),
      http.post('http://localhost:8000/trips/:tripId/assets', async ({ request }) => {
        const formData = await request.formData()
        const file = formData.get('file')
        const activityId = formData.get('activity_id')
        const filename =
          file && typeof file === 'object' && 'name' in file
            ? String(file.name)
            : 'uploaded.pdf'
        const normalizedActivityId =
          typeof activityId === 'string' ? activityId : null

        uploadedAssets.push({
          activityId: normalizedActivityId,
          filename,
        })

        return HttpResponse.json(
          buildTripAsset({
            id: `asset-${uploadedAssets.length}`,
            trip_id: trip.id,
            activity_id: normalizedActivityId,
            original_filename: filename,
          }),
          { status: 201 },
        )
      }),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: 'Add accommodation' }))
    await user.type(screen.getByLabelText('Title'), 'Hotel Atlas')
    await user.type(screen.getByLabelText('Address'), '12 Rue de Rivoli, Paris')
    await selectDateFromPicker(user, 'Check-in date', /April 10.*2026/i)
    await selectDateFromPicker(user, 'Checkout date', /April 12.*2026/i)
    await user.upload(
      screen.getByLabelText('Attach files to activity'),
      new File(['voucher'], 'hotel-voucher.pdf', { type: 'application/pdf' }),
    )

    await expect
      .poll(() => (screen.getByLabelText('Title') as HTMLInputElement).value)
      .toBe('Hotel Atlas')

    await user.click(screen.getByRole('button', { name: 'Create accommodation' }))

    await expect.poll(() => createPayload).not.toBeNull()
    expect(createPayload).toMatchObject({
      category: 'hotel',
      title: 'Hotel Atlas',
      trip_day_id: null,
      category_details: {
        hotel_name: 'Hotel Atlas',
        address_text: '12 Rue de Rivoli, Paris',
        checkin_date: '2026-04-10',
        checkout_date: '2026-04-12',
        room_type: null,
        place_id: null,
      },
    })
    await expect.poll(() => uploadedAssets).toEqual([
      {
        activityId: 'hotel-activity-1',
        filename: 'hotel-voucher.pdf',
      },
    ])
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
    await user.click(screen.getByRole('combobox', { name: 'Travel mode' }))
    await user.click(await screen.findByText('Train'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await expect.poll(() => patchPayload).not.toBeNull()
    expect(patchPayload).toMatchObject({
      category: 'travel',
      category_details: {
        origin_text: 'Paris',
        destination_text: 'Lisbon',
        travel_mode: 'train',
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
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Hotel Atlas Riverside')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await expect.poll(() => patchPayload).not.toBeNull()
    expect(patchPayload).toMatchObject({
      category: 'hotel',
      title: 'Hotel Atlas Riverside',
      category_details: {
        hotel_name: 'Hotel Atlas Riverside',
        address_text: '12 Rue de Rivoli, Paris',
        checkin_date: '2026-04-10',
        checkout_date: '2026-04-12',
        room_type: null,
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
    const recommendationsSection = await screen.findByTestId('planner-recommendations-section')
    expect(recommendationsSection).toBeInTheDocument()
    expect(await within(recommendationsSection).findByText('Musee Carnavalet')).toBeInTheDocument()
    expect(within(recommendationsSection).getByRole('button', { name: 'Refresh recommendations' })).toBeInTheDocument()

    const discoverCard = within(recommendationsSection).getByText('Musee Carnavalet').closest('article')
    expect(discoverCard).not.toBeNull()
    await user.click(within(discoverCard!).getByRole('button', { name: /add/i }))
    await user.click(await screen.findByRole('menuitem', { name: /Day 1/i }))

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

  it('preserves collapsed map day accordions across remounts', async () => {
    const trip = buildTrip({ id: 'trip-map-accordion-state' })
    const activity = buildPlannerActivity({
      id: 'map-accordion-activity',
      trip_day_id: 'day-1',
      title: 'Grand Palais',
      place_id: 'place-grand-palais',
    })
    const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
    )

    const renderMapView = () =>
      renderWithQueryClient(
        <MemoryRouter initialEntries={[`/app/trips/${trip.id}/plan?view=map`]}>
          <PlannerBoard tripId={trip.id} />
        </MemoryRouter>,
      )

    const firstRender = renderMapView()

    expect(await screen.findByText('Day 1')).toBeInTheDocument()
    expect(screen.getByTestId('planner-map-day-trigger-day-1')).toHaveAttribute('data-state', 'open')

    act(() => {
      usePlannerStore.getState().setMapDayAccordionState(trip.id, { 'day-1': false })
    })

    await waitFor(() => {
      expect(usePlannerStore.getState().mapDayAccordionStateByTrip[trip.id]).toMatchObject({ 'day-1': false })
    })
    expect(screen.getByTestId('planner-map-day-trigger-day-1')).toHaveAttribute('data-state', 'closed')
    const persistedAccordionState = await Promise.resolve(
      usePlannerStore.persist.getOptions().storage?.getItem('voyager-planner-store'),
    )

    firstRender.unmount()

    act(() => {
      usePlannerStore.setState({ mapDayAccordionStateByTrip: {} })
    })
    await Promise.resolve(
      usePlannerStore.persist
        .getOptions()
        .storage?.setItem('voyager-planner-store', persistedAccordionState!),
    )
    await act(async () => {
      await usePlannerStore.persist.rehydrate()
    })

    renderMapView()

    expect(await screen.findByText('Day 1')).toBeInTheDocument()
    expect(usePlannerStore.getState().mapDayAccordionStateByTrip[trip.id]).toMatchObject({ 'day-1': false })
    expect(screen.getByTestId('planner-map-day-trigger-day-1')).toHaveAttribute('data-state', 'closed')
  })

  it('keeps map preview travel separators visible with the reordered route metrics', async () => {
    const user = userEvent.setup()
    const trip = buildTrip({ id: 'trip-map-preview-metrics', route_travel_mode: 'DRIVE' })
    const firstActivity = buildPlannerActivity({
      id: 'map-stop-a',
      trip_day_id: 'day-1',
      order_index: 0,
      title: 'Start',
      place_id: 'place-map-a',
      place: {
        id: 'place-map-a',
        name: 'Start',
        category: 'landmark',
        address_text: 'A',
        lat: 0,
        lon: 0,
        photo_count: 0,
        primary_photo: null,
      },
    })
    const secondActivity = buildPlannerActivity({
      id: 'map-stop-b',
      trip_day_id: 'day-1',
      order_index: 1,
      title: 'Second',
      place_id: 'place-map-b',
      place: {
        id: 'place-map-b',
        name: 'Second',
        category: 'landmark',
        address_text: 'B',
        lat: 0,
        lon: 2,
        photo_count: 0,
        primary_photo: null,
      },
    })
    const thirdActivity = buildPlannerActivity({
      id: 'map-stop-c',
      trip_day_id: 'day-1',
      order_index: 2,
      title: 'Third',
      place_id: 'place-map-c',
      place: {
        id: 'place-map-c',
        name: 'Third',
        category: 'landmark',
        address_text: 'C',
        lat: 0,
        lon: 1,
        photo_count: 0,
        primary_photo: null,
      },
    })
    const day = buildPlannerDay({
      id: 'day-1',
      trip_id: trip.id,
      activities: [firstActivity, secondActivity, thirdActivity],
    })
    const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
    const routeRequests: Array<{ travel_mode?: string; legs: Array<{ from_activity_id: string; to_activity_id: string }> }> = []
    let reorderedActivityIds: string[] | null = null

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId', () => HttpResponse.json(trip)),
      http.post('http://localhost:8000/routes/legs', async ({ request }) => {
        const body = (await request.json()) as {
          travel_mode?: string
          legs: Array<{ from_activity_id: string; to_activity_id: string }>
        }
        routeRequests.push(body)

        if (body.legs.length === 2) {
          return HttpResponse.json({
            items: [
              {
                from_activity_id: 'map-stop-a',
                to_activity_id: 'map-stop-b',
                distance_km: 1,
                duration_min: 14,
              },
              {
                from_activity_id: 'map-stop-b',
                to_activity_id: 'map-stop-c',
                distance_km: 0.8,
                duration_min: 11,
              },
            ],
          })
        }

        return HttpResponse.json({
          items: [
            {
              from_activity_id: 'map-stop-a',
              to_activity_id: 'map-stop-b',
              distance_km: 1,
              duration_min: 14,
            },
            {
              from_activity_id: 'map-stop-a',
              to_activity_id: 'map-stop-c',
              distance_km: 0.4,
              duration_min: 5,
            },
            {
              from_activity_id: 'map-stop-b',
              to_activity_id: 'map-stop-a',
              distance_km: 1.1,
              duration_min: 16,
            },
            {
              from_activity_id: 'map-stop-b',
              to_activity_id: 'map-stop-c',
              distance_km: 0.8,
              duration_min: 11,
            },
            {
              from_activity_id: 'map-stop-c',
              to_activity_id: 'map-stop-a',
              distance_km: 0.5,
              duration_min: 7,
            },
            {
              from_activity_id: 'map-stop-c',
              to_activity_id: 'map-stop-b',
              distance_km: 0.5,
              duration_min: 6,
            },
          ],
        })
      }),
      http.post('http://localhost:8000/days/:dayId/activities/reorder', async ({ request }) => {
        const body = (await request.json()) as {
          items: Array<{ activity_id: string; order_index: number }>
        }
        reorderedActivityIds = body.items.map((item) => item.activity_id)
        return HttpResponse.json(listResponse([]))
      }),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={[`/app/trips/${trip.id}/plan?view=map`]}>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Day 1')).toBeInTheDocument()
    expect(screen.getByTestId('planner-map-day-trigger-day-1')).toHaveAttribute('data-state', 'open')
    expect(await screen.findByTestId('planner-map-travel-leg-map-stop-b')).toHaveTextContent('14 min')
    expect(screen.getByTestId('planner-map-travel-leg-map-stop-b')).toHaveTextContent('1 km')

    await user.click(screen.getByRole('button', { name: 'Optimise itinerary' }))

    expect(await screen.findByText('Voyager found a shorter driving order for this day.')).toBeInTheDocument()
    expect(screen.getByTestId('planner-map-travel-leg-map-stop-c')).toHaveTextContent('5 min')
    expect(screen.getByTestId('planner-map-travel-leg-map-stop-c')).toHaveTextContent('0.4 km')
    expect(screen.getByTestId('planner-map-travel-leg-map-stop-b')).toHaveTextContent('6 min')
    expect(screen.getByTestId('planner-map-travel-leg-map-stop-b')).toHaveTextContent('0.5 km')

    await waitFor(() => {
      expect(routeRequests[routeRequests.length - 1]?.travel_mode).toBe('DRIVE')
    })

    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(reorderedActivityIds).toEqual(['map-stop-a', 'map-stop-c', 'map-stop-b'])
    })
    expect(screen.getByTestId('planner-map-day-trigger-day-1')).toHaveAttribute('data-state', 'open')
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

  it('seeds the map focus and search origin from the destination query params', async () => {
    const user = userEvent.setup()
    const originalMapApiKey = config.map.apiKey
    const googleMapStub = (
      globalThis as unknown as {
        __voyagerGoogleMapStub: {
          panTo: {
            mockClear: () => void
            mock: { calls: Array<[point: { lat: number; lng: number }]> }
          }
        }
      }
    ).__voyagerGoogleMapStub
    config.map.apiKey = 'test-key'
    googleMapStub.panTo.mockClear()

    try {
      const trip = buildTrip({ id: 'trip-seeded-map-search' })
      const day = buildPlannerDay({ id: 'day-1', trip_id: trip.id, activities: [] })
      const planner = buildPlannerResponse({ trip, days: [day], inbox_activities: [] })
      const destinationPlace = buildPlace({
        id: 'place-reykjavik',
        name: 'Reykjavik',
        address_text: 'Reykjavik, Iceland',
        lat: 64.1466,
        lon: -21.9426,
      })
      const searchRequestCoords: Array<{ lat: number; lon: number }> = []

      server.use(
        http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
        http.get('http://localhost:8000/places/:placeId', () => HttpResponse.json(destinationPlace)),
        http.get('http://localhost:8000/trips/:tripId/planner-map/places/:placeId/detail', () =>
          HttpResponse.json({
            place: destinationPlace,
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
        http.get('http://localhost:8000/places/search', () =>
          HttpResponse.json(listResponse([])),
        ),
        http.get('http://localhost:8000/places/google-search', ({ request }) => {
          const url = new URL(request.url)
          searchRequestCoords.push({
            lat: Number(url.searchParams.get('lat')),
            lon: Number(url.searchParams.get('lon')),
          })

          return HttpResponse.json({
            total: 0,
            limit: 6,
            offset: 0,
            items: [],
          })
        }),
      )

      renderWithQueryClient(
        <MemoryRouter
          initialEntries={[
            `/app/trips/${trip.id}/plan?placeId=${destinationPlace.id}&lat=${destinationPlace.lat}&lng=${destinationPlace.lon}`,
          ]}
        >
          <PlannerBoard tripId={trip.id} />
        </MemoryRouter>,
      )

      expect(await screen.findByText('Day 1')).toBeInTheDocument()

      await waitFor(() => expect(googleMapStub.panTo.mock.calls.length).toBeGreaterThan(0))
      const panCalls = googleMapStub.panTo.mock.calls
      const panPoint = panCalls[panCalls.length - 1]?.[0]
      expect(panPoint).toBeDefined()
      expect(panPoint!.lat).toBeCloseTo(destinationPlace.lat! - 0.018, 4)
      expect(panPoint!.lng).toBeCloseTo(destinationPlace.lon!, 4)

      await user.click(screen.getByTestId('planner-map-search-trigger'))
      const searchInput = await screen.findByPlaceholderText('Search a place')
      await user.type(searchInput, 'coffee')

      await waitFor(() => expect(searchRequestCoords.length).toBeGreaterThan(0))
      const lastSearchRequest = searchRequestCoords[searchRequestCoords.length - 1]
      expect(lastSearchRequest?.lat).toBeCloseTo(destinationPlace.lat!, 4)
      expect(lastSearchRequest?.lon).toBeCloseTo(destinationPlace.lon!, 4)
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
