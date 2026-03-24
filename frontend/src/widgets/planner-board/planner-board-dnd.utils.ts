import { type DragStartEvent } from '@dnd-kit/core';
import type { PlannerActivity, PlannerResponse } from '@/shared/api/types';
import {
  filterPlannerActivitiesByBucket,
  plannerActivityBucket,
  type PlannerActivityBucket,
} from './activity-buckets';

type PlannerVisualContainerId = string;

export type ActivityLocation = {
  bucket: PlannerActivityBucket;
  containerId: PlannerVisualContainerId;
  dayId: string | null;
  index: number;
};

export type DragPreviewSize = {
  width: number;
  height: number;
};

const INBOX_CONTAINER_ID = 'inbox';
const CHIP_PREFIX = 'chip::';
const END_SUFFIX = '::end';

export function isPlannerChipDropTarget(value: string) {
  return value.startsWith(CHIP_PREFIX);
}

export function getPlannerEndZoneId(containerId: PlannerVisualContainerId) {
  return `${containerId}${END_SUFFIX}`;
}

export function clonePlanner(planner: PlannerResponse): PlannerResponse {
  return {
    trip: { ...planner.trip },
    legacy_inbox_mode: planner.legacy_inbox_mode,
    inbox_activities: planner.inbox_activities.map((activity) => ({ ...activity })),
    days: planner.days.map((day) => ({
      ...day,
      activities: day.activities.map((activity) => ({ ...activity })),
    })),
  };
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

export function getPlannerActivitiesForDay(planner: PlannerResponse, dayId: string | null) {
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

export function getPlannerContainerActivities(
  planner: PlannerResponse,
  dayId: string | null,
  bucket: PlannerActivityBucket,
) {
  return filterPlannerActivitiesByBucket(getPlannerActivitiesForDay(planner, dayId), bucket);
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

export function findActivityLocation(
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
      index: getPlannerContainerActivities(planner, null, bucket).findIndex(
        (candidate) => candidate.id === activity.id,
      ),
    };
  }

  for (const day of planner.days) {
    const index = day.activities.findIndex((activity) => activity.id === activityId);
    if (index < 0) {
      continue;
    }

    const activity = day.activities[index];
    if (!activity) {
      continue;
    }

    const bucket = plannerActivityBucket(activity);
    return {
      bucket,
      containerId: getVisualContainerId(bucket, day.id),
      dayId: day.id,
      index: getPlannerContainerActivities(planner, day.id, bucket).findIndex(
        (candidate) => candidate.id === activity.id,
      ),
    };
  }

  return null;
}

export function findActivity(planner: PlannerResponse | undefined, activityId: string | null) {
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

export function resolvePlannerDropTarget(
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
        index: getPlannerContainerActivities(planner, null, 'main').length,
      };
    }

    const day = planner.days.find((item) => item.id === rawContainerId);
    return day
      ? {
          bucket: 'main',
          containerId: getVisualContainerId('main', day.id),
          dayId: day.id,
          index: getPlannerContainerActivities(planner, day.id, 'main').length,
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
      index: getPlannerContainerActivities(
        planner,
        parsedContainer.dayId,
        parsedContainer.bucket,
      ).length,
    };
  }

  if (planner.days.some((day) => day.id === normalizedOverId)) {
    const day = planner.days.find((item) => item.id === normalizedOverId);
    return day
      ? {
          bucket: 'main',
          containerId: getVisualContainerId('main', day.id),
          dayId: day.id,
          index: getPlannerContainerActivities(planner, day.id, 'main').length,
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

export function updatePlannerActivityLists(
  planner: PlannerResponse,
  activityId: string,
  target: ActivityLocation,
) {
  const source = findActivityLocation(planner, activityId);
  if (!source || !canMoveBetweenLocations(source, target)) {
    return null;
  }

  const nextPlanner = clonePlanner(planner);
  const sourceActivities = [...getPlannerActivitiesForDay(nextPlanner, source.dayId)];
  const targetActivities =
    source.dayId === target.dayId
      ? sourceActivities
      : [...getPlannerActivitiesForDay(nextPlanner, target.dayId)];

  const sourceIndex = sourceActivities.findIndex((activity) => activity.id === activityId);
  const [activity] = sourceActivities.splice(sourceIndex, 1);
  if (!activity) {
    return null;
  }

  const safeIndex = getBucketInsertionIndex(
    targetActivities,
    target.bucket,
    Math.max(0, target.index),
  );
  const nextActivity: PlannerActivity = {
    ...activity,
    trip_day_id: target.dayId,
    start_time: target.dayId == null && activity.category !== 'travel' ? null : activity.start_time,
    legacy_source_day_id: target.dayId ?? activity.legacy_source_day_id ?? source.dayId,
    legacy_inbox_item: target.dayId == null,
  };

  targetActivities.splice(safeIndex, 0, nextActivity);
  setActivitiesForDay(nextPlanner, source.dayId, sourceActivities);
  setActivitiesForDay(nextPlanner, target.dayId, targetActivities);

  return nextPlanner;
}

export async function persistPlannerActivityMove(
  currentPlanner: PlannerResponse,
  activity: PlannerActivity,
  startLocation: ActivityLocation,
  finalLocation: ActivityLocation,
  tripVersion: number,
) {
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
        items: reorderedDay.activities.map((item, index) => ({
          activity_id: item.id,
          order_index: index,
        })),
      },
      tripVersion,
    );
    return;
  }

  await moveActivity(
    activity.id,
    {
      target_day_id: finalLocation.dayId,
      target_index: Math.max(
        getPlannerActivitiesForDay(currentPlanner, finalLocation.dayId).findIndex(
          (item) => item.id === activity.id,
        ),
        0,
      ),
    },
    tripVersion,
  );
}
