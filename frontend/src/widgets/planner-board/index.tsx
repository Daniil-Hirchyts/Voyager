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
import { Check, Compass, LayoutGrid, MapPinned, Settings2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
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
import { formatMoney } from "@/shared/lib/format";
import { isJobSuccessful, isJobTerminal } from "@/shared/lib/jobs";
import { usePlannerStore } from "@/shared/stores/planner.store";
import type {
  ActivityCreateInput,
  PlannerActivity,
  PlannerGenerationReport,
  PlannerResponse,
  TripGenerateInput,
} from "@/shared/api/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAppShellHeaderActions,
  useAppShellHeaderLeadingActions,
  useAppShellHeaderMeta,
} from "@/widgets/app-shell";
import { ActivityCardView } from "./ActivityCard";
import { ActivityDrawer } from "./ActivityDrawer";
import { DayColumn } from "./DayColumn";
import { GenerationControls } from "./GenerationControls";
import { PlannerInbox } from "./PlannerInbox";
import { ActivityMapDetailSheet, PlannerMapView } from "./PlannerMapView";
import {
  PlannerRecommendationDetailPanel,
  PlannerRecommendationsPanel,
} from "./PlannerRecommendations";
import type { PlannerRecommendationEntry } from "./usePlannerRecommendations";
import { usePlannerRecommendations } from "./usePlannerRecommendations";
import { ExportMenu } from "./ExportMenu";
import { TripSettingsMenu } from "./TripSettingsMenu";

interface Props {
  tripId: string;
}

type PlannerView = "kanban" | "map";
type PlannerContainerId = "inbox" | string;
type ActivityLocation = {
  containerId: PlannerContainerId;
  dayId: string | null;
  index: number;
};
type EditorState = {
  activityId: string | null;
  defaultTripDayId: string | null;
} | null;

const INBOX_CONTAINER_ID = "inbox";
const INBOX_DAY_VALUE = "__inbox__";
const CHIP_PREFIX = "chip::";
const END_SUFFIX = "::end";
const EDGE_SCROLL_THRESHOLD = 80;
const EDGE_SCROLL_STEP = 18;

