import type {
  PlannerActivity,
  PlannerDay,
  RouteLegEstimateInput,
  RouteLegEstimateItem,
  RouteTravelMode,
} from '@/shared/api/types';
import { plannerPrimaryPlace } from './categories';
import {
  buildPlannerTravelLegs,
  summarizePlannerTravelLegs,
  type PlannerTravelLeg,
  type PlannerTravelSummary,
} from './travel-estimates';

export type PlannerMapLayerGroup =
  | 'visit'
  | 'eat'
  | 'activity'
  | 'hotel'
  | 'travel'
  | 'recommendation';

export type PlannerMapStop = {
  activity: PlannerActivity;
  dayId: string;
  dayIndex: number;
  color: string;
  markerNumber: number | null;
  isHotel: boolean;
  lat: number | null;
  lon: number | null;
};

export type PlannerMapSection = {
  id: string;
  dayId: string;
  dayIndex: number;
  title: string;
  subtitle: string;
  dateLabel: string;
  color: string;
  activities: PlannerActivity[];
  stops: PlannerMapStop[];
};

export type PlannerMapDayMetrics = PlannerTravelSummary & {
  legs: PlannerTravelLeg[];
  hotelToFirstLeg: PlannerTravelLeg | null;
  lastToHotelLeg: PlannerTravelLeg | null;
};

export const PLANNER_MAP_DAY_COLORS = [
  '#FF510E',
  '#FFA200',
  '#FFCC6B',
  '#00B1FF',
  '#00C978',
] as const;

function routeEstimateKey(fromActivityId: string, toActivityId: string) {
  return `${fromActivityId}:${toActivityId}`;
}

function applyEstimateToLeg(
  leg: PlannerTravelLeg,
  estimatesByLegId: Map<string, RouteLegEstimateItem>,
) {
  const estimate = estimatesByLegId.get(routeEstimateKey(leg.fromActivityId, leg.toActivityId));
  return estimate
    ? {
        ...leg,
        distanceKm: estimate.distance_km,
        durationMin: estimate.duration_min,
      }
    : leg;
}

function buildBoundaryLeg(
  originActivity: PlannerActivity | null | undefined,
  destinationActivity: PlannerActivity | null | undefined,
  travelMode: RouteTravelMode,
) {
  if (!originActivity || !destinationActivity) {
    return null;
  }
  return buildPlannerTravelLegs([originActivity, destinationActivity], travelMode)[0] ?? null;
}

function activityCoordinates(activity: PlannerActivity) {
  const place = plannerPrimaryPlace(activity);
  const lat = place?.lat ?? null;
  const lon = place?.lon ?? null;
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return null;
  }
  return { lat, lon };
}

function isMarkerActivity(activity: PlannerActivity) {
  return (
    activity.category !== 'hotel' && activity.place?.lat != null && activity.place?.lon != null
  );
}

