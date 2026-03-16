import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listPlacePhotos, refreshPlacePhotos } from './api';

export const photoKeys = {
  list: (placeId: string) => ['place-photos', placeId] as const,
};

export function usePlacePhotos(placeId: string | null) {
  return useQuery({
    queryKey: photoKeys.list(placeId ?? '__none__'),
    queryFn: () => listPlacePhotos(placeId!),
    enabled: !!placeId,
    staleTime: 60_000,
  });
}

export function useRefreshPlacePhotos(placeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => refreshPlacePhotos(placeId, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: photoKeys.list(placeId) });
      // also invalidate place detail so primary_photo updates
      qc.invalidateQueries({ queryKey: ['place', placeId] });
    },
  });
}
