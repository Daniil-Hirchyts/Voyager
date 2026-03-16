import { requestJson } from '@/shared/api/client';
import type { PlannerMapPlaceDetail } from '@/shared/api/types';

export async function getPlannerMapPlaceDetail(
  tripId: string,
  placeId: string,
): Promise<PlannerMapPlaceDetail> {
  return requestJson<PlannerMapPlaceDetail>(
    `/trips/${tripId}/planner-map/places/${placeId}/detail`,
  );
}
