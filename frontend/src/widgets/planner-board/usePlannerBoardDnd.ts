import { useCallback, useRef, useState } from 'react';
import {
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getPlanner } from '@/entities/planner/api';
import { plannerKeys } from '@/entities/planner/queries';
import { isConflict } from '@/shared/api/client';
import type { PlannerResponse } from '@/shared/api/types';
import {
  clonePlanner,
  findActivity,
  findActivityLocation,
  getPlannerContainerActivities,
  getPlannerEndZoneId,
  isPlannerChipDropTarget,
  persistPlannerActivityMove,
  resolveDragPreviewSize,
  resolvePlannerDropTarget,
  updatePlannerActivityLists,
} from './planner-board-dnd.utils';

export { findActivity } from './planner-board-dnd.utils';

type UsePlannerBoardDndOptions = {
  tripId: string;
  planner: PlannerResponse | undefined;
  queryClient: QueryClient;
};

export function usePlannerBoardDnd({
  tripId,
  planner,
  queryClient,
}: UsePlannerBoardDndOptions) {
  const [activeActivity, setActiveActivity] = useState<ReturnType<typeof findActivity>>(null);
  const [activeDragPreviewSize, setActiveDragPreviewSize] = useState<
    ReturnType<typeof resolveDragPreviewSize>
  >(null);
  const lastOverIdRef = useRef<UniqueIdentifier | null>(null);
  const dragOriginPlannerRef = useRef<PlannerResponse | null>(null);

  const collisionDetectionStrategy = useCallback<CollisionDetection>(
    (args) => {
      const intersections = pointerWithin(args);
      const collisions = intersections.length > 0 ? intersections : rectIntersection(args);
      let overId = getFirstCollision(collisions, 'id');

      if (overId != null && planner) {
        const resolved = resolvePlannerDropTarget(planner, String(overId));
        if (resolved && !isPlannerChipDropTarget(String(overId))) {
          const containerItems = getPlannerContainerActivities(
            planner,
            resolved.dayId,
            resolved.bucket,
          );
          if (containerItems.length > 0) {
            const itemIds = new Set(containerItems.map((activity) => activity.id));
            const narrowed = closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter(
                (container) =>
                  itemIds.has(String(container.id)) ||
                  String(container.id) === getPlannerEndZoneId(resolved.containerId),
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

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (planner) {
        dragOriginPlannerRef.current = clonePlanner(planner);
      }

      lastOverIdRef.current = event.active.id;
      setActiveDragPreviewSize(resolveDragPreviewSize(event));
      setActiveActivity(findActivity(planner, String(event.active.id)));
    },
    [planner],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const overId = event.over?.id ? String(event.over.id) : null;
      const activityId = String(event.active.id);
      const currentPlanner =
        queryClient.getQueryData<PlannerResponse>(plannerKeys.detail(tripId)) ?? planner;

      if (!currentPlanner || !overId) {
        return;
      }

      const source = findActivityLocation(currentPlanner, activityId);
      const target = resolvePlannerDropTarget(currentPlanner, overId);
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

      queryClient.setQueryData(plannerKeys.detail(tripId), nextPlanner);
    },
    [planner, queryClient, tripId],
  );

  const handleDragCancel = useCallback(() => {
    setActiveActivity(null);
    setActiveDragPreviewSize(null);
    lastOverIdRef.current = null;

    if (dragOriginPlannerRef.current) {
      queryClient.setQueryData(plannerKeys.detail(tripId), dragOriginPlannerRef.current);
      dragOriginPlannerRef.current = null;
    }
  }, [queryClient, tripId]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const capturedActivity = activeActivity;
      const originPlanner = dragOriginPlannerRef.current;
      const currentPlanner =
        queryClient.getQueryData<PlannerResponse>(plannerKeys.detail(tripId)) ?? planner;

      setActiveActivity(null);
      setActiveDragPreviewSize(null);
      lastOverIdRef.current = null;
      dragOriginPlannerRef.current = null;

      if (!capturedActivity || !originPlanner || !currentPlanner || !event.over) {
        if (originPlanner) {
          queryClient.setQueryData(plannerKeys.detail(tripId), originPlanner);
        }
        return;
      }

      const startLocation = findActivityLocation(originPlanner, capturedActivity.id);
      const finalLocation = findActivityLocation(currentPlanner, capturedActivity.id);
      if (!startLocation || !finalLocation) {
        queryClient.setQueryData(plannerKeys.detail(tripId), originPlanner);
        return;
      }

      if (
        startLocation.containerId === finalLocation.containerId &&
        startLocation.index === finalLocation.index
      ) {
        queryClient.setQueryData(plannerKeys.detail(tripId), currentPlanner);
        return;
      }

      try {
        await persistPlannerActivityMove(
          currentPlanner,
          capturedActivity,
          startLocation,
          finalLocation,
          currentPlanner.trip.version,
        );
        await queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
      } catch (error) {
        if (isConflict(error)) {
          try {
            const freshPlanner = await queryClient.fetchQuery({
              queryKey: plannerKeys.detail(tripId),
              queryFn: () => getPlanner(tripId),
            });
            await persistPlannerActivityMove(
              freshPlanner,
              capturedActivity,
              startLocation,
              finalLocation,
              freshPlanner.trip.version,
            );
            await queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
            return;
          } catch {}
        }

        queryClient.setQueryData(plannerKeys.detail(tripId), originPlanner);
        toast.error('Failed to move activity');
      }
    },
    [activeActivity, planner, queryClient, tripId],
  );

  return {
    activeActivity,
    activeDragPreviewSize,
    collisionDetectionStrategy,
    handleDragStart,
    handleDragOver,
    handleDragCancel,
    handleDragEnd,
  };
}
