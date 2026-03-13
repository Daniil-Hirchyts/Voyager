import {
  forwardRef,
  Fragment,
  type ComponentPropsWithoutRef,
  type ReactNode,
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { format, parseISO } from 'date-fns'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useQueryClient } from '@tanstack/react-query'
import type { MapMouseEvent } from '@vis.gl/react-google-maps'
import {
  BedDouble,
  CarFront,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  Download,
  ExternalLink,
  FileText,
  Landmark,
  Layers3,
  MapPin,
  Pencil,
  Plane,
  Plus,
  Receipt,
  Route,
  Search,
  Share2,
  ShipWheel,
  Sparkles,
  Star,
  Ticket,
  TrainFront,
  Trash2,
  Utensils,
  X,
  Footprints,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { AnimatedMoney, AnimatedNumber } from '@/components/ui/animated-number'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AnimatedBackground } from '@/components/ui/animated-background'
import { ProgressiveBlur } from '@/components/ui/progressive-blur'
import { Skeleton } from '@/components/ui/skeleton'
import { Carousel } from '@/components/ui/carousel'
import { Checkbox } from '@/components/ui/checkbox'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { config } from '@/app/config'
import { PhotoViewer, PhotoViewerProvider } from '@/components/ui/photo-viewer'
import { createPlannerActivity, patchActivity, reorderActivities } from '@/entities/activity/api'
import { getGooglePlace } from '@/entities/place/api'
import {
  placeKeys,
  useCreatePlace,
  useGooglePlaceDetail,
  useGooglePlaceSearch,
  usePlace,
  usePlaceSearch,
} from '@/entities/place/queries'
import { plannerKeys } from '@/entities/planner/queries'
import { usePlannerMapPlaceDetail } from '@/entities/planner-map/queries'
import { estimateRouteLegs } from '@/entities/routes/api'
import { useRouteLegEstimates } from '@/entities/routes/queries'
import { useTripAssets } from '@/entities/trip-asset/queries'
import { useTripMapLayers } from '@/entities/trip-map-layer/queries'
import { useTripSharing } from '@/entities/trip-sharing/queries'
import { usePatchTrip } from '@/entities/trip/queries'
import { useTripCoverPhotoManager } from '@/entities/trip/useTripCoverPhotoManager'
import { useProfile } from '@/entities/user/queries'
import type {
  GooglePlaceCandidate,
  PlannerActivity,
  PlannerDay,
  PlannerMapPlaceDetail,
  PlannerResponse,
  RouteTravelMode,
  Trip,
  TripCollaborator,
} from '@/shared/api/types'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { cn } from '@/shared/lib/cn'
import { CURRENCY_OPTIONS } from '@/shared/lib/currencies'
import { formatMoney } from '@/shared/lib/format'
import { resolveMediaUrl } from '@/shared/lib/media'
import { usePlannerStore } from '@/shared/stores/planner.store'
import { useSideRailStore } from '@/shared/stores/side-rail.store'
import {
  ControlPosition,
  GoogleDirectionsRoute,
  GoogleMapCanvas,
  GooglePolyline,
  MapFitBounds,
  MapPanTo,
  TripMapLayerRenderer,
  VoyagerMapControl,
  VoyagerMarker,
} from '@/shared/layouts/google-maps'
import { ActivityCard } from './ActivityCard'
import { ExportMenu } from './ExportMenu'
import { TravelConnector } from './TravelConnector'
import TripAssetManager from '@/widgets/trip-assets'
import {
  CompactCarouselActions,
  CompactRefreshButton,
  PlannerRecommendationsCompactSection,
  PlannerRecommendationDetailPanel,
  PlannerRecommendationsPanel,
} from './PlannerRecommendations'
import {
  plannerCategoryDescription,
  plannerCategoryLabel,
  plannerPrimaryPlace,
  plannerTravelRoute,
  plannerTravelMode,
  plannerTravelModeLabel,
  type PlannerTravelDisplayMode,
} from './categories'
import {
  filterPlannerActivitiesByBucket,
  filterPlannerDaysByBucket,
  mergeBucketActivityOrder,
  type PlannerActivityBucket,
} from './activity-buckets'
import {
  buildPlannerMapDayMetrics,
  buildPlannerMapMetricsForActivities,
  buildPlannerMapLegPayload,
  buildPlannerMapSections,
  filterVisibleStops,
  optimizePlannerDayStops,
  PLANNER_MAP_DAY_COLORS,
  type PlannerMapLayerGroup,
  type PlannerMapSection,
  type PlannerMapStop,
} from './planner-map-utils'
import type {
  PlannerRecommendationEntry,
  PlannerRecommendationsController,
} from './usePlannerRecommendations'
import { routeTravelModeDescriptor } from './travel-modes'
import { VoyagerLoader } from '../app-shell/logo'

interface Props {
  trip: Trip
  tripId: string
  tripVersion: number
  travelMode?: RouteTravelMode
  days: PlannerDay[]
  inboxActivities: PlannerActivity[]
  isDragActive?: boolean
  selectedActivityId: string | null
  selectedPlaceId: string | null
  recommendations: PlannerRecommendationsController
  selectedRecommendation: PlannerRecommendationEntry | null
  onAddActivity: (
    dayId: string | null,
    defaultCategory?: PlannerActivity['category'],
  ) => void
  onSelectActivityId: (activityId: string | null) => void
  onSelectPlaceId: (placeId: string | null) => void
  onSelectRecommendation: (entry: PlannerRecommendationEntry | null) => void
  onClearMapSelection: () => void
  onEditActivity?: (activity: PlannerActivity) => void
  onDeleteActivity?: (activityId: string) => void
  onRegisterSectionOpener?: (opener: (sectionKey: string) => void) => void
  onOpenCollaboration?: () => void
}

type SearchResultItem = {
  kind: 'saved' | 'google'
  id: string
  placeId: string | null
  name: string
  addressText: string | null
  category: string | null
  lat: number | null
  lon: number | null
  metadata: Record<string, unknown>
}

type ResolvedPlaceDetail = {
  place: {
    id: string
    name: string
    address_text: string | null
  }
  summary: string | null
  rating: number | null
  review_count: number | null
  status_text: string | null
  price_label: string | null
  photos: PlannerMapPlaceDetail['photos']
  reviews: PlannerMapPlaceDetail['reviews']
  hours: PlannerMapPlaceDetail['hours']
  booking_links: PlannerMapPlaceDetail['booking_links']
  tags: string[]
  mentions: PlannerMapPlaceDetail['mentions']
  related_activities: PlannerMapPlaceDetail['related_activities']
}

function asFiniteNumber(value: string | number | null | undefined) {
  if (value == null || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

type QuickCategory = {
  id: string
  label: string
  query: string
  category?: string
}

type PreviewPlan = {
  order: string[]
  metrics: ReturnType<typeof buildPlannerMapMetricsForActivities>
}

const FLOATING_ICON_BUTTON_CLASS =
  'pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/92 text-[var(--color-text)] shadow-[0_20px_44px_-20px_rgba(32,56,83,0.38)] backdrop-blur transition-colors hover:bg-white'

const QUICK_CATEGORIES: QuickCategory[] = [
  { id: 'food', label: 'Food', query: 'restaurants', category: 'restaurant' },
  { id: 'sights', label: 'Attractions', query: 'tourist attractions', category: 'tourist_attraction' },
  { id: 'gas', label: 'Gas', query: 'gas station', category: 'gas_station' },
  { id: 'ev', label: 'EV', query: 'electric vehicle charging station', category: 'electric_vehicle_charging_station' },
  { id: 'rest', label: 'Rest', query: 'rest stop', category: 'rest_stop' },
]

function areDayAccordionStatesEqual(
  left: Record<string, boolean>,
  right: Record<string, boolean>,
  sectionDayIds: string[],
) {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    sectionDayIds.every((dayId) => left[dayId] === right[dayId])
  )
}

function DetailSegmentedTabs({
  tabs,
  activeTab,
  onTabChange,
  compact,
  idPrefix,
  controls,
}: {
  tabs: Array<[string, string]>
  activeTab: string
  onTabChange: (tab: string) => void
  compact: boolean
  idPrefix: string
  controls?: ReactNode
}) {
  return (
    <div className={cn(
      'shrink-0 border-b border-black/8 bg-white/94 backdrop-blur',
      compact ? 'px-2.5 py-1.5' : 'px-3 py-1.5',
    )}>
      <div className={cn('flex items-center gap-2', !tabs.length && 'justify-end')}>
        {tabs.length ? (
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div
              className="inline-flex min-w-max items-center gap-0 rounded-[11px] border border-black/10 bg-black/[0.04] p-[2px] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
              role="tablist"
              aria-label="Place detail sections"
            >
              <AnimatedBackground
                defaultValue={activeTab}
                onValueChange={(value) => {
                  if (value) {
                    onTabChange(value)
                  }
                }}
                className="rounded-[9px] bg-[#1a1a1a] shadow-[0_10px_18px_-14px_rgba(0,0,0,0.5)]"
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
                        event.preventDefault()
                        onTabChange(tabs[(index + 1) % tabs.length]?.[0] ?? value)
                      } else if (event.key === 'ArrowLeft') {
                        event.preventDefault()
                        onTabChange(tabs[(index - 1 + tabs.length) % tabs.length]?.[0] ?? value)
                      } else if (event.key === 'Home') {
                        event.preventDefault()
                        onTabChange(tabs[0]?.[0] ?? value)
                      } else if (event.key === 'End') {
                        event.preventDefault()
                        onTabChange(tabs[tabs.length - 1]?.[0] ?? value)
                      }
                    }}
                    className={cn(
                      'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[9px] font-semibold tracking-[-0.02em] text-[#5f6b7e] transition-[transform,color] duration-200 hover:text-[#1a1a1a] active:scale-[0.98] data-[checked=true]:text-white',
                      compact ? 'h-7 px-2.5 text-[0.72rem]' : 'h-8 px-3 text-[0.78rem]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </AnimatedBackground>
            </div>
          </div>
        ) : null}
        {controls ? <div className="flex shrink-0 items-center gap-1">{controls}</div> : null}
      </div>
    </div>
  )
}

export function reconcileDayAccordionState(
  currentDayAccordionState: Record<string, boolean> | undefined,
  sectionDayIds: string[],
) {
  return Object.fromEntries(
    sectionDayIds.map((dayId) => [dayId, currentDayAccordionState?.[dayId] ?? dayId !== 'inbox']),
  ) as Record<string, boolean>
}

function accordionStateToExpandedDayIds(
  dayAccordionState: Record<string, boolean>,
  sectionDayIds: string[],
) {
  return sectionDayIds.filter((dayId) => dayAccordionState[dayId])
}

function expandedDayIdsToAccordionState(
  expandedDayIds: string[],
  sectionDayIds: string[],
) {
  const expandedDayIdSet = new Set(expandedDayIds)
  return Object.fromEntries(
    sectionDayIds.map((dayId) => [dayId, expandedDayIdSet.has(dayId)]),
  ) as Record<string, boolean>
}

type BudgetGroup = {
  currency: string | null
  total: number
  activityCount: number
}

type PlannerStandaloneActivityGroup = {
  id: string
  dayId: string | null
  title: string
  subtitle: string
  activities: PlannerActivity[]
}

function getPlannerVisualContainerId(
  bucket: PlannerActivityBucket,
  dayId: string | null,
) {
  return `${bucket}::${dayId ?? 'inbox'}`
}

function buildStandaloneActivityGroups(
  days: PlannerDay[],
  inboxActivities: PlannerActivity[],
  bucket: PlannerActivityBucket,
) {
  const groups: PlannerStandaloneActivityGroup[] = []
  const unassignedActivities = [...filterPlannerActivitiesByBucket(inboxActivities, bucket)].sort(
    (left, right) => left.order_index - right.order_index,
  )

  if (unassignedActivities.length > 0) {
    groups.push({
      id: `${bucket}::inbox`,
      dayId: null,
      title: 'Unassigned',
      subtitle: 'Keep flexible until you assign a day',
      activities: unassignedActivities,
    })
  }

  for (const day of days) {
    const dayActivities = [...filterPlannerActivitiesByBucket(day.activities, bucket)].sort(
      (left, right) => left.order_index - right.order_index,
    )

    if (!dayActivities.length) {
      continue
    }

    groups.push({
      id: `${bucket}::${day.id}`,
      dayId: day.id,
      title: `Day ${day.day_index + 1}`,
      subtitle: format(parseISO(day.date), 'MMM d, yyyy'),
      activities: dayActivities,
    })
  }

  return groups
}

function standaloneSectionTitle(bucket: 'travel' | 'accommodation') {
  return bucket === 'accommodation' ? 'Accommodation' : 'Travel'
}

function standaloneSectionSummary(
  bucket: 'travel' | 'accommodation',
  groups: PlannerStandaloneActivityGroup[],
) {
  const activityCount = groups.reduce((total, group) => total + group.activities.length, 0)
  if (activityCount === 0) {
    return bucket === 'accommodation' ? 'No stays yet' : 'No travel yet'
  }

  const activityLabel =
    bucket === 'accommodation'
      ? activityCount === 1
        ? 'stay'
        : 'stays'
      : activityCount === 1
        ? 'segment'
        : 'segments'

  return `${activityCount} ${activityLabel} · ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`
}

function standaloneSectionEmptyCopy(bucket: 'travel' | 'accommodation') {
  return bucket === 'accommodation'
    ? 'Add hotels and stays here, then assign them to the right day when needed.'
    : 'Add flights, trains, and transfers here, then assign them to the right day when needed.'
}

function formatTripDateRangeLabel(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) {
    return 'Dates flexible'
  }

  if (startDate && endDate) {
    const start = parseISO(startDate)
    const end = parseISO(endDate)

    if (format(start, 'yyyy') === format(end, 'yyyy')) {
      if (format(start, 'MMM') === format(end, 'MMM')) {
        return `${format(start, 'MMM d')} - ${format(end, 'd, yyyy')}`
      }

      return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`
    }

    return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`
  }

  return format(parseISO(startDate ?? endDate!), 'MMM d, yyyy')
}

function formatTripTypeLabel(tripType: string | null | undefined) {
  if (!tripType) {
    return null
  }

  return tripType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function buildBudgetGroups(
  activities: PlannerActivity[],
  fallbackCurrency: string | null | undefined,
) {
  const groups = new Map<string, BudgetGroup>()
  const spentGroups = new Map<string, BudgetGroup>()
  let pricedActivityCount = 0

  for (const activity of activities) {
    if (activity.estimated_cost_amount == null || activity.estimated_cost_amount === '') {
      continue
    }

    const numericAmount = Number(activity.estimated_cost_amount)
    if (Number.isNaN(numericAmount)) {
      continue
    }

    pricedActivityCount += 1
    const currency = activity.estimated_cost_currency ?? fallbackCurrency ?? null
    const key = currency ?? '__none__'
    const current = groups.get(key) ?? {
      currency,
      total: 0,
      activityCount: 0,
    }

    current.total += numericAmount
    current.activityCount += 1
    groups.set(key, current)

    if (activity.visited_at != null) {
      const currentSpent = spentGroups.get(key) ?? {
        currency,
        total: 0,
        activityCount: 0,
      }
      currentSpent.total += numericAmount
      currentSpent.activityCount += 1
      spentGroups.set(key, currentSpent)
    }
  }

  return {
    groups: Array.from(groups.values()),
    spentGroups: Array.from(spentGroups.values()),
    pricedActivityCount,
    unpricedActivityCount: Math.max(activities.length - pricedActivityCount, 0),
  }
}

function buildBudgetOverview(trip: Trip, activities: PlannerActivity[]) {
  const { groups, spentGroups, pricedActivityCount, unpricedActivityCount } = buildBudgetGroups(
    activities,
    trip.budget_currency,
  )
  const budgetAmount =
    trip.budget_amount == null || trip.budget_amount === ''
      ? null
      : Number(trip.budget_amount)
  const hasBudgetAmount = budgetAmount != null && !Number.isNaN(budgetAmount)

  const comparableGroup = trip.budget_currency
    ? groups.find((group) => group.currency === trip.budget_currency) ??
      (groups.length === 1 ? groups[0] : null)
    : groups.length === 1
      ? groups[0]
      : null

  const comparableSpentGroup = trip.budget_currency
    ? spentGroups.find((group) => group.currency === trip.budget_currency) ??
      (spentGroups.length === 1 ? spentGroups[0] : null)
    : spentGroups.length === 1
      ? spentGroups[0]
      : null

  const comparableCurrency = comparableGroup?.currency ?? trip.budget_currency ?? null
  const comparableSpend = comparableGroup?.total ?? 0
  const comparableSpent = comparableSpentGroup?.total ?? 0

  const currentBudgetAmount = hasBudgetAmount ? budgetAmount - comparableSpent : null
  const remainingAmount = hasBudgetAmount ? budgetAmount - comparableSpend : null

  return {
    groups,
    spentGroups,
    pricedActivityCount,
    unpricedActivityCount,
    comparableSpend,
    comparableSpent,
    comparableCurrency,
    currentBudgetAmount,
    remainingAmount,
  }
}

function toSavedSearchItem(place: {
  id: string
  name: string
  address_text: string | null
  category: string | null
  lat: number | null
  lon: number | null
  metadata: Record<string, unknown>
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
  }
}

function toGoogleSearchItem(place: GooglePlaceCandidate): SearchResultItem {
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
  }
}

