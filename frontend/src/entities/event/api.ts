import { requestJson } from '@/shared/api/client'
import type { EventResponse, EventListResponse, EventSearchInput, EventAttachDayInput, JobAcceptedResponse } from '@/shared/api/types'

export async function searchEvents(
  data: EventSearchInput,
  idempotencyKey: string,
): Promise<JobAcceptedResponse> {
  return requestJson<JobAcceptedResponse>('/events/search', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function listTripEvents(
  tripId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<EventListResponse> {
  const qs = new URLSearchParams()
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  const q = qs.toString()
  return requestJson<EventListResponse>(`/trips/${tripId}/events${q ? `?${q}` : ''}`)
}

export async function getEvent(eventId: string): Promise<EventResponse> {
  return requestJson<EventResponse>(`/events/${eventId}`)
}

export async function attachEventToDay(
  tripId: string,
  eventId: string,
  data: EventAttachDayInput,
  tripVersion: number,
  idempotencyKey: string,
): Promise<EventResponse> {
  return requestJson<EventResponse>(`/trips/${tripId}/events/${eventId}/attach-day`, {
    method: 'POST',
    headers: {
      'If-Match': String(tripVersion),
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(data),
  })
}
