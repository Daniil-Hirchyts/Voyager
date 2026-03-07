import { useQuery } from '@tanstack/react-query'
import { listAudit } from './api'
import type { AuditFilters } from './api'

export const auditKeys = {
  list: (tripId: string, filters: AuditFilters) => ['audit', tripId, filters] as const,
}

export function useAuditLog(tripId: string, filters: AuditFilters = {}) {
  return useQuery({
    queryKey: auditKeys.list(tripId, filters),
    queryFn: () => listAudit(tripId, filters),
    enabled: !!tripId,
    staleTime: 30_000,
  })
}
