import { expect, test } from '@playwright/test'

test('shows inline provider fallback when transport search integration is unavailable', async ({ page }) => {
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

  await page.getByPlaceholder('CDG').fill('cdg')
  await page.getByPlaceholder('MAD').fill('mad')
  await page.locator('input[type="date"]').first().fill('2026-04-10')
  await page.getByRole('button', { name: /search flights/i }).click()

  await expect(
    page.getByText('Provider integrations are not configured for this environment.'),
  ).toBeVisible()
})

test('attaches a refreshed lodging offer to a trip day', async ({ page }) => {
  const day = {
    id: 'day-1',
    trip_id: 'trip-e2e',
    day_index: 0,
    date: '2026-04-10',
    notes: null,
    created_at: '2026-03-06T09:00:00.000Z',
    updated_at: '2026-03-06T09:00:00.000Z',
  }
  let offerState: {
    id: string
    kind: string
    trip_id: string
    trip_day_id: string | null
    provider: string
    title: string
    price_amount: string
    currency: string
    deep_link: string
    expires_at: string
    is_current: boolean
    superseded_by_offer_id: string | null
    created_at: string
    updated_at: string
    transport_mode: string | null
    origin_text: string | null
    destination_text: string | null
    depart_at: string | null
    arrive_at: string | null
    location_text: string | null
    lodging_type: string | null
    room_type: string | null
    checkin_date: string | null
    checkout_date: string | null
    nights: number | null
  } = {
    id: 'offer-1',
    kind: 'lodging',
    trip_id: 'trip-e2e',
    trip_day_id: null,
    provider: 'Booking',
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
    location_text: 'Paris',
    lodging_type: 'hotel',
    room_type: 'Deluxe',
    checkin_date: '2026-04-10',
    checkout_date: '2026-04-12',
    nights: 2,
  }

  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({
      json: {
        total: 1,
        limit: 1,
        offset: 0,
        items: [day],
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
  await page.route('**/trips/trip-e2e/offers/offer-1/attach-day', async (route) => {
    offerState = { ...offerState, trip_day_id: day.id }
    await route.fulfill({ json: offerState })
  })

  await page.goto('/phase34-offers-harness.html')

  await expect(page.getByText('Hotel du Louvre')).toBeVisible()
  await page.getByRole('button', { name: /attach to day/i }).click()
  await page.getByRole('combobox').selectOption(day.id)
  await page.getByRole('button', { name: /^attach$/i }).click()

  await expect(page.getByText(/Attached to Day 1/i)).toBeVisible()
})
