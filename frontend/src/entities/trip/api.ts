import { requestJson } from '@/shared/api/client'
import type {
  Trip,
  TripCreateInput,
  TripListResponse,
  TripUpdateInput,
} from '@/shared/api/types'

export interface TripListParams {
  limit?: number
  offset?: number
}

export async function getTrips(params?: TripListParams): Promise<TripListResponse> {
  const url = new URL('/trips', 'http://voyager.local')
  if (params?.limit) url.searchParams.set('limit', String(params.limit))
  if (params?.offset) url.searchParams.set('offset', String(params.offset))
  return requestJson<TripListResponse>(`${url.pathname}${url.search}`)
}

export async function getTrip(tripId: string): Promise<Trip> {
  return requestJson<Trip>(`/trips/${tripId}`)
}

export async function createTrip(data: TripCreateInput, idempotencyKey: string): Promise<Trip> {
  return requestJson<Trip>('/trips', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function patchTrip(
  tripId: string,
  data: Partial<TripUpdateInput>,
  version: number,
): Promise<Trip> {
  return requestJson<Trip>(`/trips/${tripId}`, {
    method: 'PATCH',
    headers: { 'If-Match': String(version) },
    body: JSON.stringify(data),
  })
}

export async function deleteTrip(tripId: string): Promise<void> {
  return requestJson<void>(`/trips/${tripId}`, {
    method: 'DELETE',
  })
}

export async function duplicateTrip(tripId: string, idempotencyKey: string): Promise<Trip> {
  return requestJson<Trip>(`/trips/${tripId}/duplicate`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  })
}
