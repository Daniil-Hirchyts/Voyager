import { expect, test } from '@playwright/test'

test('opens from a planner day with prefilled fields and sends trip_day_id in search payloads', async ({ page }) => {
  let searchPayload: Record<string, unknown> | null = null

  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({
      json: {
        id: 'trip-e2e',
        user_id: 'user-1',
        title: 'Madrid Sprint',
        destination_text: 'Madrid, Spain',
        start_date: '2026-04-10',
        end_date: '2026-04-12',
        budget_amount: '1200.00',
        budget_currency: 'EUR',
        trip_type: 'city_break',
        preferences: [],
        version: 1,
        created_at: '2026-03-06T09:00:00.000Z',
        updated_at: '2026-03-06T09:00:00.000Z',
      },
    })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({
      json: {
        total: 2,
        limit: 2,
        offset: 0,
        items: [
          {
            id: 'day-1',
            trip_id: 'trip-e2e',
            day_index: 0,
            date: '2026-04-10',
            notes: null,
            created_at: '2026-03-06T09:00:00.000Z',
            updated_at: '2026-03-06T09:00:00.000Z',
          },
          {
            id: 'day-2',
            trip_id: 'trip-e2e',
            day_index: 1,
            date: '2026-04-11',
            notes: null,
            created_at: '2026-03-06T09:00:00.000Z',
            updated_at: '2026-03-06T09:00:00.000Z',
          },
        ],
      },
    })
  })
  await page.route('**/trips/trip-e2e/offers?**', async (route) => {
    await route.fulfill({
      json: {
        total: 1,
        limit: 1,
        offset: 0,
        items: [
          {
            id: 'offer-prior',
            kind: 'transport',
            trip_id: 'trip-e2e',
            trip_day_id: 'day-1',
            provider: 'amadeus_transport',
            title: 'Air France 1148',
            price_amount: '189.90',
            currency: 'EUR',
            deep_link: 'https://provider.example.com/offer-prior',
            expires_at: '2026-03-06T18:00:00.000Z',
            is_current: true,
            superseded_by_offer_id: null,
            created_at: '2026-03-06T09:00:00.000Z',
            updated_at: '2026-03-06T09:00:00.000Z',
            transport_mode: 'flight',
            origin_text: 'ORY',
            destination_text: 'MAD',
            depart_at: '2026-04-10T07:00:00.000Z',
            arrive_at: '2026-04-10T09:10:00.000Z',
            location_text: null,
            lodging_type: null,
            room_type: null,
            checkin_date: null,
            checkout_date: null,
            nights: null,
            transport_details: {
              segments: [],
              layovers: [],
              stops_count: 0,
              total_duration_min: 130,
              cabin: 'ECONOMY',
              baggage_summary: '1 checked bag',
              validating_airline_codes: ['AF'],
              bookable_seats: 4,
              additional_baggage_price: '35.00',
              additional_baggage_currency: 'EUR',
              emissions_kg: '113',
              emissions_description: '+8% emissions',
              origin_geo: { latitude: 48.7285, longitude: 2.3592 },
              destination_geo: { latitude: 40.4722, longitude: -3.5609 },
            },
            lodging_details: null,
          },
        ],
      },
    })
  })
  await page.route('**/offers/transport/search', async (route) => {
    searchPayload = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ json: { job_id: 'job-flight-search' } })
  })
  await page.route('**/jobs/job-flight-search', async (route) => {
    await route.fulfill({
      json: {
        id: 'job-flight-search',
        user_id: 'user-1',
        job_type: 'offers.transport.search',
        status: 'SUCCEEDED',
        payload: {},
        result: {},
        error: null,
        attempts: 1,
        max_attempts: 3,
        available_at: '2026-03-06T09:00:00.000Z',
        dead_lettered_at: null,
        created_at: '2026-03-06T09:00:00.000Z',
        started_at: '2026-03-06T09:00:00.000Z',
        finished_at: '2026-03-06T09:00:00.000Z',
      },
    })
  })

  await page.goto('/phase34-offers-harness.html?dayId=day-1')

  await expect(page.getByLabel('Origin')).toHaveValue('ORY')
  await expect(page.getByLabel('Destination')).toHaveValue('MAD')
  await expect(page.getByLabel('Depart')).toContainText('Apr 10, 2026')
  await expect(page.getByLabel('Return')).toContainText('Apr 11, 2026')

  await page.getByRole('button', { name: /search flights/i }).click()

  await expect.poll(() => searchPayload?.trip_day_id).toBe('day-1')
})

