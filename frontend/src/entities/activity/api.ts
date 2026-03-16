import { requestJson } from '@/shared/api/client';
import type {
  Activity,
  ActivityCreateInput,
  ActivityListResponse,
  ActivityMoveInput,
  ActivityReorderInput,
  ActivityUpdateInput,
} from '@/shared/api/types';

export async function getActivities(dayId: string): Promise<ActivityListResponse> {
  return requestJson<ActivityListResponse>(`/days/${dayId}/activities`);
}

export async function createActivity(
  dayId: string,
  data: ActivityCreateInput,
  idempotencyKey: string,
): Promise<Activity> {
  return requestJson<Activity>(`/days/${dayId}/activities`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  });
}

export async function createPlannerActivity(
  tripId: string,
  data: ActivityCreateInput,
  idempotencyKey: string,
): Promise<Activity> {
  return requestJson<Activity>(`/trips/${tripId}/planner/activities`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  });
}

export async function patchActivity(
  activityId: string,
  data: Partial<ActivityUpdateInput>,
): Promise<Activity> {
  return requestJson<Activity>(`/activities/${activityId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteActivity(activityId: string): Promise<void> {
  return requestJson<void>(`/activities/${activityId}`, {
    method: 'DELETE',
  });
}

export async function reorderActivities(
  dayId: string,
  data: ActivityReorderInput,
  tripVersion: number,
): Promise<ActivityListResponse> {
  return requestJson<ActivityListResponse>(`/days/${dayId}/activities/reorder`, {
    method: 'POST',
    headers: { 'If-Match': String(tripVersion) },
    body: JSON.stringify(data),
  });
}

export async function moveActivity(
  activityId: string,
  data: ActivityMoveInput,
  tripVersion: number,
): Promise<Activity> {
  return requestJson<Activity>(`/activities/${activityId}/move`, {
    method: 'POST',
    headers: { 'If-Match': String(tripVersion) },
    body: JSON.stringify(data),
  });
}
