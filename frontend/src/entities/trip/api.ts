import { requestJson } from '@/shared/api/client'
import type {
  Trip,
  TripCoverPreference,
  TripCreateInput,
  TripListResponse,
  TripUpdateInput,
} from '@/shared/api/types'

export interface TripListParams {
  limit?: number
  offset?: number
}

type TripCoverPreferencePayload = {
  place_id?: string | null
  place_label?: string | null
  place_lat?: number | null
  place_lng?: number | null
  photo_id?: string | null
  asset_id?: string | null
  fallback_image_url?: string | null
} | null

type TripCoverPhotoPayload = {
  source: string
  url: string
  thumbnail_url?: string | null
  asset_id?: string | null
  photo_id?: string | null
  place_id?: string | null
  attribution_text?: string | null
  is_fallback?: boolean | null
} | null

type TripPayload = Omit<Trip, 'coverPreference' | 'coverPhoto'> & {
  cover_preference?: TripCoverPreferencePayload
  cover_photo?: TripCoverPhotoPayload
}

type TripListResponsePayload = Omit<TripListResponse, 'items'> & {
  items: TripPayload[]
}

function normalizeTripCoverPreference(
  coverPreference: TripCoverPreferencePayload,
): TripCoverPreference | null {
  if (!coverPreference) {
    return null
  }

  return {
    placeId: coverPreference.place_id ?? null,
    placeLabel: coverPreference.place_label ?? null,
    placeLat: coverPreference.place_lat ?? null,
    placeLng: coverPreference.place_lng ?? null,
    photoId: coverPreference.photo_id ?? null,
    assetId: coverPreference.asset_id ?? null,
    fallbackImageUrl: coverPreference.fallback_image_url ?? null,
  }
}

function normalizeTripCoverPhoto(coverPhoto: TripCoverPhotoPayload) {
  if (!coverPhoto) {
    return null
  }

  return {
    source: coverPhoto.source,
    url: coverPhoto.url,
    thumbnailUrl: coverPhoto.thumbnail_url ?? null,
    assetId: coverPhoto.asset_id ?? null,
    photoId: coverPhoto.photo_id ?? null,
    placeId: coverPhoto.place_id ?? null,
    attributionText: coverPhoto.attribution_text ?? null,
    isFallback: coverPhoto.is_fallback ?? false,
  }
}

export function normalizeTrip(trip: TripPayload): Trip {
  const { cover_preference, cover_photo, ...rest } = trip
  return {
    ...rest,
    coverPreference: normalizeTripCoverPreference(cover_preference ?? null),
    coverPhoto: normalizeTripCoverPhoto(cover_photo ?? null),
  }
}

function toTripCoverPreferencePayload(data: Partial<TripCoverPreference>) {
  const payload: Record<string, string | number | null> = {}

  if ('placeId' in data) payload.place_id = data.placeId ?? null
  if ('placeLabel' in data) payload.place_label = data.placeLabel ?? null
  if ('placeLat' in data) payload.place_lat = data.placeLat ?? null
  if ('placeLng' in data) payload.place_lng = data.placeLng ?? null
  if ('photoId' in data) payload.photo_id = data.photoId ?? null
  if ('assetId' in data) payload.asset_id = data.assetId ?? null
  if ('fallbackImageUrl' in data) payload.fallback_image_url = data.fallbackImageUrl ?? null

  return payload
}

export async function getTrips(params?: TripListParams): Promise<TripListResponse> {
  const url = new URL('/trips', 'http://voyager.local')
  if (params?.limit) url.searchParams.set('limit', String(params.limit))
  if (params?.offset) url.searchParams.set('offset', String(params.offset))
  const response = await requestJson<TripListResponsePayload>(`${url.pathname}${url.search}`)
  return {
    ...response,
    items: response.items.map(normalizeTrip),
  }
}

export async function getTrip(tripId: string): Promise<Trip> {
  return normalizeTrip(await requestJson<TripPayload>(`/trips/${tripId}`))
}

export async function createTrip(data: TripCreateInput, idempotencyKey: string): Promise<Trip> {
  return normalizeTrip(await requestJson<TripPayload>('/trips', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  }))
}

export async function patchTrip(
  tripId: string,
  data: Partial<TripUpdateInput>,
  version: number,
): Promise<Trip> {
  return normalizeTrip(await requestJson<TripPayload>(`/trips/${tripId}`, {
    method: 'PATCH',
    headers: { 'If-Match': String(version) },
    body: JSON.stringify(data),
  }))
}

export async function deleteTrip(tripId: string): Promise<void> {
  return requestJson<void>(`/trips/${tripId}`, {
    method: 'DELETE',
  })
}

export async function duplicateTrip(tripId: string, idempotencyKey: string): Promise<Trip> {
  return normalizeTrip(await requestJson<TripPayload>(`/trips/${tripId}/duplicate`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  }))
}

export async function patchTripCoverPreference(
  tripId: string,
  data: Partial<TripCoverPreference>,
): Promise<Trip> {
  return normalizeTrip(await requestJson<TripPayload>(`/trips/${tripId}/cover-preference`, {
    method: 'PATCH',
    body: JSON.stringify(toTripCoverPreferencePayload(data)),
  }))
}
