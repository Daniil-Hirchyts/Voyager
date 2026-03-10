import { requestJson } from '@/shared/api/client'
import type { PlannerActivity, PlannerResponse } from '@/shared/api/types'

export const LEGACY_INBOX_TAG = '__voyager_inbox__'
export const LEGACY_DAY_UNTIMED_TAG = '__voyager_day_untimed__'

function stripPlannerInternalTags(tags: string[] | null | undefined) {
  return (tags ?? []).filter(
    (tag) => tag !== LEGACY_INBOX_TAG && tag !== LEGACY_DAY_UNTIMED_TAG,
  )
}

function normalizeActivity(
  activity: PlannerActivity,
  overrides: Partial<PlannerActivity> = {},
): PlannerActivity {
  return {
    ...activity,
    ...overrides,
    tags: stripPlannerInternalTags(activity.tags),
  }
}

export async function getPlanner(tripId: string): Promise<PlannerResponse> {
  const planner = await requestJson<PlannerResponse>(`/trips/${tripId}/planner`)
  const days = (planner.days ?? []).map((day) => ({
    ...day,
    activities: Array.isArray(day.activities) ? day.activities : [],
  }))

  if (Array.isArray(planner.inbox_activities)) {
    return {
      ...planner,
      legacy_inbox_mode: false,
      inbox_activities: planner.inbox_activities.map((activity) => normalizeActivity(activity)),
      days: days.map((day) => ({
        ...day,
        activities: day.activities.map((activity) => normalizeActivity(activity)),
      })),
    }
  }

  const inboxActivities: PlannerActivity[] = []

  return {
    ...planner,
    legacy_inbox_mode: true,
    inbox_activities: inboxActivities,
    days: days.map((day) => {
      const visibleActivities: PlannerActivity[] = []
      for (const activity of day.activities) {
        const tags = activity.tags ?? []
        const isInboxTagged = tags.includes(LEGACY_INBOX_TAG)
        const isDayUntimedTagged = tags.includes(LEGACY_DAY_UNTIMED_TAG)
        const shouldDeriveInbox = isInboxTagged || (!activity.start_time && !isDayUntimedTagged)

        if (shouldDeriveInbox) {
          inboxActivities.push(
            normalizeActivity(activity, {
              trip_day_id: null,
              start_time: null,
              end_time: null,
              legacy_source_day_id: activity.trip_day_id ?? day.id,
              legacy_inbox_item: true,
            }),
          )
          continue
        }

        visibleActivities.push(
          normalizeActivity(activity, {
            legacy_source_day_id: activity.trip_day_id ?? day.id,
            legacy_inbox_item: false,
          }),
        )
      }

      return {
        ...day,
        activities: visibleActivities,
      }
    }),
  }
}
