import { CarFront, Footprints, Plane, ShipWheel, TrainFront } from 'lucide-react';
import type { PlannerActivity, PlannerDay } from '@/shared/api/types';
import {
  plannerTravelMode,
  plannerTravelRoute,
  type PlannerTravelDisplayMode,
} from './categories';

export type PlannerTravelOverlay = {
  activity: PlannerActivity;
  dayId: string;
  mode: PlannerTravelDisplayMode;
  points: ReturnType<typeof plannerTravelRoute>;
  routePath: PlannerTravelRoutePoint[];
  badgePoint: PlannerTravelRoutePoint | null;
};

export type PlannerTravelRoutePoint = {
  lat: number;
  lng: number;
};

export function travelOverlayColor(mode: PlannerTravelDisplayMode) {
  switch (mode) {
    case 'train':
      return '#0F766E';
    case 'car':
      return '#7C3AED';
    case 'ferry':
      return '#0891B2';
    case 'walk':
      return '#475569';
    case 'flight':
    default:
      return '#2563EB';
  }
}

export function travelOverlayIcon(mode: PlannerTravelDisplayMode) {
  switch (mode) {
    case 'train':
      return TrainFront;
    case 'car':
      return CarFront;
    case 'ferry':
      return ShipWheel;
    case 'walk':
      return Footprints;
    case 'flight':
    default:
      return Plane;
  }
}

export function buildPlannerTravelOverlays(
  days: PlannerDay[],
  inboxActivities: PlannerActivity[],
): PlannerTravelOverlay[] {
  const overlays: PlannerTravelOverlay[] = [];

  const buildOverlay = (activity: PlannerActivity, dayId: string): PlannerTravelOverlay | null => {
    if (activity.category !== 'travel') {
      return null;
    }

    const points = plannerTravelRoute(activity);
    if (points.length < 2) {
      return null;
    }

    const mode = plannerTravelMode(activity);
    const routePath = travelOverlayRoutePath(mode, points);

    return {
      activity,
      dayId,
      mode,
      points,
      routePath,
      badgePoint: midpointForTravelPath(routePath),
    };
  };

  for (const activity of inboxActivities) {
    const overlay = buildOverlay(activity, 'inbox');
    if (overlay) {
      overlays.push(overlay);
    }
  }

  for (const day of days) {
    for (const activity of day.activities) {
      const overlay = buildOverlay(activity, day.id);
      if (overlay) {
        overlays.push(overlay);
      }
    }
  }

  return overlays;
}

export function travelOverlayRoutePath(
  mode: PlannerTravelDisplayMode,
  points: ReturnType<typeof plannerTravelRoute>,
): PlannerTravelRoutePoint[] {
  const [origin, destination] = points;
  if (!origin || !destination) {
    return [];
  }

  const start = { lat: origin.lat, lng: origin.lon };
  const end = { lat: destination.lat, lng: destination.lon };
  const deltaLat = end.lat - start.lat;
  const deltaLng = end.lng - start.lng;
  const baseDistance = Math.hypot(deltaLat, deltaLng);

  if (baseDistance < 0.3 || mode === 'car' || mode === 'walk') {
    return [start, end];
  }

  const midpoint = {
    lat: (start.lat + end.lat) / 2,
    lng: (start.lng + end.lng) / 2,
  };
  let perpendicular = { lat: deltaLng, lng: -deltaLat };
  if ((midpoint.lat >= 0 && perpendicular.lat < 0) || (midpoint.lat < 0 && perpendicular.lat > 0)) {
    perpendicular = {
      lat: -perpendicular.lat,
      lng: -perpendicular.lng,
    };
  }

  const perpendicularMagnitude = Math.hypot(perpendicular.lat, perpendicular.lng) || 1;
  const normalizedPerpendicular = {
    lat: perpendicular.lat / perpendicularMagnitude,
    lng: perpendicular.lng / perpendicularMagnitude,
  };

  const curveFactor = mode === 'flight' ? 0.16 : mode === 'ferry' ? 0.11 : 0.075;
  const curveOffset = Math.min(Math.max(baseDistance * curveFactor, 0.16), 2.8);
  const controlPoint = {
    lat: midpoint.lat + normalizedPerpendicular.lat * curveOffset,
    lng: midpoint.lng + normalizedPerpendicular.lng * curveOffset,
  };
  const segments = mode === 'flight' ? 22 : mode === 'ferry' ? 18 : 14;

  return Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments;
    const inverseT = 1 - t;
    return {
      lat: inverseT * inverseT * start.lat + 2 * inverseT * t * controlPoint.lat + t * t * end.lat,
      lng: inverseT * inverseT * start.lng + 2 * inverseT * t * controlPoint.lng + t * t * end.lng,
    };
  });
}

export function midpointForTravelPath(path: PlannerTravelRoutePoint[]) {
  if (path.length === 0) {
    return null;
  }

  return path[Math.floor(path.length / 2)] ?? null;
}
