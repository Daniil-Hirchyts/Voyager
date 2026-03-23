import { type ReactNode, useId } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BedDouble,
  Check,
  Clock3,
  ExternalLink,
  Landmark,
  MapPin,
  Pencil,
  Plane,
  Plus,
  Receipt,
  Star,
  Ticket,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
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
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Badge } from '@/components/ui/badge';
import { AnimatedBackground } from '@/components/ui/animated-background';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PhotoViewer, PhotoViewerProvider } from '@/components/ui/photo-viewer';
import type {
  GooglePlaceCandidate,
  PlannerActivity,
  PlannerMapPlaceDetail,
} from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';
import { formatMoney } from '@/shared/lib/format';
import { resolveMediaUrl } from '@/shared/lib/media';
import { plannerCategoryDescription, plannerCategoryLabel, plannerTravelRoute } from './categories';
import type { PlannerMapStop } from './planner-map-utils';
import type {
  PlannerRecommendationEntry,
  PlannerRecommendationsController,
} from './usePlannerRecommendations';
import { VoyagerLoader } from '../app-shell/logo';
import TripAssetManager from '@/widgets/trip-assets';

export type SearchResultItem = {
  kind: 'saved' | 'google';
  id: string;
  placeId: string | null;
  name: string;
  addressText: string | null;
  category: string | null;
  lat: number | null;
  lon: number | null;
  metadata: Record<string, unknown>;
};

export type ResolvedPlaceDetail = {
  place: {
    id: string;
    name: string;
    address_text: string | null;
  };
  summary: string | null;
  rating: number | null;
  review_count: number | null;
  status_text: string | null;
  price_label: string | null;
  photos: PlannerMapPlaceDetail['photos'];
  reviews: PlannerMapPlaceDetail['reviews'];
  hours: PlannerMapPlaceDetail['hours'];
  booking_links: PlannerMapPlaceDetail['booking_links'];
  tags: string[];
  mentions: PlannerMapPlaceDetail['mentions'];
  related_activities: PlannerMapPlaceDetail['related_activities'];
};

export function toSavedSearchItem(place: {
  id: string;
  name: string;
  address_text: string | null;
  category: string | null;
  lat: number | null;
  lon: number | null;
  metadata: Record<string, unknown>;
}): SearchResultItem {
  return {
    kind: 'saved',
    id: place.id,
    placeId: place.id,
    name: place.name,
    addressText: place.address_text,
    category: place.category,
    lat: place.lat,
    lon: place.lon,
    metadata: place.metadata,
  };
}

export function toGoogleSearchItem(place: GooglePlaceCandidate): SearchResultItem {
  return {
    kind: 'google',
    id: place.place_id,
    placeId: null,
    name: place.name,
    addressText: place.address_text,
    category: place.category,
    lat: place.lat,
    lon: place.lon,
    metadata: place.metadata ?? {},
  };
}

export function toRecommendationSearchItem(entry: PlannerRecommendationEntry): SearchResultItem {
  if (entry.matchedPlace) {
    return {
      kind: 'google',
      id: entry.matchedPlace.place_id,
      placeId: null,
      name: entry.matchedPlace.name || entry.item.title,
      addressText: entry.matchedPlace.address_text ?? entry.item.address_text,
      category: entry.matchedPlace.category ?? entry.item.entity_type,
      lat: entry.matchedPlace.lat ?? entry.item.lat,
      lon: entry.matchedPlace.lon ?? entry.item.lon,
      metadata: {
        ...(entry.matchedPlace.metadata ?? {}),
        recommendation_key: entry.key,
      },
    };
  }

  return {
    kind: 'saved',
    id: entry.key,
    placeId: null,
    name: entry.item.title,
    addressText: entry.item.address_text,
    category: entry.item.entity_type,
    lat: entry.item.lat,
    lon: entry.item.lon,
    metadata: {
      recommendation_key: entry.key,
    },
  };
}

export function isRecommendationSearchItem(item: SearchResultItem | null) {
  const recommendationKey = item?.metadata?.recommendation_key;
  return typeof recommendationKey === 'string' && recommendationKey.trim().length > 0;
}

export function recommendationCoordinates(entry: PlannerRecommendationEntry | null) {
  if (!entry) {
    return null;
  }

  const lat = entry.matchedPlace?.lat ?? entry.item.lat;
  const lon = entry.matchedPlace?.lon ?? entry.item.lon;
  if (lat == null || lon == null) {
    return null;
  }

  return { lat, lon };
}

export function inferActivityCategory(item: SearchResultItem): PlannerActivity['category'] {
  const category = (item.category ?? '').toLowerCase();
  const haystack = `${item.name} ${item.addressText ?? ''} ${category}`.toLowerCase();

  if (category.includes('restaurant') || category.includes('food') || haystack.includes('cafe')) {
    return 'eat';
  }
  if (category.includes('hotel') || category.includes('lodging')) {
    return 'hotel';
  }
  if (category.includes('tour') || category.includes('museum') || category.includes('event')) {
    return 'activity';
  }
  return 'visit';
}

