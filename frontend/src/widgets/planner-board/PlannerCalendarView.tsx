import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  addWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
  getWeek,
  isToday,
  isWithinInterval,
  parseISO,
  startOfWeek,
  subDays,
  subWeeks,
} from 'date-fns'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  GripVertical,
  MapPin,
  PanelTop,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { resolvePhotoUrl } from '@/shared/lib/media'
import type { PlannerActivity, PlannerDay, Trip } from '@/shared/api/types'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { calculatePositionedActivities, toCalendarActivityEvent } from './calendar-utils'

const WEEK_STARTS_ON = 1
const HOUR_HEIGHT = 72
const HEADER_HEIGHT = 92
const UNSCHEDULED_HEIGHT = 118
const TIME_AXIS_WIDTH = 92
const SNAP_MINUTES = 15
const DEFAULT_DURATION = 90
const MIN_DURATION = 15
const AUTO_SCROLL_EDGE = 56
const AUTO_SCROLL_STEP = 18

type CalendarMode = 'day' | 'week'

type ScheduleDraft = {
  targetDayId: string
  targetDate: string
  startTime: string | null
  durationMin: number
}

type InteractionSession = {
  activity: PlannerActivity
  source: 'timed' | 'unscheduled'
  mode: 'drag' | 'resize-top' | 'resize-bottom'
  originDayId: string
  originDate: string
  originStartTime: string | null
  originDurationMin: number
  originStartMinutes: number | null
  originEndMinutes: number | null
  pointerOffsetMinutes: number
  startClientX: number
  startClientY: number
  hasMoved: boolean
  draft: ScheduleDraft
}

type VisibleCalendarDay = {
  date: Date
  isoDate: string
  plannerDay: PlannerDay | null
  isToday: boolean
  isTripWindow: boolean
}

interface PlannerCalendarViewProps {
  trip: Trip
  days: PlannerDay[]
  anchorDate: string
  calendarView: CalendarMode
  selectedActivityId: string | null
  onDateChange: (date: string) => void
  onCalendarViewChange: (view: CalendarMode) => void
  onSelectActivity: (activity: PlannerActivity | null) => void
  onCommitScheduleChange: (payload: {
    activity: PlannerActivity
    targetDayId: string
    targetDate: string
    startTime: string | null
    durationMin: number
  }) => Promise<void>
}

function parseDay(isoDate: string) {
  return parseISO(isoDate)
}

function toIsoDate(value: Date) {
  return format(value, 'yyyy-MM-dd')
}

function timeToMinutes(value: string | null | undefined) {
  if (!value) return null
  const [hoursRaw, minutesRaw = '0'] = value.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

function minutesToTimeString(value: number) {
  const clamped = Math.max(0, Math.min(value, 23 * 60 + 59))
  const hours = Math.floor(clamped / 60)
  const minutes = clamped % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function roundToStep(value: number) {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES
}

function clamp(value: number, min: number, max: number) {
  if (value < min) return min
  if (value > max) return max
  return value
}

function resolveDuration(activity: PlannerActivity) {
  const fromDuration = Number(activity.duration_min)
  if (Number.isFinite(fromDuration) && fromDuration > 0) {
    return fromDuration
  }
  const startMinutes = timeToMinutes(activity.start_time)
  const endMinutes = timeToMinutes(activity.end_time)
  if (startMinutes != null && endMinutes != null && endMinutes > startMinutes) {
    return endMinutes - startMinutes
  }
  return DEFAULT_DURATION
}

function deriveEndTime(startTime: string | null, durationMin: number) {
  const startMinutes = timeToMinutes(startTime)
  if (startMinutes == null) return null
  const total = Math.min(startMinutes + durationMin, 24 * 60)
  if (total >= 24 * 60) {
    return '24:00'
  }
  return minutesToTimeString(total)
}

function buildVisibleDays(trip: Trip, days: PlannerDay[], anchorDate: string, calendarView: CalendarMode) {
  const dayMap = new Map(days.map((day) => [day.date, day]))
  const tripRange = {
    start: parseDay(trip.start_date),
    end: parseDay(trip.end_date),
  }
  const fallbackDate = days[0]?.date ?? trip.start_date
  const anchor = parseDay(anchorDate || fallbackDate)
  const periodDays =
    calendarView === 'day'
      ? [anchor]
      : eachDayOfInterval({
          start: startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON }),
        })

  return periodDays.map((date) => {
    const isoDate = toIsoDate(date)
    return {
      date,
      isoDate,
      plannerDay: dayMap.get(isoDate) ?? null,
      isToday: isToday(date),
      isTripWindow: isWithinInterval(date, tripRange),
    }
  })
}

