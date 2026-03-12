import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { toast } from "sonner";
import { config } from "@/app/config";
import {
  useGenerateItinerary,
  useJob,
  useRegenerateItinerary,
  useResetItinerary,
} from "@/entities/job/queries";
import { getPlanner } from "@/entities/planner/api";
import { plannerKeys, usePlanner } from "@/entities/planner/queries";
import { isConflict, isRateLimit } from "@/shared/api/client";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { isJobSuccessful, isJobTerminal } from "@/shared/lib/jobs";
import { usePlannerStore } from "@/shared/stores/planner.store";
import { useSideRailStore } from "@/shared/stores/side-rail.store";
import type {
  ActivityCreateInput,
  PlannerActivity,
  PlannerGenerationReport,
  PlannerResponse,
  TripGenerateInput,
} from "@/shared/api/types";
import { Skeleton } from "@/components/ui/skeleton";
import type { ComboboxOption } from "@/components/ui/combobox";
import { ActivityCardView } from "./ActivityCard";
import { ActivityDrawer } from "./ActivityDrawer";
import { ActivityMapDetailSheet, PlannerMapView } from "./PlannerMapView";
import type { PlannerRecommendationEntry } from "./usePlannerRecommendations";
import { usePlannerRecommendations } from "./usePlannerRecommendations";
import { TripSettingsMenu } from "./TripSettingsMenu";

interface Props {
  tripId: string;
}
type PlannerContainerId = "inbox" | string;
type ActivityLocation = {
  containerId: PlannerContainerId;
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
} | null;

const INBOX_CONTAINER_ID = "inbox";
const INBOX_DAY_VALUE = "__inbox__";
const CHIP_PREFIX = "chip::";
const END_SUFFIX = "::end";

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

function getEndZoneId(containerId: PlannerContainerId) {
  return `${containerId}${END_SUFFIX}`;
}

export function resolveDragPreviewSize(
  event: Pick<DragStartEvent, "active" | "activatorEvent">,
): DragPreviewSize | null {
  const sourceRect =
    event.active.rect.current.initial ?? event.active.rect.current.translated;
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

  const sourceCard = activatorTarget.closest("article");
  if (!sourceCard) {
    return null;
  }

  const fallbackRect = sourceCard.getBoundingClientRect();
  return {
    width: fallbackRect.width,
    height: fallbackRect.height,
  };
}

function normalizeActivityList(
  activities: PlannerActivity[],
  tripDayId: string | null,
) {
  return activities.map((activity, index) => ({
    ...activity,
    trip_day_id: tripDayId,
    order_index: index,
    start_time: tripDayId == null ? null : activity.start_time,
  }));
}

function getContainerActivities(
  planner: PlannerResponse,
  containerId: PlannerContainerId,
) {
  if (containerId === INBOX_CONTAINER_ID) {
    return planner.inbox_activities;
  }
  return planner.days.find((day) => day.id === containerId)?.activities ?? [];
}

function setContainerActivities(
  planner: PlannerResponse,
  containerId: PlannerContainerId,
  activities: PlannerActivity[],
) {
  if (containerId === INBOX_CONTAINER_ID) {
    planner.inbox_activities = normalizeActivityList(activities, null);
    return;
  }
  const day = planner.days.find((item) => item.id === containerId);
  if (!day) {
    return;
  }
  day.activities = normalizeActivityList(activities, day.id);
}

function findActivityLocation(
  planner: PlannerResponse | undefined,
  activityId: string | null,
): ActivityLocation | null {
  if (!planner || !activityId) {
    return null;
  }

  const inboxIndex = planner.inbox_activities.findIndex(
    (activity) => activity.id === activityId,
  );
  if (inboxIndex >= 0) {
    return {
      containerId: INBOX_CONTAINER_ID,
      dayId: null,
      index: inboxIndex,
    };
  }

  for (const day of planner.days) {
    const index = day.activities.findIndex(
      (activity) => activity.id === activityId,
    );
    if (index >= 0) {
      return {
        containerId: day.id,
        dayId: day.id,
        index,
      };
    }
  }

  return null;
}

