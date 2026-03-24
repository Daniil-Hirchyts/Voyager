import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useGenerateItinerary, useResetItinerary } from '@/entities/job/queries';
import { plannerKeys } from '@/entities/planner/queries';
import { tripAssetKeys } from '@/entities/trip-asset/queries';
import { isConflict, isRateLimit } from '@/shared/api/client';
import { usePlannerStore } from '@/shared/stores/planner.store';
import type { ActivityCreateInput, PlannerActivity, PlannerResponse, TripGenerateInput } from '@/shared/api/types';
import type { PlannerGenerationAction, PlannerGenerationFormValues } from './GenerationControls';
import { mirrorPlannerJobToAssistant } from '@/widgets/planner-assistant';

export type PlannerBoardEditorState = {
  activityId: string | null;
  defaultTripDayId: string | null;
  defaultCategory: PlannerActivity['category'] | null;
} | null;

type UsePlannerBoardActionsOptions = {
  tripId: string;
  planner: PlannerResponse | undefined;
  editorState: PlannerBoardEditorState;
  editorActivity: PlannerActivity | null;
  detailsActivityId: string | null;
  selectedActivityId: string | null;
  setDetailsActivityId: Dispatch<SetStateAction<string | null>>;
  setEditorState: Dispatch<SetStateAction<PlannerBoardEditorState>>;
  setSelectedActivityId: Dispatch<SetStateAction<string | null>>;
  setSelectedPlaceId: Dispatch<SetStateAction<string | null>>;
};

export function usePlannerBoardActions({
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
}: UsePlannerBoardActionsOptions) {
  const queryClient = useQueryClient();
  const setPendingJobId = usePlannerStore((state) => state.setPendingJobId);
  const clearGenerationReport = usePlannerStore((state) => state.clearGenerationReport);
  const setAssistantPanelOpen = usePlannerStore((state) => state.setAssistantPanelOpen);
  const [assistantInlineAction, setAssistantInlineAction] =
    useState<PlannerGenerationAction | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const prevJobStatusRef = useRef<string | null>(null);
  const mirroredAssistantJobIdsRef = useRef(new Set<string>());
  const generateMutation = useGenerateItinerary(tripId);
  const resetMutation = useResetItinerary(tripId);

  const closeEditor = useCallback(() => {
    setEditorState(null);
  }, [setEditorState]);

  const invalidatePlanner = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
  }, [queryClient, tripId]);

  const handleDrawerSave = useCallback(
    async (data: ActivityCreateInput, attachmentFiles: File[] = []) => {
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
          queryClient.invalidateQueries({ queryKey: tripAssetKeys.all(tripId) }),
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
    },
    [closeEditor, editorActivity, editorState, invalidatePlanner, planner, queryClient, tripId],
  );

  const handleDeleteActivity = useCallback(
    async (activityId: string) => {
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
    },
    [
      detailsActivityId,
      editorState,
      invalidatePlanner,
      selectedActivityId,
      setDetailsActivityId,
      setEditorState,
      setSelectedActivityId,
      setSelectedPlaceId,
    ],
  );

  const submitGeneration = useCallback(
    async (data: PlannerGenerationFormValues, idempotencyKey: string) => {
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
      prevJobStatusRef.current = null;
      setPendingJobId(tripId, accepted.job_id);
      return accepted.job_id;
    },
    [clearGenerationReport, generateMutation, planner, setPendingJobId, tripId],
  );

  const handleGenerate = useCallback(
    async (data: PlannerGenerationFormValues, idempotencyKey: string) => {
      const scopeDays = data.day_ids?.length ? data.day_ids.length : (planner?.days.length ?? 0);
      const requestText = `Generate · ${data.mode} · ${scopeDays} day${scopeDays !== 1 ? 's' : ''}`;

      try {
        const jobId = await submitGeneration(data, idempotencyKey);
        if (!jobId) {
          return;
        }

        try {
          await mirrorPlannerJobToAssistant(queryClient, {
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
    },
    [planner?.days.length, queryClient, setAssistantPanelOpen, submitGeneration, tripId],
  );

  const handleReset = useCallback(
    async (dayIds: string[] | undefined, idempotencyKey: string) => {
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
        prevJobStatusRef.current = null;
        setPendingJobId(tripId, accepted.job_id);

        try {
          await mirrorPlannerJobToAssistant(queryClient, {
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
    },
    [clearGenerationReport, planner, queryClient, resetMutation, setAssistantPanelOpen, setPendingJobId, tripId],
  );

  const handleAssistantInlineActionSubmit = useCallback(
    async (
      action: PlannerGenerationAction,
      values: PlannerGenerationFormValues,
      idempotencyKey: string,
    ) => {
      if (action === 'generate') {
        await handleGenerate(values, idempotencyKey);
        return;
      }

      await handleReset(values.day_ids, idempotencyKey);
    },
    [handleGenerate, handleReset],
  );

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

  return {
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
  };
}