function dayRangeLabel(visibleDays: VisibleCalendarDay[], calendarView: CalendarMode) {
  if (!visibleDays.length) return ''
  if (calendarView === 'day') {
    return format(visibleDays[0].date, 'EEEE, MMM d, yyyy')
  }

  const first = visibleDays[0].date
  const last = visibleDays[visibleDays.length - 1].date
  const sameMonth = format(first, 'MMMM yyyy') === format(last, 'MMMM yyyy')
  if (sameMonth) {
    return `${format(first, 'MMMM d')} - ${format(last, 'd, yyyy')}`
  }
  return `${format(first, 'MMM d')} - ${format(last, 'MMM d, yyyy')}`
}

function activityKey(activity: PlannerActivity) {
  return `${activity.id}:${activity.trip_day_id}`
}

function schedulesMatch(session: InteractionSession, draft: ScheduleDraft) {
  return (
    session.originDayId === draft.targetDayId &&
    (session.originStartTime ?? null) === (draft.startTime ?? null) &&
    session.originDurationMin === draft.durationMin
  )
}

function activitySummaryLabel(activity: PlannerActivity) {
  if (!activity.start_time) {
    return 'Unscheduled'
  }
  const duration = resolveDuration(activity)
  return `${activity.start_time} · ${duration}m`
}

