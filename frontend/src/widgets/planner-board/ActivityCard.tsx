import type { ButtonHTMLAttributes } from 'react'
import { defaultAnimateLayoutChanges, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Clock3,
  GripVertical,
  MapPin,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/shared/lib/cn'
import { formatMoney } from '@/shared/lib/format'
import type { PlannerActivity } from '@/shared/api/types'

interface BaseProps {
  activity: PlannerActivity
  onOpen?: (activity: PlannerActivity) => void
  isDragging?: boolean
  isSelected?: boolean
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>
}

function scheduleLabel(activity: PlannerActivity) {
  if (!activity.start_time) {
    return null
  }
  return `${activity.start_time}${activity.duration_min ? ` · ${activity.duration_min}m` : ''}`
}

export function ActivityCardView({
  activity,
  onOpen,
  isDragging = false,
  isSelected = false,
  dragHandleProps,
}: BaseProps) {
  const isGenerated = activity.source !== 'manual'
  const schedule = scheduleLabel(activity)
  const hasMetaRow = Boolean(activity.place?.name || activity.estimated_cost_amount != null)

  return (
    <article
      className={cn(
        'group flex flex-col rounded-[12px] border border-black/8 bg-white transition-[border-color,box-shadow]',
        'hover:border-black/12',
        isSelected && 'border-black/16 ring-2 ring-black/6',
        isDragging && 'border-black/16 shadow-[0_16px_32px_rgba(15,23,42,0.1)]',
      )}
      aria-label={`Activity: ${activity.title}`}
    >
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5">
        <div className="flex min-w-0 items-center gap-2 text-[0.72rem] text-[var(--color-text-muted)]">
          {schedule ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
              <Clock3 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{schedule}</span>
            </span>
          ) : null}
          {isGenerated ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-[8px] bg-[var(--color-secondary-surface)] text-[var(--color-text-muted)]">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Generated activity</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>

        {dragHandleProps ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-[8px] text-[var(--color-text-muted)] hover:bg-[var(--color-secondary-surface)] hover:text-[var(--color-text)]"
            aria-label="Drag activity"
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onOpen?.(activity)}
        className="flex flex-1 flex-col items-start gap-1.5 px-3 pb-3 pt-1.5 text-left"
      >
        <div className="min-w-0 w-full">
          <h3 className="line-clamp-2 text-[0.92rem] font-medium leading-5 text-[var(--color-text)]">
            {activity.title}
          </h3>
          {activity.description ? (
            <p className="mt-1 line-clamp-2 text-[0.76rem] leading-5 text-[var(--color-text-muted)]">
              {activity.description}
            </p>
          ) : null}
        </div>

        {hasMetaRow ? (
          <div className="mt-auto flex w-full items-center justify-between gap-2 text-[0.74rem] text-[var(--color-text-muted)]">
            <div className="flex min-w-0 items-center gap-1.5">
              {activity.place?.name ? (
                <>
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{activity.place.name}</span>
                </>
              ) : null}
            </div>
            {activity.estimated_cost_amount != null ? (
              <span className="shrink-0 font-medium">
                {formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency)}
              </span>
            ) : null}
          </div>
        ) : null}
      </button>
    </article>
  )
}

interface SortableProps extends Omit<BaseProps, 'dragHandleProps'> {}

export function ActivityCard({
  activity,
  onOpen,
  isDragging = false,
  isSelected = false,
}: SortableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: activity.id,
    data: {
      type: 'activity',
      containerId: activity.trip_day_id ?? 'inbox',
      dayId: activity.trip_day_id,
    },
    animateLayoutChanges: defaultAnimateLayoutChanges,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.42 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <ActivityCardView
        activity={activity}
        onOpen={onOpen}
        isDragging={isDragging || isSortableDragging}
        isSelected={isSelected}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}
