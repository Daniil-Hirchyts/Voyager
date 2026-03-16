import type { ActivityCategory, PlannerActivity, PlannerDay } from '@/shared/api/types';

export type PlannerActivityBucket = 'main' | 'travel' | 'accommodation';

export function plannerActivityBucketForCategory(
  category: ActivityCategory,
): PlannerActivityBucket {
  if (category === 'travel') {
    return 'travel';
  }
  if (category === 'hotel') {
    return 'accommodation';
  }
  return 'main';
}

export function plannerActivityBucket(
  activity: Pick<PlannerActivity, 'category'>,
): PlannerActivityBucket {
  return plannerActivityBucketForCategory(activity.category);
}

export function filterPlannerActivitiesByBucket(
  activities: PlannerActivity[],
  bucket: PlannerActivityBucket,
) {
  return activities.filter((activity) => plannerActivityBucket(activity) === bucket);
}

export function filterPlannerDaysByBucket(
  days: PlannerDay[],
  bucket: PlannerActivityBucket,
): PlannerDay[] {
  return days.map((day) => ({
    ...day,
    activities: filterPlannerActivitiesByBucket(day.activities, bucket),
  }));
}

export function mergeBucketActivityOrder(
  activities: PlannerActivity[],
  bucket: PlannerActivityBucket,
  orderedBucketIds: string[],
) {
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const orderedBucketActivities = orderedBucketIds
    .map((id) => activityById.get(id))
    .filter(
      (activity): activity is PlannerActivity =>
        activity != null && plannerActivityBucket(activity) === bucket,
    );

  let bucketIndex = 0;
  return activities.map((activity) => {
    if (plannerActivityBucket(activity) !== bucket) {
      return activity;
    }
    return orderedBucketActivities[bucketIndex++] ?? activity;
  });
}