function inferActivityCategory(item: SearchResultItem): PlannerActivity['category'] {
  const category = (item.category ?? '').toLowerCase()
  const haystack = `${item.name} ${item.addressText ?? ''} ${category}`.toLowerCase()

  if (category.includes('restaurant') || category.includes('food') || haystack.includes('cafe')) {
    return 'eat'
  }
  if (category.includes('hotel') || category.includes('lodging')) {
    return 'hotel'
  }
  if (category.includes('tour') || category.includes('museum') || category.includes('event')) {
    return 'activity'
  }
  return 'visit'
}

function resolveGooglePlaceId(place: {
  source: string
  external_id: string | null
  metadata: Record<string, unknown>
} | null | undefined) {
  if (!place) {
    return null
  }
  if (
    (place.source === 'google_places' || place.source === 'destination') &&
    typeof place.external_id === 'string' &&
    place.external_id.trim()
  ) {
    return place.external_id.trim()
  }
  const metadataPlaceId = place.metadata?.google_place_id
  return typeof metadataPlaceId === 'string' && metadataPlaceId.trim()
    ? metadataPlaceId.trim()
    : null
}

function dedupeText(values: Array<string | null | undefined>) {
  const nextValues: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const text = value?.trim()
    if (!text) {
      continue
    }
    const key = text.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    nextValues.push(text)
  }
  return nextValues
}

function mergePlaceDetail(
  plannerDetail: PlannerMapPlaceDetail | null | undefined,
  googleDetail:
    | {
        place: GooglePlaceCandidate
        summary: string | null
        rating: number | null
        review_count: number | null
        status_text: string | null
        price_label: string | null
        photos: PlannerMapPlaceDetail['photos']
        reviews: PlannerMapPlaceDetail['reviews']
        hours: PlannerMapPlaceDetail['hours']
        booking_links: PlannerMapPlaceDetail['booking_links']
        tags: string[]
        mentions: Array<{ label: string; url: string | null }>
      }
    | null
    | undefined,
): ResolvedPlaceDetail | null {
  if (!plannerDetail && !googleDetail) {
    return null
  }

  const placeId =
    plannerDetail?.place.id ?? googleDetail?.place.place_id ?? '__google-place-detail__'
  const placeName =
    googleDetail?.place.name ?? plannerDetail?.place.name ?? 'Selected place'
  const addressText =
    googleDetail?.place.address_text ?? plannerDetail?.place.address_text ?? null

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
    photos:
      googleDetail?.photos.length
        ? googleDetail.photos
        : plannerDetail?.photos ?? [],
    reviews:
      googleDetail?.reviews.length
        ? googleDetail.reviews
        : plannerDetail?.reviews ?? [],
    hours:
      googleDetail?.hours.length
        ? googleDetail.hours
        : plannerDetail?.hours ?? [],
    booking_links:
      googleDetail?.booking_links.length
        ? googleDetail.booking_links
        : plannerDetail?.booking_links ?? [],
    tags: dedupeText([...(googleDetail?.tags ?? []), ...(plannerDetail?.tags ?? [])]),
    mentions: [
      ...(googleDetail?.mentions ?? []),
      ...(plannerDetail?.mentions ?? []),
    ].filter((mention, index, values) => {
      const key = `${mention.label.toLowerCase()}::${mention.url ?? ''}`
      return values.findIndex((candidate) => {
        return `${candidate.label.toLowerCase()}::${candidate.url ?? ''}` === key
      }) === index
    }),
    related_activities: plannerDetail?.related_activities ?? [],
  }
}

function orderedSectionActivities(
  section: PlannerMapSection,
  previewOrder: string[] | null | undefined,
) {
  if (!previewOrder?.length) {
    return section.activities
  }

  const orderLookup = new Map(previewOrder.map((id, index) => [id, index]))
  return [...section.activities].sort((left, right) => {
    const leftIndex = orderLookup.get(left.id)
    const rightIndex = orderLookup.get(right.id)
    if (leftIndex == null && rightIndex == null) return left.order_index - right.order_index
    if (leftIndex == null) return 1
    if (rightIndex == null) return -1
    return leftIndex - rightIndex
  })
}

function buildApplyPreviewOrder(section: PlannerMapSection, markerOrder: string[]) {
  if (!markerOrder.length) {
    return section.activities.map((activity) => activity.id)
  }

  const nextMarkerIds = [...markerOrder]
  return section.activities.map((activity) => {
    const hasMarker =
      activity.category !== 'hotel' &&
      activity.place?.lat != null &&
      activity.place?.lon != null
    return hasMarker ? nextMarkerIds.shift() ?? activity.id : activity.id
  })
}

function activeSelectionTitle(
  selectedStop: PlannerMapStop | null,
  selectedSearchItem: SearchResultItem | null,
  detail: ResolvedPlaceDetail | null | undefined,
) {
  return selectedStop?.activity.title ?? selectedSearchItem?.name ?? detail?.place.name ?? 'Map details'
}

function activeSelectionSubtitle(
  selectedStop: PlannerMapStop | null,
  selectedSearchItem: SearchResultItem | null,
  detail: ResolvedPlaceDetail | null | undefined,
) {
  return (
    plannerCategoryDescription(selectedStop?.activity) ??
    selectedSearchItem?.addressText ??
    detail?.place.address_text ??
    selectedSearchItem?.category ??
    null
  )
}

function PlannerSidebarSectionTrigger({
  icon,
  title,
  summary,
  actions,
}: {
  icon: ReactNode
  title: string
  summary: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex w-full items-center justify-between gap-3 pr-4">
      <div className="flex min-w-0 items-center gap-2.5 text-left">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[14px] bg-[var(--color-secondary-surface)] text-[var(--color-text)]">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[0.85rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
            {title}
          </p>
          <p className="mt-0.5 truncate text-[0.74rem] text-[var(--color-text-muted)]">
            {summary}
          </p>
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  )
}

