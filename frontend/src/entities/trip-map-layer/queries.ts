import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTripMapLayer,
  deleteTripMapLayer,
  getTripMapLayer,
  listTripMapLayers,
  patchTripMapLayer,
} from './api';
import type { TripMapLayerCreateRequest, TripMapLayerPatchRequest } from '@/shared/api/types';

export const tripMapLayerKeys = {
  all: ['trip-map-layers'] as const,
  list: (tripId: string, limit = 100, offset = 0) =>
    ['trip-map-layers', 'list', tripId, limit, offset] as const,
  detail: (tripId: string, layerId: string) =>
    ['trip-map-layers', 'detail', tripId, layerId] as const,
};

export function useTripMapLayers(tripId: string, limit = 100, offset = 0) {
  return useQuery({
    queryKey: tripMapLayerKeys.list(tripId, limit, offset),
    queryFn: () => listTripMapLayers(tripId, { limit, offset }),
    enabled: Boolean(tripId),
  });
}

export function useTripMapLayer(tripId: string, layerId: string | null | undefined) {
  return useQuery({
    queryKey: tripMapLayerKeys.detail(tripId, layerId ?? '__none__'),
    queryFn: () => getTripMapLayer(tripId, layerId!),
    enabled: Boolean(tripId && layerId),
  });
}

export function useCreateTripMapLayer(tripId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: TripMapLayerCreateRequest;
      idempotencyKey: string;
    }) => createTripMapLayer(tripId, data, idempotencyKey),
    onSuccess: (layer) => {
      qc.invalidateQueries({ queryKey: tripMapLayerKeys.all });
      qc.setQueryData(tripMapLayerKeys.detail(tripId, layer.id), layer);
    },
  });
}

export function usePatchTripMapLayer(tripId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ layerId, data }: { layerId: string; data: TripMapLayerPatchRequest }) =>
      patchTripMapLayer(tripId, layerId, data),
    onSuccess: (layer) => {
      qc.invalidateQueries({ queryKey: tripMapLayerKeys.all });
      qc.setQueryData(tripMapLayerKeys.detail(tripId, layer.id), layer);
    },
  });
}

export function useDeleteTripMapLayer(tripId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (layerId: string) => deleteTripMapLayer(tripId, layerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tripMapLayerKeys.all });
    },
  });
}
