import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  getFirstCollision,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { toast } from 'sonner';
import { config } from '@/app/config';
import { useGenerateItinerary, useJob, useResetItinerary } from '@/entities/job/queries';
import { getPlanner } from '@/entities/planner/api';
import { plannerKeys, usePlanner } from '@/entities/planner/queries';
import { readTripCoverPhotoPreference } from '@/entities/trip/cover-photo';
import { tripAssetKeys } from '@/entities/trip-asset/queries';
import {
  isApiError,
  isConflict,
  isRateLimit,
  triggerUnauthorizedHandler,
} from '@/shared/api/client';
import { isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs';
import { usePlannerStore } from '@/shared/stores/planner.store';
import { useSideRailStore, type DayAnchor } from '@/shared/stores/side-rail.store';
import { PLANNER_MAP_DAY_COLORS } from './planner-map-utils';
import type {
  ActivityCreateInput,
  Day,
  PlannerActivity,
  PlannerGenerationReport,
  PlannerResponse,
  TripCoverPreference,
  TripGenerateInput,
} from '@/shared/api/types';
import { Skeleton } from '@/components/ui/skeleton';
import type { ComboboxOption } from '@/components/ui/combobox';
import { ActivityCardView } from './ActivityCard';
import { ActivityDrawer } from './ActivityDrawer';
import {
  filterPlannerActivitiesByBucket,
  plannerActivityBucket,
  type PlannerActivityBucket,
} from './activity-buckets';
import {
  type PlannerGenerationAction,
  type PlannerGenerationFormValues,
} from './GenerationControls';
import { mirrorPlannerJobToAssistant, PlannerAssistantPanel } from '@/widgets/planner-assistant';
import {
  ActivityMapDetailSheet,
  PlannerMapView,
  type PlannerAssistantSuggestedPlace,
} from './PlannerMapView';
import type { PlannerRecommendationEntry } from './usePlannerRecommendations';
import { usePlannerRecommendations } from './usePlannerRecommendations';
import { TripSettingsMenu } from './TripSettingsMenu';

interface Props {
  tripId: string;
}
type PlannerVisualContainerId = string;
type ActivityLocation = {
  bucket: PlannerActivityBucket;
  containerId: PlannerVisualContainerId;
  dayId: string | null;
  index: number;
};
type DragPreviewSize = {
  width: number;
  height: number;
};
type EditorState = {
  activityId: string | null;
  defaultTripDayId: string | null;
  defaultCategory: PlannerActivity['category'] | null;
} | null;
type PlannerMapSeed = {
  activityId: string | null;
  placeId: string | null;
  center: { lat: number; lng: number } | null;
};

const INBOX_CONTAINER_ID = 'inbox';
const INBOX_DAY_VALUE = '__inbox__';
const CHIP_PREFIX = 'chip::';
const END_SUFFIX = '::end';

function clonePlanner(planner: PlannerResponse): PlannerResponse {
  return {
    trip: { ...planner.trip },
    legacy_inbox_mode: planner.legacy_inbox_mode,
    inbox_activities: planner.inbox_activities.map((activity) => ({
      ...activity,
    })),
    days: planner.days.map((day) => ({
      ...day,
      activities: day.activities.map((activity) => ({ ...activity })),
    })),
  };
}

function getEndZoneId(containerId: PlannerVisualContainerId) {
  return `${containerId}${END_SUFFIX}`;
}

export function resolveDragPreviewSize(
  event: Pick<DragStartEvent, 'active' | 'activatorEvent'>,
): DragPreviewSize | null {
  const sourceRect = event.active.rect.current.initial ?? event.active.rect.current.translated;
  if (sourceRect) {
    return {
      width: sourceRect.width,
      height: sourceRect.height,
    };
  }

  const activatorTarget = event.activatorEvent.target;
  if (!(activatorTarget instanceof Element)) {
    return null;
  }

  const sourceCard = activatorTarget.closest('article');
  if (!sourceCard) {
    return null;
  }

  const fallbackRect = sourceCard.getBoundingClientRect();
  return {
    width: fallbackRect.width,
    height: fallbackRect.height,
  };
}

function normalizeActivityList(activities: PlannerActivity[], tripDayId: string | null) {
  return activities.map((activity, index) => ({
    ...activity,
    trip_day_id: tripDayId,
    order_index: index,
    start_time: tripDayId == null && activity.category !== 'travel' ? null : activity.start_time,
  }));
}

function getVisualContainerId(
  bucket: PlannerActivityBucket,
  dayId: string | null,
): PlannerVisualContainerId {
  return `${bucket}::${dayId ?? INBOX_CONTAINER_ID}`;
}

function parseVisualContainerId(
  value: string,
): { bucket: PlannerActivityBucket; dayId: string | null } | null {
  const [bucketValue, rawDayId] = value.split('::');
  if (
    (bucketValue !== 'main' && bucketValue !== 'travel' && bucketValue !== 'accommodation') ||
    !rawDayId
  ) {
    return null;
  }

  return {
    bucket: bucketValue,
    dayId: rawDayId === INBOX_CONTAINER_ID ? null : rawDayId,
  };
}

function getActivitiesForDay(planner: PlannerResponse, dayId: string | null) {
  if (dayId == null) {
    return planner.inbox_activities;
  }
  return planner.days.find((day) => day.id === dayId)?.activities ?? [];
}

function setActivitiesForDay(
  planner: PlannerResponse,
  dayId: string | null,
  activities: PlannerActivity[],
) {
  if (dayId == null) {
    planner.inbox_activities = normalizeActivityList(activities, null);
    return;
  }
  const day = planner.days.find((item) => item.id === dayId);
  if (!day) {
    return;
  }
  day.activities = normalizeActivityList(activities, day.id);
}

function getContainerActivities(
  planner: PlannerResponse,
  dayId: string | null,
  bucket: PlannerActivityBucket,
) {
  return filterPlannerActivitiesByBucket(getActivitiesForDay(planner, dayId), bucket);
}

function setContainerActivities(
  planner: PlannerResponse,
  dayId: string | null,
  activities: PlannerActivity[],
) {
  setActivitiesForDay(planner, dayId, activities);
}

function getBucketInsertionIndex(
  activities: PlannerActivity[],
  bucket: PlannerActivityBucket,
  targetIndex: number,
) {
  const bucketIndices = activities.reduce<number[]>((accumulator, activity, index) => {
    if (plannerActivityBucket(activity) === bucket) {
      accumulator.push(index);
    }
    return accumulator;
  }, []);

  if (bucketIndices.length === 0) {
    return activities.length;
  }
  if (targetIndex >= bucketIndices.length) {
    const lastBucketIndex = bucketIndices[bucketIndices.length - 1];
    if (lastBucketIndex == null) {
      return activities.length;
    }
    return lastBucketIndex + 1;
  }
  return bucketIndices[targetIndex] ?? activities.length;
}

function findActivityLocation(
  planner: PlannerResponse | undefined,
  activityId: string | null,
): ActivityLocation | null {
  if (!planner || !activityId) {
    return null;
  }

  const inboxIndex = planner.inbox_activities.findIndex((activity) => activity.id === activityId);
  if (inboxIndex >= 0) {
    const activity = planner.inbox_activities[inboxIndex];
    if (!activity) {
      return null;
    }
    const bucket = plannerActivityBucket(activity);
    return {
      bucket,
      containerId: getVisualContainerId(bucket, null),
      dayId: null,
      index: getContainerActivities(planner, null, bucket).findIndex(
        (candidate) => candidate.id === activity.id,
      ),
    };
  }

  for (const day of planner.days) {
    const index = day.activities.findIndex((activity) => activity.id === activityId);
    if (index >= 0) {
      const activity = day.activities[index];
      if (!activity) {
        continue;
      }
      const bucket = plannerActivityBucket(activity);
      return {
        bucket,
        containerId: getVisualContainerId(bucket, day.id),
        dayId: day.id,
        index: getContainerActivities(planner, day.id, bucket).findIndex(
          (candidate) => candidate.id === activity.id,
        ),
      };
    }
  }

  return null;
}

function findActivity(planner: PlannerResponse | undefined, activityId: string | null) {
  if (!planner || !activityId) {
    return null;
  }

  const inboxActivity = planner.inbox_activities.find((activity) => activity.id === activityId);
  if (inboxActivity) {
    return inboxActivity;
  }

  for (const day of planner.days) {
    const found = day.activities.find((activity) => activity.id === activityId);
    if (found) {
      return found;
    }
  }

  return null;
}

function resolveDropTarget(
  planner: PlannerResponse | undefined,
  overId: string | null,
): ActivityLocation | null {
  if (!planner || !overId) {
    return null;
  }

  if (overId.startsWith(CHIP_PREFIX)) {
    const rawContainerId = overId.slice(CHIP_PREFIX.length);
    if (rawContainerId === INBOX_CONTAINER_ID) {
      return {
        bucket: 'main',
        containerId: getVisualContainerId('main', null),
        dayId: null,
        index: getContainerActivities(planner, null, 'main').length,
      };
    }
    const day = planner.days.find((item) => item.id === rawContainerId);
    return day
      ? {
          bucket: 'main',
          containerId: getVisualContainerId('main', day.id),
          dayId: day.id,
          index: getContainerActivities(planner, day.id, 'main').length,
        }
      : null;
  }

  const normalizedOverId = overId.endsWith(END_SUFFIX)
    ? overId.slice(0, -END_SUFFIX.length)
    : overId;
  const parsedContainer = parseVisualContainerId(normalizedOverId);
  if (parsedContainer) {
    return {
      bucket: parsedContainer.bucket,
      containerId: getVisualContainerId(parsedContainer.bucket, parsedContainer.dayId),
      dayId: parsedContainer.dayId,
      index: getContainerActivities(planner, parsedContainer.dayId, parsedContainer.bucket).length,
    };
  }

  if (planner.days.some((day) => day.id === normalizedOverId)) {
    const day = planner.days.find((item) => item.id === normalizedOverId);
    return day
      ? {
          bucket: 'main',
          containerId: getVisualContainerId('main', day.id),
          dayId: day.id,
          index: getContainerActivities(planner, day.id, 'main').length,
        }
      : null;
  }

  return findActivityLocation(planner, overId);
}

function canMoveBetweenLocations(source: ActivityLocation, target: ActivityLocation) {
  if (source.bucket !== target.bucket) {
    return false;
  }

  if (source.bucket !== 'main' && source.dayId !== target.dayId) {
    return false;
  }

  return true;
}

function updatePlannerActivityLists(
  planner: PlannerResponse,
  activityId: string,
  target: ActivityLocation,
) {
  const source = findActivityLocation(planner, activityId);
  if (!source) {
    return null;
  }
  if (!canMoveBetweenLocations(source, target)) {
    return null;
  }

  const nextPlanner = clonePlanner(planner);
  const sourceActivities = [...getActivitiesForDay(nextPlanner, source.dayId)];
  const targetActivities =
    source.dayId === target.dayId
      ? sourceActivities
      : [...getActivitiesForDay(nextPlanner, target.dayId)];

  const sourceIndex = sourceActivities.findIndex((activity) => activity.id === activityId);
  const [activity] = sourceActivities.splice(sourceIndex, 1);
  if (!activity) {
    return null;
  }

  const insertionIndex = target.index;
  const safeIndex = getBucketInsertionIndex(
    targetActivities,
    target.bucket,
    Math.max(0, insertionIndex),
  );
  const nextActivity: PlannerActivity = {
    ...activity,
    trip_day_id: target.dayId,
    start_time: target.dayId == null && activity.category !== 'travel' ? null : activity.start_time,
    legacy_source_day_id: target.dayId ?? activity.legacy_source_day_id ?? source.dayId,
    legacy_inbox_item: target.dayId == null,
  };
  targetActivities.splice(safeIndex, 0, nextActivity);

  setContainerActivities(nextPlanner, source.dayId, sourceActivities);
  if (source.dayId === target.dayId) {
    setContainerActivities(nextPlanner, target.dayId, targetActivities);
  } else {
    setContainerActivities(nextPlanner, target.dayId, targetActivities);
  }
  return nextPlanner;
}

function buildReport(
  jobId: string,
  status: string,
  result: unknown,
  error: unknown,
): PlannerGenerationReport {
  return {
    jobId,
    status,
    result: result && typeof result === 'object' ? (result as Record<string, unknown>) : null,
    error: error && typeof error === 'object' ? (error as Record<string, unknown>) : null,
  };
}

function findDayLabel(planner: PlannerResponse | null | undefined, tripDayId: string | null) {
  if (!planner || !tripDayId) {
    return null;
  }
  const day = planner.days.find((item) => item.id === tripDayId);
  if (!day) {
    return null;
  }
  return `Day ${day.day_index + 1} · ${format(new Date(day.date), 'EEE, MMM d')}`;
}

function parsePlannerMapSeed(
  searchParams: URLSearchParams,
  tripId: string,
  coverPreference: TripCoverPreference | null = null,
): PlannerMapSeed {
  const legacyCoverPreference = readTripCoverPhotoPreference(tripId);
  const activityId = searchParams.get('activityId')?.trim() || null;
  const placeId = searchParams.get('placeId')?.trim() || null;
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));
  const center =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : typeof coverPreference?.placeLat === 'number' &&
          Number.isFinite(coverPreference.placeLat) &&
          typeof coverPreference?.placeLng === 'number' &&
          Number.isFinite(coverPreference.placeLng)
        ? { lat: coverPreference.placeLat, lng: coverPreference.placeLng }
        : typeof legacyCoverPreference?.placeLat === 'number' &&
            Number.isFinite(legacyCoverPreference.placeLat) &&
            typeof legacyCoverPreference?.placeLng === 'number' &&
            Number.isFinite(legacyCoverPreference.placeLng)
          ? { lat: legacyCoverPreference.placeLat, lng: legacyCoverPreference.placeLng }
          : null;

  return {
    activityId,
    placeId,
    center,
  };
}

