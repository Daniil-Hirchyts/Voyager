import { requestJson } from '@/shared/api/client'
import type {
  Place,
  PlaceCreateInput,
  PlaceListResponse,
} from '@/shared/api/types'

export interface PlaceListParams {
  q?: string
  limit?: number
  offset?: number
}

export interface NearbyPlaceParams {
  lat: number
  lon: number
  radius_m: number
  limit?: number
  offset?: number
}

export interface ViewportPlaceParams {
  min_lat: number
  min_lon: number
  max_lat: number
  max_lon: number
  limit?: number
  offset?: number
}

function buildQuery(
  path: string,
  params: Record<string, string | number | undefined> | object,
) {
  const url = new URL(path, 'http://voyager.local')
  for (const [key, value] of Object.entries(
    params as Record<string, string | number | undefined>,
  )) {
    if (value == null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}`
}

export async function listPlaces(params: PlaceListParams = {}) {
  return requestJson<PlaceListResponse>(buildQuery('/places', params))
}

export async function searchPlaces(params: PlaceListParams = {}) {
  return requestJson<PlaceListResponse>(buildQuery('/places/search', params))
}

export async function getNearbyPlaces(params: NearbyPlaceParams) {
  return requestJson<PlaceListResponse>(buildQuery('/places/nearby', params))
}

export async function getViewportPlaces(params: ViewportPlaceParams) {
  return requestJson<PlaceListResponse>(buildQuery('/places/viewport', params))
}

export async function getPlace(placeId: string) {
  return requestJson<Place>(`/places/${placeId}`)
}

export async function createPlace(data: PlaceCreateInput, idempotencyKey: string) {
  return requestJson<Place>('/places', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}
