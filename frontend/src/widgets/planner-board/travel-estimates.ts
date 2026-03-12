import type { PlannerActivity, RouteTravelMode } from '@/shared/api/types'
import { plannerPrimaryPlace } from './categories'

const EARTH_RADIUS_KM = 6371
const ESTIMATED_TRAVEL_SPEED_KM_PER_HOUR: Record<RouteTravelMode, number> = {
  WALK: 4.8,
  BICYCLE: 15,
  DRIVE: 40,
  TRANSIT: 22,
}

export type PlannerTravelLeg = {
  fromActivityId: string
  toActivityId: string
  distanceKm: number | null
  durationMin: number | null
}

export type PlannerTravelSummary = {
  distanceKm: number
  durationMin: number
  estimatedLegCount: number
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function haversineKm(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
) {
  const deltaLat = toRadians(latB - latA)
  const deltaLon = toRadians(lonB - lonA)
  const originLat = toRadians(latA)
  const destinationLat = toRadians(latB)
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(originLat) *
      Math.cos(destinationLat) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2)

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getActivityCoordinates(activity: PlannerActivity) {
  const place = plannerPrimaryPlace(activity)
  const lat = place?.lat
  const lon = place?.lon

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return null
  }

  return { lat, lon }
}

export function buildPlannerTravelLegs(
  activities: PlannerActivity[],
  travelMode: RouteTravelMode = 'WALK',
): PlannerTravelLeg[] {
  return activities.slice(1).map((activity, index) => {
    const previousActivity = activities[index]
    const origin = getActivityCoordinates(previousActivity)
    const destination = getActivityCoordinates(activity)

    if (!origin || !destination) {
      return {
        fromActivityId: previousActivity.id,
        toActivityId: activity.id,
        distanceKm: null,
        durationMin: null,
      }
    }

    const distanceKm = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon)
    const speedKmPerHour = ESTIMATED_TRAVEL_SPEED_KM_PER_HOUR[travelMode]

    return {
      fromActivityId: previousActivity.id,
      toActivityId: activity.id,
      distanceKm,
      durationMin: Math.max(1, Math.round((distanceKm / speedKmPerHour) * 60)),
    }
  })
}

export function summarizePlannerTravelLegs(legs: PlannerTravelLeg[]): PlannerTravelSummary {
  return legs.reduce<PlannerTravelSummary>(
    (summary, leg) => {
      if (leg.distanceKm == null || leg.durationMin == null) {
        return summary
      }

      return {
        distanceKm: summary.distanceKm + leg.distanceKm,
        durationMin: summary.durationMin + leg.durationMin,
        estimatedLegCount: summary.estimatedLegCount + 1,
      }
    },
    {
      distanceKm: 0,
      durationMin: 0,
      estimatedLegCount: 0,
    },
  )
}

export function formatTravelDistance(distanceKm: number) {
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: distanceKm >= 10 ? 0 : 1,
    minimumFractionDigits: distanceKm > 0 && distanceKm < 1 ? 1 : 0,
  }).format(distanceKm)} km`
}

export function formatTravelDuration(durationMin: number) {
  return `${Math.max(1, Math.round(durationMin))} min`
}
