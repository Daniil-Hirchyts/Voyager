import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  getFirstCollision,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  CalendarDays,
  LayoutGrid,
  MapPinned,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useGenerateItinerary, useJob, useRegenerateItinerary, useResetItinerary } from '@/entities/job/queries'
import { useTripOffers } from '@/entities/offer/queries'
import { getPlanner, LEGACY_DAY_UNTIMED_TAG, LEGACY_INBOX_TAG } from '@/entities/planner/api'
import { plannerKeys, usePlanner } from '@/entities/planner/queries'
import { isConflict, isRateLimit } from '@/shared/api/client'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { cn } from '@/shared/lib/cn'
import { formatMoney } from '@/shared/lib/format'
import { isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs'
import { usePlannerStore } from '@/shared/stores/planner.store'
import type {
  ActivityCreateInput,
  Offer,
  PlannerActivity,
  PlannerGenerationReport,
  PlannerResponse,
  TripGenerateInput,
} from '@/shared/api/types'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppShellHeaderActions, useAppShellHeaderMeta } from '@/widgets/app-shell'
import { ActivityCardView } from './ActivityCard'
import { ActivityDetailsDrawer } from './ActivityDetailsDrawer'
import { ActivityDrawer } from './ActivityDrawer'
import { DayColumn } from './DayColumn'
import { GenerationControls } from './GenerationControls'
import { PlannerCalendarView } from './PlannerCalendarView'
import { PlannerInbox } from './PlannerInbox'
import { PlannerMapView } from './PlannerMapView'

interface Props {
  tripId: string
}

type PlannerView = 'kanban' | 'calendar' | 'map'
type PlannerCalendarMode = 'day' | 'week'
type PlannerContainerId = 'inbox' | string
type ActivityLocation = {
  containerId: PlannerContainerId
  dayId: string | null
  index: number
}
type EditorState = {
  activityId: string | null
  defaultTripDayId: string | null
} | null

const INBOX_CONTAINER_ID = 'inbox'
const CHIP_PREFIX = 'chip::'
const END_SUFFIX = '::end'
const EDGE_SCROLL_THRESHOLD = 80
const EDGE_SCROLL_STEP = 18

function getView(raw: string | null): PlannerView {
  return raw === 'calendar' || raw === 'map' ? raw : 'kanban'
}

function getCalendarView(raw: string | null): PlannerCalendarMode {
  return raw === 'day' ? 'day' : 'week'
}

function clonePlanner(planner: PlannerResponse): PlannerResponse {
  return {
    trip: { ...planner.trip },
    legacy_inbox_mode: planner.legacy_inbox_mode,
    inbox_activities: planner.inbox_activities.map((activity) => ({ ...activity })),
    days: planner.days.map((day) => ({
      ...day,
      activities: day.activities.map((activity) => ({ ...activity })),
    })),
  }
}

function withPlannerInternalTags(
  tags: string[] | undefined,
  options: { inbox?: boolean; dayUntimed?: boolean } = {},
) {
  const next = (tags ?? []).filter(
    (tag) => tag !== LEGACY_INBOX_TAG && tag !== LEGACY_DAY_UNTIMED_TAG,
  )
  if (options.inbox) {
    next.push(LEGACY_INBOX_TAG)
  }
  if (options.dayUntimed) {
    next.push(LEGACY_DAY_UNTIMED_TAG)
  }
  return next
}

function getEndZoneId(containerId: PlannerContainerId) {
  return `${containerId}${END_SUFFIX}`
}

function getChipId(containerId: PlannerContainerId) {
  return `${CHIP_PREFIX}${containerId}`
}

function normalizeActivityList(
  activities: PlannerActivity[],
  tripDayId: string | null,
) {
  return activities.map((activity, index) => ({
    ...activity,
    trip_day_id: tripDayId,
    order_index: index,
    start_time: tripDayId == null ? null : activity.start_time,
    end_time: tripDayId == null ? null : activity.end_time,
  }))
}

function getContainerActivities(planner: PlannerResponse, containerId: PlannerContainerId) {
  if (containerId === INBOX_CONTAINER_ID) {
    return planner.inbox_activities
  }
  return planner.days.find((day) => day.id === containerId)?.activities ?? []
}

function setContainerActivities(
  planner: PlannerResponse,
  containerId: PlannerContainerId,
  activities: PlannerActivity[],
) {
  if (containerId === INBOX_CONTAINER_ID) {
    planner.inbox_activities = normalizeActivityList(activities, null)
    return
  }
  const day = planner.days.find((item) => item.id === containerId)
  if (!day) {
    return
  }
  day.activities = normalizeActivityList(activities, day.id)
}

function findActivityLocation(planner: PlannerResponse | undefined, activityId: string | null): ActivityLocation | null {
  if (!planner || !activityId) {
    return null
  }

  const inboxIndex = planner.inbox_activities.findIndex((activity) => activity.id === activityId)
  if (inboxIndex >= 0) {
    return {
      containerId: INBOX_CONTAINER_ID,
      dayId: null,
      index: inboxIndex,
    }
  }

  for (const day of planner.days) {
    const index = day.activities.findIndex((activity) => activity.id === activityId)
    if (index >= 0) {
      return {
        containerId: day.id,
        dayId: day.id,
        index,
      }
    }
  }

  return null
}

