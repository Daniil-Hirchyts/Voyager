import { useMemo, useRef, useState } from 'react'
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
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useDays, dayKeys } from '@/entities/day/queries'
import { useActivities, activityKeys } from '@/entities/activity/queries'
import { useTrip, tripKeys } from '@/entities/trip/queries'
import { useJob, useGenerateItinerary, useRegenerateItinerary, useResetItinerary } from '@/entities/job/queries'
import { useTripOffers } from '@/entities/offer/queries'
import { isConflict, isRateLimit } from '@/shared/api/client'
import { formatMoney } from '@/shared/lib/format'
import { isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs'
import { usePlannerStore } from '@/shared/stores/planner.store'
import type { Activity, ActivityCreateInput, Day, Offer, TripGenerateInput } from '@/shared/api/types'
import { ActivityCard } from './ActivityCard'
import { ActivityDrawer } from './ActivityDrawer'
import { DayColumn } from './DayColumn'
import { GenerationControls } from './GenerationControls'

interface Props {
  tripId: string
}

function DayColumnWithActivities({
  tripId,
  day,
  dayIndex,
  offers,
  onAddActivity,
  onEditActivity,
  onDeleteActivity,
  onToggleFavorite,
}: {
  tripId: string
  day: Day
  dayIndex: number
  offers: Offer[]
  onAddActivity: (dayId: string) => void
  onEditActivity: (activity: Activity) => void
  onDeleteActivity: (activityId: string, dayId: string) => void
  onToggleFavorite: (activity: Activity) => void
}) {
  const { data, isLoading } = useActivities(day.id)
  const activities = data?.items ?? []

  return (
    <DayColumn
      tripId={tripId}
      day={day}
      dayIndex={dayIndex}
      activities={activities}
      offers={offers}
      isLoading={isLoading}
      onAddActivity={onAddActivity}
      onEditActivity={onEditActivity}
      onDeleteActivity={onDeleteActivity}
      onToggleFavorite={onToggleFavorite}
    />
  )
}

export default function PlannerBoard({ tripId }: Props) {
  const qc = useQueryClient()
  const { data: trip } = useTrip(tripId)
  const { data: daysData } = useDays(tripId)
  const { data: offersData } = useTripOffers(tripId, {
    current_only: true,
    limit: 200,
    offset: 0,
  })
  const days = daysData?.items ?? []

  const { pendingJobIds, setPendingJobId, clearPendingJobId } = usePlannerStore()
  const pendingJobId = pendingJobIds[tripId] ?? null
  const { data: currentJob } = useJob(pendingJobId)
  const prevJobStatus = useRef<string | null>(null)

  if (currentJob && isJobTerminal(currentJob.status) && prevJobStatus.current !== currentJob.status) {
    prevJobStatus.current = currentJob.status

    if (isJobSuccessful(currentJob.status)) {
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: dayKeys.list(tripId) })
      qc.invalidateQueries({ queryKey: ['activities'] })
      clearPendingJobId(tripId)
      toast.success('Itinerary updated')
    } else {
      clearPendingJobId(tripId)
      toast.error('Generation failed. Please try again.')
    }
  }

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
  const [createDayId, setCreateDayId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [activeActivity, setActiveActivity] = useState<Activity | null>(null)
  const [activeActivityDayId, setActiveActivityDayId] = useState<string | null>(null)

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

  const handleAddActivity = (dayId: string) => {
    setCreateDayId(dayId)
    setEditingActivity(null)
    setDrawerOpen(true)
  }

  const handleEditActivity = (activity: Activity) => {
    setEditingActivity(activity)
    setCreateDayId(null)
    setDrawerOpen(true)
  }

  const handleDrawerSave = async (data: ActivityCreateInput) => {
    setIsSaving(true)

    try {
      if (editingActivity) {
        const { patchActivity } = await import('@/entities/activity/api')
        await patchActivity(editingActivity.id, data)
        qc.invalidateQueries({ queryKey: activityKeys.list(editingActivity.trip_day_id) })
        toast.success('Activity updated')
      } else if (createDayId) {
        const { createActivity } = await import('@/entities/activity/api')
        await createActivity(createDayId, data, crypto.randomUUID())
        qc.invalidateQueries({ queryKey: activityKeys.list(createDayId) })
        toast.success('Activity added')
      }

      setDrawerOpen(false)
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

  const handleDeleteActivity = async (activityId: string, dayId: string) => {
    try {
      const { deleteActivity } = await import('@/entities/activity/api')
      await deleteActivity(activityId)
      qc.invalidateQueries({ queryKey: activityKeys.list(dayId) })
      toast.success('Activity removed')
    } catch {
      toast.error('Failed to remove activity')
    }
  }

  const handleToggleFavorite = async (activity: Activity) => {
    try {
      const { patchActivity } = await import('@/entities/activity/api')
      await patchActivity(activity.id, { is_favorite: !activity.is_favorite })
      qc.invalidateQueries({ queryKey: activityKeys.list(activity.trip_day_id) })
    } catch {
      toast.error('Failed to update favorite state')
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    for (const day of days) {
      const cached = qc.getQueryData<{ items: Activity[] }>(activityKeys.list(day.id))
      const found = cached?.items.find((activity) => activity.id === active.id)
      if (found) {
        setActiveActivity(found)
        setActiveActivityDayId(day.id)
        break
      }
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    const capturedActivity = activeActivity
    const capturedActivityDayId = activeActivityDayId

    setActiveActivity(null)
    setActiveActivityDayId(null)

    if (!over || !capturedActivity || !capturedActivityDayId || !trip) return

    const overId = over.id.toString()
    const overDayId = overId.startsWith('day-') ? overId.replace('day-', '') : null
    const overActivityId = overDayId ? null : overId

    let targetDayId: string | null = null
    if (overDayId) {
      targetDayId = overDayId
    } else if (overActivityId) {
      for (const day of days) {
        const cached = qc.getQueryData<{ items: Activity[] }>(activityKeys.list(day.id))
        if (cached?.items.some((activity) => activity.id === overActivityId)) {
          targetDayId = day.id
          break
        }
      }
    }

    if (!targetDayId) return

    if (targetDayId === capturedActivityDayId) {
      const cached = qc.getQueryData<{ items: Activity[] }>(activityKeys.list(capturedActivityDayId))
      if (!cached) return

      const items = [...cached.items].sort((a, b) => a.order_index - b.order_index)
      const oldIndex = items.findIndex((activity) => activity.id === active.id)
      const newIndex = overActivityId
        ? items.findIndex((activity) => activity.id === overActivityId)
        : items.length - 1

      if (oldIndex === newIndex) return

      const reorderedItems = arrayMove(items, oldIndex, newIndex).map((activity, index) => ({
        ...activity,
        order_index: index,
      }))
      qc.setQueryData(activityKeys.list(capturedActivityDayId), { ...cached, items: reorderedItems })

      try {
        const { reorderActivities } = await import('@/entities/activity/api')
        await reorderActivities(
          capturedActivityDayId,
          {
            items: reorderedItems.map((activity, index) => ({
              activity_id: activity.id,
              order_index: index,
            })),
          },
          trip.version,
        )
        qc.invalidateQueries({ queryKey: activityKeys.list(capturedActivityDayId) })
        qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      } catch (error) {
        qc.setQueryData(activityKeys.list(capturedActivityDayId), cached)
        if (isConflict(error)) {
          toast.error('Version conflict. Planner refreshed.')
          qc.invalidateQueries({ queryKey: ['activities'] })
          qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
        } else {
          toast.error('Failed to reorder activities')
        }
      }
      return
    }

    try {
      const { moveActivity } = await import('@/entities/activity/api')
      const targetActivities =
        qc.getQueryData<{ items: Activity[] }>(activityKeys.list(targetDayId))?.items ?? []
      const sortedTargetActivities = [...targetActivities].sort((a, b) => a.order_index - b.order_index)
      const targetIndex = overActivityId
        ? sortedTargetActivities.findIndex((activity) => activity.id === overActivityId)
        : sortedTargetActivities.length

      await moveActivity(
        capturedActivity.id,
        { target_day_id: targetDayId, target_index: Math.max(targetIndex, 0) },
        trip.version,
      )
      qc.invalidateQueries({ queryKey: activityKeys.list(capturedActivityDayId) })
      qc.invalidateQueries({ queryKey: activityKeys.list(targetDayId) })
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      toast.success('Activity moved')
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Version conflict. Planner refreshed.')
        qc.invalidateQueries({ queryKey: ['activities'] })
        qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      } else {
        toast.error('Failed to move activity')
      }
    }
  }

  const handleGenerate = async (data: TripGenerateInput, key: string) => {
    if (!trip) return

    try {
      const job = await generateMutation.mutateAsync({
        data,
        tripVersion: trip.version,
        idempotencyKey: key,
      })
      setPendingJobId(tripId, job.job_id)
      toast.success('Generation started', {
        description: 'Your itinerary is being built.',
      })
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Version conflict. Please refresh and try again.')
        qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      } else if (isRateLimit(error)) {
        toast.error('Generation rate limit reached. Please wait before generating again.')
      } else {
        toast.error('Failed to start generation')
      }
    }
  }

  const handleRegenerate = async (data: TripGenerateInput, key: string) => {
    if (!trip) return

    try {
      const job = await regenerateMutation.mutateAsync({
        data,
        tripVersion: trip.version,
        idempotencyKey: key,
      })
      setPendingJobId(tripId, job.job_id)
      toast.success('Regeneration started')
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Version conflict. Please refresh.')
        qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      } else {
        toast.error('Failed to start regeneration')
      }
    }
  }

  const handleReset = async (dayIds: string[] | undefined, key: string) => {
    if (!trip) return

    try {
      const scopedDayIds = dayIds && dayIds.length > 0 ? dayIds : days.map((day) => day.id)
      const job = await resetMutation.mutateAsync({
        data: { day_ids: scopedDayIds },
        tripVersion: trip.version,
        idempotencyKey: key,
      })
      setPendingJobId(tripId, job.job_id)
      toast.success('Reset started', {
        description: 'AI-generated activities will be removed from the selected days.',
      })
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Version conflict. Please refresh.')
      } else {
        toast.error('Failed to start reset')
      }
    }
  }

  const hasActivities = days.some((day) => {
    const cached = qc.getQueryData<{ items: Activity[] }>(activityKeys.list(day.id))
    return (cached?.items.length ?? 0) > 0
  })

  if (!trip) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[#2F6F73] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div>
          <h1 className="font-semibold text-[#1D2430]">{trip.title}</h1>
          <p className="text-xs text-[#526072]">
            {trip.destination_text}
            {trip.budget_amount ? ` · ${formatMoney(trip.budget_amount, trip.budget_currency)}` : ''}
          </p>
        </div>
        <GenerationControls
          days={days}
          hasActivities={hasActivities}
          onGenerate={handleGenerate}
          onRegenerate={handleRegenerate}
          onReset={handleReset}
          isGenerating={
            generateMutation.isPending || regenerateMutation.isPending || resetMutation.isPending
          }
          jobStatus={currentJob?.status ?? null}
        />
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto p-5">
        {days.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <p className="text-[#526072]">No days in this trip.</p>
            <p className="text-sm text-[#526072]">
              Generate an itinerary to create days and activities.
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 items-start">
              {days.map((day, index) => (
                <DayColumnWithActivities
                  key={day.id}
                  tripId={tripId}
                  day={day}
                  dayIndex={index}
                  offers={offersByDay.get(day.id) ?? []}
                  onAddActivity={handleAddActivity}
                  onEditActivity={handleEditActivity}
                  onDeleteActivity={handleDeleteActivity}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>

            <DragOverlay>
              {activeActivity ? (
                <div className="opacity-90">
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
        )}
      </div>

      <ActivityDrawer
        open={drawerOpen}
        tripId={tripId}
        activity={editingActivity}
        onClose={() => setDrawerOpen(false)}
        onSave={handleDrawerSave}
        isSaving={isSaving}
      />
    </div>
  )
}
