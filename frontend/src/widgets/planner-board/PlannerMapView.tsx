import { config } from '@/app/config';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { AnimatedMoney, AnimatedNumber } from '@/components/ui/animated-number';
import { Badge } from '@/components/ui/badge';
import { Carousel } from '@/components/ui/carousel';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { createPlannerActivity, patchActivity, reorderActivities } from '@/entities/activity/api';
import { getGooglePlace } from '@/entities/place/api';
import {
  placeKeys,
  useCreatePlace,
  useGooglePlaceDetail,
  useGooglePlaceSearch,
  usePlace,
  usePlaceSearch,
} from '@/entities/place/queries';
import { usePlannerMapPlaceDetail } from '@/entities/planner-map/queries';
import { plannerKeys } from '@/entities/planner/queries';
import { estimateRouteLegs } from '@/entities/routes/api';
import { useRouteLegEstimates } from '@/entities/routes/queries';
import { useTripAssets } from '@/entities/trip-asset/queries';
import { useTripCoverPhotoManager } from '@/entities/trip/useTripCoverPhotoManager';
import type {
  PlannerActivity,
  PlannerDay,
  PlannerResponse,
  RouteTravelMode,
  Trip,
} from '@/shared/api/types';
import { useIsMobile } from '@/shared/hooks/use-mobile';
import {
  ControlPosition,
  GoogleDirectionsRoute,
  GooglePolyline,
  MapFitBounds,
  MapPanTo,
  VoyagerMap,
  VoyagerMapControl,
  VoyagerMarker,
  type LatLngPoint,
} from '@/shared/layouts/google-maps';
import { cn } from '@/shared/lib/cn';
import { usePlannerStore } from '@/shared/stores/planner.store';
import { useSideRailStore } from '@/shared/stores/side-rail.store';
import TripAssetManager from '@/widgets/trip-assets';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { MapMouseEvent } from '@vis.gl/react-google-maps';
import {
  BedDouble,
  CalendarDays,
  Compass,
  Download,
  FileText,
  Landmark,
  Layers3,
  MapPin,
  Receipt,
  Route,
  Search,
  Sparkles,
  Utensils,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  forwardRef,
  Fragment,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { ExportMenu } from './ExportMenu';
import {
  DetailSheetContent,
  inferActivityCategory,
  isRecommendationSearchItem,
  mergePlaceDetail,
  recommendationCoordinates,
  resolveGooglePlaceId,
  toGoogleSearchItem,
  toRecommendationSearchItem,
  toSavedSearchItem,
  type ResolvedPlaceDetail,
  type SearchResultItem,
} from './PlaceDetailSheetContent';
import {
  buildApplyPreviewOrder,
  dayProgressLabel,
  PlannerMapDayAccordion,
  PlannerMapPin,
  PlannerSidebarSectionTrigger,
  PlannerStandaloneActivitySection,
} from './PlannerMapActivitySections';
import {
  CompactCarouselActions,
  CompactRefreshButton,
  PlannerRecommendationsCompactSection,
  PlannerRecommendationsPanel,
} from './PlannerRecommendations';
import { PlannerBudgetOverview, PlannerTripHeroCard } from './PlannerTripHeroCard';
import {
  filterPlannerActivitiesByBucket,
  filterPlannerDaysByBucket,
  mergeBucketActivityOrder,
} from './activity-buckets';
import {
  plannerCategoryDescription,
  plannerPrimaryPlace,
  plannerTravelModeLabel,
} from './categories';
import {
  buildPlannerMapDayMetrics,
  buildPlannerMapLegPayload,
  buildPlannerMapMetricsForActivities,
  buildPlannerMapSections,
  filterVisibleStops,
  optimizePlannerDayStops,
  PLANNER_MAP_DAY_COLORS,
  type PlannerMapLayerGroup,
  type PlannerMapSection,
  type PlannerMapStop,
} from './planner-map-utils';
import {
  applyOptimisticVisited,
  asFiniteNumber,
  buildBudgetOverview,
  buildStandaloneActivityGroups,
} from './planner-map-view.utils';
import {
  buildPlannerTravelOverlays,
  travelOverlayColor,
  travelOverlayIcon,
} from './planner-travel-overlays';
import type {
  PlannerRecommendationEntry,
  PlannerRecommendationsController,
} from './usePlannerRecommendations';

interface Props {
  trip: Trip;
  tripId: string;
  tripVersion: number;
  travelMode?: RouteTravelMode;
  days: PlannerDay[];
  inboxActivities: PlannerActivity[];
  initialMapCenter?: LatLngPoint | null;
  isDragActive?: boolean;
  selectedActivityId: string | null;
  selectedPlaceId: string | null;
  recommendations: PlannerRecommendationsController;
  selectedRecommendation: PlannerRecommendationEntry | null;
  onAddActivity: (dayId: string | null, defaultCategory?: PlannerActivity['category']) => void;
  onSelectActivityId: (activityId: string | null) => void;
  onSelectPlaceId: (placeId: string | null) => void;
  onSelectRecommendation: (entry: PlannerRecommendationEntry | null) => void;
  onClearMapSelection: () => void;
  onEditActivity?: (activity: PlannerActivity) => void;
  onDeleteActivity?: (activityId: string) => void;
  onRegisterSectionOpener?: (opener: (sectionKey: string) => void) => void;
  onOpenCollaboration?: () => void;
  onOpenGeneration?: () => void;
  assistantSuggestedPlace?: PlannerAssistantSuggestedPlace | null;
  onAssistantSuggestedPlaceHandled?: () => void;
}

export type PlannerAssistantSuggestedPlace = {
  placeId: string;
  name: string;
  addressText: string | null;
  category: string | null;
  lat: number | null;
  lon: number | null;
};

type QuickCategory = {
  id: string;
  label: string;
  query: string;
  category?: string;
};

type PlannerPreviewState = {
  order: string[];
  metrics: ReturnType<typeof buildPlannerMapMetricsForActivities>;
};

const FLOATING_ICON_BUTTON_CLASS =
  'pointer-events-auto inline-flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full border border-white/70 bg-white/92 text-[var(--color-text)] backdrop-blur transition-colors hover:bg-white shadow-sm hover:shadow-md';
const RECOMMENDATION_MARKER_COLOR = '#00C978';
const SAVED_RECOMMENDATION_MARKER_COLOR = '#FFA200';
const PLANNER_RAIL_SECTIONS_STORAGE_KEY_PREFIX = 'planner-rail-sections';

const QUICK_CATEGORIES: QuickCategory[] = [
  { id: 'food', label: 'Food', query: 'restaurants', category: 'restaurant' },
  {
    id: 'sights',
    label: 'Attractions',
    query: 'tourist attractions',
    category: 'tourist_attraction',
  },
  { id: 'gas', label: 'Gas', query: 'gas station', category: 'gas_station' },
  {
    id: 'ev',
    label: 'EV',
    query: 'electric vehicle charging station',
    category: 'electric_vehicle_charging_station',
  },
  { id: 'rest', label: 'Rest', query: 'rest stop', category: 'rest_stop' },
];

function areDayAccordionStatesEqual(
  left: Record<string, boolean>,
  right: Record<string, boolean>,
  sectionDayIds: string[],
) {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    sectionDayIds.every((dayId) => left[dayId] === right[dayId])
  );
}

export function reconcileDayAccordionState(
  currentDayAccordionState: Record<string, boolean> | undefined,
  sectionDayIds: string[],
) {
  return Object.fromEntries(
    sectionDayIds.map((dayId) => [dayId, currentDayAccordionState?.[dayId] ?? false]),
  ) as Record<string, boolean>;
}

function accordionStateToExpandedDayIds(
  dayAccordionState: Record<string, boolean>,
  sectionDayIds: string[],
) {
  return sectionDayIds.filter((dayId) => dayAccordionState[dayId]);
}

function expandedDayIdsToAccordionState(expandedDayIds: string[], sectionDayIds: string[]) {
  const expandedDayIdSet = new Set(expandedDayIds);
  return Object.fromEntries(
    sectionDayIds.map((dayId) => [dayId, expandedDayIdSet.has(dayId)]),
  ) as Record<string, boolean>;
}

function getPlannerRailSectionsStorageKey(tripId: string) {
  return `${PLANNER_RAIL_SECTIONS_STORAGE_KEY_PREFIX}:${tripId}`;
}

function readPlannerRailSections(tripId: string) {
  try {
    const stored = localStorage.getItem(getPlannerRailSectionsStorageKey(tripId));
    return stored ? (JSON.parse(stored) as string[]) : [];
  } catch {
    return [];
  }
}

function persistPlannerRailSections(tripId: string, sectionKeys: string[]) {
  try {
    localStorage.setItem(getPlannerRailSectionsStorageKey(tripId), JSON.stringify(sectionKeys));
  } catch {}
}

