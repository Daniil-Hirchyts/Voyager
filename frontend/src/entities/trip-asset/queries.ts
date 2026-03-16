import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteTripAsset, getTripAsset, listTripAssets, uploadTripAsset } from './api';

export const tripAssetKeys = {
  all: (tripId: string) => ['trip-assets', tripId] as const,
  list: (tripId: string, activityId?: string | null) =>
    ['trip-assets', tripId, activityId ?? '__trip__'] as const,
  detail: (assetId: string) => ['trip-asset', assetId] as const,
};

export function useTripAssets(tripId: string, activityId?: string | null) {
  return useQuery({
    queryKey: tripAssetKeys.list(tripId, activityId),
    queryFn: () => listTripAssets(tripId, activityId),
    enabled: Boolean(tripId),
  });
}

export function useTripAsset(assetId: string | null | undefined) {
  return useQuery({
    queryKey: tripAssetKeys.detail(assetId ?? '__none__'),
    queryFn: () => getTripAsset(assetId!),
    enabled: Boolean(assetId),
  });
}

export function useUploadTripAsset(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, activityId }: { file: File; activityId?: string | null }) =>
      uploadTripAsset(tripId, file, activityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripAssetKeys.all(tripId) });
    },
  });
}

export function useDeleteTripAsset(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => deleteTripAsset(assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tripAssetKeys.all(tripId) });
    },
  });
}
