import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  attachSavedActivityToDay,
  discoverActivities,
  getActivityRecommendations,
  getSavedActivityDetail,
  listSavedActivities,
  saveActivityToShortlist,
} from './api'
import type {
  ActivityAttachDayInput,
  ActivityDiscoverInput,
  ActivityRecommendationInput,
  ActivityShortlistSaveInput,
} from '@/shared/api/types'
import { isRateLimit } from '@/shared/api/client'
import { activityKeys as plannerActivityKeys } from '@/entities/activity/queries'
import { dayKeys } from '@/entities/day/queries'
import { proposalKeys } from '@/entities/proposal/queries'
import { tripKeys } from '@/entities/trip/queries'

export const activityDiscoveryKeys = {
  discover: (tripId: string, params: ActivityDiscoverInput) =>
    ['activities-discover', tripId, params] as const,
  shortlist: (tripId: string) => ['activities-shortlist', tripId] as const,
  shortlistDetail: (snapshotId: string | null) =>
    ['activities-shortlist-detail', snapshotId ?? '__none__'] as const,
  recommendations: (tripId: string, params: ActivityRecommendationInput) =>
    ['activities-recommendations', tripId, params] as const,
}

export function useDiscoverActivities(tripId: string, params: ActivityDiscoverInput, enabled = true) {
  return useQuery({
    queryKey: activityDiscoveryKeys.discover(tripId, params),
    queryFn: () => discoverActivities(tripId, params),
    enabled: enabled && !!tripId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (isRateLimit(error)) {
        return false
      }
      return failureCount < 1
    },
  })
}

export function useSavedActivities(tripId: string) {
  return useQuery({
    queryKey: activityDiscoveryKeys.shortlist(tripId),
    queryFn: () => listSavedActivities(tripId, { limit: 100, offset: 0 }),
    enabled: !!tripId,
    staleTime: 15_000,
  })
}

export function useSavedActivityDetail(snapshotId: string | null, locale = 'en-US') {
  return useQuery({
    queryKey: activityDiscoveryKeys.shortlistDetail(snapshotId),
    queryFn: () => getSavedActivityDetail(snapshotId!, { locale }),
    enabled: !!snapshotId,
    staleTime: 30_000,
  })
}

export function useSaveActivityToShortlist(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      data,
      idempotencyKey,
    }: {
      data: ActivityShortlistSaveInput
      idempotencyKey: string
    }) => saveActivityToShortlist(tripId, data, idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activityDiscoveryKeys.shortlist(tripId) })
      qc.invalidateQueries({ queryKey: ['activities-discover', tripId] })
    },
  })
}

export function useAttachSavedActivityToDay(tripId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      snapshotId,
      data,
      tripVersion,
      idempotencyKey,
    }: {
      snapshotId: string
      data: ActivityAttachDayInput
      tripVersion: number
      idempotencyKey: string
    }) => attachSavedActivityToDay(tripId, snapshotId, data, tripVersion, idempotencyKey),
    onSuccess: (_result, { data }) => {
      qc.invalidateQueries({ queryKey: activityDiscoveryKeys.shortlist(tripId) })
      qc.invalidateQueries({ queryKey: tripKeys.detail(tripId) })
      qc.invalidateQueries({ queryKey: dayKeys.list(tripId) })
      qc.invalidateQueries({ queryKey: plannerActivityKeys.list(data.trip_day_id) })
      qc.invalidateQueries({ queryKey: proposalKeys.list(tripId) })
    },
  })
}

export function useActivityRecommendations(tripId: string) {
  return useMutation({
    mutationFn: (data: ActivityRecommendationInput) => getActivityRecommendations(tripId, data),
  })
}
