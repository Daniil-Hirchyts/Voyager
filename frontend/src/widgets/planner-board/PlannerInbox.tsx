import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Inbox, Pin, PinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
import type { PlannerActivity } from '@/shared/api/types';
import { ActivityCard } from './ActivityCard';

interface PlannerInboxProps {
  activities: PlannerActivity[];
  selectedActivityId?: string | null;
  title?: string;
  subtitle?: string;
  className?: string;
  isDragActive?: boolean;
  emptyMessage?: string;
  isDetached?: boolean;
  onToggleDetached?: () => void;
  onSelectActivity?: (activity: PlannerActivity) => void;
  onAddActivity?: () => void;
  onToggleVisited?: (activityId: string, currentVisitedAt: string | null) => void;
}

export function PlannerInbox({
  activities,
  selectedActivityId = null,
  title = 'Inbox',
  subtitle = 'Unassigned activities',
  className,
  isDragActive = false,
  emptyMessage = 'No activities in inbox.',
  isDetached = false,
  onToggleDetached,
  onSelectActivity,
  onAddActivity,
  onToggleVisited,
}: PlannerInboxProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'inbox',
    data: { type: 'container', containerId: 'inbox', dayId: null },
  });
  const { setNodeRef: setEndZoneRef, isOver: isOverEnd } = useDroppable({
    id: 'inbox::end',
    data: { type: 'container-end', containerId: 'inbox', dayId: null },
  });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex h-full min-h-0 w-full flex-col rounded-[14px] border border-black/8 bg-white lg:w-[320px] lg:max-w-[320px] lg:min-w-[320px]',
        isOver && 'border-black/16 ring-2 ring-black/6',
        className,
      )}
      aria-label={title}
    >
      <header className="hidden h-[4.5rem] flex-col justify-center border-b border-black/8 bg-[var(--color-secondary-surface)] px-4 lg:flex">
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-white text-[var(--color-text-muted)]">
              <Inbox className="h-4 w-4" />
            </span>
            <div className="flex flex-col items-start gap-0.5">
              <h3 className="text-[0.92rem] font-medium text-[var(--color-text)]">{title}</h3>
              <p className="text-[0.74rem] text-[var(--color-text-muted)]">{subtitle}</p>
            </div>
          </div>

          {onToggleDetached ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-[8px] border-none bg-transparent text-[var(--color-text-muted)] hover:bg-black/4 hover:text-[var(--color-text)]"
              onClick={onToggleDetached}
              title={isDetached ? 'Attach to side' : 'Detach from side'}
            >
              {isDetached ? (
                <PinOff className="h-3.5 w-3.5" />
              ) : (
                <Pin className="h-3.5 w-3.5 rotate-45" />
              )}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-2.5 py-2.5">
        {activities.length === 0 ? (
          <div className="flex min-h-[160px] flex-1 items-center justify-center rounded-[12px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] px-4 text-center text-sm text-[var(--color-text-muted)]">
            {emptyMessage}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <SortableContext
              items={activities.map((activity) => activity.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                {activities.map((activity) => (
                  <ActivityCard
                    key={activity.id}
                    activity={activity}
                    onOpen={onSelectActivity}
                    isSelected={selectedActivityId === activity.id}
                    onToggleVisited={
                      onToggleVisited
                        ? () => onToggleVisited(activity.id, activity.visited_at)
                        : undefined
                    }
                  />
                ))}
              </div>
            </SortableContext>
            <div
              ref={setEndZoneRef}
              className={cn(
                'overflow-hidden rounded-[12px] border border-dashed border-transparent transition-[min-height,margin,opacity,background-color,border-color]',
                isDragActive ? 'mt-2 min-h-10 opacity-100' : 'min-h-0 opacity-0',
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
            className="h-9 w-full rounded-[10px] border-dashed border-black/8 bg-white text-[var(--color-text-muted)] hover:border-black/12 hover:bg-[var(--color-secondary-surface)] hover:text-[var(--color-text)]"
            onClick={() => onAddActivity()}
          >
            Add activity
          </Button>
        </div>
      ) : null}
    </section>
  );
}
