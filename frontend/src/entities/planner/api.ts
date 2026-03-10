import { requestJson } from '@/shared/api/client'
import type { PlannerActivity, PlannerResponse } from '@/shared/api/types'

function normalizeActivity(activity: PlannerActivity): PlannerActivity {
  return {
    ...activity,
    category_details:
      activity.category_details && typeof activity.category_details === 'object'
        ? activity.category_details
        : {},
    linked_offer_summary: activity.linked_offer_summary ?? null,
    place: activity.place ?? null,
  }
}

export async function getPlanner(tripId: string): Promise<PlannerResponse> {
  const planner = await requestJson<PlannerResponse>(`/trips/${tripId}/planner`)

  return {
    ...planner,
    legacy_inbox_mode: false,
    inbox_activities: Array.isArray(planner.inbox_activities)
      ? planner.inbox_activities.map(normalizeActivity)
      : [],
    days: (planner.days ?? []).map((day) => ({
      ...day,
      activities: Array.isArray(day.activities)
        ? day.activities.map(normalizeActivity)
        : [],
    })),
  }
}