function PlannerTripHeroCard({
  trip,
  tripId,
  coverPhotoUrl,
  onOpenCollaboration,
}: {
  trip: Trip
  tripId: string
  coverPhotoUrl: string | null
  onOpenCollaboration?: () => void
}) {
  const tripTypeLabel = formatTripTypeLabel(trip.trip_type)
  const dateLabel = formatTripDateRangeLabel(trip.start_date, trip.end_date)
  const { data: profile } = useProfile()
  const sharing = useTripSharing(tripId)
  const collaborators = sharing.data?.collaborators ?? []

  const myName = profile?.display_name || 'Me'
  const myAvatar = profile?.avatar_thumbnail_url || profile?.avatar_url || null
  const myInitials = myName.split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('') || 'M'

  function getCollaboratorName(c: TripCollaborator) {
    return c.display_name || c.email || 'Traveler'
  }

  const visibleCollaborators = collaborators.filter(
    (c) => c.user_id !== trip.user_id && c.user_id !== profile?.keycloak_sub
  ).slice(0, 3)

  return (
    <section
      className="overflow-hidden rounded-[26px] border border-black/8 bg-white shadow-[0_22px_58px_-42px_rgba(15,23,42,0.24)]"
      data-testid="planner-trip-hero"
    >
      <div className="relative overflow-hidden rounded-[22px]">
        <div className="relative h-36 bg-[linear-gradient(135deg,#d6e3ee_0%,#9fb5c6_52%,#6d879e_100%)] sm:h-40">
          {coverPhotoUrl ? (
            <PhotoViewerProvider>
              <PhotoViewer src={coverPhotoUrl}>
                <button
                  type="button"
                  className="group relative block h-full w-full text-left"
                  aria-label={`Preview cover photo for ${trip.title}`}
                >
                  <img
                    src={coverPhotoUrl}
                    alt={trip.destination_text}
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                  <ProgressiveBlur
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%]"
                    blurIntensity={0.85}
                  />
                </button>
              </PhotoViewer>
            </PhotoViewerProvider>
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,20,32,0.08)_0%,rgba(10,20,32,0.14)_42%,rgba(255,255,255,0.68)_82%,#ffffff_100%)]" />
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            {tripTypeLabel ? (
              <span className="rounded-full border border-white/45 bg-white/16 px-2.5 py-1 text-[0.64rem] font-medium text-white/92 backdrop-blur">
                {tripTypeLabel}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="absolute right-3 top-3 flex items-center"
            onClick={onOpenCollaboration}
            aria-label="Open collaboration"
          >
            <div className="flex -space-x-2">
              {/* Plus circle (behind) */}
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white/80 bg-white/20 backdrop-blur shadow-sm">
                <span className="text-white text-[1rem] font-light leading-none">+</span>
              </div>
              {/* Collaborator avatars */}
              {visibleCollaborators.map((c) => {
                const name = getCollaboratorName(c)
                const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join('') || 'T'
                return (
                  <Avatar key={c.user_id} className="h-8 w-8 rounded-full border-2 border-white shadow-sm">
                    <AvatarImage src={(c as TripCollaborator & { avatar_url?: string }).avatar_url ?? undefined} alt={name} />
                    <AvatarFallback className="rounded-full bg-[#ECEEF0] text-[0.6rem] font-semibold text-[#526072]">{initials}</AvatarFallback>
                  </Avatar>
                )
              })}
              {/* My avatar (front) */}
              <Avatar className="h-8 w-8 rounded-full border-2 border-white shadow-sm">
                <AvatarImage src={myAvatar ?? undefined} alt={myName} />
                <AvatarFallback className="rounded-full bg-[#ECEEF0] text-[0.6rem] font-semibold text-[#526072]">{myInitials}</AvatarFallback>
              </Avatar>
            </div>
          </button>
          {!coverPhotoUrl ? (
            <div className="absolute inset-x-4 bottom-5">
              <p className="text-[0.66rem] font-semibold uppercase tracking-[0.22em] text-white/80">
                Destination
              </p>
              <p className="mt-1.5 text-[1rem] font-semibold tracking-[-0.03em] text-white">
                {trip.destination_text}
              </p>
            </div>
          ) : null}
        </div>

        <div className="-mt-6 relative mx-3 mb-3 rounded-[20px] border border-white/80 bg-white/94 px-4 py-3.5 shadow-[0_18px_46px_-34px_rgba(15,23,42,0.28)] backdrop-blur">
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
            Trip overview
          </p>
          <h1 className="mt-1.5 text-[1.55rem] font-semibold leading-none tracking-[-0.05em] text-[var(--color-text)]">
            {trip.title}
          </h1>

          <div className="mt-3 flex flex-col gap-1.5">
            <span className="inline-flex min-w-0 items-center gap-2 text-[0.8rem] text-[var(--color-text-muted)]">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{dateLabel}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-2 text-[0.8rem] text-[var(--color-text-muted)]">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{trip.destination_text}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function PlannerBudgetOverview({
  trip,
  activities,
}: {
  trip: Trip
  activities: PlannerActivity[]
}) {
  const patchTrip = usePatchTrip(trip.id)
  const budgetOverview = useMemo(() => buildBudgetOverview(trip, activities), [activities, trip])
  const [draftAmount, setDraftAmount] = useState(
    trip.budget_amount == null || trip.budget_amount === '' ? '' : String(Number(trip.budget_amount)),
  )
  const [draftCurrency, setDraftCurrency] = useState(trip.budget_currency ?? 'USD')
  const [isCurrencyMenuOpen, setIsCurrencyMenuOpen] = useState(false)

  const persistedBudgetAmount =
    trip.budget_amount == null || trip.budget_amount === '' ? null : Number(trip.budget_amount)
  const persistedBudgetCurrency = trip.budget_currency ?? 'USD'

  useEffect(() => {
    setDraftAmount(
      trip.budget_amount == null || trip.budget_amount === '' ? '' : String(Number(trip.budget_amount)),
    )
    setDraftCurrency(trip.budget_currency ?? 'USD')
  }, [trip.budget_amount, trip.budget_currency, trip.version])

  async function handleSaveBudget(nextAmount = draftAmount, nextCurrency = draftCurrency) {
    const nextParsedAmount = nextAmount.trim() ? Number(nextAmount) : null
    const nextHasValidBudget =
      nextParsedAmount == null || (!Number.isNaN(nextParsedAmount) && nextParsedAmount >= 0)
    const nextIsDirty =
      (nextParsedAmount ?? null) !== persistedBudgetAmount || nextCurrency !== persistedBudgetCurrency

    if (!nextIsDirty || patchTrip.isPending) {
      return
    }

    if (!nextHasValidBudget) {
      toast.error('Enter a valid budget amount')
      return
    }

    try {
      await patchTrip.mutateAsync({
        version: trip.version,
        data: {
          budget_amount: nextParsedAmount,
          budget_currency: nextCurrency,
        },
      })
    } catch {
      toast.error('Could not update the budget')
    }
  }

  const initialBudgetAmount = asFiniteNumber(trip.budget_amount)
  const spentAmount = asFiniteNumber(budgetOverview.comparableSpent)
  const currentBudgetAmount = asFiniteNumber(budgetOverview.currentBudgetAmount)

  return (
    <div className="flex flex-col gap-3" data-testid="planner-budget-summary">
      <div className="rounded-[22px] border border-black/8 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                Initial Budget
              </span>
              <span className="text-[1.4rem] font-bold tracking-tight text-[var(--color-text)]">
                {initialBudgetAmount != null ? (
                  <AnimatedMoney value={initialBudgetAmount} currency={trip.budget_currency} />
                ) : (
                  '—'
                )}
              </span>
            </div>

            <div className="flex items-center">
              <div
                className="relative flex h-11 items-center overflow-hidden rounded-[14px] border border-black/8 bg-[var(--color-secondary-surface)] focus-within:ring-2 focus-within:ring-black/5"
                aria-busy={patchTrip.isPending}
                onBlur={(event) => {
                  const nextFocused = event.relatedTarget

                  if (isCurrencyMenuOpen) {
                    return
                  }

                  if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
                    return
                  }

                  void handleSaveBudget()
                }}
              >
                <Select
                  value={draftCurrency}
                  disabled={patchTrip.isPending}
                  onOpenChange={setIsCurrencyMenuOpen}
                  onValueChange={(nextCurrency) => {
                    setDraftCurrency(nextCurrency)
                    void handleSaveBudget(draftAmount, nextCurrency)
                  }}
                >
                  <SelectTrigger className="h-full border-none bg-transparent px-3 text-[0.8rem] font-bold focus:ring-0 focus:ring-offset-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-56 overflow-y-auto">
                    {CURRENCY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-sm">
                        {option.label}{option.description ? ` ${option.description}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="h-5 w-px bg-black/8" />
                <Input
                  aria-label="Trip budget amount"
                  type="number"
                  min="0"
                  max="1000000000"
                  step="any"
                  inputMode="decimal"
                  disabled={patchTrip.isPending}
                  placeholder="0"
                  value={draftAmount}
                  onChange={(event) => setDraftAmount(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') {
                      return
                    }

                    event.preventDefault()
                    void handleSaveBudget()
                  }}
                  className="h-full w-24 border-none bg-transparent px-3 text-right text-[0.95rem] font-semibold focus-visible:ring-0"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-black/5 pt-5">
            <div className="flex flex-col gap-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
                Spent
              </span>
              <span className="text-[1.1rem] font-bold text-[var(--color-text)]">
                {spentAmount != null ? (
                  <AnimatedMoney value={spentAmount} currency={trip.budget_currency} />
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
                Current Budget
              </span>
              <span className={cn(
                "text-[1.1rem] font-bold",
                budgetOverview.currentBudgetAmount !== null && budgetOverview.currentBudgetAmount < 0 ? "text-red-500" : "text-emerald-600"
              )}>
                {currentBudgetAmount != null ? (
                  <AnimatedMoney value={currentBudgetAmount} currency={trip.budget_currency} />
                ) : (
                  '—'
                )}
              </span>
            </div>
          </div>

          {budgetOverview.pricedActivityCount > 0 && (
            <p className="text-[0.7rem] leading-relaxed text-[var(--color-text-muted)] opacity-80">
              Tracking costs for <AnimatedNumber value={budgetOverview.pricedActivityCount} /> activities.
              {budgetOverview.unpricedActivityCount > 0 ? (
                <>
                  {' '}
                  <AnimatedNumber value={budgetOverview.unpricedActivityCount} /> more are still pending.
                </>
              ) : null}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function dayProgressLabel(section: PlannerMapSection, selectedStop: PlannerMapStop | null) {
  if (!selectedStop || selectedStop.dayId !== section.dayId || selectedStop.markerNumber == null) {
    return null
  }
  const total = section.stops.filter((stop) => stop.markerNumber != null).length
  if (!total) {
    return null
  }
  return `${selectedStop.markerNumber} of ${total}`
}

function SearchResultList({
  items,
  onSelect,
}: {
  items: SearchResultItem[]
  onSelect: (item: SearchResultItem) => void
}) {
  if (!items.length) {
    return (
      <p className="rounded-[16px] border border-dashed border-black/8 px-4 py-6 text-sm text-[var(--color-text-muted)]">
        No places matched this search near the current map area.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button
          key={`${item.kind}:${item.id}`}
          type="button"
          onClick={() => onSelect(item)}
          className="w-full rounded-[16px] border border-black/8 bg-white px-4 py-3 text-left transition-colors hover:bg-[var(--color-secondary-surface)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--color-text)]">{item.name}</p>
              <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
                {item.addressText || item.category || 'Place'}
              </p>
            </div>
            <Badge variant={item.kind === 'saved' ? 'success' : 'outline'}>
              {item.kind === 'saved' ? 'Voyager' : 'Google'}
            </Badge>
          </div>
        </button>
      ))}
    </div>
  )
}

function FloatingIconButton({
  icon,
  label,
  onClick,
  isMobile,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  isMobile: boolean
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={FLOATING_ICON_BUTTON_CLASS}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  )

  if (isMobile) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const FloatingPopoverIconTrigger = forwardRef<
  HTMLButtonElement,
  {
    icon: ReactNode
    label: string
    dataTestId?: string
  } & ComponentPropsWithoutRef<'button'>
>(function FloatingPopoverIconTrigger({ icon, label, dataTestId, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(FLOATING_ICON_BUTTON_CLASS, className)}
      {...props}
      aria-label={label}
      aria-haspopup="dialog"
      data-testid={dataTestId}
      title={label}
    >
      {icon}
    </button>
  )
})

function applyOptimisticVisited(
  data: PlannerResponse,
  activityId: string,
  visitedAt: string | null,
): PlannerResponse {
  const patch = (a: PlannerActivity) =>
    a.id === activityId ? { ...a, visited_at: visitedAt } : a
  return {
    ...data,
    inbox_activities: data.inbox_activities.map(patch),
    days: data.days.map((day) => ({ ...day, activities: day.activities.map(patch) })),
  }
}

function PlannerMapPin({
  label,
  color,
  selected = false,
  visited = false,
}: {
  label: ReactNode
  color: string
  selected?: boolean
  visited?: boolean
}) {
  return (
    <div className={cn("pointer-events-none relative transition-transform origin-bottom pb-1", selected && "scale-110")}>
      <div
        className="flex h-9 w-9 items-center justify-center rounded-[50%_50%_50%_10%] -rotate-45 border-[1.5px] border-white shadow-[0_6px_12px_rgba(0,0,0,0.15)]"
        style={{ backgroundColor: selected ? '#111827' : `${color}` }}
      >
        <div className="rotate-45 flex items-center justify-center">
          <span className="text-[14px] font-bold text-white tracking-tight leading-none drop-shadow-md">
            {label}
          </span>
        </div>
      </div>
      {visited ? (
        <div className="absolute -right-0 -top-0 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 shadow-sm border-[1.5px] border-white/90">
          <Check className="h-2.5 w-2.5 text-white" />
        </div>
      ) : null}
    </div>
  )
}

type PlannerTravelOverlay = {
  activity: PlannerActivity
  dayId: string
  mode: PlannerTravelDisplayMode
  points: ReturnType<typeof plannerTravelRoute>
  routePath: PlannerTravelRoutePoint[]
  badgePoint: PlannerTravelRoutePoint | null
}

type PlannerTravelRoutePoint = {
  lat: number
  lng: number
}

function travelOverlayColor(mode: PlannerTravelDisplayMode) {
  switch (mode) {
    case 'train':
      return '#0F766E'
    case 'car':
      return '#7C3AED'
    case 'ferry':
      return '#0891B2'
    case 'walk':
      return '#475569'
    case 'flight':
    default:
      return '#2563EB'
  }
}

function travelOverlayIcon(mode: PlannerTravelDisplayMode) {
  switch (mode) {
    case 'train':
      return TrainFront
    case 'car':
      return CarFront
    case 'ferry':
      return ShipWheel
    case 'walk':
      return Footprints
    case 'flight':
    default:
      return Plane
  }
}

function buildPlannerTravelOverlays(
  days: PlannerDay[],
  inboxActivities: PlannerActivity[],
): PlannerTravelOverlay[] {
  const overlays: PlannerTravelOverlay[] = []

  const buildOverlay = (
    activity: PlannerActivity,
    dayId: string,
  ): PlannerTravelOverlay | null => {
    if (activity.category !== 'travel') {
      return null
    }

    const points = plannerTravelRoute(activity)
    if (points.length < 2) {
      return null
    }

    const mode = plannerTravelMode(activity)
    const routePath = travelOverlayRoutePath(mode, points)

    return {
      activity,
      dayId,
      mode,
      points,
      routePath,
      badgePoint: midpointForTravelPath(routePath),
    }
  }

  for (const activity of inboxActivities) {
    const overlay = buildOverlay(activity, 'inbox')
    if (overlay) {
      overlays.push(overlay)
    }
  }

  for (const day of days) {
    for (const activity of day.activities) {
      const overlay = buildOverlay(activity, day.id)
      if (overlay) {
        overlays.push(overlay)
      }
    }
  }

  return overlays
}

function travelOverlayRoutePath(
  mode: PlannerTravelDisplayMode,
  points: ReturnType<typeof plannerTravelRoute>,
): PlannerTravelRoutePoint[] {
  const [origin, destination] = points
  if (!origin || !destination) {
    return []
  }

  const start = { lat: origin.lat, lng: origin.lon }
  const end = { lat: destination.lat, lng: destination.lon }
  const deltaLat = end.lat - start.lat
  const deltaLng = end.lng - start.lng
  const baseDistance = Math.hypot(deltaLat, deltaLng)

  if (
    baseDistance < 0.3 ||
    mode === 'car' ||
    mode === 'walk'
  ) {
    return [start, end]
  }

  const midpoint = {
    lat: (start.lat + end.lat) / 2,
    lng: (start.lng + end.lng) / 2,
  }
  let perpendicular = { lat: deltaLng, lng: -deltaLat }
  if ((midpoint.lat >= 0 && perpendicular.lat < 0) || (midpoint.lat < 0 && perpendicular.lat > 0)) {
    perpendicular = {
      lat: -perpendicular.lat,
      lng: -perpendicular.lng,
    }
  }

  const perpendicularMagnitude = Math.hypot(perpendicular.lat, perpendicular.lng) || 1
  const normalizedPerpendicular = {
    lat: perpendicular.lat / perpendicularMagnitude,
    lng: perpendicular.lng / perpendicularMagnitude,
  }

  const curveFactor =
    mode === 'flight' ? 0.16 : mode === 'ferry' ? 0.11 : 0.075
  const curveOffset = Math.min(Math.max(baseDistance * curveFactor, 0.16), 2.8)
  const controlPoint = {
    lat: midpoint.lat + normalizedPerpendicular.lat * curveOffset,
    lng: midpoint.lng + normalizedPerpendicular.lng * curveOffset,
  }
  const segments = mode === 'flight' ? 22 : mode === 'ferry' ? 18 : 14

  return Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments
    const inverseT = 1 - t
    return {
      lat:
        inverseT * inverseT * start.lat +
        2 * inverseT * t * controlPoint.lat +
        t * t * end.lat,
      lng:
        inverseT * inverseT * start.lng +
        2 * inverseT * t * controlPoint.lng +
        t * t * end.lng,
    }
  })
}

function midpointForTravelPath(path: PlannerTravelRoutePoint[]) {
  if (path.length === 0) {
    return null
  }

  return path[Math.floor(path.length / 2)] ?? null
}


function PlannerMapDayAccordion({
  section,
  metrics,
  preview,
  travelMode,
  isSelected,
  isDragActive,
  selectedStop,
  optimizing,
  onSelectStop,
  onAddActivity,
  onPreviewOptimize,
  onApplyPreview,
  onCancelPreview,
  onToggleVisited,
}: {
  section: PlannerMapSection
  metrics: ReturnType<typeof buildPlannerMapDayMetrics>[string] | undefined
  preview: PreviewPlan | null | undefined
  travelMode: RouteTravelMode
  isSelected: boolean
  isDragActive: boolean
  selectedStop: PlannerMapStop | null
  optimizing: boolean
  onSelectStop: (stop: PlannerMapStop) => void
  onAddActivity: (
    dayId: string | null,
    defaultCategory?: PlannerActivity['category'],
  ) => void
  onPreviewOptimize: () => void
  onApplyPreview: () => void
  onCancelPreview: () => void
  onToggleVisited: (activityId: string, currentVisitedAt: string | null) => void
}) {
  const orderedActivities = orderedSectionActivities(section, preview?.order)
  const displayMetrics = preview?.metrics ?? metrics
  const stopByActivityId = new Map(section.stops.map((stop) => [stop.activity.id, stop]))
  const isInbox = section.dayId === 'inbox'
  const dropDayId = isInbox ? null : section.dayId
  const containerId = getPlannerVisualContainerId('main', dropDayId)
  const { setNodeRef, isOver } = useDroppable({
    id: containerId,
    data: { type: 'container', containerId, dayId: dropDayId, bucket: 'main' },
  })
  const { setNodeRef: setEndZoneRef, isOver: isOverEnd } = useDroppable({
    id: `${containerId}::end`,
    data: { type: 'container-end', containerId, dayId: dropDayId, bucket: 'main' },
  })

  return (
    <AccordionItem
      id={`planner-day-${section.dayId}`}
      value={section.dayId}
      ref={setNodeRef}
      className={cn(
        'overflow-hidden rounded-[18px] border border-black/8 bg-white/96 transition-all',
        isSelected && 'shadow-[0_18px_38px_-30px_rgba(124,90,224,0.4)]',
        isOver && 'ring-2 ring-black/6',
      )}
    >
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger asChild>
          <div
            data-testid={`planner-map-day-trigger-${section.dayId}`}
            className="group w-full cursor-pointer px-4 py-2.5 text-left"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.72rem] font-bold text-white shadow-sm"
                  style={{ backgroundColor: section.color }}
                >
                  {section.dayIndex >= 0 ? section.dayIndex + 1 : '+'}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.92rem] font-semibold tracking-[-0.01em] text-[var(--color-text)]">
                    {section.title}
                  </p>
                  <p className="text-[0.76rem] text-[var(--color-text-muted)]">
                    {section.subtitle}
                    {!isInbox ? ` · ${section.dateLabel}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {!isInbox ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7.5 w-7.5 rounded-full p-0 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-text)]"
                          onClick={onPreviewOptimize}
                          disabled={optimizing}
                          aria-label="Optimise itinerary"
                        >
                          <Sparkles className={cn('h-3.5 w-3.5', optimizing && 'animate-pulse')} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{optimizing ? 'Optimizing…' : 'Optimise itinerary'}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7.5 w-7.5 rounded-full p-0 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-text)]"
                    onClick={() => onAddActivity(dropDayId)}
                    aria-label={`Add activity to ${section.title}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </div>
            </div>
          </div>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>

      {preview?.order.length ? (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-3 rounded-[16px] border border-[rgba(124,90,224,0.16)] bg-[rgba(124,90,224,0.08)] px-4 py-3">
            <Badge
              variant="outline"
              className="shrink-0 rounded-full border-[rgba(124,90,224,0.25)] bg-white px-3.5 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]"
            >
              Preview
            </Badge>
            <p className="min-w-0 flex-1 text-sm leading-[1.35] tracking-[-0.02em] text-[var(--color-text)]">
              Voyager found a shorter {routeTravelModeDescriptor(travelMode)} order for this day.
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" className="h-10 rounded-full px-4.5" onClick={onApplyPreview}>
                Apply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-10 rounded-full px-3 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                onClick={onCancelPreview}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <AccordionContent className="px-4 pb-3 pt-0">
        <div className="border-t border-black/6 pt-2">
          {orderedActivities.length > 0 ? (
            <>
              <SortableContext
                items={orderedActivities.map((activity) => activity.id)}
                strategy={verticalListSortingStrategy}
              >
                {orderedActivities.map((activity, index) => {
                  const stop = stopByActivityId.get(activity.id) ?? null
                  const nextActivity = orderedActivities[index + 1]
                  const leg = nextActivity
                    ? displayMetrics?.legs.find((item) => item.toActivityId === nextActivity.id) ?? null
                    : null

                  return (
                    <Fragment key={activity.id}>
                      <ActivityCard
                        activity={activity}
                        onOpen={() => {
                          if (stop) {
                            onSelectStop(stop)
                          }
                        }}
                        isSelected={selectedStop?.activity.id === activity.id}
                        onToggleVisited={() => onToggleVisited(activity.id, activity.visited_at)}
                      />
                      {leg ? (
                        <TravelConnector
                          durationMin={leg.durationMin}
                          distanceKm={leg.distanceKm}
                          testId={`planner-map-travel-leg-${nextActivity.id}`}
                        />
                      ) : null}
                    </Fragment>
                  )
                })}
              </SortableContext>

              <div
                ref={setEndZoneRef}
                className={cn(
                  'overflow-hidden rounded-[10px] border border-dashed border-transparent transition-[min-height,opacity,background-color,border-color]',
                  isDragActive ? 'min-h-8 opacity-100' : 'min-h-0 opacity-0',
                  isOverEnd && 'border-black/16 bg-[var(--color-secondary-surface)]',
                )}
              />
            </>
          ) : (
            <div className="flex min-h-[88px] flex-col items-center justify-center rounded-[16px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] px-5 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                Drop activities here or add one manually.
              </p>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

function PlannerStandaloneActivityGroupCard({
  bucket,
  group,
  stopByActivityId,
  selectedStop,
  isDragActive,
  onSelectStop,
  onToggleVisited,
}: {
  bucket: 'travel' | 'accommodation'
  group: PlannerStandaloneActivityGroup
  stopByActivityId: Map<string, PlannerMapStop>
  selectedStop: PlannerMapStop | null
  isDragActive: boolean
  onSelectStop: (stop: PlannerMapStop) => void
  onToggleVisited: (activityId: string, currentVisitedAt: string | null) => void
}) {
  const containerId = getPlannerVisualContainerId(bucket, group.dayId)
  const { setNodeRef, isOver } = useDroppable({
    id: containerId,
    data: { type: 'container', containerId, dayId: group.dayId, bucket },
  })
  const { setNodeRef: setEndZoneRef, isOver: isOverEnd } = useDroppable({
    id: `${containerId}::end`,
    data: { type: 'container-end', containerId, dayId: group.dayId, bucket },
  })
  const isUnassignedGroup = group.dayId == null

  const cards = (
    <SortableContext
      items={group.activities.map((activity) => activity.id)}
      strategy={verticalListSortingStrategy}
    >
      <div className="flex flex-col gap-2">
        {group.activities.map((activity) => {
          const stop = stopByActivityId.get(activity.id) ?? null
          return (
            <ActivityCard
              key={activity.id}
              activity={activity}
              onOpen={() => {
                if (stop) {
                  onSelectStop(stop)
                }
              }}
              isSelected={selectedStop?.activity.id === activity.id}
              onToggleVisited={() => onToggleVisited(activity.id, activity.visited_at)}
            />
          )
        })}
      </div>
    </SortableContext>
  )

  if (isUnassignedGroup) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'transition-all',
          isOver && 'rounded-[18px] bg-[var(--color-secondary-surface)]/55 p-1.5',
        )}
        data-testid={`planner-${bucket}-group-${group.dayId ?? 'inbox'}`}
      >
        {cards}
        <div
          ref={setEndZoneRef}
          className={cn(
            'mt-2 overflow-hidden rounded-[10px] border border-dashed border-transparent transition-[min-height,opacity,background-color,border-color]',
            isDragActive ? 'min-h-8 opacity-100' : 'min-h-0 opacity-0',
            isOverEnd && 'border-black/16 bg-[var(--color-secondary-surface)]',
          )}
        />
      </div>
    )
  }

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'overflow-hidden rounded-[18px] border border-black/8 bg-white/96 px-3.5 py-3 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.18)] transition-all',
        isOver && 'ring-2 ring-black/6',
      )}
      data-testid={`planner-${bucket}-group-${group.dayId ?? 'inbox'}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-black/6 pb-2.5">
        <div className="min-w-0">
          <p className="text-[0.8rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
            {group.title}
          </p>
          <p className="mt-0.5 text-[0.72rem] text-[var(--color-text-muted)]">
            {group.subtitle}
          </p>
        </div>
        <Badge
          variant="outline"
          className="rounded-full border-black/8 bg-[var(--color-secondary-surface)] px-2.5 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]"
        >
          {group.activities.length} {group.activities.length === 1 ? 'item' : 'items'}
        </Badge>
      </div>

      <div className="mt-3">
        {cards}

        <div
          ref={setEndZoneRef}
          className={cn(
            'mt-2 overflow-hidden rounded-[10px] border border-dashed border-transparent transition-[min-height,opacity,background-color,border-color]',
            isDragActive ? 'min-h-8 opacity-100' : 'min-h-0 opacity-0',
            isOverEnd && 'border-black/16 bg-[var(--color-secondary-surface)]',
          )}
        />
      </div>
    </section>
  )
}

function PlannerStandaloneActivitySection({
  bucket,
  groups,
  isDragActive,
  stopByActivityId,
  selectedStop,
  onSelectStop,
  onAddActivity,
  onToggleVisited,
}: {
  bucket: 'travel' | 'accommodation'
  groups: PlannerStandaloneActivityGroup[]
  isDragActive: boolean
  stopByActivityId: Map<string, PlannerMapStop>
  selectedStop: PlannerMapStop | null
  onSelectStop: (stop: PlannerMapStop) => void
  onAddActivity: (
    dayId: string | null,
    defaultCategory?: PlannerActivity['category'],
  ) => void
  onToggleVisited: (activityId: string, currentVisitedAt: string | null) => void
}) {
  const title = standaloneSectionTitle(bucket)
  const sectionCategory = bucket === 'accommodation' ? 'hotel' : 'travel'
  const Icon = bucket === 'accommodation' ? BedDouble : Plane

  return (
    <AccordionItem
      value={bucket}
      className="overflow-hidden rounded-[20px] border border-black/8 bg-white px-3.5 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.18)]"
      data-planner-section={sectionCategory}
      data-testid={`planner-${bucket}-section`}
    >
      <AccordionTrigger className="py-3 hover:no-underline">
        <PlannerSidebarSectionTrigger
          icon={<Icon className="h-4 w-4" />}
          title={title}
          summary={standaloneSectionSummary(bucket, groups)}
          actions={
            <Button
              type="button"
              variant="ghost"
              className="h-7.5 w-7.5 rounded-full p-0 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-text)]"
              onClick={(event) => {
                event.stopPropagation()
                onAddActivity(null, sectionCategory)
              }}
              aria-label={`Add ${title.toLowerCase()}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          }
        />
      </AccordionTrigger>
      <AccordionContent className="pb-3.5 pt-0">
        {groups.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {groups.map((group) => (
              <PlannerStandaloneActivityGroupCard
                key={group.id}
                bucket={bucket}
                group={group}
                stopByActivityId={stopByActivityId}
                selectedStop={selectedStop}
                isDragActive={isDragActive}
                onSelectStop={onSelectStop}
                onToggleVisited={onToggleVisited}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[88px] flex-col items-center justify-center rounded-[16px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] px-5 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">
              {standaloneSectionEmptyCopy(bucket)}
            </p>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

function DetailSheetContent({
  tripId,
  detail,
  fallbackItem,
  selectedStop,
  selectedCountLabel: _selectedCountLabel,
  destinations,
  onAddToTrip,
  onOpenExisting: _onOpenExisting,
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
  tripId: string
  detail: ResolvedPlaceDetail | null | undefined
  fallbackItem: SearchResultItem | null
  selectedStop: PlannerMapStop | null
  selectedCountLabel: string | null
  destinations: PlannerRecommendationsController['destinations']
  onAddToTrip: (destinationId: string) => void
  onOpenExisting: () => void
  onToggleVisited: () => void
  isTogglingVisited: boolean
  isAdding: boolean
  preferredTab: string
  onTabChange: (tab: string) => void
  compact?: boolean
  isDetailLoading?: boolean
  onClose?: () => void
  dayLabel: string | null
  onEditActivity?: (activity: PlannerActivity) => void
  onDeleteActivity?: (activityId: string) => void
}) {
  const photos = detail?.photos ?? []
  const renderablePhotos = photos
    .map((photo, index) => {
      const thumbnailUrl = resolveMediaUrl(photo.thumbnail_url) ?? resolveMediaUrl(photo.image_url)
      const fullUrl = resolveMediaUrl(photo.image_url) ?? resolveMediaUrl(photo.thumbnail_url)
      if (!thumbnailUrl || !fullUrl) {
        return null
      }
      return { photo, index, thumbnailUrl, fullUrl }
    })
    .filter((item): item is { photo: typeof photos[number]; index: number; thumbnailUrl: string; fullUrl: string } => Boolean(item))
  const reviews = (detail?.reviews ?? []).filter(
    (review) => review.rating != null || Boolean(review.text || review.title || review.reviewer_name),
  )
  const tags = detail?.tags ?? []
  const summary =
    detail?.summary ??
    fallbackItem?.addressText ??
    fallbackItem?.category ??
    null
  const title = detail?.place.name ?? fallbackItem?.name ?? selectedStop?.activity.title ?? 'Place'
  const subtitle =
    detail?.place.address_text ?? fallbackItem?.addressText ?? selectedStop?.activity.place?.address_text
  const relatedActivities = detail?.related_activities ?? []
  const hasSingleRelatedActivity = relatedActivities.length === 1
  const canToggleVisited = Boolean(selectedStop || hasSingleRelatedActivity)
  const visitedAt =
    selectedStop?.activity.visited_at ??
    (hasSingleRelatedActivity ? relatedActivities[0].visited_at : null)
  const isAdded = Boolean(selectedStop) || relatedActivities.length > 0
  const detailMeta = [detail?.status_text, detail?.price_label].filter(
    (item): item is string => Boolean(item),
  )
  const heroPhoto = photos[0] ?? null
  const detailPhotoUrl =
    resolveMediaUrl(heroPhoto?.thumbnail_url) ??
    resolveMediaUrl(heroPhoto?.image_url)
  const visibleTags = compact ? tags.slice(0, 4) : tags
  const hiddenTagCount = Math.max(tags.length - visibleTags.length, 0)
  const detailLinks = [
    ...(detail?.booking_links ?? []),
    ...(detail?.mentions ?? []).map((mention) => ({
      label: mention.label,
      url: mention.url,
    })),
  ].filter((link, index, values) => {
    if (!link.url) {
      return false
    }
    const key = `${link.label.toLowerCase()}::${link.url}`
    return (
      values.findIndex(
        (candidate) =>
          candidate.url && `${candidate.label.toLowerCase()}::${candidate.url}` === key,
      ) === index
    )
  })
  const visibleHours = compact ? detail?.hours.slice(0, 4) ?? [] : detail?.hours ?? []
  const hiddenHoursCount = Math.max((detail?.hours.length ?? 0) - visibleHours.length, 0)
  const hasAboutContent = Boolean(
    summary ||
    detailPhotoUrl ||
    visibleTags.length ||
    detail?.rating != null ||
    detailMeta.length ||
    detailLinks.length ||
    visibleHours.length,
  )

  const hasActivityTab = Boolean(selectedStop)

  const activity = selectedStop?.activity ?? null
  const activityDetails = activity?.category_details as Record<string, unknown> | null ?? null
  const activitySchedule = (() => {
    if (!activity) return null
    const formatTime = (t: string) => (t.length > 5 ? t.substring(0, 5) : t)
    const formatDur = (m: number) => {
      if (m >= 60) {
        const h = m / 60
        return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`
      }
      return `${m}m`
    }
    if (activity.start_time) {
      return `${formatTime(activity.start_time)}${activity.duration_min ? ` · ${formatDur(activity.duration_min)}` : ''}`
    }
    if (activity.duration_min) return formatDur(activity.duration_min)
    return activity.trip_day_id == null ? null : 'Flexible'
  })()
  const activityCategoryDescription = activity ? plannerCategoryDescription(activity) : null
  const activityBudgetLabel = activity?.estimated_cost_amount != null
    ? (formatMoney(activity.estimated_cost_amount, activity.estimated_cost_currency) ?? null)
    : null
  const activityTravelRoute = activity ? plannerTravelRoute(activity) : []

  const ACTIVITY_CATEGORY_ICON: Record<string, typeof Landmark> = {
    visit: Landmark,
    eat: Utensils,
    activity: Ticket,
    hotel: BedDouble,
    travel: Plane,
  }
  const ActivityCategoryIcon = activity ? (ACTIVITY_CATEGORY_ICON[activity.category] ?? Landmark) : Landmark

  // Which tabs to show depends on the activity type
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
      ].filter((tab): tab is [string, string] => Boolean(tab))
  const validTabIds = visibleTabs.map(([id]) => id)
  const activeTab = validTabIds.includes(preferredTab) ? preferredTab : (validTabIds[0] ?? 'about')
  const detailTabsId = useId()

  const showActivityActions = Boolean(activity && (onEditActivity || onDeleteActivity))
  const hasActionButtons = canToggleVisited || showActivityActions || !isAdded
  const actionButtonClass =
    'inline-flex h-7.5 w-7.5 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-black/5 hover:text-[var(--color-text)] disabled:opacity-50'
  const actionIconClass = 'h-3.5 w-3.5'

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
              ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700'
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
          <AlertDialogContent className="rounded-[14px] border-black/8 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete activity</AlertDialogTitle>
              <AlertDialogDescription>
                Remove &ldquo;{activity.title}&rdquo; from this trip? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-[10px]">Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="rounded-[10px]"
                onClick={() => {
                  onDeleteActivity(activity.id)
                  onClose?.()
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
              {isAdding ? <VoyagerLoader className={actionIconClass} /> : <Plus className={actionIconClass} />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[200px] shrink-0 rounded-[14px] border border-black/8 bg-white/94 p-2 shadow-sm backdrop-blur-xl"
          >
            <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
              Where should this go?
            </DropdownMenuLabel>
            {destinations.map((destination) => (
              <DropdownMenuItem
                key={destination.id}
                onClick={() => {
                  if (detail?.place.id) {
                    onAddToTrip(destination.id)
                  } else if (fallbackItem?.id) {
                    onAddToTrip(destination.id)
                  }
                }}
                className="flex cursor-pointer select-none items-center rounded-lg px-2 py-2 text-sm text-[var(--color-text)] outline-none hover:bg-black/4 focus:bg-black/4"
              >
                <span>{destination.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  ) : null
  const closeButton = onClose ? (
    <button
      type="button"
      onClick={onClose}
      className={cn(
        'absolute z-10 rounded-full border border-black/8 bg-white/90 p-2 text-[var(--color-text-muted)] shadow-sm transition-colors hover:bg-white hover:text-[var(--color-text)]',
        compact ? 'right-3.5 top-3.5' : 'right-4 top-4',
      )}
      aria-label="Close place details"
    >
      <X className="h-4 w-4" />
    </button>
  ) : null

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {closeButton}
      <div className={cn(
        'shrink-0 border-b border-black/8 bg-white',
        compact ? 'px-4 py-4' : 'px-5 py-5',
        onClose && (compact ? 'pr-14' : 'pr-16'),
      )}>
        {compact ? (
          /* Compact layout (map panel): badges → title → subtitle */
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedStop ? (
                <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[0.68rem]">
                  {selectedStop.isHotel ? 'Stay' : plannerCategoryLabel(selectedStop.activity.category)}
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
          /* Full drawer layout: title prominent at top, meta badges below */
          <>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {selectedStop ? (
                <Badge variant="outline" className="rounded-full">
                  {selectedStop.isHotel ? 'Stay' : plannerCategoryLabel(selectedStop.activity.category)}
                </Badge>
              ) : null}
            </div>
            <h2 className="mt-3 text-[1.25rem] font-semibold tracking-[-0.03em] text-[var(--color-text)]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                {subtitle}
              </p>
            ) : null}
            {(detail?.rating != null || detailMeta.length > 0) ? (
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

      <div className={cn(
        'min-h-0 flex-1 overflow-y-auto',
        compact ? 'px-3 pb-3 pt-3' : 'px-4 pb-4 pt-4',
      )}>
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
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className={cn('rounded-[18px]', compact ? 'h-[5rem]' : 'h-[6rem]')} />
                <Skeleton className={cn('rounded-[18px]', compact ? 'h-[5rem]' : 'h-[6rem]')} />
                <Skeleton className={cn('col-span-2 rounded-[18px]', compact ? 'h-9' : 'h-10')} />
              </div>
            ) : activeTab === 'about' ? (
              <div className="grid grid-cols-2 gap-3">

                  {/* Row 1 col 1 — Summary (hidden when no content) */}
                  {summary ? (
                    <div className={cn(
                      'rounded-[22px] border border-black/8 bg-white',
                      compact ? 'p-3.5' : 'p-4',
                    )}>
                      <div className="flex items-start gap-2.5">
                        <MapPin className={cn('shrink-0 text-[var(--color-text-muted)]', compact ? 'mt-0.5 h-4 w-4' : 'mt-1 h-4 w-4')} />
                        <p className={cn(
                          'text-[var(--color-text)]',
                          compact ? 'text-[0.82rem] leading-6' : 'text-[0.84rem] leading-6',
                        )}>
                          {summary}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {/* Row 1 col 2 — Photo (spans both cols when no summary) */}
                  {detailPhotoUrl ? (
                    <PhotoViewerProvider>
                      <PhotoViewer src={resolveMediaUrl(heroPhoto?.image_url) ?? detailPhotoUrl}>
                        <button
                          type="button"
                          className={cn(
                            'group relative block w-full overflow-hidden rounded-[22px] border border-black/8 bg-[var(--color-secondary-surface)] text-left',
                            !summary && 'col-span-2',
                            compact ? 'h-[6rem]' : 'h-[8rem]',
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

                  {/* Row 2 col 1 — Tags */}
                  {visibleTags.length ? (
                    <div className={cn(
                      'rounded-[22px] border border-black/8 bg-white',
                      compact ? 'p-3.5' : 'p-4',
                    )}>
                      <p className={cn(
                        'font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]',
                        compact ? 'mb-2 text-[0.64rem]' : 'mb-2.5 text-[0.68rem]',
                      )}>
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
                          <span className={cn(
                            'rounded-full border border-dashed border-black/8 text-[var(--color-text-muted)]',
                            compact ? 'px-2.5 py-1 text-[0.7rem]' : 'px-2.5 py-1 text-[0.72rem]',
                          )}>
                            +{hiddenTagCount}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Row 3 col 2 — Rating + meta + links */}
                  {(detail?.rating != null || detailMeta.length > 0 || detailLinks.length > 0) ? (
                    <div className={cn(
                      'rounded-[22px] border border-black/8 bg-white',
                      compact ? 'p-3.5' : 'p-4',
                    )}>
                      <p className={cn(
                        'font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]',
                        compact ? 'mb-2 text-[0.64rem]' : 'mb-2.5 text-[0.68rem]',
                      )}>
                        Details
                      </p>
                      <div className={cn('flex flex-col gap-1.5 text-[var(--color-text-muted)]', compact ? 'text-[0.78rem]' : 'text-[0.82rem]')}>
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

                  {/* Row 3 — Opening Hours (full width) */}
                  {visibleHours.length ? (
                    <div className={cn(
                      'col-span-2 rounded-[22px] border border-black/8 bg-white',
                      compact ? 'px-3.5 pb-1 pt-1' : 'px-4 pb-2 pt-2',
                    )}>
                      <Accordion type="single" collapsible defaultValue="hours">
                        <AccordionItem value="hours" className="border-b-0">
                          <AccordionTrigger className={cn(
                            'font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)] hover:no-underline [&>svg]:text-[var(--color-text-muted)]',
                            compact ? 'py-2.5 text-[0.68rem] [&>svg]:h-3 [&>svg]:w-3' : 'py-3 text-[0.72rem] [&>svg]:h-3.5 [&>svg]:w-3.5',
                          )}>
                            Opening hours
                          </AccordionTrigger>
                          <AccordionContent className={cn(
                            'text-[var(--color-text)]',
                            compact ? 'space-y-1.5 pb-2.5 text-[0.78rem]' : 'space-y-2 pb-4 text-sm',
                          )}>
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
                        className={cn(
                          'rounded-[18px] border border-black/8 bg-white',
                          compact ? 'p-3.5' : 'p-4',
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className={cn('font-semibold text-[var(--color-text)]', compact ? 'text-[0.88rem]' : 'text-sm')}>
                            {review.title || review.reviewer_name || 'Review'}
                          </p>
                          {review.rating != null ? (
                            <span className={cn(
                              'rounded-full bg-[var(--color-secondary-surface)] font-medium text-[var(--color-text-muted)]',
                              compact ? 'px-2 py-0.5 text-[0.68rem]' : 'px-2.5 py-1 text-[0.72rem]',
                            )}>
                              {review.rating.toFixed(1)}
                            </span>
                          ) : null}
                        </div>
                        {review.text ? (
                          <p className={cn(
                            'text-[var(--color-text-muted)]',
                            compact ? 'mt-2 text-[0.84rem] leading-5' : 'mt-3 text-sm leading-6',
                          )}>
                            {review.text}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={cn(
                    'rounded-[18px] border border-dashed border-black/8 text-[var(--color-text-muted)]',
                    compact ? 'px-3.5 py-4 text-[0.84rem]' : 'px-4 py-6 text-sm',
                  )}>
                    No cached reviews are available for this place yet.
                  </p>
                )
              ) : null}

              {activeTab === 'photos' ? (
                renderablePhotos.length ? (
                  <PhotoViewerProvider>
                    <div className={cn('grid gap-3 sm:grid-cols-2', compact && 'gap-2.5 lg:grid-cols-3')}>
                      {renderablePhotos.map(({ photo, index, thumbnailUrl, fullUrl }) => {
                        return (
                          <PhotoViewer key={`${photo.image_url}-${index}`} src={fullUrl}>
                            <button
                              type="button"
                              className="group block overflow-hidden rounded-[18px] border border-black/8 bg-white text-left"
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
                                <span className={cn(
                                  'block text-[var(--color-text-muted)]',
                                  compact ? 'px-2.5 py-2 text-[0.68rem]' : 'px-3 py-2 text-xs',
                                )}>
                                  {photo.caption}
                                </span>
                              ) : null}
                            </button>
                          </PhotoViewer>
                        )
                      })}
                    </div>
                  </PhotoViewerProvider>
                ) : null
              ) : null}

              {activeTab === 'activity' && activity ? (
                <div className="space-y-3">
                  {activity.description ? (
                    <div className={cn(
                      'rounded-[18px] border border-black/8 bg-white',
                      compact ? 'px-3.5 py-3' : 'px-4 py-4',
                    )}>
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Summary
                      </p>
                      <p className={cn('mt-2 leading-6 text-[var(--color-text)]', compact ? 'text-[0.84rem]' : 'text-sm')}>
                        {activity.description}
                      </p>
                    </div>
                  ) : null}

                  {[
                    activitySchedule ? { key: 'schedule', label: 'Schedule', value: activitySchedule, Icon: Clock3 } : null,
                    activityCategoryDescription ? { key: 'location', label: 'Location', value: activityCategoryDescription, Icon: MapPin } : null,
                    activityBudgetLabel ? { key: 'budget', label: 'Budget', value: activityBudgetLabel, Icon: Receipt } : null,
                    { key: 'placement', label: 'Placement', value: dayLabel ?? (activity.trip_day_id == null ? 'Inbox' : 'Assigned'), Icon: ActivityCategoryIcon },
                  ].filter(Boolean).map((item) => item && (
                    <div key={item.key} className={cn(
                      'rounded-[18px] border border-black/8 bg-white',
                      compact ? 'px-3.5 py-3' : 'px-4 py-3',
                    )}>
                      <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        <item.Icon className="h-3.5 w-3.5" />
                        {item.label}
                      </div>
                      <p className={cn('mt-2 leading-6 text-[var(--color-text)]', compact ? 'text-[0.84rem]' : 'text-sm')}>
                        {item.value}
                      </p>
                    </div>
                  ))}

                  {activity.category === 'travel' && activityTravelRoute.length > 0 ? (
                    <div className={cn('rounded-[18px] border border-black/8 bg-white', compact ? 'px-3.5 py-3' : 'px-4 py-4')}>
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Route
                      </p>
                      <div className="mt-3 space-y-2">
                        {activityTravelRoute.map((point, idx) => (
                          <div key={`${point.label}-${idx}`} className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 py-2.5">
                            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                              {idx === 0 ? 'Origin' : 'Destination'}
                            </p>
                            <p className={cn('mt-1 text-[var(--color-text)]', compact ? 'text-[0.84rem]' : 'text-sm')}>
                              {point.label}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {activity.category === 'hotel' ? (
                    <div className={cn('rounded-[18px] border border-black/8 bg-white', compact ? 'px-3.5 py-3' : 'px-4 py-4')}>
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Stay
                      </p>
                      <div className="mt-3 grid gap-2 grid-cols-2">
                        {typeof activityDetails?.checkin_date === 'string' ? (
                          <div className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 py-2.5">
                            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Check-in</p>
                            <p className={cn('mt-1 text-[var(--color-text)]', compact ? 'text-[0.84rem]' : 'text-sm')}>{activityDetails.checkin_date}</p>
                          </div>
                        ) : null}
                        {typeof activityDetails?.checkout_date === 'string' ? (
                          <div className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 py-2.5">
                            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Check-out</p>
                            <p className={cn('mt-1 text-[var(--color-text)]', compact ? 'text-[0.84rem]' : 'text-sm')}>{activityDetails.checkout_date}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {activity.notes ? (
                    <div className={cn('rounded-[18px] border border-black/8 bg-white', compact ? 'px-3.5 py-3' : 'px-4 py-4')}>
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Notes
                      </p>
                      <p className={cn('mt-2 leading-6 text-[var(--color-text)]', compact ? 'text-[0.84rem]' : 'text-sm')}>
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
  )
}

export function PlannerMapView({
  trip,
  tripId,
  tripVersion,
  travelMode = 'WALK',
  days,
  inboxActivities,
  isDragActive = false,
  selectedActivityId,
  selectedPlaceId,
  recommendations,
  selectedRecommendation,
  onAddActivity,
  onSelectActivityId,
  onSelectPlaceId,
  onSelectRecommendation,
  onClearMapSelection,
  onEditActivity,
  onDeleteActivity,
  onRegisterSectionOpener,
  onOpenCollaboration,
}: Props) {
  const isMobile = useIsMobile()
  const { mobilePlannerView } = useSideRailStore()
  const dragActive = Boolean(isDragActive)
  const queryClient = useQueryClient()
  const createPlaceMutation = useCreatePlace()
  const [railSections, setRailSections] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`planner-rail-sections:${tripId}`)
      if (stored) return JSON.parse(stored) as string[]
    } catch {}
    return ['recommendations', 'travel', 'accommodation']
  })
  const handleRailSectionsChange = (next: string[]) => {
    setRailSections(next)
    try {
      localStorage.setItem(`planner-rail-sections:${tripId}`, JSON.stringify(next))
    } catch {}
  }
  useEffect(() => {
    onRegisterSectionOpener?.((sectionKey) => {
      setRailSections((prev) => {
        if (prev.includes(sectionKey)) return prev
        const next = [...prev, sectionKey]
        try {
          localStorage.setItem(`planner-rail-sections:${tripId}`, JSON.stringify(next))
        } catch {}
        return next
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const sections = useMemo(
    () => buildPlannerMapSections(days, inboxActivities),
    [days, inboxActivities],
  )
  const itinerarySections = useMemo(
    () =>
      buildPlannerMapSections(
        filterPlannerDaysByBucket(days, 'main'),
        filterPlannerActivitiesByBucket(inboxActivities, 'main'),
      ),
    [days, inboxActivities],
  )
  const accommodationGroups = useMemo(
    () => buildStandaloneActivityGroups(days, inboxActivities, 'accommodation'),
    [days, inboxActivities],
  )
  const travelGroups = useMemo(
    () => buildStandaloneActivityGroups(days, inboxActivities, 'travel'),
    [days, inboxActivities],
  )
  const allPlannerActivities = useMemo(
    () => [...inboxActivities, ...days.flatMap((day) => day.activities)],
    [days, inboxActivities],
  )
  const { data: tripAssetsData } = useTripAssets(tripId, null)
  const tripAssets = tripAssetsData?.items ?? []
  const { coverPhotoUrl: heroPhotoUrl } = useTripCoverPhotoManager(tripId, trip)
  const stopByActivityId = useMemo(
    () =>
      new Map(
        sections.flatMap((section) =>
          section.stops.map((stop) => [stop.activity.id, stop] as const),
        ),
      ),
    [sections],
  )
  const initialVisibleDayIds = useMemo(
    () => new Set(sections.map((section) => section.dayId)),
    [sections],
  )
  const [visibleDayIds, setVisibleDayIds] = useState<Set<string>>(initialVisibleDayIds)
  const [visibleGroups, setVisibleGroups] = useState<Set<PlannerMapLayerGroup>>(
    new Set(['visit', 'eat', 'activity', 'hotel', 'travel']),
  )
  const [isPlannerStoreHydrated, setIsPlannerStoreHydrated] = useState(() =>
    usePlannerStore.persist.hasHydrated(),
  )
  const storedDayAccordionState = usePlannerStore((state) => state.mapDayAccordionStateByTrip[tripId])
  const setMapDayAccordionState = usePlannerStore((state) => state.setMapDayAccordionState)
  const [showRoutes, setShowRoutes] = useState(
    recommendations.preferences.map.showRoutesByDefault,
  )
  const [showCustomLayers, setShowCustomLayers] = useState(
    recommendations.preferences.map.showCustomLayersByDefault,
  )
  const [mapVisibilityCustomized, setMapVisibilityCustomized] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [activeQuickCategory, setActiveQuickCategory] = useState<QuickCategory | null>(null)
  const [selectedSearchItem, setSelectedSearchItem] = useState<SearchResultItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const mapContainerRef = useRef<HTMLElement | null>(null)
  const detailSheetRef = useRef<HTMLDivElement | null>(null)
  const [detailSheetOverlap, setDetailSheetOverlap] = useState(0)
  const [recommendationsDismissed, setRecommendationsDismissed] = useState(true)
  const [preferredDetailTab, setPreferredDetailTab] = useState('about')
  const [addingToTrip, setAddingToTrip] = useState(false)
  const [togglingVisited, setTogglingVisited] = useState(false)
  const [optimizingDayId, setOptimizingDayId] = useState<string | null>(null)
  const [previewByDayId, setPreviewByDayId] = useState<Record<string, PreviewPlan | null>>({})
  const deferredSearchText = useDeferredValue(searchText)
  const [viewport, setViewport] = useState(() => {
    const firstStop = sections.flatMap((section) => section.stops).find((stop) => stop.lat != null && stop.lon != null)
    return {
      latitude: firstStop?.lat ?? 48.8566,
      longitude: firstStop?.lon ?? 2.3522,
      zoom: 12,
    }
  })

  const { data: tripLayersData } = useTripMapLayers(tripId)
  const routeLegPayload = useMemo(
    () => buildPlannerMapLegPayload(itinerarySections, travelMode),
    [itinerarySections, travelMode],
  )
  const routeLegEstimates = useRouteLegEstimates(routeLegPayload)
  const dayMetrics = useMemo(
    () =>
      buildPlannerMapDayMetrics(
        itinerarySections,
        routeLegEstimates.data?.items ?? [],
        travelMode,
      ),
    [itinerarySections, routeLegEstimates.data?.items, travelMode],
  )
  const sectionDayIds = useMemo(
    () => itinerarySections.map((section) => section.dayId),
    [itinerarySections],
  )
  const dayAccordionState = useMemo(
    () => reconcileDayAccordionState(storedDayAccordionState, sectionDayIds),
    [sectionDayIds, storedDayAccordionState],
  )
  const expandedDayIds = useMemo(
    () => accordionStateToExpandedDayIds(dayAccordionState, sectionDayIds),
    [dayAccordionState, sectionDayIds],
  )
  const localSearchQuery = usePlaceSearch(
    { q: deferredSearchText.trim(), limit: 6, offset: 0 },
    deferredSearchText.trim().length >= 2,
  )
  const googleSearchQuery = useGooglePlaceSearch(
    {
      q: deferredSearchText.trim() || activeQuickCategory?.query,
      limit: 6,
      offset: 0,
      lat: viewport.latitude,
      lon: viewport.longitude,
      radius_m: 6000,
      category: activeQuickCategory?.category,
    },
    Boolean((deferredSearchText.trim().length >= 2 || activeQuickCategory) && config.map.apiKey),
  )

  const selectedStop = selectedActivityId ? stopByActivityId.get(selectedActivityId) ?? null : null
  const selectedDetailPlaceId =
    selectedStop?.activity.place_id ??
    (selectedSearchItem?.kind === 'saved' ? selectedSearchItem.placeId : null) ??
    selectedPlaceId ??
    null
  const savedPlaceQuery = usePlace(selectedDetailPlaceId)
  const placeDetailQuery = usePlannerMapPlaceDetail(tripId, selectedDetailPlaceId)
  const selectedGooglePlaceId =
    selectedSearchItem?.kind === 'google'
      ? selectedSearchItem.id
      : resolveGooglePlaceId(savedPlaceQuery.data)
  const googlePlaceDetailQuery = useGooglePlaceDetail(selectedGooglePlaceId)
  const resolvedDetail = useMemo(
    () => mergePlaceDetail(placeDetailQuery.data, googlePlaceDetailQuery.data),
    [googlePlaceDetailQuery.data, placeDetailQuery.data],
  )
  const tripLayers = useMemo(
    () => (showCustomLayers ? (tripLayersData?.items ?? []).filter((layer) => layer.is_visible) : []),
    [showCustomLayers, tripLayersData?.items],
  )
  const allTravelOverlays = useMemo(
    () => buildPlannerTravelOverlays(days, inboxActivities),
    [days, inboxActivities],
  )
  const selectedTravelOverlay = useMemo(
    () =>
      selectedActivityId
        ? allTravelOverlays.find((overlay) => overlay.activity.id === selectedActivityId) ?? null
        : null,
    [allTravelOverlays, selectedActivityId],
  )
  const selectedTravelOverlayPath = selectedTravelOverlay?.routePath ?? []
  const visibleStops = useMemo(
    () => filterVisibleStops(sections, visibleDayIds, visibleGroups),
    [sections, visibleDayIds, visibleGroups],
  )
  const visibleTravelOverlays = useMemo(
    () =>
      visibleGroups.has('travel')
        ? allTravelOverlays.filter((overlay) => visibleDayIds.has(overlay.dayId))
        : [],
    [allTravelOverlays, visibleDayIds, visibleGroups],
  )
  const mapRecommendationEntries = useMemo(() => {
    const seen = new Set<string>()
    return recommendations.discoverEntries
      .filter((entry) => entry.item.lat != null && entry.item.lon != null)
      .filter((entry) => {
        const key = `${entry.item.provider}:${entry.item.provider_ref}`
        if (seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })
      .slice(0, 12)
  }, [recommendations.discoverEntries])
  const allSearchResults = useMemo(() => {
    const localItems = (localSearchQuery.data?.items ?? []).map(toSavedSearchItem)
    const googleItems = (googleSearchQuery.data?.items ?? []).map(toGoogleSearchItem)
    const seen = new Set(localItems.map((item) => `${item.name.toLowerCase()}:${item.addressText ?? ''}`))
    return [
      ...localItems,
      ...googleItems.filter((item) => !seen.has(`${item.name.toLowerCase()}:${item.addressText ?? ''}`)),
    ]
  }, [googleSearchQuery.data?.items, localSearchQuery.data?.items])

  useEffect(() => {
    setVisibleDayIds(initialVisibleDayIds)
  }, [initialVisibleDayIds])

  useEffect(() => {
    const unsubscribeHydrate = usePlannerStore.persist.onHydrate(() => {
      setIsPlannerStoreHydrated(false)
    })
    const unsubscribeFinishHydration = usePlannerStore.persist.onFinishHydration(() => {
      setIsPlannerStoreHydrated(true)
    })

    setIsPlannerStoreHydrated(usePlannerStore.persist.hasHydrated())

    return () => {
      unsubscribeHydrate()
      unsubscribeFinishHydration()
    }
  }, [])

  useEffect(() => {
    if (mapVisibilityCustomized) {
      return
    }

    setShowRoutes(recommendations.preferences.map.showRoutesByDefault)
    setShowCustomLayers(recommendations.preferences.map.showCustomLayersByDefault)
  }, [
    mapVisibilityCustomized,
    recommendations.preferences.map.showCustomLayersByDefault,
    recommendations.preferences.map.showRoutesByDefault,
  ])

  useEffect(() => {
    if (!isPlannerStoreHydrated) {
      return
    }
    if (
      storedDayAccordionState &&
      areDayAccordionStatesEqual(storedDayAccordionState, dayAccordionState, sectionDayIds)
    ) {
      return
    }
    setMapDayAccordionState(tripId, dayAccordionState)
  }, [
    dayAccordionState,
    isPlannerStoreHydrated,
    sectionDayIds,
    setMapDayAccordionState,
    storedDayAccordionState,
    tripId,
  ])

  useEffect(() => {
    if (selectedActivityId) {
      setDetailOpen(true)
      return
    }
    if (selectedPlaceId) {
      const matchingStop = sections
        .flatMap((section) => section.stops)
        .find((stop) => stop.activity.place_id === selectedPlaceId)
      if (matchingStop) {
        onSelectActivityId(matchingStop.activity.id)
        return
      }
      setDetailOpen(true)
    }
    if (selectedSearchItem) {
      setDetailOpen(true)
    }
    if (selectedRecommendation) {
      setDetailOpen(true)
      return
    }
    if (
      recommendations.enabled &&
      !selectedActivityId &&
      !selectedPlaceId &&
      !selectedSearchItem &&
      !recommendationsDismissed
    ) {
      setDetailOpen(true)
    }
  }, [
    onSelectActivityId,
    recommendations.enabled,
    recommendationsDismissed,
    sections,
    selectedActivityId,
    selectedPlaceId,
    selectedRecommendation,
    selectedSearchItem,
  ])

  const activeRouteSections = useMemo(
    () =>
      itinerarySections.filter((section) => {
        if (!visibleDayIds.has(section.dayId) || !showRoutes) {
          return false
        }
        return section.stops.filter((stop) => stop.markerNumber != null).length >= 2
      }),
    [itinerarySections, showRoutes, visibleDayIds],
  )
  const primaryRouteSection = useMemo(() => {
    if (selectedStop) {
      return activeRouteSections.find((section) => section.dayId === selectedStop.dayId) ?? activeRouteSections[0] ?? null
    }
    return activeRouteSections[0] ?? null
  }, [activeRouteSections, selectedStop])
  const routeSections = useMemo(
    () =>
      activeRouteSections
        .map((section) => ({
          section,
          routeStops: section.stops.filter(
            (stop) =>
              stop.markerNumber != null &&
              stop.lat != null &&
              stop.lon != null,
          ),
        }))
        .filter(({ routeStops }) => routeStops.length >= 2),
    [activeRouteSections],
  )

  // On desktop the detail panel overlays the bottom ~60% of the map canvas.
  // Shift the focus center south so the marker lands in the visible upper area.
  const PANEL_LAT_OFFSET = isMobile ? 0 : -0.018

  const currentMapFocus = useMemo(() => {
    function withOffset(lat: number, lng: number) {
      return { lat: lat + PANEL_LAT_OFFSET, lng }
    }

    if (selectedStop?.lat != null && selectedStop.lon != null) {
      return {
        point: withOffset(selectedStop.lat, selectedStop.lon),
        zoom: 13,
      }
    }
    if (selectedRecommendation?.item.lat != null && selectedRecommendation.item.lon != null) {
      return {
        point: withOffset(selectedRecommendation.item.lat, selectedRecommendation.item.lon),
        zoom: 13,
      }
    }
    if (selectedSearchItem?.lat != null && selectedSearchItem.lon != null) {
      return {
        point: withOffset(selectedSearchItem.lat, selectedSearchItem.lon),
        zoom: 13,
      }
    }
    if (placeDetailQuery.data?.place.lat != null && placeDetailQuery.data.place.lon != null) {
      return {
        point: withOffset(placeDetailQuery.data.place.lat, placeDetailQuery.data.place.lon),
        zoom: 13,
      }
    }
    if (
      googlePlaceDetailQuery.data?.place.lat != null &&
      googlePlaceDetailQuery.data.place.lon != null
    ) {
      return {
        point: withOffset(googlePlaceDetailQuery.data.place.lat, googlePlaceDetailQuery.data.place.lon),
        zoom: 13,
      }
    }
    return null
  }, [
    PANEL_LAT_OFFSET,
    googlePlaceDetailQuery.data?.place.lat,
    googlePlaceDetailQuery.data?.place.lon,
    placeDetailQuery.data?.place.lat,
    placeDetailQuery.data?.place.lon,
    selectedRecommendation?.item.lat,
    selectedRecommendation?.item.lon,
    selectedSearchItem?.lat,
    selectedSearchItem?.lon,
    selectedStop?.lat,
    selectedStop?.lon,
  ])
  const hasPlaceSelection = Boolean(selectedStop || selectedSearchItem || selectedDetailPlaceId)
  const showRecommendationSheet =
    recommendations.enabled &&
    !hasPlaceSelection &&
    !selectedRecommendation &&
    !recommendationsDismissed
  const hasActiveSelection = Boolean(
    selectedStop || selectedSearchItem || selectedDetailPlaceId || selectedRecommendation,
  )

  useEffect(() => {
    if (isMobile || !detailOpen || !hasActiveSelection) {
      setDetailSheetOverlap(0)
      return
    }

    const measureDetailSheetOverlap = () => {
      const mapContainerRect = mapContainerRef.current?.getBoundingClientRect()
      const detailSheetRect = detailSheetRef.current?.getBoundingClientRect()
      if (!mapContainerRect || !detailSheetRect) {
        setDetailSheetOverlap(0)
        return
      }

      const overlap = Math.max(
        0,
        Math.min(mapContainerRect.bottom, detailSheetRect.bottom) -
          Math.max(mapContainerRect.top, detailSheetRect.top),
      )

      setDetailSheetOverlap((current) => (Math.abs(current - overlap) < 1 ? current : overlap))
    }

    measureDetailSheetOverlap()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const resizeObserver = new ResizeObserver(measureDetailSheetOverlap)
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current)
    }
    if (detailSheetRef.current) {
      resizeObserver.observe(detailSheetRef.current)
    }
    window.addEventListener('resize', measureDetailSheetOverlap)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', measureDetailSheetOverlap)
    }
  }, [
    detailOpen,
    hasActiveSelection,
    isMobile,
    selectedActivityId,
    selectedDetailPlaceId,
    selectedRecommendation?.item.id,
    selectedSearchItem?.id,
  ])

  const selectedTravelOverlayPadding = useMemo<google.maps.Padding>(
    () => ({
      top: 120,
      right: 84,
      bottom: Math.max(84, Math.round(detailSheetOverlap) + 32),
      left: 84,
    }),
    [detailSheetOverlap],
  )

  const clearSelection = () => {
    onClearMapSelection()
    onSelectRecommendation(null)
    setSelectedSearchItem(null)
    setDetailOpen(false)
    setPreferredDetailTab('about')
  }

  const handleStopSelection = (stop: PlannerMapStop) => {
    if (selectedActivityId === stop.activity.id) {
      clearSelection()
      return
    }
    onSelectRecommendation(null)
    setSelectedSearchItem(null)
    onSelectActivityId(stop.activity.id)
    onSelectPlaceId(stop.activity.place_id)
    setPreferredDetailTab('about')
    setDetailOpen(true)
  }

  const handleTravelOverlaySelection = (activity: PlannerActivity) => {
    if (selectedActivityId === activity.id) {
      clearSelection()
      return
    }

    onSelectRecommendation(null)
    setSelectedSearchItem(null)
    onSelectActivityId(activity.id)
    onSelectPlaceId(activity.place_id)
    setPreferredDetailTab('about')
    setDetailOpen(true)
  }

  const handleSearchSelection = (item: SearchResultItem) => {
    onSelectRecommendation(null)
    onClearMapSelection()
    onSelectPlaceId(item.placeId)
    setSelectedSearchItem(item)
    setPreferredDetailTab('about')
    setDetailOpen(true)
    setSearchOpen(false)
  }

  const handleRecommendationSelection = (entry: PlannerRecommendationEntry) => {
    if (selectedRecommendation?.key === entry.key) {
      clearSelection()
      return
    }
    onClearMapSelection()
    setSelectedSearchItem(null)
    onSelectRecommendation(entry)
    setRecommendationsDismissed(false)
    setPreferredDetailTab('about')
    setDetailOpen(true)
  }

  useEffect(() => {
    if (isMobile || !detailOpen || !hasActiveSelection) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      clearSelection()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clearSelection, detailOpen, hasActiveSelection, isMobile])

  const handleMapPoiSelection = async (event: MapMouseEvent) => {
    const placeId = event.detail.placeId
    if (!placeId) {
      return
    }

    event.stop()
    setSearchOpen(false)
    setLayersOpen(false)
    onSelectRecommendation(null)
    onClearMapSelection()
    setPreferredDetailTab('about')
    setDetailOpen(true)

    try {
      const candidate = await queryClient.fetchQuery({
        queryKey: placeKeys.googleDetail(placeId),
        queryFn: () => getGooglePlace(placeId),
        staleTime: 5 * 60 * 1000,
      })
      setSelectedSearchItem(toGoogleSearchItem(candidate))
    } catch {
      const latLng = event.detail.latLng
      setSelectedSearchItem({
        kind: 'google',
        id: placeId,
        placeId: null,
        name: 'Selected place',
        addressText: null,
        category: null,
        lat: latLng?.lat ?? null,
        lon: latLng?.lng ?? null,
        metadata: {},
      })
    }
  }

  const toggleVisibleDay = (dayId: string) => {
    setVisibleDayIds((current) => {
      const next = new Set(current)
      if (next.has(dayId)) {
        next.delete(dayId)
      } else {
        next.add(dayId)
      }
      return next
    })
  }

  const toggleVisibleGroup = (group: PlannerMapLayerGroup) => {
    setMapVisibilityCustomized(true)
    setVisibleGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) {
        next.delete(group)
      } else {
        next.add(group)
      }
      return next
    })
  }

  const handleShare = async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Planner map link copied')
    } catch {
      toast.error('Could not copy the planner map link')
    }
  }

  const handleAddToTrip = async (destinationId: string) => {
    const candidate =
      selectedSearchItem ??
      (placeDetailQuery.data
        ? {
            kind: 'saved' as const,
            id: placeDetailQuery.data.place.id,
            placeId: placeDetailQuery.data.place.id,
            name: placeDetailQuery.data.place.name,
            addressText: placeDetailQuery.data.place.address_text,
            category: placeDetailQuery.data.place.category,
            lat: placeDetailQuery.data.place.lat,
            lon: placeDetailQuery.data.place.lon,
            metadata: placeDetailQuery.data.place.metadata,
          }
        : null)

    const destination = recommendations.destinations.find((item) => item.id === destinationId)
    if (!candidate || !destination) {
      return
    }

    setAddingToTrip(true)
    try {
      let placeId = candidate.placeId

      if (!placeId && candidate.kind === 'google') {
        const createdPlace = await createPlaceMutation.mutateAsync({
          data: {
            source: 'google_places',
            external_id: candidate.id,
            name: candidate.name,
            category: candidate.category,
            address_text: candidate.addressText,
            lat: candidate.lat,
            lon: candidate.lon,
            metadata: candidate.metadata,
          },
          idempotencyKey: crypto.randomUUID(),
        })
        placeId = createdPlace.id
      }

      const createdActivity = await createPlannerActivity(
        tripId,
        {
          trip_day_id: destination.tripDayId,
          category: inferActivityCategory(candidate),
          title: candidate.name,
          place_id: placeId,
          description: candidate.addressText,
          source: 'manual',
        },
        crypto.randomUUID(),
      )

      await queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
      onSelectActivityId(createdActivity.id)
      onSelectPlaceId(placeId)
      setSelectedSearchItem(null)
      setDetailOpen(true)
      toast.success(
        destination.tripDayId
          ? `Place added to ${destination.shortLabel}`
          : 'Place added to inbox',
      )
    } catch {
      toast.error('Could not add this place to the itinerary')
    } finally {
      setAddingToTrip(false)
    }
  }

  const handleToggleActivityVisited = async (activityId: string, currentVisitedAt: string | null) => {
    const newVisitedAt = currentVisitedAt ? null : new Date().toISOString()
    const prevData = queryClient.getQueryData<PlannerResponse>(plannerKeys.detail(tripId))
    if (prevData) {
      queryClient.setQueryData(
        plannerKeys.detail(tripId),
        applyOptimisticVisited(prevData, activityId, newVisitedAt),
      )
    }
    try {
      await patchActivity(activityId, { visited_at: newVisitedAt })
      void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
      void queryClient.invalidateQueries({ queryKey: ['planner-map', tripId] })
    } catch {
      if (prevData) queryClient.setQueryData(plannerKeys.detail(tripId), prevData)
    }
  }

  const handleToggleVisited = async () => {
    const targetActivityId =
      selectedStop?.activity.id ??
      (placeDetailQuery.data?.related_activities.length === 1
        ? placeDetailQuery.data.related_activities[0].activity_id
        : null)
    if (!targetActivityId) return

    const currentVisitedAt =
      selectedStop?.activity.visited_at ??
      (placeDetailQuery.data?.related_activities.length === 1
        ? placeDetailQuery.data.related_activities[0].visited_at
        : null)

    const newVisitedAt = currentVisitedAt ? null : new Date().toISOString()

    // Optimistic update for immediate UI feedback
    const prevData = queryClient.getQueryData<PlannerResponse>(plannerKeys.detail(tripId))
    if (prevData) {
      queryClient.setQueryData(
        plannerKeys.detail(tripId),
        applyOptimisticVisited(prevData, targetActivityId, newVisitedAt),
      )
    }

    setTogglingVisited(true)
    try {
      await patchActivity(targetActivityId, { visited_at: newVisitedAt })
      void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
      void queryClient.invalidateQueries({ queryKey: ['planner-map', tripId] })
      toast.success(currentVisitedAt ? 'Visited state removed' : 'Marked as visited')
    } catch {
      if (prevData) queryClient.setQueryData(plannerKeys.detail(tripId), prevData)
      toast.error('Could not update the visited state')
    } finally {
      setTogglingVisited(false)
    }
  }

  const handlePreviewOptimize = async (section: PlannerMapSection) => {
    const markerStops = section.stops.filter((stop) => stop.markerNumber != null)
    if (markerStops.length < 3 || markerStops.length > 12) {
      toast.error('Optimisation works best on days with 3 to 12 mapped stops')
      return
    }

    setOptimizingDayId(section.dayId)
    try {
      const estimatePayload = {
        legs: markerStops.flatMap((origin) =>
          markerStops.flatMap((destination) => {
            if (origin.activity.id === destination.activity.id) {
              return []
            }
            if (
              origin.lat == null ||
              origin.lon == null ||
              destination.lat == null ||
              destination.lon == null
            ) {
              return []
            }
            return [
              {
                from_activity_id: origin.activity.id,
                to_activity_id: destination.activity.id,
                origin: { lat: origin.lat, lng: origin.lon },
                destination: { lat: destination.lat, lng: destination.lon },
              },
            ]
          }),
        ),
        travel_mode: travelMode,
      }

      const result = await estimateRouteLegs(estimatePayload)
      const markerOrder = optimizePlannerDayStops(section, result.items, travelMode)
      const fullOrder = buildApplyPreviewOrder(section, markerOrder)
      const previewActivities = orderedSectionActivities(section, fullOrder)
      setPreviewByDayId((current) => ({
        ...current,
        [section.dayId]: {
          order: fullOrder,
          metrics: buildPlannerMapMetricsForActivities(previewActivities, result.items, travelMode),
        },
      }))
      toast.success('Optimised preview ready')
    } catch {
      toast.error('Could not compute an optimized order for this day')
    } finally {
      setOptimizingDayId(null)
    }
  }

  const handleApplyPreview = async (section: PlannerMapSection) => {
    const preview = previewByDayId[section.dayId]
    if (!preview?.order.length) {
      return
    }

    const fullDay = days.find((day) => day.id === section.dayId)
    if (!fullDay) {
      return
    }

    const mergedActivities = mergeBucketActivityOrder(
      fullDay.activities,
      'main',
      preview.order,
    )

    try {
      await reorderActivities(
        section.dayId,
        {
          items: mergedActivities.map((activity, index) => ({
            activity_id: activity.id,
            order_index: index,
          })),
        },
        tripVersion,
      )
      await queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
      setPreviewByDayId((current) => ({ ...current, [section.dayId]: null }))
      toast.success('Optimized order applied')
    } catch {
      toast.error('Could not apply the optimized order')
    }
  }

  const handleCancelPreview = (dayId: string) => {
    setPreviewByDayId((current) => ({ ...current, [dayId]: null }))
  }

  const openExistingSelection = () => {
    const activityId =
      selectedStop?.activity.id ?? placeDetailQuery.data?.related_activities[0]?.activity_id ?? null
    if (!activityId) {
      return
    }
    const stop = stopByActivityId.get(activityId)
    if (!stop) {
      return
    }
    handleStopSelection(stop)
  }

  const selectedSection = selectedStop
    ? sections.find((section) => section.dayId === selectedStop.dayId) ?? null
    : null
  const selectedDayLabel = selectedSection
    ? selectedSection.dayId === 'inbox'
      ? 'Inbox'
      : selectedSection.title
    : null
  const detailSelectionKey =
    selectedStop?.activity.id ??
    selectedSearchItem?.id ??
    selectedDetailPlaceId ??
    selectedRecommendation?.item.id ??
    ''

  const detailPanelTitle =
    selectedRecommendation?.item.title ??
    activeSelectionTitle(selectedStop, selectedSearchItem, resolvedDetail)
  const detailPanelDescription =
    selectedRecommendation?.item.address_text ??
    activeSelectionSubtitle(selectedStop, selectedSearchItem, resolvedDetail) ??
    'Map place detail'
  const detailPanelContent = selectedRecommendation ? (
    <PlannerRecommendationDetailPanel
      tripId={tripId}
      locale={recommendations.preferences.regional.locale}
      entry={selectedRecommendation}
      recommendations={recommendations}
      onBack={() => onSelectRecommendation(null)}
      onClose={clearSelection}
    />
  ) : hasPlaceSelection ? (
    <DetailSheetContent
      tripId={tripId}
      detail={resolvedDetail}
      fallbackItem={selectedSearchItem}
      selectedStop={selectedStop}
      selectedCountLabel={null}
      destinations={recommendations.destinations}
      onAddToTrip={(destinationId) => void handleAddToTrip(destinationId)}
      onOpenExisting={openExistingSelection}
      onToggleVisited={() => void handleToggleVisited()}
      isTogglingVisited={togglingVisited}
      isAdding={addingToTrip}
      preferredTab={preferredDetailTab}
      onTabChange={setPreferredDetailTab}
      compact={!isMobile}
      isDetailLoading={placeDetailQuery.isLoading || googlePlaceDetailQuery.isLoading}
      onClose={clearSelection}
      dayLabel={selectedDayLabel}
      onEditActivity={onEditActivity}
      onDeleteActivity={onDeleteActivity}
    />
  ) : null
  const budgetOverview = buildBudgetOverview(trip, allPlannerActivities)
  const tripBudgetAmount = asFiniteNumber(trip.budget_amount)
  const plannedSpendAmount = asFiniteNumber(budgetOverview.comparableSpend)
  const budgetSummary = tripBudgetAmount != null ? (
    <>
      <AnimatedMoney value={tripBudgetAmount} currency={trip.budget_currency} /> target
      {plannedSpendAmount != null ? (
        <>
          {' '}
          <span aria-hidden="true">·</span>{' '}
          <AnimatedMoney
            value={plannedSpendAmount}
            currency={budgetOverview.comparableCurrency}
          />{' '}
          planned
        </>
      ) : null}
    </>
  ) : plannedSpendAmount != null ? (
    <>
      <AnimatedMoney
        value={plannedSpendAmount}
        currency={budgetOverview.comparableCurrency}
      />{' '}
      planned
    </>
  ) : 'No trip budget yet'
  const recommendationSummary = recommendations.enabled
    ? (
        <>
          <AnimatedNumber value={recommendations.discoverEntries.length} />{' '}
          suggestion{recommendations.discoverEntries.length === 1 ? '' : 's'}
        </>
      )
    : 'Unavailable'
  const fileSummary = tripAssets.length
    ? (
        <>
          <AnimatedNumber value={tripAssets.length} /> upload{tripAssets.length === 1 ? '' : 's'}
        </>
      )
    : 'No uploads yet'

  return (
    <TooltipProvider delayDuration={120}>
      <div className="grid h-full min-h-0 gap-0 overflow-hidden lg:grid-cols-[minmax(380px,0.46fr)_minmax(0,0.54fr)]">
        <div className={cn('min-h-0 min-w-0 flex-col', mobilePlannerView === 'map' ? 'hidden lg:flex' : 'flex')}>
          <div data-planner-scroll className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex flex-col gap-3 p-2 pb-8">
              <PlannerTripHeroCard trip={trip} coverPhotoUrl={heroPhotoUrl} tripId={tripId} onOpenCollaboration={onOpenCollaboration} />

              <div className="px-1 pt-1">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Logistics
                </p>
              </div>

              <Accordion
                type="multiple"
                value={railSections}
                onValueChange={handleRailSectionsChange}
                className="flex flex-col gap-2"
              >
                <PlannerStandaloneActivitySection
                  bucket="travel"
                  groups={travelGroups}
                  isDragActive={dragActive}
                  stopByActivityId={stopByActivityId}
                  selectedStop={selectedStop}
                  onSelectStop={handleStopSelection}
                  onAddActivity={onAddActivity}
                  onToggleVisited={handleToggleActivityVisited}
                />

                <PlannerStandaloneActivitySection
                  bucket="accommodation"
                  groups={accommodationGroups}
                  isDragActive={dragActive}
                  stopByActivityId={stopByActivityId}
                  selectedStop={selectedStop}
                  onSelectStop={handleStopSelection}
                  onAddActivity={onAddActivity}
                  onToggleVisited={handleToggleActivityVisited}
                />
              </Accordion>

              <div className="px-1 pt-1" data-planner-section="itinerary">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Itinerary
                </p>
              </div>

              <Accordion
                type="multiple"
                value={railSections}
                onValueChange={handleRailSectionsChange}
                className="flex flex-col gap-2"
              >
                <AccordionItem
                  value="recommendations"
                  className="overflow-hidden rounded-[20px] border border-black/8 bg-white px-3.5 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.18)]"
                  data-testid="planner-recommendations-section"
                >
                  <Carousel className="w-full">
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <PlannerSidebarSectionTrigger
                        icon={<Compass className="h-4 w-4" />}
                        title="Recommendations"
                        summary={recommendationSummary}
                        actions={
                          recommendations.enabled &&
                          railSections.includes('recommendations') && (
                            <div className="flex items-center gap-1">
                              <CompactRefreshButton recommendations={recommendations} />
                              <CompactCarouselActions />
                            </div>
                          )
                        }
                      />
                    </AccordionTrigger>
                    <AccordionContent className="pb-3.5 pt-0">
                      <PlannerRecommendationsCompactSection recommendations={recommendations} />
                    </AccordionContent>
                  </Carousel>
                </AccordionItem>
              </Accordion>

              <Accordion
                type="multiple"
                value={expandedDayIds}
                onValueChange={(nextExpandedDayIds) =>
                  setMapDayAccordionState(
                    tripId,
                    expandedDayIdsToAccordionState(nextExpandedDayIds, sectionDayIds),
                  )
                }
                className="flex flex-col gap-2"
              >
                {itinerarySections.map((section) => {
                  const metrics = dayMetrics[section.dayId]
                  const preview = previewByDayId[section.dayId]

                  return (
                    <PlannerMapDayAccordion
                      key={section.id}
                      section={section}
                      metrics={metrics}
                      preview={preview}
                      travelMode={travelMode}
                      isSelected={selectedSection?.dayId === section.dayId}
                      isDragActive={dragActive}
                      selectedStop={selectedStop}
                      optimizing={optimizingDayId === section.dayId}
                      onSelectStop={handleStopSelection}
                      onAddActivity={onAddActivity}
                      onPreviewOptimize={() => void handlePreviewOptimize(section)}
                      onApplyPreview={() => void handleApplyPreview(section)}
                      onCancelPreview={() => handleCancelPreview(section.dayId)}
                      onToggleVisited={handleToggleActivityVisited}
                    />
                  )
                })}
              </Accordion>

              <div className="px-1 pt-1">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Overview
                </p>
              </div>

              <Accordion
                type="multiple"
                value={railSections}
                onValueChange={handleRailSectionsChange}
                className="flex flex-col gap-2"
              >
                <AccordionItem
                  value="budget"
                  className="overflow-hidden rounded-[20px] border border-black/8 bg-white px-3.5 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.18)]"
                  data-testid="planner-budget-section"
                >
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <PlannerSidebarSectionTrigger
                      icon={<Receipt className="h-4 w-4" />}
                      title="Budget"
                      summary={budgetSummary}
                    />
                  </AccordionTrigger>
                  <AccordionContent className="pb-3.5 pt-0">
                    <PlannerBudgetOverview trip={trip} activities={allPlannerActivities} />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem
                  value="files"
                  className="overflow-hidden rounded-[20px] border border-black/8 bg-white px-3.5 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.18)]"
                  data-testid="planner-files-section"
                >
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <PlannerSidebarSectionTrigger
                      icon={<FileText className="h-4 w-4" />}
                      title="Files"
                      summary={fileSummary}
                    />
                  </AccordionTrigger>
                  <AccordionContent className="pb-3.5 pt-0">
                    <TripAssetManager
                      tripId={tripId}
                      title="Files"
                      description="Tickets, confirmations, scans, and quick references."
                      className="border-0 bg-transparent p-0 shadow-none"
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </div>

        <section
          ref={mapContainerRef}
          className={cn(
            'relative min-h-0 overflow-hidden lg:border-l border-black/8 bg-[var(--color-secondary-surface)] shadow-[0_28px_80px_-40px_rgba(15,23,42,0.28)]',
            mobilePlannerView === 'cards'
              ? 'hidden lg:block'
              : '',
          )}
          data-testid="planner-map-container"
        >
        {!config.map.apiKey ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <MapPin className="h-8 w-8 text-[var(--color-text-muted)]" />
            <h3 className="mt-4 text-lg font-semibold text-[var(--color-text)]">Map unavailable</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-text-muted)]">
              Set `VITE_GOOGLE_MAPS_API_KEY` to render the redesigned planner map experience.
            </p>
          </div>
        ) : (
          <GoogleMapCanvas
            defaultCenter={{ lat: viewport.latitude, lng: viewport.longitude }}
            defaultZoom={viewport.zoom}
            style={{ width: '100%', height: '100%' }}
            disableDefaultUI={false}
            streetViewControl={false}
            mapTypeControl={false}
            fullscreenControl={false}
            onClick={handleMapPoiSelection}
            onCameraChanged={(event) => {
              setViewport({
                latitude: event.detail.center.lat,
                longitude: event.detail.center.lng,
                zoom: event.detail.zoom,
              })
            }}
          >
            <TripMapLayerRenderer layers={tripLayers} />

            {routeSections.map(({ section, routeStops }) => {
              const isPrimaryRoute = section.dayId === primaryRouteSection?.dayId
              return (
                <GoogleDirectionsRoute
                  key={section.dayId}
                  origin={{
                    lat: routeStops[0].lat!,
                    lng: routeStops[0].lon!,
                  }}
                  destination={{
                    lat: routeStops[routeStops.length - 1].lat!,
                    lng: routeStops[routeStops.length - 1].lon!,
                  }}
                  waypoints={routeStops
                    .slice(1, -1)
                    .map((stop) => ({ lat: stop.lat!, lng: stop.lon! }))}
                  travelMode={travelMode}
                  computeAlternatives={false}
                  strokeColor={section.color}
                  strokeOpacity={isPrimaryRoute ? 0.92 : 0.58}
                  strokeWeight={isPrimaryRoute ? 5 : 4}
                />
              )
            })}

            {selectedTravelOverlayPath.length > 0 ? (
              <MapFitBounds
                points={selectedTravelOverlayPath}
                padding={selectedTravelOverlayPadding}
                maxZoom={selectedTravelOverlay?.mode === 'flight' ? 7 : 10}
                singlePointZoom={11}
              />
            ) : (
              <MapPanTo point={currentMapFocus?.point ?? null} zoom={currentMapFocus?.zoom} />
            )}

            {visibleTravelOverlays.map((overlay) => {
              const [origin, destination] = overlay.points
              const overlayStop = stopByActivityId.get(overlay.activity.id) ?? null
              const modeLabel = plannerTravelModeLabel(overlay.mode)
              const color = travelOverlayColor(overlay.mode)
              const isSelected = selectedActivityId === overlay.activity.id
              const overlayClick = overlayStop
                ? () => handleStopSelection(overlayStop)
                : () => handleTravelOverlaySelection(overlay.activity)
              const ModeIcon = travelOverlayIcon(overlay.mode)

              if (!origin || !destination) {
                return null
              }

              return (
                <Fragment key={`travel-overlay-${overlay.activity.id}`}>
                  <GooglePolyline
                    path={overlay.routePath}
                    strokeColor="#FFFFFF"
                    strokeOpacity={isSelected ? 0.92 : 0.8}
                    strokeWeight={isSelected ? 7 : 5}
                    zIndex={isSelected ? 4 : 2}
                  />
                  <GooglePolyline
                    path={overlay.routePath}
                    strokeColor={color}
                    strokeOpacity={isSelected ? 0.94 : 0.72}
                    strokeWeight={isSelected ? 3.2 : 2.35}
                    zIndex={isSelected ? 5 : 3}
                  />
                  <VoyagerMarker
                    position={{ lat: origin.lat, lng: origin.lon }}
                    title={`${modeLabel} origin · ${overlay.activity.title}`}
                    color={color}
                    selected={isSelected}
                    zIndex={isSelected ? 6 : 4}
                    onClick={overlayClick}
                  >
                    <PlannerMapPin
                      label={
                        <div className="flex items-center gap-[1px]">
                          <ModeIcon className="size-2.5 opacity-90" fill="currentColor" fillOpacity={0.5} />
                          <span>A</span>
                        </div>
                      }
                      color={color}
                      selected={isSelected}
                    />
                  </VoyagerMarker>
                  <VoyagerMarker
                    position={{ lat: destination.lat, lng: destination.lon }}
                    title={`${modeLabel} destination · ${overlay.activity.title}`}
                    color={color}
                    selected={isSelected}
                    zIndex={isSelected ? 6 : 4}
                    onClick={overlayClick}
                  >
                    <PlannerMapPin
                      label={
                        <div className="flex items-center gap-[1px]">
                          <ModeIcon className="size-2.5 opacity-90" fill="currentColor" fillOpacity={0.5} />
                          <span>B</span>
                        </div>
                      }
                      color={color}
                      selected={isSelected}
                    />
                  </VoyagerMarker>
                </Fragment>
              )
            })}

            {visibleStops.map((stop) => (
              <VoyagerMarker
                key={stop.activity.id}
                position={{ lat: stop.lat!, lng: stop.lon! }}
                title={stop.activity.title}
                color={stop.color}
                selected={selectedStop?.activity.id === stop.activity.id}
                zIndex={selectedStop?.activity.id === stop.activity.id ? 4 : 2}
                onClick={() => handleStopSelection(stop)}
              >
                <PlannerMapPin
                  label={stop.isHotel ? <BedDouble className="h-4 w-4" fill="currentColor" fillOpacity={0.5} /> : String(stop.markerNumber ?? '•')}
                  color={stop.color}
                  selected={selectedStop?.activity.id === stop.activity.id}
                  visited={Boolean(stop.activity.visited_at)}
                />
              </VoyagerMarker>
            ))}

            {selectedSearchItem?.lat != null && selectedSearchItem.lon != null ? (
              <VoyagerMarker
                position={{ lat: selectedSearchItem.lat, lng: selectedSearchItem.lon }}
                title={selectedSearchItem.name}
                color="#6B7280"
                selected
                zIndex={5}
                onClick={() => setDetailOpen(true)}
              >
                <PlannerMapPin label={<MapPin className="h-4 w-4" />} color="#6B7280" selected />
              </VoyagerMarker>
            ) : null}

            {recommendations.enabled
              ? mapRecommendationEntries.map((entry) => (
                  <VoyagerMarker
                    key={entry.key}
                    position={{ lat: entry.item.lat!, lng: entry.item.lon! }}
                    title={entry.item.title}
                    color={entry.source === 'saved_fit' ? '#F97316' : '#7C5AE0'}
                    selected={selectedRecommendation?.key === entry.key}
                    zIndex={selectedRecommendation?.key === entry.key ? 5 : 1}
                    onClick={() => handleRecommendationSelection(entry)}
                  >
                    <PlannerMapPin
                      label={entry.source === 'saved_fit' ? 'S' : 'R'}
                      color={entry.source === 'saved_fit' ? '#F97316' : '#7C5AE0'}
                      selected={selectedRecommendation?.key === entry.key}
                    />
                  </VoyagerMarker>
                ))
              : null}

            <VoyagerMapControl position={ControlPosition.TOP_LEFT}>
              <div className="pointer-events-auto relative z-[5] m-4 flex flex-wrap items-center gap-2">
                <ExportMenu
                  tripId={tripId}
                  tripVersion={tripVersion}
                  trigger={
                    <button
                      type="button"
                      className={FLOATING_ICON_BUTTON_CLASS}
                      aria-label="Export"
                      title="Export"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  }
                />
              </div>
            </VoyagerMapControl>

            <VoyagerMapControl position={ControlPosition.TOP_RIGHT}>
              <div className="pointer-events-auto relative z-[5] m-4 flex flex-col items-end gap-2">
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <FloatingPopoverIconTrigger
                      icon={<Search className="h-4 w-4" />}
                      label="Search"
                      dataTestId="planner-map-search-trigger"
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={10}
                    className="w-[360px] rounded-[24px] border-black/8 p-4 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.3)]"
                  >
                    <div className="space-y-3">
                      <div className="rounded-[18px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
                          <input
                            value={searchText}
                            onChange={(event) =>
                              startTransition(() => {
                                setActiveQuickCategory(null)
                                setSearchText(event.target.value)
                              })
                            }
                            placeholder="Search a place"
                            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)]"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_CATEGORIES.map((category) => (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => {
                              setActiveQuickCategory(category)
                              setSearchText(category.query)
                            }}
                            className={cn(
                              'rounded-full px-3 py-2 text-[0.76rem] font-medium',
                              activeQuickCategory?.id === category.id
                                ? 'bg-[var(--color-text)] text-white'
                                : 'bg-[var(--color-secondary-surface)] text-[var(--color-text)]',
                            )}
                          >
                            {category.label}
                          </button>
                        ))}
                      </div>
                      <ScrollArea className="max-h-[22rem]">
                        <SearchResultList
                          items={allSearchResults}
                          onSelect={handleSearchSelection}
                        />
                      </ScrollArea>
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover open={layersOpen} onOpenChange={setLayersOpen}>
                  <PopoverTrigger asChild>
                    <FloatingPopoverIconTrigger
                      icon={<Layers3 className="h-4 w-4" />}
                      label="Layers"
                      dataTestId="planner-map-layers-trigger"
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={10}
                    className="w-[290px] rounded-[20px] border-black/8 p-3 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.3)]"
                  >
                    <div className="space-y-4 py-1">
                      <div>
                        <p className="px-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                          Categories
                        </p>
                        <div className="mt-1 space-y-0.5">
                          {([
                            ['visit', 'Visits', Landmark],
                            ['eat', 'Eat', Utensils],
                            ['activity', 'Activities', Sparkles],
                            ['hotel', 'Hotels', BedDouble],
                            ['travel', 'Travel', Route],
                          ] as const).map(([key, label, Icon]) => (
                            <label key={key} className="group flex cursor-pointer items-center justify-between rounded-lg px-2 py-2.5 hover:bg-black/4 transition-colors">
                              <span className="flex items-center gap-3 text-[0.9rem] font-medium text-[var(--color-text)]">
                                <Icon className="h-[18px] w-[18px] text-[var(--color-text-muted)]" />
                                {label}
                              </span>
                              <Checkbox
                                checked={visibleGroups.has(key)}
                                onCheckedChange={() => toggleVisibleGroup(key)}
                              />
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="px-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                          Routes
                        </p>
                        <div className="mt-1 space-y-0.5">
                          <label className="group flex cursor-pointer items-center justify-between rounded-lg px-2 py-2.5 hover:bg-black/4 transition-colors">
                            <span className="text-[0.9rem] font-medium text-[var(--color-text)]">Route lines</span>
                            <Checkbox
                              checked={showRoutes}
                              onCheckedChange={(checked) => {
                                setMapVisibilityCustomized(true)
                                setShowRoutes(Boolean(checked))
                              }}
                            />
                          </label>
                          <label className="group flex cursor-pointer items-center justify-between rounded-lg px-2 py-2.5 hover:bg-black/4 transition-colors">
                            <span className="text-[0.9rem] font-medium text-[var(--color-text)]">Custom layers</span>
                            <Checkbox
                              checked={showCustomLayers}
                              onCheckedChange={(checked) => {
                                setMapVisibilityCustomized(true)
                                setShowCustomLayers(Boolean(checked))
                              }}
                            />
                          </label>
                          {sections.map((section) => (
                            <label key={section.dayId} className="group flex cursor-pointer items-center justify-between rounded-lg px-2 py-2.5 hover:bg-black/4 transition-colors">
                              <span className="flex items-center gap-3 text-[0.9rem] font-medium text-[var(--color-text)]">
                                <div className="flex h-[18px] w-[18px] items-center justify-center">
                                  <span
                                    className="h-3 w-3 rounded-full"
                                    style={{ backgroundColor: section.color }}
                                  />
                                </div>
                                {section.title}
                              </span>
                              <Checkbox
                                checked={visibleDayIds.has(section.dayId)}
                                onCheckedChange={() => toggleVisibleDay(section.dayId)}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                {recommendations.enabled &&
                recommendationsDismissed &&
                !hasPlaceSelection &&
                !selectedRecommendation &&
                isMobile ? (
                  <FloatingIconButton
                    icon={<Compass className="h-4 w-4" />}
                    label="Recommendations"
                    onClick={() => {
                      setRecommendationsDismissed(false)
                      setDetailOpen(true)
                    }}
                    isMobile={isMobile}
                  />
                ) : null}
              </div>
            </VoyagerMapControl>

            {selectedSection ? (
              <VoyagerMapControl position={ControlPosition.BOTTOM_LEFT}>
                <div className="pointer-events-auto relative z-[5] m-4 inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/94 px-4 py-3 text-sm shadow-[0_20px_44px_-20px_rgba(32,56,83,0.38)] backdrop-blur">
                  <CalendarDays className="h-4 w-4 text-[var(--color-text-muted)]" />
                  <span>{selectedSection.title}</span>
                  {dayProgressLabel(selectedSection, selectedStop) ? (
                    <span className="text-[var(--color-text-muted)]">{dayProgressLabel(selectedSection, selectedStop)}</span>
                  ) : null}
                </div>
              </VoyagerMapControl>
            ) : null}
          </GoogleMapCanvas>
        )}

        {selectedSection && selectedSection.dayId !== 'inbox' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void handlePreviewOptimize(selectedSection)}
                className="absolute bottom-5 right-5 flex h-16 w-16 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff8c62,#7c5ae0)] text-white shadow-[0_28px_60px_-20px_rgba(124,90,224,0.6)]"
                aria-label="Optimise itinerary"
              >
                <Sparkles className="h-6 w-6" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Optimise itinerary</TooltipContent>
          </Tooltip>
        ) : null}

        <AnimatePresence>
          {!isMobile && detailOpen && hasActiveSelection ? (
            <div className="pointer-events-none absolute inset-0 z-[6] flex flex-col justify-end px-3 pb-3">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-[rgba(243,245,247,0.55)] via-[rgba(243,245,247,0.14)] to-transparent" />
              <motion.div
                ref={detailSheetRef}
                key={detailSelectionKey}
                role="dialog"
                aria-modal="false"
                aria-labelledby="planner-map-detail-title"
                aria-describedby="planner-map-detail-description"
                data-testid="planner-map-detail-sheet"
                className="pointer-events-auto relative flex h-[min(60%,34rem)] w-full max-w-240 flex-col overflow-hidden rounded-[28px] border border-black/8 bg-[#F3F5F7] shadow-[0_32px_92px_-40px_rgba(15,23,42,0.42)]"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <div className="sr-only">
                  <h2 id="planner-map-detail-title">{detailPanelTitle}</h2>
                  <p id="planner-map-detail-description">{detailPanelDescription}</p>
                </div>
                {detailPanelContent}
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>
      </section>

      <Sheet
        open={detailOpen && showRecommendationSheet}
        onOpenChange={(open) => {
          setDetailOpen(open)
          if (!open) {
            setRecommendationsDismissed(true)
            clearSelection()
          }
        }}
      >
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          hideCloseButton
          className={
            isMobile
              ? 'flex h-[82dvh] flex-col overflow-hidden rounded-t-[24px] border-x-0 border-b-0 bg-[#F3F5F7] p-0 sm:max-w-none'
              : 'flex h-full w-full max-w-[28rem] flex-col overflow-hidden bg-[#F3F5F7] p-0 sm:max-w-[28rem]'
          }
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Recommendations</SheetTitle>
            <SheetDescription>Map recommendations</SheetDescription>
          </SheetHeader>
          <PlannerRecommendationsPanel
            recommendations={recommendations}
            showCloseButton
          />
        </SheetContent>
      </Sheet>

      {isMobile ? (
        <Sheet
          open={detailOpen && hasActiveSelection}
          onOpenChange={(open) => {
            setDetailOpen(open)
            if (!open) {
              clearSelection()
            }
          }}
        >
          <SheetContent
            side="bottom"
            hideCloseButton
            data-testid="planner-map-detail-sheet"
            className="flex h-[82dvh] flex-col overflow-hidden rounded-t-[28px] border-x-0 border-b-0 bg-[#F3F5F7] p-0 sm:max-w-none"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{detailPanelTitle}</SheetTitle>
              <SheetDescription>{detailPanelDescription}</SheetDescription>
            </SheetHeader>
            {detailPanelContent}
          </SheetContent>
        </Sheet>
      ) : null}
      </div>
    </TooltipProvider>
  )
}

// ─── Standalone drawer that reuses DetailSheetContent for the board layout ───

export function ActivityMapDetailSheet({
  open,
  tripId,
  activity,
  dayLabel,
  onClose,
  onEdit,
  onDelete,
}: {
  open: boolean
  tripId: string
  activity: PlannerActivity | null
  dayLabel: string | null
  onClose: () => void
  onEdit?: (activity: PlannerActivity) => void
  onDelete?: (activityId: string) => void
}) {
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()

  const [preferredTab, setPreferredTab] = useState('about')

  const placeId = activity?.place_id ?? null

  const savedPlaceQuery = usePlace(placeId)
  const placeDetailQuery = usePlannerMapPlaceDetail(tripId, placeId)
  const googlePlaceId = resolveGooglePlaceId(savedPlaceQuery.data)
  const googlePlaceDetailQuery = useGooglePlaceDetail(googlePlaceId)

  const resolvedDetail = useMemo(
    () => mergePlaceDetail(placeDetailQuery.data, googlePlaceDetailQuery.data),
    [placeDetailQuery.data, googlePlaceDetailQuery.data],
  )

  const stop = useMemo((): PlannerMapStop | null => {
    if (!activity) return null
    const primary = plannerPrimaryPlace(activity)
    return {
      activity,
      dayId: activity.trip_day_id ?? 'inbox',
      dayIndex: -1,
      color: PLANNER_MAP_DAY_COLORS[0],
      markerNumber: null,
      isHotel: activity.category === 'hotel',
      lat: primary?.lat ?? null,
      lon: primary?.lon ?? null,
    }
  }, [activity])

  const isTogglingVisitedRef = useRef(false)
  const [isTogglingVisited, setIsTogglingVisited] = useState(false)

  async function handleToggleVisited() {
    if (!activity || isTogglingVisitedRef.current) return
    isTogglingVisitedRef.current = true
    setIsTogglingVisited(true)
    const newVisitedAt = activity.visited_at ? null : new Date().toISOString()

    // Optimistic update for immediate UI feedback
    const prevData = queryClient.getQueryData<PlannerResponse>(plannerKeys.detail(tripId))
    if (prevData) {
      queryClient.setQueryData(
        plannerKeys.detail(tripId),
        applyOptimisticVisited(prevData, activity.id, newVisitedAt),
      )
    }

    try {
      await patchActivity(activity.id, { visited_at: newVisitedAt })
      void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
      void queryClient.invalidateQueries({ queryKey: ['planner-map', tripId] })
    } catch {
      if (prevData) queryClient.setQueryData(plannerKeys.detail(tripId), prevData)
    } finally {
      isTogglingVisitedRef.current = false
      setIsTogglingVisited(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        hideCloseButton
        className={
          isMobile
            ? 'flex h-[82dvh] flex-col overflow-hidden rounded-t-[28px] border-x-0 border-b-0 bg-[#F3F5F7] p-0 sm:max-w-none'
            : 'flex h-full w-full max-w-[28rem] flex-col overflow-hidden bg-[#F3F5F7] p-0 sm:max-w-[28rem]'
        }
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{activity?.title ?? 'Activity'}</SheetTitle>
          <SheetDescription>Activity details</SheetDescription>
        </SheetHeader>
        {activity ? (
          <DetailSheetContent
            tripId={tripId}
            detail={resolvedDetail}
            fallbackItem={null}
            selectedStop={stop}
            selectedCountLabel={null}
            destinations={[]}
            onAddToTrip={() => {}}
            onOpenExisting={() => {}}
            onToggleVisited={handleToggleVisited}
            isTogglingVisited={isTogglingVisited}
            isAdding={false}
            isDetailLoading={placeDetailQuery.isLoading || googlePlaceDetailQuery.isLoading}
            preferredTab={preferredTab}
            onTabChange={setPreferredTab}
            onClose={onClose}
            dayLabel={dayLabel}
            onEditActivity={onEdit}
            onDeleteActivity={onDelete}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