function findActivity(
  planner: PlannerResponse | undefined,
  activityId: string | null,
) {
  if (!planner || !activityId) {
    return null;
  }

  const inboxActivity = planner.inbox_activities.find(
    (activity) => activity.id === activityId,
  );
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
    const containerId = overId.slice(CHIP_PREFIX.length);
    if (containerId === INBOX_CONTAINER_ID) {
      return {
        containerId,
        dayId: null,
        index: planner.inbox_activities.length,
      };
    }
    const day = planner.days.find((item) => item.id === containerId);
    return day
      ? {
          containerId: day.id,
          dayId: day.id,
          index: day.activities.length,
        }
      : null;
  }

  if (
    overId === INBOX_CONTAINER_ID ||
    overId === getEndZoneId(INBOX_CONTAINER_ID)
  ) {
    return {
      containerId: INBOX_CONTAINER_ID,
      dayId: null,
      index: planner.inbox_activities.length,
    };
  }

  if (overId.endsWith(END_SUFFIX)) {
    const containerId = overId.slice(0, -END_SUFFIX.length);
    const day = planner.days.find((item) => item.id === containerId);
    return day
      ? {
          containerId: day.id,
          dayId: day.id,
          index: day.activities.length,
        }
      : null;
  }

  if (planner.days.some((day) => day.id === overId)) {
    const day = planner.days.find((item) => item.id === overId);
    return day
      ? {
          containerId: day.id,
          dayId: day.id,
          index: day.activities.length,
        }
      : null;
  }

  return findActivityLocation(planner, overId);
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

  const nextPlanner = clonePlanner(planner);
  const sourceActivities = [
    ...getContainerActivities(nextPlanner, source.containerId),
  ];
  const targetActivities =
    source.containerId === target.containerId
      ? sourceActivities
      : [...getContainerActivities(nextPlanner, target.containerId)];

  const sourceIndex = sourceActivities.findIndex(
    (activity) => activity.id === activityId,
  );
  const [activity] = sourceActivities.splice(sourceIndex, 1);
  if (!activity) {
    return null;
  }

  const insertionIndex =
    source.containerId === target.containerId && target.index > source.index
      ? target.index - 1
      : target.index;
  const safeIndex = Math.max(
    0,
    Math.min(insertionIndex, targetActivities.length),
  );
  const nextActivity: PlannerActivity = {
    ...activity,
    trip_day_id: target.dayId,
    start_time: target.dayId == null ? null : activity.start_time,
    legacy_source_day_id:
      target.dayId ?? activity.legacy_source_day_id ?? source.dayId,
    legacy_inbox_item: target.dayId == null,
  };
  targetActivities.splice(safeIndex, 0, nextActivity);

  setContainerActivities(nextPlanner, source.containerId, sourceActivities);
  setContainerActivities(nextPlanner, target.containerId, targetActivities);
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
    result:
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : null,
    error:
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : null,
  };
}

function findDayLabel(
  planner: PlannerResponse | null | undefined,
  tripDayId: string | null,
) {
  if (!planner || !tripDayId) {
    return null;
  }
  const day = planner.days.find((item) => item.id === tripDayId);
  if (!day) {
    return null;
  }
  return `Day ${day.day_index + 1} · ${format(new Date(day.date), "EEE, MMM d")}`;
}

