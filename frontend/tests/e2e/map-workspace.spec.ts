import { expect, test } from '@playwright/test'

test('assigns a selected place back to the planner from the map workspace', async ({ page }) => {
  const place = {
    id: 'place-1',
    source: 'seed',
    external_id: 'seed-place-1',
    name: 'Louvre Museum',
    category: 'museum',
    address_text: 'Rue de Rivoli, Paris',
    lat: 48.8606,
    lon: 2.3376,
    metadata: {},
    canonical_place_id: null,
    is_canonical: true,
    dedup_confidence: 1,
    merged_at: null,
    photo_count: 1,
    primary_photo: {
      id: 'photo-1',
      source: 'seed',
      image_url: 'https://images.example.com/louvre.jpg',
      thumbnail_url: 'https://images.example.com/louvre-thumb.jpg',
      license_code: null,
      license_url: null,
      attribution_text: null,
    },
    distance_m: 120,
    created_at: '2026-03-06T09:00:00.000Z',
    updated_at: '2026-03-06T09:00:00.000Z',
  }

  let assignPayload: unknown = null

  await page.route('**/places?**', async (route) => {
    await route.fulfill({
      json: {
        total: 1,
        limit: 30,
        offset: 0,
        items: [place],
      },
    })
  })
  await page.route('**/places/place-1', async (route) => {
    await route.fulfill({ json: place })
  })
  await page.route('**/activities/activity-e2e', async (route) => {
    assignPayload = route.request().postDataJSON()
    await route.fulfill({
      json: {
        id: 'activity-e2e',
        trip_day_id: 'day-1',
        order_index: 0,
        title: 'Museum block',
        description: null,
        start_time: null,
        duration_min: null,
        tags: [],
        estimated_cost_amount: null,
        estimated_cost_currency: null,
        place_id: 'place-1',
        event_snapshot_id: null,
        notes: null,
        is_favorite: false,
        source: 'manual',
        created_at: '2026-03-06T09:00:00.000Z',
        updated_at: '2026-03-06T09:00:00.000Z',
      },
    })
  })

  await page.goto('/phase34-map-harness.html')

  await expect(page.getByText('Map Workspace')).toBeVisible()
  await page.getByRole('button', { name: /louvre museum/i }).click()
  await page.getByRole('button', { name: /use for planner activity/i }).click()

  await expect(page.getByTestId('planner-return')).toBeVisible()
  expect(assignPayload).toEqual({ place_id: 'place-1' })
})
