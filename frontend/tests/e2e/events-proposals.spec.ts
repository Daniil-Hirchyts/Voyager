import { expect, test } from '@playwright/test'

const TRIP = {
  id: 'trip-e2e',
  user_id: 'user-1',
  title: 'Paris Atlas',
  destination_text: 'Paris, France',
  start_date: '2026-04-10',
  end_date: '2026-04-12',
  budget_amount: '1600.00',
  budget_currency: 'EUR',
  trip_type: 'city_break',
  preferences: [],
  version: 3,
  created_at: '2026-03-06T09:00:00.000Z',
  updated_at: '2026-03-06T09:00:00.000Z',
}

const DAY = {
  id: 'day-e2e',
  trip_id: 'trip-e2e',
  day_index: 0,
  date: '2026-04-10',
  notes: null,
  created_at: '2026-03-06T09:00:00.000Z',
  updated_at: '2026-03-06T09:00:00.000Z',
}

const EVENT = {
  id: 'event-e2e',
  trip_id: 'trip-e2e',
  trip_day_id: null,
  provider: 'ticketmaster',
  provider_event_ref: 'tm-ref-e2e',
  title: 'Jazz at the Philharmonie',
  summary: 'A night of classic jazz in Paris.',
  start_at: '2026-04-10T20:00:00+02:00',
  end_at: '2026-04-10T22:30:00+02:00',
  timezone: 'Europe/Paris',
  venue_name: 'Philharmonie de Paris',
  venue_address: '221 Avenue Jean Jaurès, 75019 Paris',
  place_id: null,
  segment: 'Music',
  genre: 'Jazz',
  min_price: '25.00',
  max_price: '95.00',
  currency: 'EUR',
  image_url: null,
  deep_link: 'https://provider.example.com/event-e2e',
  sales_status: 'onsale',
  expires_at: null,
  created_at: '2026-03-06T09:00:00.000Z',
  updated_at: '2026-03-06T09:00:00.000Z',
}

const PROPOSAL_ACTIVITY = {
  id: 'prop-act-e2e',
  proposal_id: 'proposal-e2e',
  trip_day_id: 'day-e2e',
  source_activity_id: null,
  event_snapshot_id: null,
  place_id: null,
  order_index: 0,
  title: 'Morning museum visit',
  description: 'Start the day at the Louvre.',
  start_time: '09:00',
  duration_min: 120,
  estimated_cost_amount: '17.00',
  estimated_cost_currency: 'EUR',
  tags: ['culture'],
  rationale: { reason: 'High visitor rating.' },
  score: { total: 0.87 },
  created_at: '2026-03-06T09:00:00.000Z',
  updated_at: '2026-03-06T09:00:00.000Z',
}

const PROPOSAL = {
  id: 'proposal-e2e',
  trip_id: 'trip-e2e',
  user_id: 'user-1',
  job_id: 'job-proposal-e2e',
  based_on_trip_version: 3,
  objective: 'balanced_flow',
  scope_day_ids: ['day-e2e'],
  status: 'SUCCEEDED',
  summary: { activities_changed: 1, days_affected: 1 },
  score: { total: 0.87 },
  items: [PROPOSAL_ACTIVITY],
  created_at: '2026-03-06T09:00:00.000Z',
  updated_at: '2026-03-06T09:00:00.000Z',
}

// ── Events ──────────────────────────────────────────────────────────────────

test('events: renders search form and shows existing event', async ({ page }) => {
  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [DAY] } })
  })
  await page.route('**/trips/trip-e2e/events', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [EVENT] } })
  })

  await page.goto('/phase6-events-harness.html')

  await expect(page.getByLabelText(/start date/i)).toBeVisible()
  await expect(page.getByLabelText(/end date/i)).toBeVisible()
  await expect(page.getByText('Jazz at the Philharmonie')).toBeVisible()
})

