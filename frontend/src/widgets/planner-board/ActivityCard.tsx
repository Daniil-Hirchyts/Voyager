import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Clock,
  DollarSign,
  GripVertical,
  MapPin,
  MessageSquare,
  Pencil,
  Star,
  Tag,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { usePlace } from '@/entities/place/queries'
import { formatMoney } from '@/shared/lib/format'
import type { Activity } from '@/shared/api/types'

interface Props {
  activity: Activity
  onEdit: (activity: Activity) => void
  onDelete: (activityId: string) => void
  onToggleFavorite: (activity: Activity) => void
  isDragging?: boolean
}

export function ActivityCard({ activity, onEdit, onDelete, onToggleFavorite, isDragging }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { data: place } = usePlace(activity.place_id)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: activity.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.4 : 1,
  }

  const isAI = activity.source !== 'manual'
  const placeName = place?.name

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: 'var(--color-surface)',
        borderColor: activity.is_favorite ? 'rgba(197, 106, 61, 0.4)' : 'var(--color-border)',
        boxShadow: isSortableDragging ? '0 8px 24px rgba(0,0,0,0.15)' : undefined,
      }}
      className={cn(
        'group relative rounded-[14px] border transition-all',
        isSortableDragging && 'shadow-lg ring-2 ring-[#2F6F73]/30',
        isDragging && 'rotate-1',
      )}
      aria-label={`Activity: ${activity.title}`}
    >
      <div className="flex items-start gap-2 p-3">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 p-0.5 rounded cursor-grab active:cursor-grabbing text-[#CDBEA8] hover:text-[#526072] transition-colors shrink-0"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={cn(
                  'shrink-0 w-1.5 h-1.5 rounded-full mt-1',
                  isAI ? 'bg-[#6EA4A6]' : 'bg-[#6B7A4B]',
                )}
                title={isAI ? 'AI generated' : 'Manual'}
                aria-label={isAI ? 'AI generated activity' : 'Manual activity'}
              />
              <h3 className="font-medium text-sm text-[#1D2430] leading-snug">{activity.title}</h3>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onToggleFavorite(activity)}
                className={cn(
                  'p-1 rounded-lg transition-colors',
                  activity.is_favorite
                    ? 'text-[#C56A3D]'
                    : 'text-[#CDBEA8] hover:text-[#C56A3D] opacity-0 group-hover:opacity-100',
                )}
                aria-label={activity.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={activity.is_favorite}
              >
                <Star className={cn('w-3.5 h-3.5', activity.is_favorite && 'fill-current')} />
              </button>
              <button
                onClick={() => onEdit(activity)}
                className="p-1 rounded-lg text-[#CDBEA8] hover:text-[#526072] transition-colors opacity-0 group-hover:opacity-100"
                aria-label="Edit activity"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onDelete(activity.id)}
                className="p-1 rounded-lg text-[#CDBEA8] hover:text-[#C56A3D] transition-colors opacity-0 group-hover:opacity-100"
                aria-label="Delete activity"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {activity.start_time && (
              <span
                className="flex items-center gap-1 text-xs text-[#526072]"
                aria-label={`Start time: ${activity.start_time}`}
              >
                <Clock className="w-3 h-3" />
                {activity.start_time}
                {activity.duration_min && ` · ${activity.duration_min}m`}
              </span>
            )}
            {activity.estimated_cost_amount != null && (
              <span className="flex items-center gap-1 text-xs text-[#526072]">
                <DollarSign className="w-3 h-3" />
                {formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency)}
              </span>
            )}
            {activity.tags.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-[#526072]">
                <Tag className="w-3 h-3" />
                {activity.tags.join(', ')}
              </span>
            )}
          </div>

          {placeName && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-[#2F6F73]/6 text-xs text-[#2F6F73]">
              <MapPin className="w-3 h-3" />
              {placeName}
            </div>
          )}

          {(activity.notes || activity.description) && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1.5 flex items-center gap-1 text-xs text-[#526072] hover:text-[#2F6F73] transition-colors"
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'Less' : 'More'}
            </button>
          )}

          {expanded && (
            <div
              className="mt-2 pt-2 border-t space-y-1.5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {activity.description && (
                <p className="text-xs text-[#526072] leading-relaxed">{activity.description}</p>
              )}
              {activity.notes && (
                <div className="flex items-start gap-1.5">
                  <MessageSquare className="w-3 h-3 shrink-0 mt-0.5 text-[#2F6F73]" />
                  <p className="text-xs text-[#526072]">{activity.notes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isAI && (
        <div
          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[#6EA4A6]/60"
          aria-hidden
        />
      )}
    </div>
  )
}