function findActivity(planner: PlannerResponse | undefined, activityId: string | null) {
  if (!planner || !activityId) {
    return null
  }

  const inboxActivity = planner.inbox_activities.find((activity) => activity.id === activityId)
  if (inboxActivity) {
    return inboxActivity
  }

  for (const day of planner.days) {
    const found = day.activities.find((activity) => activity.id === activityId)
    if (found) {
      return found
    }
  }

  return null
}

function resolveDropTarget(planner: PlannerResponse | undefined, overId: string | null): ActivityLocation | null {
  if (!planner || !overId) {
    return null
  }

  if (overId.startsWith(CHIP_PREFIX)) {
    const containerId = overId.slice(CHIP_PREFIX.length)
    if (containerId === INBOX_CONTAINER_ID) {
      return {
        containerId,
        dayId: null,
        index: planner.inbox_activities.length,
      }
    }
    const day = planner.days.find((item) => item.id === containerId)
    return day
      ? {
          containerId: day.id,
          dayId: day.id,
          index: day.activities.length,
        }
      : null
  }

  if (overId === INBOX_CONTAINER_ID || overId === getEndZoneId(INBOX_CONTAINER_ID)) {
    return {
      containerId: INBOX_CONTAINER_ID,
      dayId: null,
      index: planner.inbox_activities.length,
    }
  }

  if (overId.endsWith(END_SUFFIX)) {
    const containerId = overId.slice(0, -END_SUFFIX.length)
    const day = planner.days.find((item) => item.id === containerId)
    return day
      ? {
          containerId: day.id,
          dayId: day.id,
          index: day.activities.length,
        }
      : null
  }

  if (planner.days.some((day) => day.id === overId)) {
    const day = planner.days.find((item) => item.id === overId)
    return day
      ? {
          containerId: day.id,
          dayId: day.id,
          index: day.activities.length,
        }
      : null
  }

  return findActivityLocation(planner, overId)
}

function updatePlannerActivityLists(
  planner: PlannerResponse,
  activityId: string,
  target: ActivityLocation,
) {
  const source = findActivityLocation(planner, activityId)
  if (!source) {
    return null
  }

  const nextPlanner = clonePlanner(planner)
  const sourceActivities = [...getContainerActivities(nextPlanner, source.containerId)]
  const targetActivities =
    source.containerId === target.containerId
      ? sourceActivities
      : [...getContainerActivities(nextPlanner, target.containerId)]

  const sourceIndex = sourceActivities.findIndex((activity) => activity.id === activityId)
  const [activity] = sourceActivities.splice(sourceIndex, 1)
  if (!activity) {
    return null
  }

  const insertionIndex =
    source.containerId === target.containerId && target.index > source.index
      ? target.index - 1
      : target.index
  const safeIndex = Math.max(0, Math.min(insertionIndex, targetActivities.length))
  const nextActivity: PlannerActivity = {
    ...activity,
    trip_day_id: target.dayId,
    start_time: target.dayId == null ? null : activity.start_time,
    end_time: target.dayId == null ? null : activity.end_time,
    legacy_source_day_id: target.dayId ?? activity.legacy_source_day_id ?? source.dayId,
    legacy_inbox_item: target.dayId == null,
  }
  targetActivities.splice(safeIndex, 0, nextActivity)

  setContainerActivities(nextPlanner, source.containerId, sourceActivities)
  setContainerActivities(nextPlanner, target.containerId, targetActivities)
  return nextPlanner
}

function getLegacyDayHiddenAnchors(
  planner: PlannerResponse,
  dayId: string,
  movedActivityId: string,
) {
  const hiddenActivities = planner.inbox_activities
    .filter((activity) => activity.legacy_source_day_id === dayId && activity.id !== movedActivityId)
    .sort((left, right) => left.order_index - right.order_index)
  const visibleActivities =
    planner.days
      .find((day) => day.id === dayId)
      ?.activities.filter((activity) => activity.id !== movedActivityId)
      .sort((left, right) => left.order_index - right.order_index) ?? []
  const hiddenIds = new Set(hiddenActivities.map((activity) => activity.id))
  const orderedBucket = [...visibleActivities, ...hiddenActivities].sort(
    (left, right) => left.order_index - right.order_index,
  )

  let visibleBefore = 0

  return orderedBucket.reduce<Array<{ activityId: string; visibleBefore: number }>>(
    (anchors, activity) => {
      if (hiddenIds.has(activity.id)) {
        anchors.push({ activityId: activity.id, visibleBefore })
        return anchors
      }

      visibleBefore += 1
      return anchors
    },
    [],
  )
}

function getLegacyTargetDayIndex(
  originPlanner: PlannerResponse,
  currentPlanner: PlannerResponse,
  dayId: string,
  movedActivityId: string,
) {
  const currentVisibleIds = [
    ...(currentPlanner.days.find((day) => day.id === dayId)?.activities ?? []),
  ]
    .sort((left, right) => left.order_index - right.order_index)
    .map((activity) => activity.id)
  const hiddenAnchors = getLegacyDayHiddenAnchors(originPlanner, dayId, movedActivityId)
  const orderedIds: string[] = []
  let visibleCursor = 0

  for (const anchor of hiddenAnchors) {
    const visibleTarget = Math.min(anchor.visibleBefore, currentVisibleIds.length)
    while (visibleCursor < visibleTarget) {
      orderedIds.push(currentVisibleIds[visibleCursor]!)
      visibleCursor += 1
    }
    orderedIds.push(anchor.activityId)
  }

  while (visibleCursor < currentVisibleIds.length) {
    orderedIds.push(currentVisibleIds[visibleCursor]!)
    visibleCursor += 1
  }

  const targetIndex = orderedIds.indexOf(movedActivityId)
  return targetIndex >= 0 ? targetIndex : orderedIds.length
}

