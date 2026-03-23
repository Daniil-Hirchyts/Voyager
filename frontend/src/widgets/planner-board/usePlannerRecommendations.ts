import { format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  activityDiscoveryKeys,
  useAttachSavedActivityToDay,
  useDiscoverActivities,
  useSaveActivityToShortlist,
  useSavedActivities,
} from '@/entities/activity-discovery/queries';
import { createPlannerActivity } from '@/entities/activity/api';
import { searchGooglePlaces } from '@/entities/place/api';
import { placeKeys } from '@/entities/place/queries';
import { readVoyagerPreferences, type VoyagerPreferences } from '@/entities/user/preferences';
import { useProfile } from '@/entities/user/queries';
import { plannerKeys } from '@/entities/planner/queries';
import type {
  ActivityDiscoveryItem,
  GooglePlaceCandidate,
  PlannerActivity,
  PlannerDay,
  Trip,
} from '@/shared/api/types';
import {
  buildRecommendationPlaceQueries,
  selectBestRecommendationPlaceMatch,
} from './recommendation-place-match';

export type PlannerRecommendationSource = 'discover' | 'saved_fit';

export interface PlannerRecommendationEntry {
  key: string;
  source: PlannerRecommendationSource;
  item: ActivityDiscoveryItem;
  score: number | null;
  rationale: string | null;
  matchedPlace: GooglePlaceCandidate | null;
}

export interface PlannerRecommendationDayOption {
  id: string;
  label: string;
  shortLabel: string;
}

export interface PlannerRecommendationDestination {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  tripDayId: string | null;
}

export interface PlannerRecommendationsController {
  enabled: boolean;
  preferences: VoyagerPreferences;
  targetDayId: string;
  setTargetDayId: (dayId: string) => void;
  dayOptions: PlannerRecommendationDayOption[];
  destinations: PlannerRecommendationDestination[];
  discoverEntries: PlannerRecommendationEntry[];
  isLoadingDiscover: boolean;
  isRefreshing: boolean;
  addingKey: string | null;
  refresh: () => Promise<void>;
  addEntryToDestination: (
    entry: PlannerRecommendationEntry,
    destinationId: string,
  ) => Promise<ActivityDiscoveryItem | null>;
}

interface UsePlannerRecommendationsParams {
  tripId: string;
  trip: Trip | null;
  days: PlannerDay[];
  allActivities: PlannerActivity[];
  enabled: boolean;
}

function buildEntry(
  item: ActivityDiscoveryItem,
  source: PlannerRecommendationSource,
  extras?: {
    score?: number | null;
    rationale?: string | null;
    matchedPlace?: GooglePlaceCandidate | null;
  },
): PlannerRecommendationEntry {
  return {
    key: `${source}:${item.snapshot_id ?? item.provider_ref}`,
    source,
    item,
    score: extras?.score ?? null,
    rationale: extras?.rationale ?? null,
    matchedPlace: extras?.matchedPlace ?? null,
  };
}

function buildShortlistSavePayload(entry: PlannerRecommendationEntry, currency: string | null) {
  const googlePlaceId = entry.matchedPlace?.place_id?.trim() || null;
  const addressText = entry.matchedPlace?.address_text ?? entry.item.address_text;
  const lat = entry.matchedPlace?.lat ?? entry.item.lat;
  const lon = entry.matchedPlace?.lon ?? entry.item.lon;

  return {
    entity_type: entry.item.entity_type,
    provider: entry.item.provider,
    provider_ref: entry.item.provider_ref,
    title: entry.item.title,
    summary: entry.item.summary,
    rating: entry.item.rating,
    review_count: entry.item.review_count,
    price_label: entry.item.price_label,
    image_url: entry.item.image_url,
    detail_url: entry.item.detail_url,
    address_text: addressText,
    lat,
    lon,
    status_text: entry.item.status_text,
    currency,
    raw_payload: googlePlaceId ? { google_place_id: googlePlaceId } : {},
  };
}

function recommendationCategory(item: ActivityDiscoveryItem) {
  switch (item.entity_type) {
    case 'restaurant':
      return 'eat' as const;
    case 'hotel':
      return 'hotel' as const;
    case 'cruise':
      return 'travel' as const;
    default:
      return 'visit' as const;
  }
}

