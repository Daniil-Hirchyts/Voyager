import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { format } from 'date-fns'
import { Hotel, Plus, Ticket } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/shared/lib/cn'
import type { Activity, Day, Offer } from '@/shared/api/types'
import { ActivityCard } from './ActivityCard'

interface Props {
  tripId: string
  day: Day
  dayIndex: number
  activities: Activity[]
  offers?: Offer[]
  isLoading: boolean
  onAddActivity: (dayId: string) => void
  onEditActivity: (activity: Activity) => void
  onDeleteActivity: (activityId: string, dayId: string) => void
  onToggleFavorite: (activity: Activity) => void
}

export function DayColumn({
  tripId,
  day,
  dayIndex,
  activities,
  offers = [],
  isLoading,
  onAddActivity,
  onEditActivity,
  onDeleteActivity,
  onToggleFavorite,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day.id}` })

  const sortedActivities = [...activities].sort((a, b) => a.order_index - b.order_index)

  return (
    <div
      className={cn(
        'flex flex-col rounded-[18px] border transition-all min-w-[300px] max-w-[340px] w-full shrink-0',
        isOver && 'ring-2 ring-[#2F6F73]/40 ring-offset-1',
      )}
      style={{
        background: isOver ? 'rgba(47, 111, 115, 0.04)' : 'var(--color-surface)',
        borderColor: isOver ? '#2F6F73' : 'var(--color-border)',
      }}
      aria-label={`Day ${dayIndex + 1}`}
    >
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-sm text-[#1D2430]">Day {dayIndex + 1}</h3>
            <p className="text-xs text-[#526072]">{format(new Date(day.date), 'EEE, MMM d')}</p>
          </div>
          <span
            className="text-xs text-[#526072] bg-[#F4EBDD] rounded-full px-2 py-0.5"
            aria-label={`${activities.length} activities`}
          >
            {activities.length}
          </span>
        </div>
        {offers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {offers.map((offer) => (
              <Link
                key={offer.id}
                to={`/app/trips/${tripId}/offers?dayId=${day.id}`}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border hover:bg-[#F4EBDD] transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
              >
                {offer.kind === 'lodging' ? (
                  <Hotel className="w-3 h-3 text-[#2F6F73]" />
                ) : (
                  <Ticket className="w-3 h-3 text-[#2F6F73]" />
                )}
                {offer.title}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div ref={setNodeRef} className="flex-1 p-3 space-y-2 min-h-[80px]">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((item) => (
              <div key={item} className="h-14 rounded-[14px] bg-[#CDBEA8]/30 animate-pulse" />
            ))}
          </div>
        ) : (
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
        )}

        {!isLoading && activities.length === 0 && (
          <div
            className={cn(
              'flex flex-col items-center justify-center py-6 rounded-[10px] border-2 border-dashed text-center transition-colors',
              isOver ? 'border-[#2F6F73] bg-[#2F6F73]/5' : 'border-[#CDBEA8]',
            )}
          >
            <p className="text-xs text-[#526072]">Drop activities here</p>
          </div>
        )}
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={() => onAddActivity(day.id)}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs text-[#526072] rounded-[10px] border border-dashed hover:border-[#2F6F73] hover:text-[#2F6F73] hover:bg-[#2F6F73]/5 transition-all"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Activity
        </button>
      </div>
    </div>
  )
}
