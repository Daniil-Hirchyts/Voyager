import { expect, test, type Page, type Route } from '@playwright/test'

const NOW = '2026-03-10T09:00:00.000Z'

type PlannerActivity = {
  id: string
  trip_day_id: string | null
  order_index: number
  category: 'visit' | 'eat' | 'activity' | 'hotel' | 'travel'
  category_details: Record<string, unknown>
  title: string
  description: string | null
  start_time: string | null
  duration_min: number | null
  estimated_cost_amount: string | null
  estimated_cost_currency: string | null
  place_id: string | null
  place: null
  event_snapshot_id: string | null
  notes: string | null
  is_favorite: boolean
  source: string
  created_at: string
  updated_at: string
}

type PlannerDay = {
  id: string
  trip_id: string
  day_index: number
  date: string
  notes: string | null
  created_at: string
  updated_at: string
  activities: PlannerActivity[]
}

type PlannerState = {
  trip: {
    id: string
    user_id: string
    title: string
    destination_text: string
    start_date: string
    end_date: string
    budget_amount: string
    budget_currency: string
    trip_type: string
    version: number
    created_at: string
    updated_at: string
  }
  inbox_activities: PlannerActivity[]
  days: PlannerDay[]
}

function buildActivity(
  id: string,
  title: string,
  tripDayId: string | null,
  overrides: Partial<PlannerActivity> = {},
): PlannerActivity {
  return {
    id,
    trip_day_id: tripDayId,
    order_index: 0,
    category: 'visit',
    category_details: {},
    title,
    description: null,
    start_time: null,
    duration_min: 60,
    estimated_cost_amount: null,
    estimated_cost_currency: null,
    place_id: null,
    place: null,
    event_snapshot_id: null,
    notes: null,
    is_favorite: false,
    source: 'manual',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function createPlannerState(): PlannerState {
  return {
    trip: {
      id: 'trip-e2e',
      user_id: 'user-e2e',
      title: 'Planner E2E Trip',
      destination_text: 'Paris, France',
      start_date: '2026-03-24',
      end_date: '2026-03-26',
      budget_amount: '1200.00',
      budget_currency: 'EUR',
      trip_type: 'city_break',
      version: 3,
      created_at: NOW,
      updated_at: NOW,
    },
    inbox_activities: [
      buildActivity('activity-inbox', 'Inbox museum shortlist', null),
    ],
    days: [
      {
        id: 'day-1',
        trip_id: 'trip-e2e',
        day_index: 0,
        date: '2026-03-24',
        notes: null,
        created_at: NOW,
        updated_at: NOW,
        activities: [
          buildActivity('activity-day-1', 'Morning walk', 'day-1', {
            start_time: '09:00',
          }),
        ],
      },
      {
        id: 'day-2',
        trip_id: 'trip-e2e',
        day_index: 1,
        date: '2026-03-25',
        notes: null,
        created_at: NOW,
        updated_at: NOW,
        activities: [
          buildActivity('activity-day-2', 'Gallery stop', 'day-2', {
            start_time: '13:00',
            duration_min: 90,
          }),
        ],
      },
    ],
  }
}

function normalizeActivities(activities: PlannerActivity[], tripDayId: string | null) {
  activities.forEach((activity, index) => {
    activity.trip_day_id = tripDayId
    activity.order_index = index
    if (tripDayId == null) {
      activity.start_time = null
    }
  })
}

function removeActivity(state: PlannerState, activityId: string) {
  const inboxIndex = state.inbox_activities.findIndex((activity) => activity.id === activityId)
  if (inboxIndex >= 0) {
    return state.inbox_activities.splice(inboxIndex, 1)[0]
  }

  for (const day of state.days) {
    const dayIndex = day.activities.findIndex((activity) => activity.id === activityId)
    if (dayIndex >= 0) {
      return day.activities.splice(dayIndex, 1)[0]
    }
  }

  return null
}

function moveActivityInState(
  state: PlannerState,
  activityId: string,
  targetDayId: string | null,
  targetIndex: number,
) {
  const activity = removeActivity(state, activityId)
  if (!activity) {
    return null
  }

  if (targetDayId == null) {
    const nextIndex = Math.max(0, Math.min(targetIndex, state.inbox_activities.length))
    state.inbox_activities.splice(nextIndex, 0, activity)
    normalizeActivities(state.inbox_activities, null)
  } else {
    const day = state.days.find((item) => item.id === targetDayId)
    if (!day) {
      return null
    }
    const nextIndex = Math.max(0, Math.min(targetIndex, day.activities.length))
    day.activities.splice(nextIndex, 0, activity)
    normalizeActivities(day.activities, day.id)
  }

  for (const day of state.days) {
    normalizeActivities(day.activities, day.id)
  }
  normalizeActivities(state.inbox_activities, null)
  state.trip.version += 1
  state.trip.updated_at = NOW

  return activity
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  })
}

