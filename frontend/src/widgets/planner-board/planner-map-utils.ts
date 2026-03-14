import type {
  PlannerActivity,
  PlannerDay,
  RouteLegEstimateInput,
  RouteLegEstimateItem,
  RouteTravelMode,
} from '@/shared/api/types'
import { plannerPrimaryPlace } from './categories'
import {
  buildPlannerTravelLegs,
  summarizePlannerTravelLegs,
  type PlannerTravelLeg,
  type PlannerTravelSummary,
} from './travel-estimates'

export type PlannerMapLayerGroup =
  | 'visit'
  | 'eat'
  | 'activity'
  | 'hotel'
  | 'travel'
  | 'recommendation'

export type PlannerMapStop = {
  activity: PlannerActivity
  dayId: string
  dayIndex: number
  color: string
  markerNumber: number | null
  isHotel: boolean
  lat: number | null
  lon: number | null
}

export type PlannerMapSection = {
  id: string
  dayId: string
  dayIndex: number
  title: string
  subtitle: string
  dateLabel: string
  color: string
  activities: PlannerActivity[]
  stops: PlannerMapStop[]
}

export type PlannerMapDayMetrics = PlannerTravelSummary & {
  legs: PlannerTravelLeg[]
}

export const PLANNER_MAP_DAY_COLORS = [
  '#7C5AE0',
  '#48A2FF',
  '#3AC5B3',
  '#FF7A59',
  '#35B56A',
  '#C98A37',
] as const

function routeEstimateKey(fromActivityId: string, toActivityId: string) {
  return `${fromActivityId}:${toActivityId}`
}

function activityCoordinates(activity: PlannerActivity) {
  const place = plannerPrimaryPlace(activity)
  const lat = place?.lat ?? null
  const lon = place?.lon ?? null
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return null
  }
  return { lat, lon }
}

function isMarkerActivity(activity: PlannerActivity) {
  return activity.category !== 'hotel' && activity.place?.lat != null && activity.place?.lon != null
}

