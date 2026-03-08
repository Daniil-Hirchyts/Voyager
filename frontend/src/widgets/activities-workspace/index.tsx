import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Compass,
  ExternalLink,
  Hotel,
  Loader2,
  MapPin,
  MessageSquareQuote,
  ShipWheel,
  Sparkles,
  Star,
  UtensilsCrossed,
  WandSparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { config } from '@/app/config'
import {
  activityDiscoveryKeys,
  useActivityRecommendations,
  useAttachSavedActivityToDay,
  useDiscoverActivities,
  useSavedActivities,
  useSavedActivityDetail,
  useSaveActivityToShortlist,
} from '@/entities/activity-discovery/queries'
import { useDays } from '@/entities/day/queries'
import { useJob } from '@/entities/job/queries'
import { proposalKeys, useApplyProposal, useOptimizeTrip, useProposals } from '@/entities/proposal/queries'
import { useTrip } from '@/entities/trip/queries'
import { useTripMapLayers } from '@/entities/trip-map-layer/queries'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isConflict, isValidationError } from '@/shared/api/client'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import { isJobRunning, isJobSuccessful } from '@/shared/lib/jobs'
import { cn } from '@/shared/lib/cn'
import {
  GoogleMapCanvas,
  MapPanTo,
  TripMapLayerRenderer,
  VoyagerInfoWindow,
  VoyagerMarker,
  VoyagerMarkerClusterLayer,
} from '@/shared/layouts/google-maps'
import type {
  ActivityDiscoveryDetail,
  ActivityDiscoveryItem,
  ActivityEntityType,
  Day,
  ProposalActivityResponse,
  ProposalResponse,
  TripMapLayer,
} from '@/shared/api/types'

const ENTITY_META: Record<
  ActivityEntityType,
  {
    label: string
    eyebrow: string
    icon: typeof Compass
    tint: string
  }
> = {
  attraction: {
    label: 'Attractions',
    eyebrow: 'Landmarks, museums, tours, hidden finds',
    icon: Compass,
    tint: 'from-[rgba(114,174,230,0.18)] via-[rgba(114,174,230,0.08)] to-transparent',
  },
  restaurant: {
    label: 'Restaurants',
    eyebrow: 'Dining rooms, cafes, bars, quick bites',
    icon: UtensilsCrossed,
    tint: 'from-[rgba(201,138,55,0.18)] via-[rgba(201,138,55,0.08)] to-transparent',
  },
  hotel: {
    label: 'Hotels',
    eyebrow: 'Stay references and shortlist anchors',
    icon: Hotel,
    tint: 'from-[rgba(45,124,99,0.18)] via-[rgba(45,124,99,0.08)] to-transparent',
  },
  cruise: {
    label: 'Cruises',
    eyebrow: 'Sailings and itinerary inspiration',
    icon: ShipWheel,
    tint: 'from-[rgba(90,102,118,0.18)] via-[rgba(90,102,118,0.08)] to-transparent',
  },
}

function formatDayLabel(day: Day) {
  const date = new Date(`${day.date}T00:00:00`)
  return `Day ${day.day_index + 1} · ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`
}

function formatRating(item: { rating: number | null; review_count: number | null }) {
  if (item.rating == null && item.review_count == null) {
    return 'Unrated'
  }

  const parts: string[] = []
  if (item.rating != null) {
    parts.push(item.rating.toFixed(1))
  }
  if (item.review_count != null) {
    parts.push(`${item.review_count.toLocaleString()} reviews`)
  }
  return parts.join(' · ')
}