test('shows hotel detail with map fallback, auto-refreshes empty photos, and attaches to a day', async ({ page }) => {
  let offerState = {
    id: 'hotel-1',
    kind: 'lodging',
    trip_id: 'trip-e2e',
    trip_day_id: null,
    provider: 'amadeus_lodging',
    title: 'Hotel du Louvre',
    price_amount: '420.00',
    currency: 'EUR',
    deep_link: 'https://provider.example.com/hotel',
    expires_at: '2026-03-06T18:00:00.000Z',
    is_current: true,
    superseded_by_offer_id: null,
    created_at: '2026-03-06T09:00:00.000Z',
    updated_at: '2026-03-06T09:00:00.000Z',
    transport_mode: null,
    origin_text: null,
    destination_text: null,
    depart_at: null,
    arrive_at: null,
    location_text: 'Paris, France',
    lodging_type: 'hotel',
    room_type: 'Deluxe king room',
    checkin_date: '2026-04-10',
    checkout_date: '2026-04-12',
    nights: 2,
    transport_details: null,
    lodging_details: {
      hotel_id: 'H1',
      hotel_name: 'Hotel du Louvre',
      chain_code: 'HL',
      brand: 'Voyager Collection',
      star_rating: 4.7,
      sentiment_rating: 87.4,
      amenities: ['wifi', 'breakfast'],
      address_text: '12 Rue de Rivoli, Paris',
      latitude: 48.8606,
      longitude: 2.3376,
      distance_km: 0.8,
      room_description: 'Deluxe king room with courtyard view',
      payment_type: 'Guarantee required',
      cancellation_summary: 'Free cancellation before Apr 8',
      nightly_rate_amount: '210.00',
      taxes_amount: '28.00',
      place_id: 'place-1',
      photo_count: 0,
      primary_photo: null,
    },
  }
  let photoRefreshCalls = 0

  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({
      json: {
        id: 'trip-e2e',
        user_id: 'user-1',
        title: 'Paris Sprint',
        destination_text: 'Paris, France',
        start_date: '2026-04-10',
        end_date: '2026-04-12',
        budget_amount: '1200.00',
        budget_currency: 'EUR',
        trip_type: 'city_break',
        preferences: [],
        version: 1,
        created_at: '2026-03-06T09:00:00.000Z',
        updated_at: '2026-03-06T09:00:00.000Z',
      },
    })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({
      json: {
        total: 1,
        limit: 1,
        offset: 0,
        items: [
          {
            id: 'day-1',
            trip_id: 'trip-e2e',
            day_index: 0,
            date: '2026-04-10',
            notes: null,
            created_at: '2026-03-06T09:00:00.000Z',
            updated_at: '2026-03-06T09:00:00.000Z',
          },
        ],
      },
    })
  })
  await page.route('**/trips/trip-e2e/offers?**', async (route) => {
    await route.fulfill({
      json: {
        total: 1,
        limit: 1,
        offset: 0,
        items: [offerState],
      },
    })
  })
  await page.route('**/places/place-1/photos', async (route) => {
    await route.fulfill({ json: { total: 0, limit: 0, offset: 0, items: [] } })
  })
  await page.route('**/places/place-1/photos/refresh', async (route) => {
    photoRefreshCalls += 1
    await route.fulfill({ json: { job_id: 'job-photo-refresh' } })
  })
  await page.route('**/jobs/job-photo-refresh', async (route) => {
    await route.fulfill({
      json: {
        id: 'job-photo-refresh',
        user_id: 'user-1',
        job_type: 'places.photos.refresh',
        status: 'SUCCEEDED',
        payload: {},
        result: {},
        error: null,
        attempts: 1,
        max_attempts: 3,
        available_at: '2026-03-06T09:00:00.000Z',
        dead_lettered_at: null,
        created_at: '2026-03-06T09:00:00.000Z',
        started_at: '2026-03-06T09:00:00.000Z',
        finished_at: '2026-03-06T09:00:00.000Z',
      },
    })
  })
  await page.route('**/trips/trip-e2e/offers/hotel-1/attach-day', async (route) => {
    offerState = { ...offerState, trip_day_id: 'day-1' }
    await route.fulfill({ json: offerState })
  })

  await page.goto('/phase34-offers-harness.html')
  await page.getByRole('tab', { name: /hotels/i }).click()

  await expect(page.getByRole('button', { name: /Hotel du Louvre Current/i })).toBeVisible()
  await expect(page.getByText(/Map unavailable/i)).toBeVisible()
  await expect(page.getByText(/No photos yet/i)).toBeVisible()
  await expect.poll(() => photoRefreshCalls).toBe(1)

  await page.getByRole('button', { name: /attach to day/i }).click()
  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: /Day 1/i }).click()
  await page.getByRole('button', { name: /^attach$/i }).click()

  await expect(page.getByText(/Attached · Day 1/i).first()).toBeVisible()
})

test('shows inline provider fallback when transport search integration is unavailable', async ({ page }) => {
  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({
      json: {
        id: 'trip-e2e',
        user_id: 'user-1',
        title: 'Fallback Trip',
        destination_text: 'Madrid, Spain',
        start_date: '2026-04-10',
        end_date: '2026-04-12',
        budget_amount: '1200.00',
        budget_currency: 'EUR',
        trip_type: 'city_break',
        preferences: [],
        version: 1,
        created_at: '2026-03-06T09:00:00.000Z',
        updated_at: '2026-03-06T09:00:00.000Z',
      },
    })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({
      json: {
        total: 1,
        limit: 1,
        offset: 0,
        items: [
          {
            id: 'day-1',
            trip_id: 'trip-e2e',
            day_index: 0,
            date: '2026-04-10',
            notes: null,
            created_at: '2026-03-06T09:00:00.000Z',
            updated_at: '2026-03-06T09:00:00.000Z',
          },
        ],
      },
    })
  })
  await page.route('**/trips/trip-e2e/offers?**', async (route) => {
    await route.fulfill({ json: { total: 0, limit: 0, offset: 0, items: [] } })
  })
  await page.route('**/offers/transport/search', async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'INTEGRATION_NOT_CONFIGURED',
          message: 'Provider disabled',
          trace_id: 'trace-playwright',
        },
      },
    })
  })

  await page.goto('/phase34-offers-harness.html')

  await page.getByLabel('Origin').fill('CDG')
  await page.getByLabel('Destination').fill('MAD')
  await page.getByRole('button', { name: /search flights/i }).click()

  await expect(page.getByText('Flights are unavailable')).toBeVisible()
  await expect(
    page.getByText('Provider integrations are not configured for this environment.'),
  ).toBeVisible()
})
