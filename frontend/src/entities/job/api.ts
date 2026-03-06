import { requestJson } from '@/shared/api/client'
import type { Job, JobAcceptedResponse, TripGenerateInput, TripRegenerateInput, TripResetInput } from '@/shared/api/types'

export async function getJob(jobId: string): Promise<Job> {
  return requestJson<Job>(`/jobs/${jobId}`)
}

export async function generateItinerary(
  tripId: string,
  data: TripGenerateInput,
  tripVersion: number,
  idempotencyKey: string,
): Promise<JobAcceptedResponse> {
  return requestJson<JobAcceptedResponse>(`/trips/${tripId}/generate`, {
    method: 'POST',
    headers: { 'If-Match': String(tripVersion), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function regenerateItinerary(
  tripId: string,
  data: TripRegenerateInput,
  tripVersion: number,
  idempotencyKey: string,
): Promise<JobAcceptedResponse> {
  return requestJson<JobAcceptedResponse>(`/trips/${tripId}/regenerate`, {
    method: 'POST',
    headers: { 'If-Match': String(tripVersion), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function resetItinerary(
  tripId: string,
  data: TripResetInput,
  tripVersion: number,
  idempotencyKey: string,
): Promise<JobAcceptedResponse> {
  return requestJson<JobAcceptedResponse>(`/trips/${tripId}/reset-itinerary`, {
    method: 'POST',
    headers: { 'If-Match': String(tripVersion), 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}
