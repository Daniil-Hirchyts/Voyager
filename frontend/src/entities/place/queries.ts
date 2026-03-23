import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  autocompleteDestinations,
  createPlace,
  getGooglePlace,
  getGooglePlaceDetail,
  getNearbyPlaces,
  getPlace,
  getViewportPlaces,
  listPlaces,
  searchGooglePlaces,
  searchPlaces,
} from './api';
import type {
  DestinationAutocompleteResponse,
  NearbyPlaceParams,
  PlaceListParams,
  ViewportPlaceParams,
} from './api';
import type { PlaceCreateInput } from '@/shared/api/types';

const PLACE_STALE_TIME = 15 * 60 * 1000; // 15 min — Google Places data doesn't change frequently

export const placeKeys = {
  all: ['places'] as const,
  list: (params: PlaceListParams) => ['places', 'list', params] as const,
  search: (params: PlaceListParams) => ['places', 'search', params] as const,
  googleSearch: (params: PlaceListParams) => ['places', 'google-search', params] as const,
  autocomplete: (params: PlaceListParams) => ['places', 'autocomplete', params] as const,
  nearby: (params: NearbyPlaceParams | null) => ['places', 'nearby', params] as const,
  viewport: (params: ViewportPlaceParams | null) => ['places', 'viewport', params] as const,
  detail: (placeId: string) => ['place', placeId] as const,
  googleDetail: (placeId: string) => ['places', 'google', placeId] as const,
  googleRichDetail: (placeId: string) => ['places', 'google', placeId, 'detail'] as const,
};

export function usePlaceList(params: PlaceListParams = {}) {
  return useQuery({
    queryKey: placeKeys.list(params),
    queryFn: () => listPlaces(params),
  });
}

export function usePlaceSearch(params: PlaceListParams, enabled = true) {
  return useQuery({
    queryKey: placeKeys.search(params),
    queryFn: () => searchPlaces(params),
    enabled,
  });
}

export function useGooglePlaceSearch(params: PlaceListParams, enabled = true) {
  return useQuery({
    queryKey: placeKeys.googleSearch(params),
    queryFn: () => searchGooglePlaces(params),
    enabled,
    staleTime: PLACE_STALE_TIME,
  });
}

export function useDestinationAutocomplete(params: PlaceListParams, enabled = true) {
  return useQuery<DestinationAutocompleteResponse>({
    queryKey: placeKeys.autocomplete(params),
    queryFn: () => autocompleteDestinations(params),
    enabled,
    staleTime: PLACE_STALE_TIME,
  });
}

export function useNearbyPlaces(params: NearbyPlaceParams | null, enabled = true) {
  return useQuery({
    queryKey: placeKeys.nearby(params),
    queryFn: () => getNearbyPlaces(params!),
    enabled: enabled && !!params,
    staleTime: PLACE_STALE_TIME,
  });
}

export function useViewportPlaces(params: ViewportPlaceParams | null, enabled = true) {
  return useQuery({
    queryKey: placeKeys.viewport(params),
    queryFn: () => getViewportPlaces(params!),
    enabled: enabled && !!params,
    staleTime: PLACE_STALE_TIME,
  });
}

export function usePlace(placeId: string | null | undefined) {
  return useQuery({
    queryKey: placeKeys.detail(placeId ?? '__none__'),
    queryFn: () => getPlace(placeId!),
    enabled: !!placeId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useGooglePlace(placeId: string | null | undefined) {
  return useQuery({
    queryKey: placeKeys.googleDetail(placeId ?? '__none__'),
    queryFn: () => getGooglePlace(placeId!),
    enabled: !!placeId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useGooglePlaceDetail(placeId: string | null | undefined) {
  return useQuery({
    queryKey: placeKeys.googleRichDetail(placeId ?? '__none__'),
    queryFn: () => getGooglePlaceDetail(placeId!),
    enabled: !!placeId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreatePlace() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ data, idempotencyKey }: { data: PlaceCreateInput; idempotencyKey: string }) =>
      createPlace(data, idempotencyKey),
    onSuccess: (place) => {
      qc.invalidateQueries({ queryKey: placeKeys.all });
      qc.setQueryData(placeKeys.detail(place.id), place);
    },
  });
}
