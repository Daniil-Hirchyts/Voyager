import { requestJson, buildApiUrl, createRequestHeaders } from '@/shared/api/client'
import type { ExportFormat, ExportResponse, JobAcceptedResponse } from '@/shared/api/types'

export async function submitExport(
  tripId: string,
  format: ExportFormat,
  tripVersion: number,
  idempotencyKey: string,
): Promise<JobAcceptedResponse> {
  return requestJson<JobAcceptedResponse>(`/trips/${tripId}/exports`, {
    method: 'POST',
    headers: {
      'If-Match': String(tripVersion),
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ format }),
  })
}

export async function getExport(exportId: string): Promise<ExportResponse> {
  return requestJson<ExportResponse>(`/exports/${exportId}`)
}

export async function downloadExportContent(exportId: string): Promise<Response> {
  const url = buildApiUrl(`/exports/${exportId}/content`)
  const headers = createRequestHeaders()
  return fetch(url, { headers })
}

export async function downloadExportContentAtPath(path: string): Promise<Response> {
  const url = buildApiUrl(path)
  const headers = createRequestHeaders()
  return fetch(url, { headers })
}
