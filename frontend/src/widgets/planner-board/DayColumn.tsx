import { Fragment } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { format } from 'date-fns'
import { Hotel, Plus, Route, Ticket } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useRouteLegEstimates } from '@/entities/routes/queries'
import { cn } from '@/shared/lib/cn'
import type { Offer, PlannerActivity, PlannerDay } from '@/shared/api/types'
import { ActivityCard } from './ActivityCard'
import {
  buildPlannerTravelLegs,
  formatTravelDistance,
  formatTravelDuration,
  summarizePlannerTravelLegs,
  type PlannerTravelLeg,
} from './travel-estimates'

interface Props {
  tripId: string
  day: PlannerDay
  offers?: Offer[]
  selectedActivityId?: string | null
  onAddActivity: (dayId: string) => void
  onOpenActivity: (activity: PlannerActivity) => void
  className?: string
}

function TravelConnector({ leg }: { leg: PlannerTravelLeg }) {
  const durationMin = leg.durationMin
  const distanceKm = leg.distanceKm
  const hasEstimate = durationMin != null && distanceKm != null

  return (
    <div
      data-testid={`planner-travel-leg-${leg.toActivityId}`}
      className="relative px-1 py-0.5"
    >
      <div className="pointer-events-none absolute bottom-0 left-[1.05rem] top-0 border-l border-dashed border-black/10" />
      <div
        className={cn(
          'ml-6 flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[0.72rem] text-[var(--color-text-muted)]',
          hasEstimate ? 'bg-[var(--color-secondary-surface)]' : 'bg-[var(--color-secondary-surface)]/70',
        )}
      >
        <Route className="h-3.5 w-3.5 shrink-0" />
        {hasEstimate ? (
          <>
            <span className="font-medium text-[var(--color-text)]">
              {formatTravelDuration(durationMin)}
            </span>
            <span>&middot;</span>
            <span>{formatTravelDistance(distanceKm)}</span>
          </>
        ) : (
          <span>Add places to estimate travel</span>
        )}
      </div>
    </div>
  )
}

export function DayColumn({
  tripId,
  day,
  offers = [],
  selectedActivityId = null,
  onAddActivity,
  onOpenActivity,
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
  const fallbackTravelLegs = buildPlannerTravelLegs(activities)
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
        travel_mode: 'WALK' as const,
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
        'flex h-full min-h-0 min-w-[280px] flex-col overflow-hidden rounded-[14px] border border-black/8 bg-white',
        isOver && 'border-black/16 ring-2 ring-black/6',
        className,
      )}
      aria-label={`Day ${day.day_index + 1}`}
    >
      <header className="border-b border-black/8 bg-[var(--color-secondary-surface)] px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-[0.92rem] font-medium text-[var(--color-text)]">
                Day {day.day_index + 1}
              </h3>
              <span className="text-[0.76rem] text-[var(--color-text-muted)]">
                {format(new Date(day.date), 'EEEE')}
              </span>
            </div>
            <p className="mt-1 text-[0.72rem] text-[var(--color-text-muted)]">
              {format(new Date(day.date), 'MMM d, yyyy')}
            </p>
            {travelSummary.estimatedLegCount > 0 ? (
              <p
                data-testid={`planner-day-travel-summary-${day.id}`}
                className="mt-2 inline-flex items-center gap-1.5 text-[0.72rem] text-[var(--color-text-muted)]"
              >
                <Route className="h-3.5 w-3.5" />
                <span>
                  {formatTravelDuration(travelSummary.durationMin)} &middot;{' '}
                  {formatTravelDistance(travelSummary.distanceKm)}
                </span>
              </p>
            ) : null}
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-[0.68rem] font-medium text-[var(--color-text-muted)]">
            {activities.length}
          </span>
        </div>

        {offers.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {offers.map((offer) => (
              <Link
                key={offer.id}
                to={`/app/trips/${tripId}/offers?dayId=${day.id}`}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-black/8 bg-white px-2.5 py-1.5 text-[0.72rem] text-[var(--color-text-muted)] transition-colors hover:border-black/12 hover:text-[var(--color-text)]"
              >
                {offer.kind === 'lodging' ? (
                  <Hotel className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                ) : (
                  <Ticket className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                )}
                <span className="truncate">{offer.title}</span>
              </Link>
            ))}
          </div>
        ) : null}
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
                {travelLeg ? <TravelConnector leg={travelLeg} /> : null}
                <ActivityCard
                  activity={activity}
                  onOpen={onOpenActivity}
                  isSelected={selectedActivityId === activity.id}
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
              'min-h-10 rounded-[12px] border border-dashed border-transparent transition-colors',
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
