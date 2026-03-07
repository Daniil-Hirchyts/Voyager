import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { addDays, format, parseISO } from 'date-fns'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Compass,
  LayoutGrid,
  Loader2,
  MapPinned,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useJob, useGenerateItinerary, useRegenerateItinerary, useResetItinerary } from '@/entities/job/queries'
import { useTripOffers } from '@/entities/offer/queries'
import { plannerKeys, usePlanner } from '@/entities/planner/queries'
import { isConflict, isRateLimit } from '@/shared/api/client'
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
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ActivityCard } from './ActivityCard'
import { ActivityDrawer } from './ActivityDrawer'
import { DayColumn } from './DayColumn'
import { GenerationControls } from './GenerationControls'
import { PlannerCalendarView } from './PlannerCalendarView'
import { PlannerMapView } from './PlannerMapView'

interface Props {
  tripId: string
}

type PlannerView = 'kanban' | 'calendar' | 'map'

function clonePlanner(planner: PlannerResponse): PlannerResponse {
  return {
    trip: { ...planner.trip },
    days: planner.days.map((day) => ({
      ...day,
      activities: day.activities.map((activity) => ({ ...activity })),
    })),
  }
}

function updatePlannerActivityLists(
  planner: PlannerResponse,
  activityId: string,
  targetDayId: string,
  targetIndex: number,
) {
  const nextPlanner = clonePlanner(planner)
  const sourceDay = nextPlanner.days.find((day) => day.activities.some((activity) => activity.id === activityId))
  const targetDay = nextPlanner.days.find((day) => day.id === targetDayId)
  if (!sourceDay || !targetDay) return null

  const sourceIndex = sourceDay.activities.findIndex((activity) => activity.id === activityId)
  const [activity] = sourceDay.activities.splice(sourceIndex, 1)
  if (!activity) return null

  const insertionIndex =
    sourceDay.id === targetDay.id && targetIndex > sourceIndex ? targetIndex - 1 : targetIndex
  const safeIndex = Math.max(0, Math.min(insertionIndex, targetDay.activities.length))
  targetDay.activities.splice(safeIndex, 0, { ...activity, trip_day_id: targetDay.id })

  sourceDay.activities = sourceDay.activities.map((item, index) => ({ ...item, order_index: index }))
  targetDay.activities = targetDay.activities.map((item, index) => ({ ...item, order_index: index }))
  return nextPlanner
}

function findActivity(planner: PlannerResponse | undefined, activityId: string | null) {
  if (!planner || !activityId) return null
  for (const day of planner.days) {
    const found = day.activities.find((activity) => activity.id === activityId)
    if (found) return found
  }
  return null
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key]
  return typeof value === 'number' ? value : null
}

