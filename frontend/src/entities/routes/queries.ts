import { useQuery } from '@tanstack/react-query'
import { estimateRouteLegs, previewRoutes } from './api'
import type { RouteLegEstimateInput, RoutePreviewInput } from '@/shared/api/types'

export const routeKeys = {
  preview: (payload: RoutePreviewInput | null) => ['routes', 'preview', payload] as const,
  legs: (payload: RouteLegEstimateInput | null) => ['routes', 'legs', payload] as const,
}

export function useRoutePreview(payload: RoutePreviewInput | null, enabled = true) {
  return useQuery({
    queryKey: routeKeys.preview(payload),
    queryFn: () => previewRoutes(payload!),
    enabled: enabled && !!payload,
  })
}

export function useRouteLegEstimates(payload: RouteLegEstimateInput | null, enabled = true) {
  return useQuery({
    queryKey: routeKeys.legs(payload),
    queryFn: () => estimateRouteLegs(payload!),
    enabled: enabled && !!payload,
  })
}
