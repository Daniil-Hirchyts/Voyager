import { Clock3, MapPin, MessageSquare, Pencil, Sparkles, Tag, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { formatMoney } from '@/shared/lib/format'
import type { PlannerActivity } from '@/shared/api/types'

interface Props {
  open: boolean
  activity: PlannerActivity | null
  dayLabel: string | null
  onClose: () => void
  onEdit: (activity: PlannerActivity) => void
  onDelete: (activityId: string) => void
}

function assignmentLabel(activity: PlannerActivity, dayLabel: string | null) {
  return activity.trip_day_id == null ? 'Inbox' : dayLabel ?? 'Assigned day'
}

function scheduleLabel(activity: PlannerActivity) {
  if (activity.start_time) {
    return `${activity.start_time}${activity.duration_min ? ` · ${activity.duration_min} min` : ''}`
  }
  if (activity.duration_min) {
    return `${activity.duration_min} min`
  }
  return activity.trip_day_id == null ? 'Not scheduled yet' : 'No time set'
}

export function ActivityDetailsDrawer({
  open,
  activity,
  dayLabel,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  const isMobile = useIsMobile()

  if (!activity) {
    return null
  }

  const assignment = assignmentLabel(activity, dayLabel)
  const schedule = scheduleLabel(activity)
  const headerSummary = [
    activity.place?.name ?? null,
    activity.start_time ? schedule : null,
    activity.estimated_cost_amount != null
      ? formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency)
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={
          isMobile
            ? 'flex h-[92dvh] flex-col overflow-hidden rounded-t-[14px] border-x-0 border-b-0 bg-white p-0 sm:max-w-none'
            : 'flex h-full w-full max-w-[31rem] flex-col overflow-hidden bg-white p-0 sm:max-w-[31rem]'
        }
      >
        <SheetHeader className="gap-2 border-b border-black/8 bg-white px-5 py-4">
          <div className="flex flex-wrap items-center gap-3 text-[0.72rem] text-[var(--color-text-muted)]">
            <span>{assignment}</span>
            {activity.source !== 'manual' ? (
              <span className="inline-flex items-center gap-1.5 text-[#5f6b7a]">
                <Sparkles className="h-3.5 w-3.5" />
                Generated
              </span>
            ) : null}
          </div>
          <SheetTitle className="text-[1.12rem] font-medium tracking-[-0.03em]">{activity.title}</SheetTitle>
          <SheetDescription className="text-[0.92rem] leading-6">
            {headerSummary || 'No place linked yet'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-[#f6f7f8] px-4 py-4">
          <section className="rounded-[12px] border border-black/8 bg-white px-4 py-4">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Summary
            </p>
            <p className="mt-2.5 text-[0.92rem] leading-6 text-[var(--color-text)]">
              {activity.description || 'No description added yet.'}
            </p>
          </section>

          <section className="mt-3 rounded-[12px] border border-black/8 bg-white px-4 py-4">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              Details
            </p>
            <div className="mt-3 overflow-hidden rounded-[10px] border border-black/6 bg-[var(--color-secondary-surface)]">
              <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 px-3 py-2.5">
                <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">Day</p>
                <p className="min-w-0 text-sm text-[var(--color-text)]">{assignment}</p>
              </div>
              <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 border-t border-black/6 px-3 py-2.5">
                <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">Time</p>
                <div className="flex min-w-0 items-center gap-2 text-sm text-[var(--color-text)]">
                  <Clock3 className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                  <p className="min-w-0">{schedule}</p>
                </div>
              </div>
              <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 border-t border-black/6 px-3 py-2.5">
                <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">Place</p>
                <div className="flex min-w-0 items-start gap-2 text-sm text-[var(--color-text)]">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                  <p className="min-w-0">
                    {activity.place?.address_text ?? activity.place?.name ?? 'No place linked yet'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 border-t border-black/6 px-3 py-2.5">
                <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">Budget</p>
                <p className="text-sm text-[var(--color-text)]">
                  {activity.estimated_cost_amount != null
                    ? formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency)
                    : 'No budget set'}
                </p>
              </div>
            </div>
          </section>

          {activity.tags.length > 0 ? (
            <section className="mt-3 rounded-[12px] border border-black/8 bg-white px-4 py-4">
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                Tags
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {activity.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="rounded-full border border-black/6 bg-[var(--color-secondary-surface)] px-2.5 py-1 text-[0.72rem] font-normal text-[var(--color-text-muted)]"
                  >
                    <Tag className="mr-1.5 h-3.5 w-3.5" />
                    {tag}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}

          {activity.notes ? (
            <section className="mt-3 rounded-[12px] border border-black/8 bg-white px-4 py-4">
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                Notes
              </p>
              <div className="mt-2.5 flex items-start gap-2 text-[0.92rem] leading-6 text-[var(--color-text)]">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                <p>{activity.notes}</p>
              </div>
            </section>
          ) : null}
        </div>

        <SheetFooter className="border-t border-black/8 bg-white px-4 py-4">
          <Button type="button" variant="outline" className="h-10 flex-1 rounded-[10px] border-black/8 bg-white shadow-none" onClick={() => onEdit(activity)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" className="h-10 flex-1 rounded-[10px]">
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-[12px] border-black/8 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete activity</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove "{activity.title}" from this trip? This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-[10px]">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="rounded-[10px]"
                  onClick={() => onDelete(activity.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