export function buildPlannerMapSections(
  days: PlannerDay[],
  inboxActivities: PlannerActivity[],
): PlannerMapSection[] {
  const sections: PlannerMapSection[] = []
  const inboxColor = '#B59BFF'
  let inboxMarkerNumber = 1
  sections.push({
    id: 'inbox',
    dayId: 'inbox',
    dayIndex: -1,
    title: 'Inbox',
    subtitle: 'Unassigned activities',
    dateLabel: 'Review before scheduling',
    color: inboxColor,
    activities: [...inboxActivities].sort((left, right) => left.order_index - right.order_index),
    stops: [...inboxActivities]
      .sort((left, right) => left.order_index - right.order_index)
      .map((activity) => {
        const point = activityCoordinates(activity)
        const markerNumber = isMarkerActivity(activity) ? inboxMarkerNumber++ : null
        return {
          activity,
          dayId: 'inbox',
          dayIndex: -1,
          color: inboxColor,
          markerNumber,
          isHotel: activity.category === 'hotel',
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
        }
      }),
  })

  days.forEach((day, index) => {
    const color = PLANNER_MAP_DAY_COLORS[index % PLANNER_MAP_DAY_COLORS.length]
    const activities = [...day.activities].sort((left, right) => left.order_index - right.order_index)
    let markerNumber = 1
    sections.push({
      id: day.id,
      dayId: day.id,
      dayIndex: day.day_index,
      title: `Day ${day.day_index + 1}`,
      subtitle: new Date(day.date).toLocaleDateString(undefined, { weekday: 'long' }),
      dateLabel: new Date(day.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      color,
      activities,
      stops: activities.map((activity) => {
        const point = activityCoordinates(activity)
        const nextMarkerNumber = isMarkerActivity(activity) ? markerNumber++ : null
        return {
          activity,
          dayId: day.id,
          dayIndex: day.day_index,
          color,
          markerNumber: nextMarkerNumber,
          isHotel: activity.category === 'hotel',
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
        }
      }),
    })
  })

  return sections
}

export function buildPlannerMapLegPayload(
  sections: PlannerMapSection[],
  travelMode: RouteLegEstimateInput['travel_mode'] = 'WALK',
): RouteLegEstimateInput | null {
  const legs = sections.flatMap((section) =>
    section.activities.slice(1).flatMap((activity, index) => {
      const previousActivity = section.activities[index]
      const origin = activityCoordinates(previousActivity)
      const destination = activityCoordinates(activity)
      if (!origin || !destination) {
        return []
      }
      return [
        {
          from_activity_id: previousActivity.id,
          to_activity_id: activity.id,
          origin: { lat: origin.lat, lng: origin.lon },
          destination: { lat: destination.lat, lng: destination.lon },
        },
      ]
    }),
  )

  if (!legs.length) {
    return null
  }

  return {
    legs,
    travel_mode: travelMode,
  }
}

export function buildPlannerMapMetricsForActivities(
  activities: PlannerActivity[],
  estimateItems: RouteLegEstimateItem[] = [],
  travelMode: RouteTravelMode = 'WALK',
): PlannerMapDayMetrics {
  const estimatesByLegId = new Map(
    estimateItems.map((item) => [
      routeEstimateKey(item.from_activity_id, item.to_activity_id),
      item,
    ]),
  )
  const fallbackLegs = buildPlannerTravelLegs(activities, travelMode)
  const legs = fallbackLegs.map((leg) => {
    const estimate = estimatesByLegId.get(routeEstimateKey(leg.fromActivityId, leg.toActivityId))
    return estimate
      ? {
          ...leg,
          distanceKm: estimate.distance_km,
          durationMin: estimate.duration_min,
        }
      : leg
  })

  return { ...summarizePlannerTravelLegs(legs), legs }
}

export function buildPlannerMapDayMetrics(
  sections: PlannerMapSection[],
  estimateItems: RouteLegEstimateItem[] = [],
  travelMode: RouteTravelMode = 'WALK',
): Record<string, PlannerMapDayMetrics> {
  return Object.fromEntries(
    sections.map((section) => {
      return [section.dayId, buildPlannerMapMetricsForActivities(section.activities, estimateItems, travelMode)]
    }),
  )
}

export function filterVisibleStops(
  sections: PlannerMapSection[],
  visibleDayIds: Set<string>,
  visibleGroups: Set<PlannerMapLayerGroup>,
) {
  return sections.flatMap((section) =>
    section.stops.filter(
      (stop) =>
        visibleDayIds.has(stop.dayId) &&
        visibleGroups.has(stop.activity.category as PlannerMapLayerGroup) &&
        stop.lat != null &&
        stop.lon != null,
    ),
  )
}

function routeDistance(
  orderedStops: PlannerMapStop[],
  estimateMap: Map<string, RouteLegEstimateItem>,
  travelMode: RouteTravelMode,
) {
  return orderedStops.slice(1).reduce((total, stop, index) => {
    const previous = orderedStops[index]
    const estimate = estimateMap.get(routeEstimateKey(previous.activity.id, stop.activity.id))
    if (estimate?.duration_min != null) {
      return total + estimate.duration_min
    }
    if (estimate?.distance_km != null) {
      return total + estimate.distance_km
    }
    const fallback = buildPlannerTravelLegs([previous.activity, stop.activity], travelMode)[0]
    return total + (fallback?.durationMin ?? fallback?.distanceKm ?? 0)
  }, 0)
}

export function optimizePlannerDayStops(
  section: PlannerMapSection,
  estimateItems: RouteLegEstimateItem[] = [],
  travelMode: RouteTravelMode = 'WALK',
) {
  const markerStops = section.stops.filter((stop) => stop.markerNumber != null)
  if (markerStops.length < 3) {
    return markerStops.map((stop) => stop.activity.id)
  }

  const estimateMap = new Map(
    estimateItems.map((item) => [routeEstimateKey(item.from_activity_id, item.to_activity_id), item]),
  )

  const remaining = [...markerStops]
  const ordered: PlannerMapStop[] = [remaining.shift()!]

  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1]
    let bestIndex = 0
    let bestCost = Number.POSITIVE_INFINITY

    remaining.forEach((candidate, index) => {
      const estimate = estimateMap.get(routeEstimateKey(current.activity.id, candidate.activity.id))
      const fallback = buildPlannerTravelLegs([current.activity, candidate.activity], travelMode)[0]
      const cost =
        estimate?.duration_min ??
        estimate?.distance_km ??
        fallback?.durationMin ??
        fallback?.distanceKm ??
        Number.POSITIVE_INFINITY
      if (cost < bestCost) {
        bestCost = cost
        bestIndex = index
      }
    })

    ordered.push(remaining.splice(bestIndex, 1)[0])
  }

  let best = [...ordered]
  let improved = true
  while (improved) {
    improved = false
    for (let i = 1; i < best.length - 2; i += 1) {
      for (let j = i + 1; j < best.length - 1; j += 1) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ]
        if (
          routeDistance(candidate, estimateMap, travelMode) + 0.001 <
          routeDistance(best, estimateMap, travelMode)
        ) {
          best = candidate
          improved = true
        }
      }
    }
  }

  return best.map((stop) => stop.activity.id)
}
