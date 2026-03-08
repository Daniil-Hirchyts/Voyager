import { requestJson } from '@/shared/api/client'
import type {
  TripMapLayer,
  TripMapLayerCreateRequest,
  TripMapLayerListResponse,
  TripMapLayerPatchRequest,
} from '@/shared/api/types'

export interface TripMapLayerListParams {
  limit?: number
  offset?: number
}

function buildQuery(
  path: string,
  params: Record<string, string | number | undefined> | TripMapLayerListParams,
) {
  const url = new URL(path, 'http://voyager.local')
  for (const [key, value] of Object.entries(params as Record<string, string | number | undefined>)) {
    if (value == null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}`
}

export async function listTripMapLayers(
  tripId: string,
  params: TripMapLayerListParams = {},
) {
  return requestJson<TripMapLayerListResponse>(buildQuery(`/trips/${tripId}/map-layers`, params))
}

export async function getTripMapLayer(tripId: string, layerId: string) {
  return requestJson<TripMapLayer>(`/trips/${tripId}/map-layers/${layerId}`)
}

export async function createTripMapLayer(
  tripId: string,
  data: TripMapLayerCreateRequest,
  idempotencyKey: string,
) {
  return requestJson<TripMapLayer>(`/trips/${tripId}/map-layers`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function patchTripMapLayer(
  tripId: string,
  layerId: string,
  data: TripMapLayerPatchRequest,
) {
  return requestJson<TripMapLayer>(`/trips/${tripId}/map-layers/${layerId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteTripMapLayer(tripId: string, layerId: string) {
  return requestJson<void>(`/trips/${tripId}/map-layers/${layerId}`, {
    method: 'DELETE',
  })
}