export function usePlannerRecommendations({
  tripId,
  trip,
  days,
  allActivities,
  enabled,
}: UsePlannerRecommendationsParams): PlannerRecommendationsController {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const preferences = readVoyagerPreferences(profile);
  const [targetDayId, setTargetDayId] = useState(days[0]?.id ?? '');
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [matchedPlacesByKey, setMatchedPlacesByKey] = useState<
    Record<string, GooglePlaceCandidate | null>
  >({});

  useEffect(() => {
    if (!days.length) {
      setTargetDayId('');
      return;
    }

    const firstDay = days[0];
    if (!days.some((day) => day.id === targetDayId) && firstDay) {
      setTargetDayId(firstDay.id);
    }
  }, [days, targetDayId]);

  const dayOptions = useMemo(
    () =>
      days.map((day) => ({
        id: day.id,
        label: `Day ${day.day_index + 1} · ${format(new Date(day.date), 'EEE, MMM d')}`,
        shortLabel: `Day ${day.day_index + 1}`,
      })),
    [days],
  );
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
  );

  const shortlistQuery = useSavedActivities(tripId);
  const shortlistItems = shortlistQuery.data?.items ?? [];
  const attachedSnapshotIds = useMemo(
    () =>
      new Set(
        allActivities
          .map((activity) => activity.event_snapshot_id)
          .filter((snapshotId): snapshotId is string => Boolean(snapshotId)),
      ),
    [allActivities],
  );
  const savedProviderRefs = useMemo(
    () =>
      new Set(
        shortlistItems
          .map((item) => item.provider_ref)
          .filter((providerRef): providerRef is string => Boolean(providerRef)),
      ),
    [shortlistItems],
  );
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
  );
  const discoverQuery = useDiscoverActivities(
    tripId,
    discoverParams,
    enabled && Boolean(trip?.destination_text),
  );
  const saveMutation = useSaveActivityToShortlist(tripId);
  const attachMutation = useAttachSavedActivityToDay(tripId);

  useEffect(() => {
    let cancelled = false;

    const items = discoverQuery.data?.items ?? [];
    if (!enabled || !items.length) {
      setMatchedPlacesByKey({});
      return;
    }

    void (async () => {
      const matches = await Promise.all(
        items.map(async (item) => {
          const key = `discover:${item.snapshot_id ?? item.provider_ref}`;
          const queries = buildRecommendationPlaceQueries({
            title: item.title,
            addressText: item.address_text,
            destinationText: trip?.destination_text ?? null,
            lat: item.lat,
            lon: item.lon,
          });

          let matchedPlace: GooglePlaceCandidate | null = null;
          for (const query of queries) {
            const params = {
              q: query,
              limit: 5,
              lat: item.lat ?? undefined,
              lon: item.lon ?? undefined,
              radius_m: item.lat != null && item.lon != null ? 2500 : undefined,
            };
            let response: Awaited<ReturnType<typeof searchGooglePlaces>>;
            try {
              response = await queryClient.fetchQuery({
                queryKey: placeKeys.googleSearch(params),
                queryFn: () => searchGooglePlaces(params),
                staleTime: 5 * 60 * 1000,
              });
            } catch {
              matchedPlace = null;
              break;
            }
            matchedPlace = selectBestRecommendationPlaceMatch(
              {
                title: item.title,
                addressText: item.address_text,
                destinationText: trip?.destination_text ?? null,
                lat: item.lat,
                lon: item.lon,
              },
              response.items,
            );
            if (matchedPlace) {
              break;
            }
          }

          return [key, matchedPlace] as const;
        }),
      );

      if (cancelled) {
        return;
      }

      setMatchedPlacesByKey(Object.fromEntries(matches));
    })();

    return () => {
      cancelled = true;
    };
  }, [discoverQuery.data?.items, enabled, queryClient, trip?.destination_text]);

  const discoverEntries = useMemo(
    () =>
      (discoverQuery.data?.items ?? [])
        .filter((item) => !savedProviderRefs.has(item.provider_ref))
        .filter((item) => !item.snapshot_id || !attachedSnapshotIds.has(item.snapshot_id))
        .map((item) =>
          buildEntry(item, 'discover', {
            matchedPlace:
              matchedPlacesByKey[`discover:${item.snapshot_id ?? item.provider_ref}`] ?? null,
          }),
        ),
    [attachedSnapshotIds, discoverQuery.data?.items, matchedPlacesByKey, savedProviderRefs],
  );

  async function persistEntry(entry: PlannerRecommendationEntry) {
    if (entry.item.snapshot_id && entry.item.place_id) {
      return entry.item;
    }

    try {
      return await saveMutation.mutateAsync({
        data: buildShortlistSavePayload(entry, trip?.budget_currency || 'USD'),
        idempotencyKey: crypto.randomUUID(),
      });
    } catch {
      return null;
    }
  }

  async function addEntryToDestination(entry: PlannerRecommendationEntry, destinationId: string) {
    const destination = destinations.find((item) => item.id === destinationId);
    if (!destination) {
      toast.error('Choose where to add this recommendation');
      return null;
    }
    if (!trip) {
      toast.error('The trip is still loading');
      return null;
    }

    setAddingKey(entry.key);
    try {
      const saved = await persistEntry(entry);
      const snapshotId = saved?.snapshot_id;
      if (!snapshotId) {
        toast.error('This recommendation could not be prepared');
        return null;
      }

      if (destination.tripDayId) {
        await attachMutation.mutateAsync({
          snapshotId,
          data: { trip_day_id: destination.tripDayId },
          tripVersion: trip.version,
          idempotencyKey: crypto.randomUUID(),
        });
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
        );
      }

      await queryClient.invalidateQueries({ queryKey: plannerKeys.detail(tripId) });
      await queryClient.invalidateQueries({ queryKey: activityDiscoveryKeys.shortlist(tripId) });
      await queryClient.invalidateQueries({ queryKey: ['activities-discover', tripId] });
      toast.success(
        destination.tripDayId
          ? `Recommendation added to ${destination.shortLabel}`
          : 'Recommendation added to inbox',
      );
      return saved;
    } catch {
      toast.error('Could not add this recommendation');
      return null;
    } finally {
      setAddingKey(null);
    }
  }

  async function refresh() {
    await Promise.all([shortlistQuery.refetch(), discoverQuery.refetch()]);
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
  };
}
