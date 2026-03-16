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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import { formatMoney } from '@/shared/lib/format';
import type { PlannerActivity } from '@/shared/api/types';
import {
  plannerCategoryDescription,
  plannerCategoryLabel,
  plannerPrimaryPlace,
  plannerTravelRoute,
} from './categories';
import { PlannerPreviewMap } from './PlannerPreviewMap';
import TripAssetManager from '@/widgets/trip-assets';
import { cn } from '@/shared/lib/cn';
import {
  BedDouble,
  Clock3,
  Landmark,
  MapPin,
  Pencil,
  Plane,
  Receipt,
  Ticket,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';

interface Props {
  open: boolean;
  tripId: string;
  activity: PlannerActivity | null;
  dayLabel: string | null;
  onClose: () => void;
  onEdit: (activity: PlannerActivity) => void;
  onDelete: (activityId: string) => void;
}

const CATEGORY_ICON: Record<string, typeof Landmark> = {
  visit: Landmark,
  eat: Utensils,
  activity: Ticket,
  hotel: BedDouble,
  travel: Plane,
};

function detailsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function scheduleLabel(activity: PlannerActivity): string | null {
  const formatTime = (t: string) => (t.length > 5 ? t.substring(0, 5) : t);
  const formatDur = (m: number) => {
    if (m >= 60) {
      const h = m / 60;
      return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
    }
    return `${m}m`;
  };
  if (activity.start_time) {
    return `${formatTime(activity.start_time)}${
      activity.duration_min ? ` · ${formatDur(activity.duration_min)}` : ''
    }`;
  }
  if (activity.duration_min) return formatDur(activity.duration_min);
  return activity.trip_day_id == null ? null : 'Flexible';
}

function MapPreview({ activity }: { activity: PlannerActivity }) {
  const primaryPlace = plannerPrimaryPlace(activity);
  const travelRoute = plannerTravelRoute(activity);
  const hasPrimaryPoint = primaryPlace?.lat != null && primaryPlace.lon != null;
  if (!hasPrimaryPoint && travelRoute.length === 0) return null;
  return (
    <PlannerPreviewMap
      primaryPoint={
        hasPrimaryPoint
          ? { lat: primaryPlace.lat!, lon: primaryPlace.lon!, title: primaryPlace.name }
          : null
      }
      routePoints={travelRoute.map((p) => ({ lat: p.lat, lon: p.lon, title: p.label }))}
      heightPx={176}
    />
  );
}

export function ActivityDetailsDrawer({
  open,
  tripId,
  activity,
  dayLabel,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  const isMobile = useIsMobile();

  if (!activity) return null;

  const details = detailsRecord(activity.category_details);
  const categoryLabel = plannerCategoryLabel(activity.category);
  const CategoryIcon = CATEGORY_ICON[activity.category] ?? Landmark;
  const categoryDescription = plannerCategoryDescription(activity);
  const travelRoute = plannerTravelRoute(activity);
  const schedule = scheduleLabel(activity);
  const budgetLabel =
    activity.estimated_cost_amount != null
      ? (formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency) ?? null)
      : null;

  const infoItems = [
    schedule ? { key: 'schedule', label: 'Schedule', value: schedule, Icon: Clock3 } : null,
    categoryDescription
      ? { key: 'location', label: 'Location', value: categoryDescription, Icon: MapPin }
      : null,
    budgetLabel ? { key: 'budget', label: 'Budget', value: budgetLabel, Icon: Receipt } : null,
    {
      key: 'placement',
      label: 'Placement',
      value: dayLabel ?? (activity.trip_day_id == null ? 'Inbox' : 'Assigned'),
      Icon: CategoryIcon,
    },
  ].filter((item): item is NonNullable<typeof item> => Boolean(item?.value));

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={cn(
          'flex flex-col overflow-hidden bg-[var(--color-secondary-surface)] p-0',
          isMobile
            ? 'h-[94dvh] rounded-t-[16px] border-x-0 border-b-0 sm:max-w-none'
            : 'h-full w-full max-w-[28rem] sm:max-w-[28rem]',
        )}
      >
        <SheetTitle className="sr-only">{activity.title}</SheetTitle>
        <SheetDescription className="sr-only">
          {categoryDescription || dayLabel || 'Activity details'}
        </SheetDescription>
        {/* Header */}
        <div className="shrink-0 border-b border-[var(--color-border)] bg-white px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Badge variant="outline" className="rounded-full">
                <CategoryIcon className="mr-1 h-3 w-3" />
                {categoryLabel}
              </Badge>
              <h2 className="mt-3 text-[1.15rem] font-semibold tracking-[-0.03em] text-[var(--color-text)]">
                {activity.title}
              </h2>
              {categoryDescription ? (
                <p className="mt-1 line-clamp-2 text-[0.84rem] leading-5 text-[var(--color-text-muted)]">
                  {categoryDescription}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => onEdit(activity)}
                className="rounded-full border border-[var(--color-border)] bg-white/90 p-2 text-[var(--color-text-muted)] transition-colors hover:bg-white hover:text-[var(--color-text)]"
                aria-label="Edit activity"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="hover:text-destructive rounded-full border border-[var(--color-border)] bg-white/90 p-2 text-[var(--color-text-muted)] transition-colors hover:bg-white"
                    aria-label="Delete activity"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-[14px] border-[var(--color-border)] bg-white">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete activity</AlertDialogTitle>
                    <AlertDialogDescription>
                      Remove &ldquo;{activity.title}&rdquo; from this trip? This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-[12px]">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="rounded-[12px]"
                      onClick={() => {
                        onDelete(activity.id);
                        onClose();
                      }}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-[var(--color-border)] bg-white/90 p-2 text-[var(--color-text-muted)] transition-colors hover:bg-white hover:text-[var(--color-text)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="space-y-3">
            <MapPreview activity={activity} />

            {activity.description ? (
              <div className="rounded-[18px] border border-[var(--color-border)] bg-white px-4 py-4">
                <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                  Summary
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text)]">
                  {activity.description}
                </p>
              </div>
            ) : null}

            {infoItems.map((item) => (
              <div
                key={item.key}
                className="rounded-[18px] border border-[var(--color-border)] bg-white px-4 py-3"
              >
                <div className="flex items-center gap-2 text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                  <item.Icon className="h-3.5 w-3.5" />
                  {item.label}
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text)]">{item.value}</p>
              </div>
            ))}

            {activity.category === 'travel' && travelRoute.length > 0 ? (
              <div className="rounded-[18px] border border-[var(--color-border)] bg-white px-4 py-4">
                <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                  Route
                </p>
                <div className="mt-3 space-y-2">
                  {travelRoute.map((point, idx) => (
                    <div
                      key={`${point.label}-${idx}`}
                      className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-3 py-2.5"
                    >
                      <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                        {idx === 0 ? 'Origin' : 'Destination'}
                      </p>
                      <p className="mt-1 text-sm text-[var(--color-text)]">{point.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {activity.category === 'hotel' ? (
              <div className="rounded-[18px] border border-[var(--color-border)] bg-white px-4 py-4">
                <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                  Stay
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {typeof details.checkin_date === 'string' ? (
                    <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-3 py-2.5">
                      <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                        Check-in
                      </p>
                      <p className="mt-1 text-sm text-[var(--color-text)]">
                        {details.checkin_date}
                      </p>
                    </div>
                  ) : null}
                  {typeof details.checkout_date === 'string' ? (
                    <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-3 py-2.5">
                      <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                        Check-out
                      </p>
                      <p className="mt-1 text-sm text-[var(--color-text)]">
                        {details.checkout_date}
                      </p>
                    </div>
                  ) : null}
                  {typeof details.room_type === 'string' ? (
                    <div className="col-span-2 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-3 py-2.5">
                      <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                        Room
                      </p>
                      <p className="mt-1 text-sm text-[var(--color-text)]">{details.room_type}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {activity.notes ? (
              <div className="rounded-[18px] border border-[var(--color-border)] bg-white px-4 py-4">
                <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                  Notes
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--color-text)]">{activity.notes}</p>
              </div>
            ) : null}

            <TripAssetManager
              tripId={tripId}
              activityId={activity.id}
              title="Attachments"
              description="Add receipts, reservation PDFs, screenshots, and extra photos that belong to this activity."
              className=""
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
