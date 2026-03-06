import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getActivities,
  createActivity,
  patchActivity,
  deleteActivity,
  reorderActivities,
  moveActivity,
} from './api'
import type {
  ActivityCreateInput,
  ActivityMoveInput,
  ActivityReorderInput,
  ActivityUpdateInput,
} from '@/shared/api/types'

export const activityKeys = {
  list: (dayId: string) => ['activities', dayId] as const,
}

export function useActivities(dayId: string) {
  return useQuery({
    queryKey: activityKeys.list(dayId),
    queryFn: () => getActivities(dayId),
    enabled: !!dayId,
    staleTime: 30_000,
  })
}

export function useCreateActivity(dayId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ data, idempotencyKey }: { data: ActivityCreateInput; idempotencyKey: string }) =>
      createActivity(dayId, data, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activityKeys.list(dayId) })
    },
  })
}

export function usePatchActivity(dayId: string, activityId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ data }: { data: Partial<ActivityUpdateInput> }) =>
      patchActivity(activityId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activityKeys.list(dayId) })
    },
  })
}

export function useDeleteActivity(dayId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (activityId: string) => deleteActivity(activityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activityKeys.list(dayId) })
    },
  })
}

export function useReorderActivities(tripId: string, dayId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { data: ActivityReorderInput; tripVersion: number }) =>
      reorderActivities(dayId, payload.data, payload.tripVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activityKeys.list(dayId) })
      qc.invalidateQueries({ queryKey: ['trip', tripId] })
    },
  })
}

export function useMoveActivity(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      activityId,
      data,
      tripVersion,
    }: {
      activityId: string
      data: ActivityMoveInput
      tripVersion: number
    }) => moveActivity(activityId, data, tripVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip', tripId] })
      qc.invalidateQueries({ queryKey: ['trip-days', tripId] })
      qc.invalidateQueries({ queryKey: ['activities'] })
    },
  })
}