function applyPreviewOrder(activities: PlannerActivity[], previewOrder: string[]) {
  return mergeBucketActivityOrder(activities, 'main', previewOrder).map((activity, index) => ({
    ...activity,
    order_index: index,
  }));
}

function applyOptimisticVisitedUpdate(
  queryClient: QueryClient,
  tripId: string,
  activityId: string,
  visitedAt: string | null,
) {
  const previousPlanner = queryClient.getQueryData<PlannerResponse>(plannerKeys.detail(tripId));
  if (previousPlanner) {
    queryClient.setQueryData(
      plannerKeys.detail(tripId),
      applyOptimisticVisited(previousPlanner, activityId, visitedAt),
    );
  }
  return previousPlanner;
}

function restorePlannerData(
  queryClient: QueryClient,
  tripId: string,
  plannerData: PlannerResponse | undefined,
) {
  if (plannerData) {
    queryClient.setQueryData(plannerKeys.detail(tripId), plannerData);
  }
}

function invalidatePlannerQueries(queryClient: QueryClient, tripId: string) {
  void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
  void queryClient.invalidateQueries({ queryKey: ['planner-map', tripId] });
}

function activeSelectionTitle(
  selectedStop: PlannerMapStop | null,
  selectedSearchItem: SearchResultItem | null,
  detail: ResolvedPlaceDetail | null | undefined,
) {
  return (
    selectedStop?.activity.title ?? selectedSearchItem?.name ?? detail?.place.name ?? 'Map details'
  );
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
  );
}

function SearchResultList({
  items,
  onSelect,
}: {
  items: SearchResultItem[];
  onSelect: (item: SearchResultItem) => void;
}) {
  if (!items.length) {
    return (
      <p className="rounded-[16px] border border-dashed border-[var(--color-border)] px-4 py-6 text-sm text-[var(--color-text-muted)]">
        No places matched this search near the current map area.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button
          key={String(item.id)}
          className="group relative flex w-full cursor-pointer items-start gap-4 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-secondary-surface)]"
          onClick={() => onSelect(item)}
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
  );
}

function FloatingIconButton({
  icon,
  label,
  onClick,
  isMobile,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  isMobile: boolean;
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
  );

  if (isMobile) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const FloatingPopoverIconTrigger = forwardRef<
  HTMLButtonElement,
  {
    icon: ReactNode;
    label: string;
    dataTestId?: string;
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
  );
});

