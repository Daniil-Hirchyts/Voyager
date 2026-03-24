import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { config } from '@/app/config';
import { useJob } from '@/entities/job/queries';
import { usePlanner } from '@/entities/planner/queries';
import { isApiError, triggerUnauthorizedHandler } from '@/shared/api/client';
import { usePlannerStore } from '@/shared/stores/planner.store';
import type { Day, PlannerActivity } from '@/shared/api/types';
import { Skeleton } from '@/components/ui/skeleton';
import type { ComboboxOption } from '@/components/ui/combobox';
import { ActivityCardView } from './ActivityCard';
import { ActivityDrawer } from './ActivityDrawer';
import { PlannerAssistantPanel } from '@/widgets/planner-assistant';
import {
  ActivityMapDetailSheet,
  PlannerMapView,
  type PlannerAssistantSuggestedPlace,
} from './PlannerMapView';
import { TripSettingsMenu } from './TripSettingsMenu';
import type { PlannerRecommendationEntry } from './usePlannerRecommendations';
import { usePlannerRecommendations } from './usePlannerRecommendations';
import {
  INBOX_DAY_VALUE,
  findPlannerDayLabel,
  parsePlannerMapSeed,
} from './planner-board.utils';
import { usePlannerBoardActions, type PlannerBoardEditorState } from './usePlannerBoardActions';
import { usePlannerBoardDnd, findActivity } from './usePlannerBoardDnd';
import { usePlannerBoardInstruments } from './usePlannerBoardInstruments';
import { usePlannerBoardJobSync } from './usePlannerBoardJobSync';

interface Props {
  tripId: string;
}

export default function PlannerBoard({ tripId }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [editorState, setEditorState] = useState<PlannerBoardEditorState>(null);
  const [detailsActivityId, setDetailsActivityId] = useState<string | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<PlannerRecommendationEntry | null>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [collaborationMenuOpen, setCollaborationMenuOpen] = useState(false);
  const [assistantSuggestedPlace, setAssistantSuggestedPlace] =
    useState<PlannerAssistantSuggestedPlace | null>(null);
  const openRailSectionRef = useRef<((sectionKey: string) => void) | null>(null);

  const pendingJobIds = usePlannerStore((state) => state.pendingJobIds);
  const clearPendingJobId = usePlannerStore((state) => state.clearPendingJobId);
  const setGenerationReport = usePlannerStore((state) => state.setGenerationReport);
  const assistantPanelOpenByTrip = usePlannerStore((state) => state.assistantPanelOpenByTrip);

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

  usePlannerBoardInstruments({
    tripId,
    plannerDays,
    openRailSectionRef,
    setSettingsMenuOpen,
    setCollaborationMenuOpen,
  });

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

  useEffect(() => {
    if (!recommendations.enabled) {
      setSelectedRecommendation(null);
    }
  }, [recommendations.enabled]);

  const {
    assistantInlineAction,
    isSaving,
    generateMutation,
    resetMutation,
    prevJobStatusRef,
    mirroredAssistantJobIdsRef,
    closeEditor,
    handleDrawerSave,
    handleDeleteActivity,
    handleReset,
    handleAssistantInlineActionSubmit,
    handleRequestedInlineActionHandled,
    handleAssistantPanelOpenChange,
    handleOpenGenerationInline,
  } = usePlannerBoardActions({
    tripId,
    planner,
    editorState,
    editorActivity,
    detailsActivityId,
    selectedActivityId,
    setDetailsActivityId,
    setEditorState,
    setSelectedActivityId,
    setSelectedPlaceId,
  });

  usePlannerBoardJobSync({
    tripId,
    pendingJobId,
    job: currentJob.data,
    queryClient,
    clearPendingJobId,
    setGenerationReport,
    prevJobStatusRef,
    mirroredAssistantJobIdsRef,
  });

  const {
    activeActivity,
    activeDragPreviewSize,
    collisionDetectionStrategy,
    handleDragStart,
    handleDragOver,
    handleDragCancel,
    handleDragEnd,
  } = usePlannerBoardDnd({
    tripId,
    planner,
    queryClient,
  });

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
  const editorDayLabel = findPlannerDayLabel(planner, editorState?.defaultTripDayId ?? null);
  const detailsDayLabel = findPlannerDayLabel(planner, detailsActivity?.trip_day_id ?? null);

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