export function resolveGooglePlaceId(
  place:
    | {
        source: string;
        external_id: string | null;
        metadata: Record<string, unknown>;
      }
    | null
    | undefined,
) {
  if (!place) {
    return null;
  }
  if (
    (place.source === 'google_places' || place.source === 'destination') &&
    typeof place.external_id === 'string' &&
    place.external_id.trim()
  ) {
    return place.external_id.trim();
  }
  const metadataPlaceId = place.metadata?.google_place_id;
  return typeof metadataPlaceId === 'string' && metadataPlaceId.trim()
    ? metadataPlaceId.trim()
    : null;
}

function dedupeText(values: Array<string | null | undefined>) {
  const nextValues: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value?.trim();
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    nextValues.push(text);
  }
  return nextValues;
}

export function mergePlaceDetail(
  plannerDetail: PlannerMapPlaceDetail | null | undefined,
  googleDetail:
    | {
        place: GooglePlaceCandidate;
        summary: string | null;
        rating: number | null;
        review_count: number | null;
        status_text: string | null;
        price_label: string | null;
        photos: PlannerMapPlaceDetail['photos'];
        reviews: PlannerMapPlaceDetail['reviews'];
        hours: PlannerMapPlaceDetail['hours'];
        booking_links: PlannerMapPlaceDetail['booking_links'];
        tags: string[];
        mentions: Array<{ label: string; url: string | null }>;
      }
    | null
    | undefined,
): ResolvedPlaceDetail | null {
  if (!plannerDetail && !googleDetail) {
    return null;
  }

  const placeId =
    plannerDetail?.place.id ?? googleDetail?.place.place_id ?? '__google-place-detail__';
  const placeName = googleDetail?.place.name ?? plannerDetail?.place.name ?? 'Selected place';
  const addressText = googleDetail?.place.address_text ?? plannerDetail?.place.address_text ?? null;

  return {
    place: {
      id: placeId,
      name: placeName,
      address_text: addressText,
    },
    summary: googleDetail?.summary ?? plannerDetail?.summary ?? null,
    rating: googleDetail?.rating ?? plannerDetail?.rating ?? null,
    review_count: googleDetail?.review_count ?? plannerDetail?.review_count ?? null,
    status_text: googleDetail?.status_text ?? plannerDetail?.status_text ?? null,
    price_label: googleDetail?.price_label ?? plannerDetail?.price_label ?? null,
    photos: googleDetail?.photos.length ? googleDetail.photos : (plannerDetail?.photos ?? []),
    reviews: googleDetail?.reviews.length ? googleDetail.reviews : (plannerDetail?.reviews ?? []),
    hours: googleDetail?.hours.length ? googleDetail.hours : (plannerDetail?.hours ?? []),
    booking_links: googleDetail?.booking_links.length
      ? googleDetail.booking_links
      : (plannerDetail?.booking_links ?? []),
    tags: dedupeText([...(googleDetail?.tags ?? []), ...(plannerDetail?.tags ?? [])]),
    mentions: [...(googleDetail?.mentions ?? []), ...(plannerDetail?.mentions ?? [])].filter(
      (mention, index, values) => {
        const key = `${mention.label.toLowerCase()}::${mention.url ?? ''}`;
        return (
          values.findIndex((candidate) => {
            return `${candidate.label.toLowerCase()}::${candidate.url ?? ''}` === key;
          }) === index
        );
      },
    ),
    related_activities: plannerDetail?.related_activities ?? [],
  };
}

