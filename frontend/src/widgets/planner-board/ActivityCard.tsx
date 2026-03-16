import type { ButtonHTMLAttributes } from 'react';
import { defaultAnimateLayoutChanges, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BedDouble,
  Check,
  CircleCheck,
  Clock3,
  GripVertical,
  Landmark,
  Plane,
  Ticket,
  Utensils,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
import { formatMoney } from '@/shared/lib/format';
import type { ActivityCategory, PlannerActivity } from '@/shared/api/types';
import { plannerCategoryDescription, plannerCategoryLabel } from './categories';

interface BaseProps {
  activity: PlannerActivity;
  onOpen?: (activity: PlannerActivity) => void;
  onToggleVisited?: () => void;
  isDragging?: boolean;
  isSelected?: boolean;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  showDragHandle?: boolean;
}

const CATEGORY_ICON: Record<ActivityCategory, typeof Landmark> = {
  visit: Landmark,
  eat: Utensils,
  activity: Ticket,
  hotel: BedDouble,
  travel: Plane,
};

function scheduleLabel(activity: PlannerActivity) {
  const formatTime = (t: string) => (t.length > 5 ? t.substring(0, 5) : t);
  const formatDur = (m: number) => {
    if (m >= 60) {
      const h = m / 60;
      return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
    }
    return `${m}m`;
  };

  if (!activity.start_time) {
    return activity.duration_min ? formatDur(activity.duration_min) : null;
  }
  return `${formatTime(activity.start_time)}${
    activity.duration_min ? ` · ${formatDur(activity.duration_min)}` : ''
  }`;
}

export function ActivityCardView({
  activity,
  onOpen,
  onToggleVisited,
  isDragging = false,
  isSelected = false,
  dragHandleProps,
  showDragHandle = false,
}: BaseProps) {
  const schedule = scheduleLabel(activity);
  const categoryLabel = plannerCategoryLabel(activity.category);
  const categoryDescription = plannerCategoryDescription(activity);
  const normalizedTitle = activity.title.trim().toLowerCase();
  const normalizedDescription = categoryDescription?.trim().toLowerCase() ?? null;
  const secondaryLabel =
    normalizedDescription && normalizedDescription !== normalizedTitle
      ? categoryDescription
      : activity.place?.address_text &&
          activity.place.address_text.trim().toLowerCase() !== normalizedTitle
        ? activity.place.address_text
        : null;
  const CategoryIcon = CATEGORY_ICON[activity.category] ?? Landmark;
  const shouldRenderDragHandle = Boolean(dragHandleProps || showDragHandle);

  return (
    <article
      className={cn(
        'group flex flex-col rounded-[12px] border border-black/8 bg-white transition-[border-color,box-shadow]',
        'hover:border-black/12',
        isSelected && 'border-black/16 ring-2 ring-black/6',
        isDragging && 'border-black/16',
        activity.visited_at && 'border-emerald-100 bg-emerald-50/30',
      )}
      aria-label={`Activity: ${activity.title}`}
    >
      <div className="flex items-start justify-between gap-2 px-3 pt-2 pb-1">
        <div className="flex min-w-0 items-center gap-2 text-[0.7rem] font-medium text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-secondary-surface)] px-2 py-1">
            <CategoryIcon className="h-3.5 w-3.5" />
            <span>{categoryLabel}</span>
          </span>
          {schedule ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Clock3 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{schedule}</span>
            </span>
          ) : null}
          {activity.visited_at ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">
              <Check className="h-3 w-3" />
              Visited
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {onToggleVisited ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'size-7 shrink-0 rounded-[8px] hover:bg-[var(--color-secondary-surface)]',
                activity.visited_at
                  ? 'text-emerald-600 hover:text-emerald-700'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              )}
              aria-label={activity.visited_at ? 'Mark as not visited' : 'Mark as visited'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisited();
              }}
            >
              <CircleCheck className="h-4 w-4" />
            </Button>
          ) : null}
          {dragHandleProps ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 rounded-[8px] text-[var(--color-text-muted)] hover:bg-[var(--color-secondary-surface)] hover:text-[var(--color-text)]"
              aria-label="Drag activity"
              data-testid="activity-card-drag-handle"
              {...dragHandleProps}
            >
              <GripVertical className="h-4 w-4" />
            </Button>
          ) : shouldRenderDragHandle ? (
            <span
              aria-hidden="true"
              data-testid="activity-card-drag-handle"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--color-text-muted)]"
            >
              <GripVertical className="h-4 w-4" />
            </span>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpen?.(activity)}
        aria-label={activity.title}
        className="flex flex-1 flex-col items-start gap-1.5 px-3 pb-3 text-left"
      >
        <div className="w-full min-w-0">
          <h3 className="line-clamp-2 text-[0.95rem] leading-5 font-medium text-[var(--color-text)]">
            {activity.title}
          </h3>
        </div>

        <div className="mt-auto flex w-full items-center justify-between gap-3 text-[0.74rem] text-[var(--color-text-muted)]">
          <span className="truncate">{secondaryLabel ?? 'No location linked yet'}</span>
          {activity.estimated_cost_amount != null ? (
            <span className="shrink-0 font-medium">
              {formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency)}
            </span>
          ) : null}
        </div>
      </button>
    </article>
  );
}

type SortableProps = Omit<BaseProps, 'dragHandleProps'>;

export function ActivityCard({
  activity,
  onOpen,
  onToggleVisited,
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
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.42 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ActivityCardView
        activity={activity}
        onOpen={onOpen}
        onToggleVisited={onToggleVisited}
        isDragging={isDragging || isSortableDragging}
        isSelected={isSelected}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}
