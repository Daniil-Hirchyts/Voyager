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
import { plannerCategoryDescription, plannerCategoryLabel, plannerPrimaryPlace, plannerTravelRoute } from './categories'
import { PlannerPreviewMap } from './PlannerPreviewMap'
import {
  BedDouble,
  Clock3,
  ExternalLink,
  Landmark,
  MapPin,
  Pencil,
  Plane,
  Receipt,
  Ticket,
  Trash2,
  Utensils,
} from 'lucide-react'

interface Props {
  open: boolean
  tripId: string
  activity: PlannerActivity | null
  dayLabel: string | null
  onClose: () => void
  onEdit: (activity: PlannerActivity) => void
  onDelete: (activityId: string) => void
}

const CATEGORY_ICON = {
  visit: Landmark,
  eat: Utensils,
  activity: Ticket,
  hotel: BedDouble,
  travel: Plane,
}

function detailsRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function scheduleLabel(activity: PlannerActivity) {
  if (activity.start_time) {
    return `${activity.start_time}${activity.duration_min ? ` · ${activity.duration_min} min` : ''}`
  }
  if (activity.duration_min) {
    return `${activity.duration_min} min`
  }
  return activity.trip_day_id == null ? 'Inbox' : 'Flexible'
}

function MapPreview({ activity }: { activity: PlannerActivity }) {
  const primaryPlace = plannerPrimaryPlace(activity)
  const travelRoute = plannerTravelRoute(activity)
  const hasPrimaryPoint = primaryPlace?.lat != null && primaryPlace.lon != null

  if (!hasPrimaryPoint && travelRoute.length === 0) {
    return null
  }

  return (
    <PlannerPreviewMap
      primaryPoint={
        hasPrimaryPoint
          ? {
              lat: primaryPlace.lat!,
              lon: primaryPlace.lon!,
              title: primaryPlace.name,
            }
          : null
      }
      routePoints={travelRoute.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        title: point.label,
      }))}
      heightPx={192}
    />
  )
}

function DetailBlock({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof Clock3
}) {
  return (
    <div className="rounded-[12px] border border-black/8 bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text)]">{value}</p>
    </div>
  )
}

export function ActivityDetailsDrawer({
  open,
  tripId: _tripId,
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

  const details = detailsRecord(activity.category_details)
  const categoryLabel = plannerCategoryLabel(activity.category)
  const categoryDescription = plannerCategoryDescription(activity)
  const CategoryIcon = CATEGORY_ICON[activity.category] ?? Landmark
  const travelRoute = plannerTravelRoute(activity)

  const topMeta = [
    dayLabel ?? (activity.trip_day_id == null ? 'Inbox' : 'Assigned'),
    scheduleLabel(activity),
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
            ? 'flex h-[94dvh] flex-col overflow-hidden rounded-t-[16px] border-x-0 border-b-0 bg-[#f6f7f8] p-0 sm:max-w-none'
            : 'flex h-full w-full max-w-[34rem] flex-col overflow-hidden bg-[#f6f7f8] p-0 sm:max-w-[34rem]'
        }
      >
        <SheetHeader className="gap-2 border-b border-black/8 bg-white px-5 py-5">
          <div className="flex items-center gap-2 text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-secondary-surface)] px-2.5 py-1">
              <CategoryIcon className="h-3.5 w-3.5" />
              {categoryLabel}
            </span>
            {activity.source !== 'manual' ? (
              <span className="rounded-full border border-black/8 px-2.5 py-1">
                {activity.source === 'offer_import' ? 'Imported' : 'Generated'}
              </span>
            ) : null}
          </div>
          <SheetTitle className="text-[1.22rem] font-semibold tracking-[-0.03em]">
            {activity.title}
          </SheetTitle>
          <SheetDescription className="text-sm leading-6">
            {topMeta || categoryDescription || 'Planner activity'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4">
          <MapPreview activity={activity} />

          <section className="mt-3 rounded-[14px] border border-black/8 bg-white px-4 py-4">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              Summary
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text)]">
              {activity.description || 'No description added yet.'}
            </p>
          </section>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <DetailBlock
              label="Schedule"
              value={scheduleLabel(activity)}
              icon={Clock3}
            />
            <DetailBlock
              label="Location"
              value={categoryDescription || 'No place linked yet'}
              icon={MapPin}
            />
            <DetailBlock
              label="Budget"
              value={
                activity.estimated_cost_amount != null
                  ? (formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency) ?? 'No budget set')
                  : 'No budget set'
              }
              icon={Receipt}
            />
            <DetailBlock
              label="Placement"
              value={dayLabel ?? (activity.trip_day_id == null ? 'Inbox' : 'Assigned')}
              icon={CategoryIcon}
            />
          </div>

          {activity.category === 'travel' && travelRoute.length > 0 ? (
            <section className="mt-3 rounded-[14px] border border-black/8 bg-white px-4 py-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                Route
              </p>
              <div className="mt-3 space-y-2">
                {travelRoute.map((point, index) => (
                  <div key={`${point.label}-${index}`} className="rounded-[10px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 py-2.5">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      {index === 0 ? 'Origin' : 'Destination'}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text)]">{point.label}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {activity.category === 'hotel' ? (
            <section className="mt-3 rounded-[14px] border border-black/8 bg-white px-4 py-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                Stay
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {typeof details.checkin_date === 'string' ? (
                  <DetailBlock label="Check-in" value={details.checkin_date} icon={BedDouble} />
                ) : null}
                {typeof details.checkout_date === 'string' ? (
                  <DetailBlock label="Check-out" value={details.checkout_date} icon={BedDouble} />
                ) : null}
                {typeof details.room_type === 'string' ? (
                  <DetailBlock label="Room" value={details.room_type} icon={BedDouble} />
                ) : null}
                {typeof details.cancellation_summary === 'string' ? (
                  <DetailBlock
                    label="Cancellation"
                    value={details.cancellation_summary}
                    icon={BedDouble}
                  />
                ) : null}
              </div>
            </section>
          ) : null}

          {activity.notes ? (
            <section className="mt-3 rounded-[14px] border border-black/8 bg-white px-4 py-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                Notes
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-text)]">{activity.notes}</p>
            </section>
          ) : null}
        </div>

        <SheetFooter className="border-t border-black/8 bg-white px-4 py-4">
          {activity.linked_offer_summary?.deep_link ? (
            <Button
              asChild
              type="button"
              variant="outline"
              className="h-10 rounded-[10px] border-black/8 bg-white shadow-none"
            >
              <a href={activity.linked_offer_summary.deep_link} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open source
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-10 flex-1 rounded-[10px] border-black/8 bg-white shadow-none"
            onClick={() => onEdit(activity)}
          >
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
                <AlertDialogAction className="rounded-[10px]" onClick={() => onDelete(activity.id)}>
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
