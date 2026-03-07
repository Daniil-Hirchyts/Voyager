import { addDays, differenceInMinutes, startOfDay } from 'date-fns'
import type { PlannerActivity } from '@/shared/api/types'

export interface CalendarActivityEvent {
  activity: PlannerActivity
  start: Date
  end: Date
}

export interface PositionedCalendarActivity {
  event: CalendarActivityEvent
  top: number
  height: number
  left: number
  width: number
}

function toDate(dayDate: string, timeValue: string | null) {
  if (!timeValue) return null
  const [hoursRaw, minutesRaw = '0'] = timeValue.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null
  }

  const date = new Date(dayDate)
  date.setHours(hours, minutes, 0, 0)
  return date
}

function overlaps(a: CalendarActivityEvent, b: CalendarActivityEvent) {
  return a.start < b.end && b.start < a.end
}

function assignColumns(events: CalendarActivityEvent[]) {
  const assignments = new Map<string, { column: number; totalColumns: number }>()
  if (!events.length) return assignments

  const sorted = [...events].sort((a, b) => {
    const startDiff = a.start.getTime() - b.start.getTime()
    if (startDiff !== 0) return startDiff
    return b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime())
  })

  const groups: CalendarActivityEvent[][] = []
  const seen = new Set<string>()

  for (const event of sorted) {
    if (seen.has(event.activity.id)) continue
    const group = [event]
    seen.add(event.activity.id)

    let found = true
    while (found) {
      found = false
      for (const candidate of sorted) {
        if (seen.has(candidate.activity.id)) continue
        if (!group.some((groupEvent) => overlaps(groupEvent, candidate))) continue
        group.push(candidate)
        seen.add(candidate.activity.id)
        found = true
      }
    }

    groups.push(group)
  }

  for (const group of groups) {
    const columns: CalendarActivityEvent[][] = []
    group.sort((a, b) => a.start.getTime() - b.start.getTime())

    for (const event of group) {
      let placed = false
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        if (columns[columnIndex].some((columnEvent) => overlaps(columnEvent, event))) continue
        columns[columnIndex].push(event)
        assignments.set(event.activity.id, { column: columnIndex, totalColumns: 0 })
        placed = true
        break
      }

      if (placed) continue

      columns.push([event])
      assignments.set(event.activity.id, {
        column: columns.length - 1,
        totalColumns: 0,
      })
    }

    for (const event of group) {
      const assignment = assignments.get(event.activity.id)
      if (assignment) {
        assignment.totalColumns = columns.length
      }
    }
  }

  return assignments
}

export function toCalendarActivityEvent(
  dayDate: string,
  activity: PlannerActivity,
): CalendarActivityEvent | null {
  if (!activity.start_time) return null

  const start = toDate(dayDate, activity.start_time)
  const end = toDate(dayDate, activity.end_time ?? activity.start_time)
  if (!start || !end) return null

  const safeEnd =
    end.getTime() > start.getTime()
      ? end
      : new Date(start.getTime() + Math.max(activity.duration_min ?? 45, 30) * 60 * 1000)

  return {
    activity,
    start,
    end: safeEnd,
  }
}

export function calculatePositionedActivities(
  events: CalendarActivityEvent[],
  dayDate: Date,
  options: {
    startHour?: number
    endHour?: number
    rightGapPercent?: number
  } = {},
): PositionedCalendarActivity[] {
  const startHour = options.startHour ?? 6
  const endHour = options.endHour ?? 23
  const rightGapPercent = options.rightGapPercent ?? 6
  const dayStart = startOfDay(dayDate)
  const windowStart = new Date(dayStart)
  windowStart.setHours(startHour, 0, 0, 0)
  const windowEnd = new Date(dayStart)
  windowEnd.setHours(endHour, 0, 0, 0)
  const nextDay = addDays(dayStart, 1)
  const totalMinutes = Math.max(differenceInMinutes(windowEnd, windowStart), 60)

  const visibleEvents = events.filter((event) => event.start < nextDay && event.end > windowStart)
  if (!visibleEvents.length) return []

  const assignments = assignColumns(visibleEvents)

  return visibleEvents.map((event) => {
    const assignment = assignments.get(event.activity.id) ?? { column: 0, totalColumns: 1 }
    const effectiveStart = event.start > windowStart ? event.start : windowStart
    const effectiveEnd = event.end < windowEnd ? event.end : windowEnd
    const minutesFromWindowStart = differenceInMinutes(effectiveStart, windowStart)
    const durationMinutes = Math.max(differenceInMinutes(effectiveEnd, effectiveStart), 30)
    const top = (minutesFromWindowStart / totalMinutes) * 100
    const height = (durationMinutes / totalMinutes) * 100

    const overlapAmount = 8
    let left = 0
    let width = 100 - rightGapPercent
    if (assignment.totalColumns > 1) {
      const eventWidth =
        (100 - rightGapPercent + overlapAmount * (assignment.totalColumns - 1)) /
        assignment.totalColumns
      left = assignment.column * (eventWidth - overlapAmount)
      width =
        assignment.column === assignment.totalColumns - 1
          ? 100 - rightGapPercent - left
          : eventWidth
    }

    return {
      event,
      top,
      height,
      left,
      width,
    }
  })
}
