import { useQuery } from '@tanstack/react-query';
import { estimateRouteLegs, previewRoutes } from './api';
import type { RouteLegEstimateInput, RoutePreviewInput } from '@/shared/api/types';

export const routeKeys = {
  preview: (payload: RoutePreviewInput | null) => ['routes', 'preview', payload] as const,
  legs: (payload: RouteLegEstimateInput | null) => ['routes', 'legs', payload] as const,
};

const ROUTES_STALE_TIME = 5 * 60 * 1000; // 5 minutes — routes for given coordinates don't change

export function useRoutePreview(payload: RoutePreviewInput | null, enabled = true) {
  return useQuery({
    queryKey: routeKeys.preview(payload),
    queryFn: () => previewRoutes(payload!),
    enabled: enabled && !!payload,
    staleTime: ROUTES_STALE_TIME,
  });
}

export function useRouteLegEstimates(payload: RouteLegEstimateInput | null, enabled = true) {
  return useQuery({
    queryKey: routeKeys.legs(payload),
    queryFn: () => estimateRouteLegs(payload!),
    enabled: enabled && !!payload,
    staleTime: ROUTES_STALE_TIME,
  });
}
