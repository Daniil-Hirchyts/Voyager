import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/lib/cn'
import type { PlannerActivity } from '@/shared/api/types'
import { ActivityCard } from './ActivityCard'

interface PlannerInboxProps {
  activities: PlannerActivity[]
  selectedActivityId?: string | null
  title?: string
  subtitle?: string
  className?: string
  emptyMessage?: string
  onSelectActivity?: (activity: PlannerActivity) => void
  onAddActivity?: () => void
}

export function PlannerInbox({
  activities,
  selectedActivityId = null,
  title = 'Inbox',
  subtitle = 'Unassigned activities',
  className,
  emptyMessage = 'No activities in inbox.',
  onSelectActivity,
  onAddActivity,
}: PlannerInboxProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'inbox',
    data: { type: 'container', containerId: 'inbox', dayId: null },
  })
  const { setNodeRef: setEndZoneRef, isOver: isOverEnd } = useDroppable({
    id: 'inbox::end',
    data: { type: 'container-end', containerId: 'inbox', dayId: null },
  })

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex h-full min-h-0 flex-col rounded-[14px] border border-black/8 bg-white',
        isOver && 'border-black/16 ring-2 ring-black/6',
        className,
      )}
      aria-label={title}
    >
      <header className="border-b border-black/8 bg-[var(--color-secondary-surface)] px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-white text-[var(--color-text-muted)]">
              <Inbox className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-[0.92rem] font-medium text-[var(--color-text)]">{title}</h3>
              <p className="mt-1 text-[0.74rem] text-[var(--color-text-muted)]">{subtitle}</p>
            </div>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-[0.68rem] font-medium text-[var(--color-text-muted)]">
            {activities.length}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-2.5 py-2.5">
        {activities.length === 0 ? (
          <div className="flex min-h-[160px] flex-1 items-center justify-center rounded-[12px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] px-4 text-center text-sm text-[var(--color-text-muted)]">
            {emptyMessage}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            <SortableContext items={activities.map((activity) => activity.id)} strategy={verticalListSortingStrategy}>
              {activities.map((activity) => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  onOpen={onSelectActivity}
                  isSelected={selectedActivityId === activity.id}
                />
              ))}
            </SortableContext>
            <div
              ref={setEndZoneRef}
              className={cn(
                'min-h-10 rounded-[12px] border border-dashed border-transparent transition-colors',
                isOverEnd && 'border-black/16 bg-[var(--color-secondary-surface)]',
              )}
            />
          </div>
        )}
      </div>

      {onAddActivity ? (
        <div className="border-t border-black/8 p-2.5">
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full rounded-[10px] border-dashed border-black/8 bg-white text-[var(--color-text-muted)] shadow-none hover:border-black/12 hover:bg-[var(--color-secondary-surface)] hover:text-[var(--color-text)]"
            onClick={() => onAddActivity()}
          >
            Add activity
          </Button>
        </div>
      ) : null}
    </section>
  )
}
