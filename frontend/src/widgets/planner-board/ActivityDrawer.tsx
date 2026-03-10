import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  BedDouble,
  Check,
  ChevronLeft,
  ExternalLink,
  Landmark,
  Loader2,
  MapPin,
  Plane,
  Search,
  Ticket,
  Utensils,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useDiscoverActivities } from '@/entities/activity-discovery/queries'
import { useCreatePlace, useGooglePlaceSearch, usePlace, usePlaceSearch } from '@/entities/place/queries'
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import { cn } from '@/shared/lib/cn'
import type {
  Activity,
  ActivityCategory,
  ActivityCreateInput,
  ActivityDiscoveryItem,
  Place,
  PlaceCreateInput,
  GooglePlaceCandidate,
  PlannerActivity,
} from '@/shared/api/types'
import { PLANNER_CATEGORY_META, plannerCategoryLabel } from './categories'

const activitySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: z.string().optional(),
  start_time: z.string().optional(),
  duration_min: z
    .union([z.number().int().positive(), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
  estimated_cost_amount: z
    .union([z.number().nonnegative(), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
  estimated_cost_currency: z.string().optional(),
  notes: z.string().optional(),
})

type ActivityFormValues = z.infer<typeof activitySchema>
type Step = 0 | 1 | 2

type PlaceCandidate = {
  source: string
  external_id?: string | null
  saved_place_id?: string | null
  name: string
  category: string | null
  address_text: string | null
  lat: number | null
  lon: number | null
  metadata: Record<string, unknown>
  description?: string | null
}

interface Props {
  open: boolean
  tripId: string
  activity?: Activity | PlannerActivity | null
  defaultTripDayId?: string | null
  defaultDayLabel?: string | null
  onClose: () => void
  onSave: (data: ActivityCreateInput) => Promise<void>
  isSaving?: boolean
}

const CATEGORY_ICON: Record<ActivityCategory, typeof Landmark> = {
  visit: Landmark,
  eat: Utensils,
  activity: Ticket,
  hotel: BedDouble,
  travel: Plane,
}

function currentStepDescription(step: Step, category: ActivityCategory, isCreate: boolean) {
  if (!isCreate) {
    return 'Edit the linked place and card details.'
  }
  if (step === 0) {
    return 'Pick the type of planner card you want to add.'
  }
  if (step === 1) {
    if (category === 'travel') {
      return 'Search the origin and destination for this route.'
    }
    if (category === 'hotel') {
      return 'Search and link the stay, or open hotel search.'
    }
    return 'Search and link a place.'
  }
  return 'Review the details and save the card.'
}

function categoryToEntityType(category: ActivityCategory) {
  if (category === 'eat') return 'restaurant'
  return 'attraction'
}

function activityToForm(activity: Activity | PlannerActivity): ActivityFormValues {
  return {
    title: activity.title,
    description: activity.description ?? undefined,
    start_time: activity.start_time ?? undefined,
    duration_min: activity.duration_min ?? undefined,
    estimated_cost_amount:
      activity.estimated_cost_amount != null ? Number(activity.estimated_cost_amount) : undefined,
    estimated_cost_currency: activity.estimated_cost_currency ?? 'EUR',
    notes: activity.notes ?? undefined,
  }
}

function emptyActivityForm(): ActivityFormValues {
  return {
    title: '',
    description: '',
    start_time: '',
    duration_min: undefined,
    estimated_cost_amount: undefined,
    estimated_cost_currency: 'EUR',
    notes: '',
  }
}

function plannerActivityCandidate(place: Place | null | undefined): PlaceCandidate | null {
  if (!place) return null
  return {
    source: place.source,
    external_id: place.external_id,
    saved_place_id: place.id,
    name: place.name,
    category: place.category,
    address_text: place.address_text,
    lat: place.lat,
    lon: place.lon,
    metadata: place.metadata ?? {},
  }
}

function candidateFromDiscovery(item: ActivityDiscoveryItem): PlaceCandidate {
  return {
    source: `tripadvisor_${item.entity_type}`,
    external_id: item.provider_ref,
    name: item.title,
    category: item.entity_type,
    address_text: item.address_text,
    lat: item.lat,
    lon: item.lon,
    metadata: {
      provider: item.provider,
      detail_url: item.detail_url,
      price_label: item.price_label,
      rating: item.rating,
      review_count: item.review_count,
    },
    description: item.summary,
  }
}

function candidateFromTravelDetails(
  details: Record<string, unknown>,
  prefix: 'origin' | 'destination',
): PlaceCandidate | null {
  const text = typeof details[`${prefix}_text`] === 'string' ? String(details[`${prefix}_text`]) : null
  const geo =
    details[`${prefix}_geo`] && typeof details[`${prefix}_geo`] === 'object'
      ? (details[`${prefix}_geo`] as Record<string, unknown>)
      : {}
  const lat = Number(geo.lat)
  const lon = Number(geo.lon)

  if (!text && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
    return null
  }

  return {
    source: 'manual_route',
    saved_place_id:
      typeof details[`${prefix}_place_id`] === 'string'
        ? String(details[`${prefix}_place_id`])
        : null,
    name: text ?? (prefix === 'origin' ? 'Origin' : 'Destination'),
    category: prefix,
    address_text: text,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    metadata: {},
  }
}

function candidateFromGooglePlace(place: GooglePlaceCandidate): PlaceCandidate {
  return {
    source: 'google_places',
    external_id: place.place_id,
    name: place.name,
    category: place.category,
    address_text: place.address_text,
    lat: place.lat,
    lon: place.lon,
    metadata: place.metadata ?? {},
  }
}

function formatPlaceCaption(candidate: PlaceCandidate | null) {
  if (!candidate) return 'No place selected yet'
  return candidate.address_text || candidate.category || candidate.name
}

function buildOfferSearchUrl(
  tripId: string,
  mode: 'transport' | 'lodging',
  tripDayId: string | null | undefined,
) {
  const params = new URLSearchParams({
    mode,
    plannerReturnTo: `/app/trips/${tripId}/plan`,
  })
  if (tripDayId) {
    params.set('dayId', tripDayId)
    params.set('plannerDayId', tripDayId)
  }
  return `/app/trips/${tripId}/offers?${params.toString()}`
}

function normalizePlaceSearchQuery(value: string) {
  return value.replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
}

function normalizeDiscoveryQuery(value: string) {
  const normalized = normalizePlaceSearchQuery(value)
  if (normalized.length < 4) {
    return ''
  }

  return normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['"]/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function candidateIdentity(candidate: PlaceCandidate) {
  const normalizedName = normalizePlaceSearchQuery(candidate.name).toLowerCase()
  const normalizedAddress = normalizePlaceSearchQuery(candidate.address_text ?? '').toLowerCase()

  if (normalizedName && normalizedAddress) {
    return `text:${normalizedName}:${normalizedAddress}`
  }
  if (candidate.external_id) {
    return `external:${candidate.source}:${candidate.external_id}`
  }
  if (candidate.saved_place_id) {
    return `saved:${candidate.saved_place_id}`
  }
  if (candidate.lat != null && candidate.lon != null && normalizedName) {
    return `geo:${normalizedName}:${candidate.lat.toFixed(5)}:${candidate.lon.toFixed(5)}`
  }
  return `text:${normalizedName}:${normalizedAddress}`
}

function candidatePriority(candidate: PlaceCandidate) {
  if (candidate.saved_place_id) return 3
  if (candidate.source === 'google_places') return 2
  return 1
}

function mergePlaceCandidates(...groups: PlaceCandidate[][]) {
  const merged = new Map<string, PlaceCandidate>()

  for (const group of groups) {
    for (const candidate of group) {
      const key = candidateIdentity(candidate)
      const existing = merged.get(key)
      if (!existing || candidatePriority(candidate) > candidatePriority(existing)) {
        merged.set(key, candidate)
      }
    }
  }

  return Array.from(merged.values())
}

function candidateMatchesQuery(candidate: PlaceCandidate | null, query: string) {
  if (!candidate) return false
  const normalizedQuery = normalizePlaceSearchQuery(query).toLowerCase()
  if (!normalizedQuery) return true

  const haystacks = [candidate.name, candidate.address_text ?? '', candidate.category ?? '']
    .map((value) => normalizePlaceSearchQuery(value).toLowerCase())
    .filter(Boolean)

  return haystacks.some((value) => value.includes(normalizedQuery))
}

function candidateSourceLabel(candidate: PlaceCandidate) {
  if (candidate.saved_place_id) return 'Saved'
  if (candidate.source === 'google_places') return 'Google'
  if (candidate.source.startsWith('tripadvisor_')) return 'Suggested'
  if (candidate.source === 'manual_route') return 'Manual'
  return 'Place'
}

function autoResolveCandidate(candidates: PlaceCandidate[], query: string) {
  const normalizedQuery = normalizePlaceSearchQuery(query).toLowerCase()
  if (normalizedQuery.length < 3) {
    return null
  }

  const exactMatch =
    candidates.find((candidate) =>
      [candidate.name, candidate.address_text ?? '']
        .map((value) => normalizePlaceSearchQuery(value).toLowerCase())
        .some((value) => value === normalizedQuery),
    ) ?? null

  return exactMatch ?? candidates[0] ?? null
}

function PlaceSelector({
  query,
  selectedCandidate,
  onQueryChange,
  onSelect,
  autoFocus = false,
  searchPlaceholder,
  helperText,
  results = [],
  isSearching = false,
}: {
  query: string
  selectedCandidate?: PlaceCandidate | null
  onQueryChange: (value: string) => void
  onSelect: (candidate: PlaceCandidate) => void
  autoFocus?: boolean
  searchPlaceholder: string
  helperText: string
  results?: PlaceCandidate[]
  isSearching?: boolean
}) {
  const normalizedQuery = normalizePlaceSearchQuery(query)
  const showResults = normalizedQuery.length >= 3
  const showSelectedSummary = !normalizedQuery && Boolean(selectedCandidate)

  return (
    <div className="rounded-[16px] border border-black/8 bg-[var(--color-secondary-surface)] p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <Input
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-11 rounded-[12px] border-black/8 bg-white pl-10 shadow-none"
        />
      </div>

      {showSelectedSummary && selectedCandidate ? (
        <div className="mt-3 flex items-start gap-3 rounded-[12px] border border-black/8 bg-white px-3 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-secondary-surface)]">
            <MapPin className="h-4 w-4 text-[var(--color-text-muted)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-[var(--color-text)]">
                {selectedCandidate.name}
              </p>
              <Badge variant="secondary" className="tracking-[0.08em]">
                {candidateSourceLabel(selectedCandidate)}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
              {formatPlaceCaption(selectedCandidate)}
            </p>
          </div>
          <Check className="mt-0.5 h-4 w-4 text-[var(--color-text)]" />
        </div>
      ) : null}

      <ScrollArea className="mt-3 max-h-72">
        <div className="flex flex-col gap-1 pr-2">
          {!showResults ? (
            <div className="rounded-[12px] px-1 py-2 text-sm text-[var(--color-text-muted)]">
              {helperText}
            </div>
          ) : isSearching ? (
            <div className="flex items-center gap-2 rounded-[12px] px-3 py-3 text-sm text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching places...
            </div>
          ) : results.length ? (
            results.map((result) => {
              const isSelected =
                selectedCandidate != null &&
                candidateIdentity(selectedCandidate) === candidateIdentity(result)
              return (
                <button
                  key={candidateIdentity(result)}
                  type="button"
                  onClick={() => onSelect(result)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-[12px] border px-3 py-3 text-left transition-colors',
                    isSelected
                      ? 'border-[rgba(26,22,21,0.12)] bg-white'
                      : 'border-transparent hover:bg-white',
                  )}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
                    <MapPin className="h-4 w-4 text-[var(--color-text-muted)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-[var(--color-text)]">
                        {result.name}
                      </p>
                      <Badge variant="secondary" className="tracking-[0.08em]">
                        {candidateSourceLabel(result)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
                      {formatPlaceCaption(result)}
                    </p>
                  </div>
                  {isSelected ? <Check className="mt-0.5 h-4 w-4 text-[var(--color-text)]" /> : null}
                </button>
              )
            })
          ) : (
            <div className="rounded-[12px] px-3 py-3 text-sm text-[var(--color-text-muted)]">
              No places found yet. Try a simpler landmark or venue name.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export function ActivityDrawer({
  open,
  tripId,
  activity,
  defaultTripDayId = null,
  defaultDayLabel = null,
  onClose,
  onSave,
  isSaving,
}: Props) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const isCreate = !activity
  const existingDetails = useMemo(
    () =>
      activity?.category_details && typeof activity.category_details === 'object'
        ? (activity.category_details as Record<string, unknown>)
        : {},
    [activity?.category_details],
  )
  const [step, setStep] = useState<Step>(isCreate ? 0 : 2)
  const [category, setCategory] = useState<ActivityCategory>(activity?.category ?? 'visit')
  const [primaryQuery, setPrimaryQuery] = useState('')
  const [primaryCandidate, setPrimaryCandidate] = useState<PlaceCandidate | null>(null)
  const [originQuery, setOriginQuery] = useState('')
  const [destinationQuery, setDestinationQuery] = useState('')
  const [originCandidate, setOriginCandidate] = useState<PlaceCandidate | null>(null)
  const [destinationCandidate, setDestinationCandidate] = useState<PlaceCandidate | null>(null)
  const debouncedPrimaryQuery = useDebouncedValue(normalizePlaceSearchQuery(primaryQuery), 320)
  const debouncedOriginQuery = useDebouncedValue(normalizePlaceSearchQuery(originQuery), 320)
  const debouncedDestinationQuery = useDebouncedValue(normalizePlaceSearchQuery(destinationQuery), 320)
  const discoverySearchQuery = useMemo(
    () => normalizeDiscoveryQuery(debouncedPrimaryQuery),
    [debouncedPrimaryQuery],
  )

  const selectedPlaceId = activity?.place_id ?? null
  const { data: selectedPlace } = usePlace(selectedPlaceId)
  const selectedPlaceCandidate = useMemo(() => plannerActivityCandidate(selectedPlace), [selectedPlace])
  const { data: placeSearchResults, isFetching: isFetchingPrimarySaved } = usePlaceSearch(
    { q: debouncedPrimaryQuery, limit: 6, offset: 0 },
    open && debouncedPrimaryQuery.length >= 3,
  )
  const primaryGoogleSearch = useGooglePlaceSearch(
    { q: debouncedPrimaryQuery, limit: 6, offset: 0 },
    open && step === 1 && category !== 'travel' && debouncedPrimaryQuery.length >= 3,
  )
  const { data: originSearchResults, isFetching: isFetchingOriginSaved } = usePlaceSearch(
    { q: debouncedOriginQuery, limit: 6, offset: 0 },
    open && debouncedOriginQuery.length >= 3,
  )
  const originGoogleSearch = useGooglePlaceSearch(
    { q: debouncedOriginQuery, limit: 6, offset: 0 },
    open && step === 1 && category === 'travel' && debouncedOriginQuery.length >= 3,
  )
  const { data: destinationSearchResults, isFetching: isFetchingDestinationSaved } = usePlaceSearch(
    { q: debouncedDestinationQuery, limit: 6, offset: 0 },
    open && debouncedDestinationQuery.length >= 3,
  )
  const destinationGoogleSearch = useGooglePlaceSearch(
    { q: debouncedDestinationQuery, limit: 6, offset: 0 },
    open && step === 1 && category === 'travel' && debouncedDestinationQuery.length >= 3,
  )
  const discoveryQuery = useDiscoverActivities(
    tripId,
    {
      entity_type: categoryToEntityType(category),
      query: discoverySearchQuery,
      limit: 6,
      page: 1,
    },
    open &&
      step === 1 &&
      ['visit', 'eat', 'activity'].includes(category) &&
      discoverySearchQuery.length >= 4,
  )
  const createPlaceMutation = useCreatePlace()

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    control,
    formState: { errors },
  } = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: activity ? activityToForm(activity) : emptyActivityForm(),
  })

  useEffect(() => {
    if (!open) return

    reset(activity ? activityToForm(activity) : emptyActivityForm())
    setPrimaryQuery('')
    setOriginQuery('')
    setDestinationQuery('')

    if (activity) {
      setCategory(activity.category)
      setStep(2)
      setPrimaryCandidate(null)
      setOriginCandidate(candidateFromTravelDetails(existingDetails, 'origin'))
      setDestinationCandidate(candidateFromTravelDetails(existingDetails, 'destination'))
      return
    }

    setCategory('visit')
    setStep(0)
    setPrimaryCandidate(null)
    setOriginCandidate(null)
    setDestinationCandidate(null)
  }, [activity, existingDetails, open, reset])

  useEffect(() => {
    if (!open || !activity) return
    setPrimaryCandidate(selectedPlaceCandidate)
  }, [activity, open, selectedPlaceCandidate])

  useEffect(() => {
    if (!open || activity || !selectedPlace) return
    setPrimaryCandidate((current) => current ?? selectedPlaceCandidate)
  }, [activity, open, selectedPlace, selectedPlaceCandidate])

  const persistPlaceCandidate = async (candidate: PlaceCandidate | null) => {
    if (!candidate) return null
    if (candidate.saved_place_id) {
      return candidate.saved_place_id
    }

    const payload: PlaceCreateInput = {
      source: candidate.source,
      external_id: candidate.external_id ?? null,
      name: candidate.name,
      category: candidate.category,
      address_text: candidate.address_text,
      lat: candidate.lat,
      lon: candidate.lon,
      metadata: candidate.metadata,
    }

    const created = await createPlaceMutation.mutateAsync({
      data: payload,
      idempotencyKey: crypto.randomUUID(),
    })

    return created.id
  }

  const applyCandidateAutofill = (candidate: PlaceCandidate) => {
    if (!(getValues('title') ?? '').trim()) {
      setValue('title', candidate.name)
    }
    if (candidate.description && !getValues('description')) {
      setValue('description', candidate.description)
    }
  }

  const onPrimaryCandidateSelect = (candidate: PlaceCandidate) => {
    setPrimaryCandidate(candidate)
    setPrimaryQuery(candidate.name)
    applyCandidateAutofill(candidate)
  }

  const savedPlaceCandidates = useMemo(
    () =>
      mergePlaceCandidates(
        (placeSearchResults?.items ?? []).map((item) => ({
          source: item.source,
          external_id: item.external_id,
          saved_place_id: item.id,
          name: item.name,
          category: item.category,
          address_text: item.address_text,
          lat: item.lat,
          lon: item.lon,
          metadata: item.metadata ?? {},
        })),
    ),
    [placeSearchResults?.items],
  )
  const primaryGoogleCandidates = useMemo(
    () => (primaryGoogleSearch.data?.items ?? []).map(candidateFromGooglePlace),
    [primaryGoogleSearch.data?.items],
  )

  const originSavedCandidates = useMemo(
    () =>
      mergePlaceCandidates(
        (originSearchResults?.items ?? []).map((item) => ({
          source: item.source,
          external_id: item.external_id,
          saved_place_id: item.id,
          name: item.name,
          category: item.category,
          address_text: item.address_text,
          lat: item.lat,
          lon: item.lon,
          metadata: item.metadata ?? {},
        })),
    ),
    [originSearchResults?.items],
  )
  const originGoogleCandidates = useMemo(
    () => (originGoogleSearch.data?.items ?? []).map(candidateFromGooglePlace),
    [originGoogleSearch.data?.items],
  )

  const destinationSavedCandidates = useMemo(
    () =>
      mergePlaceCandidates(
        (destinationSearchResults?.items ?? []).map((item) => ({
          source: item.source,
          external_id: item.external_id,
          saved_place_id: item.id,
          name: item.name,
          category: item.category,
          address_text: item.address_text,
          lat: item.lat,
          lon: item.lon,
          metadata: item.metadata ?? {},
        })),
    ),
    [destinationSearchResults?.items],
  )
  const destinationGoogleCandidates = useMemo(
    () => (destinationGoogleSearch.data?.items ?? []).map(candidateFromGooglePlace),
    [destinationGoogleSearch.data?.items],
  )

  const discoveryCandidates = useMemo(
    () => mergePlaceCandidates((discoveryQuery.data?.items ?? []).map(candidateFromDiscovery)),
    [discoveryQuery.data?.items],
  )
  const primarySearchResultsCombined = useMemo(
    () =>
      mergePlaceCandidates(
        savedPlaceCandidates,
        primaryGoogleCandidates,
        ['visit', 'eat', 'activity'].includes(category) ? discoveryCandidates : [],
      ),
    [category, discoveryCandidates, primaryGoogleCandidates, savedPlaceCandidates],
  )
  const originSearchResultsCombined = useMemo(
    () => mergePlaceCandidates(originSavedCandidates, originGoogleCandidates),
    [originGoogleCandidates, originSavedCandidates],
  )
  const destinationSearchResultsCombined = useMemo(
    () => mergePlaceCandidates(destinationSavedCandidates, destinationGoogleCandidates),
    [destinationGoogleCandidates, destinationSavedCandidates],
  )
  const resolvedPrimarySearchCandidate =
    primaryCandidate ?? autoResolveCandidate(primarySearchResultsCombined, primaryQuery)
  const resolvedOriginCandidate =
    originCandidate ?? autoResolveCandidate(originSearchResultsCombined, originQuery)
  const resolvedDestinationCandidate =
    destinationCandidate ?? autoResolveCandidate(destinationSearchResultsCombined, destinationQuery)
  const resolvedPrimaryCandidate = resolvedPrimarySearchCandidate ?? selectedPlaceCandidate
  const isSearchingPrimary =
    debouncedPrimaryQuery !== normalizePlaceSearchQuery(primaryQuery) ||
    isFetchingPrimarySaved ||
    primaryGoogleSearch.isFetching ||
    discoveryQuery.isFetching
  const isSearchingOrigin =
    debouncedOriginQuery !== normalizePlaceSearchQuery(originQuery) ||
    isFetchingOriginSaved ||
    originGoogleSearch.isFetching
  const isSearchingDestination =
    debouncedDestinationQuery !== normalizePlaceSearchQuery(destinationQuery) ||
    isFetchingDestinationSaved ||
    destinationGoogleSearch.isFetching

  const canProceedFromSearch =
    category === 'travel'
      ? Boolean(resolvedOriginCandidate && resolvedDestinationCandidate)
      : Boolean(resolvedPrimaryCandidate)

  const handleNextStep = () => {
    if (step === 0) {
      setStep(1)
      return
    }
    if (step === 1) {
      if (!canProceedFromSearch) {
        toast.error(category === 'travel' ? 'Select both origin and destination.' : 'Select a real place first.')
        return
      }
      if (category !== 'travel' && resolvedPrimarySearchCandidate && !primaryCandidate) {
        setPrimaryCandidate(resolvedPrimarySearchCandidate)
        setPrimaryQuery(resolvedPrimarySearchCandidate.name)
      }
      if (category === 'travel') {
        if (resolvedOriginCandidate && !originCandidate) {
          setOriginCandidate(resolvedOriginCandidate)
          setOriginQuery(resolvedOriginCandidate.name)
        }
        if (resolvedDestinationCandidate && !destinationCandidate) {
          setDestinationCandidate(resolvedDestinationCandidate)
          setDestinationQuery(resolvedDestinationCandidate.name)
        }
      }
      if (category === 'travel' && !(getValues('title') ?? '').trim()) {
        setValue(
          'title',
          `${resolvedOriginCandidate?.name ?? 'Origin'} to ${resolvedDestinationCandidate?.name ?? 'Destination'}`,
        )
      }
      if (
        (category === 'hotel' ||
          category === 'visit' ||
          category === 'eat' ||
          category === 'activity') &&
        resolvedPrimaryCandidate
      ) {
        applyCandidateAutofill(resolvedPrimaryCandidate)
      }
      setStep(2)
    }
  }

  const handleBack = () => {
    setStep((current) => (current === 0 ? 0 : ((current - 1) as Step)))
  }

  const handleCategorySelect = (value: ActivityCategory) => {
    setCategory(value)
    setPrimaryCandidate(null)
    setOriginCandidate(null)
    setDestinationCandidate(null)
    setPrimaryQuery('')
    setOriginQuery('')
    setDestinationQuery('')
    setStep(1)
  }

  const goToOfferSearch = (mode: 'transport' | 'lodging') => {
    navigate(buildOfferSearchUrl(tripId, mode, defaultTripDayId ?? activity?.trip_day_id ?? null))
    onClose()
  }

  const submitActivity = async (values: ActivityFormValues) => {
    try {
      const placeId = category === 'travel' ? null : await persistPlaceCandidate(resolvedPrimaryCandidate)
      const originPlaceId = await persistPlaceCandidate(resolvedOriginCandidate)
      const destinationPlaceId = await persistPlaceCandidate(resolvedDestinationCandidate)

      const categoryDetails: Record<string, unknown> =
        category === 'travel'
          ? {
              origin_text: resolvedOriginCandidate?.name ?? resolvedOriginCandidate?.address_text ?? null,
              destination_text:
                resolvedDestinationCandidate?.name ??
                resolvedDestinationCandidate?.address_text ??
                null,
              origin_geo:
                resolvedOriginCandidate?.lat != null && resolvedOriginCandidate.lon != null
                  ? { lat: resolvedOriginCandidate.lat, lon: resolvedOriginCandidate.lon }
                  : null,
              destination_geo:
                resolvedDestinationCandidate?.lat != null && resolvedDestinationCandidate.lon != null
                  ? { lat: resolvedDestinationCandidate.lat, lon: resolvedDestinationCandidate.lon }
                  : null,
              origin_place_id: originPlaceId,
              destination_place_id: destinationPlaceId,
            }
          : category === 'hotel'
            ? {
                hotel_name: resolvedPrimaryCandidate?.name ?? values.title,
                address_text: resolvedPrimaryCandidate?.address_text ?? null,
                latitude: resolvedPrimaryCandidate?.lat ?? null,
                longitude: resolvedPrimaryCandidate?.lon ?? null,
                place_id: placeId,
              }
            : {
                address_text: resolvedPrimaryCandidate?.address_text ?? null,
                latitude: resolvedPrimaryCandidate?.lat ?? null,
                longitude: resolvedPrimaryCandidate?.lon ?? null,
                search_query: primaryQuery || null,
              }

      await onSave({
        category,
        category_details: categoryDetails,
        title: values.title,
        description: values.description || null,
        start_time: values.start_time || null,
        duration_min: values.duration_min ?? null,
        estimated_cost_amount: values.estimated_cost_amount ?? null,
        estimated_cost_currency: values.estimated_cost_currency || null,
        place_id: placeId,
        notes: values.notes || null,
        is_favorite: activity?.is_favorite ?? false,
        source: activity?.source ?? 'manual',
      })
    } catch {
      toast.error('Failed to prepare the selected place')
    }
  }

  const activeStepDescription = currentStepDescription(step, category, isCreate)
  const CurrentCategoryIcon = CATEGORY_ICON[category] ?? Landmark
  const selectedLocationTitle =
    category === 'travel'
      ? `${resolvedOriginCandidate?.name ?? 'Origin'} to ${resolvedDestinationCandidate?.name ?? 'Destination'}`
      : resolvedPrimaryCandidate?.name ?? 'No place selected'
  const selectedLocationDescription =
    category === 'travel'
      ? 'Both ends will be saved with coordinates when they are available.'
      : resolvedPrimaryCandidate
        ? formatPlaceCaption(resolvedPrimaryCandidate)
        : 'No place linked yet.'

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={
          isMobile
            ? 'flex h-[94dvh] flex-col overflow-hidden rounded-t-[18px] border-x-0 border-b-0 bg-[#f6f7f8] p-0 sm:max-w-none'
            : 'flex h-full w-full max-w-[36rem] flex-col overflow-hidden bg-[#f6f7f8] p-0 sm:max-w-[36rem]'
        }
      >
        <SheetHeader className="gap-2 border-b border-black/8 bg-[#f6f7f8] px-5 py-5">
          <div className="flex items-start gap-3">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-0.5 size-8 rounded-[10px]"
                onClick={handleBack}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {defaultDayLabel ? (
                  <Badge variant="outline" className="tracking-[0.08em]">
                    {defaultDayLabel}
                  </Badge>
                ) : null}
                {step > 0 ? (
                  <Badge variant="outline" className="inline-flex items-center gap-1.5 tracking-[0.08em]">
                    <CurrentCategoryIcon className="h-3.5 w-3.5" />
                    {plannerCategoryLabel(category)}
                  </Badge>
                ) : null}
              </div>
              <SheetTitle className="mt-2 text-[1.32rem] font-semibold tracking-[-0.04em]">
                {activity ? `Edit ${plannerCategoryLabel(category)} card` : 'Create planner card'}
              </SheetTitle>
              <SheetDescription className="mt-1 max-w-[31rem] text-sm leading-5">
                {activeStepDescription}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <form onSubmit={handleSubmit(submitActivity)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
            <div className="mx-auto flex w-full max-w-[32rem] flex-col gap-4">
              {step === 0 ? (
                <section className="grid gap-2.5 md:grid-cols-2">
                  {(Object.keys(PLANNER_CATEGORY_META) as ActivityCategory[]).map((value) => {
                    const meta = PLANNER_CATEGORY_META[value]
                    const Icon = CATEGORY_ICON[value]
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleCategorySelect(value)}
                        aria-pressed={category === value}
                        className={cn(
                          'cursor-pointer rounded-[18px] border bg-white px-4 py-4 text-left shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)] transition-colors',
                          category === value
                            ? 'border-[rgba(26,22,21,0.14)] bg-[var(--color-secondary-surface)]'
                            : 'border-black/8 hover:border-black/12 hover:bg-[var(--color-secondary-surface)]',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex size-10 items-center justify-center rounded-[12px] bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
                            <Icon className="h-5 w-5 text-[var(--color-text)]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-[var(--color-text)]">{meta.label}</p>
                              {category === value ? <Check className="h-4 w-4 text-[var(--color-text)]" /> : null}
                            </div>
                            <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                              {meta.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </section>
              ) : null}

              {step === 1 && category !== 'travel' ? (
                <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Place
                    </p>
                    {category === 'hotel' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-[10px]"
                        onClick={() => goToOfferSearch('lodging')}
                      >
                        <ExternalLink data-icon="inline-start" />
                        Search hotels
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    <PlaceSelector
                      query={primaryQuery}
                      selectedCandidate={resolvedPrimaryCandidate}
                      onQueryChange={(value) => {
                        setPrimaryQuery(value)
                        if (!candidateMatchesQuery(primaryCandidate, value)) {
                          setPrimaryCandidate(null)
                        }
                      }}
                      onSelect={onPrimaryCandidateSelect}
                      autoFocus
                      searchPlaceholder={
                        category === 'hotel'
                          ? 'Search hotel or address'
                          : `Search ${plannerCategoryLabel(category).toLowerCase()} places`
                      }
                      helperText="Type at least 3 characters to search by name or address."
                      results={primarySearchResultsCombined}
                      isSearching={isSearchingPrimary}
                    />
                  </div>
                </section>
              ) : null}

              {step === 1 && category === 'travel' ? (
                <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Route
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-[10px]"
                      onClick={() => goToOfferSearch('transport')}
                    >
                      <ExternalLink data-icon="inline-start" />
                      Search travel
                    </Button>
                  </div>

                  <div className="mt-3 grid gap-3">
                    <div>
                      <p className="mb-2 text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Origin
                      </p>
                      <PlaceSelector
                        query={originQuery}
                        selectedCandidate={originCandidate}
                        onQueryChange={(value) => {
                          setOriginQuery(value)
                          if (!candidateMatchesQuery(originCandidate, value)) {
                            setOriginCandidate(null)
                          }
                        }}
                        onSelect={(candidate) => {
                          setOriginCandidate(candidate)
                          setOriginQuery(candidate.name)
                        }}
                        autoFocus
                        searchPlaceholder="Search departure point"
                        helperText="Type at least 3 characters to search a station, airport, hotel, or address."
                        results={originSearchResultsCombined}
                        isSearching={isSearchingOrigin}
                      />
                    </div>

                    <div>
                      <p className="mb-2 text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        Destination
                      </p>
                      <PlaceSelector
                        query={destinationQuery}
                        selectedCandidate={destinationCandidate}
                        onQueryChange={(value) => {
                          setDestinationQuery(value)
                          if (!candidateMatchesQuery(destinationCandidate, value)) {
                            setDestinationCandidate(null)
                          }
                        }}
                        onSelect={(candidate) => {
                          setDestinationCandidate(candidate)
                          setDestinationQuery(candidate.name)
                        }}
                        searchPlaceholder="Search arrival point"
                        helperText="Type at least 3 characters to search the arrival point."
                        results={destinationSearchResultsCombined}
                        isSearching={isSearchingDestination}
                      />
                    </div>
                  </div>
                </section>
              ) : null}

              {step === 2 ? (
                <div className="grid gap-3">
                  <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                          Linked location
                        </p>
                        <p className="mt-2 text-base font-semibold text-[var(--color-text)]">
                          {selectedLocationTitle}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                          {selectedLocationDescription}
                        </p>
                      </div>
                      <Badge variant="outline" className="tracking-[0.08em]">
                        {plannerCategoryLabel(category)}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                      {defaultDayLabel ?? (activity?.trip_day_id ? 'Assigned to a day' : 'Inbox')}
                    </p>
                  </section>

                  <section className="rounded-[18px] border border-black/8 bg-white p-4 shadow-[0_16px_40px_-34px_rgba(26,22,21,0.4)]">
                    <p className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      Card details
                    </p>
                    <FieldGroup className="mt-3 gap-3">
                      <Field data-invalid={Boolean(errors.title)}>
                        <FieldLabel htmlFor="activity-title">Title</FieldLabel>
                        <FieldContent>
                          <Input
                            id="activity-title"
                            placeholder="Name this planner card"
                            aria-invalid={Boolean(errors.title)}
                            className="h-11 rounded-[10px] border-black/8 bg-white"
                            {...register('title')}
                          />
                        </FieldContent>
                        {errors.title ? <FieldError errors={[errors.title]} /> : null}
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="activity-description">Description</FieldLabel>
                        <FieldContent>
                          <Textarea
                            id="activity-description"
                            rows={5}
                            placeholder="What should this stop include?"
                            className="rounded-[10px] border-black/8 bg-white"
                            {...register('description')}
                          />
                        </FieldContent>
                      </Field>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="activity-start-time">Start time</FieldLabel>
                          <FieldContent>
                            <Input
                              id="activity-start-time"
                              type="time"
                              className="h-11 rounded-[10px] border-black/8 bg-white"
                              {...register('start_time')}
                            />
                          </FieldContent>
                        </Field>

                        <Field data-invalid={Boolean(errors.duration_min)}>
                          <FieldLabel htmlFor="activity-duration">Duration (min)</FieldLabel>
                          <FieldContent>
                            <Controller
                              name="duration_min"
                              control={control}
                              render={({ field }) => (
                                <Input
                                  id="activity-duration"
                                  type="number"
                                  min={0}
                                  className="h-11 rounded-[10px] border-black/8 bg-white"
                                  value={field.value ?? ''}
                                  onChange={(event) =>
                                    field.onChange(event.target.value ? Number(event.target.value) : Number.NaN)
                                  }
                                />
                              )}
                            />
                          </FieldContent>
                          {errors.duration_min ? <FieldError errors={[errors.duration_min]} /> : null}
                        </Field>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                        <Field data-invalid={Boolean(errors.estimated_cost_amount)}>
                          <FieldLabel htmlFor="activity-cost">Estimated cost</FieldLabel>
                          <FieldContent>
                            <Controller
                              name="estimated_cost_amount"
                              control={control}
                              render={({ field }) => (
                                <Input
                                  id="activity-cost"
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="h-11 rounded-[10px] border-black/8 bg-white"
                                  value={field.value ?? ''}
                                  onChange={(event) =>
                                    field.onChange(event.target.value ? Number(event.target.value) : Number.NaN)
                                  }
                                />
                              )}
                            />
                          </FieldContent>
                          {errors.estimated_cost_amount ? <FieldError errors={[errors.estimated_cost_amount]} /> : null}
                        </Field>

                        <Field>
                          <FieldLabel htmlFor="activity-currency">Currency</FieldLabel>
                          <FieldContent>
                            <Input
                              id="activity-currency"
                              className="h-11 rounded-[10px] border-black/8 bg-white"
                              {...register('estimated_cost_currency')}
                            />
                          </FieldContent>
                        </Field>
                      </div>

                      <Field>
                        <FieldLabel htmlFor="activity-notes">Notes</FieldLabel>
                        <FieldContent>
                          <Textarea
                            id="activity-notes"
                            rows={4}
                            placeholder="Operational notes, booking reminders, logistics..."
                            className="rounded-[10px] border-black/8 bg-white"
                            {...register('notes')}
                          />
                        </FieldContent>
                      </Field>
                    </FieldGroup>
                  </section>
                </div>
              ) : null}
            </div>
          </div>

          <SheetFooter className="border-t border-black/8 bg-white px-4 py-3">
            <div className="flex w-full items-center justify-end gap-2">
              {step === 0 ? (
                <Button type="button" variant="outline" className="rounded-[10px]" onClick={onClose}>
                  Cancel
                </Button>
              ) : (
                <Button type="button" variant="outline" className="rounded-[10px]" onClick={handleBack}>
                  Back
                </Button>
              )}

              {step > 0 ? (
                step < 2 ? (
                  <Button
                    key="continue-step"
                    type="button"
                    className="rounded-[10px]"
                    onClick={(event) => {
                      event.preventDefault()
                      handleNextStep()
                    }}
                  >
                    Continue to details
                  </Button>
                ) : (
                  <Button
                    key="submit-step"
                    type="submit"
                    className="rounded-[10px]"
                    disabled={isSaving || createPlaceMutation.isPending}
                  >
                    {isSaving || createPlaceMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {activity ? 'Save changes' : 'Create card'}
                  </Button>
                )
              ) : null}
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
