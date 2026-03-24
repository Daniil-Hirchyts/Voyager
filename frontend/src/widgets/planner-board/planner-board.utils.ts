import { format } from 'date-fns';
import { readTripCoverPhotoPreference } from '@/entities/trip/cover-photo';
import type {
  PlannerGenerationReport,
  PlannerResponse,
  TripCoverPreference,
} from '@/shared/api/types';

export const INBOX_DAY_VALUE = '__inbox__';

export type PlannerMapSeed = {
  activityId: string | null;
  placeId: string | null;
  center: { lat: number; lng: number } | null;
};

export function buildPlannerGenerationReport(
  jobId: string,
  status: string,
  result: unknown,
  error: unknown,
): PlannerGenerationReport {
  return {
    jobId,
    status,
    result: result && typeof result === 'object' ? (result as Record<string, unknown>) : null,
    error: error && typeof error === 'object' ? (error as Record<string, unknown>) : null,
  };
}

export function findPlannerDayLabel(
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

  return `Day ${day.day_index + 1} · ${format(new Date(day.date), 'EEE, MMM d')}`;
}

export function parsePlannerMapSeed(
  searchParams: URLSearchParams,
  tripId: string,
  coverPreference: TripCoverPreference | null = null,
): PlannerMapSeed {
  const legacyCoverPreference = readTripCoverPhotoPreference(tripId);
  const activityId = searchParams.get('activityId')?.trim() || null;
  const placeId = searchParams.get('placeId')?.trim() || null;
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));
  const center =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : typeof coverPreference?.placeLat === 'number' &&
          Number.isFinite(coverPreference.placeLat) &&
          typeof coverPreference?.placeLng === 'number' &&
          Number.isFinite(coverPreference.placeLng)
        ? { lat: coverPreference.placeLat, lng: coverPreference.placeLng }
        : typeof legacyCoverPreference?.placeLat === 'number' &&
            Number.isFinite(legacyCoverPreference.placeLat) &&
            typeof legacyCoverPreference?.placeLng === 'number' &&
            Number.isFinite(legacyCoverPreference.placeLng)
          ? { lat: legacyCoverPreference.placeLat, lng: legacyCoverPreference.placeLng }
          : null;

  return {
    activityId,
    placeId,
    center,
  };
}