function getView(
  raw: string | null,
  fallback: PlannerView = "kanban",
): PlannerView {
  if (raw === "map") {
    return "map";
  }
  if (raw === "kanban") {
    return "kanban";
  }
  return fallback;
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [editorState, setEditorState] = useState<EditorState>(null);
  const [detailsActivityId, setDetailsActivityId] = useState<string | null>(
    null,
  );
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<PlannerRecommendationEntry | null>(null);
  const [boardRecommendationsOpen, setBoardRecommendationsOpen] =
    useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [mobileContainerId, setMobileContainerId] =
    useState<PlannerContainerId>(INBOX_CONTAINER_ID);
  const [isInboxDetached, setIsInboxDetached] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeActivity, setActiveActivity] = useState<PlannerActivity | null>(
    null,
  );
  const previousViewRef = useRef<PlannerView | null>(null);
  const prevJobStatus = useRef<string | null>(null);
  const lastOverIdRef = useRef<UniqueIdentifier | null>(null);
  const dragOriginPlannerRef = useRef<PlannerResponse | null>(null);
  const boardRailRef = useRef<HTMLDivElement | null>(null);
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const edgeScrollFrameRef = useRef<number | null>(null);

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
  const boardSelectedActivity = useMemo(
    () =>
      findActivity(planner, detailsActivityId) ??
      findActivity(planner, editorState?.activityId ?? null),
    [detailsActivityId, editorState?.activityId, planner],
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
  const currentView = getView(
    searchParams.get("view"),
    recommendations.preferences.map.defaultPlannerView,
  );

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
    if (currentView !== "kanban") {
      setDetailsActivityId(null);
    }
  }, [currentView]);

  useEffect(() => {
    const previousView = previousViewRef.current;
    if (currentView === "map" && previousView !== "map") {
      if (selectedRecommendation) {
        setSelectedRecommendation(null);
      }
      if (selectedActivityId || selectedPlaceId) {
        setSelectedActivityId(null);
        setSelectedPlaceId(null);
      }
    }
    previousViewRef.current = currentView;
  }, [
    currentView,
    selectedActivityId,
    selectedPlaceId,
    selectedRecommendation,
  ]);

  useEffect(() => {
    if (!recommendations.enabled) {
      setSelectedRecommendation(null);
      setBoardRecommendationsOpen(false);
    }
  }, [recommendations.enabled]);

  useEffect(() => {
    if (currentView !== "kanban") {
      setBoardRecommendationsOpen(false);
    }
  }, [currentView]);

  useEffect(() => {
    if (!planner) {
      return;
    }
    const validContainerIds = new Set<PlannerContainerId>([
      INBOX_CONTAINER_ID,
      ...planner.days.map((day) => day.id),
    ]);
    if (!validContainerIds.has(mobileContainerId)) {
      setMobileContainerId(INBOX_CONTAINER_ID);
    }
  }, [mobileContainerId, planner]);

  useEffect(() => {
    if (!activeActivity || currentView !== "kanban" || isMobile) {
      if (edgeScrollFrameRef.current != null) {
        window.cancelAnimationFrame(edgeScrollFrameRef.current);
        edgeScrollFrameRef.current = null;
      }
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
    };

    const tick = () => {
      const rail = boardRailRef.current;
      const pointer = pointerPositionRef.current;
      if (rail && pointer) {
        const rect = rail.getBoundingClientRect();
        if (pointer.x < rect.left + EDGE_SCROLL_THRESHOLD) {
          rail.scrollLeft -= EDGE_SCROLL_STEP;
        } else if (pointer.x > rect.right - EDGE_SCROLL_THRESHOLD) {
          rail.scrollLeft += EDGE_SCROLL_STEP;
        }
      }
      edgeScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", handlePointerMove);
    edgeScrollFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (edgeScrollFrameRef.current != null) {
        window.cancelAnimationFrame(edgeScrollFrameRef.current);
        edgeScrollFrameRef.current = null;
      }
    };
  }, [activeActivity, currentView, isMobile]);

  const updateParams = (
    updates: Record<string, string | null>,
    replace = false,
  ) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    });
    setSearchParams(next, { replace });
  };

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

  const openRecommendationsDrawer = () => {
    setSelectedRecommendation(null);
    setBoardRecommendationsOpen(true);
  };

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
    setActiveActivity(findActivity(planner, String(event.active.id)));
    pointerPositionRef.current = null;
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
    if (isMobile && overId.startsWith(CHIP_PREFIX)) {
      setMobileContainerId(target.containerId);
    }
    qc.setQueryData(plannerKeys.detail(tripId), nextPlanner);
  };

  const handleDragCancel = () => {
    setActiveActivity(null);
    lastOverIdRef.current = null;
    pointerPositionRef.current = null;
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
    lastOverIdRef.current = null;
    pointerPositionRef.current = null;
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

  const recommendationsAction = useMemo(
    () =>
      currentView === "kanban" && recommendations.enabled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={openRecommendationsDrawer}
        >
          <Compass className="h-3.5 w-3.5" />
          Recommendations
        </Button>
      ) : null,
    [currentView, openRecommendationsDrawer, recommendations.enabled],
  );

  const headerLeadingActions = useMemo(
    () => (planner && !isMobile ? recommendationsAction : null),
    [isMobile, planner, recommendationsAction],
  );

  const headerActions = useMemo(
    () =>
      planner ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 pb-1 -mb-1 md:flex-none">
          
          {/* Desktop Layout */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <Tabs
              value={currentView}
              onValueChange={(value) => updateParams({ view: value }, false)}
            >
              <TabsList className="h-8 rounded-[8px] border border-black/8 bg-[var(--color-secondary-surface)] p-0.5">
                <TabsTrigger
                  value="kanban"
                  className="h-7 rounded-[6px] px-2.5 text-[0.78rem] min-w-8"
                >
                  <LayoutGrid className="sm:mr-1.5 h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden sm:inline">Board</span>
                </TabsTrigger>
                <TabsTrigger
                  value="map"
                  className="h-7 rounded-[6px] px-2.5 text-[0.78rem] min-w-8"
                >
                  <MapPinned className="sm:mr-1.5 h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden sm:inline">Map</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-[8px] px-2.5 min-w-8"
              onClick={() => setSettingsMenuOpen(true)}
            >
              <Settings2 className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Settings</span>
            </Button>

            {recommendationsAction}
            
            <ExportMenu tripId={tripId} tripVersion={planner.trip.version} />

            <GenerationControls
              compact
              days={planner.days}
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

          {/* Mobile Layout */}
          <div className="flex md:hidden items-center gap-2 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 rounded-full">
                  <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
                  Options
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 rounded-[12px]">
                <DropdownMenuLabel>View</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => updateParams({ view: 'kanban' }, false)}>
                  <LayoutGrid className="mr-2 h-4 w-4" />
                  <span>Board view</span>
                  {currentView === 'kanban' && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => updateParams({ view: 'map' }, false)}>
                  <MapPinned className="mr-2 h-4 w-4" />
                  <span>Map view</span>
                  {currentView === 'map' && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
                
                <div className="my-1 h-px bg-black/8" />
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {recommendations.enabled && (
                  <DropdownMenuItem onClick={openRecommendationsDrawer}>
                    <Compass className="mr-2 h-4 w-4" />
                    <span>Recommendations</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setSettingsMenuOpen(true)}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  <span>Trip settings</span>
                </DropdownMenuItem>
                
                <div className="my-1 h-px bg-black/8" />
                <DropdownMenuLabel>Export</DropdownMenuLabel>
                <ExportMenu tripId={tripId} tripVersion={planner.trip.version} asMenuItems />
                
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Render Generation controls on mobile outside the menu */}
          <div className="md:hidden">
            <GenerationControls
              compact
              days={planner.days}
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

        </div>
      ) : null,
    [
      currentJob.data?.status,
      currentView,
      generateMutation.isPending,
      handleGenerate,
      handleRegenerate,
      handleReset,
      hasActivities,
      isMobile,
      latestReport?.status,
      planner,
      recommendationsAction,
      regenerateMutation.isPending,
      resetMutation.isPending,
      updateParams,
    ],
  );

  const headerMeta = useMemo(
    () =>
      planner ? (
        <div className="flex min-w-0 items-center gap-x-2 truncate">
          <span className="truncate font-medium text-[var(--color-text)]">
            {planner.trip.title}
          </span>
          <span className="hidden text-black/20 lg:inline">•</span>
          <span className="truncate">{planner.trip.destination_text}</span>
          <span className="hidden text-black/20 lg:inline">•</span>
          <span className="truncate">{`${format(new Date(planner.trip.start_date), "MMM d")} - ${format(
            new Date(planner.trip.end_date),
            "MMM d, yyyy",
          )}`}</span>
          {planner.trip.budget_amount && planner.trip.budget_currency ? (
            <>
              <span className="hidden text-black/20 xl:inline">•</span>
              <span className="truncate">{`Budget ${formatMoney(
                planner.trip.budget_amount,
                planner.trip.budget_currency,
              )}`}</span>
            </>
          ) : null}
        </div>
      ) : null,
    [planner],
  );

  const hasShellHeaderLeadingActions =
    useAppShellHeaderLeadingActions(headerLeadingActions);
  const hasShellHeaderActions = useAppShellHeaderActions(headerActions);
  useAppShellHeaderMeta(headerMeta);

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

  const mobileContainers = [
    {
      id: INBOX_CONTAINER_ID as PlannerContainerId,
      label: "Inbox",
      date: "Unassigned activities",
    },
    ...planner.days.map((day) => ({
      id: day.id as PlannerContainerId,
      label: `Day ${day.day_index + 1}`,
      date: day.date
        ? `${format(new Date(day.date), "EEEE")} · ${format(new Date(day.date), "MMM d, yyyy")}`
        : "",
    })),
  ];
  const activeMobileDay =
    planner.days.find((day) => day.id === mobileContainerId) ?? null;
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
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">
      {!hasShellHeaderActions && !hasShellHeaderLeadingActions ? (
        <section className="mb-3 rounded-[12px] border border-black/8 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            {headerLeadingActions ? (
              <div className="hidden shrink-0 items-center gap-2 lg:flex">
                {headerLeadingActions}
              </div>
            ) : null}
            {headerActions}
          </div>
        </section>
      ) : null}

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
          {currentView === "kanban" ? (
            <>
              {isMobile ? (
                <div className="flex min-h-0 flex-1 flex-col gap-4 lg:hidden">
                  <div data-testid="planner-mobile-day-select">
                    <Select
                      value={mobileContainerId}
                      onValueChange={setMobileContainerId}
                    >
                      <SelectTrigger className="w-full shadow-none border border-black/8 h-auto py-3 rounded-[12px] px-4 focus:ring-0 data-[state=open]:border-black/16 transition-all [&>span:first-child]:hidden bg-white hover:bg-[var(--color-secondary-surface)]">
                        <SelectValue />
                        <div className="flex w-full items-center justify-between gap-4">
                          <div className="flex flex-col items-start gap-0.5 text-left">
                            <span className="font-medium text-[0.92rem] text-[var(--color-text)]">
                              {mobileContainers.find(
                                (c) => c.id === mobileContainerId,
                              )?.label || "Select day"}
                            </span>
                            <span className="text-[0.78rem] text-[var(--color-text-muted)] font-normal">
                              {mobileContainers.find(
                                (c) => c.id === mobileContainerId,
                              )?.date || ""}
                            </span>
                          </div>
                        </div>
                      </SelectTrigger>
                      <SelectContent className="rounded-[12px] p-1.5 border-black/8 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.1)] w-[var(--radix-select-trigger-width)]">
                        {mobileContainers.map((container) => (
                          <SelectItem
                            key={container.id}
                            value={container.id}
                            className="rounded-[8px] py-2.5 cursor-pointer focus:bg-[var(--color-secondary-surface)]"
                          >
                            <div className="flex flex-col items-start gap-0.5 text-left w-full pr-1">
                              <span className="font-medium text-[0.92rem] text-[var(--color-text)]">
                                {container.label}
                              </span>
                              <span className="text-[0.78rem] text-[var(--color-text-muted)] font-normal">
                                {container.date}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col">
                    {mobileContainerId === INBOX_CONTAINER_ID ? (
                      <PlannerInbox
                        activities={planner.inbox_activities}
                        selectedActivityId={boardSelectedActivity?.id ?? null}
                        className="h-full"
                        onSelectActivity={openDetails}
                        onAddActivity={() => openCreateDrawer(null)}
                      />
                    ) : activeMobileDay ? (
                      <DayColumn
                        day={activeMobileDay}
                        selectedActivityId={boardSelectedActivity?.id ?? null}
                        onAddActivity={(dayId) => openCreateDrawer(dayId)}
                        onOpenActivity={openDetails}
                        className="h-full min-w-0"
                      />
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="hidden min-h-0 flex-1 gap-4 lg:flex">
                  {!isInboxDetached && (
                    <div className="h-full shrink-0 pb-1">
                      <PlannerInbox
                        activities={planner.inbox_activities}
                        selectedActivityId={boardSelectedActivity?.id ?? null}
                        className="h-full"
                        isDetached={false}
                        onToggleDetached={() => setIsInboxDetached(true)}
                        onSelectActivity={openDetails}
                        onAddActivity={() => openCreateDrawer(null)}
                      />
                    </div>
                  )}

                  <div
                    ref={boardRailRef}
                    data-testid="planner-board-rail"
                    className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-1"
                  >
                    <div className="flex h-full gap-4 pr-1">
                      {isInboxDetached && (
                        <PlannerInbox
                          activities={planner.inbox_activities}
                          selectedActivityId={boardSelectedActivity?.id ?? null}
                          className="h-full shrink-0"
                          isDetached={true}
                          onToggleDetached={() => setIsInboxDetached(false)}
                          onSelectActivity={openDetails}
                          onAddActivity={() => openCreateDrawer(null)}
                        />
                      )}
                      {planner.days.map((day) => (
                        <DayColumn
                          key={day.id}
                          day={day}
                          selectedActivityId={boardSelectedActivity?.id ?? null}
                          onAddActivity={(dayId) => openCreateDrawer(dayId)}
                          onOpenActivity={openDetails}
                          className="shrink-0"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}

          {currentView === "map" ? (
            <div className="min-h-0 flex-1">
              <PlannerMapView
                tripId={tripId}
                tripVersion={planner.trip.version}
                days={planner.days}
                inboxActivities={planner.inbox_activities}
                selectedActivityId={selectedActivityId}
                selectedPlaceId={selectedPlaceId}
                recommendations={recommendations}
                selectedRecommendation={selectedRecommendation}
                onAddActivity={openCreateDrawer}
                onSelectActivityId={handleMapSelectActivityId}
                onSelectPlaceId={setSelectedPlaceId}
                onSelectRecommendation={setSelectedRecommendation}
                onClearMapSelection={() => { setSelectedActivityId(null); setSelectedPlaceId(null); }}
                onEditActivity={openEditDrawer}
                onDeleteActivity={handleDeleteActivity}
              />
            </div>
          ) : null}

          <DragOverlay>
            {activeActivity ? (
              <div className="w-[320px] opacity-95">
                <ActivityCardView activity={activeActivity} isDragging />
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

      <Sheet
        open={
          currentView === "kanban" &&
          recommendations.enabled &&
          boardRecommendationsOpen
        }
        onOpenChange={(open) => {
          setBoardRecommendationsOpen(open);
          if (!open) {
            setSelectedRecommendation(null);
          }
        }}
      >
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          hideCloseButton={!selectedRecommendation}
          className={
            isMobile
              ? "flex h-[82dvh] flex-col overflow-hidden rounded-t-[24px] border-x-0 border-b-0 bg-[#F3F5F7] p-0 sm:max-w-none"
              : "flex h-full w-full max-w-[28rem] flex-col overflow-hidden bg-[#F3F5F7] p-0 sm:max-w-[28rem]"
          }
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{selectedRecommendation?.item.title ?? "Recommendations"}</SheetTitle>
            <SheetDescription>
              {selectedRecommendation?.item.address_text ?? "Trip recommendations"}
            </SheetDescription>
          </SheetHeader>
          {selectedRecommendation ? (
            <PlannerRecommendationDetailPanel
              tripId={tripId}
              locale={recommendations.preferences.regional.locale}
              entry={selectedRecommendation}
              recommendations={recommendations}
              onBack={() => setSelectedRecommendation(null)}
            />
          ) : (
            <PlannerRecommendationsPanel
              recommendations={recommendations}
              showCloseButton
            />
          )}
        </SheetContent>
      </Sheet>

      <TripSettingsMenu 
        tripId={tripId} 
        open={settingsMenuOpen} 
        onOpenChange={setSettingsMenuOpen} 
      />
    </div>
  );
}
