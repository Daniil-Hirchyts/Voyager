import { requestJson } from '@/shared/api/client';
import type { PlacePhotoListResponse, JobAcceptedResponse } from '@/shared/api/types';

export async function listPlacePhotos(placeId: string): Promise<PlacePhotoListResponse> {
  return requestJson<PlacePhotoListResponse>(`/places/${placeId}/photos`);
}

export async function refreshPlacePhotos(
  placeId: string,
  idempotencyKey: string,
): Promise<JobAcceptedResponse> {
  return requestJson<JobAcceptedResponse>(`/places/${placeId}/photos/refresh`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