export default function PlannerBoard({ tripId }: Props) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [editorState, setEditorState] = useState<EditorState>(null);
  const [detailsActivityId, setDetailsActivityId] = useState<string | null>(
    null,
  );
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<PlannerRecommendationEntry | null>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const setPlannerInstruments = useSideRailStore((s) => s.setPlannerInstruments);
  useEffect(() => {
    setPlannerInstruments({ onOpenSettings: () => setSettingsMenuOpen(true) });
    return () => { setPlannerInstruments(null); };
  }, [setPlannerInstruments]);
  const [activeActivity, setActiveActivity] = useState<PlannerActivity | null>(
    null,
  );
  const [activeDragPreviewSize, setActiveDragPreviewSize] =
    useState<DragPreviewSize | null>(null);
  const prevJobStatus = useRef<string | null>(null);
  const lastOverIdRef = useRef<UniqueIdentifier | null>(null);
  const dragOriginPlannerRef = useRef<PlannerResponse | null>(null);

  const { data: planner, isLoading, isError } = usePlanner(tripId);

  const {
    pendingJobIds,
    setPendingJobId,
    clearPendingJobId,
    generationReports,
    setGenerationReport,
    clearGenerationReport,
  } = usePlannerStore();

  const pendingJobId = pendingJobIds[tripId] ?? null;
  const latestReport = generationReports[tripId];
  const currentJob = useJob(pendingJobId);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const generateMutation = useGenerateItinerary(tripId);
  const regenerateMutation = useRegenerateItinerary(tripId);
  const resetMutation = useResetItinerary(tripId);

  const allActivities = useMemo(
    () =>
      planner
        ? [
            ...planner.inbox_activities,
            ...planner.days.flatMap((day) => day.activities),
          ]
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
      const collisions =
        intersections.length > 0 ? intersections : rectIntersection(args);
      let overId = getFirstCollision(collisions, "id");

      if (overId != null && planner) {
        const resolved = resolveDropTarget(planner, String(overId));
        const isChip = String(overId).startsWith(CHIP_PREFIX);
        if (resolved && !isChip) {
          const containerItems = getContainerActivities(
            planner,
            resolved.containerId,
          );
          if (containerItems.length > 0) {
            const itemIds = new Set(
              containerItems.map((activity) => activity.id),
            );
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

      return lastOverIdRef.current != null
        ? [{ id: lastOverIdRef.current }]
        : [];
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
    setGenerationReport(
      tripId,
      buildReport(job.id, job.status, job.result, job.error),
    );

    if (isJobSuccessful(job.status)) {
      qc.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
      clearPendingJobId(tripId);
      toast.success("Planner updated");
      return;
    }

    clearPendingJobId(tripId);
    toast.error("Planner generation failed");
  }, [
    clearPendingJobId,
    currentJob.data,
    pendingJobId,
    qc,
    setGenerationReport,
    tripId,
  ]);

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
  };

  const openDetails = (activity: PlannerActivity) => {
    setEditorState(null);
    setDetailsActivityId(activity.id);
  };

  const openCreateDrawer = (defaultTripDayId: string | null) => {
    setDetailsActivityId(null);
    setEditorState({ activityId: null, defaultTripDayId });
  };

  const openEditDrawer = (activity: PlannerActivity) => {
    setDetailsActivityId(null);
    setEditorState({
      activityId: activity.id,
      defaultTripDayId: activity.trip_day_id ?? null,
    });
  };

  const closeEditor = () => setEditorState(null);

  const handleDrawerSave = async (data: ActivityCreateInput) => {
    if (!planner) {
      return;
    }
    setIsSaving(true);

    try {
      if (editorActivity) {
        const { moveActivity, patchActivity } =
          await import("@/entities/activity/api");
        const nextTripDayId = data.trip_day_id ?? null;
        const targetDay = nextTripDayId
          ? (planner.days.find((day) => day.id === nextTripDayId) ?? null)
          : null;
        const targetIndex = nextTripDayId
          ? Math.max(
              0,
              targetDay?.activities.filter(
                (item) => item.id !== editorActivity.id,
              ).length ?? 0,
            )
          : Math.max(
              0,
              planner.inbox_activities.filter(
                (item) => item.id !== editorActivity.id,
              ).length,
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

        const { trip_day_id: _tripDayId, ...patchPayload } = data;
        await patchActivity(editorActivity.id, {
          ...patchPayload,
          start_time:
            nextTripDayId == null ? null : (patchPayload.start_time ?? null),
        });
        toast.success("Activity updated");
      } else if (editorState) {
        const idempotencyKey = crypto.randomUUID();
        const { createPlannerActivity } =
          await import("@/entities/activity/api");
        await createPlannerActivity(tripId, data, idempotencyKey);
        toast.success("Activity added");
      }

      await invalidatePlanner();
      closeEditor();
    } catch (error) {
      if (isRateLimit(error)) {
        toast.error("Too many requests. Please wait a moment.");
      } else {
        toast.error("Failed to save activity");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteActivity = async (activityId: string) => {
    try {
      const { deleteActivity } = await import("@/entities/activity/api");
      await deleteActivity(activityId);
      toast.success("Activity removed");
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
      toast.error("Failed to remove activity");
    }
  };

  const submitGeneration = async (
    action: "generate" | "regenerate",
    data: {
      mode: "replace" | "merge" | "append";
      day_ids?: string[];
      seed?: number;
    },
    idempotencyKey: string,
  ) => {
    if (!planner) {
      return;
    }

    const payload: TripGenerateInput = {
      mode: data.mode,
      day_ids: data.day_ids && data.day_ids.length > 0 ? data.day_ids : null,
      constraints: {},
      seed: data.seed ?? null,
    };

    clearGenerationReport(tripId);
    const mutation =
      action === "generate" ? generateMutation : regenerateMutation;
    const accepted = await mutation.mutateAsync({
      data: payload,
      tripVersion: planner.trip.version,
      idempotencyKey,
    });
    prevJobStatus.current = null;
    setPendingJobId(tripId, accepted.job_id);
  };

  const handleGenerate = async (
    data: {
      mode: "replace" | "merge" | "append";
      day_ids?: string[];
      seed?: number;
    },
    idempotencyKey: string,
  ) => {
    try {
      await submitGeneration("generate", data, idempotencyKey);
      toast.success("Planner generation queued");
    } catch (error) {
      if (isConflict(error)) {
        toast.error("Trip changed. Refresh the planner and try again.");
      } else {
        toast.error("Failed to queue planner generation");
      }
    }
  };

  const handleRegenerate = async (
    data: {
      mode: "replace" | "merge" | "append";
      day_ids?: string[];
      seed?: number;
    },
    idempotencyKey: string,
  ) => {
    try {
      await submitGeneration("regenerate", data, idempotencyKey);
      toast.success("Planner regeneration queued");
    } catch (error) {
      if (isConflict(error)) {
        toast.error("Trip changed. Refresh the planner and try again.");
      } else {
        toast.error("Failed to queue planner regeneration");
      }
    }
  };

  const handleReset = async (
    dayIds: string[] | undefined,
    idempotencyKey: string,
  ) => {
    if (!planner) {
      return;
    }
    try {
      clearGenerationReport(tripId);
      const accepted = await resetMutation.mutateAsync({
        data: {
          day_ids:
            dayIds && dayIds.length > 0
              ? dayIds
              : planner.days.map((day) => day.id),
        },
        tripVersion: planner.trip.version,
        idempotencyKey,
      });
      prevJobStatus.current = null;
      setPendingJobId(tripId, accepted.job_id);
      toast.success("Generated activities reset queued");
    } catch (error) {
      if (isConflict(error)) {
        toast.error("Trip changed. Refresh the planner and try again.");
      } else {
        toast.error("Failed to queue reset");
      }
    }
  };

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
    const currentPlanner =
      qc.getQueryData<PlannerResponse>(plannerKeys.detail(tripId)) ?? planner;
    if (!currentPlanner || !overId) {
      return;
    }

    const source = findActivityLocation(currentPlanner, activityId);
    const target = resolveDropTarget(currentPlanner, overId);
    if (!source || !target) {
      return;
    }
    if (
      source.containerId === target.containerId &&
      source.index === target.index
    ) {
      return;
    }

    const nextPlanner = updatePlannerActivityLists(
      currentPlanner,
      activityId,
      target,
    );
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
    const currentPlanner =
      qc.getQueryData<PlannerResponse>(plannerKeys.detail(tripId)) ?? planner;

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

    const startLocation = findActivityLocation(
      originPlanner,
      capturedActivity.id,
    );
    const finalLocation = findActivityLocation(
      currentPlanner,
      capturedActivity.id,
    );
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
      const { moveActivity, reorderActivities } =
        await import("@/entities/activity/api");

      const shouldUseDayReorder =
        startLocation.containerId === finalLocation.containerId &&
        finalLocation.containerId !== INBOX_CONTAINER_ID &&
        finalLocation.dayId != null;

      if (shouldUseDayReorder) {
        const reorderedDay = currentPlanner.days.find(
          (day) => day.id === finalLocation.dayId,
        );
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
          target_index: Math.max(finalLocation.index, 0),
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
      toast.error("Failed to move activity");
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

  if (isError || !planner) {
    return (
      <div className="p-4 md:p-5">
        <div className="rounded-[12px] border border-black/8 bg-white p-5 text-sm text-[var(--color-text-muted)]">
          Failed to load the planner workspace.
        </div>
      </div>
    );
  }

  const activityDayOptions: ComboboxOption[] = [
    {
      value: INBOX_DAY_VALUE,
      label: "Inbox",
      description: "Unassigned activity",
    },
    ...planner.days.map((day) => ({
      value: day.id,
      label: `Day ${day.day_index + 1}`,
      description: day.date ? format(new Date(day.date), "EEE, MMM d") : null,
    })),
  ];
  const editorDayLabel = findDayLabel(
    planner,
    editorState?.defaultTripDayId ?? null,
  );
  const detailsDayLabel = findDayLabel(
    planner,
    detailsActivity?.trip_day_id ?? null,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
              tripId={tripId}
              tripVersion={planner.trip.version}
              travelMode={planner.trip.route_travel_mode}
              days={planner.days}
              inboxActivities={planner.inbox_activities}
              isDragActive={Boolean(activeActivity)}
              selectedActivityId={selectedActivityId}
              selectedPlaceId={selectedPlaceId}
              recommendations={recommendations}
              selectedRecommendation={selectedRecommendation}
              trip={planner.trip}
              onAddActivity={openCreateDrawer}
              onSelectActivityId={handleMapSelectActivityId}
              onSelectPlaceId={setSelectedPlaceId}
              onSelectRecommendation={setSelectedRecommendation}
              onClearMapSelection={() => { setSelectedActivityId(null); setSelectedPlaceId(null); }}
              onEditActivity={openEditDrawer}
              onDeleteActivity={handleDeleteActivity}
              onOpenSettings={() => setSettingsMenuOpen(true)}
              hasActivities={hasActivities}
              onGenerate={handleGenerate}
              onRegenerate={handleRegenerate}
              onReset={handleReset}
              isGenerating={
                generateMutation.isPending ||
                regenerateMutation.isPending ||
                resetMutation.isPending
              }
              jobStatus={currentJob.data?.status ?? latestReport?.status ?? null}
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
                <ActivityCardView
                  activity={activeActivity}
                  isDragging
                  showDragHandle
                />
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
        open={Boolean(editorState)}
        activity={editorActivity}
        defaultTripDayId={editorState?.defaultTripDayId ?? null}
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
      />
    </div>
  );
}
