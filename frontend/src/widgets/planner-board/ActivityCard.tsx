import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  GripVertical,
  MapPin,
  MessageSquare,
  Pencil,
  Sparkles,
  Star,
  Tag,
  Trash2,
} from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { resolvePhotoUrl } from '@/shared/lib/media'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/shared/lib/format'
import type { PlannerActivity } from '@/shared/api/types'

interface BaseProps {
  activity: PlannerActivity
  onEdit: (activity: PlannerActivity) => void
  onDelete: (activityId: string) => void
  onToggleFavorite: (activity: PlannerActivity) => void
  isDragging?: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>
}

export function ActivityCardView({
  activity,
  onEdit,
  onDelete,
  onToggleFavorite,
  isDragging,
  dragHandleProps,
}: BaseProps) {
  const [expanded, setExpanded] = useState(false)
  const sourceLabel = activity.source === 'manual' ? 'Manual' : 'Generated'
  const photo = resolvePhotoUrl(activity.place?.primary_photo, 'thumb')

  return (
    <div
      className={cn(
        'group overflow-hidden rounded-[24px] border bg-[var(--color-surface-elevated)] transition-all',
        isDragging && 'shadow-[0_18px_48px_rgba(13,20,28,0.2)] ring-2 ring-[var(--color-primary)]/25 rotate-[1.4deg]',
      )}
      aria-label={`Activity: ${activity.title}`}
    >
      <div className="relative">
        <div
          className="h-32 w-full bg-[linear-gradient(135deg,rgba(114,174,230,0.18),rgba(182,214,242,0.22))]"
          style={
            photo
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(11, 18, 24, 0.12), rgba(11, 18, 24, 0.72)), url(${photo})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : undefined
          }
        />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/88 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text)] shadow-sm">
            <Sparkles className="h-3 w-3 text-[var(--color-primary)]" />
            {sourceLabel}
          </div>

          <div className="flex items-center gap-1 rounded-full bg-[rgba(26,22,21,0.44)] p-1 text-white backdrop-blur-sm">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onToggleFavorite(activity)}
              className={cn(
                'h-8 w-8 rounded-full text-white hover:bg-white/12',
                activity.is_favorite && 'text-[var(--color-warning)]',
              )}
              aria-label={activity.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={cn('h-4 w-4', activity.is_favorite && 'fill-current')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(activity)}
              className="h-8 w-8 rounded-full text-white hover:bg-white/12"
              aria-label="Edit activity"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(activity.id)}
              className="h-8 w-8 rounded-full text-white hover:bg-white/12"
              aria-label="Delete activity"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <button
          type="button"
          {...dragHandleProps}
          className="absolute bottom-3 left-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/50 bg-white/90 text-[var(--color-text)] shadow-sm transition-colors hover:bg-white"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-[1rem] font-semibold leading-snug text-[var(--color-text)]">
            {activity.title}
          </h3>
          {activity.description ? (
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--color-text-muted)]">
              {activity.description}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {activity.start_time ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(114,174,230,0.08)] px-3 py-1 text-xs text-[var(--color-primary)]">
              <Clock3 className="h-3.5 w-3.5" />
              {activity.start_time}
              {activity.duration_min ? ` · ${activity.duration_min}m` : ''}
            </span>
          ) : null}
          {activity.place?.name ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(182,214,242,0.08)] px-3 py-1 text-xs text-[var(--color-accent)]">
              <MapPin className="h-3.5 w-3.5" />
              {activity.place.name}
            </span>
          ) : null}
          {activity.estimated_cost_amount != null ? (
            <span className="inline-flex items-center rounded-full bg-[rgba(16,24,32,0.06)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
              {formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency)}
            </span>
          ) : null}
        </div>

        {activity.tags.length ? (
          <div className="flex flex-wrap gap-2">
            {activity.tags.slice(0, expanded ? activity.tags.length : 4).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-[11px] text-[var(--color-text-muted)]"
              >
                <Tag className="h-3 w-3" />
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {activity.notes || activity.description || activity.tags.length > 4 ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary)]"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? 'Collapse details' : 'Expand details'}
          </button>
        ) : null}

        {expanded ? (
          <div className="space-y-3 rounded-[18px] border border-[var(--color-border)] bg-[rgba(248,244,236,0.75)] p-3">
            {activity.notes ? (
              <div className="flex items-start gap-2 text-sm text-[var(--color-text-muted)]">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                <p>{activity.notes}</p>
              </div>
            ) : null}
            {activity.place?.address_text ? (
              <div className="flex items-start gap-2 text-sm text-[var(--color-text-muted)]">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                <p>{activity.place.address_text}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface SortableProps extends Omit<BaseProps, 'dragHandleProps'> {}

export function ActivityCard({
  activity,
  onEdit,
  onDelete,
  onToggleFavorite,
  isDragging,
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
    data: { type: 'activity', dayId: activity.trip_day_id },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.42 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        isSortableDragging && 'shadow-[0_18px_48px_rgba(13,20,28,0.2)] ring-2 ring-[var(--color-primary)]/25',
      )}
    >
      <ActivityCardView
        activity={activity}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleFavorite={onToggleFavorite}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}
