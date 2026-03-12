import { Fragment } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouteLegEstimates } from '@/entities/routes/queries'
import { cn } from '@/shared/lib/cn'
import type { PlannerActivity, PlannerDay, RouteTravelMode } from '@/shared/api/types'
import { ActivityCard } from './ActivityCard'
import { TravelConnector } from './TravelConnector'
import {
  buildPlannerTravelLegs,
  formatTravelDistance,
  formatTravelDuration,
  summarizePlannerTravelLegs,
} from './travel-estimates'

interface Props {
  day: PlannerDay
  selectedActivityId?: string | null
  isDragActive?: boolean
  travelMode?: RouteTravelMode
  onAddActivity: (dayId: string) => void
  onOpenActivity: (activity: PlannerActivity) => void
  onToggleVisited?: (activityId: string, currentVisitedAt: string | null) => void
  className?: string
}


export function DayColumn({
  day,
  selectedActivityId = null,
  isDragActive = false,
  travelMode = 'WALK',
  onAddActivity,
  onOpenActivity,
  onToggleVisited,
  className,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: day.id,
    data: { type: 'container', containerId: day.id, dayId: day.id },
  })
  const { setNodeRef: setEndZoneRef, isOver: isOverEnd } = useDroppable({
    id: `${day.id}::end`,
    data: { type: 'container-end', containerId: day.id, dayId: day.id },
  })

  const activities = [...day.activities].sort((left, right) => left.order_index - right.order_index)
  const fallbackTravelLegs = buildPlannerTravelLegs(activities, travelMode)
  const routeLegPayload = activities.length > 1
    ? {
        legs: activities.slice(1).flatMap((activity, index) => {
          const previousActivity = activities[index]
          const originLat = previousActivity.place?.lat
          const originLon = previousActivity.place?.lon
          const destinationLat = activity.place?.lat
          const destinationLon = activity.place?.lon

          if (
            typeof originLat !== 'number' ||
            typeof originLon !== 'number' ||
            typeof destinationLat !== 'number' ||
            typeof destinationLon !== 'number'
          ) {
            return []
          }

          return [
            {
              from_activity_id: previousActivity.id,
              to_activity_id: activity.id,
              origin: { lat: originLat, lng: originLon },
              destination: { lat: destinationLat, lng: destinationLon },
            },
          ]
        }),
        travel_mode: travelMode,
      }
    : null
  const routeLegEstimates = useRouteLegEstimates(
    routeLegPayload && routeLegPayload.legs.length > 0 ? routeLegPayload : null,
    Boolean(routeLegPayload?.legs.length),
  )
  const travelLegs = routeLegEstimates.data?.items?.length
    ? fallbackTravelLegs.map((leg) => {
        const estimate = routeLegEstimates.data?.items.find(
          (item) =>
            item.from_activity_id === leg.fromActivityId && item.to_activity_id === leg.toActivityId,
        )
        return estimate
          ? {
              ...leg,
              distanceKm: estimate.distance_km,
              durationMin: estimate.duration_min,
            }
          : leg
      })
    : fallbackTravelLegs
  const travelLegsByToActivityId = new Map(travelLegs.map((leg) => [leg.toActivityId, leg]))
  const travelSummary = summarizePlannerTravelLegs(travelLegs)


  return (
    <section
      className={cn(
        'flex h-full min-h-0 w-full lg:w-[320px] lg:min-w-[320px] lg:max-w-[320px] flex-col overflow-hidden rounded-[14px] border border-black/8 bg-white',
        isOver && 'border-black/16 ring-2 ring-black/6',
        className,
      )}
      aria-label={`Day ${day.day_index + 1}`}
    >
      <header className="hidden lg:flex flex-col justify-center h-[4.5rem] border-b border-black/8 bg-[var(--color-secondary-surface)] px-4">
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex flex-col items-start gap-0.5">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[0.92rem] font-medium text-[var(--color-text)]">
                Day {day.day_index + 1}
              </h3>
              <span className="text-[0.76rem] text-[var(--color-text-muted)]">
                {format(new Date(day.date), 'EEEE')}
              </span>
            </div>
            <p className="text-[0.72rem] text-[var(--color-text-muted)]">
              {format(new Date(day.date), 'MMM d, yyyy')}
            </p>
          </div>
          {travelSummary && travelSummary.distanceKm > 0 ? (
            <p
              className="text-[0.72rem] text-[var(--color-text-muted)]"
              data-testid={`planner-day-travel-summary-${day.id}`}
            >
              {formatTravelDistance(travelSummary.distanceKm)} · {formatTravelDuration(travelSummary.durationMin)}
            </p>
          ) : null}
        </div>
      </header>

      <div
        ref={setNodeRef}
        data-planner-scrollable="vertical"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-2.5"
      >
        <SortableContext items={activities.map((activity) => activity.id)} strategy={verticalListSortingStrategy}>
          {activities.map((activity) => {
            const travelLeg = travelLegsByToActivityId.get(activity.id)

            return (
              <Fragment key={activity.id}>
                {travelLeg ? (
                  <TravelConnector
                    durationMin={travelLeg.durationMin}
                    distanceKm={travelLeg.distanceKm}
                    testId={`planner-travel-leg-${travelLeg.toActivityId}`}
                  />
                ) : null}
                <ActivityCard
                  activity={activity}
                  onOpen={onOpenActivity}
                  isSelected={selectedActivityId === activity.id}
                  onToggleVisited={onToggleVisited ? () => onToggleVisited(activity.id, activity.visited_at) : undefined}
                />
              </Fragment>
            )
          })}
        </SortableContext>

        {activities.length === 0 ? (
          <div
            className={cn(
              'flex min-h-[160px] flex-1 flex-col items-center justify-center rounded-[12px] border border-dashed px-5 text-center',
              isOver ? 'border-black/16 bg-[var(--color-secondary-surface)]' : 'border-black/8 bg-[var(--color-secondary-surface)]',
            )}
          >
            <Plus className="h-5 w-5 text-[var(--color-text-muted)]" />
            <p className="mt-2 text-[0.82rem] text-[var(--color-text-muted)]">
              Drop activities here or add one manually.
            </p>
          </div>
        ) : (
          <div
            ref={setEndZoneRef}
            className={cn(
              'overflow-hidden rounded-[12px] border border-dashed border-transparent transition-[min-height,opacity,background-color,border-color]',
              isDragActive ? 'min-h-10 opacity-100' : 'min-h-0 opacity-0',
              isOverEnd && 'border-black/16 bg-[var(--color-secondary-surface)]',
            )}
          />
        )}
      </div>

      <div className="border-t border-black/8 p-2.5">
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full rounded-[10px] border-dashed border-black/8 bg-white text-[var(--color-text-muted)] shadow-none hover:border-black/12 hover:bg-[var(--color-secondary-surface)] hover:text-[var(--color-text)]"
          onClick={() => onAddActivity(day.id)}
        >
          Add activity
        </Button>
      </div>
    </section>
  )
}
