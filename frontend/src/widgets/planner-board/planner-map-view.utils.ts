import { format, parseISO } from 'date-fns';
import type { PlannerActivity, PlannerResponse, Trip } from '@/shared/api/types';
import { filterPlannerActivitiesByBucket, type PlannerActivityBucket } from './activity-buckets';
import type { PlannerDay } from '@/shared/api/types';

export function asFiniteNumber(value: string | number | null | undefined) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatTripDateRangeLabel(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) {
    return 'Dates flexible';
  }

  if (startDate && endDate) {
    const start = parseISO(startDate);
    const end = parseISO(endDate);

    if (format(start, 'yyyy') === format(end, 'yyyy')) {
      if (format(start, 'MMM') === format(end, 'MMM')) {
        return `${format(start, 'MMM d')} - ${format(end, 'd, yyyy')}`;
      }
      return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
    }

    return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`;
  }

  return format(parseISO(startDate ?? endDate!), 'MMM d, yyyy');
}

export function formatTripTypeLabel(tripType: string | null | undefined) {
  if (!tripType) {
    return null;
  }
  return tripType
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

type BudgetGroup = {
  currency: string | null;
  total: number;
  activityCount: number;
};

export function buildBudgetGroups(
  activities: PlannerActivity[],
  fallbackCurrency: string | null | undefined,
) {
  const groups = new Map<string, BudgetGroup>();
  const spentGroups = new Map<string, BudgetGroup>();
  let pricedActivityCount = 0;

  for (const activity of activities) {
    if (activity.estimated_cost_amount == null || activity.estimated_cost_amount === '') {
      continue;
    }

    const numericAmount = Number(activity.estimated_cost_amount);
    if (Number.isNaN(numericAmount)) {
      continue;
    }

    pricedActivityCount += 1;
    const currency = activity.estimated_cost_currency ?? fallbackCurrency ?? null;
    const key = currency ?? '__none__';
    const current = groups.get(key) ?? { currency, total: 0, activityCount: 0 };
    current.total += numericAmount;
    current.activityCount += 1;
    groups.set(key, current);

    if (activity.visited_at != null) {
      const currentSpent = spentGroups.get(key) ?? { currency, total: 0, activityCount: 0 };
      currentSpent.total += numericAmount;
      currentSpent.activityCount += 1;
      spentGroups.set(key, currentSpent);
    }
  }

  return {
    groups: Array.from(groups.values()),
    spentGroups: Array.from(spentGroups.values()),
    pricedActivityCount,
    unpricedActivityCount: Math.max(activities.length - pricedActivityCount, 0),
  };
}

export function buildBudgetOverview(trip: Trip, activities: PlannerActivity[]) {
  const { groups, spentGroups, pricedActivityCount, unpricedActivityCount } = buildBudgetGroups(
    activities,
    trip.budget_currency,
  );
  const budgetAmount =
    trip.budget_amount == null || trip.budget_amount === '' ? null : Number(trip.budget_amount);
  const hasBudgetAmount = budgetAmount != null && !Number.isNaN(budgetAmount);

  const comparableGroup = trip.budget_currency
    ? (groups.find((group) => group.currency === trip.budget_currency) ??
      (groups.length === 1 ? groups[0] : null))
    : groups.length === 1
      ? groups[0]
      : null;

  const comparableSpentGroup = trip.budget_currency
    ? (spentGroups.find((group) => group.currency === trip.budget_currency) ??
      (spentGroups.length === 1 ? spentGroups[0] : null))
    : spentGroups.length === 1
      ? spentGroups[0]
      : null;

  const comparableCurrency = comparableGroup?.currency ?? trip.budget_currency ?? null;
  const comparableSpend = comparableGroup?.total ?? 0;
  const comparableSpent = comparableSpentGroup?.total ?? 0;
  const currentBudgetAmount = hasBudgetAmount ? budgetAmount - comparableSpent : null;
  const remainingAmount = hasBudgetAmount ? budgetAmount - comparableSpend : null;

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
  };
}

export type PlannerStandaloneActivityGroup = {
  id: string;
  dayId: string | null;
  dayIndex: number | null;
  title: string;
  subtitle: string;
  activities: PlannerActivity[];
};

export function buildStandaloneActivityGroups(
  days: PlannerDay[],
  inboxActivities: PlannerActivity[],
  bucket: PlannerActivityBucket,
): PlannerStandaloneActivityGroup[] {
  const groups: PlannerStandaloneActivityGroup[] = [];
  const unassignedActivities = [...filterPlannerActivitiesByBucket(inboxActivities, bucket)].sort(
    (left, right) => left.order_index - right.order_index,
  );

  if (unassignedActivities.length > 0) {
    groups.push({
      id: `${bucket}::inbox`,
      dayId: null,
      dayIndex: null,
      title: 'Unassigned',
      subtitle: 'Keep flexible until you assign a day',
      activities: unassignedActivities,
    });
  }

  for (const day of days) {
    const dayActivities = [...filterPlannerActivitiesByBucket(day.activities, bucket)].sort(
      (left, right) => left.order_index - right.order_index,
    );

    if (!dayActivities.length) {
      continue;
    }

    groups.push({
      id: `${bucket}::${day.id}`,
      dayId: day.id,
      dayIndex: day.day_index,
      title: `Day ${day.day_index + 1}`,
      subtitle: format(parseISO(day.date), 'MMM d, yyyy'),
      activities: dayActivities,
    });
  }

  return groups;
}

export function standaloneSectionTitle(bucket: 'travel' | 'accommodation') {
  return bucket === 'accommodation' ? 'Accommodation' : 'Travel';
}

export function standaloneSectionSummary(
  bucket: 'travel' | 'accommodation',
  groups: PlannerStandaloneActivityGroup[],
) {
  const activityCount = groups.reduce((total, group) => total + group.activities.length, 0);
  if (activityCount === 0) {
    return bucket === 'accommodation' ? 'No stays yet' : 'No travel yet';
  }

  const activityLabel =
    bucket === 'accommodation'
      ? activityCount === 1
        ? 'stay'
        : 'stays'
      : activityCount === 1
        ? 'segment'
        : 'segments';

  return `${activityCount} ${activityLabel} · ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`;
}

export function standaloneSectionEmptyCopy(bucket: 'travel' | 'accommodation') {
  return bucket === 'accommodation'
    ? 'Add hotels and stays here, then assign them to the right day when needed.'
    : 'Add flights, trains, and transfers here, then assign them to the right day when needed.';
}

export function applyOptimisticVisited(
  data: PlannerResponse,
  activityId: string,
  visitedAt: string | null,
): PlannerResponse {
  const patch = (a: PlannerActivity) => (a.id === activityId ? { ...a, visited_at: visitedAt } : a);
  return {
    ...data,
    inbox_activities: data.inbox_activities.map(patch),
    days: data.days.map((day) => ({ ...day, activities: day.activities.map(patch) })),
  };
}