test('events: sends Idempotency-Key on search submit', async ({ page }) => {
  let capturedHeaders: Record<string, string> = {}
  let capturedBody: Record<string, unknown> = {}

  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [DAY] } })
  })
  await page.route('**/trips/trip-e2e/events', async (route) => {
    await route.fulfill({ json: { total: 0, limit: 0, offset: 0, items: [] } })
  })
  await page.route('**/events/search', async (route) => {
    capturedHeaders = route.request().headers()
    capturedBody = (route.request().postDataJSON() as Record<string, unknown>) ?? {}
    await route.fulfill({
      status: 202,
      json: { job_id: 'job-event-e2e', status: 'PENDING', poll_url: '/jobs/job-event-e2e' },
    })
  })
  await page.route('**/jobs/job-event-e2e', async (route) => {
    await route.fulfill({
      json: {
        id: 'job-event-e2e',
        user_id: 'user-1',
        job_type: 'events.search',
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
        finished_at: '2026-03-06T09:00:05.000Z',
      },
    })
  })

  await page.goto('/phase6-events-harness.html')

  await page.getByLabelText(/start date/i).fill('2026-04-10')
  await page.getByLabelText(/end date/i).fill('2026-04-12')
  await page.getByRole('button', { name: /search events/i }).click()

  await page.waitForTimeout(1000)

  expect(capturedHeaders['idempotency-key']).toBeTruthy()
  expect(capturedBody['trip_id']).toBe('trip-e2e')
})

test('events: shows provider-unavailable state on 503', async ({ page }) => {
  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [DAY] } })
  })
  await page.route('**/trips/trip-e2e/events', async (route) => {
    await route.fulfill({ json: { total: 0, limit: 0, offset: 0, items: [] } })
  })
  await page.route('**/events/search', async (route) => {
    await route.fulfill({
      status: 503,
      json: { error: { code: 'INTEGRATION_NOT_CONFIGURED', message: 'Provider disabled', trace_id: 'trace-1' } },
    })
  })

  await page.goto('/phase6-events-harness.html')

  await page.getByLabelText(/start date/i).fill('2026-04-10')
  await page.getByLabelText(/end date/i).fill('2026-04-12')
  await page.getByRole('button', { name: /search events/i }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText(/not configured for this environment/i)).toBeVisible()
})

test('events: attaches event to day with If-Match and Idempotency-Key', async ({ page }) => {
  let capturedHeaders: Record<string, string> = {}
  let capturedBody: Record<string, unknown> = {}

  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [DAY] } })
  })
  await page.route('**/trips/trip-e2e/events', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [EVENT] } })
  })
  await page.route('**/trips/trip-e2e/events/event-e2e/attach-day', async (route) => {
    capturedHeaders = route.request().headers()
    capturedBody = (route.request().postDataJSON() as Record<string, unknown>) ?? {}
    await route.fulfill({ json: { ...EVENT, trip_day_id: 'day-e2e' } })
  })

  await page.goto('/phase6-events-harness.html')

  await page.getByText('Jazz at the Philharmonie').click()
  await page.getByRole('button', { name: /attach to day/i }).click()
  await expect(page.getByRole('dialog', { name: /attach event to day/i })).toBeVisible()
  await page.getByRole('button', { name: /^attach$/i }).click()

  await page.waitForTimeout(500)

  expect(capturedHeaders['if-match']).toBe('3')
  expect(capturedHeaders['idempotency-key']).toBeTruthy()
  expect(capturedBody['trip_day_id']).toBe('day-e2e')
})

// ── Proposals ────────────────────────────────────────────────────────────────

test('proposals: renders optimize button and empty state', async ({ page }) => {
  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [DAY] } })
  })
  await page.route('**/trips/trip-e2e/proposals', async (route) => {
    await route.fulfill({ json: { total: 0, limit: 0, offset: 0, items: [] } })
  })

  await page.goto('/phase6-proposals-harness.html')

  await expect(page.getByRole('button', { name: /optimize trip/i })).toBeVisible()
  await expect(page.getByText(/no proposals yet/i)).toBeVisible()
})

