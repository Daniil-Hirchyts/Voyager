import { useQuery } from '@tanstack/react-query'
import { getPlannerMapPlaceDetail } from './api'

export const plannerMapKeys = {
  placeDetail: (tripId: string, placeId: string | null | undefined) =>
    ['planner-map', tripId, 'place-detail', placeId ?? '__none__'] as const,
}

export function usePlannerMapPlaceDetail(
  tripId: string,
  placeId: string | null | undefined,
) {
  return useQuery({
    queryKey: plannerMapKeys.placeDetail(tripId, placeId),
    queryFn: () => getPlannerMapPlaceDetail(tripId, placeId!),
    enabled: Boolean(tripId && placeId),
    staleTime: 60_000,
  })
}
