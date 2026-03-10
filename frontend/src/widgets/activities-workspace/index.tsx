import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { WorkspacePage } from '@/shared/layouts/workspace-shell'
import type {
  ActivityDiscoveryDetail,
  ActivityDiscoveryItem,
  ActivityEntityType,
  Day,
  ProposalActivityResponse,
  ProposalResponse,
  TripMapLayer,
} from '@/shared/api/types'
import { useAppShellHeaderActions, useAppShellHeaderMeta } from '@/widgets/app-shell/header-context'

const ENTITY_META: Record<
  ActivityEntityType,
  {
    label: string
    eyebrow: string
    icon: typeof Compass
  }
> = {
  attraction: {
    label: 'Attractions',
    eyebrow: 'Landmarks, museums, tours, and hidden finds',
    icon: Compass,
  },
  restaurant: {
    label: 'Restaurants',
    eyebrow: 'Dining rooms, cafes, bars, and quick bites',
    icon: UtensilsCrossed,
  },
  hotel: {
    label: 'Hotels',
    eyebrow: 'Stay references for the shortlist',
    icon: Hotel,
  },
  cruise: {
    label: 'Cruises',
    eyebrow: 'Sailings and itinerary references',
    icon: ShipWheel,
  },
}

const panelClassName = 'rounded-[14px] border border-black/8 bg-white shadow-none'
const panelSoftClassName = 'rounded-[14px] border border-black/8 bg-[var(--color-secondary-surface)] shadow-none'
const panelHeaderClassName = 'flex items-start justify-between gap-3 border-b border-black/8 px-4 py-3'
const sectionTitleClassName = 'text-[0.95rem] font-medium text-[var(--color-text)]'
const sectionNoteClassName = 'text-[0.78rem] leading-5 text-[var(--color-text-muted)]'
const emptyStateClassName =
  'rounded-[12px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] px-4 py-5 text-sm leading-6 text-[var(--color-text-muted)]'
const inlinePillClassName =
  'inline-flex items-center gap-1 rounded-full border border-black/8 bg-[var(--color-secondary-surface)] px-2.5 py-1 text-[0.72rem] text-[var(--color-text-muted)]'
const controlClassName =
  'h-9 rounded-[10px] border-black/8 bg-white px-3.5 text-sm shadow-none placeholder:text-[var(--color-text-muted)]/75 focus:border-[rgba(0,0,0,0.12)] focus:ring-4 focus:ring-[rgba(26,22,21,0.06)]'
const compactButtonClassName = 'h-8 rounded-[8px] px-3 text-[0.82rem] font-medium shadow-none hover:shadow-none'
const EMPTY_DAYS: Day[] = []
const EMPTY_DISCOVERY_ITEMS: ActivityDiscoveryItem[] = []
const EMPTY_PROPOSALS: ProposalResponse[] = []
const EMPTY_TRIP_LAYERS: TripMapLayer[] = []

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

function WorkspaceMetaRow({ items, className }: { items: string[]; className?: string }) {
  const filtered = items.filter(Boolean)

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-[var(--color-text-muted)]', className)}>
      {filtered.map((item, index) => (
        <span key={`${item}-${index}`} className="inline-flex min-w-0 items-center gap-2">
          {index > 0 ? <span className="text-black/20">•</span> : null}
          <span className={cn('truncate', index === 0 && 'font-medium text-[var(--color-text)]')}>{item}</span>
        </span>
      ))}
    </div>
  )
}

