import { format } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  activityDiscoveryKeys,
  useAttachSavedActivityToDay,
  useDiscoverActivities,
  useSaveActivityToShortlist,
  useSavedActivities,
} from '@/entities/activity-discovery/queries'
import { createPlannerActivity } from '@/entities/activity/api'
import {
  readVoyagerPreferences,
  type VoyagerPreferences,
} from '@/entities/user/preferences'
import { useProfile } from '@/entities/user/queries'
import { plannerKeys } from '@/entities/planner/queries'
import type {
  ActivityDiscoveryItem,
  PlannerActivity,
  PlannerDay,
  Trip,
} from '@/shared/api/types'

export type PlannerRecommendationSource = 'discover' | 'saved_fit'

export interface PlannerRecommendationEntry {
  key: string
  source: PlannerRecommendationSource
  item: ActivityDiscoveryItem
  score: number | null
  rationale: string | null
}

export interface PlannerRecommendationDayOption {
  id: string
  label: string
  shortLabel: string
}

export interface PlannerRecommendationDestination {
  id: string
  label: string
  shortLabel: string
  description: string
  tripDayId: string | null
}

export interface PlannerRecommendationsController {
  enabled: boolean
  preferences: VoyagerPreferences
  targetDayId: string
  setTargetDayId: (dayId: string) => void
  dayOptions: PlannerRecommendationDayOption[]
  destinations: PlannerRecommendationDestination[]
  discoverEntries: PlannerRecommendationEntry[]
  isLoadingDiscover: boolean
  isRefreshing: boolean
  addingKey: string | null
  refresh: () => Promise<void>
  addEntryToDestination: (
    entry: PlannerRecommendationEntry,
    destinationId: string,
  ) => Promise<ActivityDiscoveryItem | null>
}

interface UsePlannerRecommendationsParams {
  tripId: string
  trip: Trip | null
  days: PlannerDay[]
  allActivities: PlannerActivity[]
  enabled: boolean
}

function buildEntry(
  item: ActivityDiscoveryItem,
  source: PlannerRecommendationSource,
  extras?: {
    score?: number | null
    rationale?: string | null
  },
): PlannerRecommendationEntry {
  return {
    key: `${source}:${item.snapshot_id ?? item.provider_ref}`,
    source,
    item,
    score: extras?.score ?? null,
    rationale: extras?.rationale ?? null,
  }
}

function buildShortlistSavePayload(
  item: ActivityDiscoveryItem,
  currency: string | null,
) {
  return {
    entity_type: item.entity_type,
    provider: item.provider,
    provider_ref: item.provider_ref,
    title: item.title,
    summary: item.summary,
    rating: item.rating,
    review_count: item.review_count,
    price_label: item.price_label,
    image_url: item.image_url,
    detail_url: item.detail_url,
    address_text: item.address_text,
    lat: item.lat,
    lon: item.lon,
    status_text: item.status_text,
    currency,
    raw_payload: {},
  }
}

function recommendationCategory(item: ActivityDiscoveryItem) {
  switch (item.entity_type) {
    case 'restaurant':
      return 'eat' as const
    case 'hotel':
      return 'hotel' as const
    case 'cruise':
      return 'travel' as const
    default:
      return 'visit' as const
  }
}