function deriveEndTime(startTime: string | null, durationMin: number | null) {
  if (!startTime || durationMin == null) {
    return null
  }
  const [hoursRaw, minutesRaw = '0'] = startTime.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null
  }
  const total = hours * 60 + minutes + durationMin
  if (total >= 24 * 60) {
    return '24:00'
  }
  const endHours = Math.floor(total / 60)
  const endMinutes = total % 60
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`
}

function applyCalendarScheduleChange(
  planner: PlannerResponse,
  payload: {
    activityId: string
    targetDayId: string
    startTime: string | null
    durationMin: number
  },
) {
  const nextPlanner = clonePlanner(planner)
  const source = findActivityLocation(nextPlanner, payload.activityId)
  const targetDay = nextPlanner.days.find((day) => day.id === payload.targetDayId)
  if (!source || !targetDay) {
    return null
  }

  const sourceActivities = [...getContainerActivities(nextPlanner, source.containerId)]
  const sourceIndex = sourceActivities.findIndex((activity) => activity.id === payload.activityId)
  const [activity] = sourceActivities.splice(sourceIndex, 1)
  if (!activity) {
    return null
  }

  const updatedActivity: PlannerActivity = {
    ...activity,
    trip_day_id: payload.targetDayId,
    start_time: payload.startTime,
    duration_min: payload.durationMin,
    end_time: deriveEndTime(payload.startTime, payload.durationMin),
  }

  if (source.containerId === targetDay.id) {
    sourceActivities.splice(source.index, 0, updatedActivity)
    setContainerActivities(nextPlanner, source.containerId, sourceActivities)
  } else {
    const targetActivities = [...targetDay.activities, updatedActivity]
    setContainerActivities(nextPlanner, source.containerId, sourceActivities)
    setContainerActivities(nextPlanner, targetDay.id, targetActivities)
  }

  return nextPlanner
}

function buildReport(jobId: string, status: string, result: unknown, error: unknown): PlannerGenerationReport {
  return {
    jobId,
    status,
    result:
      result && typeof result === 'object'
        ? (result as Record<string, unknown>)
        : null,
    error:
      error && typeof error === 'object'
        ? (error as Record<string, unknown>)
        : null,
  }
}

function findDayLabel(planner: PlannerResponse | null | undefined, tripDayId: string | null) {
  if (!planner || !tripDayId) {
    return null
  }
  const day = planner.days.find((item) => item.id === tripDayId)
  if (!day) {
    return null
  }
  return `Day ${day.day_index + 1} · ${format(new Date(day.date), 'EEE, MMM d')}`
}

function MobileContainerChip({
  containerId,
  label,
  count,
  isActive,
  isDragging,
  onSelect,
}: {
  containerId: PlannerContainerId
  label: string
  count: number
  isActive: boolean
  isDragging: boolean
  onSelect: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: getChipId(containerId),
    data: {
      type: 'mobile-chip',
      containerId,
      dayId: containerId === INBOX_CONTAINER_ID ? null : containerId,
    },
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[0.78rem] font-medium transition-colors',
        isActive
          ? 'border-black/16 bg-[var(--color-text)] text-white'
          : 'border-black/8 bg-white text-[var(--color-text-muted)]',
        isDragging && isOver && 'border-black/16 ring-2 ring-black/6',
      )}
    >
      <span>{label}</span>
      <span className={cn('rounded-full px-1.5 py-0.5 text-[0.68rem]', isActive ? 'bg-white/16 text-white' : 'bg-[var(--color-secondary-surface)] text-[var(--color-text-muted)]')}>
        {count}
      </span>
    </button>
  )
}

export default function PlannerBoard({ tripId }: Props) {
  const qc = useQueryClient()
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const [editorState, setEditorState] = useState<EditorState>(null)
  const [detailsActivityId, setDetailsActivityId] = useState<string | null>(null)
  const [mobileContainerId, setMobileContainerId] = useState<PlannerContainerId>(INBOX_CONTAINER_ID)
  const [isSaving, setIsSaving] = useState(false)
  const [isAssigningPlace, setIsAssigningPlace] = useState(false)
  const [activeActivity, setActiveActivity] = useState<PlannerActivity | null>(null)
  const prevJobStatus = useRef<string | null>(null)
  const lastOverIdRef = useRef<UniqueIdentifier | null>(null)
  const dragOriginPlannerRef = useRef<PlannerResponse | null>(null)
  const boardRailRef = useRef<HTMLDivElement | null>(null)
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null)
  const edgeScrollFrameRef = useRef<number | null>(null)

  const { data: planner, isLoading, isError } = usePlanner(tripId)
  const { data: offersData } = useTripOffers(tripId, {
    current_only: true,
    limit: 200,
    offset: 0,
  })

  const {
    pendingJobIds,
    setPendingJobId,
    clearPendingJobId,
    generationReports,
    setGenerationReport,
    clearGenerationReport,
  } = usePlannerStore()

  const pendingJobId = pendingJobIds[tripId] ?? null
  const latestReport = generationReports[tripId]
  const currentJob = useJob(pendingJobId)
  const currentView = getView(searchParams.get('view'))
  const currentCalendarView = getCalendarView(searchParams.get('calendarView'))
  const selectedActivityId = searchParams.get('activityId')
  const selectedPlaceId = searchParams.get('placeId')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const generateMutation = useGenerateItinerary(tripId)
  const regenerateMutation = useRegenerateItinerary(tripId)
  const resetMutation = useResetItinerary(tripId)

  const offersByDay = useMemo(() => {
    const grouped = new Map<string, Offer[]>()
    for (const offer of offersData?.items ?? []) {
      if (!offer.trip_day_id) {
        continue
      }
      grouped.set(offer.trip_day_id, [...(grouped.get(offer.trip_day_id) ?? []), offer])
    }
    return grouped
  }, [offersData?.items])

  const allActivities = useMemo(
    () =>
      planner
        ? [...planner.inbox_activities, ...planner.days.flatMap((day) => day.activities)]
        : [],
    [planner],
  )
  const boardSelectedActivity = useMemo(
    () => findActivity(planner, detailsActivityId) ?? findActivity(planner, editorState?.activityId ?? null),
    [detailsActivityId, editorState?.activityId, planner],
  )
  const detailsActivity = useMemo(
    () => findActivity(planner, detailsActivityId),
    [detailsActivityId, planner],
  )
  const editorActivity = useMemo(
    () => findActivity(planner, editorState?.activityId ?? null),
    [editorState?.activityId, planner],
  )
  const hasActivities = allActivities.length > 0

  const collisionDetectionStrategy = useCallback<CollisionDetection>(
    (args) => {
      const intersections = pointerWithin(args)
      const collisions = intersections.length > 0 ? intersections : rectIntersection(args)
      let overId = getFirstCollision(collisions, 'id')

      if (overId != null && planner) {
        const resolved = resolveDropTarget(planner, String(overId))
        const isChip = String(overId).startsWith(CHIP_PREFIX)
        if (resolved && !isChip) {
          const containerItems = getContainerActivities(planner, resolved.containerId)
          if (containerItems.length > 0) {
            const itemIds = new Set(containerItems.map((activity) => activity.id))
            const narrowed = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter(
                (container) =>
                  itemIds.has(String(container.id)) ||
                  String(container.id) === getEndZoneId(resolved.containerId),
              ),
            })
            overId = narrowed[0]?.id ?? overId
          }
        }
      }

      if (overId != null) {
        lastOverIdRef.current = overId
        return [{ id: overId }]
      }

      return lastOverIdRef.current != null ? [{ id: lastOverIdRef.current }] : []
    },
    [planner],
  )

  const calendarAnchorDate = useMemo(
    () => (planner?.days.length ? searchParams.get('date') ?? planner.days[0].date : null),
    [planner?.days, searchParams],
  )

  useEffect(() => {
    if (!planner?.days.length || searchParams.get('date')) {
      return
    }
    const next = new URLSearchParams(searchParams)
    next.set('date', planner.days[0].date)
    setSearchParams(next, { replace: true })
  }, [planner?.days, searchParams, setSearchParams])

  useEffect(() => {
    const job = currentJob.data
    if (!job || !pendingJobId) {
      return
    }
    if (!isJobTerminal(job.status) || prevJobStatus.current === job.status) {
      return
    }

    prevJobStatus.current = job.status
    setGenerationReport(tripId, buildReport(job.id, job.status, job.result, job.error))

    if (isJobSuccessful(job.status)) {
      qc.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
      clearPendingJobId(tripId)
      toast.success('Planner updated')
      return
    }

    clearPendingJobId(tripId)
    toast.error('Planner generation failed')
  }, [
    clearPendingJobId,
    currentJob.data,
    pendingJobId,
    qc,
    setGenerationReport,
    tripId,
  ])

  useEffect(() => {
    if (currentView !== 'kanban') {
      setDetailsActivityId(null)
    }
  }, [currentView])

  useEffect(() => {
    if (!planner) {
      return
    }
    const validContainerIds = new Set<PlannerContainerId>([
      INBOX_CONTAINER_ID,
      ...planner.days.map((day) => day.id),
    ])
    if (!validContainerIds.has(mobileContainerId)) {
      setMobileContainerId(INBOX_CONTAINER_ID)
    }
  }, [mobileContainerId, planner])

  useEffect(() => {
    if (!activeActivity || currentView !== 'kanban' || isMobile) {
      if (edgeScrollFrameRef.current != null) {
        window.cancelAnimationFrame(edgeScrollFrameRef.current)
        edgeScrollFrameRef.current = null
      }
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY }
    }

    const tick = () => {
      const rail = boardRailRef.current
      const pointer = pointerPositionRef.current
      if (rail && pointer) {
        const rect = rail.getBoundingClientRect()
        if (pointer.x < rect.left + EDGE_SCROLL_THRESHOLD) {
          rail.scrollLeft -= EDGE_SCROLL_STEP
        } else if (pointer.x > rect.right - EDGE_SCROLL_THRESHOLD) {
          rail.scrollLeft += EDGE_SCROLL_STEP
        }
      }
      edgeScrollFrameRef.current = window.requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', handlePointerMove)
    edgeScrollFrameRef.current = window.requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      if (edgeScrollFrameRef.current != null) {
        window.cancelAnimationFrame(edgeScrollFrameRef.current)
        edgeScrollFrameRef.current = null
      }
    }
  }, [activeActivity, currentView, isMobile])

  const updateParams = (updates: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    })
    setSearchParams(next, { replace })
  }

  const invalidatePlanner = () => qc.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })

  const handleMapSelectActivityId = (activityId: string | null) => {
    const activity = findActivity(planner, activityId)
    updateParams(
      {
        activityId,
        placeId: activity?.place_id ?? selectedPlaceId,
      },
      false,
    )
  }

  const openDetails = (activity: PlannerActivity) => {
    setEditorState(null)
    setDetailsActivityId(activity.id)
  }

  const openCreateDrawer = (defaultTripDayId: string | null) => {
    setDetailsActivityId(null)
    setEditorState({ activityId: null, defaultTripDayId })
  }

  const openEditDrawer = (activity: PlannerActivity) => {
    setDetailsActivityId(null)
    setEditorState({ activityId: activity.id, defaultTripDayId: activity.trip_day_id ?? null })
  }

  const closeEditor = () => setEditorState(null)

  const handleCalendarScheduleChange = async ({
    activity,
    targetDayId,
    startTime,
    durationMin,
  }: {
    activity: PlannerActivity
    targetDayId: string
    targetDate: string
    startTime: string | null
    durationMin: number
  }) => {
    const currentPlanner = qc.getQueryData<PlannerResponse>(plannerKeys.detail(tripId)) ?? planner
    if (!currentPlanner) {
      return
    }

    const optimisticPlanner = applyCalendarScheduleChange(currentPlanner, {
      activityId: activity.id,
      targetDayId,
      startTime,
      durationMin,
    })
    if (!optimisticPlanner) {
      return
    }

    qc.setQueryData(plannerKeys.detail(tripId), optimisticPlanner)

    try {
      const { moveActivity, patchActivity } = await import('@/entities/activity/api')

      if (activity.trip_day_id !== targetDayId) {
        const targetDay = optimisticPlanner.days.find((day) => day.id === targetDayId)
        const targetIndex = targetDay?.activities.findIndex((item) => item.id === activity.id) ?? 0
        await moveActivity(
          activity.id,
          {
            target_day_id: targetDayId,
            target_index: Math.max(targetIndex, 0),
          },
          currentPlanner.trip.version,
        )
      }

      if (
        (activity.start_time ?? null) !== startTime ||
        (activity.duration_min ?? null) !== durationMin
      ) {
        await patchActivity(activity.id, {
          start_time: startTime,
          duration_min: durationMin,
        })
      }

      await invalidatePlanner()
    } catch {
      qc.setQueryData(plannerKeys.detail(tripId), currentPlanner)
      toast.error('Failed to update activity schedule')
    }
  }

  const handleDrawerSave = async (data: ActivityCreateInput) => {
    if (!planner) {
      return
    }
    setIsSaving(true)

    try {
      if (editorActivity) {
        const { patchActivity } = await import('@/entities/activity/api')
        const patchPayload =
          planner.legacy_inbox_mode
            ? {
                ...data,
                tags: withPlannerInternalTags(data.tags, {
                  inbox: Boolean(editorActivity.legacy_inbox_item),
                  dayUntimed:
                    !editorActivity.legacy_inbox_item &&
                    Boolean(
                      (editorState?.defaultTripDayId ?? editorActivity.legacy_source_day_id) &&
                        !data.start_time,
                    ),
                }),
              }
            : data
        await patchActivity(editorActivity.id, patchPayload)
        toast.success('Activity updated')
      } else if (editorState) {
        const idempotencyKey = crypto.randomUUID()
        if (planner.legacy_inbox_mode) {
          const { createActivity } = await import('@/entities/activity/api')
          const fallbackDayId = editorState.defaultTripDayId ?? planner.days[0]?.id
          if (!fallbackDayId) {
            throw new Error('No trip day available for legacy planner fallback')
          }
          await createActivity(
            fallbackDayId,
            {
              ...data,
              start_time: editorState.defaultTripDayId ? data.start_time : null,
              tags: withPlannerInternalTags(data.tags, {
                inbox: !editorState.defaultTripDayId,
                dayUntimed: Boolean(editorState.defaultTripDayId && !data.start_time),
              }),
            },
            idempotencyKey,
          )
        } else {
          const { createPlannerActivity } = await import('@/entities/activity/api')
          await createPlannerActivity(
            tripId,
            {
              ...data,
              trip_day_id: editorState.defaultTripDayId,
            },
            idempotencyKey,
          )
        }
        toast.success('Activity added')
      }

      await invalidatePlanner()
      closeEditor()
    } catch (error) {
      if (isRateLimit(error)) {
        toast.error('Too many requests. Please wait a moment.')
      } else {
        toast.error('Failed to save activity')
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteActivity = async (activityId: string) => {
    try {
      const { deleteActivity } = await import('@/entities/activity/api')
      await deleteActivity(activityId)
      toast.success('Activity removed')
      if (detailsActivityId === activityId) {
        setDetailsActivityId(null)
      }
      if (editorState?.activityId === activityId) {
        setEditorState(null)
      }
      if (selectedActivityId === activityId) {
        handleMapSelectActivityId(null)
      }
      await invalidatePlanner()
    } catch {
      toast.error('Failed to remove activity')
    }
  }

  const handleAssignPlace = async (activityId: string, placeId: string) => {
    setIsAssigningPlace(true)
    try {
      const { patchActivity } = await import('@/entities/activity/api')
      await patchActivity(activityId, { place_id: placeId })
      await invalidatePlanner()
      toast.success('Place assigned to activity')
    } catch {
      toast.error('Failed to assign place')
    } finally {
      setIsAssigningPlace(false)
    }
  }

  const submitGeneration = async (
    action: 'generate' | 'regenerate',
    data: { mode: 'replace' | 'merge' | 'append'; day_ids?: string[]; seed?: number },
    idempotencyKey: string,
  ) => {
    if (!planner) {
      return
    }

    const payload: TripGenerateInput = {
      mode: data.mode,
      day_ids: data.day_ids && data.day_ids.length > 0 ? data.day_ids : null,
      constraints: {},
      seed: data.seed ?? null,
    }

    clearGenerationReport(tripId)
    const mutation = action === 'generate' ? generateMutation : regenerateMutation
    const accepted = await mutation.mutateAsync({
      data: payload,
      tripVersion: planner.trip.version,
      idempotencyKey,
    })
    prevJobStatus.current = null
    setPendingJobId(tripId, accepted.job_id)
  }

  const handleGenerate = async (
    data: { mode: 'replace' | 'merge' | 'append'; day_ids?: string[]; seed?: number },
    idempotencyKey: string,
  ) => {
    try {
      await submitGeneration('generate', data, idempotencyKey)
      toast.success('Planner generation queued')
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Trip changed. Refresh the planner and try again.')
      } else {
        toast.error('Failed to queue planner generation')
      }
    }
  }

  const handleRegenerate = async (
    data: { mode: 'replace' | 'merge' | 'append'; day_ids?: string[]; seed?: number },
    idempotencyKey: string,
  ) => {
    try {
      await submitGeneration('regenerate', data, idempotencyKey)
      toast.success('Planner regeneration queued')
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Trip changed. Refresh the planner and try again.')
      } else {
        toast.error('Failed to queue planner regeneration')
      }
    }
  }

  const handleReset = async (dayIds: string[] | undefined, idempotencyKey: string) => {
    if (!planner) {
      return
    }
    try {
      clearGenerationReport(tripId)
      const accepted = await resetMutation.mutateAsync({
        data: {
          day_ids: dayIds && dayIds.length > 0 ? dayIds : planner.days.map((day) => day.id),
        },
        tripVersion: planner.trip.version,
        idempotencyKey,
      })
      prevJobStatus.current = null
      setPendingJobId(tripId, accepted.job_id)
      toast.success('Generated activities reset queued')
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Trip changed. Refresh the planner and try again.')
      } else {
        toast.error('Failed to queue reset')
      }
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    if (planner) {
      dragOriginPlannerRef.current = clonePlanner(planner)
    }
    lastOverIdRef.current = event.active.id
    setActiveActivity(findActivity(planner, String(event.active.id)))
    pointerPositionRef.current = null
  }

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id ? String(event.over.id) : null
    const activityId = String(event.active.id)
    const currentPlanner = qc.getQueryData<PlannerResponse>(plannerKeys.detail(tripId)) ?? planner
    if (!currentPlanner || !overId) {
      return
    }

    const source = findActivityLocation(currentPlanner, activityId)
    const target = resolveDropTarget(currentPlanner, overId)
    if (!source || !target) {
      return
    }
    if (source.containerId === target.containerId && source.index === target.index) {
      return
    }

    const nextPlanner = updatePlannerActivityLists(currentPlanner, activityId, target)
    if (!nextPlanner) {
      return
    }
    if (isMobile && overId.startsWith(CHIP_PREFIX)) {
      setMobileContainerId(target.containerId)
    }
    qc.setQueryData(plannerKeys.detail(tripId), nextPlanner)
  }

  const handleDragCancel = () => {
    setActiveActivity(null)
    lastOverIdRef.current = null
    pointerPositionRef.current = null
    if (dragOriginPlannerRef.current) {
      qc.setQueryData(plannerKeys.detail(tripId), dragOriginPlannerRef.current)
      dragOriginPlannerRef.current = null
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const capturedActivity = activeActivity
    const originPlanner = dragOriginPlannerRef.current
    const currentPlanner = qc.getQueryData<PlannerResponse>(plannerKeys.detail(tripId)) ?? planner

    setActiveActivity(null)
    lastOverIdRef.current = null
    pointerPositionRef.current = null
    dragOriginPlannerRef.current = null

    if (!capturedActivity || !originPlanner || !currentPlanner || !event.over) {
      if (originPlanner) {
        qc.setQueryData(plannerKeys.detail(tripId), originPlanner)
      }
      return
    }

    const startLocation = findActivityLocation(originPlanner, capturedActivity.id)
    const finalLocation = findActivityLocation(currentPlanner, capturedActivity.id)
    if (!startLocation || !finalLocation) {
      qc.setQueryData(plannerKeys.detail(tripId), originPlanner)
      return
    }

    if (
      startLocation.containerId === finalLocation.containerId &&
      startLocation.index === finalLocation.index
    ) {
      qc.setQueryData(plannerKeys.detail(tripId), currentPlanner)
      return
    }

    const persistMove = async (tripVersion: number) => {
      const { moveActivity, patchActivity, reorderActivities } = await import('@/entities/activity/api')

      const isInboxTarget = finalLocation.containerId === INBOX_CONTAINER_ID
      const shouldUseDayReorder =
        startLocation.containerId === finalLocation.containerId &&
        finalLocation.containerId !== INBOX_CONTAINER_ID &&
        finalLocation.dayId != null

      if (currentPlanner.legacy_inbox_mode) {
        if (isInboxTarget) {
          await patchActivity(capturedActivity.id, {
            start_time: null,
            tags: withPlannerInternalTags(capturedActivity.tags, { inbox: true }),
          })
          return
        }

        if (finalLocation.dayId != null) {
          const legacyTargetIndex = getLegacyTargetDayIndex(
            originPlanner,
            currentPlanner,
            finalLocation.dayId,
            capturedActivity.id,
          )

          await moveActivity(
            capturedActivity.id,
            {
              target_day_id: finalLocation.dayId,
              target_index: legacyTargetIndex,
            },
            tripVersion,
          )

          if (!capturedActivity.start_time) {
            await patchActivity(capturedActivity.id, {
              start_time: null,
              tags: withPlannerInternalTags(capturedActivity.tags, { dayUntimed: true }),
            })
          }
          return
        }
      }

      if (shouldUseDayReorder) {
        const reorderedDay = currentPlanner.days.find((day) => day.id === finalLocation.dayId)
        if (!reorderedDay) {
          return
        }
        await reorderActivities(
          reorderedDay.id,
          {
            items: reorderedDay.activities.map((activity, index) => ({
              activity_id: activity.id,
              order_index: index,
            })),
          },
          tripVersion,
        )
        return
      }

      await moveActivity(
        capturedActivity.id,
        {
          target_day_id: finalLocation.dayId,
          target_index: Math.max(finalLocation.index, 0),
          start_time: isInboxTarget ? null : undefined,
        },
        tripVersion,
      )
    }

    try {
      await persistMove(currentPlanner.trip.version)
      await invalidatePlanner()
    } catch (error) {
      if (isConflict(error)) {
        try {
          const freshPlanner = await qc.fetchQuery({
            queryKey: plannerKeys.detail(tripId),
            queryFn: () => getPlanner(tripId),
          })
          await persistMove(freshPlanner.trip.version)
          await invalidatePlanner()
          return
        } catch {
          // fall through to restore the optimistic state below
        }
      }
      qc.setQueryData(plannerKeys.detail(tripId), originPlanner)
      toast.error('Failed to move activity')
    }
  }

  const headerActions = planner ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Tabs value={currentView} onValueChange={(value) => updateParams({ view: value }, false)}>
        <TabsList className="h-8 rounded-[8px] border border-black/8 bg-[var(--color-secondary-surface)] p-0.5">
          <TabsTrigger value="kanban" className="h-7 rounded-[6px] px-2.5 text-[0.78rem]">
            <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
            Board
          </TabsTrigger>
          <TabsTrigger value="calendar" className="h-7 rounded-[6px] px-2.5 text-[0.78rem]">
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" />
            Calendar
          </TabsTrigger>
          <TabsTrigger value="map" className="h-7 rounded-[6px] px-2.5 text-[0.78rem]">
            <MapPinned className="mr-1.5 h-3.5 w-3.5" />
            Map
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <GenerationControls
        compact
        days={planner.days}
        hasActivities={hasActivities}
        onGenerate={handleGenerate}
        onRegenerate={handleRegenerate}
        onReset={handleReset}
        isGenerating={
          generateMutation.isPending || regenerateMutation.isPending || resetMutation.isPending
        }
        jobStatus={currentJob.data?.status ?? latestReport?.status ?? null}
      />
    </div>
  ) : null

  const headerMeta = planner ? (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="truncate font-medium text-[var(--color-text)]">{planner.trip.title}</span>
      <span className="hidden text-black/20 lg:inline">•</span>
      <span className="truncate">{planner.trip.destination_text}</span>
      <span className="hidden text-black/20 lg:inline">•</span>
      <span className="truncate">{`${format(new Date(planner.trip.start_date), 'MMM d')} - ${format(
        new Date(planner.trip.end_date),
        'MMM d, yyyy',
      )}`}</span>
      {planner.trip.budget_amount && planner.trip.budget_currency ? (
        <>
          <span className="hidden text-black/20 xl:inline">•</span>
          <span className="truncate">{`Budget ${formatMoney(
            planner.trip.budget_amount,
            planner.trip.budget_currency,
          )}`}</span>
        </>
      ) : null}
    </div>
  ) : null

  const hasShellHeaderActions = useAppShellHeaderActions(headerActions)
  const hasShellHeaderMeta = useAppShellHeaderMeta(headerMeta)

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-5">
        <Skeleton className="h-20 rounded-[12px]" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-[420px] rounded-[12px]" />
          <Skeleton className="h-[420px] rounded-[12px]" />
          <Skeleton className="h-[420px] rounded-[12px]" />
        </div>
      </div>
    )
  }

  if (isError || !planner) {
    return (
      <div className="p-4 md:p-5">
        <div className="rounded-[12px] border border-black/8 bg-white p-5 text-sm text-[var(--color-text-muted)]">
          Failed to load the planner workspace.
        </div>
      </div>
    )
  }

  const mobileContainers = [
    { id: INBOX_CONTAINER_ID as PlannerContainerId, label: 'Inbox', count: planner.inbox_activities.length },
    ...planner.days.map((day) => ({
      id: day.id as PlannerContainerId,
      label: `Day ${day.day_index + 1}`,
      count: day.activities.length,
    })),
  ]
  const activeMobileDay = planner.days.find((day) => day.id === mobileContainerId) ?? null
  const editorDayLabel = findDayLabel(planner, editorState?.defaultTripDayId ?? null)
  const detailsDayLabel = findDayLabel(planner, detailsActivity?.trip_day_id ?? null)

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 md:p-4">
      {!hasShellHeaderMeta || !hasShellHeaderActions ? (
        <section className="mb-3 rounded-[12px] border border-black/8 bg-white px-4 py-3">
          {!hasShellHeaderMeta ? <div className="min-w-0">{headerMeta}</div> : null}
          {!hasShellHeaderActions ? (
            <div className={hasShellHeaderMeta ? 'mt-3 border-t border-black/8 pt-3' : ''}>
              {headerActions}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          autoScroll={false}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          {currentView === 'kanban' ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
                <div
                  data-testid="planner-mobile-chip-rail"
                  className="-mx-3 overflow-x-auto px-3 pb-1"
                >
                  <div className="flex min-w-max items-center gap-2">
                    {mobileContainers.map((container) => (
                      <MobileContainerChip
                        key={container.id}
                        containerId={container.id}
                        label={container.label}
                        count={container.count}
                        isActive={mobileContainerId === container.id}
                        isDragging={Boolean(activeActivity)}
                        onSelect={() => setMobileContainerId(container.id)}
                      />
                    ))}
                  </div>
                </div>

                <div className="min-h-0 flex-1">
                  {mobileContainerId === INBOX_CONTAINER_ID ? (
                    <PlannerInbox
                      activities={planner.inbox_activities}
                      selectedActivityId={boardSelectedActivity?.id ?? null}
                      className="h-full"
                      onSelectActivity={openDetails}
                      onAddActivity={() => openCreateDrawer(null)}
                    />
                  ) : activeMobileDay ? (
                    <DayColumn
                      tripId={tripId}
                      day={activeMobileDay}
                      offers={offersByDay.get(activeMobileDay.id) ?? []}
                      selectedActivityId={boardSelectedActivity?.id ?? null}
                      onAddActivity={(dayId) => openCreateDrawer(dayId)}
                      onOpenActivity={openDetails}
                      className="h-full min-w-0"
                    />
                  ) : null}
                </div>
              </div>

              <div className="hidden min-h-0 flex-1 gap-4 lg:flex">
                <div className="w-[292px] shrink-0">
                  <PlannerInbox
                    activities={planner.inbox_activities}
                    selectedActivityId={boardSelectedActivity?.id ?? null}
                    className="h-full"
                    onSelectActivity={openDetails}
                    onAddActivity={() => openCreateDrawer(null)}
                  />
                </div>

                <div
                  ref={boardRailRef}
                  data-testid="planner-board-rail"
                  className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-1"
                >
                  <div className="flex h-full gap-3 pr-1">
                    {planner.days.map((day) => (
                      <DayColumn
                        key={day.id}
                        tripId={tripId}
                        day={day}
                        offers={offersByDay.get(day.id) ?? []}
                        selectedActivityId={boardSelectedActivity?.id ?? null}
                        onAddActivity={(dayId) => openCreateDrawer(dayId)}
                        onOpenActivity={openDetails}
                        className="w-[320px] shrink-0"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {currentView === 'calendar' ? (
            <div className="min-h-0 flex-1">
              <PlannerCalendarView
                trip={planner.trip}
                days={planner.days}
                inboxActivities={planner.inbox_activities}
                anchorDate={calendarAnchorDate ?? planner.days[0]?.date ?? planner.trip.start_date}
                calendarView={currentCalendarView}
                selectedActivityId={selectedActivityId}
                onDateChange={(date) => updateParams({ date }, false)}
                onCalendarViewChange={(calendarView) => updateParams({ calendarView }, false)}
                onSelectActivity={(activity) => handleMapSelectActivityId(activity?.id ?? null)}
                onCommitScheduleChange={handleCalendarScheduleChange}
              />
            </div>
          ) : null}

          {currentView === 'map' ? (
            <div className="min-h-0 flex-1">
              <PlannerMapView
                tripId={tripId}
                activities={allActivities}
                inboxActivities={planner.inbox_activities}
                selectedActivityId={selectedActivityId}
                selectedPlaceId={selectedPlaceId}
                onSelectActivityId={handleMapSelectActivityId}
                onSelectPlaceId={(placeId) => updateParams({ placeId }, false)}
                onAssignPlace={handleAssignPlace}
                isAssigning={isAssigningPlace}
              />
            </div>
          ) : null}

          <DragOverlay>
            {activeActivity ? (
              <div className="w-[320px] opacity-95">
                <ActivityCardView activity={activeActivity} isDragging />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <ActivityDetailsDrawer
        open={Boolean(detailsActivity)}
        activity={detailsActivity}
        dayLabel={detailsDayLabel}
        onClose={() => setDetailsActivityId(null)}
        onEdit={openEditDrawer}
        onDelete={handleDeleteActivity}
      />

      <ActivityDrawer
        open={Boolean(editorState)}
        tripId={tripId}
        activity={editorActivity}
        defaultTripDayId={editorState?.defaultTripDayId ?? null}
        defaultDayLabel={editorDayLabel}
        onClose={closeEditor}
        onSave={handleDrawerSave}
        isSaving={isSaving}
      />
    </div>
  )
}
