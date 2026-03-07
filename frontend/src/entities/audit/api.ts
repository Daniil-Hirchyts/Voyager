import { requestJson } from '@/shared/api/client'
import type { AuditLogListResponse } from '@/shared/api/types'

export interface AuditFilters {
  entity_type?: string
  action?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export async function listAudit(
  tripId: string,
  filters: AuditFilters = {},
): Promise<AuditLogListResponse> {
  const params = new URLSearchParams()
  if (filters.entity_type) params.set('entity_type', filters.entity_type)
  if (filters.action) params.set('action', filters.action)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.limit != null) params.set('limit', String(filters.limit))
  if (filters.offset != null) params.set('offset', String(filters.offset))
  const qs = params.toString()
  return requestJson<AuditLogListResponse>(`/trips/${tripId}/audit${qs ? `?${qs}` : ''}`)
}
