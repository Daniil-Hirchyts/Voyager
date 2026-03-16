import { buildApiUrl, createRequestHeaders, requestJson, toApiError } from '@/shared/api/client';
import type { TripAssetListResponse, TripAssetResponse } from '@/shared/api/types';

export async function listTripAssets(
  tripId: string,
  activityId?: string | null,
): Promise<TripAssetListResponse> {
  const params = new URLSearchParams();
  if (activityId) {
    params.set('activity_id', activityId);
  }
  const suffix = params.size ? `?${params.toString()}` : '';
  return requestJson<TripAssetListResponse>(`/trips/${tripId}/assets${suffix}`);
}

export async function getTripAsset(assetId: string): Promise<TripAssetResponse> {
  return requestJson<TripAssetResponse>(`/assets/${assetId}`);
}

export async function uploadTripAsset(
  tripId: string,
  file: File,
  activityId?: string | null,
): Promise<TripAssetResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (activityId) {
    formData.append('activity_id', activityId);
  }

  const response = await fetch(buildApiUrl(`/trips/${tripId}/assets`), {
    method: 'POST',
    headers: createRequestHeaders(),
    body: formData,
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response.json() as Promise<TripAssetResponse>;
}

export async function deleteTripAsset(assetId: string): Promise<void> {
  const response = await fetch(buildApiUrl(`/assets/${assetId}`), {
    method: 'DELETE',
    headers: createRequestHeaders(),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
}