function DetailSegmentedTabs({
  tabs,
  activeTab,
  onTabChange,
  compact,
  idPrefix,
  controls,
}: {
  tabs: Array<[string, string]>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  compact: boolean;
  idPrefix: string;
  controls?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'shrink-0 border-b border-[var(--color-border)] bg-white/94 backdrop-blur',
        compact ? 'px-2.5 py-1.5' : 'px-3 py-1.5',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 sm:gap-2',
          tabs.length ? 'justify-between' : 'justify-end',
        )}
      >
        {tabs.length ? (
          <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto">
            <div
              className="inline-flex min-w-max items-center gap-0 rounded-[40px] border border-[var(--color-border)] bg-[var(--color-border)] p-[2px]"
              role="tablist"
              aria-label="Place detail sections"
            >
              <AnimatedBackground
                defaultValue={activeTab}
                onValueChange={(value) => {
                  if (value) {
                    onTabChange(value);
                  }
                }}
                className="rounded-[40px] bg-[#1a1a1a]"
                transition={{
                  ease: 'easeInOut',
                  duration: 0.18,
                }}
              >
                {tabs.map(([value, label], index) => (
                  <button
                    key={value}
                    id={`${idPrefix}-tab-${value}`}
                    data-id={value}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === value}
                    aria-controls={`${idPrefix}-panel-${value}`}
                    tabIndex={activeTab === value ? 0 : -1}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        onTabChange(tabs[(index + 1) % tabs.length]?.[0] ?? value);
                      } else if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        onTabChange(tabs[(index - 1 + tabs.length) % tabs.length]?.[0] ?? value);
                      } else if (event.key === 'Home') {
                        event.preventDefault();
                        onTabChange(tabs[0]?.[0] ?? value);
                      } else if (event.key === 'End') {
                        event.preventDefault();
                        onTabChange(tabs[tabs.length - 1]?.[0] ?? value);
                      }
                    }}
                    className={cn(
                      'inline-flex shrink-0 items-center justify-center rounded-[40px] font-semibold tracking-[-0.02em] whitespace-nowrap text-[#5f6b7e] transition-[transform,color] duration-200 hover:text-[#1a1a1a] active:scale-[0.98] data-[checked=true]:text-white',
                      compact
                        ? 'h-7 px-2 text-[0.68rem] sm:px-2.5 sm:text-[0.72rem]'
                        : 'h-8 px-2.5 text-[0.74rem] sm:px-3 sm:text-[0.78rem]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </AnimatedBackground>
            </div>
          </div>
        ) : null}
        {controls ? (
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">{controls}</div>
        ) : null}
      </div>
    </div>
  );
}