export default function PlannerBoard({ tripId }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [editorState, setEditorState] = useState<EditorState>(null);
  const [detailsActivityId, setDetailsActivityId] = useState<string | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<PlannerRecommendationEntry | null>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [collaborationMenuOpen, setCollaborationMenuOpen] = useState(false);
  const [assistantInlineAction, setAssistantInlineAction] =
    useState<PlannerGenerationAction | null>(null);
  const [assistantSuggestedPlace, setAssistantSuggestedPlace] =
    useState<PlannerAssistantSuggestedPlace | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const setPlannerInstruments = useSideRailStore((s) => s.setPlannerInstruments);
  const {
    pendingJobIds,
    setPendingJobId,
    clearPendingJobId,
    setGenerationReport,
    clearGenerationReport,
    assistantPanelOpenByTrip,
    setAssistantPanelOpen,
  } = usePlannerStore();
  const [activeActivity, setActiveActivity] = useState<PlannerActivity | null>(null);
  const [activeDragPreviewSize, setActiveDragPreviewSize] = useState<DragPreviewSize | null>(null);
  const prevJobStatus = useRef<string | null>(null);
  const mirroredAssistantJobIdsRef = useRef(new Set<string>());
  const lastOverIdRef = useRef<UniqueIdentifier | null>(null);
  const dragOriginPlannerRef = useRef<PlannerResponse | null>(null);
  const openRailSectionRef = useRef<((sectionKey: string) => void) | null>(null);

  const [plannerLoadRecovery, setPlannerLoadRecovery] = useState<'auth' | 'trip' | null>(null);
  const { data: planner, isLoading, isError, error } = usePlanner(tripId);
  const plannerMapSeed = useMemo(
    () => parsePlannerMapSeed(searchParams, tripId, planner?.trip.coverPreference ?? null),
    [planner?.trip.coverPreference, searchParams, tripId],
  );
  const plannerError = isApiError(error) ? error : null;
  const plannerLoadRecoveryMode =
    plannerLoadRecovery ??
    (plannerError?.status === 401 ? 'auth' : plannerError?.status === 404 ? 'trip' : null);
  const plannerDays = planner?.days ?? null;

  useEffect(() => {
    if (!plannerError) {
      if (plannerLoadRecovery != null) {
        setPlannerLoadRecovery(null);
      }
      return;
    }

    if (plannerError.status === 401) {
      if (plannerLoadRecovery === 'auth') {
        return;
      }

      setPlannerLoadRecovery('auth');

      if (!plannerError.unauthorizedHandled) {
        void triggerUnauthorizedHandler().catch(() => undefined);
      }

      return;
    }

    if (plannerError.status === 404) {
      if (plannerLoadRecovery === 'trip') {
        return;
      }

      setPlannerLoadRecovery('trip');
      navigate('/app/trips', { replace: true });
      return;
    }

    if (plannerLoadRecovery != null) {
      setPlannerLoadRecovery(null);
    }
  }, [navigate, plannerError, plannerLoadRecovery]);

  useEffect(() => {
    const days: DayAnchor[] = [
      { dayId: 'inbox', label: '+', date: '', color: '#94a3b8', isInbox: true },
      ...(plannerDays ?? []).map((day, i) => ({
        dayId: day.id,
        label: String(i + 1),
        date: day.date,
        color:
          PLANNER_MAP_DAY_COLORS[i % PLANNER_MAP_DAY_COLORS.length] ?? PLANNER_MAP_DAY_COLORS[0],
        isInbox: false,
      })),
    ];
    function scrollIntoView(target: Element | null) {
      const scrollEl = document.querySelector('[data-planner-scroll]');
      if (scrollEl && target) {
        const offset = target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
        scrollEl.scrollTo({ top: scrollEl.scrollTop + offset - 8, behavior: 'smooth' });
      }
    }
    function onScrollToDay(dayId: string) {
      const { mobilePlannerView, setMobilePlannerView } = useSideRailStore.getState();
      const wasInMapMode = mobilePlannerView === 'map';
      if (wasInMapMode) {
        setMobilePlannerView('cards');
      }
      const { mapDayAccordionStateByTrip, setMapDayAccordionState } = usePlannerStore.getState();
      const current = mapDayAccordionStateByTrip[tripId] ?? {};
      const delay = wasInMapMode ? 350 : 200;
      if (!current[dayId]) {
        setMapDayAccordionState(tripId, { ...current, [dayId]: true });
        setTimeout(() => scrollIntoView(document.getElementById(`planner-day-${dayId}`)), delay);
      } else {
        setTimeout(
          () => scrollIntoView(document.getElementById(`planner-day-${dayId}`)),
          wasInMapMode ? delay : 0,
        );
      }
    }
    const sectionKeyMap: Record<string, string> = { hotel: 'accommodation', travel: 'travel' };
    function onScrollToSection(section: 'itinerary' | 'hotel' | 'travel') {
      const sectionKey = sectionKeyMap[section];
      if (sectionKey) {
        openRailSectionRef.current?.(sectionKey);
        setTimeout(
          () => scrollIntoView(document.querySelector(`[data-planner-section="${section}"]`)),
          200,
        );
      } else {
        scrollIntoView(document.querySelector(`[data-planner-section="${section}"]`));
      }
    }
    const { assistantPanelOpenByTrip } = usePlannerStore.getState();
    const isAssistantOpen = assistantPanelOpenByTrip[tripId] ?? false;
    setPlannerInstruments({
      isAssistantOpen,
      onToggleAssistant: () => {
        const { assistantPanelOpenByTrip: current } = usePlannerStore.getState();
        setAssistantPanelOpen(tripId, !(current[tripId] ?? false));
      },
      onCloseAssistant: () => setAssistantPanelOpen(tripId, false),
      onOpenSettings: () => setSettingsMenuOpen(true),
      onShare: () => setCollaborationMenuOpen(true),
      days,
      onScrollToDay,
      onScrollToSection,
    });
    return () => {
      setPlannerInstruments(null);
    };
  }, [plannerDays, setAssistantPanelOpen, setPlannerInstruments, tripId]);

  const pendingJobId = pendingJobIds[tripId] ?? null;
  const assistantPanelOpen = assistantPanelOpenByTrip[tripId] ?? false;
  const currentJob = useJob(pendingJobId);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    plannerMapSeed.activityId,
  );
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(plannerMapSeed.placeId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const generateMutation = useGenerateItinerary(tripId);
  const resetMutation = useResetItinerary(tripId);

  const allActivities = useMemo(
    () =>
      planner
        ? [...planner.inbox_activities, ...planner.days.flatMap((day) => day.activities)]
        : [],
    [planner],
  );
  const detailsActivity = useMemo(
    () => findActivity(planner, detailsActivityId),
    [detailsActivityId, planner],
  );
  const editorActivity = useMemo(
    () => findActivity(planner, editorState?.activityId ?? null),
    [editorState?.activityId, planner],
  );
  const hasActivities = allActivities.length > 0;
  const recommendations = usePlannerRecommendations({
    tripId,
    trip: planner?.trip ?? null,
    days: planner?.days ?? [],
    allActivities,
    enabled: config.features.activitiesUI,
  });

  const collisionDetectionStrategy = useCallback<CollisionDetection>(
    (args) => {
      const intersections = pointerWithin(args);
      const collisions = intersections.length > 0 ? intersections : rectIntersection(args);
      let overId = getFirstCollision(collisions, 'id');

      if (overId != null && planner) {
        const resolved = resolveDropTarget(planner, String(overId));
        const isChip = String(overId).startsWith(CHIP_PREFIX);
        if (resolved && !isChip) {
          const containerItems = getContainerActivities(planner, resolved.dayId, resolved.bucket);
          if (containerItems.length > 0) {
            const itemIds = new Set(containerItems.map((activity) => activity.id));
            const narrowed = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter(
                (container) =>
                  itemIds.has(String(container.id)) ||
                  String(container.id) === getEndZoneId(resolved.containerId),
              ),
            });
            overId = narrowed[0]?.id ?? overId;
          }
        }
      }

      if (overId != null) {
        lastOverIdRef.current = overId;
        return [{ id: overId }];
      }

      return lastOverIdRef.current != null ? [{ id: lastOverIdRef.current }] : [];
    },
    [planner],
  );

  useEffect(() => {
    const job = currentJob.data;
    if (!job || !pendingJobId) {
      return;
    }
    if (!isJobTerminal(job.status) || prevJobStatus.current === job.status) {
      return;
    }

    prevJobStatus.current = job.status;
    setGenerationReport(tripId, buildReport(job.id, job.status, job.result, job.error));
    const mirroredInAssistant = mirroredAssistantJobIdsRef.current.has(pendingJobId);
    mirroredAssistantJobIdsRef.current.delete(pendingJobId);

    if (isJobSuccessful(job.status)) {
      qc.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
      clearPendingJobId(tripId);
      if (!mirroredInAssistant) {
        toast.success('Planner updated');
      }
      return;
    }

    clearPendingJobId(tripId);
    if (!mirroredInAssistant) {
      toast.error(job.job_type === 'itinerary.reset' ? 'Itinerary reset failed' : 'Planner generation failed');
    }
  }, [clearPendingJobId, currentJob.data, pendingJobId, qc, setGenerationReport, tripId]);

  useEffect(() => {
    if (!recommendations.enabled) {
      setSelectedRecommendation(null);
    }
  }, [recommendations.enabled]);

  const invalidatePlanner = async () => {
    await qc.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
  };

  const handleMapSelectActivityId = (activityId: string | null) => {
    const activity = findActivity(planner, activityId);
    setSelectedActivityId(activityId);
    setSelectedPlaceId(activityId ? (activity?.place_id ?? selectedPlaceId) : null);
    setAssistantSuggestedPlace(null);
  };

  const openCreateDrawer = (
    defaultTripDayId: string | null,
    defaultCategory: PlannerActivity['category'] | null = null,
  ) => {
    setDetailsActivityId(null);
    setEditorState({ activityId: null, defaultTripDayId, defaultCategory });
  };

  const openEditDrawer = (activity: PlannerActivity) => {
    setDetailsActivityId(null);
    setEditorState({
      activityId: activity.id,
      defaultTripDayId: activity.trip_day_id ?? null,
      defaultCategory: activity.category,
    });
  };

  const closeEditor = () => setEditorState(null);

  const handleDrawerSave = async (data: ActivityCreateInput, attachmentFiles: File[] = []) => {
    if (!planner) {
      return;
    }
    setIsSaving(true);

    try {
      let savedActivityId: string | null = null;
      const successMessage = editorActivity ? 'Activity updated' : 'Activity added';

      if (editorActivity) {
        const { moveActivity, patchActivity } = await import('@/entities/activity/api');
        const nextTripDayId = data.trip_day_id ?? null;
        const targetDay = nextTripDayId
          ? (planner.days.find((day) => day.id === nextTripDayId) ?? null)
          : null;
        const targetIndex = nextTripDayId
          ? Math.max(
              0,
              targetDay?.activities.filter((item) => item.id !== editorActivity.id).length ?? 0,
            )
          : Math.max(
              0,
              planner.inbox_activities.filter((item) => item.id !== editorActivity.id).length,
            );

        if (editorActivity.trip_day_id !== nextTripDayId) {
          await moveActivity(
            editorActivity.id,
            {
              target_day_id: nextTripDayId,
              target_index: targetIndex,
            },
            planner.trip.version,
          );
        }

        const patchPayload = { ...data };
        delete patchPayload.trip_day_id;
        const updatedActivity = await patchActivity(editorActivity.id, {
          ...patchPayload,
          start_time:
            nextTripDayId == null && editorActivity.category !== 'travel'
              ? null
              : (patchPayload.start_time ?? null),
        });
        savedActivityId = updatedActivity.id;
      } else if (editorState) {
        const idempotencyKey = crypto.randomUUID();
        const { createPlannerActivity } = await import('@/entities/activity/api');
        const createdActivity = await createPlannerActivity(tripId, data, idempotencyKey);
        savedActivityId = createdActivity.id;
      }

      if (savedActivityId && attachmentFiles.length > 0) {
        const { uploadTripAsset } = await import('@/entities/trip-asset/api');
        const results = await Promise.allSettled(
          attachmentFiles.map((file) => uploadTripAsset(tripId, file, savedActivityId)),
        );
        const uploadedCount = results.filter((result) => result.status === 'fulfilled').length;
        const failedCount = results.length - uploadedCount;

        if (uploadedCount > 0) {
          toast.success(
            `${successMessage} · ${uploadedCount} file${uploadedCount === 1 ? '' : 's'} attached`,
          );
        } else {
          toast.success(successMessage);
        }
        if (failedCount > 0) {
          toast.error(`${failedCount} attachment${failedCount === 1 ? '' : 's'} failed to upload`);
        }
      } else {
        toast.success(successMessage);
      }

      await Promise.all([
        invalidatePlanner(),
        qc.invalidateQueries({ queryKey: tripAssetKeys.all(tripId) }),
      ]);
      closeEditor();
    } catch (error) {
      if (isRateLimit(error)) {
        toast.error('Too many requests. Please wait a moment.');
      } else {
        toast.error('Failed to save activity');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    try {
      const { deleteActivity } = await import('@/entities/activity/api');
      await deleteActivity(activityId);
      toast.success('Activity removed');
      if (detailsActivityId === activityId) {
        setDetailsActivityId(null);
      }
      if (editorState?.activityId === activityId) {
        setEditorState(null);
      }
      if (selectedActivityId === activityId) {
        setSelectedActivityId(null);
        setSelectedPlaceId(null);
      }
      await invalidatePlanner();
    } catch {
      toast.error('Failed to remove activity');
    }
  };

  const submitGeneration = async (data: PlannerGenerationFormValues, idempotencyKey: string) => {
    if (!planner) {
      return null;
    }

    const payload: TripGenerateInput = {
      mode: data.mode,
      day_ids: data.day_ids && data.day_ids.length > 0 ? data.day_ids : null,
      constraints: {},
      seed: data.seed ?? null,
    };

    clearGenerationReport(tripId);
    const accepted = await generateMutation.mutateAsync({
      data: payload,
      tripVersion: planner.trip.version,
      idempotencyKey,
    });
    prevJobStatus.current = null;
    setPendingJobId(tripId, accepted.job_id);
    return accepted.job_id;
  };

  const handleGenerate = async (data: PlannerGenerationFormValues, idempotencyKey: string) => {
    const scopeDays = data.day_ids?.length ? data.day_ids.length : (planner?.days.length ?? 0);
    const requestText = `Generate · ${data.mode} · ${scopeDays} day${scopeDays !== 1 ? 's' : ''}`;
    try {
      const jobId = await submitGeneration(data, idempotencyKey);
      if (!jobId) {
        return;
      }
      try {
        await mirrorPlannerJobToAssistant(qc, {
          tripId,
          jobId,
          requestText,
          action: 'generate',
        });
        mirroredAssistantJobIdsRef.current.add(jobId);
        setAssistantPanelOpen(tripId, true);
      } catch {
        toast.error('Planner generation queued, but assistant progress could not be opened');
      }
      toast.success('Planner generation queued');
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Trip changed. Refresh the planner and try again.');
      } else {
        toast.error('Failed to queue planner generation');
      }
    }
  };

  const handleReset = async (dayIds: string[] | undefined, idempotencyKey: string) => {
    if (!planner) {
      return;
    }
    const scopeDays = dayIds?.length ? dayIds.length : planner.days.length;
    const requestText = `Reset · ${scopeDays} day${scopeDays !== 1 ? 's' : ''}`;
    try {
      clearGenerationReport(tripId);
      const accepted = await resetMutation.mutateAsync({
        data: {
          day_ids: dayIds && dayIds.length > 0 ? dayIds : planner.days.map((day) => day.id),
        },
        tripVersion: planner.trip.version,
        idempotencyKey,
      });
      prevJobStatus.current = null;
      setPendingJobId(tripId, accepted.job_id);
      try {
        await mirrorPlannerJobToAssistant(qc, {
          tripId,
          jobId: accepted.job_id,
          requestText,
          action: 'reset',
        });
        mirroredAssistantJobIdsRef.current.add(accepted.job_id);
        setAssistantPanelOpen(tripId, true);
      } catch {
        toast.error('Reset queued, but assistant progress could not be opened');
      }
      toast.success('Itinerary reset queued');
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Trip changed. Refresh the planner and try again.');
      } else {
        toast.error('Failed to queue reset');
      }
    }
  };

  const handleAssistantInlineActionSubmit = async (
    action: PlannerGenerationAction,
    values: PlannerGenerationFormValues,
    idempotencyKey: string,
  ) => {
    if (action === 'generate') {
      await handleGenerate(values, idempotencyKey);
      return;
    }

    await handleReset(values.day_ids, idempotencyKey);
  };

  const handleRequestedInlineActionHandled = useCallback(() => {
    setAssistantInlineAction(null);
  }, []);

  const handleAssistantPanelOpenChange = useCallback(
    (open: boolean) => {
      setAssistantPanelOpen(tripId, open);
    },
    [setAssistantPanelOpen, tripId],
  );

  const handleOpenGenerationInline = useCallback(() => {
    setAssistantInlineAction('generate');
    setAssistantPanelOpen(tripId, true);
  }, [setAssistantPanelOpen, tripId]);

  const handleDragStart = (event: DragStartEvent) => {
    if (planner) {
      dragOriginPlannerRef.current = clonePlanner(planner);
    }
    lastOverIdRef.current = event.active.id;
    setActiveDragPreviewSize(resolveDragPreviewSize(event));
    setActiveActivity(findActivity(planner, String(event.active.id)));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id ? String(event.over.id) : null;
    const activityId = String(event.active.id);
    const currentPlanner = qc.getQueryData<PlannerResponse>(plannerKeys.detail(tripId)) ?? planner;
    if (!currentPlanner || !overId) {
      return;
    }

    const source = findActivityLocation(currentPlanner, activityId);
    const target = resolveDropTarget(currentPlanner, overId);
    if (!source || !target) {
      return;
    }
    if (source.containerId === target.containerId && source.index === target.index) {
      return;
    }

    const nextPlanner = updatePlannerActivityLists(currentPlanner, activityId, target);
    if (!nextPlanner) {
      return;
    }
    qc.setQueryData(plannerKeys.detail(tripId), nextPlanner);
  };

  const handleDragCancel = () => {
    setActiveActivity(null);
    setActiveDragPreviewSize(null);
    lastOverIdRef.current = null;
    if (dragOriginPlannerRef.current) {
      qc.setQueryData(plannerKeys.detail(tripId), dragOriginPlannerRef.current);
      dragOriginPlannerRef.current = null;
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const capturedActivity = activeActivity;
    const originPlanner = dragOriginPlannerRef.current;
    const currentPlanner = qc.getQueryData<PlannerResponse>(plannerKeys.detail(tripId)) ?? planner;

    setActiveActivity(null);
    setActiveDragPreviewSize(null);
    lastOverIdRef.current = null;
    dragOriginPlannerRef.current = null;

    if (!capturedActivity || !originPlanner || !currentPlanner || !event.over) {
      if (originPlanner) {
        qc.setQueryData(plannerKeys.detail(tripId), originPlanner);
      }
      return;
    }

    const startLocation = findActivityLocation(originPlanner, capturedActivity.id);
    const finalLocation = findActivityLocation(currentPlanner, capturedActivity.id);
    if (!startLocation || !finalLocation) {
      qc.setQueryData(plannerKeys.detail(tripId), originPlanner);
      return;
    }

    if (
      startLocation.containerId === finalLocation.containerId &&
      startLocation.index === finalLocation.index
    ) {
      qc.setQueryData(plannerKeys.detail(tripId), currentPlanner);
      return;
    }

    const persistMove = async (tripVersion: number) => {
      const { moveActivity, reorderActivities } = await import('@/entities/activity/api');

      const shouldUseDayReorder =
        startLocation.containerId === finalLocation.containerId && finalLocation.dayId != null;

      if (shouldUseDayReorder) {
        const reorderedDay = currentPlanner.days.find((day) => day.id === finalLocation.dayId);
        if (!reorderedDay) {
          return;
        }
        await reorderActivities(
          reorderedDay.id,
          {
            items: reorderedDay.activities.map((activity, index) => ({
              activity_id: activity.id,
              order_index: index,
            })),
          },
          tripVersion,
        );
        return;
      }

      await moveActivity(
        capturedActivity.id,
        {
          target_day_id: finalLocation.dayId,
          target_index: Math.max(
            getActivitiesForDay(currentPlanner, finalLocation.dayId).findIndex(
              (activity) => activity.id === capturedActivity.id,
            ),
            0,
          ),
        },
        tripVersion,
      );
    };

    try {
      await persistMove(currentPlanner.trip.version);
      await invalidatePlanner();
    } catch (error) {
      if (isConflict(error)) {
        try {
          const freshPlanner = await qc.fetchQuery({
            queryKey: plannerKeys.detail(tripId),
            queryFn: () => getPlanner(tripId),
          });
          await persistMove(freshPlanner.trip.version);
          await invalidatePlanner();
          return;
        } catch {
          // fall through to restore the optimistic state below
        }
      }
      qc.setQueryData(plannerKeys.detail(tripId), originPlanner);
      toast.error('Failed to move activity');
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-5">
        <Skeleton className="h-20 rounded-[12px]" />
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-[420px] rounded-[12px]" />
          <Skeleton className="h-[420px] rounded-[12px]" />
          <Skeleton className="h-[420px] rounded-[12px]" />
        </div>
      </div>
    );
  }

  if (plannerLoadRecoveryMode) {
    return (
      <div className="p-4 md:p-5">
        <div className="rounded-[12px] bg-white p-5 text-sm text-[var(--color-text-muted)]">
          {plannerLoadRecoveryMode === 'auth'
            ? 'Redirecting to sign in...'
            : 'Returning to your trips...'}
        </div>
      </div>
    );
  }

  if (isError || !planner) {
    return (
      <div className="p-4 md:p-5">
        <div className="rounded-[12px] bg-white p-5 text-sm text-[var(--color-text-muted)]">
          Failed to load the planner workspace.
        </div>
      </div>
    );
  }

  const activityDayOptions: ComboboxOption[] = [
    {
      value: INBOX_DAY_VALUE,
      label: 'Inbox',
      description: 'Unassigned activity',
    },
    ...planner.days.map((day) => ({
      value: day.id,
      label: `Day ${day.day_index + 1}`,
      description: day.date ? format(new Date(day.date), 'EEE, MMM d') : null,
    })),
  ];
  const editorDayLabel = findDayLabel(planner, editorState?.defaultTripDayId ?? null);
  const detailsDayLabel = findDayLabel(planner, detailsActivity?.trip_day_id ?? null);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          autoScroll={false}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <div className="min-h-0 flex-1">
            <PlannerMapView
              trip={planner.trip}
              tripId={tripId}
              tripVersion={planner.trip.version}
              travelMode={planner.trip.route_travel_mode}
              days={planner.days}
              inboxActivities={planner.inbox_activities}
              initialMapCenter={plannerMapSeed.center}
              isDragActive={Boolean(activeActivity)}
              selectedActivityId={selectedActivityId}
              selectedPlaceId={selectedPlaceId}
              recommendations={recommendations}
              selectedRecommendation={selectedRecommendation}
              onAddActivity={openCreateDrawer}
              onSelectActivityId={handleMapSelectActivityId}
              onSelectPlaceId={setSelectedPlaceId}
              onSelectRecommendation={setSelectedRecommendation}
              onClearMapSelection={() => {
                setSelectedActivityId(null);
                setSelectedPlaceId(null);
              }}
              onEditActivity={openEditDrawer}
              onDeleteActivity={handleDeleteActivity}
              onRegisterSectionOpener={(opener) => {
                openRailSectionRef.current = opener;
              }}
              onOpenCollaboration={() => setCollaborationMenuOpen(true)}
              onOpenGeneration={handleOpenGenerationInline}
              assistantSuggestedPlace={assistantSuggestedPlace}
              onAssistantSuggestedPlaceHandled={() => setAssistantSuggestedPlace(null)}
            />
          </div>

          <DragOverlay adjustScale={false}>
            {activeActivity ? (
              <div
                className="opacity-95"
                style={{
                  width: activeDragPreviewSize?.width,
                  height: activeDragPreviewSize?.height,
                }}
              >
                <ActivityCardView activity={activeActivity} isDragging showDragHandle />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <ActivityMapDetailSheet
        open={Boolean(detailsActivity)}
        tripId={tripId}
        activity={detailsActivity}
        dayLabel={detailsDayLabel}
        onClose={() => setDetailsActivityId(null)}
        onEdit={openEditDrawer}
        onDelete={handleDeleteActivity}
      />

      <ActivityDrawer
        tripId={tripId}
        open={Boolean(editorState)}
        activity={editorActivity}
        defaultTripDayId={editorState?.defaultTripDayId ?? null}
        defaultCategory={editorState?.defaultCategory ?? null}
        defaultDayLabel={editorDayLabel}
        dayOptions={activityDayOptions}
        onClose={closeEditor}
        onSave={handleDrawerSave}
        isSaving={isSaving}
      />

      <TripSettingsMenu
        tripId={tripId}
        open={settingsMenuOpen}
        onOpenChange={setSettingsMenuOpen}
        collaborationOpen={collaborationMenuOpen}
        onCollaborationOpenChange={setCollaborationMenuOpen}
        hasActivities={hasActivities}
        onReset={handleReset}
      />
      <PlannerAssistantPanel
        tripId={tripId}
        destination={planner.trip.destination_text ?? ''}
        days={planner.days as Day[]}
        hasActivities={hasActivities}
        isOpen={assistantPanelOpen}
        requestedInlineAction={assistantInlineAction}
        onRequestedInlineActionHandled={handleRequestedInlineActionHandled}
        onSubmitInlineAction={handleAssistantInlineActionSubmit}
        isPlannerActionPending={generateMutation.isPending || resetMutation.isPending}
        onOpenChange={handleAssistantPanelOpenChange}
        onSelectSuggestedPlace={(place) => {
          setSelectedActivityId(null);
          setSelectedPlaceId(null);
          setSelectedRecommendation(null);
          setAssistantSuggestedPlace(place);
        }}
      />
    </div>
  );
}
