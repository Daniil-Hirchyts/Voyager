import type { ActivityCategory, PlannerActivity, PlannerPlaceSummary } from '@/shared/api/types'

export type PlannerTravelDisplayMode = 'flight' | 'train' | 'car' | 'ferry' | 'walk'

export const PLANNER_TRAVEL_MODE_OPTIONS: Array<{
  value: PlannerTravelDisplayMode
  label: string
  description: string
}> = [
  {
    value: 'flight',
    label: 'Flight',
    description: 'Air travel with the clearest route overlay.',
  },
  {
    value: 'train',
    label: 'Train',
    description: 'Rail segments and station-to-station hops.',
  },
  {
    value: 'car',
    label: 'Car',
    description: 'Road transfers, taxis, and car rentals.',
  },
  {
    value: 'ferry',
    label: 'Ferry',
    description: 'Boat crossings and water transfers.',
  },
  {
    value: 'walk',
    label: 'Walk',
    description: 'On-foot transfers between nearby points.',
  },
]

export const PLANNER_CATEGORY_META: Record<
  ActivityCategory,
  {
    label: string
    shortLabel: string
    description: string
  }
> = {
  visit: {
    label: 'Visit',
    shortLabel: 'Visit',
    description: 'Sightseeing spots, neighborhoods, landmarks, and cultural stops.',
  },
  eat: {
    label: 'Eat',
    shortLabel: 'Eat',
    description: 'Restaurants, cafes, bakeries, bars, and food stops.',
  },
  activity: {
    label: 'Activity',
    shortLabel: 'Activity',
    description: 'Tours, tickets, experiences, workshops, and events.',
  },
  hotel: {
    label: 'Hotel',
    shortLabel: 'Hotel',
    description: 'Stays, lodging, and accommodation check-in points.',
  },
  travel: {
    label: 'Travel',
    shortLabel: 'Travel',
    description: 'Flights, rail, transfers, and movement between places.',
  },
}

export interface TravelRoutePoint {
  label: string
  lat: number
  lon: number
  placeId?: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function normalizePlannerTravelMode(value: unknown): PlannerTravelDisplayMode {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  switch (normalized) {
    case 'train':
    case 'car':
    case 'ferry':
    case 'walk':
    case 'flight':
      return normalized
    case 'driving':
    case 'drive':
    case 'taxi':
      return 'car'
    case 'transit':
    case 'rail':
      return 'train'
    case 'walking':
      return 'walk'
    default:
      return 'flight'
  }
}

export function plannerCategoryLabel(category: ActivityCategory) {
  return PLANNER_CATEGORY_META[category]?.label ?? 'Activity'
}

export function plannerTravelMode(
  activity: PlannerActivity | null | undefined,
): PlannerTravelDisplayMode {
  if (!activity) {
    return 'flight'
  }
  const details = asRecord(activity.category_details)
  return normalizePlannerTravelMode(details.travel_mode)
}

export function plannerTravelModeLabel(mode: PlannerTravelDisplayMode | null | undefined) {
  return PLANNER_TRAVEL_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Flight'
}

export function plannerPrimaryPlace(
  activity: PlannerActivity | null | undefined,
): PlannerPlaceSummary | null {
  if (!activity) {
    return null
  }
  if (activity.place) {
    return activity.place
  }
  const details = asRecord(activity.category_details)
  if (activity.category === 'hotel') {
    const latitude = Number(details.latitude)
    const longitude = Number(details.longitude)
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return {
        id: String(details.place_id ?? `hotel-${activity.id}`),
        name: String(details.hotel_name ?? activity.title),
        category: 'hotel',
        address_text: typeof details.address_text === 'string' ? details.address_text : null,
        lat: latitude,
        lon: longitude,
        photo_count: 0,
        primary_photo: null,
      }
    }
  }
  return null
}

export function plannerTravelRoute(activity: PlannerActivity | null | undefined): TravelRoutePoint[] {
  if (!activity) {
    return []
  }
  if (activity.category !== 'travel') {
    return []
  }
  const details = asRecord(activity.category_details)
  const originGeo = asRecord(details.origin_geo)
  const destinationGeo = asRecord(details.destination_geo)
  const originLat = Number(originGeo.lat)
  const originLon = Number(originGeo.lon)
  const destinationLat = Number(destinationGeo.lat)
  const destinationLon = Number(destinationGeo.lon)

  const points: TravelRoutePoint[] = []
  if (Number.isFinite(originLat) && Number.isFinite(originLon)) {
    points.push({
      label: typeof details.origin_text === 'string' ? details.origin_text : 'Origin',
      lat: originLat,
      lon: originLon,
      placeId: typeof details.origin_place_id === 'string' ? details.origin_place_id : null,
    })
  }
  if (Number.isFinite(destinationLat) && Number.isFinite(destinationLon)) {
    points.push({
      label:
        typeof details.destination_text === 'string' ? details.destination_text : 'Destination',
      lat: destinationLat,
      lon: destinationLon,
      placeId:
        typeof details.destination_place_id === 'string' ? details.destination_place_id : null,
    })
  }
  return points
}

export function plannerCategoryDescription(activity: PlannerActivity | null | undefined) {
  if (!activity) {
    return null
  }
  const details = asRecord(activity.category_details)
  if (activity.category === 'travel') {
    const origin = typeof details.origin_text === 'string' ? details.origin_text : null
    const destination =
      typeof details.destination_text === 'string' ? details.destination_text : null
    const modeLabel = plannerTravelModeLabel(normalizePlannerTravelMode(details.travel_mode))
    if (origin && destination) {
      return `${modeLabel} · ${origin} to ${destination}`
    }
  }
  if (activity.category === 'hotel') {
    const hotelName = typeof details.hotel_name === 'string' ? details.hotel_name : null
    const address = typeof details.address_text === 'string' ? details.address_text : null
    return hotelName || address || activity.place?.address_text || null
  }
  return activity.place?.name ?? activity.place?.address_text ?? null
}