function ProposalActivityRow({ item }: { item: ProposalActivityResponse }) {
  return (
    <div
      className="rounded-[18px] border border-[var(--color-border)]/70 bg-white/70 px-4 py-3"
      style={{ backdropFilter: 'blur(14px)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text)]">{item.title}</p>
          {item.description && (
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{item.description}</p>
          )}
        </div>
        <Badge variant="secondary" className="shrink-0">
          #{item.order_index + 1}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
        {item.start_time && <span>{String(item.start_time).slice(0, 5)}</span>}
        {item.duration_min != null && <span>{item.duration_min} min</span>}
        {item.event_snapshot_id && <span>TripAdvisor shortlist</span>}
      </div>
    </div>
  )
}

function ProposalStatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase()
  if (normalized === 'APPLIED') {
    return <Badge variant="outline">Applied</Badge>
  }
  if (normalized === 'SUCCEEDED') {
    return <Badge variant="default">Ready</Badge>
  }
  if (normalized === 'FAILED') {
    return <Badge variant="destructive">Failed</Badge>
  }
  return <Badge variant="secondary">{normalized}</Badge>
}

function ActivityPreviewCard({
  item,
  selected,
  onSelect,
  onSave,
}: {
  item: ActivityDiscoveryItem
  selected: boolean
  onSelect: () => void
  onSave: () => void
}) {
  const Icon = ENTITY_META[item.entity_type].icon

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-[26px] border p-4 text-left transition-all',
        selected
          ? 'border-[var(--color-primary)] bg-white shadow-[0_24px_60px_rgba(32,56,83,0.12)]'
          : 'border-[var(--color-border)]/70 bg-white/78 hover:border-[rgba(114,174,230,0.34)] hover:bg-white/90',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-20 bg-gradient-to-r opacity-90',
          ENTITY_META[item.entity_type].tint,
        )}
      />
      <button type="button" onClick={onSelect} className="relative flex w-full items-start gap-4 text-left">
        <div className="size-14 overflow-hidden rounded-[18px] bg-[var(--color-bg-soft)] shadow-sm">
          {item.image_url ? (
            <img src={item.image_url} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-[var(--color-primary-foreground)]">
              <Icon className="size-5" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
                {ENTITY_META[item.entity_type].label}
              </p>
              <h3 className="mt-1 font-display text-[1.65rem] leading-none text-[var(--color-text)]">
                {item.title}
              </h3>
            </div>
            <Badge variant={item.snapshot_id ? 'default' : 'secondary'}>
              {item.snapshot_id ? 'Saved' : 'Live'}
            </Badge>
          </div>

          {item.summary && (
            <p className="mt-3 line-clamp-3 text-sm leading-6 text-[var(--color-text-muted)]">{item.summary}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1">
              <Star className="size-3.5 text-[var(--color-warning)]" />
              {formatRating(item)}
            </span>
            {item.price_label && (
              <span className="rounded-full bg-white/80 px-2.5 py-1">{item.price_label}</span>
            )}
            {item.address_text && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1">
                <MapPin className="size-3.5 text-[var(--color-primary-foreground)]" />
                {item.address_text}
              </span>
            )}
          </div>
        </div>
      </button>

      <div className="relative mt-4 flex items-center gap-2">
        <Button type="button" size="sm" onClick={onSave}>
          {item.snapshot_id ? 'Saved to shortlist' : 'Save to shortlist'}
        </Button>
        {item.detail_url && (
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={item.detail_url} target="_blank" rel="noreferrer">
              Source
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}

function DiscoveryMap({
  items,
  selectedId,
  onSelect,
  layers,
}: {
  items: ActivityDiscoveryItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  layers: TripMapLayer[]
}) {
  const mapItems = items.filter((item) => item.lat != null && item.lon != null)
  const selectedItem =
    mapItems.find((item) => item.id === selectedId) ??
    mapItems.find((item) => item.snapshot_id === selectedId) ??
    mapItems[0] ??
    null
  const clusteredMarkers = mapItems
    .filter((item) => item.id !== selectedItem?.id)
    .map((item) => ({
      id: item.id,
      position: { lat: item.lat!, lng: item.lon! },
      title: item.title,
      color: '#C98A37',
    }))

  if (!config.map.apiKey) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-[26px] border border-dashed border-[var(--color-border)]/70 bg-white/50 p-6 text-center text-sm text-[var(--color-text-muted)]">
        Add `VITE_GOOGLE_MAPS_API_KEY` to enable the map view.
      </div>
    )
  }

  if (!selectedItem || selectedItem.lat == null || selectedItem.lon == null) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-[26px] border border-dashed border-[var(--color-border)]/70 bg-white/50 p-6 text-center text-sm text-[var(--color-text-muted)]">
        This tab has no mappable results yet. Cruises stay list-first by design.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[26px] border border-[var(--color-border)]/70 bg-white shadow-[0_18px_48px_rgba(24,33,43,0.08)]">
      <GoogleMapCanvas
        key={`${selectedItem.id}-${selectedItem.lat}-${selectedItem.lon}`}
        defaultCenter={{ lng: selectedItem.lon, lat: selectedItem.lat }}
        defaultZoom={12.5}
        style={{ width: '100%', height: 260 }}
        disableDefaultUI={false}
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
      >
        <TripMapLayerRenderer layers={layers} />
        <MapPanTo point={{ lat: selectedItem.lat!, lng: selectedItem.lon! }} zoom={12.5} />
        <VoyagerMarkerClusterLayer
          items={clusteredMarkers}
          onMarkerClick={(item) => onSelect(item.id)}
        />
        <VoyagerMarker
          position={{ lng: selectedItem.lon!, lat: selectedItem.lat! }}
          title={selectedItem.title}
          label={selectedItem.title.length <= 18 ? selectedItem.title : undefined}
          selected
          onClick={() => onSelect(selectedItem.id)}
          zIndex={3}
        />
        <VoyagerInfoWindow
          position={{ lng: selectedItem.lon!, lat: selectedItem.lat! }}
          onCloseClick={() => onSelect(selectedItem.id)}
        >
          <div className="max-w-[220px]">
            <p className="text-sm font-semibold text-[var(--color-text)]">{selectedItem.title}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {selectedItem.address_text || ENTITY_META[selectedItem.entity_type].label}
            </p>
          </div>
        </VoyagerInfoWindow>
      </GoogleMapCanvas>
    </div>
  )
}

interface Props {
  tripId: string
}

export default function ActivitiesWorkspace({ tripId }: Props) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: trip } = useTrip(tripId)
  const { data: daysData } = useDays(tripId)
  const { data: tripLayersData } = useTripMapLayers(tripId)
  const days = daysData?.items ?? []

  const [entityType, setEntityType] = useState<ActivityEntityType>(
    (searchParams.get('type') as ActivityEntityType) || 'attraction',
  )
  const [searchText, setSearchText] = useState(searchParams.get('q') ?? '')
  const [selectedDayId, setSelectedDayId] = useState(searchParams.get('dayId') ?? '')
  const [minRating, setMinRating] = useState(searchParams.get('minRating') ?? 'all')
  const [goodFor, setGoodFor] = useState('')
  const [establishmentType, setEstablishmentType] = useState('restaurants')
  const [mealType, setMealType] = useState('')
  const [cruiseLength, setCruiseLength] = useState('')
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null)
  const [selectedShortlistId, setSelectedShortlistId] = useState<string | null>(null)
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)
  const [optimizeJobId, setOptimizeJobId] = useState<string | null>(null)

  const debouncedQuery = useDebouncedValue(searchText, 350)
  const aiMode = searchParams.get('ai') === 'proposal' ? 'proposal' : 'quick-add'

  const discoverParams = useMemo(
    () => ({
      entity_type: entityType,
      query: debouncedQuery || undefined,
      page: 1,
      limit: 12,
      min_rating: minRating !== 'all' ? Number(minRating) : undefined,
      good_for: entityType === 'attraction' ? goodFor || undefined : undefined,
      establishment_type:
        entityType === 'restaurant' ? establishmentType || undefined : undefined,
      meal_type: entityType === 'restaurant' ? mealType || undefined : undefined,
      cruise_length: entityType === 'cruise' ? cruiseLength || undefined : undefined,
    }),
    [cruiseLength, debouncedQuery, entityType, establishmentType, goodFor, mealType, minRating],
  )

  const discoverQuery = useDiscoverActivities(tripId, discoverParams, !!trip)
  const shortlistQuery = useSavedActivities(tripId)

  const results = discoverQuery.data?.items ?? []
  const shortlist = shortlistQuery.data?.items ?? []
  const tripLayers = tripLayersData?.items ?? []
  const selectedResult = results.find((item) => item.id === selectedResultId) ?? null
  const selectedShortlistItem =
    shortlist.find((item) => (item.snapshot_id ?? item.id) === selectedShortlistId) ?? null
  const activeItem = selectedShortlistItem ?? selectedResult ?? shortlist[0] ?? results[0] ?? null
  const activeSnapshotId = selectedShortlistItem?.snapshot_id ?? activeItem?.snapshot_id ?? null

  const detailQuery = useSavedActivityDetail(activeSnapshotId)
  const detail =
    detailQuery.data ??
    (activeItem
      ? ({
          ...activeItem,
          photos: [],
          reviews: [],
          hours: [],
          booking_links: [],
          provider_payload: {},
        } satisfies ActivityDiscoveryDetail)
      : null)

  const recommendationsMutation = useActivityRecommendations(tripId)
  const optimizeTripMutation = useOptimizeTrip(tripId)
  const saveMutation = useSaveActivityToShortlist(tripId)
  const attachMutation = useAttachSavedActivityToDay(tripId)
  const applyProposalMutation = useApplyProposal(tripId)
  const proposalsQuery = useProposals(tripId)
  const proposals = proposalsQuery.data?.items ?? []
  const selectedProposal =
    proposals.find((proposal) => proposal.id === selectedProposalId) ?? proposals[0] ?? null
  const optimizeJobQuery = useJob(optimizeJobId)

  useEffect(() => {
    if (!selectedResultId && results[0]) {
      setSelectedResultId(results[0].id)
    }
  }, [results, selectedResultId])

  useEffect(() => {
    if (selectedResultId && !results.some((item) => item.id === selectedResultId)) {
      setSelectedResultId(results[0]?.id ?? null)
    }
  }, [results, selectedResultId])

  useEffect(() => {
    if (!selectedShortlistId && shortlist[0]) {
      setSelectedShortlistId(shortlist[0].snapshot_id ?? shortlist[0].id)
    }
  }, [selectedShortlistId, shortlist])

  useEffect(() => {
    if (selectedShortlistId && !shortlist.some((item) => (item.snapshot_id ?? item.id) === selectedShortlistId)) {
      setSelectedShortlistId(shortlist[0]?.snapshot_id ?? shortlist[0]?.id ?? null)
    }
  }, [selectedShortlistId, shortlist])

  useEffect(() => {
    if (!selectedProposalId && proposals[0]) {
      setSelectedProposalId(proposals[0].id)
    }
  }, [proposals, selectedProposalId])

  useEffect(() => {
    if (selectedProposalId && !proposals.some((proposal) => proposal.id === selectedProposalId)) {
      setSelectedProposalId(proposals[0]?.id ?? null)
    }
  }, [proposals, selectedProposalId])

  useEffect(() => {
    if (!isJobSuccessful(optimizeJobQuery.data?.status) || !optimizeJobId) {
      return
    }
    queryClient.invalidateQueries({ queryKey: proposalKeys.list(tripId) })
    setOptimizeJobId(null)
  }, [optimizeJobId, optimizeJobQuery.data?.status, queryClient, tripId])

  const activeDayIds = selectedDayId ? [selectedDayId] : days.map((day) => day.id)
  const attachableShortlistIds = shortlist
    .filter((item) => item.snapshot_id && item.is_attachable)
    .map((item) => item.snapshot_id!) as string[]
  const selectedDay = days.find((day) => day.id === selectedDayId) ?? null
  const quickAddItems = recommendationsMutation.data?.items ?? []
  const selectedProposalSummary = selectedProposal?.summary as
    | { activities_changed?: number }
    | null
    | undefined

  const handleSave = async (item: ActivityDiscoveryItem) => {
    if (item.snapshot_id) {
      setSelectedShortlistId(item.snapshot_id)
      toast.info('Already saved in shortlist')
      return
    }

    try {
      const saved = await saveMutation.mutateAsync({
        data: {
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
          tags: item.tags,
          status_text: item.status_text,
          currency: trip?.budget_currency ?? 'USD',
          raw_payload: {
            source: 'activities-workspace',
            discovery_item_id: item.id,
            title: item.title,
          },
        },
        idempotencyKey: `activities-save-${item.provider_ref}-${Date.now()}`,
      })
      setSelectedShortlistId(saved.snapshot_id ?? saved.id)
      queryClient.invalidateQueries({ queryKey: activityDiscoveryKeys.shortlist(tripId) })
      toast.success('Saved to shortlist', { description: `${item.title} is ready for AI review.` })
    } catch (error) {
      toast.error('Failed to save activity', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleAttach = async (snapshotId: string, tripDayId: string) => {
    if (!trip) return
    try {
      await attachMutation.mutateAsync({
        snapshotId,
        data: { trip_day_id: tripDayId },
        tripVersion: trip.version,
        idempotencyKey: `activities-attach-${snapshotId}-${tripDayId}-${Date.now()}`,
      })
      toast.success('Added to planner')
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Trip version changed', {
          description: 'Reload the trip and retry the attach action.',
        })
        return
      }
      if (isValidationError(error)) {
        toast.error('Attach unavailable', {
          description: error.message,
        })
        return
      }
      toast.error('Failed to attach activity')
    }
  }

  const handleGenerateRecommendations = async () => {
    if (!attachableShortlistIds.length) {
      toast.error('Save at least one attraction or restaurant first')
      return
    }
    try {
      await recommendationsMutation.mutateAsync({
        day_ids: activeDayIds.length ? activeDayIds : undefined,
        snapshot_ids:
          selectedShortlistItem?.snapshot_id && selectedShortlistItem.is_attachable
            ? [selectedShortlistItem.snapshot_id]
            : attachableShortlistIds,
        limit: 6,
        use_llm_rationale: true,
      })
    } catch (error) {
      toast.error('Could not generate recommendations', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleGenerateProposal = async () => {
    if (!attachableShortlistIds.length || !trip) {
      toast.error('Save shortlist items before generating a proposal')
      return
    }
    try {
      const accepted = await optimizeTripMutation.mutateAsync({
        data: {
          day_ids: activeDayIds.length ? activeDayIds : undefined,
          activity_snapshot_ids: attachableShortlistIds,
          objective: 'balanced_flow',
          include_event_candidates: true,
          max_event_candidates_per_day: 2,
          constraints: {},
        },
        idempotencyKey: `activities-proposal-${trip.id}-${Date.now()}`,
      })
      setOptimizeJobId(accepted.job_id)
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('ai', 'proposal')
        return next
      })
      toast.success('Proposal requested', {
        description: 'Voyager is building a reviewable shortlist proposal.',
      })
    } catch (error) {
      toast.error('Could not start proposal generation', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleApplyProposal = async (proposal: ProposalResponse) => {
    if (!trip) return
    try {
      await applyProposalMutation.mutateAsync({
        proposalId: proposal.id,
        tripVersion: trip.version,
        idempotencyKey: `activities-apply-proposal-${proposal.id}-${Date.now()}`,
      })
      toast.success('Proposal applied')
    } catch (error) {
      if (isConflict(error)) {
        toast.error('Trip version changed', {
          description: 'Reload the trip before applying this proposal again.',
        })
        return
      }
      toast.error('Failed to apply proposal', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 p-4 lg:p-6">
      <section className="relative overflow-hidden rounded-[32px] border border-[var(--color-border)]/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(255,250,242,0.82))] p-6 shadow-[0_28px_80px_rgba(24,33,43,0.08)] lg:p-8">
        <div className="absolute inset-y-0 right-0 hidden w-[38%] bg-[radial-gradient(circle_at_top_right,rgba(33,79,82,0.16),transparent_62%),radial-gradient(circle_at_35%_65%,rgba(195,107,45,0.16),transparent_42%)] lg:block" />

        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
              Activities Workspace
            </p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-3xl">
                <h1 className="font-display text-[2.9rem] leading-[0.92] text-[var(--color-text)] md:text-[3.7rem]">
                  Search, pin, shortlist, and stage your trip in one atlas.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-text-muted)] md:text-base">
                  Replace live event hunting with a destination-native activity board. Search
                  TripAdvisor data, keep a saved shortlist, inspect everything on the map, and
                  turn that shortlist into quick adds or reviewable AI proposals.
                </p>
              </div>

              <div className="grid min-w-[240px] gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-[22px] border border-white/70 bg-white/70 px-4 py-3 shadow-sm">
                  <p className="text-[0.64rem] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                    Destination
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                    {trip?.destination_text ?? 'Trip destination'}
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/70 bg-white/70 px-4 py-3 shadow-sm">
                  <p className="text-[0.64rem] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                    Saved shortlist
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">{shortlist.length}</p>
                </div>
                <div className="rounded-[22px] border border-white/70 bg-white/70 px-4 py-3 shadow-sm">
                  <p className="text-[0.64rem] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                    AI scope
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                    {selectedDay ? formatDayLabel(selectedDay) : 'Entire trip'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative rounded-[28px] border border-[var(--color-border)]/70 bg-[var(--color-cta)] px-5 py-5 text-white shadow-[0_24px_68px_rgba(26,22,21,0.18)]">
            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-white/65">
              Search Composer
            </p>
            <div className="mt-4 space-y-4">
              <Input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={trip?.destination_text || 'Search activities, cuisine, neighborhoods'}
                className="h-12 rounded-[16px] border-white/15 bg-white/10 text-white placeholder:text-white/55"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  value={selectedDayId || 'all'}
                  onValueChange={(value) => setSelectedDayId(value === 'all' ? '' : value)}
                >
                  <SelectTrigger className="h-11 rounded-[14px] border-white/15 bg-white/10 text-white">
                    <SelectValue placeholder="Scope days" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Entire trip</SelectItem>
                    {days.map((day) => (
                      <SelectItem key={day.id} value={day.id}>
                        {formatDayLabel(day)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={minRating} onValueChange={setMinRating}>
                  <SelectTrigger className="h-11 rounded-[14px] border-white/15 bg-white/10 text-white">
                    <SelectValue placeholder="Minimum rating" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any rating</SelectItem>
                    <SelectItem value="5">5.0+</SelectItem>
                    <SelectItem value="4">4.0+</SelectItem>
                    <SelectItem value="3">3.0+</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {entityType === 'attraction' && (
                <Select value={goodFor || 'all'} onValueChange={(value) => setGoodFor(value === 'all' ? '' : value)}>
                  <SelectTrigger className="h-11 rounded-[14px] border-white/15 bg-white/10 text-white">
                    <SelectValue placeholder="Good for" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any audience</SelectItem>
                    <SelectItem value="good_for_couples">Couples</SelectItem>
                    <SelectItem value="good_for_kids">Kids</SelectItem>
                    <SelectItem value="free_entry">Free entry</SelectItem>
                    <SelectItem value="hidden_gems">Hidden gems</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {entityType === 'restaurant' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select value={establishmentType} onValueChange={setEstablishmentType}>
                    <SelectTrigger className="h-11 rounded-[14px] border-white/15 bg-white/10 text-white">
                      <SelectValue placeholder="Establishment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="restaurants">Restaurants</SelectItem>
                      <SelectItem value="bars_pubs">Bars & pubs</SelectItem>
                      <SelectItem value="coffee_tea">Coffee & tea</SelectItem>
                      <SelectItem value="dessert">Dessert</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={mealType || 'all'} onValueChange={(value) => setMealType(value === 'all' ? '' : value)}>
                    <SelectTrigger className="h-11 rounded-[14px] border-white/15 bg-white/10 text-white">
                      <SelectValue placeholder="Meal type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any meal</SelectItem>
                      <SelectItem value="breakfast">Breakfast</SelectItem>
                      <SelectItem value="lunch">Lunch</SelectItem>
                      <SelectItem value="dinner">Dinner</SelectItem>
                      <SelectItem value="brunch">Brunch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {entityType === 'cruise' && (
                <Select value={cruiseLength || 'all'} onValueChange={(value) => setCruiseLength(value === 'all' ? '' : value)}>
                  <SelectTrigger className="h-11 rounded-[14px] border-white/15 bg-white/10 text-white">
                    <SelectValue placeholder="Cruise length" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any length</SelectItem>
                    <SelectItem value="3-5">3-5 nights</SelectItem>
                    <SelectItem value="6-9">6-9 nights</SelectItem>
                    <SelectItem value="10-14">10-14 nights</SelectItem>
                    <SelectItem value="15">15+ nights</SelectItem>
                  </SelectContent>
                </Select>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => discoverQuery.refetch()}>
                  Refresh search
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleGenerateRecommendations}>
                  <Sparkles className="size-4" />
                  Quick add
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleGenerateProposal}>
                  <WandSparkles className="size-4" />
                  Proposal
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Tabs
        value={entityType}
        onValueChange={(value) => setEntityType(value as ActivityEntityType)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="rounded-[18px] bg-white/60 p-1.5 shadow-sm">
            {Object.entries(ENTITY_META).map(([value, meta]) => (
              <TabsTrigger
                key={value}
                value={value}
                className="rounded-[14px] px-4 py-2.5 data-[state=active]:bg-[var(--color-cta)] data-[state=active]:text-white"
              >
                {meta.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="text-sm text-[var(--color-text-muted)]">
            {discoverQuery.isLoading ? 'Searching…' : `${discoverQuery.data?.total ?? 0} results in view`}
          </div>
        </div>

        <div className="mt-4 grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.95fr)_minmax(320px,0.9fr)]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-[var(--color-border)]/70 bg-white/75 shadow-[0_20px_60px_rgba(24,33,43,0.06)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)]/60 px-5 py-4">
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
                  Discovery Stream
                </p>
                <h2 className="mt-1 font-display text-[2rem] leading-none text-[var(--color-text)]">
                  {ENTITY_META[entityType].label}
                </h2>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{ENTITY_META[entityType].eyebrow}</p>
              </div>
              {discoverQuery.isFetching && <Loader2 className="size-5 animate-spin text-[var(--color-primary-foreground)]" />}
            </div>

            <ScrollArea className="min-h-0 flex-1 px-4 py-4">
              <div className="space-y-3">
                {discoverQuery.error && (
                  <Alert variant="warning">
                    <AlertDescription>
                      {discoverQuery.error instanceof Error
                        ? discoverQuery.error.message
                        : 'Could not load TripAdvisor activity search.'}
                    </AlertDescription>
                  </Alert>
                )}

                {!discoverQuery.isLoading && results.length === 0 && (
                  <div className="rounded-[24px] border border-dashed border-[var(--color-border)]/80 bg-white/64 p-6 text-center">
                    <p className="font-display text-[2rem] text-[var(--color-text)]">No activities surfaced yet.</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                      Adjust the search text or filters. The discovery request falls back to your trip
                      destination when the query is empty.
                    </p>
                  </div>
                )}

                {results.map((item) => (
                  <ActivityPreviewCard
                    key={item.id}
                    item={item}
                    selected={
                      selectedResultId === item.id ||
                      (!!item.snapshot_id && selectedShortlistId === item.snapshot_id)
                    }
                    onSelect={() => {
                      setSelectedResultId(item.id)
                      if (item.snapshot_id) {
                        setSelectedShortlistId(item.snapshot_id)
                      }
                    }}
                    onSave={() => void handleSave(item)}
                  />
                ))}
              </div>
            </ScrollArea>
          </section>

          <section className="flex min-h-0 flex-col gap-4">
            <div className="rounded-[28px] border border-[var(--color-border)]/70 bg-white/78 p-5 shadow-[0_20px_60px_rgba(24,33,43,0.06)]">
              {activeItem ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
                        Detail Panel
                      </p>
                      <h2 className="mt-2 font-display text-[2.4rem] leading-[0.94] text-[var(--color-text)]">
                        {detail?.title ?? activeItem.title}
                      </h2>
                    </div>
                    <Badge variant={activeItem.is_attachable ? 'default' : 'secondary'}>
                      {activeItem.is_attachable ? 'Planner attachable' : 'Reference only'}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">{ENTITY_META[activeItem.entity_type].label}</Badge>
                    {detail?.status_text && <Badge variant="outline">{detail.status_text}</Badge>}
                    <Badge variant="outline">{formatRating(detail ?? activeItem)}</Badge>
                  </div>

                  {(detail?.summary ?? activeItem.summary) && (
                    <p className="mt-4 text-sm leading-7 text-[var(--color-text-muted)]">
                      {detail?.summary ?? activeItem.summary}
                    </p>
                  )}

                  <div className="mt-4 space-y-3 text-sm text-[var(--color-text-muted)]">
                    {(detail?.address_text ?? activeItem.address_text) && (
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--color-primary-foreground)]" />
                        <span>{detail?.address_text ?? activeItem.address_text}</span>
                      </div>
                    )}
                    {detail?.price_label && (
                      <div className="flex items-start gap-2">
                        <Star className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" />
                        <span>{detail.price_label}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {detail?.booking_links.slice(0, 2).map((link) => (
                      <Button key={link.url} variant="outline" size="sm" asChild>
                        <a href={link.url} target="_blank" rel="noreferrer">
                          {link.label}
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                    ))}
                    {activeItem.detail_url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={activeItem.detail_url} target="_blank" rel="noreferrer">
                          TripAdvisor
                          <ArrowRight className="size-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>

                  <Separator className="my-5" />

                  {detailQuery.isLoading && activeSnapshotId ? (
                    <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                      <Loader2 className="size-4 animate-spin" />
                      Loading saved detail…
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
                          Hours & context
                        </p>
                        {detail?.hours.length ? (
                          <div className="mt-2 space-y-1.5 text-sm text-[var(--color-text-muted)]">
                            {detail.hours.slice(0, 3).map((hours) => (
                              <div key={hours.day} className="flex justify-between gap-3">
                                <span>{hours.day}</span>
                                <span>
                                  {hours.times.map((entry) => [entry.open, entry.close].filter(Boolean).join('-')).join(', ') || 'Closed'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                            Save this shortlist item to unlock richer detail, reviews, and hours.
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
                          Reviews
                        </p>
                        {detail?.reviews.length ? (
                          <div className="mt-2 space-y-3">
                            {detail.reviews.slice(0, 2).map((review) => (
                              <div
                                key={review.review_id}
                                className="rounded-[20px] border border-[var(--color-border)]/70 bg-[rgba(255,250,242,0.75)] p-4"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className="font-medium text-[var(--color-text)]">
                                    {review.title || review.reviewer_name || 'TripAdvisor review'}
                                  </p>
                                  {review.rating != null && (
                                    <Badge variant="secondary">{review.rating.toFixed(1)}</Badge>
                                  )}
                                </div>
                                {review.text && (
                                  <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{review.text}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                            No cached reviews yet. Save the place and Voyager will refresh detail when
                            provider access is available.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex min-h-[280px] items-center justify-center text-center">
                  <div>
                    <p className="font-display text-[2rem] text-[var(--color-text)]">Select an activity</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                      Pick a live result or shortlist item to inspect it here.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <DiscoveryMap
              items={results}
              selectedId={selectedResultId ?? selectedShortlistId}
              onSelect={(id) => setSelectedResultId(id)}
              layers={tripLayers}
            />
          </section>

          <aside className="flex min-h-0 flex-col gap-4">
            <section className="flex min-h-[260px] flex-col overflow-hidden rounded-[28px] border border-[var(--color-border)]/70 bg-white/78 shadow-[0_20px_60px_rgba(24,33,43,0.06)]">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)]/60 px-5 py-4">
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
                    Saved Rail
                  </p>
                  <h2 className="mt-1 font-display text-[2rem] leading-none text-[var(--color-text)]">
                    Shortlist
                  </h2>
                </div>
                <Badge variant="secondary">{shortlist.length}</Badge>
              </div>
              <ScrollArea className="min-h-0 flex-1 px-4 py-4">
                <div className="space-y-3">
                  {shortlist.length === 0 && (
                    <p className="rounded-[20px] border border-dashed border-[var(--color-border)]/70 bg-white/64 p-4 text-sm leading-6 text-[var(--color-text-muted)]">
                      Save discovery results here. Attractions and restaurants can be sent to the
                      planner or to AI proposal generation. Hotels and cruises stay reference-only.
                    </p>
                  )}
                  {shortlist.map((item) => (
                    <div
                      key={item.snapshot_id ?? item.id}
                      className={cn(
                        'rounded-[20px] border p-4 transition-colors',
                        selectedShortlistId === (item.snapshot_id ?? item.id)
                          ? 'border-[rgba(114,174,230,0.5)] bg-[rgba(114,174,230,0.1)]'
                          : 'border-[var(--color-border)]/70 bg-[rgba(255,250,242,0.72)]',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedShortlistId(item.snapshot_id ?? item.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">
                              {ENTITY_META[item.entity_type].label}
                            </p>
                            <p className="mt-1 font-medium text-[var(--color-text)]">{item.title}</p>
                          </div>
                          {item.trip_day_id && <Badge variant="default">Attached</Badge>}
                        </div>
                        {item.address_text && (
                          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{item.address_text}</p>
                        )}
                      </button>

                      {item.is_attachable && item.snapshot_id && (
                        <div className="mt-3 flex gap-2">
                          <Select
                            value={
                              selectedDayId ||
                              item.trip_day_id ||
                              'all'
                            }
                            onValueChange={(value) => {
                              if (value !== 'all') {
                                void handleAttach(item.snapshot_id!, value)
                              }
                            }}
                          >
                            <SelectTrigger className="h-9 rounded-[12px]">
                              <SelectValue placeholder="Attach to day" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Attach to…</SelectItem>
                              {days.map((day) => (
                                <SelectItem key={day.id} value={day.id}>
                                  {formatDayLabel(day)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </section>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[var(--color-border)]/70 bg-[var(--color-cta)] text-white shadow-[0_24px_68px_rgba(26,22,21,0.18)]">
              <div className="border-b border-white/10 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[0.68rem] uppercase tracking-[0.24em] text-white/60">
                      AI Panel
                    </p>
                    <h2 className="mt-1 font-display text-[2rem] leading-none">Guide the shortlist</h2>
                  </div>
                  <div className="inline-flex rounded-full border border-white/10 bg-white/10 p-1">
                    <button
                      type="button"
                      onClick={() =>
                        setSearchParams((current) => {
                          const next = new URLSearchParams(current)
                          next.set('ai', 'quick-add')
                          return next
                        })
                      }
                      className={cn(
                        'rounded-full px-3 py-1.5 text-sm transition-colors',
                        aiMode === 'quick-add' ? 'bg-white text-[var(--color-text)]' : 'text-white/75',
                      )}
                    >
                      Quick add
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSearchParams((current) => {
                          const next = new URLSearchParams(current)
                          next.set('ai', 'proposal')
                          return next
                        })
                      }
                      className={cn(
                        'rounded-full px-3 py-1.5 text-sm transition-colors',
                        aiMode === 'proposal' ? 'bg-white text-[var(--color-text)]' : 'text-white/75',
                      )}
                    >
                      Proposal
                    </button>
                  </div>
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1 px-5 py-5">
                {aiMode === 'quick-add' ? (
                  <div className="space-y-4">
                    <p className="text-sm leading-7 text-white/74">
                      Rank the saved shortlist against the current trip days and get target-day suggestions
                      with rationale. Attractions and restaurants only.
                    </p>
                    <Button
                      type="button"
                      onClick={handleGenerateRecommendations}
                      disabled={recommendationsMutation.isPending}
                      className="w-full bg-white text-[var(--color-text)] hover:bg-[var(--color-bg-soft)]"
                    >
                      {recommendationsMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      Generate quick-add suggestions
                    </Button>

                    {quickAddItems.length === 0 && (
                      <div className="rounded-[22px] border border-white/10 bg-white/8 p-4">
                        <p className="text-sm leading-6 text-white/70">
                          No quick-add suggestions yet. Save some shortlist items and run the AI panel.
                        </p>
                      </div>
                    )}

                    {quickAddItems.map((entry) => {
                      const suggestedDay = days.find((day) => day.id === entry.trip_day_id)
                      return (
                        <div
                          key={`${entry.snapshot_id}-${entry.trip_day_id}`}
                          className="rounded-[24px] border border-white/10 bg-white/8 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-white/55">
                                Suggested match
                              </p>
                              <h3 className="mt-1 text-lg font-semibold">{entry.item.title}</h3>
                            </div>
                            <Badge className="bg-white/15 text-white">{entry.score.toFixed(2)}</Badge>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-white/74">{entry.rationale}</p>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="text-xs uppercase tracking-[0.2em] text-white/55">
                              {suggestedDay ? formatDayLabel(suggestedDay) : 'Suggested day'}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-white/18 bg-white/5 text-white hover:bg-white/12"
                              onClick={() => void handleAttach(entry.snapshot_id, entry.trip_day_id)}
                            >
                              Add to planner
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm leading-7 text-white/74">
                      Build a reviewable proposal from the saved shortlist, then inspect the generated
                      day-level changes before applying them to the planner.
                    </p>
                    <Button
                      type="button"
                      onClick={handleGenerateProposal}
                      disabled={optimizeTripMutation.isPending || isJobRunning(optimizeJobQuery.data?.status)}
                      className="w-full bg-white text-[var(--color-text)] hover:bg-[var(--color-bg-soft)]"
                    >
                      {optimizeTripMutation.isPending || isJobRunning(optimizeJobQuery.data?.status) ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <WandSparkles className="size-4" />
                      )}
                      Generate reviewable proposal
                    </Button>

                    {optimizeJobQuery.data && (
                      <Alert className="border-white/10 bg-white/8 text-white">
                        <AlertDescription>
                          Proposal job status: {optimizeJobQuery.data.status}
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="space-y-3">
                      {proposals.map((proposal) => (
                        <button
                          key={proposal.id}
                          type="button"
                          onClick={() => setSelectedProposalId(proposal.id)}
                          className={cn(
                            'w-full rounded-[22px] border p-4 text-left transition-colors',
                            selectedProposal?.id === proposal.id
                              ? 'border-white/30 bg-white/12'
                              : 'border-white/10 bg-white/6',
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-white/55">
                                Proposal
                              </p>
                              <p className="mt-1 text-sm font-semibold">{proposal.objective}</p>
                            </div>
                            <ProposalStatusBadge status={proposal.status} />
                          </div>
                          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-white/50">
                            Based on v{proposal.based_on_trip_version}
                          </p>
                        </button>
                      ))}
                    </div>

                    {selectedProposal ? (
                      <div className="rounded-[24px] border border-white/10 bg-white/8 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-white/55">
                              Reviewable proposal
                            </p>
                            <h3 className="mt-1 text-lg font-semibold">
                              {(selectedProposalSummary?.activities_changed ?? selectedProposal.items.length)} activity moves
                            </h3>
                          </div>
                          <ProposalStatusBadge status={selectedProposal.status} />
                        </div>
                        <div className="mt-4 space-y-3">
                          {selectedProposal.items.slice(0, 4).map((item) => (
                            <ProposalActivityRow key={item.id} item={item} />
                          ))}
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div className="inline-flex items-center gap-2 text-sm text-white/70">
                            <MessageSquareQuote className="size-4" />
                            Review before apply
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-white/18 bg-white/5 text-white hover:bg-white/12"
                            onClick={() => void handleApplyProposal(selectedProposal)}
                            disabled={
                              applyProposalMutation.isPending ||
                              selectedProposal.status.toUpperCase() !== 'SUCCEEDED'
                            }
                          >
                            Apply proposal
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[22px] border border-white/10 bg-white/8 p-4 text-sm leading-6 text-white/70">
                        Generate a proposal to inspect AI-assisted day reshaping here.
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </section>
          </aside>
        </div>
      </Tabs>
    </div>
  )
}
