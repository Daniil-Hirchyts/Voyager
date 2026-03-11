import { requestJson } from '@/shared/api/client'
import type {
  GooglePlaceCandidate,
  GooglePlaceDetail,
  GooglePlaceSearchResponse,
  Place,
  PlaceCreateInput,
  PlaceListResponse,
} from '@/shared/api/types'

export interface PlaceListParams {
  q?: string
  limit?: number
  offset?: number
  lat?: number
  lon?: number
  radius_m?: number
  category?: string
}

export interface DestinationAutocompleteItem {
  id: string
  label: string
  name?: string | null
  country?: string | null
  region?: string | null
  lat?: number | null
  lon?: number | null
  address_text?: string | null
  category?: string | null
  timezone?: string | null
  metadata?: Record<string, unknown>
}

export interface DestinationAutocompleteResponse {
  total: number
  limit: number
  offset: number
  items: DestinationAutocompleteItem[]
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

export async function autocompleteDestinations(params: PlaceListParams = {}) {
  return requestJson<DestinationAutocompleteResponse>(buildQuery('/places/autocomplete', params))
}

export async function searchGooglePlaces(params: PlaceListParams = {}) {
  return requestJson<GooglePlaceSearchResponse>(buildQuery('/places/google-search', params))
}

export async function getGooglePlace(placeId: string) {
  return requestJson<GooglePlaceCandidate>(`/places/google/${encodeURIComponent(placeId)}`)
}

export async function getGooglePlaceDetail(placeId: string) {
  return requestJson<GooglePlaceDetail>(`/places/google/${encodeURIComponent(placeId)}/detail`)
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