export function buildPlannerMapSections(
  days: PlannerDay[],
  inboxActivities: PlannerActivity[],
): PlannerMapSection[] {
  const sections: PlannerMapSection[] = [];
  const inboxColor = '#B59BFF';
  let inboxMarkerNumber = 1;
  sections.push({
    id: 'inbox',
    dayId: 'inbox',
    dayIndex: -1,
    title: 'Inbox',
    subtitle: 'Unassigned activities',
    dateLabel: 'Review before scheduling',
    color: inboxColor,
    activities: [...inboxActivities].sort((left, right) => left.order_index - right.order_index),
    stops: [...inboxActivities]
      .sort((left, right) => left.order_index - right.order_index)
      .map((activity) => {
        const point = activityCoordinates(activity);
        const markerNumber = isMarkerActivity(activity) ? inboxMarkerNumber++ : null;
        return {
          activity,
          dayId: 'inbox',
          dayIndex: -1,
          color: inboxColor,
          markerNumber,
          isHotel: activity.category === 'hotel',
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
        };
      }),
  });

  days.forEach((day, index) => {
    const color =
      PLANNER_MAP_DAY_COLORS[index % PLANNER_MAP_DAY_COLORS.length] ?? PLANNER_MAP_DAY_COLORS[0];
    const activities = [...day.activities].sort(
      (left, right) => left.order_index - right.order_index,
    );
    let markerNumber = 1;
    sections.push({
      id: day.id,
      dayId: day.id,
      dayIndex: day.day_index,
      title: `Day ${day.day_index + 1}`,
      subtitle: new Date(day.date).toLocaleDateString(undefined, { weekday: 'long' }),
      dateLabel: new Date(day.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      color,
      activities,
      stops: activities.map((activity) => {
        const point = activityCoordinates(activity);
        const nextMarkerNumber = isMarkerActivity(activity) ? markerNumber++ : null;
        return {
          activity,
          dayId: day.id,
          dayIndex: day.day_index,
          color,
          markerNumber: nextMarkerNumber,
          isHotel: activity.category === 'hotel',
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
        };
      }),
    });
  });

  return sections;
}

export function buildPlannerMapLegPayload(
  sections: PlannerMapSection[],
  travelMode: RouteLegEstimateInput['travel_mode'] = 'WALK',
  accommodationByDayId: Record<string, PlannerActivity | null | undefined> = {},
): RouteLegEstimateInput | null {
  const legs = sections.flatMap((section) => {
    const betweenActivityLegs = section.activities.slice(1).flatMap((activity, index) => {
      const previousActivity = section.activities[index];
      if (!previousActivity) {
        return [];
      }
      const origin = activityCoordinates(previousActivity);
      const destination = activityCoordinates(activity);
      if (!origin || !destination) {
        return [];
      }
      return [
        {
          from_activity_id: previousActivity.id,
          to_activity_id: activity.id,
          origin: { lat: origin.lat, lng: origin.lon },
          destination: { lat: destination.lat, lng: destination.lon },
        },
      ];
    });

    const firstActivity = section.activities[0] ?? null;
    const lastActivity = section.activities[section.activities.length - 1] ?? null;
    const hotelActivity = accommodationByDayId[section.dayId] ?? null;
    const hotelCoordinates = hotelActivity ? activityCoordinates(hotelActivity) : null;
    const firstCoordinates = firstActivity ? activityCoordinates(firstActivity) : null;
    const lastCoordinates = lastActivity ? activityCoordinates(lastActivity) : null;

    const boundaryLegs: RouteLegEstimateInput['legs'] = [];
    if (hotelActivity && firstActivity && hotelCoordinates && firstCoordinates) {
      boundaryLegs.push({
        from_activity_id: hotelActivity.id,
        to_activity_id: firstActivity.id,
        origin: { lat: hotelCoordinates.lat, lng: hotelCoordinates.lon },
        destination: { lat: firstCoordinates.lat, lng: firstCoordinates.lon },
      });
    }
    if (hotelActivity && lastActivity && hotelCoordinates && lastCoordinates) {
      boundaryLegs.push({
        from_activity_id: lastActivity.id,
        to_activity_id: hotelActivity.id,
        origin: { lat: lastCoordinates.lat, lng: lastCoordinates.lon },
        destination: { lat: hotelCoordinates.lat, lng: hotelCoordinates.lon },
      });
    }

    return [...betweenActivityLegs, ...boundaryLegs];
  });

  if (!legs.length) {
    return null;
  }

  return {
    legs,
    travel_mode: travelMode,
  };
}

export function buildPlannerMapMetricsForActivities(
  activities: PlannerActivity[],
  estimateItems: RouteLegEstimateItem[] = [],
  travelMode: RouteTravelMode = 'WALK',
  accommodationActivity: PlannerActivity | null = null,
): PlannerMapDayMetrics {
  const estimatesByLegId = new Map(
    estimateItems.map((item) => [
      routeEstimateKey(item.from_activity_id, item.to_activity_id),
      item,
    ]),
  );
  const fallbackLegs = buildPlannerTravelLegs(activities, travelMode);
  const legs = fallbackLegs.map((leg) => applyEstimateToLeg(leg, estimatesByLegId));

  const firstActivity = activities[0] ?? null;
  const lastActivity = activities[activities.length - 1] ?? null;
  const hotelToFirstLeg = buildBoundaryLeg(accommodationActivity, firstActivity, travelMode);
  const lastToHotelLeg = buildBoundaryLeg(lastActivity, accommodationActivity, travelMode);
  const resolvedHotelToFirstLeg = hotelToFirstLeg
    ? applyEstimateToLeg(hotelToFirstLeg, estimatesByLegId)
    : null;
  const resolvedLastToHotelLeg = lastToHotelLeg
    ? applyEstimateToLeg(lastToHotelLeg, estimatesByLegId)
    : null;
  const summary = summarizePlannerTravelLegs(
    [
      ...legs,
      resolvedHotelToFirstLeg,
      resolvedLastToHotelLeg,
    ].filter((leg): leg is PlannerTravelLeg => leg != null),
  );

  return {
    ...summary,
    legs,
    hotelToFirstLeg: resolvedHotelToFirstLeg,
    lastToHotelLeg: resolvedLastToHotelLeg,
  };
}

export function buildPlannerMapDayMetrics(
  sections: PlannerMapSection[],
  estimateItems: RouteLegEstimateItem[] = [],
  travelMode: RouteTravelMode = 'WALK',
  accommodationByDayId: Record<string, PlannerActivity | null | undefined> = {},
): Record<string, PlannerMapDayMetrics> {
  return Object.fromEntries(
    sections.map((section) => {
      return [
        section.dayId,
        buildPlannerMapMetricsForActivities(
          section.activities,
          estimateItems,
          travelMode,
          accommodationByDayId[section.dayId] ?? null,
        ),
      ];
    }),
  );
}

export function filterVisibleStops(
  sections: PlannerMapSection[],
  visibleDayIds: Set<string>,
  visibleGroups: Set<PlannerMapLayerGroup>,
) {
  return sections.flatMap((section) =>
    section.stops.filter(
      (stop) =>
        visibleDayIds.has(stop.dayId) &&
        visibleGroups.has(stop.activity.category as PlannerMapLayerGroup) &&
        stop.lat != null &&
        stop.lon != null,
    ),
  );
}

function routeDistance(
  orderedStops: PlannerMapStop[],
  estimateMap: Map<string, RouteLegEstimateItem>,
  travelMode: RouteTravelMode,
) {
  return orderedStops.slice(1).reduce((total, stop, index) => {
    const previous = orderedStops[index];
    if (!previous) {
      return total;
    }
    const estimate = estimateMap.get(routeEstimateKey(previous.activity.id, stop.activity.id));
    if (estimate?.duration_min != null) {
      return total + estimate.duration_min;
    }
    if (estimate?.distance_km != null) {
      return total + estimate.distance_km;
    }
    const fallback = buildPlannerTravelLegs([previous.activity, stop.activity], travelMode)[0];
    return total + (fallback?.durationMin ?? fallback?.distanceKm ?? 0);
  }, 0);
}

export function optimizePlannerDayStops(
  section: PlannerMapSection,
  estimateItems: RouteLegEstimateItem[] = [],
  travelMode: RouteTravelMode = 'WALK',
) {
  const markerStops = section.stops.filter((stop) => stop.markerNumber != null);
  if (markerStops.length < 3) {
    return markerStops.map((stop) => stop.activity.id);
  }

  const estimateMap = new Map(
    estimateItems.map((item) => [
      routeEstimateKey(item.from_activity_id, item.to_activity_id),
      item,
    ]),
  );

  const remaining = [...markerStops];
  const firstStop = remaining.shift();
  if (!firstStop) {
    return markerStops.map((stop) => stop.activity.id);
  }
  const ordered: PlannerMapStop[] = [firstStop];

  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    if (!current) {
      break;
    }
    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      const estimate = estimateMap.get(
        routeEstimateKey(current.activity.id, candidate.activity.id),
      );
      const fallback = buildPlannerTravelLegs(
        [current.activity, candidate.activity],
        travelMode,
      )[0];
      const cost =
        estimate?.duration_min ??
        estimate?.distance_km ??
        fallback?.durationMin ??
        fallback?.distanceKm ??
        Number.POSITIVE_INFINITY;
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    });

    const [nextStop] = remaining.splice(bestIndex, 1);
    if (!nextStop) {
      continue;
    }
    ordered.push(nextStop);
  }

  let best = [...ordered];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 2; i += 1) {
      for (let j = i + 1; j < best.length - 1; j += 1) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        if (
          routeDistance(candidate, estimateMap, travelMode) + 0.001 <
          routeDistance(best, estimateMap, travelMode)
        ) {
          best = candidate;
          improved = true;
        }
      }
    }
  }

  return best.map((stop) => stop.activity.id);
}