export function PlannerMapView({
  trip,
  tripId,
  tripVersion,
  travelMode = 'WALK',
  days,
  inboxActivities,
  initialMapCenter = null,
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
  onOpenGeneration,
  assistantSuggestedPlace = null,
  onAssistantSuggestedPlaceHandled,
}: Props) {
  const isMobile = useIsMobile();
  const { mobilePlannerView } = useSideRailStore();
  const dragActive = Boolean(isDragActive);
  const queryClient = useQueryClient();
  const createPlaceMutation = useCreatePlace();
  const [railSections, setRailSections] = useState<string[]>(() => readPlannerRailSections(tripId));
  const handleRailSectionsChange = (next: string[]) => {
    setRailSections(next);
    persistPlannerRailSections(tripId, next);
  };
  useEffect(() => {
    onRegisterSectionOpener?.((sectionKey) => {
      setRailSections((prev) => {
        if (prev.includes(sectionKey)) return prev;
        const next = [...prev, sectionKey];
        persistPlannerRailSections(tripId, next);
        return next;
      });
    });
  }, [onRegisterSectionOpener, tripId]);
  const previewByDayId = usePlannerStore((s) => s.previewByDayId);

  const previewAwareDays = useMemo(() => {
    return days.map((day) => {
      const preview = previewByDayId[day.id];
      if (!preview?.order.length) return day;

      return {
        ...day,
        activities: applyPreviewOrder(day.activities, preview.order),
      };
    });
  }, [days, previewByDayId]);

  const previewAwareInbox = useMemo(() => {
    const preview = previewByDayId['inbox'];
    if (!preview?.order.length) return inboxActivities;

    return applyPreviewOrder(inboxActivities, preview.order);
  }, [inboxActivities, previewByDayId]);

  const sections = useMemo(
    () => buildPlannerMapSections(previewAwareDays, previewAwareInbox),
    [previewAwareDays, previewAwareInbox],
  );

  const itinerarySections = useMemo(
    () =>
      buildPlannerMapSections(
        filterPlannerDaysByBucket(previewAwareDays, 'main'),
        filterPlannerActivitiesByBucket(previewAwareInbox, 'main'),
      ),
    [previewAwareDays, previewAwareInbox],
  );
  const itineraryAccommodationByDayId = useMemo(() => {
    const allAccommodationActivities = [
      ...inboxActivities,
      ...days.flatMap((day) => day.activities),
    ].filter((activity) => activity.category === 'hotel');
    const uniqueAccommodationActivities = Array.from(
      new Map(allAccommodationActivities.map((activity) => [activity.id, activity])).values(),
    );
    const singleUnassignedAccommodation =
      uniqueAccommodationActivities.length === 1 &&
      uniqueAccommodationActivities[0]?.trip_day_id == null
        ? uniqueAccommodationActivities[0]
        : null;

    return Object.fromEntries(
      days.map((day) => {
        const dayAccommodationFromActivities = [...day.activities]
          .sort((left, right) => left.order_index - right.order_index)
          .find((activity) => activity.category === 'hotel');
        const dayAccommodationFromGlobal = uniqueAccommodationActivities.find(
          (activity) => activity.trip_day_id === day.id,
        );

        return [
          day.id,
          dayAccommodationFromActivities ??
            dayAccommodationFromGlobal ??
            singleUnassignedAccommodation ??
            null,
        ] as const;
      }),
    );
  }, [days, inboxActivities]);
  const accommodationGroups = useMemo(
    () => buildStandaloneActivityGroups(days, inboxActivities, 'accommodation'),
    [days, inboxActivities],
  );
  const travelGroups = useMemo(
    () => buildStandaloneActivityGroups(days, inboxActivities, 'travel'),
    [days, inboxActivities],
  );
  const allPlannerActivities = useMemo(
    () => [...inboxActivities, ...days.flatMap((day) => day.activities)],
    [days, inboxActivities],
  );
  const { data: tripAssetsData } = useTripAssets(tripId, null);
  const tripAssets = tripAssetsData?.items ?? [];
  const { coverPhotoUrl: heroPhotoUrl, coverPlace: destinationCoverPlace } =
    useTripCoverPhotoManager(tripId, trip);
  const stopByActivityId = useMemo(
    () =>
      new Map(
        sections.flatMap((section) =>
          section.stops.map((stop) => [stop.activity.id, stop] as const),
        ),
      ),
    [sections],
  );
  const initialVisibleDayIds = useMemo(
    () => new Set(sections.map((section) => section.dayId)),
    [sections],
  );
  const [visibleDayIds, setVisibleDayIds] = useState<Set<string>>(initialVisibleDayIds);
  const [visibleGroups, setVisibleGroups] = useState<Set<PlannerMapLayerGroup>>(
    new Set(['visit', 'eat', 'activity', 'hotel', 'travel', 'recommendation']),
  );
  const [isPlannerStoreHydrated, setIsPlannerStoreHydrated] = useState(() =>
    usePlannerStore.persist.hasHydrated(),
  );
  const storedDayAccordionState = usePlannerStore(
    (state) => state.mapDayAccordionStateByTrip[tripId],
  );
  const setMapDayAccordionState = usePlannerStore((state) => state.setMapDayAccordionState);
  const [showRoutes, setShowRoutes] = useState(recommendations.preferences.map.showRoutesByDefault);

  const [mapVisibilityCustomized, setMapVisibilityCustomized] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [activeQuickCategory, setActiveQuickCategory] = useState<QuickCategory | null>(null);
  const [selectedSearchItem, setSelectedSearchItem] = useState<SearchResultItem | null>(null);
  const handledAssistantSuggestedPlaceRef = useRef<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const mapContainerRef = useRef<HTMLElement | null>(null);
  const detailSheetRef = useRef<HTMLDivElement | null>(null);
  const [detailSheetOverlap, setDetailSheetOverlap] = useState(0);
  const [recommendationsDismissed, setRecommendationsDismissed] = useState(true);
  const [preferredDetailTab, setPreferredDetailTab] = useState('about');
  const [addingToTrip, setAddingToTrip] = useState(false);
  const [togglingVisited, setTogglingVisited] = useState(false);
  const [optimizingDayId, setOptimizingDayId] = useState<string | null>(null);
  const setPreviewByDayId = usePlannerStore((s) => s.setPreviewByDayId);
  const deferredSearchText = useDeferredValue(searchText);
  const [viewport, setViewport] = useState(() => {
    const firstStop = sections
      .flatMap((section) => section.stops)
      .find((stop) => stop.lat != null && stop.lon != null);
    const defaultCenter =
      initialMapCenter ??
      (firstStop?.lat != null && firstStop.lon != null
        ? { lat: firstStop.lat, lng: firstStop.lon }
        : null);
    return {
      latitude: defaultCenter?.lat ?? 48.8566,
      longitude: defaultCenter?.lng ?? 2.3522,
      zoom: initialMapCenter ? 13 : 12,
    };
  });
  const routeLegPayload = useMemo(
    () => buildPlannerMapLegPayload(itinerarySections, travelMode, itineraryAccommodationByDayId),
    [itinerarySections, travelMode, itineraryAccommodationByDayId],
  );
  const routeLegEstimates = useRouteLegEstimates(routeLegPayload);
  const dayMetrics = useMemo(
    () =>
      buildPlannerMapDayMetrics(
        itinerarySections,
        routeLegEstimates.data?.items ?? [],
        travelMode,
        itineraryAccommodationByDayId,
      ),
    [itinerarySections, routeLegEstimates.data?.items, travelMode, itineraryAccommodationByDayId],
  );
  const sectionDayIds = useMemo(
    () => itinerarySections.map((section) => section.dayId),
    [itinerarySections],
  );
  const dayAccordionState = useMemo(
    () => reconcileDayAccordionState(storedDayAccordionState, sectionDayIds),
    [sectionDayIds, storedDayAccordionState],
  );
  const expandedDayIds = useMemo(
    () => accordionStateToExpandedDayIds(dayAccordionState, sectionDayIds),
    [dayAccordionState, sectionDayIds],
  );
  const selectedStop = selectedActivityId
    ? (stopByActivityId.get(selectedActivityId) ?? null)
    : null;
  const selectedDetailPlaceId =
    selectedStop?.activity.place_id ??
    (selectedSearchItem?.kind === 'saved' ? selectedSearchItem.placeId : null) ??
    selectedPlaceId ??
    null;
  const savedPlaceQuery = usePlace(selectedDetailPlaceId);
  const placeDetailQuery = usePlannerMapPlaceDetail(tripId, selectedDetailPlaceId);
  const selectedGooglePlaceId =
    selectedSearchItem?.kind === 'google'
      ? selectedSearchItem.id
      : resolveGooglePlaceId(savedPlaceQuery.data);
  const selectedRecommendationCoordinates = useMemo(
    () => recommendationCoordinates(selectedRecommendation),
    [selectedRecommendation],
  );
  const googlePlaceDetailQuery = useGooglePlaceDetail(selectedGooglePlaceId);
  const searchOrigin = useMemo(() => {
    if (selectedStop?.lat != null && selectedStop.lon != null) {
      return {
        lat: selectedStop.lat,
        lon: selectedStop.lon,
      };
    }
    if (selectedRecommendationCoordinates) {
      return {
        lat: selectedRecommendationCoordinates.lat,
        lon: selectedRecommendationCoordinates.lon,
      };
    }
    if (selectedSearchItem?.lat != null && selectedSearchItem.lon != null) {
      return {
        lat: selectedSearchItem.lat,
        lon: selectedSearchItem.lon,
      };
    }
    if (savedPlaceQuery.data?.lat != null && savedPlaceQuery.data.lon != null) {
      return {
        lat: savedPlaceQuery.data.lat,
        lon: savedPlaceQuery.data.lon,
      };
    }
    if (placeDetailQuery.data?.place.lat != null && placeDetailQuery.data.place.lon != null) {
      return {
        lat: placeDetailQuery.data.place.lat,
        lon: placeDetailQuery.data.place.lon,
      };
    }
    if (
      googlePlaceDetailQuery.data?.place.lat != null &&
      googlePlaceDetailQuery.data.place.lon != null
    ) {
      return {
        lat: googlePlaceDetailQuery.data.place.lat,
        lon: googlePlaceDetailQuery.data.place.lon,
      };
    }
    if (destinationCoverPlace?.lat != null && destinationCoverPlace.lon != null) {
      return {
        lat: destinationCoverPlace.lat,
        lon: destinationCoverPlace.lon,
      };
    }
    if (initialMapCenter) {
      return {
        lat: initialMapCenter.lat,
        lon: initialMapCenter.lng,
      };
    }
    return {
      lat: viewport.latitude,
      lon: viewport.longitude,
    };
  }, [
    googlePlaceDetailQuery.data?.place.lat,
    googlePlaceDetailQuery.data?.place.lon,
    destinationCoverPlace?.lat,
    destinationCoverPlace?.lon,
    initialMapCenter,
    placeDetailQuery.data?.place.lat,
    placeDetailQuery.data?.place.lon,
    savedPlaceQuery.data?.lat,
    savedPlaceQuery.data?.lon,
    selectedRecommendationCoordinates,
    selectedSearchItem?.lat,
    selectedSearchItem?.lon,
    selectedStop?.lat,
    selectedStop?.lon,
    viewport.latitude,
    viewport.longitude,
  ]);
  const localSearchQuery = usePlaceSearch(
    { q: deferredSearchText.trim(), limit: 6, offset: 0 },
    deferredSearchText.trim().length >= 2,
  );
  const googleSearchQuery = useGooglePlaceSearch(
    {
      q: deferredSearchText.trim() || activeQuickCategory?.query,
      limit: 6,
      offset: 0,
      lat: searchOrigin.lat,
      lon: searchOrigin.lon,
      radius_m: 6000,
      category: activeQuickCategory?.category,
    },
    Boolean((deferredSearchText.trim().length >= 2 || activeQuickCategory) && config.map.apiKey),
  );
  const resolvedDetail = useMemo(
    () => mergePlaceDetail(placeDetailQuery.data, googlePlaceDetailQuery.data),
    [googlePlaceDetailQuery.data, placeDetailQuery.data],
  );

  const allTravelOverlays = useMemo(
    () => buildPlannerTravelOverlays(days, inboxActivities),
    [days, inboxActivities],
  );
  const selectedTravelOverlay = useMemo(
    () =>
      selectedActivityId
        ? (allTravelOverlays.find((overlay) => overlay.activity.id === selectedActivityId) ?? null)
        : null,
    [allTravelOverlays, selectedActivityId],
  );
  const selectedTravelOverlayPath = selectedTravelOverlay?.routePath ?? [];
  const visibleStops = useMemo(
    () => filterVisibleStops(sections, visibleDayIds, visibleGroups),
    [sections, visibleDayIds, visibleGroups],
  );
  const visibleTravelOverlays = useMemo(
    () =>
      visibleGroups.has('travel')
        ? allTravelOverlays.filter((overlay) => visibleDayIds.has(overlay.dayId))
        : [],
    [allTravelOverlays, visibleDayIds, visibleGroups],
  );
  const mapRecommendationEntries = useMemo(() => {
    if (!visibleGroups.has('recommendation')) {
      return [];
    }

    const seen = new Set<string>();
    return recommendations.discoverEntries
      .filter((entry) => recommendationCoordinates(entry) != null)
      .filter((entry) => {
        const key = `${entry.item.provider}:${entry.item.provider_ref}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, 12);
  }, [recommendations.discoverEntries, visibleGroups]);
  const allSearchResults = useMemo(() => {
    const localItems = (localSearchQuery.data?.items ?? []).map(toSavedSearchItem);
    const googleItems = (googleSearchQuery.data?.items ?? []).map(toGoogleSearchItem);
    const seen = new Set(
      googleItems.map((item) => `${item.name.toLowerCase()}:${item.addressText ?? ''}`),
    );
    return [
      ...googleItems,
      ...localItems.filter(
        (item) => !seen.has(`${item.name.toLowerCase()}:${item.addressText ?? ''}`),
      ),
    ];
  }, [googleSearchQuery.data?.items, localSearchQuery.data?.items]);

  useEffect(() => {
    setVisibleDayIds(initialVisibleDayIds);
  }, [initialVisibleDayIds]);

  useEffect(() => {
    const unsubscribeHydrate = usePlannerStore.persist.onHydrate(() => {
      setIsPlannerStoreHydrated(false);
    });
    const unsubscribeFinishHydration = usePlannerStore.persist.onFinishHydration(() => {
      setIsPlannerStoreHydrated(true);
    });

    setIsPlannerStoreHydrated(usePlannerStore.persist.hasHydrated());

    return () => {
      unsubscribeHydrate();
      unsubscribeFinishHydration();
    };
  }, []);

  useEffect(() => {
    if (mapVisibilityCustomized) {
      return;
    }

    setShowRoutes(recommendations.preferences.map.showRoutesByDefault);
  }, [mapVisibilityCustomized, recommendations.preferences.map.showRoutesByDefault]);

  useEffect(() => {
    if (!isPlannerStoreHydrated) {
      return;
    }
    if (
      storedDayAccordionState &&
      areDayAccordionStatesEqual(storedDayAccordionState, dayAccordionState, sectionDayIds)
    ) {
      return;
    }
    setMapDayAccordionState(tripId, dayAccordionState);
  }, [
    dayAccordionState,
    isPlannerStoreHydrated,
    sectionDayIds,
    setMapDayAccordionState,
    storedDayAccordionState,
    tripId,
  ]);

  useEffect(() => {
    if (selectedActivityId) {
      setDetailOpen(true);
      return;
    }
    if (selectedPlaceId) {
      const matchingStop = sections
        .flatMap((section) => section.stops)
        .find((stop) => stop.activity.place_id === selectedPlaceId);
      if (matchingStop) {
        onSelectActivityId(matchingStop.activity.id);
        return;
      }
    }
    if (selectedSearchItem) {
      setDetailOpen(true);
    }
    if (selectedRecommendation) {
      setDetailOpen(true);
      return;
    }
    if (
      isMobile &&
      recommendations.enabled &&
      !selectedActivityId &&
      !selectedPlaceId &&
      !selectedSearchItem &&
      !recommendationsDismissed
    ) {
      setDetailOpen(true);
    }
  }, [
    isMobile,
    onSelectActivityId,
    recommendations.enabled,
    recommendationsDismissed,
    sections,
    selectedActivityId,
    selectedPlaceId,
    selectedRecommendation,
    selectedSearchItem,
  ]);

  const activeRouteSections = useMemo(
    () =>
      itinerarySections.filter((section) => {
        if (!visibleDayIds.has(section.dayId) || !showRoutes) {
          return false;
        }
        return section.stops.filter((stop) => stop.markerNumber != null).length >= 2;
      }),
    [itinerarySections, showRoutes, visibleDayIds],
  );
  const primaryRouteSection = useMemo(() => {
    if (selectedStop) {
      return (
        activeRouteSections.find((section) => section.dayId === selectedStop.dayId) ??
        activeRouteSections[0] ??
        null
      );
    }
    return activeRouteSections[0] ?? null;
  }, [activeRouteSections, selectedStop]);
  const routeSections = useMemo(
    () =>
      activeRouteSections
        .map((section) => ({
          section,
          routeStops: section.stops.filter(
            (stop) => stop.markerNumber != null && stop.lat != null && stop.lon != null,
          ),
        }))
        .filter(({ routeStops }) => routeStops.length >= 2),
    [activeRouteSections],
  );

  const detailPanelLatitudeOffset = isMobile ? 0 : -0.018;

  const currentMapFocus = useMemo(() => {
    function withOffset(lat: number, lng: number) {
      return { lat: lat + detailPanelLatitudeOffset, lng };
    }

    if (selectedStop?.lat != null && selectedStop.lon != null) {
      return {
        point: withOffset(selectedStop.lat, selectedStop.lon),
        zoom: 13,
      };
    }
    if (selectedRecommendationCoordinates) {
      return {
        point: withOffset(
          selectedRecommendationCoordinates.lat,
          selectedRecommendationCoordinates.lon,
        ),
        zoom: 13,
      };
    }
    if (selectedSearchItem?.lat != null && selectedSearchItem.lon != null) {
      return {
        point: withOffset(selectedSearchItem.lat, selectedSearchItem.lon),
        zoom: 13,
      };
    }
    if (savedPlaceQuery.data?.lat != null && savedPlaceQuery.data.lon != null) {
      return {
        point: withOffset(savedPlaceQuery.data.lat, savedPlaceQuery.data.lon),
        zoom: 13,
      };
    }
    if (destinationCoverPlace?.lat != null && destinationCoverPlace.lon != null) {
      return {
        point: withOffset(destinationCoverPlace.lat, destinationCoverPlace.lon),
        zoom: 13,
      };
    }
    if (initialMapCenter) {
      return {
        point: withOffset(initialMapCenter.lat, initialMapCenter.lng),
        zoom: 13,
      };
    }
    if (placeDetailQuery.data?.place.lat != null && placeDetailQuery.data.place.lon != null) {
      return {
        point: withOffset(placeDetailQuery.data.place.lat, placeDetailQuery.data.place.lon),
        zoom: 13,
      };
    }
    if (
      googlePlaceDetailQuery.data?.place.lat != null &&
      googlePlaceDetailQuery.data.place.lon != null
    ) {
      return {
        point: withOffset(
          googlePlaceDetailQuery.data.place.lat,
          googlePlaceDetailQuery.data.place.lon,
        ),
        zoom: 13,
      };
    }
    return null;
  }, [
    detailPanelLatitudeOffset,
    destinationCoverPlace?.lat,
    destinationCoverPlace?.lon,
    initialMapCenter,
    googlePlaceDetailQuery.data?.place.lat,
    googlePlaceDetailQuery.data?.place.lon,
    savedPlaceQuery.data?.lat,
    savedPlaceQuery.data?.lon,
    placeDetailQuery.data?.place.lat,
    placeDetailQuery.data?.place.lon,
    selectedRecommendationCoordinates,
    selectedSearchItem?.lat,
    selectedSearchItem?.lon,
    selectedStop?.lat,
    selectedStop?.lon,
  ]);
  const hasPlaceSelection = Boolean(selectedStop || selectedSearchItem || selectedDetailPlaceId);
  const showRecommendationSheet =
    isMobile &&
    recommendations.enabled &&
    !hasPlaceSelection &&
    !selectedRecommendation &&
    !recommendationsDismissed;
  const hasActiveSelection = Boolean(
    selectedStop || selectedSearchItem || selectedDetailPlaceId || selectedRecommendation,
  );

  useEffect(() => {
    if (isMobile || !detailOpen || !hasActiveSelection) {
      setDetailSheetOverlap(0);
      return;
    }

    const measureDetailSheetOverlap = () => {
      const mapContainerRect = mapContainerRef.current?.getBoundingClientRect();
      const detailSheetRect = detailSheetRef.current?.getBoundingClientRect();
      if (!mapContainerRect || !detailSheetRect) {
        setDetailSheetOverlap(0);
        return;
      }

      const overlap = Math.max(
        0,
        Math.min(mapContainerRect.bottom, detailSheetRect.bottom) -
          Math.max(mapContainerRect.top, detailSheetRect.top),
      );

      setDetailSheetOverlap((current) => (Math.abs(current - overlap) < 1 ? current : overlap));
    };

    measureDetailSheetOverlap();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const resizeObserver = new ResizeObserver(measureDetailSheetOverlap);
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }
    if (detailSheetRef.current) {
      resizeObserver.observe(detailSheetRef.current);
    }
    window.addEventListener('resize', measureDetailSheetOverlap);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', measureDetailSheetOverlap);
    };
  }, [
    detailOpen,
    hasActiveSelection,
    isMobile,
    selectedActivityId,
    selectedDetailPlaceId,
    selectedRecommendation?.item.id,
    selectedSearchItem?.id,
  ]);

  const selectedTravelOverlayPadding = useMemo<google.maps.Padding>(
    () => ({
      top: 120,
      right: 84,
      bottom: Math.max(84, Math.round(detailSheetOverlap) + 32),
      left: 84,
    }),
    [detailSheetOverlap],
  );

  const clearSelection = () => {
    onClearMapSelection();
    onSelectRecommendation(null);
    setSelectedSearchItem(null);
    setDetailOpen(false);
    setPreferredDetailTab('about');
  };

  const handleStopSelection = (stop: PlannerMapStop) => {
    if (selectedActivityId === stop.activity.id) {
      clearSelection();
      return;
    }
    onSelectRecommendation(null);
    setSelectedSearchItem(null);
    onSelectActivityId(stop.activity.id);
    onSelectPlaceId(stop.activity.place_id);
    setPreferredDetailTab('about');
    setDetailOpen(true);
  };

  const handleTravelOverlaySelection = (activity: PlannerActivity) => {
    if (selectedActivityId === activity.id) {
      clearSelection();
      return;
    }

    onSelectRecommendation(null);
    setSelectedSearchItem(null);
    onSelectActivityId(activity.id);
    onSelectPlaceId(activity.place_id);
    setPreferredDetailTab('about');
    setDetailOpen(true);
  };

  const handleSearchSelection = (item: SearchResultItem) => {
    onSelectRecommendation(null);
    onClearMapSelection();
    onSelectPlaceId(item.placeId);
    setSelectedSearchItem(item);
    setPreferredDetailTab('about');
    setDetailOpen(true);
    setSearchOpen(false);
  };

  useEffect(() => {
    if (!assistantSuggestedPlace) {
      handledAssistantSuggestedPlaceRef.current = null;
      return;
    }

    const selectionKey = [
      assistantSuggestedPlace.placeId,
      assistantSuggestedPlace.lat ?? '',
      assistantSuggestedPlace.lon ?? '',
    ].join(':');

    if (handledAssistantSuggestedPlaceRef.current === selectionKey) {
      return;
    }

    handledAssistantSuggestedPlaceRef.current = selectionKey;
    onSelectRecommendation(null);
    onClearMapSelection();
    onSelectPlaceId(null);
    setSelectedSearchItem({
      kind: 'google',
      id: assistantSuggestedPlace.placeId,
      placeId: null,
      name: assistantSuggestedPlace.name,
      addressText: assistantSuggestedPlace.addressText,
      category: assistantSuggestedPlace.category,
      lat: assistantSuggestedPlace.lat,
      lon: assistantSuggestedPlace.lon,
      metadata: {},
    });
    setPreferredDetailTab('about');
    setDetailOpen(true);
    startTransition(() => {
      setSearchOpen(false);
    });
    onAssistantSuggestedPlaceHandled?.();
  }, [
    assistantSuggestedPlace,
    onAssistantSuggestedPlaceHandled,
    onClearMapSelection,
    onSelectPlaceId,
    onSelectRecommendation,
  ]);

  const handleRecommendationSelection = (entry: PlannerRecommendationEntry) => {
    if (selectedRecommendation?.key === entry.key) {
      clearSelection();
      return;
    }
    onClearMapSelection();
    onSelectPlaceId(null);
    setSelectedSearchItem(toRecommendationSearchItem(entry));
    onSelectRecommendation(entry);
    setRecommendationsDismissed(true);
    setSearchOpen(false);
    setPreferredDetailTab('about');
    setDetailOpen(true);
  };

  useEffect(() => {
    if (isMobile || !detailOpen || !hasActiveSelection) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      clearSelection();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection, detailOpen, hasActiveSelection, isMobile]);

  const handleMapPoiSelection = async (event: MapMouseEvent) => {
    const placeId = event.detail.placeId;
    if (!placeId) {
      return;
    }

    event.stop();
    setSearchOpen(false);
    setLayersOpen(false);
    onSelectRecommendation(null);
    onClearMapSelection();
    setPreferredDetailTab('about');
    setDetailOpen(true);

    try {
      const candidate = await queryClient.fetchQuery({
        queryKey: placeKeys.googleDetail(placeId),
        queryFn: () => getGooglePlace(placeId),
        staleTime: 5 * 60 * 1000,
      });
      setSelectedSearchItem(toGoogleSearchItem(candidate));
    } catch {
      const latLng = event.detail.latLng;
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
      });
    }
  };

  const toggleVisibleDay = (dayId: string) => {
    setVisibleDayIds((current) => {
      const next = new Set(current);
      if (next.has(dayId)) {
        next.delete(dayId);
      } else {
        next.add(dayId);
      }
      return next;
    });
  };

  const toggleVisibleGroup = (group: PlannerMapLayerGroup) => {
    setMapVisibilityCustomized(true);
    setVisibleGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const handleAddToTrip = async (destinationId: string) => {
    if (selectedRecommendation) {
      setAddingToTrip(true);
      try {
        const saved = await recommendations.addEntryToDestination(
          selectedRecommendation,
          destinationId,
        );
        if (saved) {
          clearSelection();
        }
      } finally {
        setAddingToTrip(false);
      }
      return;
    }

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
        : null);

    const destination = recommendations.destinations.find((item) => item.id === destinationId);
    if (!candidate || !destination) {
      return;
    }

    setAddingToTrip(true);
    try {
      let placeId = candidate.placeId;

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
        });
        placeId = createdPlace.id;
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
      );

      await queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
      onSelectActivityId(createdActivity.id);
      onSelectPlaceId(placeId);
      setSelectedSearchItem(null);
      setDetailOpen(true);
      toast.success(
        destination.tripDayId ? `Place added to ${destination.shortLabel}` : 'Place added to inbox',
      );
    } catch {
      toast.error('Could not add this place to the itinerary');
    } finally {
      setAddingToTrip(false);
    }
  };

  const handleToggleActivityVisited = async (
    activityId: string,
    currentVisitedAt: string | null,
  ) => {
    const newVisitedAt = currentVisitedAt ? null : new Date().toISOString();
    const prevData = queryClient.getQueryData<PlannerResponse>(plannerKeys.detail(tripId));
    if (prevData) {
      queryClient.setQueryData(
        plannerKeys.detail(tripId),
        applyOptimisticVisited(prevData, activityId, newVisitedAt),
      );
    }
    try {
      await patchActivity(activityId, { visited_at: newVisitedAt });
      void queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: ['planner-map', tripId] });
    } catch {
      if (prevData) queryClient.setQueryData(plannerKeys.detail(tripId), prevData);
    }
  };

  const handleToggleVisited = async () => {
    const relatedActivities = placeDetailQuery.data?.related_activities ?? [];
    const singleRelatedActivity =
      relatedActivities.length === 1 ? (relatedActivities[0] ?? null) : null;
    const targetActivityId =
      selectedStop?.activity.id ?? singleRelatedActivity?.activity_id ?? null;
    if (!targetActivityId) return;

    const currentVisitedAt =
      selectedStop?.activity.visited_at ?? singleRelatedActivity?.visited_at ?? null;

    const newVisitedAt = currentVisitedAt ? null : new Date().toISOString();
    const previousPlanner = applyOptimisticVisitedUpdate(
      queryClient,
      tripId,
      targetActivityId,
      newVisitedAt,
    );

    setTogglingVisited(true);
    try {
      await patchActivity(targetActivityId, { visited_at: newVisitedAt });
      invalidatePlannerQueries(queryClient, tripId);
      toast.success(currentVisitedAt ? 'Visited state removed' : 'Marked as visited');
    } catch {
      restorePlannerData(queryClient, tripId, previousPlanner);
      toast.error('Could not update the visited state');
    } finally {
      setTogglingVisited(false);
    }
  };

  const handlePreviewOptimize = async (section: PlannerMapSection) => {
    const markerStops = section.stops.filter((stop) => stop.markerNumber != null);
    if (markerStops.length < 3 || markerStops.length > 12) {
      toast.error('Optimisation works best on days with 3 to 12 mapped stops');
      return;
    }

    setOptimizingDayId(section.dayId);
    try {
      const estimatePayload = {
        legs: markerStops.flatMap((origin) =>
          markerStops.flatMap((destination) => {
            if (origin.activity.id === destination.activity.id) {
              return [];
            }
            if (
              origin.lat == null ||
              origin.lon == null ||
              destination.lat == null ||
              destination.lon == null
            ) {
              return [];
            }
            return [
              {
                from_activity_id: origin.activity.id,
                to_activity_id: destination.activity.id,
                origin: { lat: origin.lat, lng: origin.lon },
                destination: { lat: destination.lat, lng: destination.lon },
              },
            ];
          }),
        ),
        travel_mode: travelMode,
      };

      const result = await estimateRouteLegs(estimatePayload);
      const markerOrder = optimizePlannerDayStops(section, result.items, travelMode);
      const fullOrder = buildApplyPreviewOrder(section, markerOrder);
      const previewActivities = applyPreviewOrder(section.activities, fullOrder);
      setPreviewByDayId({
        ...previewByDayId,
        [section.dayId]: {
          order: fullOrder,
          metrics: buildPlannerMapMetricsForActivities(
            previewActivities,
            result.items,
            travelMode,
            itineraryAccommodationByDayId[section.dayId] ?? null,
          ),
        },
      });
      toast.success('Optimised preview ready');
    } catch {
      toast.error('Could not compute an optimized order for this day');
    } finally {
      setOptimizingDayId(null);
    }
  };

  const handleApplyPreview = async (section: PlannerMapSection) => {
    const preview = previewByDayId[section.dayId];
    if (!preview?.order.length) {
      return;
    }

    const fullDay = days.find((day) => day.id === section.dayId);
    if (!fullDay) {
      return;
    }

    const mergedActivities = mergeBucketActivityOrder(fullDay.activities, 'main', preview.order);

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
      );
      await queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
      setPreviewByDayId({ ...previewByDayId, [section.dayId]: null });
      toast.success('Optimized order applied');
    } catch {
      toast.error('Could not apply the optimized order');
    }
  };

  const handleCancelPreview = (dayId: string) => {
    setPreviewByDayId({ ...previewByDayId, [dayId]: null });
  };

  const selectedSection = selectedStop
    ? (sections.find((section) => section.dayId === selectedStop.dayId) ?? null)
    : null;
  const selectedDayLabel = selectedSection
    ? selectedSection.dayId === 'inbox'
      ? 'Inbox'
      : selectedSection.title
    : null;
  const detailSelectionKey =
    selectedStop?.activity.id ??
    selectedSearchItem?.id ??
    selectedDetailPlaceId ??
    selectedRecommendation?.item.id ??
    '';

  const detailPanelTitle = activeSelectionTitle(selectedStop, selectedSearchItem, resolvedDetail);
  const detailPanelDescription =
    activeSelectionSubtitle(selectedStop, selectedSearchItem, resolvedDetail) ?? 'Map place detail';
  const detailPanelContent = hasPlaceSelection ? (
    <DetailSheetContent
      tripId={tripId}
      detail={resolvedDetail}
      fallbackItem={selectedSearchItem}
      selectedStop={selectedStop}
      destinations={recommendations.destinations}
      onAddToTrip={(destinationId) => void handleAddToTrip(destinationId)}
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
  ) : null;
  const budgetOverview = buildBudgetOverview(trip, allPlannerActivities);
  const tripBudgetAmount = asFiniteNumber(trip.budget_amount);
  const plannedSpendAmount = asFiniteNumber(budgetOverview.comparableSpend);
  const budgetSummary =
    tripBudgetAmount != null ? (
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
        <AnimatedMoney value={plannedSpendAmount} currency={budgetOverview.comparableCurrency} />{' '}
        planned
      </>
    ) : (
      'No trip budget yet'
    );
  const recommendationSummary = recommendations.enabled ? (
    <>
      <AnimatedNumber value={recommendations.discoverEntries.length} /> suggestion
      {recommendations.discoverEntries.length === 1 ? '' : 's'}
    </>
  ) : (
    'Unavailable'
  );
  const fileSummary = tripAssets.length ? (
    <>
      <AnimatedNumber value={tripAssets.length} /> upload{tripAssets.length === 1 ? '' : 's'}
    </>
  ) : (
    'No uploads yet'
  );

  return (
    <TooltipProvider delayDuration={120}>
      <div className="grid h-full min-h-0 gap-0 overflow-hidden lg:grid-cols-[minmax(380px,500px)_minmax(0,1fr)]">
        <div
          className={cn(
            'min-h-0 min-w-0 flex-col bg-[#F3F5F7]',
            mobilePlannerView === 'map' ? 'hidden lg:flex' : 'flex',
          )}
        >
          <div
            data-planner-scroll
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="flex flex-col gap-3 p-2 pb-8">
              <PlannerTripHeroCard
                trip={trip}
                coverPhotoUrl={heroPhotoUrl}
                tripId={tripId}
                onOpenCollaboration={onOpenCollaboration}
                onOpenGeneration={onOpenGeneration}
              />

              <div className="px-1 pt-1">
                <p className="text-[0.72rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
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
                <p className="text-[0.72rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
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
                  className="overflow-hidden rounded-[20px] bg-white"
                  data-testid="planner-recommendations-section"
                >
                  <Carousel className="w-full">
                    <AccordionTrigger className="px-3.5 py-3 hover:no-underline">
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
                    <AccordionContent className="pt-0 pb-3.5">
                      <PlannerRecommendationsCompactSection
                        recommendations={recommendations}
                        onSelectEntry={handleRecommendationSelection}
                        selectedEntryKey={selectedRecommendation?.key ?? null}
                      />
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
                  const metrics = dayMetrics[section.dayId];
                  const preview = previewByDayId[section.dayId] as
                    | PlannerPreviewState
                    | null
                    | undefined;

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
                  );
                })}
              </Accordion>

              <div className="px-1 pt-1">
                <p className="text-[0.72rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)] uppercase">
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
                  className="overflow-hidden rounded-[20px] bg-white px-3.5"
                  data-testid="planner-budget-section"
                >
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <PlannerSidebarSectionTrigger
                      icon={<Receipt className="h-4 w-4" />}
                      title="Budget"
                      summary={budgetSummary}
                    />
                  </AccordionTrigger>
                  <AccordionContent className="pt-0 pb-3.5">
                    <PlannerBudgetOverview trip={trip} activities={allPlannerActivities} />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem
                  value="files"
                  className="overflow-hidden rounded-[20px] bg-white px-3.5"
                  data-testid="planner-files-section"
                >
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <PlannerSidebarSectionTrigger
                      icon={<FileText className="h-4 w-4" />}
                      title="Files"
                      summary={fileSummary}
                    />
                  </AccordionTrigger>
                  <AccordionContent className="pt-0 pb-3.5">
                    <TripAssetManager
                      tripId={tripId}
                      title="Files"
                      description="Tickets, confirmations, scans, and quick references."
                      className="border-0 bg-transparent p-0"
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
            'relative min-h-0 overflow-hidden border-[var(--color-border)] bg-[var(--color-secondary-surface)] lg:border-l',
            mobilePlannerView === 'cards' ? 'hidden lg:block' : '',
          )}
          data-testid="planner-map-container"
        >
          {!config.map.apiKey ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <MapPin className="h-8 w-8 text-[var(--color-text-muted)]" />
              <h3 className="mt-4 text-lg font-semibold text-[var(--color-text)]">
                Map unavailable
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-text-muted)]">
                Set `VITE_GOOGLE_MAPS_API_KEY` to render the redesigned planner map experience.
              </p>
            </div>
          ) : (
            <VoyagerMap
              reuseMaps={false}
              defaultCenter={{ lat: viewport.latitude, lng: viewport.longitude }}
              defaultZoom={viewport.zoom}
              minZoom={3}
              restriction={{
                latLngBounds: { north: 85, south: -85, west: -179.99, east: 179.99 },
                strictBounds: true,
              }}
              style={{ width: '100%', height: '100%' }}
              disableDefaultUI
              onClick={handleMapPoiSelection}
              onCameraChanged={(event) => {
                setViewport({
                  latitude: event.detail.center.lat,
                  longitude: event.detail.center.lng,
                  zoom: event.detail.zoom,
                });
              }}
            >
              {routeSections.map(({ section, routeStops }) => {
                const isPrimaryRoute = section.dayId === primaryRouteSection?.dayId;
                const originStop = routeStops[0];
                const destinationStop = routeStops[routeStops.length - 1];
                if (
                  !originStop ||
                  !destinationStop ||
                  originStop.lat == null ||
                  originStop.lon == null ||
                  destinationStop.lat == null ||
                  destinationStop.lon == null
                ) {
                  return null;
                }
                return (
                  <GoogleDirectionsRoute
                    key={section.dayId}
                    origin={{
                      lat: originStop.lat,
                      lng: originStop.lon,
                    }}
                    destination={{
                      lat: destinationStop.lat,
                      lng: destinationStop.lon,
                    }}
                    waypoints={routeStops
                      .slice(1, -1)
                      .flatMap((stop) =>
                        stop.lat != null && stop.lon != null
                          ? [{ lat: stop.lat, lng: stop.lon }]
                          : [],
                      )}
                    travelMode={travelMode}
                    computeAlternatives={false}
                    strokeColor={section.color}
                    strokeOpacity={isPrimaryRoute ? 0.92 : 0.58}
                    strokeWeight={isPrimaryRoute ? 5 : 4}
                  />
                );
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
                const [origin, destination] = overlay.points;
                const overlayStop = stopByActivityId.get(overlay.activity.id) ?? null;
                const modeLabel = plannerTravelModeLabel(overlay.mode);
                const color = travelOverlayColor(overlay.mode);
                const isSelected = selectedActivityId === overlay.activity.id;
                const overlayClick = overlayStop
                  ? () => handleStopSelection(overlayStop)
                  : () => handleTravelOverlaySelection(overlay.activity);
                const ModeIcon = travelOverlayIcon(overlay.mode);

                if (!origin || !destination) {
                  return null;
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
                            <ModeIcon
                              className="size-2.5 opacity-90"
                              fill="currentColor"
                              fillOpacity={0.5}
                            />
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
                            <ModeIcon
                              className="size-2.5 opacity-90"
                              fill="currentColor"
                              fillOpacity={0.5}
                            />
                            <span>B</span>
                          </div>
                        }
                        color={color}
                        selected={isSelected}
                      />
                    </VoyagerMarker>
                  </Fragment>
                );
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
                    label={
                      stop.isHotel ? (
                        <BedDouble className="h-4 w-4" fill="currentColor" fillOpacity={0.5} />
                      ) : (
                        String(stop.markerNumber ?? '•')
                      )
                    }
                    color={stop.color}
                    selected={selectedStop?.activity.id === stop.activity.id}
                    visited={Boolean(stop.activity.visited_at)}
                  />
                </VoyagerMarker>
              ))}

              {selectedSearchItem?.lat != null &&
              selectedSearchItem.lon != null &&
              !isRecommendationSearchItem(selectedSearchItem) ? (
                <VoyagerMarker
                  key={`search-result-${selectedSearchItem.id}-${selectedSearchItem.lat}-${selectedSearchItem.lon}`}
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
                      position={{
                        lat: recommendationCoordinates(entry)!.lat,
                        lng: recommendationCoordinates(entry)!.lon,
                      }}
                      title={entry.item.title}
                      color={
                        entry.source === 'saved_fit'
                          ? SAVED_RECOMMENDATION_MARKER_COLOR
                          : RECOMMENDATION_MARKER_COLOR
                      }
                      selected={selectedRecommendation?.key === entry.key}
                      zIndex={selectedRecommendation?.key === entry.key ? 5 : 1}
                      onClick={() => handleRecommendationSelection(entry)}
                    >
                      <PlannerMapPin
                        label={entry.source === 'saved_fit' ? 'S' : <Compass className="h-4 w-4" />}
                        color={
                          entry.source === 'saved_fit'
                            ? SAVED_RECOMMENDATION_MARKER_COLOR
                            : RECOMMENDATION_MARKER_COLOR
                        }
                        selected={selectedRecommendation?.key === entry.key}
                      />
                    </VoyagerMarker>
                  ))
                : null}

              {!isMobile && (
                <>
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
                            <Download className="h-5 w-5" />
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
                            icon={<Search className="h-5 w-5" />}
                            label="Search"
                            dataTestId="planner-map-search-trigger"
                          />
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          sideOffset={10}
                          className="w-[min(30rem,calc(100vw-1.25rem))]"
                        >
                          <div className="flex flex-col gap-2">
                            <div className="rounded-[16px] border border-[var(--color-border)] bg-[#FDFDFD] px-3.5 py-2.5">
                              <div className="flex items-center gap-2">
                                <Search className="h-5 w-5 opacity-70" />
                                <input
                                  value={searchText}
                                  onChange={(event) =>
                                    startTransition(() => {
                                      setActiveQuickCategory(null);
                                      setSearchText(event.target.value);
                                    })
                                  }
                                  placeholder="Search a place"
                                  className="w-full bg-transparent text-[0.93rem] outline-none placeholder:text-[var(--color-text-muted)]"
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {QUICK_CATEGORIES.map((category) => (
                                <button
                                  key={category.id}
                                  type="button"
                                  onClick={() => {
                                    setActiveQuickCategory(category);
                                    setSearchText(category.query);
                                  }}
                                  className={cn(
                                    'rounded-[14px] px-3.5 py-2 text-[0.85rem] font-medium transition-colors',
                                    activeQuickCategory?.id === category.id
                                      ? 'bg-[var(--color-text)] text-white'
                                      : 'bg-[rgba(23,23,23,0.06)] text-[var(--color-text)] hover:bg-[rgba(23,23,23,0.1)]',
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
                            icon={<Layers3 className="h-5 w-5" />}
                            label="Layers"
                            dataTestId="planner-map-layers-trigger"
                          />
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          sideOffset={10}
                          className="w-[min(22rem,calc(100vw-1.25rem))]"
                        >
                          <ScrollArea
                            viewportStyle={{
                              maxHeight:
                                'min(34rem, calc(var(--radix-popover-content-available-height) - 1rem))',
                            }}
                          >
                            <div className="flex flex-col gap-4">
                              <div className="flex flex-col gap-0.5">
                                <p className="px-2 py-1 text-[0.68rem] font-bold tracking-[0.16em] text-[var(--color-text-muted)] uppercase">
                                  Categories
                                </p>
                                <div className="mt-1 space-y-0.5">
                                  {(
                                    [
                                      ['visit', 'Visits', Landmark],
                                      ['eat', 'Eat', Utensils],
                                      ['activity', 'Activities', Sparkles],
                                      ['recommendation', 'Recommendations', Compass],
                                      ['hotel', 'Hotels', BedDouble],
                                      ['travel', 'Travel', Route],
                                    ] as const
                                  ).map(([key, label, Icon]) => (
                                    <label
                                      key={key}
                                      className="group flex cursor-pointer items-center justify-between gap-3 rounded-[16px] px-3 py-2.5 transition-colors select-none hover:bg-[var(--color-secondary-surface)]"
                                    >
                                      <span className="flex min-w-0 items-center gap-3 text-[0.9rem] font-medium text-[var(--color-text)]">
                                        <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 opacity-70" />
                                        <span className="truncate">{label}</span>
                                      </span>
                                      <Checkbox
                                        checked={visibleGroups.has(key)}
                                        onCheckedChange={() => toggleVisibleGroup(key)}
                                      />
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div className="flex flex-col gap-0.5">
                                <p className="px-2 py-1 text-[0.68rem] font-bold tracking-[0.16em] text-[var(--color-text-muted)] uppercase">
                                  Routes
                                </p>
                                <label className="group flex cursor-pointer items-center justify-between gap-3 rounded-[16px] px-3 py-2.5 transition-colors select-none hover:bg-[var(--color-secondary-surface)]">
                                  <span className="min-w-0 truncate text-[0.9rem] font-medium text-[var(--color-text)]">
                                    Route lines
                                  </span>
                                  <Checkbox
                                    checked={showRoutes}
                                    onCheckedChange={(checked) => {
                                      setMapVisibilityCustomized(true);
                                      setShowRoutes(Boolean(checked));
                                    }}
                                  />
                                </label>

                                {sections.map((section) => (
                                  <label
                                    key={section.dayId}
                                    className="group flex cursor-pointer items-center justify-between gap-3 rounded-[16px] px-3 py-2.5 transition-colors select-none hover:bg-[var(--color-secondary-surface)]"
                                  >
                                    <span className="flex min-w-0 items-center gap-3 text-[0.9rem] font-medium text-[var(--color-text)]">
                                      <div className="flex h-[1.1rem] w-[1.1rem] shrink-0 items-center justify-center">
                                        <span
                                          className="h-3 w-3 rounded-full"
                                          style={{ backgroundColor: section.color }}
                                        />
                                      </div>
                                      <span className="truncate">{section.title}</span>
                                    </span>
                                    <Checkbox
                                      checked={visibleDayIds.has(section.dayId)}
                                      onCheckedChange={() => toggleVisibleDay(section.dayId)}
                                    />
                                  </label>
                                ))}
                              </div>
                            </div>
                          </ScrollArea>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </VoyagerMapControl>

                  {selectedSection && (
                    <VoyagerMapControl position={ControlPosition.BOTTOM_LEFT}>
                      <div className="pointer-events-auto relative z-[5] m-4 inline-flex items-center gap-2.5 rounded-full border border-white/70 bg-white/94 px-5 py-3.5 text-[0.93rem] font-medium shadow-sm backdrop-blur">
                        <CalendarDays className="h-5 w-5 text-[var(--color-text-muted)]" />
                        <span>{selectedSection.title}</span>
                        {dayProgressLabel(selectedSection, selectedStop) ? (
                          <span className="text-[var(--color-text-muted)]">
                            {dayProgressLabel(selectedSection, selectedStop)}
                          </span>
                        ) : null}
                      </div>
                    </VoyagerMapControl>
                  )}
                </>
              )}
            </VoyagerMap>
          )}

          {isMobile && config.map.apiKey && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[10] flex items-end justify-between p-4 pb-11">
              <div className="pointer-events-auto flex flex-col-reverse items-start gap-2">
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
                      <Download className="h-5 w-5" />
                    </button>
                  }
                />
                {selectedSection ? (
                  <div className="inline-flex items-center gap-2.5 rounded-full border border-white/70 bg-white/94 px-5 py-3.5 text-[0.93rem] font-medium shadow-sm backdrop-blur">
                    <CalendarDays className="h-5 w-5 text-[var(--color-text-muted)]" />
                    <span>{selectedSection.title}</span>
                    {dayProgressLabel(selectedSection, selectedStop) ? (
                      <span className="text-[var(--color-text-muted)]">
                        {dayProgressLabel(selectedSection, selectedStop)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="pointer-events-auto flex flex-col items-end gap-2">
                <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                  <PopoverTrigger asChild>
                    <FloatingPopoverIconTrigger
                      icon={<Search className="h-5 w-5" />}
                      label="Search"
                      dataTestId="planner-map-search-trigger"
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={10}
                    className="w-[min(30rem,calc(100vw-1.25rem))]"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="rounded-[16px] border border-[var(--color-border)] bg-[#FDFDFD] px-3.5 py-2.5">
                        <div className="flex items-center gap-2">
                          <Search className="h-5 w-5 opacity-70" />
                          <input
                            value={searchText}
                            onChange={(event) =>
                              startTransition(() => {
                                setActiveQuickCategory(null);
                                setSearchText(event.target.value);
                              })
                            }
                            placeholder="Search a place"
                            className="w-full bg-transparent text-[0.93rem] outline-none placeholder:text-[var(--color-text-muted)]"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_CATEGORIES.map((category) => (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => {
                              setActiveQuickCategory(category);
                              setSearchText(category.query);
                            }}
                            className={cn(
                              'rounded-[14px] px-3.5 py-2 text-[0.85rem] font-medium transition-colors',
                              activeQuickCategory?.id === category.id
                                ? 'bg-[var(--color-text)] text-white'
                                : 'bg-[rgba(23,23,23,0.06)] text-[var(--color-text)] hover:bg-[rgba(23,23,23,0.1)]',
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
                      icon={<Layers3 className="h-5 w-5" />}
                      label="Layers"
                      dataTestId="planner-map-layers-trigger"
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={10}
                    className="w-[min(22rem,calc(100vw-1.25rem))]"
                  >
                    <ScrollArea
                      viewportStyle={{
                        maxHeight:
                          'min(34rem, calc(var(--radix-popover-content-available-height) - 1rem))',
                      }}
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-0.5">
                          <p className="px-2 py-1 text-[0.68rem] font-bold tracking-[0.16em] text-[var(--color-text-muted)] uppercase">
                            Categories
                          </p>
                          <div className="mt-1 space-y-0.5">
                            {(
                              [
                                ['visit', 'Visits', Landmark],
                                ['eat', 'Eat', Utensils],
                                ['activity', 'Activities', Sparkles],
                                ['recommendation', 'Recommendations', Compass],
                                ['hotel', 'Hotels', BedDouble],
                                ['travel', 'Travel', Route],
                              ] as const
                            ).map(([key, label, Icon]) => (
                              <label
                                key={key}
                                className="group flex cursor-pointer items-center justify-between gap-3 rounded-[16px] px-3 py-2.5 transition-colors select-none hover:bg-[var(--color-secondary-surface)]"
                              >
                                <span className="flex min-w-0 items-center gap-3 text-[0.9rem] font-medium text-[var(--color-text)]">
                                  <Icon className="h-[1.1rem] w-[1.1rem] shrink-0 opacity-70" />
                                  <span className="truncate">{label}</span>
                                </span>
                                <Checkbox
                                  checked={visibleGroups.has(key)}
                                  onCheckedChange={() => toggleVisibleGroup(key)}
                                />
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col gap-0.5">
                          <p className="px-2 py-1 text-[0.68rem] font-bold tracking-[0.16em] text-[var(--color-text-muted)] uppercase">
                            Routes
                          </p>
                          <label className="group flex cursor-pointer items-center justify-between gap-3 rounded-[16px] px-3 py-2.5 transition-colors select-none hover:bg-[var(--color-secondary-surface)]">
                            <span className="min-w-0 truncate text-[0.9rem] font-medium text-[var(--color-text)]">
                              Route lines
                            </span>
                            <Checkbox
                              checked={showRoutes}
                              onCheckedChange={(checked) => {
                                setMapVisibilityCustomized(true);
                                setShowRoutes(Boolean(checked));
                              }}
                            />
                          </label>
                          {sections.map((section) => (
                            <label
                              key={section.dayId}
                              className="group flex cursor-pointer items-center justify-between gap-3 rounded-[16px] px-3 py-2.5 transition-colors select-none hover:bg-[var(--color-secondary-surface)]"
                            >
                              <span className="flex min-w-0 items-center gap-3 text-[0.9rem] font-medium text-[var(--color-text)]">
                                <div className="flex h-[1.1rem] w-[1.1rem] shrink-0 items-center justify-center">
                                  <span
                                    className="h-3 w-3 rounded-full"
                                    style={{ backgroundColor: section.color }}
                                  />
                                </div>
                                <span className="truncate">{section.title}</span>
                              </span>
                              <Checkbox
                                checked={visibleDayIds.has(section.dayId)}
                                onCheckedChange={() => toggleVisibleDay(section.dayId)}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>

                {recommendations.enabled &&
                recommendationsDismissed &&
                !hasPlaceSelection &&
                !selectedRecommendation ? (
                  <FloatingIconButton
                    icon={<Compass className="h-5 w-5" />}
                    label="Recommendations"
                    onClick={() => {
                      setRecommendationsDismissed(false);
                      setDetailOpen(true);
                    }}
                    isMobile={isMobile}
                  />
                ) : null}
              </div>
            </div>
          )}

          {selectedSection && selectedSection.dayId !== 'inbox' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void handlePreviewOptimize(selectedSection)}
                  className={cn(
                    'absolute flex h-16 w-16 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff8c62,#7c5ae0)] text-white',
                    isMobile ? 'right-5 bottom-32' : 'right-5 bottom-5',
                  )}
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
                  className="pointer-events-auto relative flex h-[min(60%,34rem)] w-full flex-col overflow-hidden rounded-[28px] border border-[var(--color-border)] bg-[#F3F5F7]"
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

        {isMobile ? (
          <Sheet
            open={detailOpen && showRecommendationSheet}
            onOpenChange={(open) => {
              setDetailOpen(open);
              if (!open) {
                setRecommendationsDismissed(true);
                clearSelection();
              }
            }}
          >
            <SheetContent
              side="bottom"
              hideCloseButton
              className="flex h-[82dvh] flex-col overflow-hidden rounded-t-[24px] border-x-0 border-b-0 bg-[#F3F5F7] p-0 sm:max-w-none"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Recommendations</SheetTitle>
                <SheetDescription>Map recommendations</SheetDescription>
              </SheetHeader>
              <PlannerRecommendationsPanel
                recommendations={recommendations}
                showCloseButton
                onSelectEntry={handleRecommendationSelection}
                selectedEntryKey={selectedRecommendation?.key ?? null}
              />
            </SheetContent>
          </Sheet>
        ) : null}

        {isMobile ? (
          <Sheet
            open={detailOpen && hasActiveSelection}
            onOpenChange={(open) => {
              setDetailOpen(open);
              if (!open) {
                clearSelection();
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
  );
}

export function ActivityMapDetailSheet({
  open,
  tripId,
  activity,
  dayLabel,
  onClose,
  onEdit,
  onDelete,
}: {
  open: boolean;
  tripId: string;
  activity: PlannerActivity | null;
  dayLabel: string | null;
  onClose: () => void;
  onEdit?: (activity: PlannerActivity) => void;
  onDelete?: (activityId: string) => void;
}) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  const [preferredTab, setPreferredTab] = useState('about');

  const placeId = activity?.place_id ?? null;

  const savedPlaceQuery = usePlace(placeId);
  const placeDetailQuery = usePlannerMapPlaceDetail(tripId, placeId);
  const googlePlaceId = resolveGooglePlaceId(savedPlaceQuery.data);
  const googlePlaceDetailQuery = useGooglePlaceDetail(googlePlaceId);

  const resolvedDetail = useMemo(
    () => mergePlaceDetail(placeDetailQuery.data, googlePlaceDetailQuery.data),
    [placeDetailQuery.data, googlePlaceDetailQuery.data],
  );

  const stop = useMemo((): PlannerMapStop | null => {
    if (!activity) return null;
    const primary = plannerPrimaryPlace(activity);
    return {
      activity,
      dayId: activity.trip_day_id ?? 'inbox',
      dayIndex: -1,
      color: PLANNER_MAP_DAY_COLORS[0],
      markerNumber: null,
      isHotel: activity.category === 'hotel',
      lat: primary?.lat ?? null,
      lon: primary?.lon ?? null,
    };
  }, [activity]);

  const isTogglingVisitedRef = useRef(false);
  const [isTogglingVisited, setIsTogglingVisited] = useState(false);

  async function handleToggleVisited() {
    if (!activity || isTogglingVisitedRef.current) return;
    isTogglingVisitedRef.current = true;
    setIsTogglingVisited(true);
    const newVisitedAt = activity.visited_at ? null : new Date().toISOString();
    const previousPlanner = applyOptimisticVisitedUpdate(
      queryClient,
      tripId,
      activity.id,
      newVisitedAt,
    );

    try {
      await patchActivity(activity.id, { visited_at: newVisitedAt });
      invalidatePlannerQueries(queryClient, tripId);
    } catch {
      restorePlannerData(queryClient, tripId, previousPlanner);
    } finally {
      isTogglingVisitedRef.current = false;
      setIsTogglingVisited(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side={isMobile ? 'bottom' : 'left'}
        hideCloseButton
        className={
          isMobile
            ? 'flex h-[82dvh] flex-col overflow-hidden rounded-t-[28px] border-x-0 border-b-0 bg-[#F3F5F7] p-0 sm:max-w-none'
            : 'left-14 flex h-full w-[calc(100vw-56px)] max-w-[calc(100vw-56px)] flex-col overflow-hidden bg-[#F3F5F7] p-0 lg:w-[clamp(380px,46vw,500px)] lg:max-w-[clamp(380px,46vw,500px)]'
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
            destinations={[]}
            onAddToTrip={() => {}}
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
  );
}
