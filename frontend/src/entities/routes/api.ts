import { requestJson } from '@/shared/api/client'
import type {
  RouteLegEstimateInput,
  RouteLegEstimateResponse,
  RoutePreviewInput,
  RoutePreviewResponse,
} from '@/shared/api/types'

export async function previewRoutes(data: RoutePreviewInput) {
  return requestJson<RoutePreviewResponse>('/routes/preview', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function estimateRouteLegs(data: RouteLegEstimateInput) {
  return requestJson<RouteLegEstimateResponse>('/routes/legs', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
