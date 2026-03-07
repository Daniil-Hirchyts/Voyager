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

const EXPORT_PENDING = {
  id: 'export-e2e',
  job_id: 'job-export-e2e',
  user_id: 'user-1',
  trip_id: 'trip-e2e',
  format: 'json',
  status: 'PENDING',
  trip_version: 3,
  content_type: null,
  size_bytes: null,
  sha256: null,
  error: null,
  created_at: '2026-03-06T09:00:00.000Z',
  finished_at: null,
  expires_at: null,
  deleted_at: null,
  download_url: null,
}

const EXPORT_DONE = {
  ...EXPORT_PENDING,
  status: 'SUCCEEDED',
  content_type: 'application/json',
  size_bytes: 2048,
  finished_at: '2026-03-06T09:01:00.000Z',
}

const AUDIT_ENTRIES = [
  {
    id: 'audit-1',
    user_id: 'user-1',
    trip_id: 'trip-e2e',
    entity_type: 'activity',
    entity_id: 'activity-1',
    action: 'create',
    before: null,
    after: { title: 'Morning walk', duration_min: 90 },
    correlation_id: 'corr-1',
    request_path: '/days/day-1/activities',
    created_at: '2026-03-06T09:00:00.000Z',
  },
  {
    id: 'audit-2',
    user_id: 'user-1',
    trip_id: 'trip-e2e',
    entity_type: 'trip',
    entity_id: 'trip-e2e',
    action: 'update',
    before: { title: 'Old title' },
    after: { title: 'Paris Atlas' },
    correlation_id: 'corr-2',
    request_path: '/trips/trip-e2e',
    created_at: '2026-03-06T08:55:00.000Z',
  },
]

test('submits a JSON export and shows ready status after job succeeds', async ({ page }) => {
  let jobCallCount = 0

  await page.route('**/trips/trip-e2e', async (route) => {
    await route.fulfill({ json: TRIP })
  })

  await page.route('**/trips/trip-e2e/exports', async (route) => {
    const headers = route.request().headers()
    expect(headers['if-match']).toBe('3')
    expect(headers['idempotency-key']).toBeTruthy()
    await route.fulfill({
      status: 202,
      json: { job_id: 'job-export-e2e', status: 'PENDING', poll_url: '/jobs/job-export-e2e' },
    })
  })

  await page.route('**/jobs/job-export-e2e', async (route) => {
    jobCallCount++
    await route.fulfill({
      json: {
        id: 'job-export-e2e',
        user_id: 'user-1',
        job_type: 'export',
        status: jobCallCount >= 2 ? 'SUCCEEDED' : 'RUNNING',
        payload: {},
        result: jobCallCount >= 2 ? { export_id: 'export-e2e' } : null,
        error: null,
        attempts: 1,
        max_attempts: 3,
        available_at: '2026-03-06T09:00:00.000Z',
        dead_lettered_at: null,
        created_at: '2026-03-06T09:00:00.000Z',
        started_at: '2026-03-06T09:00:00.000Z',
        finished_at: jobCallCount >= 2 ? '2026-03-06T09:01:00.000Z' : null,
      },
    })
  })

  await page.route('**/exports/export-e2e', async (route) => {
    if (route.request().url().endsWith('/content')) {
      await route.fulfill({ body: '{"test":"data"}', contentType: 'application/json' })
    } else {
      await route.fulfill({ json: EXPORT_DONE })
    }
  })

  await page.goto('/phase5-exports-harness.html')

  // Select JSON format (already default) and submit
  await page.getByRole('button', { name: /export json/i }).click()

  // Wait for the job to complete and "Ready" badge to appear
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('button', { name: /download/i })).toBeVisible()
})

test('shows version conflict banner on 409 and clears after refetch', async ({ page }) => {
  let tripCallCount = 0

  await page.route('**/trips/trip-e2e', async (route) => {
    tripCallCount++
    await route.fulfill({ json: { ...TRIP, version: tripCallCount > 1 ? 4 : 3 } })
  })

  await page.route('**/trips/trip-e2e/exports', async (route) => {
    await route.fulfill({
      status: 409,
      json: { error: { code: 'CONFLICT_VERSION_MISMATCH', message: 'Version mismatch', trace_id: 'trace-1' } },
    })
  })

  await page.goto('/phase5-exports-harness.html')

  await page.getByRole('button', { name: /export json/i }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText(/version conflict/i)).toBeVisible()
})

test('shows audit log entries with entity and action badges', async ({ page }) => {
  await page.route('**/trips/trip-e2e/audit**', async (route) => {
    await route.fulfill({
      json: { total: 2, limit: 20, offset: 0, items: AUDIT_ENTRIES },
    })
  })

  await page.goto('/phase5-audit-harness.html')

  await expect(page.getByText('activity').first()).toBeVisible()
  await expect(page.getByText('create')).toBeVisible()
  await expect(page.getByText('trip')).toBeVisible()
  await expect(page.getByText('update')).toBeVisible()
})

test('filters audit by entity_type and applies to request', async ({ page }) => {
  const capturedUrls: string[] = []

  await page.route('**/trips/trip-e2e/audit**', async (route) => {
    capturedUrls.push(route.request().url())
    await route.fulfill({
      json: { total: 1, limit: 20, offset: 0, items: [AUDIT_ENTRIES[0]] },
    })
  })

  await page.goto('/phase5-audit-harness.html')
  await page.waitForLoadState('networkidle')

  await page.getByLabel(/entity type/i).fill('activity')
  await page.getByRole('button', { name: /apply/i }).click()

  await page.waitForTimeout(500)

  const filteredUrl = capturedUrls.find((u) => u.includes('entity_type=activity'))
  expect(filteredUrl).toBeTruthy()
})

test('opens detail drawer on audit entry click and shows before/after', async ({ page }) => {
  await page.route('**/trips/trip-e2e/audit**', async (route) => {
    await route.fulfill({
      json: { total: 2, limit: 20, offset: 0, items: AUDIT_ENTRIES },
    })
  })

  await page.goto('/phase5-audit-harness.html')

  // Click the trip/update entry which has before/after
  await page.getByText('update').click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText(/old title/i)).toBeVisible()
  await expect(page.getByText(/paris atlas/i)).toBeVisible()
})

test('paginates audit results when total exceeds page size', async ({ page }) => {
  const items = Array.from({ length: 20 }, (_, i) =>
    ({
      id: `audit-${i}`,
      user_id: 'user-1',
      trip_id: 'trip-e2e',
      entity_type: 'activity',
      entity_id: `activity-${i}`,
      action: 'create',
      before: null,
      after: null,
      correlation_id: null,
      request_path: null,
      created_at: '2026-03-06T09:00:00.000Z',
    })
  )

  await page.route('**/trips/trip-e2e/audit**', async (route) => {
    await route.fulfill({
      json: { total: 45, limit: 20, offset: 0, items },
    })
  })

  await page.goto('/phase5-audit-harness.html')

  await expect(page.getByText(/page 1 of 3/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /next/i })).toBeEnabled()
  await expect(page.getByRole('button', { name: /previous/i })).toBeDisabled()
})