function useCurrentTime() {
  const [value, setValue] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setValue(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  return value
}

export function PlannerCalendarView({
  trip,
  days,
  anchorDate,
  calendarView,
  selectedActivityId,
  onDateChange,
  onCalendarViewChange,
  onSelectActivity,
  onCommitScheduleChange,
}: PlannerCalendarViewProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const timedGridRef = useRef<HTMLDivElement | null>(null)
  const unscheduledRowRef = useRef<HTMLDivElement | null>(null)
  const interactionRef = useRef<InteractionSession | null>(null)
  const suppressClickRef = useRef<string | null>(null)
  const clearSuppressRef = useRef<number | null>(null)
  const [interaction, setInteraction] = useState<InteractionSession | null>(null)
  const [popoverActivityId, setPopoverActivityId] = useState<string | null>(selectedActivityId)
  const now = useCurrentTime()

  useEffect(() => {
    setPopoverActivityId(selectedActivityId)
  }, [selectedActivityId])

  useEffect(() => {
    return () => {
      if (clearSuppressRef.current != null) {
        window.clearTimeout(clearSuppressRef.current)
      }
    }
  }, [])

  const visibleDays = useMemo(
    () => buildVisibleDays(trip, days, anchorDate, calendarView),
    [anchorDate, calendarView, days, trip],
  )

  const dayColumnWidth = calendarView === 'day' ? 720 : 280
  const contentWidth = Math.max(dayColumnWidth * visibleDays.length, 900)
  const totalHeight = HOUR_HEIGHT * 24

  const activityDateMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const day of days) {
      for (const activity of day.activities) {
        map.set(activity.id, day.date)
      }
    }
    return map
  }, [days])

  const interactiveActivityId = interaction?.activity.id ?? null

  const timedLayoutsByDate = useMemo(() => {
    const result = new Map<
      string,
      ReturnType<typeof calculatePositionedActivities>
    >()

    for (const visibleDay of visibleDays) {
      const plannerDay = visibleDay.plannerDay
      const baseActivities = plannerDay?.activities.filter(
        (activity) => activity.start_time && activity.id !== interactiveActivityId,
      ) ?? []

      const draftActivities =
        interaction &&
        interaction.draft.startTime &&
        interaction.draft.targetDate === visibleDay.isoDate
          ? [
              {
                ...interaction.activity,
                trip_day_id: interaction.draft.targetDayId,
                start_time: interaction.draft.startTime,
                end_time: deriveEndTime(interaction.draft.startTime, interaction.draft.durationMin),
                duration_min: interaction.draft.durationMin,
              },
            ]
          : []

      const events = [...baseActivities, ...draftActivities]
        .map((activity) => toCalendarActivityEvent(visibleDay.isoDate, activity))
        .filter((event): event is NonNullable<typeof event> => Boolean(event))

      result.set(
        visibleDay.isoDate,
        calculatePositionedActivities(events, visibleDay.date, {
          startHour: 0,
          endHour: 24,
          rightGapPercent: calendarView === 'day' ? 0 : 5,
        }),
      )
    }

    return result
  }, [calendarView, interaction, interactiveActivityId, visibleDays])

  const unscheduledActivitiesByDate = useMemo(() => {
    const result = new Map<string, PlannerActivity[]>()

    for (const visibleDay of visibleDays) {
      const plannerDay = visibleDay.plannerDay
      const baseActivities = plannerDay?.activities.filter(
        (activity) => !activity.start_time && activity.id !== interactiveActivityId,
      ) ?? []

      const withDraft =
        interaction &&
        interaction.draft.startTime == null &&
        interaction.draft.targetDate === visibleDay.isoDate
          ? [
              ...baseActivities,
              {
                ...interaction.activity,
                trip_day_id: interaction.draft.targetDayId,
                start_time: null,
                end_time: null,
                duration_min: interaction.draft.durationMin,
              },
            ]
          : baseActivities

      result.set(visibleDay.isoDate, withDraft)
    }

    return result
  }, [interaction, interactiveActivityId, visibleDays])

  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  const moveToPrevious = () => {
    const anchor = parseDay(anchorDate)
    const next = calendarView === 'day' ? subDays(anchor, 1) : subWeeks(anchor, 1)
    onDateChange(toIsoDate(next))
  }

  const moveToNext = () => {
    const anchor = parseDay(anchorDate)
    const next = calendarView === 'day' ? addDays(anchor, 1) : addWeeks(anchor, 1)
    onDateChange(toIsoDate(next))
  }

  const moveToToday = () => {
    onDateChange(toIsoDate(new Date()))
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable) {
        return
      }

      if (event.key === 'Escape') {
        setPopoverActivityId(null)
        onSelectActivity(null)
        return
      }

      if (event.key === 't' || event.key === 'T') {
        event.preventDefault()
        moveToToday()
        return
      }

      if (event.key === 'd' || event.key === 'D') {
        event.preventDefault()
        onCalendarViewChange('day')
        return
      }

      if (event.key === 'w' || event.key === 'W') {
        event.preventDefault()
        onCalendarViewChange('week')
        return
      }

      if (event.key === 'j' || event.key === 'J' || event.key === 'ArrowLeft') {
        event.preventDefault()
        moveToPrevious()
        return
      }

      if (event.key === 'k' || event.key === 'K' || event.key === 'ArrowRight') {
        event.preventDefault()
        moveToNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [anchorDate, calendarView, onCalendarViewChange, onDateChange, onSelectActivity])

  const projectDraft = (session: InteractionSession, clientX: number, clientY: number) => {
    const timedGrid = timedGridRef.current
    const unscheduledRow = unscheduledRowRef.current
    const viewport = viewportRef.current
    if (!timedGrid || !unscheduledRow || !viewport || visibleDays.length === 0) {
      return session.draft
    }

    const timedRect = timedGrid.getBoundingClientRect()
    const unscheduledRect = unscheduledRow.getBoundingClientRect()
    const relativeX = clientX - timedRect.left
    const columnWidth = timedRect.width / visibleDays.length
    const columnIndex = clamp(Math.floor(relativeX / columnWidth), 0, visibleDays.length - 1)
    const visibleDay = visibleDays[columnIndex]
    const targetPlannerDay = visibleDay.plannerDay
    if (!targetPlannerDay) {
      return session.draft
    }

    if (session.mode === 'drag') {
      if (clientY <= unscheduledRect.bottom) {
        return {
          targetDayId: targetPlannerDay.id,
          targetDate: targetPlannerDay.date,
          startTime: null,
          durationMin: session.originDurationMin,
        }
      }

      const nearTop = clientY - timedRect.top < AUTO_SCROLL_EDGE
      const nearBottom = timedRect.bottom - clientY < AUTO_SCROLL_EDGE
      if (nearTop) {
        viewport.scrollTop = Math.max(0, viewport.scrollTop - AUTO_SCROLL_STEP)
      } else if (nearBottom) {
        viewport.scrollTop += AUTO_SCROLL_STEP
      }

      const relativeY = clientY - timedRect.top
      const pointerMinutes = roundToStep((relativeY / HOUR_HEIGHT) * 60)
      const startMinutes =
        session.source === 'timed'
          ? pointerMinutes - session.pointerOffsetMinutes
          : pointerMinutes
      const clampedStart = clamp(startMinutes, 0, 1440 - session.originDurationMin)

      return {
        targetDayId: targetPlannerDay.id,
        targetDate: targetPlannerDay.date,
        startTime: minutesToTimeString(clampedStart),
        durationMin: session.originDurationMin,
      }
    }

    const startMinutes = session.originStartMinutes ?? 0
    const endMinutes = session.originEndMinutes ?? startMinutes + session.originDurationMin
    const relativeY = clientY - timedRect.top
    const snappedMinutes = clamp(roundToStep((relativeY / HOUR_HEIGHT) * 60), 0, 1440)

    if (session.mode === 'resize-bottom') {
      const nextEnd = clamp(snappedMinutes, startMinutes + MIN_DURATION, 1440)
      return {
        ...session.draft,
        durationMin: nextEnd - startMinutes,
      }
    }

    const nextStart = clamp(snappedMinutes, 0, endMinutes - MIN_DURATION)
    return {
      ...session.draft,
      startTime: minutesToTimeString(nextStart),
      durationMin: endMinutes - nextStart,
    }
  }

  const beginInteraction = (
    event: React.PointerEvent,
    activity: PlannerActivity,
    source: 'timed' | 'unscheduled',
    mode: InteractionSession['mode'],
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setPopoverActivityId(null)

    const originDate = activityDateMap.get(activity.id)
    if (!originDate) return

    const originStartMinutes = timeToMinutes(activity.start_time)
    const originDurationMin = resolveDuration(activity)
    const originEndMinutes =
      originStartMinutes != null ? originStartMinutes + originDurationMin : null

    const timedGridRect = timedGridRef.current?.getBoundingClientRect()
    const pointerMinutes =
      timedGridRect != null
        ? roundToStep(((event.clientY - timedGridRect.top) / HOUR_HEIGHT) * 60)
        : originStartMinutes ?? 0

    const draft: ScheduleDraft = {
      targetDayId: activity.trip_day_id,
      targetDate: originDate,
      startTime: activity.start_time ?? null,
      durationMin: originDurationMin,
    }

    const session: InteractionSession = {
      activity,
      source,
      mode,
      originDayId: activity.trip_day_id,
      originDate,
      originStartTime: activity.start_time ?? null,
      originDurationMin,
      originStartMinutes,
      originEndMinutes,
      pointerOffsetMinutes:
        source === 'timed' && originStartMinutes != null ? pointerMinutes - originStartMinutes : 0,
      startClientX: event.clientX,
      startClientY: event.clientY,
      hasMoved: false,
      draft,
    }

    interactionRef.current = session
    setInteraction(session)
    document.body.style.userSelect = 'none'

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const active = interactionRef.current
      if (!active) return

      const moved =
        active.hasMoved ||
        Math.abs(pointerEvent.clientX - active.startClientX) > 4 ||
        Math.abs(pointerEvent.clientY - active.startClientY) > 4

      if (!moved) return

      const nextDraft = projectDraft(active, pointerEvent.clientX, pointerEvent.clientY)
      const nextSession = {
        ...active,
        hasMoved: true,
        draft: nextDraft,
      }
      interactionRef.current = nextSession
      setInteraction(nextSession)
      suppressClickRef.current = activity.id
    }

    const finish = () => {
      const active = interactionRef.current
      interactionRef.current = null
      setInteraction(null)
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)

      if (!active || !active.hasMoved) return

      if (!schedulesMatch(active, active.draft)) {
        void onCommitScheduleChange({
          activity: active.activity,
          targetDayId: active.draft.targetDayId,
          targetDate: active.draft.targetDate,
          startTime: active.draft.startTime,
          durationMin: active.draft.durationMin,
        })
      }

      if (clearSuppressRef.current != null) {
        window.clearTimeout(clearSuppressRef.current)
      }
      clearSuppressRef.current = window.setTimeout(() => {
        suppressClickRef.current = null
      }, 0)
    }

    const handlePointerUp = () => finish()

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }

  const handleOpenPopover = (activity: PlannerActivity) => {
    if (suppressClickRef.current === activity.id) {
      return
    }
    setPopoverActivityId((current) => (current === activity.id ? null : activity.id))
  }

  return (
    <section className="overflow-hidden rounded-[32px] border border-[var(--color-border)] bg-[rgba(255,255,255,0.82)] shadow-[0_26px_80px_rgba(32,56,83,0.08)]">
      <div className="border-b border-[var(--color-border)] bg-[linear-gradient(135deg,rgba(114,174,230,0.08),rgba(182,214,242,0.08),rgba(255,255,255,0.86))] px-6 py-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
              CalendarCN-inspired schedule
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
                {format(visibleDays[0]?.date ?? parseDay(anchorDate), 'MMMM yyyy')}
              </h2>
              {calendarView === 'week' && visibleDays[0] ? (
                <span className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                  Week {getWeek(visibleDays[0].date, { weekStartsOn: WEEK_STARTS_ON })}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              {dayRangeLabel(visibleDays, calendarView)}
            </p>
          </div>

          <div className="flex flex-col gap-3 xl:items-end">
            <Tabs
              value={calendarView}
              onValueChange={(value) => {
                if (value === 'day' || value === 'week') {
                  onCalendarViewChange(value)
                }
              }}
            >
              <TabsList className="h-11 rounded-full border border-[var(--color-border)] bg-white/85 p-1">
                <TabsTrigger value="day" className="rounded-full px-4">
                  Day
                </TabsTrigger>
                <TabsTrigger value="week" className="rounded-full px-4">
                  Week
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={moveToPrevious}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" className="rounded-full px-4" onClick={moveToToday}>
                Today
              </Button>
              <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={moveToNext}>
                <ArrowRight className="h-4 w-4" />
              </Button>
              <DatePicker value={anchorDate} onChange={onDateChange} className="w-[180px] rounded-full bg-white/85" />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
              <span className="rounded-full bg-white/80 px-3 py-1">T today</span>
              <span className="rounded-full bg-white/80 px-3 py-1">D / W switch view</span>
              <span className="rounded-full bg-white/80 px-3 py-1">J / K navigate</span>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="max-h-[76vh] overflow-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(240,246,252,0.92))]"
      >
        <div
          className="grid min-w-max"
          style={{
            gridTemplateColumns: `${TIME_AXIS_WIDTH}px minmax(${contentWidth}px, 1fr)`,
          }}
        >
          <div
            className="sticky left-0 top-0 z-40 border-r border-b border-[var(--color-border)] bg-[rgba(248,244,236,0.96)] px-4 py-4"
            style={{ height: HEADER_HEIGHT }}
          >
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              Track
            </p>
            <p className="mt-2 text-sm font-semibold text-[var(--color-text)]">Planner</p>
          </div>

          <div
            className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[rgba(255,255,255,0.92)] backdrop-blur"
            style={{ height: HEADER_HEIGHT }}
          >
            <div
              className="grid h-full"
              style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(${dayColumnWidth}px, 1fr))` }}
            >
              {visibleDays.map((day) => (
                <button
                  key={day.isoDate}
                  type="button"
                  onClick={() => {
                    onDateChange(day.isoDate)
                    if (calendarView === 'week') {
                      onCalendarViewChange('day')
                    }
                  }}
                  className={cn(
                    'group border-l border-[var(--color-border)] px-4 py-3 text-left first:border-l-0',
                    day.isToday && 'bg-[rgba(114,174,230,0.08)]',
                    !day.plannerDay && day.isTripWindow && 'bg-[rgba(182,214,242,0.06)]',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
                        {format(day.date, 'EEE')}
                      </p>
                      <div className="mt-2 flex items-end gap-2">
                        <span className="text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text)]">
                          {format(day.date, 'd')}
                        </span>
                        {day.isToday ? (
                          <span className="rounded-full bg-[var(--color-primary)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                            Today
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <span className="rounded-full border border-[var(--color-border)] bg-white/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                      {day.plannerDay ? `${day.plannerDay.activities.length} items` : day.isTripWindow ? 'Window' : 'Outside'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div
            className="sticky left-0 z-30 border-r border-b border-[var(--color-border)] bg-[rgba(248,244,236,0.96)] px-4 py-4"
            style={{ top: HEADER_HEIGHT, height: UNSCHEDULED_HEIGHT }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
              <PanelTop className="h-4 w-4 text-[var(--color-primary)]" />
              Unscheduled
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
              Drag cards here to clear the start time.
            </p>
          </div>

          <div
            ref={unscheduledRowRef}
            className="sticky z-20 border-b border-[var(--color-border)] bg-[rgba(255,255,255,0.92)] backdrop-blur"
            style={{ top: HEADER_HEIGHT, height: UNSCHEDULED_HEIGHT }}
          >
            <div
              className="grid h-full"
              style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(${dayColumnWidth}px, 1fr))` }}
            >
              {visibleDays.map((day) => {
                const items = unscheduledActivitiesByDate.get(day.isoDate) ?? []
                return (
                  <div
                    key={day.isoDate}
                    className={cn(
                      'border-l border-[var(--color-border)] p-3 first:border-l-0',
                      !day.plannerDay && 'bg-[rgba(17,24,32,0.03)]',
                    )}
                  >
                    {!day.plannerDay ? (
                      <div className="flex h-full items-center justify-center rounded-[20px] border border-dashed border-[var(--color-border)] bg-white/70 px-4 text-center text-sm text-[var(--color-text-muted)]">
                        {day.isTripWindow ? 'Create a trip day to schedule here.' : 'Outside the active trip window.'}
                      </div>
                    ) : items.length === 0 ? (
                      <div className="flex h-full items-center justify-center rounded-[20px] border border-dashed border-[var(--color-border)] bg-white/70 px-4 text-center text-sm text-[var(--color-text-muted)]">
                        Drop here to keep this day flexible.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {items.map((activity) => {
                          const photo = resolvePhotoUrl(activity.place?.primary_photo, 'thumb')
                          const isOpen = popoverActivityId === activity.id
                          const isSelected = selectedActivityId === activity.id
                          const isPreview = interaction?.activity.id === activity.id

                          return (
                            <Popover
                              key={activityKey(activity)}
                              open={isOpen}
                              onOpenChange={(open) => setPopoverActivityId(open ? activity.id : null)}
                            >
                              <PopoverAnchor asChild>
                                <button
                                  type="button"
                                  onClick={() => handleOpenPopover(activity)}
                                  onPointerDown={(event) => beginInteraction(event, activity, 'unscheduled', 'drag')}
                                  className={cn(
                                    'group flex items-center gap-3 rounded-[20px] border bg-white/92 px-3 py-3 text-left shadow-sm transition-all',
                                    isSelected && 'border-[var(--color-primary)]/60 shadow-[0_18px_45px_rgba(32,56,83,0.14)]',
                                    isPreview && 'ring-2 ring-[var(--color-primary)]/25',
                                  )}
                                >
                                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-[linear-gradient(135deg,rgba(114,174,230,0.18),rgba(182,214,242,0.18))]">
                                    {photo ? (
                                      <img src={photo} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                      <CalendarDays className="h-4 w-4 text-[var(--color-primary)]" />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-[var(--color-text)]">{activity.title}</p>
                                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                                      <GripVertical className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                                      {activity.place?.name ? (
                                        <span className="truncate">{activity.place.name}</span>
                                      ) : (
                                        <span>Flexible slot</span>
                                      )}
                                    </div>
                                  </div>
                                </button>
                              </PopoverAnchor>

                              <ActivityPopover
                                activity={activity}
                                onOpenDetails={() => onSelectActivity(activity)}
                              />
                            </Popover>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="sticky left-0 z-10 border-r border-[var(--color-border)] bg-[rgba(248,244,236,0.94)]">
            <div className="relative" style={{ height: totalHeight }}>
              {Array.from({ length: 24 }).map((_, index) => (
                <div
                  key={index}
                  className="absolute inset-x-0 border-b border-[rgba(96,108,120,0.14)] pr-3"
                  style={{ top: index * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                >
                  <div className="-translate-y-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                    {format(new Date(2026, 0, 1, index), 'ha')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            ref={timedGridRef}
            className="relative"
            style={{ height: totalHeight }}
          >
            <div
              className="grid h-full"
              style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(${dayColumnWidth}px, 1fr))` }}
            >
              {visibleDays.map((day) => {
                const positioned = timedLayoutsByDate.get(day.isoDate) ?? []
                return (
                  <div
                    key={day.isoDate}
                    className={cn(
                      'relative border-l border-[var(--color-border)] first:border-l-0',
                      !day.plannerDay && 'bg-[rgba(17,24,32,0.03)]',
                    )}
                  >
                    <div
                      className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.3),transparent_20%),repeating-linear-gradient(180deg,rgba(96,108,120,0.14),rgba(96,108,120,0.14)_1px,transparent_1px,transparent_36px),repeating-linear-gradient(180deg,rgba(96,108,120,0.22),rgba(96,108,120,0.22)_1px,transparent_1px,transparent_72px)]"
                      aria-hidden
                    />

                    {!day.plannerDay ? (
                      <div className="absolute inset-6 flex items-center justify-center rounded-[28px] border border-dashed border-[var(--color-border)] bg-white/75 px-5 text-center text-sm text-[var(--color-text-muted)]">
                        {day.isTripWindow ? 'No trip day exists for this date yet.' : 'This date sits outside the current trip window.'}
                      </div>
                    ) : null}

                    {day.isToday ? (
                      <div
                        className="absolute inset-x-0 z-10"
                        style={{ top: (currentMinutes / 60) * HOUR_HEIGHT }}
                      >
                        <div className="flex items-center gap-2 pl-3">
                          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-danger)]" />
                          <div className="h-px flex-1 bg-[var(--color-danger)]" />
                        </div>
                      </div>
                    ) : null}

                    {positioned.map((item) => {
                      const activity = item.event.activity
                      const isOpen = popoverActivityId === activity.id
                      const isSelected = selectedActivityId === activity.id
                      const isPreview = interaction?.activity.id === activity.id
                      const photo = resolvePhotoUrl(activity.place?.primary_photo, 'thumb')
                      const summaryText = activitySummaryLabel(activity)

                      return (
                        <Popover
                          key={activity.id}
                          open={isOpen}
                          onOpenChange={(open) => setPopoverActivityId(open ? activity.id : null)}
                        >
                          <PopoverAnchor asChild>
                            <button
                              type="button"
                              onClick={() => handleOpenPopover(activity)}
                              onPointerDown={(event) => beginInteraction(event, activity, 'timed', 'drag')}
                              className={cn(
                                'absolute overflow-hidden rounded-[18px] border text-left transition-all',
                                isSelected
                                  ? 'border-[var(--color-primary)]/65 shadow-[0_22px_50px_rgba(114,174,230,0.18)]'
                                  : 'border-white/70 shadow-[0_12px_30px_rgba(12,20,27,0.12)]',
                                isPreview && 'ring-2 ring-[var(--color-primary)]/25',
                              )}
                              style={{
                                top: `${item.top}%`,
                                left: `${item.left}%`,
                                width: `${item.width}%`,
                                height: `${item.height}%`,
                                minHeight: 44,
                              }}
                            >
                              <div
                                className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,18,24,0.08),rgba(11,18,24,0.76)),linear-gradient(135deg,rgba(114,174,230,0.24),rgba(182,214,242,0.24))]"
                                style={
                                  photo
                                    ? {
                                        backgroundImage: `linear-gradient(180deg, rgba(11, 18, 24, 0.08), rgba(11, 18, 24, 0.8)), url(${photo})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                      }
                                    : undefined
                                }
                              />
                              <div className="absolute inset-y-0 left-0 w-1.5 bg-[rgba(255,255,255,0.84)]" />
                              <div className="relative flex h-full flex-col justify-between p-3 text-white">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="line-clamp-2 text-sm font-semibold leading-tight">
                                      {activity.title}
                                    </p>
                                    <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/82">
                                      {summaryText}
                                    </p>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <div
                                      aria-label="Resize start"
                                      onPointerDown={(event) => beginInteraction(event, activity, 'timed', 'resize-top')}
                                      className="h-2.5 w-7 self-end rounded-full bg-white/70"
                                      role="presentation"
                                    />
                                    <div
                                      aria-label="Resize end"
                                      onPointerDown={(event) => beginInteraction(event, activity, 'timed', 'resize-bottom')}
                                      className="mt-auto h-2.5 w-7 self-end rounded-full bg-white/70"
                                      role="presentation"
                                    />
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/90">
                                  {activity.place?.name ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-white/18 px-2 py-1 backdrop-blur-sm">
                                      <MapPin className="h-3 w-3" />
                                      {activity.place.name}
                                    </span>
                                  ) : null}
                                  {activity.source !== 'manual' ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-white/18 px-2 py-1 backdrop-blur-sm">
                                      <Sparkles className="h-3 w-3" />
                                      Generated
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-white/18 px-2 py-1 backdrop-blur-sm">
                                      Manual
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          </PopoverAnchor>

                          <ActivityPopover
                            activity={activity}
                            onOpenDetails={() => onSelectActivity(activity)}
                          />
                        </Popover>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ActivityPopover({
  activity,
  onOpenDetails,
}: {
  activity: PlannerActivity
  onOpenDetails: () => void
}) {
  const photo = resolvePhotoUrl(activity.place?.primary_photo, 'full')
  const summary = activitySummaryLabel(activity)

  return (
    <PopoverContent
      side="right"
      align="start"
      className="w-[320px] overflow-hidden rounded-[24px] border border-[var(--color-border)] bg-[rgba(255,255,255,0.94)] p-0 shadow-[0_26px_80px_rgba(32,56,83,0.16)]"
    >
      <div
        className="h-36 bg-[linear-gradient(135deg,rgba(114,174,230,0.2),rgba(182,214,242,0.22))]"
        style={
          photo
            ? {
                backgroundImage: `linear-gradient(180deg, rgba(11, 18, 24, 0.06), rgba(11, 18, 24, 0.62)), url(${photo})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      />
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
              {activity.source === 'manual' ? 'Manual activity' : 'Generated activity'}
            </p>
            <h3 className="mt-2 text-xl font-semibold leading-tight text-[var(--color-text)]">
              {activity.title}
            </h3>
          </div>
          <span className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            {summary}
          </span>
        </div>

        <div className="space-y-2 text-sm text-[var(--color-text-muted)]">
          {activity.place?.name ? (
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
              <div>
                <p className="font-medium text-[var(--color-text)]">{activity.place.name}</p>
                {activity.place.address_text ? <p>{activity.place.address_text}</p> : null}
              </div>
            </div>
          ) : null}

          <div className="flex items-start gap-2">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
            <p>{summary}</p>
          </div>
        </div>

        {activity.description ? (
          <p className="text-sm leading-6 text-[var(--color-text-muted)]">
            {activity.description}
          </p>
        ) : null}

        {activity.tags.length ? (
          <div className="flex flex-wrap gap-2">
            {activity.tags.slice(0, 6).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[var(--color-border)] bg-[rgba(248,244,236,0.9)] px-2.5 py-1 text-[11px] text-[var(--color-text-muted)]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
            Drag to move. Pull the end caps to resize.
          </p>
          <Button type="button" className="rounded-full px-4" onClick={onOpenDetails}>
            Open details
          </Button>
        </div>
      </div>
    </PopoverContent>
  )
}
