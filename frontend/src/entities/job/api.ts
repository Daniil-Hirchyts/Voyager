import { buildApiUrl, createRequestHeaders, requestJson, toApiError } from '@/shared/api/client'
import type {
  Job,
  JobAcceptedResponse,
  JobProgressEvent,
  TripGenerateInput,
  TripResetInput,
} from '@/shared/api/types'

export async function getJob(jobId: string): Promise<Job> {
  return requestJson<Job>(`/jobs/${jobId}`)
}

export async function streamJobProgress(
  jobId: string,
  onEvent: (event: JobProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(buildApiUrl(`/jobs/${jobId}/stream`), {
    method: 'GET',
    headers: createRequestHeaders(),
    signal,
  })
  if (!response.ok || !response.body) {
    if (!response.ok) {
      throw await toApiError(response)
    }
    throw new Error('Failed to stream job progress')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const chunks = buffer.split('\n')
    buffer = chunks.pop() ?? ''

    for (const line of chunks) {
      if (!line.startsWith('data: ')) continue
      const payloadText = line.slice(6)
      try {
        onEvent(JSON.parse(payloadText) as JobProgressEvent)
      } catch {
        // ignore malformed events
      }
    }
  }
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