export function usePlannerRecommendations({
  tripId,
  trip,
  days,
  allActivities,
  enabled,
}: UsePlannerRecommendationsParams): PlannerRecommendationsController {
  const queryClient = useQueryClient()
  const { data: profile } = useProfile()
  const preferences = readVoyagerPreferences(profile)
  const [targetDayId, setTargetDayId] = useState(days[0]?.id ?? '')
  const [addingKey, setAddingKey] = useState<string | null>(null)

  useEffect(() => {
    if (!days.length) {
      setTargetDayId('')
      return
    }

    if (!days.some((day) => day.id === targetDayId)) {
      setTargetDayId(days[0].id)
    }
  }, [days, targetDayId])

  const dayOptions = useMemo(
    () =>
      days.map((day) => ({
        id: day.id,
        label: `Day ${day.day_index + 1} · ${format(new Date(day.date), 'EEE, MMM d')}`,
        shortLabel: `Day ${day.day_index + 1}`,
      })),
    [days],
  )
  const destinations = useMemo<PlannerRecommendationDestination[]>(
    () => [
      {
        id: 'inbox',
        label: 'Inbox',
        shortLabel: 'Inbox',
        description: 'Keep it unassigned for later',
        tripDayId: null,
      },
      ...days.map((day) => ({
        id: day.id,
        label: `Day ${day.day_index + 1} · ${format(new Date(day.date), 'EEE, MMM d')}`,
        shortLabel: `Day ${day.day_index + 1}`,
        description: day.date ? format(new Date(day.date), 'EEEE, MMM d') : 'Trip day',
        tripDayId: day.id,
      })),
    ],
    [days],
  )

  const shortlistQuery = useSavedActivities(tripId)
  const shortlistItems = shortlistQuery.data?.items ?? []
  const attachedSnapshotIds = useMemo(
    () =>
      new Set(
        allActivities
          .map((activity) => activity.event_snapshot_id)
          .filter((snapshotId): snapshotId is string => Boolean(snapshotId)),
      ),
    [allActivities],
  )
  const savedProviderRefs = useMemo(
    () =>
      new Set(
        shortlistItems
          .map((item) => item.provider_ref)
          .filter((providerRef): providerRef is string => Boolean(providerRef)),
      ),
    [shortlistItems],
  )
  const discoverParams = useMemo(
    () => ({
      entity_type: 'attraction' as const,
      query: trip?.destination_text ?? '',
      limit: preferences.recommendations.resultLimit,
      locale: 'en-US',
      currency: trip?.budget_currency || 'USD',
      min_rating: preferences.recommendations.minRating ?? undefined,
      good_for:
        preferences.recommendations.audience === 'any'
          ? undefined
          : preferences.recommendations.audience,
    }),
    [
      preferences.recommendations.audience,
      preferences.recommendations.minRating,
      preferences.recommendations.resultLimit,
      trip?.budget_currency,
      trip?.destination_text,
    ],
  )
  const discoverQuery = useDiscoverActivities(
    tripId,
    discoverParams,
    enabled && Boolean(trip?.destination_text),
  )
  const saveMutation = useSaveActivityToShortlist(tripId)
  const attachMutation = useAttachSavedActivityToDay(tripId)

  const discoverEntries = useMemo(
    () =>
      (discoverQuery.data?.items ?? [])
        .filter((item) => !savedProviderRefs.has(item.provider_ref))
        .filter((item) => !item.snapshot_id || !attachedSnapshotIds.has(item.snapshot_id))
        .map((item) => buildEntry(item, 'discover')),
    [attachedSnapshotIds, discoverQuery.data?.items, savedProviderRefs],
  )

  async function persistEntry(entry: PlannerRecommendationEntry) {
    // Only skip saving if we already have a snapshot with a linked place
    if (entry.item.snapshot_id && entry.item.place_id) {
      return entry.item
    }

    try {
      return await saveMutation.mutateAsync({
        data: buildShortlistSavePayload(
          entry.item,
          trip?.budget_currency || 'USD',
        ),
        idempotencyKey: crypto.randomUUID(),
      })
    } catch {
      return null
    }
  }

  async function addEntryToDestination(
    entry: PlannerRecommendationEntry,
    destinationId: string,
  ) {
    const destination = destinations.find((item) => item.id === destinationId)
    if (!destination) {
      toast.error('Choose where to add this recommendation')
      return null
    }
    if (!trip) {
      toast.error('The trip is still loading')
      return null
    }

    setAddingKey(entry.key)
    try {
      const saved = await persistEntry(entry)
      const snapshotId = saved?.snapshot_id
      if (!snapshotId) {
        toast.error('This recommendation could not be prepared')
        return null
      }

      if (destination.tripDayId) {
        await attachMutation.mutateAsync({
          snapshotId,
          data: { trip_day_id: destination.tripDayId },
          tripVersion: trip.version,
          idempotencyKey: crypto.randomUUID(),
        })
      } else {
        await createPlannerActivity(
          tripId,
          {
            trip_day_id: null,
            category: recommendationCategory(saved),
            title: saved.title,
            description: saved.summary,
            place_id: saved.place_id,
            source: 'manual',
            event_snapshot_id: snapshotId,
          },
          crypto.randomUUID(),
        )
      }

      await queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) })
      await queryClient.invalidateQueries({ queryKey: activityDiscoveryKeys.shortlist(tripId) })
      await queryClient.invalidateQueries({ queryKey: ['activities-discover', tripId] })
      toast.success(
        destination.tripDayId
          ? `Recommendation added to ${destination.shortLabel}`
          : 'Recommendation added to inbox',
      )
      return saved
    } catch {
      toast.error('Could not add this recommendation')
      return null
    } finally {
      setAddingKey(null)
    }
  }

  async function refresh() {
    await Promise.all([shortlistQuery.refetch(), discoverQuery.refetch()])
  }

  return {
    enabled,
    preferences,
    targetDayId,
    setTargetDayId,
    dayOptions,
    destinations,
    discoverEntries,
    isLoadingDiscover: discoverQuery.isLoading || discoverQuery.isFetching,
    isRefreshing: shortlistQuery.isFetching || discoverQuery.isFetching,
    addingKey,
    refresh,
    addEntryToDestination,
  }
}