function generationSummary(report: PlannerGenerationReport | undefined) {
  const result = report?.result
  if (!result) return null
  return {
    generatorEngine:
      typeof result.generator_engine === 'string' ? result.generator_engine : 'deterministic_place_backed',
    resolvedPlaceCount: readNumber(result, 'resolved_place_count'),
    photoEnrichedPlaceCount: readNumber(result, 'photo_enriched_place_count'),
    unresolvedActivityCount: readNumber(result, 'unresolved_activity_count'),
  }
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

function getView(raw: string | null): PlannerView {
  return raw === 'calendar' || raw === 'map' ? raw : 'kanban'
}

export default function PlannerBoard({ tripId }: Props) {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [createDayId, setCreateDayId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isAssigningPlace, setIsAssigningPlace] = useState(false)
  const [activeActivity, setActiveActivity] = useState<PlannerActivity | null>(null)
  const prevJobStatus = useRef<string | null>(null)

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
      if (!offer.trip_day_id) continue
      grouped.set(offer.trip_day_id, [...(grouped.get(offer.trip_day_id) ?? []), offer])
    }
    return grouped
  }, [offersData?.items])

  const allActivities = useMemo(
    () => planner?.days.flatMap((day) => day.activities) ?? [],
    [planner],
  )
  const selectedActivity = findActivity(planner, selectedActivityId)
  const hasActivities = allActivities.length > 0

  const calendarAnchorDate = useMemo(() => {
    if (!planner?.days.length) return null
    const requested = searchParams.get('date')
    return requested ?? planner.days[0].date
  }, [planner?.days, searchParams])

  const visibleCalendarDays = useMemo(() => {
    if (!planner?.days.length || !calendarAnchorDate) return []
    const anchorIndex = Math.max(
      planner.days.findIndex((day) => day.date === calendarAnchorDate),
      0,
    )
    return planner.days.slice(anchorIndex, anchorIndex + 7)
  }, [calendarAnchorDate, planner?.days])

  useEffect(() => {
    if (!planner?.days.length) return
    if (searchParams.get('date')) return
    const next = new URLSearchParams(searchParams)
    next.set('date', planner.days[0].date)
    setSearchParams(next, { replace: true })
  }, [planner?.days, searchParams, setSearchParams])

  useEffect(() => {
    const job = currentJob.data
    if (!job || !pendingJobId) return
    if (!isJobTerminal(job.status) || prevJobStatus.current === job.status) return

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

  const updateParams = (updates: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([key, value]) => {
      if (value == null || value === '') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    })
    setSearchParams(next, { replace })
  }

  const handleSelectActivity = (activity: PlannerActivity | null) => {
    setCreateDayId(null)
    updateParams(
      {
        activityId: activity?.id ?? null,
        placeId: activity?.place_id ?? selectedPlaceId,
      },
      false,
    )
  }

  const handleDrawerClose = () => {
    setCreateDayId(null)
    updateParams({ activityId: null }, false)
  }

  const handleAddActivity = (dayId: string) => {
    setCreateDayId(dayId)
    updateParams({ activityId: null }, false)
  }

  const invalidatePlanner = () => qc.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })

  const handleDrawerSave = async (data: ActivityCreateInput) => {
    if (!planner) return
    setIsSaving(true)

    try {
      if (selectedActivity) {
        const { patchActivity } = await import('@/entities/activity/api')
        await patchActivity(selectedActivity.id, data)
        toast.success('Activity updated')
      } else if (createDayId) {
        const { createActivity } = await import('@/entities/activity/api')
        await createActivity(createDayId, data, crypto.randomUUID())
        toast.success('Activity added')
      }

      await invalidatePlanner()
      handleDrawerClose()
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
      if (selectedActivityId === activityId) {
        handleSelectActivity(null)
      }
      await invalidatePlanner()
    } catch {
      toast.error('Failed to remove activity')
    }
  }

  const handleToggleFavorite = async (activity: PlannerActivity) => {
    try {
      const { patchActivity } = await import('@/entities/activity/api')
      await patchActivity(activity.id, { is_favorite: !activity.is_favorite })
      await invalidatePlanner()
    } catch {
      toast.error('Failed to update favorite state')
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
    if (!planner) return

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
    if (!planner) return
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
    setActiveActivity(findActivity(planner, String(event.active.id)))
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const capturedActivity = activeActivity
    setActiveActivity(null)

    if (!event.over || !planner || !capturedActivity) return

    const overId = String(event.over.id)
    const overDayId = overId.startsWith('day-') ? overId.replace('day-', '') : null
    const overActivity = findActivity(planner, overDayId ? null : overId)
    const targetDayId = overDayId ?? overActivity?.trip_day_id ?? null
    if (!targetDayId) return

    const targetDay = planner.days.find((day) => day.id === targetDayId)
    if (!targetDay) return

    const targetIndex = overActivity
      ? targetDay.activities.findIndex((item) => item.id === overActivity.id)
      : targetDay.activities.length
    const nextPlanner = updatePlannerActivityLists(planner, capturedActivity.id, targetDayId, targetIndex)
    if (!nextPlanner) return

    const previousPlanner = planner
    qc.setQueryData(plannerKeys.detail(tripId), nextPlanner)

    try {
      const { moveActivity, reorderActivities } = await import('@/entities/activity/api')
      if (capturedActivity.trip_day_id === targetDayId) {
        const reorderedDay = nextPlanner.days.find((day) => day.id === targetDayId)
        if (!reorderedDay) return
        await reorderActivities(
          reorderedDay.id,
          {
            items: reorderedDay.activities.map((activity, index) => ({
              activity_id: activity.id,
              order_index: index,
            })),
          },
          planner.trip.version,
        )
      } else {
        await moveActivity(
          capturedActivity.id,
          {
            target_day_id: targetDayId,
            target_index: Math.max(targetIndex, 0),
          },
          planner.trip.version,
        )
      }
      await invalidatePlanner()
    } catch {
      qc.setQueryData(plannerKeys.detail(tripId), previousPlanner)
      toast.error('Failed to move activity')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-5 px-6 py-6">
        <Skeleton className="h-44 rounded-[32px]" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-[460px] rounded-[28px]" />
          <Skeleton className="h-[460px] rounded-[28px]" />
          <Skeleton className="h-[460px] rounded-[28px]" />
        </div>
      </div>
    )
  }

  if (isError || !planner) {
    return (
      <div className="px-6 py-6">
        <div className="rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-sm text-[var(--color-text-muted)]">
          Failed to load the planner workspace.
        </div>
      </div>
    )
  }

  const summary = generationSummary(latestReport)
  const budgetText =
    planner.trip.budget_amount && planner.trip.budget_currency
      ? formatMoney(planner.trip.budget_amount, planner.trip.budget_currency)
      : null

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(47,111,115,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(197,106,61,0.1),transparent_22%),linear-gradient(180deg,rgba(248,243,235,0.98),rgba(238,231,219,0.95))] px-6 py-6">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <section className="overflow-hidden rounded-[36px] border border-[var(--color-border)] bg-[rgba(255,252,247,0.88)] shadow-[0_30px_100px_rgba(14,25,35,0.09)] backdrop-blur-sm">
          <div className="grid gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <div>
              <p className="text-[0.74rem] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                Planner Workspace
              </p>
              <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-[-0.03em] text-[var(--color-text)] md:text-5xl">
                {planner.trip.title}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--color-text-muted)]">
                <span className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5">
                  {planner.trip.destination_text}
                </span>
                <span className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5">
                  {format(new Date(planner.trip.start_date), 'MMM d')} to{' '}
                  {format(new Date(planner.trip.end_date), 'MMM d, yyyy')}
                </span>
                {budgetText ? (
                  <span className="rounded-full border border-[var(--color-border)] bg-white/80 px-3 py-1.5">
                    Budget {budgetText}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <Tabs value={currentView} onValueChange={(value) => updateParams({ view: value }, false)}>
                <TabsList className="h-12 rounded-full border border-[var(--color-border)] bg-white/80 p-1">
                  <TabsTrigger value="kanban" className="rounded-full px-4">
                    <LayoutGrid className="mr-2 h-4 w-4" />
                    Kanban
                  </TabsTrigger>
                  <TabsTrigger value="calendar" className="rounded-full px-4">
                    <CalendarDays className="mr-2 h-4 w-4" />
                    Calendar
                  </TabsTrigger>
                  <TabsTrigger value="map" className="rounded-full px-4">
                    <MapPinned className="mr-2 h-4 w-4" />
                    Map
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <GenerationControls
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
          </div>

          <div className="border-t border-[var(--color-border)] bg-[linear-gradient(90deg,rgba(245,239,230,0.88),rgba(255,255,255,0.8))] px-6 py-4">
            <div className="flex flex-wrap items-center gap-3">
              {pendingJobId && currentJob.data && !isJobTerminal(currentJob.data.status) ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)]/10 px-4 py-2 text-sm text-[var(--color-primary)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Curated activity generation is running
                </div>
              ) : null}

              {summary ? (
                <div className="inline-flex flex-wrap items-center gap-2 rounded-full bg-white/85 px-4 py-2 text-sm text-[var(--color-text-muted)]">
                  <Compass className="h-4 w-4 text-[var(--color-primary)]" />
                  {summary.generatorEngine.replace(/_/g, ' ')}
                  {summary.resolvedPlaceCount != null ? ` · ${summary.resolvedPlaceCount} places resolved` : ''}
                  {summary.photoEnrichedPlaceCount != null
                    ? ` · ${summary.photoEnrichedPlaceCount} photo sets enriched`
                    : ''}
                  {summary.unresolvedActivityCount ? ` · ${summary.unresolvedActivityCount} unresolved` : ''}
                </div>
              ) : null}

              {currentView === 'calendar' && visibleCalendarDays.length > 0 ? (
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-full"
                    onClick={() => {
                      const current = parseISO(visibleCalendarDays[0].date)
                      updateParams({ date: format(addDays(current, -7), 'yyyy-MM-dd') }, false)
                    }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="rounded-full border border-[var(--color-border)] bg-white/80 px-4 py-2 text-sm text-[var(--color-text-muted)]">
                    {format(new Date(visibleCalendarDays[0].date), 'MMM d')} to{' '}
                    {format(new Date(visibleCalendarDays[visibleCalendarDays.length - 1].date), 'MMM d')}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-full"
                    onClick={() => {
                      const current = parseISO(visibleCalendarDays[0].date)
                      updateParams({ date: format(addDays(current, 7), 'yyyy-MM-dd') }, false)
                    }}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {currentView === 'kanban' ? (
            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max gap-4">
                {planner.days.map((day) => (
                  <DayColumn
                    key={day.id}
                    tripId={tripId}
                    day={day}
                    offers={offersByDay.get(day.id) ?? []}
                    onAddActivity={handleAddActivity}
                    onEditActivity={handleSelectActivity}
                    onDeleteActivity={(activityId) => handleDeleteActivity(activityId)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {currentView === 'calendar' ? (
            <PlannerCalendarView
              days={visibleCalendarDays}
              selectedActivityId={selectedActivityId}
              onSelectActivity={(activity) => handleSelectActivity(activity)}
            />
          ) : null}

          {currentView === 'map' ? (
            <PlannerMapView
              tripId={tripId}
              activities={allActivities}
              selectedActivityId={selectedActivityId}
              selectedPlaceId={selectedPlaceId}
              onSelectActivityId={(activityId) => handleSelectActivity(findActivity(planner, activityId))}
              onSelectPlaceId={(placeId) => updateParams({ placeId }, false)}
              onAssignPlace={handleAssignPlace}
              isAssigning={isAssigningPlace}
            />
          ) : null}

          <DragOverlay>
            {activeActivity ? (
              <div className="w-[360px] opacity-95">
                <ActivityCard
                  activity={activeActivity}
                  onEdit={() => undefined}
                  onDelete={() => undefined}
                  onToggleFavorite={() => undefined}
                  isDragging
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <ActivityDrawer
          open={Boolean(createDayId || selectedActivity)}
          tripId={tripId}
          activity={selectedActivity}
          onClose={handleDrawerClose}
          onSave={handleDrawerSave}
          isSaving={isSaving}
        />
      </div>
    </div>
  )
}