async function installPlannerRoutes(page: Page, state: PlannerState) {
  await page.route('**/api/trips/trip-e2e/planner', (route) => fulfillJson(route, state))
  await page.route('**/api/activities/*/move', async (route) => {
    const payload = route.request().postDataJSON() as {
      target_day_id: string | null
      target_index: number
    }
    const activityId = route.request().url().split('/activities/')[1]?.split('/move')[0]
    if (!activityId) {
      await route.abort()
      return
    }
    const moved = moveActivityInState(
      state,
      activityId,
      payload.target_day_id ?? null,
      payload.target_index,
    )
    if (!moved) {
      await route.fulfill({ status: 404 })
      return
    }
    await fulfillJson(route, moved)
  })
  await page.route('**/api/days/*/activities/reorder', (route) =>
    fulfillJson(route, {
      total: 0,
      items: [],
    }),
  )
}

async function dragHandleTo(page: Page, sourceHandleSelector: string, targetSelector: string) {
  const source = page.locator(sourceHandleSelector)
  const target = page.locator(targetSelector)

  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()

  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) {
    throw new Error('Missing drag source or target bounds')
  }

  const sourceX = sourceBox.x + sourceBox.width / 2
  const sourceY = sourceBox.y + sourceBox.height / 2
  const targetX = targetBox.x + targetBox.width / 2
  const targetY = targetBox.y + targetBox.height / 2

  await page.mouse.move(sourceX, sourceY)
  await page.mouse.down()
  await page.mouse.move(sourceX + 16, sourceY + 12, { steps: 6 })
  await page.mouse.move(targetX, targetY, { steps: 16 })
  await page.mouse.up()
}

test('desktop kanban supports inbox/day roundtrip without snap scrolling', async ({ page }) => {
  const plannerState = createPlannerState()
  await installPlannerRoutes(page, plannerState)

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('/planner-harness.html')

  await expect(page.locator('[aria-label="Inbox"]')).toBeVisible()
  await expect(page.locator('[aria-label="Activity: Inbox museum shortlist"]')).toBeVisible()

  const snapType = await page
    .getByTestId('planner-board-rail')
    .evaluate((element) => window.getComputedStyle(element).scrollSnapType)
  expect(snapType).toBe('none')

  await dragHandleTo(
    page,
    '[aria-label="Activity: Inbox museum shortlist"] button[aria-label="Drag activity"]',
    'section[aria-label="Day 1"]',
  )

  await expect(
    page.locator('section[aria-label="Day 1"] [aria-label="Activity: Inbox museum shortlist"]'),
  ).toBeVisible()

  await dragHandleTo(
    page,
    'section[aria-label="Day 1"] [aria-label="Activity: Inbox museum shortlist"] button[aria-label="Drag activity"]',
    'section[aria-label="Inbox"]',
  )

  await expect(
    page.locator('section[aria-label="Inbox"] [aria-label="Activity: Inbox museum shortlist"]'),
  ).toBeVisible()
  await expect(
    page.locator('section[aria-label="Day 1"] [aria-label="Activity: Inbox museum shortlist"]'),
  ).toHaveCount(0)
})

test('mobile kanban uses the chip rail to move inbox items across hidden days', async ({ page }) => {
  const plannerState = createPlannerState()
  await installPlannerRoutes(page, plannerState)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planner-harness.html')

  await expect(page.getByTestId('planner-mobile-chip-rail')).toBeVisible()
  await expect(page.locator('section[aria-label="Inbox"]')).toBeVisible()
  await expect(page.locator('section[aria-label="Day 1"]')).toHaveCount(0)

  await dragHandleTo(
    page,
    '[aria-label="Activity: Inbox museum shortlist"] button[aria-label="Drag activity"]',
    '[data-testid="planner-mobile-chip-rail"] button:has-text("Day 1")',
  )

  await expect(page.locator('section[aria-label="Day 1"]')).toBeVisible()
  await expect(
    page.locator('section[aria-label="Day 1"] [aria-label="Activity: Inbox museum shortlist"]'),
  ).toBeVisible()
})