export function DetailSheetContent({
  tripId,
  detail,
  fallbackItem,
  selectedStop,
  destinations,
  onAddToTrip,
  onToggleVisited,
  isTogglingVisited,
  isAdding,
  preferredTab,
  onTabChange,
  compact = false,
  isDetailLoading = false,
  onClose,
  dayLabel,
  onEditActivity,
  onDeleteActivity,
}: {
  tripId: string;
  detail: ResolvedPlaceDetail | null | undefined;
  fallbackItem: SearchResultItem | null;
  selectedStop: PlannerMapStop | null;
  destinations: PlannerRecommendationsController['destinations'];
  onAddToTrip: (destinationId: string) => void;
  onToggleVisited: () => void;
  isTogglingVisited: boolean;
  isAdding: boolean;
  preferredTab: string;
  onTabChange: (tab: string) => void;
  compact?: boolean;
  isDetailLoading?: boolean;
  onClose?: () => void;
  dayLabel: string | null;
  onEditActivity?: (activity: PlannerActivity) => void;
  onDeleteActivity?: (activityId: string) => void;
}) {
  const photos = detail?.photos ?? [];
  const renderablePhotos = photos
    .map((photo, index) => {
      const thumbnailUrl = resolveMediaUrl(photo.thumbnail_url) ?? resolveMediaUrl(photo.image_url);
      const fullUrl = resolveMediaUrl(photo.image_url) ?? resolveMediaUrl(photo.thumbnail_url);
      if (!thumbnailUrl || !fullUrl) {
        return null;
      }
      return { photo, index, thumbnailUrl, fullUrl };
    })
    .filter(
      (
        item,
      ): item is {
        photo: (typeof photos)[number];
        index: number;
        thumbnailUrl: string;
        fullUrl: string;
      } => Boolean(item),
    );
  const reviews = (detail?.reviews ?? []).filter(
    (review) =>
      review.rating != null || Boolean(review.text || review.title || review.reviewer_name),
  );
  const tags = detail?.tags ?? [];
  const summary = detail?.summary ?? fallbackItem?.addressText ?? fallbackItem?.category ?? null;
  const title = detail?.place.name ?? fallbackItem?.name ?? selectedStop?.activity.title ?? 'Place';
  const subtitle =
    detail?.place.address_text ??
    fallbackItem?.addressText ??
    selectedStop?.activity.place?.address_text;
  const relatedActivities = detail?.related_activities ?? [];
  const hasSingleRelatedActivity = relatedActivities.length === 1;
  const singleRelatedActivity = hasSingleRelatedActivity ? (relatedActivities[0] ?? null) : null;
  const canToggleVisited = Boolean(selectedStop || hasSingleRelatedActivity);
  const visitedAt = selectedStop?.activity.visited_at ?? singleRelatedActivity?.visited_at ?? null;
  const isAdded = Boolean(selectedStop) || relatedActivities.length > 0;
  const detailMeta = [detail?.status_text, detail?.price_label].filter((item): item is string =>
    Boolean(item),
  );
  const heroPhoto = photos[0] ?? null;
  const detailPhotoUrl =
    resolveMediaUrl(heroPhoto?.thumbnail_url) ?? resolveMediaUrl(heroPhoto?.image_url);
  const visibleTags = compact ? tags.slice(0, 4) : tags;
  const hiddenTagCount = Math.max(tags.length - visibleTags.length, 0);
  const detailLinks = [
    ...(detail?.booking_links ?? []),
    ...(detail?.mentions ?? []).map((mention) => ({
      label: mention.label,
      url: mention.url,
    })),
  ].filter((link, index, values) => {
    if (!link.url) {
      return false;
    }
    const key = `${link.label.toLowerCase()}::${link.url}`;
    return (
      values.findIndex(
        (candidate) =>
          candidate.url && `${candidate.label.toLowerCase()}::${candidate.url}` === key,
      ) === index
    );
  });
  const visibleHours = compact ? (detail?.hours.slice(0, 4) ?? []) : (detail?.hours ?? []);
  const hiddenHoursCount = Math.max((detail?.hours.length ?? 0) - visibleHours.length, 0);
  const hasAboutContent = Boolean(
    summary ||
    detailPhotoUrl ||
    visibleTags.length ||
    detail?.rating != null ||
    detailMeta.length ||
    detailLinks.length ||
    visibleHours.length,
  );

  const hasActivityTab = Boolean(selectedStop);

  const activity = selectedStop?.activity ?? null;
  const activityDetails = (activity?.category_details as Record<string, unknown> | null) ?? null;
  const activitySchedule = (() => {
    if (!activity) return null;
    const formatTime = (t: string) => (t.length > 5 ? t.substring(0, 5) : t);
    const formatDur = (m: number) => {
      if (m >= 60) {
        const h = m / 60;
        return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
      }
      return `${m}m`;
    };
    if (activity.start_time) {
      return `${formatTime(activity.start_time)}${activity.duration_min ? ` · ${formatDur(activity.duration_min)}` : ''}`;
    }
    if (activity.duration_min) return formatDur(activity.duration_min);
    return activity.trip_day_id == null ? null : 'Flexible';
  })();
  const activityCategoryDescription = activity ? plannerCategoryDescription(activity) : null;
  const activityBudgetLabel =
    activity?.estimated_cost_amount != null
      ? (formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency) ?? null)
      : null;
  const activityTravelRoute = activity ? plannerTravelRoute(activity) : [];

  const ACTIVITY_CATEGORY_ICON: Record<string, typeof Landmark> = {
    visit: Landmark,
    eat: Utensils,
    activity: Ticket,
    hotel: BedDouble,
    travel: Plane,
  };
  const ActivityCategoryIcon = activity
    ? (ACTIVITY_CATEGORY_ICON[activity.category] ?? Landmark)
    : Landmark;

  const visibleTabs: Array<[string, string]> = hasActivityTab
    ? activity?.category === 'travel'
      ? activity
        ? [['activity', 'Activity']]
        : []
      : activity?.category === 'hotel'
        ? [
            hasAboutContent ? (['about', 'About'] as [string, string]) : null,
            renderablePhotos.length ? (['photos', 'Photos'] as [string, string]) : null,
            activity ? (['activity', 'Activity'] as [string, string]) : null,
          ].filter((tab): tab is [string, string] => Boolean(tab))
        : [
            hasAboutContent ? (['about', 'About'] as [string, string]) : null,
            reviews.length ? (['reviews', 'Reviews'] as [string, string]) : null,
            renderablePhotos.length ? (['photos', 'Photos'] as [string, string]) : null,
            activity ? (['activity', 'Activity'] as [string, string]) : null,
          ].filter((tab): tab is [string, string] => Boolean(tab))
    : [
        hasAboutContent ? (['about', 'About'] as [string, string]) : null,
        reviews.length ? (['reviews', 'Reviews'] as [string, string]) : null,
        renderablePhotos.length ? (['photos', 'Photos'] as [string, string]) : null,
      ].filter((tab): tab is [string, string] => Boolean(tab));
  const validTabIds = visibleTabs.map(([id]) => id);
  const activeTab = validTabIds.includes(preferredTab) ? preferredTab : (validTabIds[0] ?? 'about');
  const detailTabsId = useId();

  const showActivityActions = Boolean(activity && (onEditActivity || onDeleteActivity));
  const hasActionButtons = canToggleVisited || showActivityActions || !isAdded;
  const actionButtonClass =
    'inline-flex h-7.5 w-7.5 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-50';
  const actionIconClass = 'h-3.5 w-3.5';

  const actionButtons = hasActionButtons ? (
    <>
      {canToggleVisited ? (
        <button
          type="button"
          onClick={onToggleVisited}
          disabled={isTogglingVisited}
          className={cn(
            actionButtonClass,
            visitedAt
              ? 'bg-[rgba(0,201,120,0.08)] text-[var(--color-success)] hover:bg-[rgba(0,201,120,0.08)] hover:text-[var(--color-success)]'
              : '',
          )}
          aria-label={visitedAt ? 'Mark as not visited' : 'Mark as visited'}
        >
          <Check className={actionIconClass} />
        </button>
      ) : null}
      {showActivityActions && onEditActivity && activity ? (
        <button
          type="button"
          onClick={() => onEditActivity(activity)}
          className={actionButtonClass}
          aria-label="Edit activity"
        >
          <Pencil className={actionIconClass} />
        </button>
      ) : null}
      {showActivityActions && onDeleteActivity && activity ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              className={cn(actionButtonClass, 'hover:text-destructive')}
              aria-label="Delete activity"
            >
              <Trash2 className={actionIconClass} />
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
                  onDeleteActivity(activity.id);
                  onClose?.();
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {!isAdded ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={isAdding}
              className={actionButtonClass}
              aria-label="Add to trip"
            >
              {isAdding ? (
                <VoyagerLoader className={actionIconClass} />
              ) : (
                <Plus className={actionIconClass} />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[200px] shrink-0 rounded-[14px] border border-[var(--color-border)] bg-white/94 p-2 backdrop-blur-xl"
          >
            <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
              Where should this go?
            </DropdownMenuLabel>
            {destinations.map((destination) => (
              <DropdownMenuItem
                key={destination.id}
                onClick={() => {
                  if (detail?.place.id) {
                    onAddToTrip(destination.id);
                  } else if (fallbackItem?.id) {
                    onAddToTrip(destination.id);
                  }
                }}
                className="flex cursor-pointer items-center rounded-lg px-2 py-2 text-sm text-[var(--color-text)] outline-none select-none hover:bg-[var(--color-border)] focus:bg-[var(--color-border)]"
              >
                <span>{destination.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  ) : null;
  const closeButton = onClose ? (
    <button
      type="button"
      onClick={onClose}
      className={cn(
        'absolute z-10 rounded-full border border-[var(--color-border)] bg-white/90 p-2 text-[var(--color-text-muted)] transition-colors hover:bg-white hover:text-[var(--color-text)]',
        compact ? 'top-3.5 right-3.5' : 'top-4 right-4',
      )}
      aria-label="Close place details"
    >
      <X className="h-4 w-4" />
    </button>
  ) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {closeButton}
      <div
        className={cn(
          'shrink-0 border-b border-[var(--color-border)] bg-white',
          compact ? 'px-4 py-4' : 'px-5 py-5',
          onClose && (compact ? 'pr-14' : 'pr-16'),
        )}
      >
        {compact ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedStop ? (
                <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[0.68rem]">
                  {selectedStop.isHotel
                    ? 'Stay'
                    : plannerCategoryLabel(selectedStop.activity.category)}
                </Badge>
              ) : null}
              {detail?.rating != null ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(250,180,56,0.14)] px-2 py-0.5 text-[0.68rem] font-medium text-[var(--color-text)]">
                  <Star className="h-3 w-3 text-[#F59E0B]" />
                  <AnimatedNumber
                    value={detail.rating}
                    formatOptions={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
                  />
                  {detail.review_count != null ? (
                    <span className="inline-flex items-baseline gap-0.5">
                      <span aria-hidden="true">·</span>
                      <AnimatedNumber value={detail.review_count} />
                    </span>
                  ) : null}
                </span>
              ) : null}
              {detailMeta.map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-[var(--color-secondary-surface)] px-2 py-0.5 text-[0.68rem] font-medium text-[var(--color-text-muted)]"
                >
                  {item}
                </span>
              ))}
            </div>
            <h2 className="mt-2 text-[1.05rem] font-semibold tracking-[-0.03em] text-[var(--color-text)]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 line-clamp-1 text-[0.82rem] leading-5 text-[var(--color-text-muted)]">
                {subtitle}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {selectedStop ? (
                <Badge variant="outline" className="rounded-full">
                  {selectedStop.isHotel
                    ? 'Stay'
                    : plannerCategoryLabel(selectedStop.activity.category)}
                </Badge>
              ) : null}
            </div>
            <h2 className="mt-3 text-[1.25rem] font-semibold tracking-[-0.03em] text-[var(--color-text)]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">{subtitle}</p>
            ) : null}
            {detail?.rating != null || detailMeta.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {detail?.rating != null ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(250,180,56,0.14)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--color-text)]">
                    <Star className="h-3.5 w-3.5 text-[#F59E0B]" />
                    <AnimatedNumber
                      value={detail.rating}
                      formatOptions={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
                    />
                    {detail.review_count != null ? (
                      <span className="inline-flex items-baseline gap-0.5">
                        <span aria-hidden="true">·</span>
                        <AnimatedNumber value={detail.review_count} />
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {detailMeta.map((item) => (
                  <span
                    key={item}
                    className="rounded-full bg-[var(--color-secondary-surface)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--color-text-muted)]"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {visibleTabs.length > 0 || actionButtons ? (
        <DetailSegmentedTabs
          tabs={visibleTabs}
          activeTab={activeTab}
          onTabChange={onTabChange}
          compact={compact}
          idPrefix={detailTabsId}
          controls={actionButtons}
        />
      ) : null}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto',
          compact ? 'px-3 pt-3 pb-3' : 'px-4 pt-4 pb-4',
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={isDetailLoading && !detail ? '__loading__' : (detail?.place.id ?? activeTab)}
            id={`${detailTabsId}-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`${detailTabsId}-tab-${activeTab}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {isDetailLoading && !detail ? (
              <div
                className={cn('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}
              >
                <Skeleton className={cn('rounded-[18px]', compact ? 'h-[5rem]' : 'h-[6rem]')} />
                <Skeleton className={cn('rounded-[18px]', compact ? 'h-[5rem]' : 'h-[6rem]')} />
                <Skeleton
                  className={cn(
                    'col-span-2 rounded-[18px] sm:col-span-3',
                    compact ? 'h-9' : 'h-10',
                  )}
                />
              </div>
            ) : activeTab === 'about' ? (
              <div
                className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3')}
              >
                {summary ? (
                  <div
                    className={cn(
                      'rounded-[22px] bg-white',
                      !compact && 'sm:col-span-2',
                      compact ? 'p-3.5' : 'p-4',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <MapPin
                        className={cn(
                          'shrink-0 text-[var(--color-text-muted)]',
                          compact ? 'mt-0.5 h-4 w-4' : 'mt-1 h-4 w-4',
                        )}
                      />
                      <p
                        className={cn(
                          'text-[var(--color-text)]',
                          compact ? 'text-[0.82rem] leading-6' : 'text-[0.84rem] leading-6',
                        )}
                      >
                        {summary}
                      </p>
                    </div>
                  </div>
                ) : null}

                {detailPhotoUrl ? (
                  <PhotoViewerProvider>
                    <PhotoViewer src={resolveMediaUrl(heroPhoto?.image_url) ?? detailPhotoUrl}>
                      <button
                        type="button"
                        className={cn(
                          'group relative block w-full overflow-hidden rounded-[22px] bg-[var(--color-secondary-surface)] text-left',
                          !summary && 'sm:col-span-3',
                          summary && !compact ? 'sm:row-span-2' : '',
                          compact ? 'max-h-[12rem] min-h-[5rem]' : 'max-h-[14rem] min-h-[6rem]',
                        )}
                        aria-label={`Preview ${title}`}
                      >
                        <img
                          src={detailPhotoUrl}
                          alt={title}
                          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                        />
                      </button>
                    </PhotoViewer>
                  </PhotoViewerProvider>
                ) : null}

                {visibleTags.length ? (
                  <div className={cn('rounded-[22px] bg-white', compact ? 'p-3.5' : 'p-4')}>
                    <p
                      className={cn(
                        'font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase',
                        compact ? 'mb-2 text-[0.64rem]' : 'mb-2.5 text-[0.68rem]',
                      )}
                    >
                      Categories
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {visibleTags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            'rounded-full bg-[var(--color-secondary-surface)] text-[var(--color-text-muted)]',
                            compact ? 'px-2.5 py-1 text-[0.7rem]' : 'px-2.5 py-1 text-[0.72rem]',
                          )}
                        >
                          {tag}
                        </span>
                      ))}
                      {hiddenTagCount ? (
                        <span
                          className={cn(
                            'rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)]',
                            compact ? 'px-2.5 py-1 text-[0.7rem]' : 'px-2.5 py-1 text-[0.72rem]',
                          )}
                        >
                          +{hiddenTagCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {detail?.rating != null || detailMeta.length > 0 || detailLinks.length > 0 ? (
                  <div className={cn('rounded-[22px] bg-white', compact ? 'p-3.5' : 'p-4')}>
                    <p
                      className={cn(
                        'font-semibold tracking-[0.14em] text-[var(--color-text-muted)] uppercase',
                        compact ? 'mb-2 text-[0.64rem]' : 'mb-2.5 text-[0.68rem]',
                      )}
                    >
                      Details
                    </p>
                    <div
                      className={cn(
                        'flex flex-col gap-1.5 text-[var(--color-text-muted)]',
                        compact ? 'text-[0.78rem]' : 'text-[0.82rem]',
                      )}
                    >
                      {detail?.rating != null ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--color-text)]">
                          <Star className="h-3.5 w-3.5 text-[#F59E0B]" />
                          <AnimatedNumber
                            value={detail.rating}
                            formatOptions={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
                          />
                          {detail.review_count != null ? (
                            <span className="inline-flex items-baseline gap-0.5">
                              <span aria-hidden="true">(</span>
                              <AnimatedNumber value={detail.review_count} />
                              <span aria-hidden="true">)</span>
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      {detailMeta.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                      {detailLinks.slice(0, 2).map((link) => (
                        <a
                          key={`${link.label}-${link.url}`}
                          href={link.url ?? '#'}
                          target={link.url ? '_blank' : undefined}
                          rel={link.url ? 'noreferrer' : undefined}
                          className="inline-flex items-center gap-1.5 transition-colors hover:text-[var(--color-text)]"
                        >
                          <span>{link.label}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {visibleHours.length ? (
                  <div
                    className={cn(
                      'rounded-[22px] bg-white',
                      !compact && 'sm:col-span-2',
                      compact ? 'px-3.5 pt-1 pb-1' : 'px-4 pt-2 pb-2',
                    )}
                  >
                    <Accordion type="single" collapsible defaultValue="hours">
                      <AccordionItem value="hours" className="border-b-0">
                        <AccordionTrigger
                          className={cn(
                            'font-semibold tracking-[0.16em] text-[var(--color-text-muted)] uppercase hover:no-underline [&>svg]:text-[var(--color-text-muted)]',
                            compact
                              ? 'py-2.5 text-[0.68rem] [&>svg]:h-3 [&>svg]:w-3'
                              : 'py-3 text-[0.72rem] [&>svg]:h-3.5 [&>svg]:w-3.5',
                          )}
                        >
                          Opening hours
                        </AccordionTrigger>
                        <AccordionContent
                          className={cn(
                            'text-[var(--color-text)]',
                            compact
                              ? 'space-y-1.5 pb-2.5 text-[0.78rem]'
                              : 'space-y-2 pb-4 text-sm',
                          )}
                        >
                          {visibleHours.map((day) => (
                            <div key={day.day} className="flex items-start justify-between gap-4">
                              <span className="font-medium">{day.day}</span>
                              <span className="text-right text-[var(--color-text-muted)]">
                                {day.times.length
                                  ? day.times
                                      .map((window) => window.open ?? window.close ?? 'Unavailable')
                                      .join(', ')
                                  : 'Unavailable'}
                              </span>
                            </div>
                          ))}
                          {hiddenHoursCount ? (
                            <p className="pt-1 text-[0.72rem] text-[var(--color-text-muted)]">
                              +{hiddenHoursCount} more day{hiddenHoursCount === 1 ? '' : 's'}
                            </p>
                          ) : null}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'reviews' ? (
              reviews.length ? (
                <div className={cn('space-y-2.5', !compact && 'space-y-3')}>
                  {reviews.slice(0, 6).map((review) => (
                    <div
                      key={review.review_id}
                      className={cn('rounded-[18px] bg-white', compact ? 'p-3.5' : 'p-4')}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p
                          className={cn(
                            'font-semibold text-[var(--color-text)]',
                            compact ? 'text-[0.88rem]' : 'text-sm',
                          )}
                        >
                          {review.title || review.reviewer_name || 'Review'}
                        </p>
                        {review.rating != null ? (
                          <span
                            className={cn(
                              'rounded-full bg-[var(--color-secondary-surface)] font-medium text-[var(--color-text-muted)]',
                              compact ? 'px-2 py-0.5 text-[0.68rem]' : 'px-2.5 py-1 text-[0.72rem]',
                            )}
                          >
                            {review.rating.toFixed(1)}
                          </span>
                        ) : null}
                      </div>
                      {review.text ? (
                        <p
                          className={cn(
                            'text-[var(--color-text-muted)]',
                            compact ? 'mt-2 text-[0.84rem] leading-5' : 'mt-3 text-sm leading-6',
                          )}
                        >
                          {review.text}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p
                  className={cn(
                    'rounded-[18px] border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)]',
                    compact ? 'px-3.5 py-4 text-[0.84rem]' : 'px-4 py-6 text-sm',
                  )}
                >
                  No cached reviews are available for this place yet.
                </p>
              )
            ) : null}

            {activeTab === 'photos' ? (
              renderablePhotos.length ? (
                <PhotoViewerProvider>
                  <div
                    className={cn('grid gap-3 sm:grid-cols-2', compact && 'gap-2.5 lg:grid-cols-3')}
                  >
                    {renderablePhotos.map(({ photo, index, thumbnailUrl, fullUrl }) => {
                      return (
                        <PhotoViewer key={`${photo.image_url}-${index}`} src={fullUrl}>
                          <button
                            type="button"
                            className="group block overflow-hidden rounded-[18px] bg-white text-left"
                            aria-label={`Preview ${photo.caption || title}`}
                          >
                            <div className="relative overflow-hidden">
                              <img
                                src={thumbnailUrl}
                                alt={photo.caption || title}
                                className={cn(
                                  'w-full object-cover transition-transform group-hover:scale-[1.03]',
                                  compact ? 'h-28' : 'h-40',
                                )}
                              />
                            </div>
                            {photo.caption ? (
                              <span
                                className={cn(
                                  'block text-[var(--color-text-muted)]',
                                  compact ? 'px-2.5 py-2 text-[0.68rem]' : 'px-3 py-2 text-xs',
                                )}
                              >
                                {photo.caption}
                              </span>
                            ) : null}
                          </button>
                        </PhotoViewer>
                      );
                    })}
                  </div>
                </PhotoViewerProvider>
              ) : null
            ) : null}

            {activeTab === 'activity' && activity ? (
              <div className="space-y-3">
                {activity.description ? (
                  <div
                    className={cn('rounded-[18px] bg-white', compact ? 'px-3.5 py-3' : 'px-4 py-4')}
                  >
                    <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                      Summary
                    </p>
                    <p
                      className={cn(
                        'mt-2 leading-6 text-[var(--color-text)]',
                        compact ? 'text-[0.84rem]' : 'text-sm',
                      )}
                    >
                      {activity.description}
                    </p>
                  </div>
                ) : null}

                {[
                  activitySchedule
                    ? { key: 'schedule', label: 'Schedule', value: activitySchedule, Icon: Clock3 }
                    : null,
                  activityCategoryDescription
                    ? {
                        key: 'location',
                        label: 'Location',
                        value: activityCategoryDescription,
                        Icon: MapPin,
                      }
                    : null,
                  activityBudgetLabel
                    ? { key: 'budget', label: 'Budget', value: activityBudgetLabel, Icon: Receipt }
                    : null,
                  {
                    key: 'placement',
                    label: 'Placement',
                    value: dayLabel ?? (activity.trip_day_id == null ? 'Inbox' : 'Assigned'),
                    Icon: ActivityCategoryIcon,
                  },
                ]
                  .filter(Boolean)
                  .map(
                    (item) =>
                      item && (
                        <div
                          key={item.key}
                          className={cn(
                            'rounded-[18px] bg-white',
                            compact ? 'px-3.5 py-3' : 'px-4 py-3',
                          )}
                        >
                          <div className="flex items-center gap-2 text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                            <item.Icon className="h-3.5 w-3.5" />
                            {item.label}
                          </div>
                          <p
                            className={cn(
                              'mt-2 leading-6 text-[var(--color-text)]',
                              compact ? 'text-[0.84rem]' : 'text-sm',
                            )}
                          >
                            {item.value}
                          </p>
                        </div>
                      ),
                  )}

                {activity.category === 'travel' && activityTravelRoute.length > 0 ? (
                  <div
                    className={cn('rounded-[18px] bg-white', compact ? 'px-3.5 py-3' : 'px-4 py-4')}
                  >
                    <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                      Route
                    </p>
                    <div className="mt-3 space-y-2">
                      {activityTravelRoute.map((point, idx) => (
                        <div
                          key={`${point.label}-${idx}`}
                          className="rounded-[12px] bg-[#F3F5F7] px-3 py-2.5"
                        >
                          <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                            {idx === 0 ? 'Origin' : 'Destination'}
                          </p>
                          <p
                            className={cn(
                              'mt-1 text-[var(--color-text)]',
                              compact ? 'text-[0.84rem]' : 'text-sm',
                            )}
                          >
                            {point.label}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {activity.category === 'hotel' ? (
                  <div
                    className={cn('rounded-[18px] bg-white', compact ? 'px-3.5 py-3' : 'px-4 py-4')}
                  >
                    <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                      Stay
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {typeof activityDetails?.checkin_date === 'string' ? (
                        <div className="rounded-[12px] bg-[#F3F5F7] px-3 py-2.5">
                          <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                            Check-in
                          </p>
                          <p
                            className={cn(
                              'mt-1 text-[var(--color-text)]',
                              compact ? 'text-[0.84rem]' : 'text-sm',
                            )}
                          >
                            {activityDetails.checkin_date}
                          </p>
                        </div>
                      ) : null}
                      {typeof activityDetails?.checkout_date === 'string' ? (
                        <div className="rounded-[12px] bg-[#F3F5F7] px-3 py-2.5">
                          <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                            Check-out
                          </p>
                          <p
                            className={cn(
                              'mt-1 text-[var(--color-text)]',
                              compact ? 'text-[0.84rem]' : 'text-sm',
                            )}
                          >
                            {activityDetails.checkout_date}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {activity.notes ? (
                  <div
                    className={cn('rounded-[18px] bg-white', compact ? 'px-3.5 py-3' : 'px-4 py-4')}
                  >
                    <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                      Notes
                    </p>
                    <p
                      className={cn(
                        'mt-2 leading-6 text-[var(--color-text)]',
                        compact ? 'text-[0.84rem]' : 'text-sm',
                      )}
                    >
                      {activity.notes}
                    </p>
                  </div>
                ) : null}

                <TripAssetManager
                  tripId={tripId}
                  activityId={activity.id}
                  title="Attachments"
                  description="Upload tickets, confirmations, reference photos, and notes for this activity."
                />
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
