import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { searchEvents, listTripEvents, getEvent, attachEventToDay } from './api'
import type { EventAttachDayInput, EventSearchInput } from '@/shared/api/types'
import { tripKeys } from '@/entities/trip/queries'
import { dayKeys } from '@/entities/day/queries'
import { activityKeys } from '@/entities/activity/queries'

export const eventKeys = {
  list: (tripId: string) => ['events', tripId] as const,
  detail: (eventId: string) => ['event', eventId] as const,
}

export function useTripEvents(tripId: string) {
  return useQuery({
    queryKey: eventKeys.list(tripId),
    queryFn: () => listTripEvents(tripId, { limit: 100 }),
    enabled: !!tripId,
    staleTime: 30_000,
  })
}

export function useEvent(eventId: string | null) {
  return useQuery({
    queryKey: eventKeys.detail(eventId ?? '__none__'),
    queryFn: () => getEvent(eventId!),
    enabled: !!eventId,
    staleTime: 60_000,
  })
}

export function useSearchEvents(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: EventSearchInput
      idempotencyKey: string
    }) => searchEvents(data, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eventKeys.list(tripId) })
    },
  })
}

export function useAttachEventToDay(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      eventId,
      data,
      tripVersion,
      idempotencyKey,
    }: {
      eventId: string
      data: EventAttachDayInput
      tripVersion: number
      idempotencyKey: string
    }) => attachEventToDay(tripId, eventId, data, tripVersion, idempotencyKey),
    onSuccess: (_result, { data }) => {
      qc.invalidateQueries({ queryKey: eventKeys.list(tripId) })
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: dayKeys.list(tripId) })
      qc.invalidateQueries({ queryKey: activityKeys.list(data.trip_day_id) })
    },
  })
}
