import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTrips, getTrip, createTrip, patchTrip, deleteTrip, duplicateTrip } from './api'
import type { TripCreateInput, TripUpdateInput } from '@/shared/api/types'
import { plannerKeys } from '@/entities/planner/queries'
import type { TripListParams } from './api'

export const tripKeys = {
  all: ['trips'] as const,
  lists: (filters?: TripListParams) => ['trips', 'list', filters] as const,
  detail: (id: string) => ['trip', id] as const,
}

export function useTrips(params?: TripListParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: tripKeys.lists(params),
    queryFn: () => getTrips(params),
    enabled: options?.enabled ?? true,
  })
}

export function useTrip(tripId: string) {
  return useQuery({
    queryKey: tripKeys.detail(tripId),
    queryFn: () => getTrip(tripId),
    enabled: !!tripId,
  })
}

export function useCreateTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: TripCreateInput
      idempotencyKey: string
    }) => createTrip(data, idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: tripKeys.all }),
  })
}

export function usePatchTrip(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      data,
      version,
    }: {
      data: Partial<TripUpdateInput>
      version: number
    }) => patchTrip(tripId, data, version),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: tripKeys.all })
      qc.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
    },
  })
}

export function useDeleteTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tripId: string) => deleteTrip(tripId),
    onSuccess: () => qc.invalidateQueries({ queryKey: tripKeys.all }),
  })
}

export function useDuplicateTrip() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      tripId,
      idempotencyKey,
    }: {
      tripId: string
      idempotencyKey: string
    }) => duplicateTrip(tripId, idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: tripKeys.all }),
  })
}
