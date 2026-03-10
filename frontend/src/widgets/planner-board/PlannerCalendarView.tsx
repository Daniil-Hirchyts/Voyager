import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  addWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
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
  Clock3,
  MapPin,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { resolvePhotoUrl } from '@/shared/lib/media'
import type { PlannerActivity, PlannerDay, Trip } from '@/shared/api/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { calculatePositionedActivities, toCalendarActivityEvent } from './calendar-utils'
import { PlannerInbox } from './PlannerInbox'

const WEEK_STARTS_ON = 1
const HOUR_HEIGHT = 56
const HEADER_HEIGHT = 36
const TIME_AXIS_WIDTH = 48
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
  inboxActivities: PlannerActivity[]
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
  const anchorCandidate = parseDay(anchorDate || fallbackDate)
  const anchor =
    anchorCandidate < tripRange.start
      ? tripRange.start
      : anchorCandidate > tripRange.end
        ? tripRange.end
        : anchorCandidate
  const periodDays =
    calendarView === 'day'
      ? [anchor]
      : eachDayOfInterval({
          start: startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON }),
        }).filter((date) => isWithinInterval(date, tripRange))

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
  return `${activity.start_time} · ${duration}M`
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
  inboxActivities,
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
  const inboxRef = useRef<HTMLDivElement | null>(null)
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
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 6.5 * HOUR_HEIGHT
    }
  }, [])

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

  const dayColumnWidth = calendarView === 'day' ? 520 : 128
  const contentWidth = dayColumnWidth * visibleDays.length
  const totalHeight = HOUR_HEIGHT * 24
  const rangeLabel = dayRangeLabel(visibleDays, calendarView)
  const dayGridTemplateColumns =
    calendarView === 'day'
      ? `repeat(${visibleDays.length}, minmax(${dayColumnWidth}px, 1fr))`
      : `repeat(${visibleDays.length}, minmax(${dayColumnWidth}px, 1fr))`
  const layoutGridTemplateColumns =
    calendarView === 'day'
      ? `${TIME_AXIS_WIDTH}px minmax(${contentWidth}px, 1fr)`
      : `${TIME_AXIS_WIDTH}px minmax(0, 1fr)`

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
    const inbox = inboxRef.current
    const viewport = viewportRef.current
    if (!timedGrid || !viewport || visibleDays.length === 0) {
      return session.draft
    }

    const timedRect = timedGrid.getBoundingClientRect()
    const inboxRect = inbox?.getBoundingClientRect() ?? null
    const relativeX = clientX - timedRect.left
    const columnWidth = timedRect.width / visibleDays.length
    const columnIndex = clamp(Math.floor(relativeX / columnWidth), 0, visibleDays.length - 1)
    const visibleDay = visibleDays[columnIndex]
    const targetPlannerDay = visibleDay.plannerDay
    if (!targetPlannerDay) {
      return session.draft
    }

    if (session.mode === 'drag') {
      if (inboxRect && clientY >= inboxRect.top && clientY <= inboxRect.bottom) {
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
    if (!originDate || !activity.trip_day_id) return

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
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div ref={inboxRef} className="min-h-0">
        <PlannerInbox
          activities={inboxActivities}
          selectedActivityId={selectedActivityId}
          title="Inbox"
          className="h-full"
          onSelectActivity={(activity) => handleOpenPopover(activity)}
          onPointerDownActivity={(event, activity) => {
            if (!activity.trip_day_id) {
              return
            }
            beginInteraction(event, activity, 'unscheduled', 'drag')
          }}
        />
      </div>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-black/8 bg-white">
        <div className="border-b border-black/8 bg-white px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-[1.15rem] font-medium tracking-[-0.02em] text-[var(--color-text)]">
                  {rangeLabel}
                </h2>
              </div>
            </div>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Tabs
                value={calendarView}
                onValueChange={(value) => {
                  if (value === 'day' || value === 'week') {
                    onCalendarViewChange(value)
                  }
                }}
              >
                <TabsList className="h-8 rounded-[8px] border border-black/8 bg-[#f7f8fa] p-0.5">
                  <TabsTrigger value="day" className="h-7 rounded-[6px] px-2.5 text-[0.76rem]">
                    Day
                  </TabsTrigger>
                  <TabsTrigger value="week" className="h-7 rounded-[6px] px-2.5 text-[0.76rem]">
                    Week
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex items-center gap-1 rounded-[8px] border border-black/8 bg-[#f7f8fa] p-0.5">
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-[6px] border-none bg-transparent shadow-none hover:bg-white" onClick={moveToPrevious}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" className="h-7 rounded-[6px] border-none bg-transparent px-2.5 text-[0.84rem] shadow-none hover:bg-white" onClick={moveToToday}>
                  Today
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-[6px] border-none bg-transparent shadow-none hover:bg-white" onClick={moveToNext}>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto bg-white">
        <div
          className={cn('grid', calendarView === 'day' ? 'min-w-max' : 'min-w-full')}
          style={{
            gridTemplateColumns: layoutGridTemplateColumns,
          }}
        >
          <div
            className="sticky left-0 top-0 z-40 flex items-center justify-center border-r border-b border-black/8 bg-[#f7f8fa]"
            style={{ height: HEADER_HEIGHT }}
          >
            <p className="text-[10px] font-bold tracking-[0.05em] text-[#9ca3af] uppercase">
              Time
            </p>
          </div>

          <div
            className="sticky top-0 z-30 border-b border-black/8 bg-white"
            style={{ height: HEADER_HEIGHT }}
          >
            <div
              className="grid h-full"
              style={{ gridTemplateColumns: dayGridTemplateColumns }}
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
                    'group flex items-center gap-2 border-l border-black/6 px-4 py-0 text-left first:border-l-0 transition-colors hover:bg-black/2',
                    day.isToday && 'bg-[#f7f8fa]',
                  )}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[12px] font-semibold uppercase tracking-wider text-[#6b7280]">
                      {format(day.date, 'EEE')}
                    </span>
                    <span className="text-[16px] font-bold text-[#111827]">
                      {format(day.date, 'd')}
                    </span>
                  </div>
                  {day.isToday && (
                    <span className="rounded-full bg-[var(--color-text)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
                      Today
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="sticky left-0 z-10 border-r border-black/6 bg-[#f7f8fa]">
            <div className="relative mt-4 mb-4" style={{ height: totalHeight }}>
              {Array.from({ length: 24 }).map((_, index) => (
                <div
                  key={index}
                  className="absolute w-full pr-3 flex justify-end"
                  style={{ top: index * HOUR_HEIGHT }}
                >
                  <div className="-translate-y-2.5 text-[11px] font-medium text-[#6b7280]">
                    {format(new Date(2026, 0, 1, index), 'h a')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            ref={timedGridRef}
            className="relative mt-4 mb-4"
            style={{ height: totalHeight }}
          >
            <div
              className="grid h-full"
              style={{ gridTemplateColumns: dayGridTemplateColumns }}
            >
              {visibleDays.map((day) => {
                const positioned = timedLayoutsByDate.get(day.isoDate) ?? []
                return (
                  <div
                    key={day.isoDate}
                    className={cn(
                      'relative border-l border-black/6 first:border-l-0',
                    )}
                  >
                    <div
                      className="absolute inset-0 bg-[repeating-linear-gradient(180deg,rgba(17,24,39,0.05),rgba(17,24,39,0.05)_1px,transparent_1px,transparent_28px),repeating-linear-gradient(180deg,rgba(17,24,39,0.08),rgba(17,24,39,0.08)_1px,transparent_1px,transparent_56px)]"
                      aria-hidden
                    />

                    {!day.plannerDay ? (
                      <div className="absolute inset-4 flex items-center justify-center rounded-[14px] border border-dashed border-black/8 bg-white px-5 text-center text-sm text-[var(--color-text-muted)]">
                        No trip day exists for this date yet.
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
                                'absolute overflow-hidden rounded-[16px] border text-left transition-all',
                                isSelected
                                  ? 'border-black/20 shadow-[0_12px_32px_rgba(12,20,27,0.12)] ring-2 ring-[var(--color-primary)] ring-offset-1'
                                  : 'border-black/8 shadow-[0_4px_12px_rgba(12,20,27,0.06)] hover:border-black/16 hover:shadow-[0_8px_24px_rgba(12,20,27,0.08)]',
                                isPreview && 'opacity-60 ring-2 ring-black/8 ring-offset-1',
                                'bg-white',
                              )}
                              style={{
                                top: `${item.top}%`,
                                left: `${item.left}%`,
                                width: `${item.width}%`,
                                height: `${item.height}%`,
                                minHeight: 48,
                              }}
                            >
                              <div className="relative flex h-full items-start gap-3 px-3 py-2.5 text-[var(--color-text)]">
                                {photo && (
                                  <div 
                                    className="absolute inset-y-0 right-0 w-1/2 opacity-20 pointer-events-none"
                                    style={{
                                      backgroundImage: `url(${photo})`,
                                      backgroundSize: 'cover',
                                      backgroundPosition: 'center',
                                      maskImage: 'linear-gradient(to left, black, transparent)',
                                      WebkitMaskImage: 'linear-gradient(to left, black, transparent)',
                                    }}
                                  />
                                )}
                                <div
                                  aria-label="Resize start"
                                  onPointerDown={(event) => beginInteraction(event, activity, 'timed', 'resize-top')}
                                  className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize z-10"
                                  role="presentation"
                                />
                                
                                <div className="z-10 flex-1 min-w-0 pointer-events-none">
                                  <div className="flex flex-col h-full justify-between">
                                    <div className="min-w-0">
                                      <p className="line-clamp-2 text-[13px] font-bold leading-tight text-[var(--color-text)]">
                                        {activity.title}
                                      </p>
                                      <div className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-[var(--color-text-muted)]">
                                        <Clock3 className="h-3 w-3" />
                                        <span>{summaryText}</span>
                                      </div>
                                    </div>

                                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                      {activity.place?.name ? (
                                        <div className="flex max-w-full items-center gap-1.5 pointer-events-auto">
                                          <MapPin className="h-2.5 w-2.5 shrink-0 text-[var(--color-text-muted)]" />
                                          <span className="truncate text-[10px] font-medium leading-none text-[var(--color-text-muted)]">
                                            {activity.place.name}
                                          </span>
                                        </div>
                                      ) : null}
                                      {activity.source !== 'manual' && (
                                        <div className="flex items-center gap-1 pointer-events-auto">
                                          <Sparkles className="h-2.5 w-2.5 text-[var(--color-text-muted)]" />
                                          <span className="text-[10px] font-medium leading-none text-[var(--color-text-muted)] uppercase tracking-wider">AI</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div
                                  aria-label="Resize end"
                                  onPointerDown={(event) => beginInteraction(event, activity, 'timed', 'resize-bottom')}
                                  className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize z-10"
                                  role="presentation"
                                />
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

          <div className="sticky left-0 border-r border-t border-black/6 bg-[#f7f8fa] px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#9ca3af]">
              Untimed
            </p>
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              Flexible day activities
            </p>
          </div>

          <div className="border-t border-black/8">
            <div className="grid" style={{ gridTemplateColumns: dayGridTemplateColumns }}>
              {visibleDays.map((day) => {
                const untimedActivities = unscheduledActivitiesByDate.get(day.isoDate) ?? []
                return (
                  <div
                    key={`${day.isoDate}-untimed`}
                    className="min-h-[148px] border-l border-black/6 px-3 py-3 first:border-l-0"
                  >
                    {untimedActivities.length === 0 ? (
                      <div className="flex min-h-[116px] items-center justify-center rounded-[14px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] px-4 text-center text-xs text-[var(--color-text-muted)]">
                        No untimed activities for this day.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {untimedActivities.map((activity) => {
                          const isOpen = popoverActivityId === activity.id
                          const isSelected = selectedActivityId === activity.id
                          const isPreview = interaction?.activity.id === activity.id
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
                                  onPointerDown={(event) => beginInteraction(event, activity, 'unscheduled', 'drag')}
                                  className={cn(
                                    'flex w-full flex-col items-start gap-2 rounded-[14px] border bg-white px-3 py-3 text-left shadow-[0_6px_18px_rgba(15,23,42,0.05)] transition-colors',
                                    isSelected
                                      ? 'border-black/20 ring-2 ring-[var(--color-primary)] ring-offset-1'
                                      : 'border-black/8 hover:border-black/16 hover:bg-[#fcfcfd]',
                                    isPreview && 'opacity-60',
                                  )}
                                >
                                  <div className="flex w-full items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-secondary-surface)] px-2.5 py-1 text-[0.68rem] font-medium text-[var(--color-text-muted)]">
                                      <Clock3 className="h-3.5 w-3.5" />
                                      Untimed
                                    </span>
                                    {activity.source !== 'manual' ? (
                                      <Sparkles className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                                    ) : null}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="line-clamp-2 text-[0.82rem] font-medium leading-5 text-[var(--color-text)]">
                                      {activity.title}
                                    </p>
                                    {activity.place?.name ? (
                                      <div className="mt-1.5 inline-flex min-w-0 items-center gap-1.5 text-[0.72rem] text-[var(--color-text-muted)]">
                                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                                        <span className="truncate">{activity.place.name}</span>
                                      </div>
                                    ) : null}
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
        </div>
        </div>
      </section>
    </div>
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
