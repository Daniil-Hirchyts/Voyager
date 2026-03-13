import { parseISO } from 'date-fns'
import { differenceInCalendarDays } from 'date-fns'
import type { ActivityCreateInput } from '@/shared/api/types'
import type { CuratedDestination } from './curated-destinations'

export type EditorialTemplateActivity = Pick<
  ActivityCreateInput,
  'category' | 'title' | 'description' | 'start_time' | 'duration_min' | 'source'
>

function detectCategory(label: string): ActivityCreateInput['category'] {
  const text = label.toLowerCase()
  if (/(breakfast|brunch|lunch|dinner|cafe|coffee|tasting|bar|pastry|table|izakaya|kaiseki)/.test(text)) {
    return 'eat'
  }
  if (/(drive|day|tour|class|session|swim|soak|boat|catamaran|hammam|route|loop|trail|tango)/.test(text)) {
    return 'activity'
  }
  return 'visit'
}

function seed(
  title: string,
  description: string,
  start_time: string,
  duration_min: number,
): EditorialTemplateActivity {
  return {
    category: detectCategory(title),
    title,
    description,
    start_time,
    duration_min,
    source: 'generated',
  }
}

function routeArrivalLabel(destination: CuratedDestination) {
  switch (destination.tripType) {
    case 'culture':
      return `${destination.name} arrival breakfast and orientation`
    case 'city_break':
      return `${destination.name} neighborhood breakfast start`
    case 'outdoors':
    case 'adventure':
      return `${destination.name} scenic start and coffee stop`
    case 'leisure':
      return `${destination.name} terrace brunch opening`
    default:
      return `${destination.name} arrival breakfast and slow start`
  }
}

function routeMiddayLabel(destination: CuratedDestination) {
  switch (destination.tripType) {
    case 'culture':
      return `${destination.name} cultural district edit`
    case 'city_break':
      return `${destination.name} neighborhood edit`
    case 'outdoors':
    case 'adventure':
      return `${destination.name} scenic route window`
    case 'leisure':
      return `${destination.name} island drift and swim`
    default:
      return `${destination.name} afternoon route edit`
  }
}

function routeDinnerLabel(destination: CuratedDestination) {
  switch (destination.tripType) {
    case 'culture':
      return `Signature dinner in ${destination.name}`
    case 'city_break':
      return `Late table in ${destination.name}`
    case 'outdoors':
    case 'adventure':
      return `Scenic dinner reset in ${destination.name}`
    case 'leisure':
      return `Blue-hour dinner in ${destination.name}`
    default:
      return `Evening table in ${destination.name}`
  }
}

function fallbackDayTitle(destination: CuratedDestination, dayNumber: number) {
  switch (destination.tripType) {
    case 'culture':
      return `${destination.name} temples, tea, and slower lanes`
    case 'city_break':
      return `${destination.name} cafes, bookstores, and late energy`
    case 'outdoors':
      return `${destination.name} landscapes and comfort stops`
    case 'adventure':
      return `${destination.name} scenic drive and mixed-pace day`
    case 'leisure':
      return `${destination.name} caldera walks and long lunches`
    default:
      return `${destination.name} day ${dayNumber} route`
  }
}

function describeHighlight(destination: CuratedDestination, highlight: string) {
  return `${highlight} as a structured anchor inside a route focused on ${destination.bestFor.toLowerCase()}.`
}

function buildDayFromHighlight(
  destination: CuratedDestination,
  highlight: string,
  dayNumber: number,
): EditorialTemplateActivity[] {
  return [
    seed(
      highlight,
      describeHighlight(destination, highlight),
      '09:00',
      120,
    ),
    seed(
      `${destination.name} midday pause`,
      `${fallbackDayTitle(destination, dayNumber)} with enough room to avoid overscheduling.`,
      '13:30',
      105,
    ),
    seed(
      routeDinnerLabel(destination),
      `${destination.summary} Keep the evening long and lightly structured.`,
      '19:00',
      110,
    ),
  ]
}

function buildFallbackDay(
  destination: CuratedDestination,
  dayNumber: number,
): EditorialTemplateActivity[] {
  return [
    seed(
      routeArrivalLabel(destination),
      destination.teaser,
      '09:00',
      90,
    ),
    seed(
      routeMiddayLabel(destination),
      fallbackDayTitle(destination, dayNumber),
      '13:30',
      120,
    ),
    seed(
      routeDinnerLabel(destination),
      `A closing block shaped around ${destination.bestFor.toLowerCase()}.`,
      '19:00',
      105,
    ),
  ]
}

export function buildEditorialTemplate(destination: CuratedDestination): EditorialTemplateActivity[][] {
  const totalDays = Math.max(
    1,
    differenceInCalendarDays(parseISO(destination.endDate), parseISO(destination.startDate)) + 1,
  )

  const days: EditorialTemplateActivity[][] = []

  days.push([
    seed(
      routeArrivalLabel(destination),
      destination.teaser,
      '09:00',
      90,
    ),
    seed(
      `${destination.name} orientation route`,
      destination.summary,
      '13:30',
      135,
    ),
    seed(
      routeDinnerLabel(destination),
      `A first evening tuned to ${destination.bestFor.toLowerCase()}.`,
      '19:00',
      110,
    ),
  ])

  for (let index = 1; index < totalDays; index += 1) {
    const highlight = destination.highlights[(index - 1) % destination.highlights.length]
    if (highlight) {
      days.push(buildDayFromHighlight(destination, highlight, index + 1))
    } else {
      days.push(buildFallbackDay(destination, index + 1))
    }
  }

  return days.slice(0, totalDays)
}