test('proposals: sends Idempotency-Key on optimize', async ({ page }) => {
  let capturedHeaders: Record<string, string> = {}

  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [DAY] } })
  })
  await page.route('**/trips/trip-e2e/proposals', async (route) => {
    await route.fulfill({ json: { total: 0, limit: 0, offset: 0, items: [] } })
  })
  await page.route('**/trips/trip-e2e/optimize', async (route) => {
    capturedHeaders = route.request().headers()
    await route.fulfill({
      status: 202,
      json: { job_id: 'job-opt-e2e', status: 'PENDING', poll_url: '/jobs/job-opt-e2e' },
    })
  })
  await page.route('**/jobs/job-opt-e2e', async (route) => {
    await route.fulfill({
      json: {
        id: 'job-opt-e2e',
        user_id: 'user-1',
        job_type: 'proposals.optimize',
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
        finished_at: '2026-03-06T09:00:05.000Z',
      },
    })
  })

  await page.goto('/phase6-proposals-harness.html')

  await page.getByRole('button', { name: /optimize trip/i }).click()

  await page.waitForTimeout(500)

  expect(capturedHeaders['idempotency-key']).toBeTruthy()
})

test('proposals: shows proposal list and opens detail drawer', async ({ page }) => {
  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [DAY] } })
  })
  await page.route('**/trips/trip-e2e/proposals', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [PROPOSAL] } })
  })

  await page.goto('/phase6-proposals-harness.html')

  await expect(page.getByText('Ready')).toBeVisible()
  await page.getByText('Ready').click()

  await expect(page.getByRole('dialog', { name: /proposal review/i })).toBeVisible()
  await expect(page.getByText('Morning museum visit')).toBeVisible()
  await expect(page.getByRole('button', { name: /apply proposal/i })).toBeVisible()
})

test('proposals: applies proposal with If-Match and Idempotency-Key', async ({ page }) => {
  let capturedHeaders: Record<string, string> = {}

  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [DAY] } })
  })
  await page.route('**/trips/trip-e2e/proposals', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [PROPOSAL] } })
  })
  await page.route('**/proposals/proposal-e2e/apply', async (route) => {
    capturedHeaders = route.request().headers()
    await route.fulfill({
      json: {
        proposal_id: 'proposal-e2e',
        trip_id: 'trip-e2e',
        status: 'APPLIED',
        version: 4,
        applied_day_ids: ['day-e2e'],
      },
    })
  })
  await page.route('**/days/day-e2e/activities', async (route) => {
    await route.fulfill({ json: { total: 0, limit: 0, offset: 0, items: [] } })
  })

  await page.goto('/phase6-proposals-harness.html')

  await page.getByText('Ready').click()
  await expect(page.getByRole('dialog', { name: /proposal review/i })).toBeVisible()
  await page.getByRole('button', { name: /apply proposal/i }).click()

  await page.waitForTimeout(500)

  expect(capturedHeaders['if-match']).toBe('3')
  expect(capturedHeaders['idempotency-key']).toBeTruthy()
})

test('proposals: shows conflict banner on 409 apply', async ({ page }) => {
  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })
  await page.route('**/trips/trip-e2e/days', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [DAY] } })
  })
  await page.route('**/trips/trip-e2e/proposals', async (route) => {
    await route.fulfill({ json: { total: 1, limit: 1, offset: 0, items: [PROPOSAL] } })
  })
  await page.route('**/proposals/proposal-e2e/apply', async (route) => {
    await route.fulfill({
      status: 409,
      json: { error: { code: 'CONFLICT_VERSION_MISMATCH', message: 'Version mismatch', trace_id: 'trace-1' } },
    })
  })

  await page.goto('/phase6-proposals-harness.html')

  await page.getByText('Ready').click()
  await expect(page.getByRole('dialog', { name: /proposal review/i })).toBeVisible()
  await page.getByRole('button', { name: /apply proposal/i }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText(/version conflict/i)).toBeVisible()
})