function ActivityActionCluster({
  onRefresh,
  onQuickAdd,
  onProposal,
  isRefreshing,
  isQuickAddPending,
  isProposalPending,
  className,
  dataTestId,
}: {
  onRefresh: () => void
  onQuickAdd: () => void
  onProposal: () => void
  isRefreshing: boolean
  isQuickAddPending: boolean
  isProposalPending: boolean
  className?: string
  dataTestId?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid={dataTestId}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={compactButtonClassName}
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        {isRefreshing ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Refresh search
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={compactButtonClassName}
        onClick={onQuickAdd}
        disabled={isQuickAddPending}
      >
        {isQuickAddPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        Quick add
      </Button>
      <Button
        type="button"
        size="sm"
        className={compactButtonClassName}
        onClick={onProposal}
        disabled={isProposalPending}
      >
        {isProposalPending ? <Loader2 className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}
        Generate proposal
      </Button>
    </div>
  )
}

function ProposalActivityRow({ item }: { item: ProposalActivityResponse }) {
  return (
    <div className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)]">{item.title}</p>
          {item.description ? (
            <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">{item.description}</p>
          ) : null}
        </div>
        <Badge variant="neutral" className="shrink-0 normal-case tracking-normal">
          #{item.order_index + 1}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[0.72rem] text-[var(--color-text-muted)]">
        {item.start_time ? <span>{String(item.start_time).slice(0, 5)}</span> : null}
        {item.duration_min != null ? <span>{item.duration_min} min</span> : null}
        {item.event_snapshot_id ? <span>Shortlist item</span> : null}
      </div>
    </div>
  )
}

function ProposalStatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase()
  if (normalized === 'APPLIED') {
    return <Badge variant="success">Applied</Badge>
  }
  if (normalized === 'SUCCEEDED') {
    return <Badge variant="success">Ready</Badge>
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
        'rounded-[12px] border p-3 transition-colors',
        selected
          ? 'border-[rgba(114,174,230,0.44)] bg-white'
          : 'border-black/8 bg-white hover:border-black/12 hover:bg-[var(--color-secondary-surface)]',
      )}
    >
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-3 text-left">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-black/8 bg-[var(--color-secondary-surface)]">
          {item.image_url ? (
            <img src={item.image_url} alt="" className="size-full object-cover" />
          ) : (
            <Icon className="size-4 text-[var(--color-text-muted)]" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">
                {ENTITY_META[item.entity_type].label}
              </p>
              <h3 className="truncate text-[0.98rem] font-medium text-[var(--color-text)]">{item.title}</h3>
            </div>
            <Badge variant={item.snapshot_id ? 'success' : 'neutral'}>
              {item.snapshot_id ? 'Saved' : 'Live'}
            </Badge>
          </div>

          {item.summary ? (
            <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-[var(--color-text-muted)]">{item.summary}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap gap-2">
            <span className={inlinePillClassName}>
              <Star className="size-3 text-[var(--color-warning)]" />
              {formatRating(item)}
            </span>
            {item.price_label ? <span className={inlinePillClassName}>{item.price_label}</span> : null}
            {item.address_text ? (
              <span className={cn(inlinePillClassName, 'max-w-full')}>
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{item.address_text}</span>
              </span>
            ) : null}
          </div>
        </div>
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={item.snapshot_id ? 'outline' : 'default'}
          className={compactButtonClassName}
          onClick={onSave}
        >
          {item.snapshot_id ? 'Saved to shortlist' : 'Save to shortlist'}
        </Button>
        {item.detail_url ? (
          <Button type="button" variant="outline" size="sm" className={compactButtonClassName} asChild>
            <a href={item.detail_url} target="_blank" rel="noreferrer">
              Source
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        ) : null}
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
      <div className={cn(panelClassName, 'flex h-[220px] items-center justify-center p-6 text-center text-sm text-[var(--color-text-muted)]')}>
        Add `VITE_GOOGLE_MAPS_API_KEY` to enable the map view.
      </div>
    )
  }

  if (!selectedItem || selectedItem.lat == null || selectedItem.lon == null) {
    return (
      <div className={cn(panelClassName, 'flex h-[220px] items-center justify-center p-6 text-center text-sm text-[var(--color-text-muted)]')}>
        No mappable results yet for this view.
      </div>
    )
  }

  return (
    <div className={cn(panelClassName, 'overflow-hidden')}>
      <GoogleMapCanvas
        key={`${selectedItem.id}-${selectedItem.lat}-${selectedItem.lon}`}
        defaultCenter={{ lng: selectedItem.lon, lat: selectedItem.lat }}
        defaultZoom={12.5}
        style={{ width: '100%', height: 220 }}
        disableDefaultUI={false}
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
      >
        <TripMapLayerRenderer layers={layers} />
        <MapPanTo point={{ lat: selectedItem.lat!, lng: selectedItem.lon! }} zoom={12.5} />
        <VoyagerMarkerClusterLayer items={clusteredMarkers} onMarkerClick={(item) => onSelect(item.id)} />
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
            <p className="text-sm font-medium text-[var(--color-text)]">{selectedItem.title}</p>
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
  const days = daysData?.items ?? EMPTY_DAYS

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

  const results = discoverQuery.data?.items ?? EMPTY_DISCOVERY_ITEMS
  const shortlist = shortlistQuery.data?.items ?? EMPTY_DISCOVERY_ITEMS
  const tripLayers = tripLayersData?.items ?? EMPTY_TRIP_LAYERS
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
  const proposals = proposalsQuery.data?.items ?? EMPTY_PROPOSALS
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
    if (
      selectedShortlistId &&
      !shortlist.some((item) => (item.snapshot_id ?? item.id) === selectedShortlistId)
    ) {
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

  const selectedDay = days.find((day) => day.id === selectedDayId) ?? null
  const quickAddItems = recommendationsMutation.data?.items ?? []
  const selectedProposalSummary = selectedProposal?.summary as
    | { activities_changed?: number }
    | null
    | undefined
  const activeDayLabel = selectedDay ? formatDayLabel(selectedDay) : 'Entire trip'
  const resultsSummary = discoverQuery.isLoading ? 'Searching' : `${discoverQuery.data?.total ?? 0} results`

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

  const handleGenerateRecommendations = useCallback(async () => {
    const activeDayIds = selectedDayId ? [selectedDayId] : days.map((day) => day.id)
    const attachableShortlistIds = shortlist
      .filter((item) => item.snapshot_id && item.is_attachable)
      .map((item) => item.snapshot_id!) as string[]

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
  }, [
    days,
    recommendationsMutation.mutateAsync,
    selectedDayId,
    selectedShortlistItem?.is_attachable,
    selectedShortlistItem?.snapshot_id,
    shortlist,
  ])

  const handleGenerateProposal = useCallback(async () => {
    const activeDayIds = selectedDayId ? [selectedDayId] : days.map((day) => day.id)
    const attachableShortlistIds = shortlist
      .filter((item) => item.snapshot_id && item.is_attachable)
      .map((item) => item.snapshot_id!) as string[]

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
  }, [days, optimizeTripMutation.mutateAsync, selectedDayId, setSearchParams, shortlist, trip])

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

  const handleRefreshSearch = useCallback(() => {
    void discoverQuery.refetch()
  }, [discoverQuery.refetch])

  const headerMeta = useMemo(
    () =>
      trip ? (
        <WorkspaceMetaRow
          items={[
            trip.destination_text,
            activeDayLabel,
            `${shortlist.length} saved`,
            resultsSummary,
          ]}
        />
      ) : null,
    [activeDayLabel, resultsSummary, shortlist.length, trip],
  )

  const headerActions = useMemo(
    () => (
      <ActivityActionCluster
        onRefresh={handleRefreshSearch}
        onQuickAdd={() => void handleGenerateRecommendations()}
        onProposal={() => void handleGenerateProposal()}
        isRefreshing={discoverQuery.isFetching}
        isQuickAddPending={recommendationsMutation.isPending}
        isProposalPending={optimizeTripMutation.isPending || isJobRunning(optimizeJobQuery.data?.status)}
      />
    ),
    [
      discoverQuery.isFetching,
      handleGenerateProposal,
      handleGenerateRecommendations,
      handleRefreshSearch,
      optimizeJobQuery.data?.status,
      optimizeTripMutation.isPending,
      recommendationsMutation.isPending,
    ],
  )

  const hasShellHeaderActions = useAppShellHeaderActions(headerActions)
  const hasShellHeaderMeta = useAppShellHeaderMeta(headerMeta)

  return (
    <WorkspacePage className="min-h-0 gap-4">
      <Tabs
        value={entityType}
        onValueChange={(value) => setEntityType(value as ActivityEntityType)}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <section className={cn(panelSoftClassName, 'p-4')}>
          {!hasShellHeaderMeta ? (
            <WorkspaceMetaRow
              items={[
                trip?.destination_text ?? 'Trip destination',
                activeDayLabel,
                `${shortlist.length} saved`,
                resultsSummary,
              ]}
              className="mb-3"
            />
          ) : null}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TabsList className="rounded-[10px] border-black/8 bg-white p-1 shadow-none">
                  {Object.entries(ENTITY_META).map(([value, meta]) => {
                    const Icon = meta.icon
                    return (
                      <TabsTrigger
                        key={value}
                        value={value}
                        className="h-8 rounded-[8px] px-3 text-[0.82rem] font-medium shadow-none data-[state=active]:shadow-none"
                      >
                        <Icon className="size-3.5" />
                        {meta.label}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
                <p className="text-[0.78rem] text-[var(--color-text-muted)]">{resultsSummary}</p>
              </div>

              <div className="grid gap-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]">
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder={trip?.destination_text || 'Search activities, cuisine, neighborhoods'}
                  className={controlClassName}
                />

                <Select
                  value={selectedDayId || 'all'}
                  onValueChange={(value) => setSelectedDayId(value === 'all' ? '' : value)}
                >
                  <SelectTrigger className={controlClassName}>
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
                  <SelectTrigger className={controlClassName}>
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

              {entityType === 'attraction' ? (
                <Select value={goodFor || 'all'} onValueChange={(value) => setGoodFor(value === 'all' ? '' : value)}>
                  <SelectTrigger className={controlClassName}>
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
              ) : null}

              {entityType === 'restaurant' ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <Select value={establishmentType} onValueChange={setEstablishmentType}>
                    <SelectTrigger className={controlClassName}>
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
                    <SelectTrigger className={controlClassName}>
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
              ) : null}

              {entityType === 'cruise' ? (
                <Select value={cruiseLength || 'all'} onValueChange={(value) => setCruiseLength(value === 'all' ? '' : value)}>
                  <SelectTrigger className={controlClassName}>
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
              ) : null}
            </div>

            {!hasShellHeaderActions ? (
              <ActivityActionCluster
                onRefresh={() => void discoverQuery.refetch()}
                onQuickAdd={() => void handleGenerateRecommendations()}
                onProposal={() => void handleGenerateProposal()}
                isRefreshing={discoverQuery.isFetching}
                isQuickAddPending={recommendationsMutation.isPending}
                isProposalPending={optimizeTripMutation.isPending || isJobRunning(optimizeJobQuery.data?.status)}
                className="lg:max-w-[18rem] lg:justify-end"
                dataTestId="activities-fallback-actions"
              />
            ) : null}
          </div>
        </section>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(320px,0.85fr)]">
          <section className={cn(panelClassName, 'flex min-h-0 flex-col overflow-hidden')}>
            <div className={panelHeaderClassName}>
              <div className="min-w-0">
                <h2 className={sectionTitleClassName}>{ENTITY_META[entityType].label}</h2>
                <p className={sectionNoteClassName}>{ENTITY_META[entityType].eyebrow}</p>
              </div>
              {discoverQuery.isFetching ? <Loader2 className="size-4 animate-spin text-[var(--color-text-muted)]" /> : null}
            </div>

            <ScrollArea className="min-h-0 flex-1 px-3 py-3">
              <div className="space-y-3">
                {discoverQuery.error ? (
                  <Alert variant="warning">
                    <AlertDescription>
                      {discoverQuery.error instanceof Error
                        ? discoverQuery.error.message
                        : 'Could not load TripAdvisor activity search.'}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {!discoverQuery.isLoading && results.length === 0 ? (
                  <div className={emptyStateClassName}>
                    Adjust the search or filters. Empty searches fall back to the trip destination.
                  </div>
                ) : null}

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
            <div className={cn(panelClassName, 'flex min-h-0 flex-col overflow-hidden')}>
              <div className={panelHeaderClassName}>
                <div className="min-w-0">
                  <h2 className={sectionTitleClassName}>{activeItem ? detail?.title ?? activeItem.title : 'Selected item'}</h2>
                  <p className={sectionNoteClassName}>
                    {activeItem ? 'Saved detail and live context' : 'Choose a result or shortlist item'}
                  </p>
                </div>
                {activeItem ? (
                  <Badge variant={activeItem.is_attachable ? 'success' : 'neutral'}>
                    {activeItem.is_attachable ? 'Planner ready' : 'Reference only'}
                  </Badge>
                ) : null}
              </div>

              <ScrollArea className="min-h-0 flex-1 px-4 py-4">
                {activeItem ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="neutral">{ENTITY_META[activeItem.entity_type].label}</Badge>
                      {detail?.status_text ? <Badge variant="outline">{detail.status_text}</Badge> : null}
                      <Badge variant="outline">{formatRating(detail ?? activeItem)}</Badge>
                    </div>

                    {(detail?.summary ?? activeItem.summary) ? (
                      <p className="text-sm leading-7 text-[var(--color-text-muted)]">
                        {detail?.summary ?? activeItem.summary}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {(detail?.address_text ?? activeItem.address_text) ? (
                        <span className={cn(inlinePillClassName, 'max-w-full')}>
                          <MapPin className="size-3 shrink-0" />
                          <span className="truncate">{detail?.address_text ?? activeItem.address_text}</span>
                        </span>
                      ) : null}
                      {detail?.price_label ? <span className={inlinePillClassName}>{detail.price_label}</span> : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {detail?.booking_links.slice(0, 2).map((link) => (
                        <Button key={link.url} variant="outline" size="sm" className={compactButtonClassName} asChild>
                          <a href={link.url} target="_blank" rel="noreferrer">
                            {link.label}
                            <ExternalLink className="size-3.5" />
                          </a>
                        </Button>
                      ))}
                      {activeItem.detail_url ? (
                        <Button variant="outline" size="sm" className={compactButtonClassName} asChild>
                          <a href={activeItem.detail_url} target="_blank" rel="noreferrer">
                            TripAdvisor
                            <ArrowRight className="size-3.5" />
                          </a>
                        </Button>
                      ) : null}
                    </div>

                    <Separator />

                    {detailQuery.isLoading && activeSnapshotId ? (
                      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                        <Loader2 className="size-4 animate-spin" />
                        Loading saved detail…
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <p className="text-[0.78rem] font-medium text-[var(--color-text)]">Hours</p>
                          {detail?.hours.length ? (
                            <div className="mt-2 space-y-2 text-sm text-[var(--color-text-muted)]">
                              {detail.hours.slice(0, 3).map((hours) => (
                                <div key={hours.day} className="flex justify-between gap-3 rounded-[10px] bg-[var(--color-secondary-surface)] px-3 py-2">
                                  <span>{hours.day}</span>
                                  <span className="text-right">
                                    {hours.times
                                      .map((entry) => [entry.open, entry.close].filter(Boolean).join('-'))
                                      .join(', ') || 'Closed'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                              Save this shortlist item to load cached hours and provider detail.
                            </p>
                          )}
                        </div>

                        <div>
                          <p className="text-[0.78rem] font-medium text-[var(--color-text)]">Reviews</p>
                          {detail?.reviews.length ? (
                            <div className="mt-2 space-y-3">
                              {detail.reviews.slice(0, 2).map((review) => (
                                <div
                                  key={review.review_id}
                                  className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-3"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-medium text-[var(--color-text)]">
                                      {review.title || review.reviewer_name || 'TripAdvisor review'}
                                    </p>
                                    {review.rating != null ? (
                                      <Badge variant="neutral" className="normal-case tracking-normal">
                                        {review.rating.toFixed(1)}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  {review.text ? (
                                    <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{review.text}</p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
                              No cached reviews yet.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-[240px] items-center justify-center">
                    <p className="max-w-xs text-center text-sm leading-6 text-[var(--color-text-muted)]">
                      Pick a discovery result or a shortlist item to inspect it here.
                    </p>
                  </div>
                )}
              </ScrollArea>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <h3 className="text-[0.95rem] font-medium text-[var(--color-text)]">Map</h3>
                <span className="text-[0.78rem] text-[var(--color-text-muted)]">Supporting view</span>
              </div>
              <DiscoveryMap
                items={results}
                selectedId={selectedResultId ?? selectedShortlistId}
                onSelect={(id) => setSelectedResultId(id)}
                layers={tripLayers}
              />
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-4">
            <section className={cn(panelClassName, 'flex min-h-[250px] flex-col overflow-hidden')}>
              <div className={panelHeaderClassName}>
                <div>
                  <h2 className={sectionTitleClassName}>Shortlist</h2>
                  <p className={sectionNoteClassName}>Saved items ready for review or planner attach.</p>
                </div>
                <Badge variant="neutral" className="normal-case tracking-normal">
                  {shortlist.length}
                </Badge>
              </div>

              <ScrollArea className="min-h-0 flex-1 px-3 py-3">
                <div className="space-y-3">
                  {shortlist.length === 0 ? (
                    <div className={emptyStateClassName}>
                      Save results here. Attractions and restaurants can be attached to a day or sent to AI.
                    </div>
                  ) : null}

                  {shortlist.map((item) => (
                    <div
                      key={item.snapshot_id ?? item.id}
                      className={cn(
                        'rounded-[12px] border p-3 transition-colors',
                        selectedShortlistId === (item.snapshot_id ?? item.id)
                          ? 'border-[rgba(114,174,230,0.44)] bg-white'
                          : 'border-black/8 bg-[var(--color-secondary-surface)]',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedShortlistId(item.snapshot_id ?? item.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">
                              {ENTITY_META[item.entity_type].label}
                            </p>
                            <p className="truncate text-sm font-medium text-[var(--color-text)]">{item.title}</p>
                          </div>
                          {item.trip_day_id ? (
                            <Badge variant="success" className="shrink-0">
                              Attached
                            </Badge>
                          ) : null}
                        </div>
                        {item.address_text ? (
                          <p className="mt-1.5 text-sm leading-6 text-[var(--color-text-muted)]">{item.address_text}</p>
                        ) : null}
                      </button>

                      {item.is_attachable && item.snapshot_id ? (
                        <div className="mt-3">
                          <Select
                            value={selectedDayId || item.trip_day_id || 'all'}
                            onValueChange={(value) => {
                              if (value !== 'all') {
                                void handleAttach(item.snapshot_id!, value)
                              }
                            }}
                          >
                            <SelectTrigger className={cn(controlClassName, 'h-8 rounded-[8px] px-3 text-[0.82rem]')}>
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
                      ) : null}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </section>

            <section className={cn(panelClassName, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
              <div className={panelHeaderClassName}>
                <div>
                  <h2 className={sectionTitleClassName}>AI assistance</h2>
                  <p className={sectionNoteClassName}>Use the current shortlist and day scope.</p>
                </div>
                <div className="inline-flex rounded-[10px] border border-black/8 bg-[var(--color-secondary-surface)] p-1">
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
                      'rounded-[8px] px-3 py-1.5 text-[0.82rem] font-medium transition-colors',
                      aiMode === 'quick-add'
                        ? 'bg-[var(--color-cta)] text-white'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
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
                      'rounded-[8px] px-3 py-1.5 text-[0.82rem] font-medium transition-colors',
                      aiMode === 'proposal'
                        ? 'bg-[var(--color-cta)] text-white'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
                    )}
                  >
                    Proposal
                  </button>
                </div>
              </div>

              <ScrollArea className="min-h-0 flex-1 px-4 py-4">
                {aiMode === 'quick-add' ? (
                  <div className="space-y-4">
                    <p className="text-sm leading-6 text-[var(--color-text-muted)]">
                      Rank the shortlist against the current day scope and attach the best fit.
                    </p>

                    <Button
                      type="button"
                      onClick={handleGenerateRecommendations}
                      disabled={recommendationsMutation.isPending}
                      className={cn(compactButtonClassName, 'w-full')}
                    >
                      {recommendationsMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      Generate quick-add suggestions
                    </Button>

                    {quickAddItems.length === 0 ? (
                      <div className={emptyStateClassName}>
                        No quick-add suggestions yet. Save shortlist items and run the action.
                      </div>
                    ) : null}

                    {quickAddItems.map((entry) => {
                      const suggestedDay = days.find((day) => day.id === entry.trip_day_id)
                      return (
                        <div
                          key={`${entry.snapshot_id}-${entry.trip_day_id}`}
                          className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[var(--color-text)]">{entry.item.title}</p>
                              <p className="mt-1 text-[0.78rem] text-[var(--color-text-muted)]">
                                {suggestedDay ? formatDayLabel(suggestedDay) : 'Suggested day'}
                              </p>
                            </div>
                            <Badge variant="neutral" className="normal-case tracking-normal">
                              {entry.score.toFixed(2)}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{entry.rationale}</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn(compactButtonClassName, 'mt-3')}
                            onClick={() => void handleAttach(entry.snapshot_id, entry.trip_day_id)}
                          >
                            Add to planner
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm leading-6 text-[var(--color-text-muted)]">
                      Build a reviewable proposal from the saved shortlist before applying it.
                    </p>

                    <Button
                      type="button"
                      onClick={handleGenerateProposal}
                      disabled={optimizeTripMutation.isPending || isJobRunning(optimizeJobQuery.data?.status)}
                      className={cn(compactButtonClassName, 'w-full')}
                    >
                      {optimizeTripMutation.isPending || isJobRunning(optimizeJobQuery.data?.status) ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <WandSparkles className="size-4" />
                      )}
                      Generate reviewable proposal
                    </Button>

                    {optimizeJobQuery.data ? (
                      <Alert>
                        <AlertDescription>Proposal job status: {optimizeJobQuery.data.status}</AlertDescription>
                      </Alert>
                    ) : null}

                    <div className="space-y-3">
                      {proposals.map((proposal) => (
                        <button
                          key={proposal.id}
                          type="button"
                          onClick={() => setSelectedProposalId(proposal.id)}
                          className={cn(
                            'w-full rounded-[12px] border p-3 text-left transition-colors',
                            selectedProposal?.id === proposal.id
                              ? 'border-[rgba(114,174,230,0.44)] bg-white'
                              : 'border-black/8 bg-[var(--color-secondary-surface)]',
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[var(--color-text)]">{proposal.objective}</p>
                              <p className="mt-1 text-[0.78rem] text-[var(--color-text-muted)]">
                                Based on v{proposal.based_on_trip_version}
                              </p>
                            </div>
                            <ProposalStatusBadge status={proposal.status} />
                          </div>
                        </button>
                      ))}
                    </div>

                    {selectedProposal ? (
                      <div className="rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text)]">
                              {(selectedProposalSummary?.activities_changed ?? selectedProposal.items.length)} activity moves
                            </p>
                            <p className="mt-1 text-[0.78rem] text-[var(--color-text-muted)]">
                              Review before apply
                            </p>
                          </div>
                          <ProposalStatusBadge status={selectedProposal.status} />
                        </div>

                        <div className="mt-3 space-y-3">
                          {selectedProposal.items.slice(0, 4).map((item) => (
                            <ProposalActivityRow key={item.id} item={item} />
                          ))}
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                            <MessageSquareQuote className="size-4" />
                            Review before apply
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={compactButtonClassName}
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
                      <div className={emptyStateClassName}>
                        Generate a proposal to inspect AI-assisted reshaping here.
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </section>
          </aside>
        </div>
      </Tabs>
    </WorkspacePage>
  )
}
