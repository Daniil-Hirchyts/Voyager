import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { format } from 'date-fns'
import { Hotel, Plus, Ticket } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/components/ui/button'
import type { Offer, PlannerActivity, PlannerDay } from '@/shared/api/types'
import { ActivityCard } from './ActivityCard'

interface Props {
  tripId: string
  day: PlannerDay
  offers?: Offer[]
  onAddActivity: (dayId: string) => void
  onEditActivity: (activity: PlannerActivity) => void
  onDeleteActivity: (activityId: string, dayId: string) => void
  onToggleFavorite: (activity: PlannerActivity) => void
}

export function DayColumn({
  tripId,
  day,
  offers = [],
  onAddActivity,
  onEditActivity,
  onDeleteActivity,
  onToggleFavorite,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day.id}` })
  const sortedActivities = [...day.activities].sort((a, b) => a.order_index - b.order_index)

  return (
    <section
      className={cn(
        'flex min-w-[340px] max-w-[380px] shrink-0 flex-col overflow-hidden rounded-[28px] border bg-[var(--color-surface)] shadow-[0_24px_70px_rgba(14,25,35,0.08)] transition-all',
        isOver && 'translate-y-[-2px] border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/18',
      )}
      aria-label={`Day ${day.day_index + 1}`}
    >
      <div className="border-b border-[var(--color-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(240,232,220,0.9))] px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              Day {day.day_index + 1}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-[var(--color-text)]">
              {format(new Date(day.date), 'EEEE')}
            </h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {format(new Date(day.date), 'MMM d, yyyy')}
            </p>
          </div>
          <div className="rounded-full border border-[var(--color-border)] bg-white/85 px-3 py-1 text-xs text-[var(--color-text-muted)]">
            {day.activities.length} activities
          </div>
        </div>

        {offers.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {offers.map((offer) => (
              <Link
                key={offer.id}
                to={`/app/trips/${tripId}/offers?dayId=${day.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white/85 px-3 py-1.5 text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)]/35 hover:text-[var(--color-primary)]"
              >
                {offer.kind === 'lodging' ? (
                  <Hotel className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                ) : (
                  <Ticket className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                )}
                {offer.title}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={setNodeRef} className="flex-1 space-y-4 bg-[rgba(249,246,240,0.92)] p-4">
        <SortableContext
          items={sortedActivities.map((activity) => activity.id)}
          strategy={verticalListSortingStrategy}
        >
          {sortedActivities.map((activity) => (
            <ActivityCard
              key={activity.id}
              activity={activity}
              onEdit={onEditActivity}
              onDelete={(activityId) => onDeleteActivity(activityId, day.id)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </SortableContext>

        {sortedActivities.length === 0 ? (
          <div
            className={cn(
              'flex min-h-[180px] flex-col items-center justify-center rounded-[24px] border border-dashed px-6 text-center transition-all',
              isOver
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/6'
                : 'border-[var(--color-border)] bg-white/55',
            )}
          >
            <p className="text-sm font-medium text-[var(--color-text)]">Drop activities here</p>
            <p className="mt-2 max-w-[220px] text-xs leading-6 text-[var(--color-text-muted)]">
              Use generated ideas as a base or start with a manual activity for this day.
            </p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-[var(--color-border)] bg-white/72 p-4">
        <Button
          variant="outline"
          className="h-12 w-full rounded-full border-dashed text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/6 hover:text-[var(--color-primary)]"
          onClick={() => onAddActivity(day.id)}
        >
          <Plus className="h-4 w-4" />
          Add Activity
        </Button>
      </div>
    </section>
  )
}
