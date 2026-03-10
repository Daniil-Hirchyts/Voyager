import { differenceInCalendarDays, format } from 'date-fns'
import {
  Calendar,
  Copy,
  Hotel,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Ticket,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { config } from '@/app/config'
import { useDays, usePatchDay } from '@/entities/day/queries'
import { useJob } from '@/entities/job/queries'
import {
  createPlace,
  type DestinationAutocompleteItem,
} from '@/entities/place/api'
import {
  buildPlaceCreateInputFromDestinationSuggestion,
  isBackendPlaceId,
} from '@/entities/place/destination'
import { usePlace } from '@/entities/place/queries'
import { useDestinationAutocomplete } from '@/entities/place/queries'
import { refreshPlacePhotos } from '@/entities/photo/api'
import { usePlacePhotos } from '@/entities/photo/queries'
import {
  mergeTripCoverPhotoPreference,
  readTripCoverPhotoPreference,
  type TripCoverPhotoPreference,
} from '@/entities/trip/cover-photo'
import { useDeleteTrip, useDuplicateTrip, useTrip } from '@/entities/trip/queries'
import { useTripOffers } from '@/entities/offer/queries'
import { isApiError } from '@/shared/api/client'
import type { Offer, PlacePhotoSummary } from '@/shared/api/types'
import { cn } from '@/shared/lib/cn'
import { formatMoney } from '@/shared/lib/format'
import { getJobResultErrors, isJobRunning, isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs'
import { resolvePhotoUrl } from '@/shared/lib/media'
import { WorkspacePage } from '@/shared/layouts/workspace-shell'
import { useAppShellHeaderActions } from '@/widgets/app-shell'

type CoverPhotoCandidate = {
  id: string
  source: string
  image_url: string
  thumbnail_url: string | null
  display_url?: string | null
  display_thumbnail_url?: string | null
  license_code: string | null
  license_url: string | null
  attribution_text: string | null
  isPrimary?: boolean
}

const panelClassName = 'rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)]'
const cardClassName = 'rounded-[10px] border border-black/8 bg-white'
const labelClassName = 'text-[0.72rem] font-medium text-[var(--color-text-muted)]'
const noteClassName = 'text-sm leading-6 text-[var(--color-text-muted)]'

function formatTripTypeLabel(value?: string | null) {
  if (!value) {
    return 'Trip'
  }

  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getTripLength(startDate?: string | null, endDate?: string | null) {
  if (!startDate || !endDate) {
    return null
  }

  return differenceInCalendarDays(new Date(endDate), new Date(startDate)) + 1
}

function mapPrimaryPhotoToCandidate(photo: PlacePhotoSummary): CoverPhotoCandidate {
  return {
    ...photo,
    isPrimary: true,
  }
}

function getCoverPhotoRefreshErrorMessage(job: {
  result?: Record<string, unknown> | null
  error?: unknown
} | null | undefined) {
  const firstError = getJobResultErrors(job as never)[0]
  const providerMessage =
    typeof firstError === 'string'
      ? firstError
      : firstError && typeof firstError === 'object' && 'message' in firstError
        ? String(firstError.message)
        : job?.error && typeof job.error === 'object' && job.error && 'message' in job.error
          ? String(job.error.message)
          : null

  if (providerMessage?.toLowerCase().includes('no licensed place photos found')) {
    return 'No licensed city photos are available for this destination yet.'
  }

  return providerMessage || 'City photos could not be loaded right now.'
}

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [editingDayId, setEditingDayId] = useState<string | null>(null)
  const [dayNotesValue, setDayNotesValue] = useState('')
  const [coverPreference, setCoverPreference] = useState<TripCoverPhotoPreference | null>(() =>
    readTripCoverPhotoPreference(tripId),
  )
  const [coverRefreshJobId, setCoverRefreshJobId] = useState<string | null>(null)
  const [isRefreshingCoverPhotos, setIsRefreshingCoverPhotos] = useState(false)
  const [coverPhotoRefreshError, setCoverPhotoRefreshError] = useState<string | null>(null)
  const dupKeyRef = useRef(crypto.randomUUID())
  const autoRefreshAttemptedRef = useRef(false)
  const placeProvisioningAttemptedRef = useRef(false)

  const { data: trip, isLoading: tripLoading, error: tripError } = useTrip(tripId!)
  const { data: daysData, isLoading: daysLoading } = useDays(tripId!)
  const { data: offersData } = useTripOffers(tripId!, {
    current_only: true,
    limit: 200,
    offset: 0,
  })

  const deleteTrip = useDeleteTrip()
  const duplicateTrip = useDuplicateTrip()
  const patchDay = usePatchDay(tripId!)

  const destinationLookup = trip?.destination_text.trim() ?? ''
  const storedBackendPlaceId = isBackendPlaceId(coverPreference?.placeId)
    ? (coverPreference?.placeId ?? null)
    : null
  const destinationSearch = useDestinationAutocomplete(
    { q: destinationLookup, limit: 4, offset: 0 },
    Boolean(trip && destinationLookup.length >= 2 && !storedBackendPlaceId),
  )
  const inferredDestination = destinationSearch.data?.items?.[0] ?? null
  const resolvedPlaceId: string | null =
    storedBackendPlaceId ??
    (isBackendPlaceId(inferredDestination?.id) ? (inferredDestination?.id ?? null) : null)

  const coverPlaceQuery = usePlace(resolvedPlaceId)
  const coverPhotosQuery = usePlacePhotos(resolvedPlaceId)
  const { data: coverRefreshJob } = useJob(coverRefreshJobId)

  const coverPlace = coverPlaceQuery.data
  const coverPhotosData = coverPhotosQuery.data
  const coverPhotosLoading = coverPhotosQuery.isLoading
  const isCoverRefreshRunning = isJobRunning(coverRefreshJob?.status)
  const isCoverRefreshSuccessful = isJobSuccessful(coverRefreshJob?.status)

  const days = daysData?.items ?? []
  const offersCount = offersData?.items.length ?? 0
  const tripLength = getTripLength(trip?.start_date, trip?.end_date)

  useEffect(() => {
    setCoverPreference(readTripCoverPhotoPreference(tripId))
  }, [tripId])

  useEffect(() => {
    autoRefreshAttemptedRef.current = false
    setCoverRefreshJobId(null)
    setIsRefreshingCoverPhotos(false)
    setCoverPhotoRefreshError(null)
    placeProvisioningAttemptedRef.current = false
  }, [resolvedPlaceId])

  useEffect(() => {
    if (!tripId || !inferredDestination || !isBackendPlaceId(inferredDestination.id)) {
      return
    }

    if (storedBackendPlaceId && coverPreference?.placeLabel) {
      return
    }

    const nextPreference = {
      placeId: inferredDestination.id,
      placeLabel: coverPreference?.placeLabel ?? inferredDestination.label,
    }

    mergeTripCoverPhotoPreference(tripId, nextPreference)
    setCoverPreference((current) => ({ ...(current ?? {}), ...nextPreference }))
  }, [
    coverPreference?.placeId,
    coverPreference?.placeLabel,
    inferredDestination,
    storedBackendPlaceId,
    tripId,
  ])

  useEffect(() => {
    if (
      !tripId ||
      !inferredDestination ||
      storedBackendPlaceId ||
      isBackendPlaceId(inferredDestination.id) ||
      placeProvisioningAttemptedRef.current
    ) {
      return
    }

    placeProvisioningAttemptedRef.current = true

    void createPlace(
      buildPlaceCreateInputFromDestinationSuggestion(inferredDestination as DestinationAutocompleteItem),
      `trip-cover-place-${tripId}`,
    )
      .then((place) => {
        const nextPreference = {
          placeId: place.id,
          placeLabel: inferredDestination.label,
          photoId: null,
        }

        mergeTripCoverPhotoPreference(tripId, nextPreference)
        setCoverPreference((current) => ({ ...(current ?? {}), ...nextPreference }))
      })
      .catch(() => {
        placeProvisioningAttemptedRef.current = false
      })
  }, [inferredDestination, storedBackendPlaceId, tripId])

  const coverPhotoCandidates = useMemo<CoverPhotoCandidate[]>(() => {
    const candidates: CoverPhotoCandidate[] = []

    if (coverPlace?.primary_photo) {
      candidates.push(mapPrimaryPhotoToCandidate(coverPlace.primary_photo))
    }

    for (const photo of coverPhotosData?.items ?? []) {
      if (candidates.some((candidate) => candidate.id === photo.id)) {
        continue
      }

      candidates.push({
        ...photo,
        display_url: undefined,
        display_thumbnail_url: undefined,
        isPrimary: photo.is_primary,
      })
    }

    return candidates
  }, [coverPhotosData?.items, coverPlace?.primary_photo])

  const selectedCoverPhoto = useMemo(() => {
    if (coverPhotoCandidates.length === 0) {
      return null
    }

    return (
      coverPhotoCandidates.find((photo) => photo.id === coverPreference?.photoId) ??
      coverPhotoCandidates.find((photo) => photo.isPrimary) ??
      coverPhotoCandidates[0]
    )
  }, [coverPhotoCandidates, coverPreference?.photoId])

  useEffect(() => {
    if (
      !resolvedPlaceId ||
      coverPhotoCandidates.length > 0 ||
      coverPhotosLoading ||
      isRefreshingCoverPhotos ||
      isCoverRefreshRunning ||
      autoRefreshAttemptedRef.current
    ) {
      return
    }

    autoRefreshAttemptedRef.current = true

    setIsRefreshingCoverPhotos(true)
    setCoverPhotoRefreshError(null)
    void refreshPlacePhotos(resolvedPlaceId, `trip-cover-photo-${resolvedPlaceId}-${Date.now()}`)
      .then((accepted) => {
        setCoverRefreshJobId(accepted.job_id)
      })
      .catch(() => {
        setIsRefreshingCoverPhotos(false)
        setCoverPhotoRefreshError('City photos could not be loaded right now.')
        toast.error('Failed to load city photos')
      })
  }, [
    coverPhotoCandidates.length,
    coverPhotosLoading,
    isCoverRefreshRunning,
    isRefreshingCoverPhotos,
    resolvedPlaceId,
  ])

  useEffect(() => {
    if (!isCoverRefreshSuccessful) {
      return
    }

    setCoverRefreshJobId(null)
    setIsRefreshingCoverPhotos(false)
    setCoverPhotoRefreshError(null)
    void coverPlaceQuery.refetch()
    void coverPhotosQuery.refetch()
  }, [coverPhotosQuery, coverPlaceQuery, isCoverRefreshSuccessful])

  useEffect(() => {
    if (!coverRefreshJobId || !coverRefreshJob?.status || !isJobTerminal(coverRefreshJob.status)) {
      return
    }

    if (isCoverRefreshSuccessful) {
      return
    }

    const message = getCoverPhotoRefreshErrorMessage(coverRefreshJob)

    setCoverRefreshJobId(null)
    setIsRefreshingCoverPhotos(false)
    setCoverPhotoRefreshError(message)
    void coverPlaceQuery.refetch()
    void coverPhotosQuery.refetch()
  }, [coverPhotosQuery, coverPlaceQuery, coverRefreshJob, coverRefreshJobId, isCoverRefreshSuccessful])

  useEffect(() => {
    if (!tripId || !selectedCoverPhoto || coverPreference?.photoId === selectedCoverPhoto.id) {
      return
    }

    mergeTripCoverPhotoPreference(tripId, { photoId: selectedCoverPhoto.id })
    setCoverPreference((current) => ({ ...(current ?? {}), photoId: selectedCoverPhoto.id }))
  }, [coverPreference?.photoId, selectedCoverPhoto, tripId])

  const photoAttributionLabel =
    coverPreference?.placeLabel ?? inferredDestination?.label ?? trip?.destination_text ?? null
  const photoAttributionParts = [photoAttributionLabel, selectedCoverPhoto?.attribution_text]
    .filter((part): part is string => Boolean(part))
    .filter((part, index, parts) =>
      parts.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index,
    )
  const photoAttributionText = photoAttributionParts.join(' · ')
  const coverPhotoUrl = resolvePhotoUrl(selectedCoverPhoto, 'full')
  const isCoverPhotoBusy = coverPhotosLoading || isRefreshingCoverPhotos || isCoverRefreshRunning
  const coverPhotoEmptyMessage = coverPhotoRefreshError ?? 'No city photo available yet.'

  const offersByDay = useMemo(() => {
    const grouped = new globalThis.Map<string, Offer[]>()

    for (const offer of offersData?.items ?? []) {
      if (!offer.trip_day_id) {
        continue
      }

      grouped.set(offer.trip_day_id, [...(grouped.get(offer.trip_day_id) ?? []), offer])
    }

    return grouped
  }, [offersData?.items])

  const handleDelete = async () => {
    if (!tripId) {
      return
    }

    try {
      await deleteTrip.mutateAsync(tripId)
      setShowDeleteConfirm(false)
      navigate('/app/trips')
      toast.success('Trip deleted')
    } catch {
      setShowDeleteConfirm(false)
      toast.error('Failed to delete trip')
    }
  }

  const handleDuplicate = async () => {
    if (!tripId) {
      return
    }

    try {
      const newTrip = await duplicateTrip.mutateAsync({
        tripId,
        idempotencyKey: dupKeyRef.current,
      })
      toast.success('Trip duplicated')
      navigate(`/app/trips/${newTrip.id}`)
    } catch {
      toast.error('Failed to duplicate trip')
    }
  }

  const handleDayNotesSave = async (dayId: string) => {
    try {
      await patchDay.mutateAsync({ dayId, data: { notes: dayNotesValue } })
      setEditingDayId(null)
      toast.success('Notes saved')
    } catch {
      toast.error('Failed to save notes')
    }
  }

  const handlePhotoSelection = (photoId: string) => {
    if (!tripId) {
      return
    }

    mergeTripCoverPhotoPreference(tripId, { photoId })
    setCoverPreference((current) => ({ ...(current ?? {}), photoId }))
  }

  const handleCoverPhotoRefresh = async () => {
    if (!resolvedPlaceId) {
      return
    }

    try {
      setIsRefreshingCoverPhotos(true)
      setCoverPhotoRefreshError(null)
      const accepted = await refreshPlacePhotos(
        resolvedPlaceId,
        `trip-cover-photo-${resolvedPlaceId}-${Date.now()}`,
      )
      setCoverRefreshJobId(accepted.job_id)
    } catch {
      setIsRefreshingCoverPhotos(false)
      setCoverPhotoRefreshError('City photos could not be loaded right now.')
      toast.error('Failed to load city photos')
    }
  }

  const headerActions = useMemo(() => {
    if (!trip || !tripId) {
      return null
    }

    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDuplicate}
          disabled={duplicateTrip.isPending}
          className="h-8 rounded-[8px] border-black/8 px-3 shadow-none"
        >
          {duplicateTrip.isPending ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          Duplicate
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          className="h-8 rounded-[8px] border-black/8 px-3 shadow-none"
        >
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>
        <Button asChild size="sm" className="h-8 rounded-[8px] px-3.5 shadow-none hover:shadow-none">
          <Link to={`/app/trips/${tripId}/plan`}>Open planner</Link>
        </Button>
      </>
    )
  }, [duplicateTrip.isPending, handleDuplicate, trip, tripId])
  const hasShellHeaderActions = useAppShellHeaderActions(headerActions)

  if (tripLoading) {
    return (
      <WorkspacePage className="gap-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,24rem)]">
          <div className="h-[19rem] animate-pulse rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)]" />
          <div className="h-[19rem] animate-pulse rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)]" />
        </div>
        <div className="h-64 animate-pulse rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)]" />
      </WorkspacePage>
    )
  }

  if (tripError || !trip) {
    return (
      <WorkspacePage className="max-w-4xl gap-4">
        <section className={cn(panelClassName, 'p-5')}>
          <div className="flex flex-col gap-2">
            <h1 className="text-[1.3rem] font-medium text-[var(--color-text)]">
              Unable to load the trip
            </h1>
            <p className={noteClassName}>
              {isApiError(tripError) && tripError.status === 404
                ? 'This trip no longer exists or was never created.'
                : 'The trip could not be loaded right now.'}
            </p>
          </div>
          <div className="mt-4">
            <Button asChild className="h-9 rounded-[8px] px-3.5 shadow-none hover:shadow-none">
              <Link to="/app/trips">Back to trips</Link>
            </Button>
          </div>
        </section>
      </WorkspacePage>
    )
  }

  return (
    <>
      <WorkspacePage className="gap-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,24rem)]">
          <section className={cn(panelClassName, 'overflow-hidden')}>
            <div className="relative aspect-[16/10] bg-[var(--color-secondary-surface)]">
              {coverPhotoUrl ? (
                <img
                  src={coverPhotoUrl}
                  alt={photoAttributionLabel ?? trip.destination_text}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[var(--color-text-muted)]">
                  {isCoverPhotoBusy ? (
                    <Loader2 className="size-8 animate-spin" />
                  ) : (
                    <ImageIcon className="size-8" />
                  )}
                  <p className="text-sm">
                    {isCoverPhotoBusy ? 'Loading city photo…' : coverPhotoEmptyMessage}
                  </p>
                  {!isCoverPhotoBusy && resolvedPlaceId ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCoverPhotoRefresh}
                      className="h-8 rounded-[8px] border-black/8 px-3 shadow-none"
                    >
                      Retry
                    </Button>
                  ) : null}
                </div>
              )}

              <div className="absolute right-3 top-3">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-[8px] border-black/8 bg-white/92 px-3 shadow-none backdrop-blur-none"
                    >
                      Change photo
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={8}
                    className="w-[20rem] rounded-[12px] border-black/8 bg-white p-2 shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur-none"
                  >
                    <div className="px-1 pb-2 pt-1">
                      <p className="text-sm font-medium text-[var(--color-text)]">City photos</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {photoAttributionLabel ?? trip.destination_text}
                      </p>
                    </div>

                    <ScrollArea className="max-h-72">
                      {coverPhotosLoading ? (
                        <div className="grid grid-cols-2 gap-2 p-1">
                          {Array.from({ length: 4 }).map((_, index) => (
                            <div
                              key={index}
                              className="aspect-[4/3] animate-pulse rounded-[10px] bg-[var(--color-secondary-surface)]"
                            />
                          ))}
                        </div>
                      ) : coverPhotoCandidates.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 p-1">
                          {coverPhotoCandidates.map((photo) => {
                            const thumbUrl = resolvePhotoUrl(photo, 'thumb') || resolvePhotoUrl(photo, 'full')

                            return (
                              <button
                                key={photo.id}
                                type="button"
                                className={cn(
                                  'overflow-hidden rounded-[10px] border border-black/8 bg-[var(--color-secondary-surface)] text-left transition-colors',
                                  'focus:outline-none focus:ring-2 focus:ring-black/10',
                                  coverPreference?.photoId === photo.id ||
                                    (!coverPreference?.photoId && selectedCoverPhoto?.id === photo.id)
                                    ? 'border-[rgba(0,0,0,0.18)]'
                                    : 'hover:border-[rgba(0,0,0,0.12)]',
                                )}
                                onClick={() => handlePhotoSelection(photo.id)}
                              >
                                {thumbUrl ? (
                                  <img
                                    src={thumbUrl}
                                    alt={photoAttributionLabel ?? trip.destination_text}
                                    className="aspect-[4/3] h-auto w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex aspect-[4/3] items-center justify-center text-[var(--color-text-muted)]">
                                    <ImageIcon className="size-5" />
                                  </div>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="px-2 py-3">
                          <p className="text-sm text-[var(--color-text-muted)]">
                            {isCoverPhotoBusy
                              ? 'Loading city photos from the backend…'
                              : coverPhotoRefreshError || 'No alternative city photos are available yet.'}
                          </p>
                          {!isCoverPhotoBusy && resolvedPlaceId ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleCoverPhotoRefresh}
                              className="mt-2 h-8 rounded-[8px] px-2 text-[0.84rem] text-[var(--color-text)]"
                            >
                              Retry loading photos
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="border-t border-black/8 px-4 py-3">
              <p className="text-sm font-medium text-[var(--color-text)]">City photo</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {photoAttributionText || 'Destination-based cover photo'}
              </p>
            </div>
          </section>

          <section className={cn(panelClassName, 'p-4')}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[1.65rem] font-medium leading-tight text-[var(--color-text)]">
                  {trip.title}
                </h1>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
                  <MapPin className="size-3.5 shrink-0" />
                  <span className="truncate">{trip.destination_text}</span>
                </p>
              </div>

              {trip.trip_type ? (
                <Badge
                  variant="neutral"
                  className="rounded-full border-black/8 bg-white px-2.5 py-1 text-[0.72rem] font-medium normal-case tracking-normal text-[var(--color-text-muted)]"
                >
                  {formatTripTypeLabel(trip.trip_type)}
                </Badge>
              ) : null}
            </div>

            {!hasShellHeaderActions ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDuplicate}
                  disabled={duplicateTrip.isPending}
                  className="h-8 rounded-[8px] border-black/8 px-3 shadow-none"
                >
                  {duplicateTrip.isPending ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Copy data-icon="inline-start" />
                  )}
                  Duplicate
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="h-8 rounded-[8px] border-black/8 px-3 shadow-none"
                >
                  <Trash2 data-icon="inline-start" />
                  Delete
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="h-8 rounded-[8px] px-3.5 shadow-none hover:shadow-none"
                >
                  <Link to={`/app/trips/${tripId}/plan`}>Open planner</Link>
                </Button>
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 border-t border-black/8 pt-4 sm:grid-cols-2">
              <div>
                <p className={labelClassName}>Dates</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--color-text)]">
                  <Calendar className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
                  <span>
                    {format(new Date(trip.start_date), 'MMM d, yyyy')} -{' '}
                    {format(new Date(trip.end_date), 'MMM d, yyyy')}
                  </span>
                </p>
              </div>

              <div>
                <p className={labelClassName}>Trip length</p>
                <p className="mt-1 text-sm text-[var(--color-text)]">
                  {tripLength ? `${tripLength} day${tripLength !== 1 ? 's' : ''}` : 'Not set'}
                </p>
              </div>

              {trip.budget_amount ? (
                <div>
                  <p className={labelClassName}>Budget</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--color-text)]">
                    <Wallet className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
                    <span>{formatMoney(trip.budget_amount, trip.budget_currency)}</span>
                  </p>
                </div>
              ) : null}

              <div>
                <p className={labelClassName}>Itinerary</p>
                <p className="mt-1 text-sm text-[var(--color-text)]">
                  {daysLoading
                    ? 'Loading…'
                    : days.length > 0
                      ? `${days.length} day${days.length !== 1 ? 's' : ''} planned`
                      : 'No days planned yet'}
                </p>
              </div>

              {offersCount > 0 ? (
                <div className="sm:col-span-2">
                  <p className={labelClassName}>Offers</p>
                  <p className="mt-1 text-sm text-[var(--color-text)]">
                    {offersCount} linked offer{offersCount !== 1 ? 's' : ''}
                  </p>
                </div>
              ) : null}
            </div>

            {trip.preferences.length > 0 ? (
              <div className="mt-5 border-t border-black/8 pt-4">
                <p className={labelClassName}>Preferences</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {trip.preferences.map((preference) => (
                    <span
                      key={preference}
                      className="rounded-full border border-black/8 bg-white px-2.5 py-1 text-sm text-[var(--color-text)]"
                    >
                      {preference}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <section className={panelClassName}>
          <div className="flex items-center justify-between gap-3 border-b border-black/8 px-4 py-3">
            <div>
              <h2 className="text-[1rem] font-medium text-[var(--color-text)]">Itinerary</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {daysLoading
                  ? 'Loading itinerary…'
                  : days.length > 0
                    ? `${days.length} day${days.length !== 1 ? 's' : ''} in the current plan`
                    : 'No itinerary has been generated yet'}
              </p>
            </div>
          </div>

          <div className="p-4">
            {daysLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-28 animate-pulse rounded-[10px] border border-black/8 bg-white"
                  />
                ))}
              </div>
            ) : null}

            {!daysLoading && days.length === 0 ? (
              <div className={cn(cardClassName, 'p-4')}>
                <p className="text-sm text-[var(--color-text)]">
                  Generate the itinerary in the planner to start organizing days and notes.
                </p>
                <div className="mt-3">
                  <Button asChild className="h-9 rounded-[8px] px-3.5 shadow-none hover:shadow-none">
                    <Link to={`/app/trips/${tripId}/plan`}>Open planner</Link>
                  </Button>
                </div>
              </div>
            ) : null}

            {!daysLoading ? (
              <div className="space-y-3">
                {days.map((day, index) => {
                  const dayOffers = offersByDay.get(day.id) ?? []

                  return (
                    <article key={day.id} className={cn(cardClassName, 'p-4')}>
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <h3 className="text-[1rem] font-medium text-[var(--color-text)]">
                            Day {index + 1}
                          </h3>
                          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                            {format(new Date(day.date), 'EEEE, MMM d, yyyy')}
                          </p>
                        </div>

                        {editingDayId !== day.id ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 rounded-[8px] px-3 text-[0.84rem] font-medium text-[var(--color-text-muted)] hover:bg-black/4 hover:text-[var(--color-text)]"
                            onClick={() => {
                              setEditingDayId(day.id)
                              setDayNotesValue(day.notes || '')
                            }}
                          >
                            Edit notes
                          </Button>
                        ) : null}
                      </div>

                      {config.features.offersUI && dayOffers.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {dayOffers.map((offer) => (
                            <Button
                              key={offer.id}
                              asChild
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-[8px] border-black/8 px-3 text-[0.82rem] shadow-none"
                            >
                              <Link to={`/app/trips/${tripId}/offers?dayId=${day.id}`}>
                                {offer.kind === 'lodging' ? (
                                  <Hotel data-icon="inline-start" />
                                ) : (
                                  <Ticket data-icon="inline-start" />
                                )}
                                {offer.title}
                              </Link>
                            </Button>
                          ))}
                        </div>
                      ) : null}

                      {editingDayId === day.id ? (
                        <div className="mt-3 space-y-3">
                          <Textarea
                            value={dayNotesValue}
                            onChange={(event) => setDayNotesValue(event.target.value)}
                            rows={4}
                            className="min-h-24 rounded-[10px] border-black/8 bg-white px-3.5 py-3 text-sm shadow-none focus:border-black/12 focus:ring-4 focus:ring-black/5"
                            placeholder="Notes for this day"
                            autoFocus
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              onClick={() => handleDayNotesSave(day.id)}
                              disabled={patchDay.isPending}
                              className="h-8 rounded-[8px] px-3.5 shadow-none hover:shadow-none"
                            >
                              {patchDay.isPending ? (
                                <Loader2 className="animate-spin" data-icon="inline-start" />
                              ) : null}
                              Save notes
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 rounded-[8px] px-3 text-[0.84rem] font-medium text-[var(--color-text-muted)] hover:bg-black/4 hover:text-[var(--color-text)]"
                              onClick={() => setEditingDayId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                          {day.notes ? (
                            day.notes
                          ) : (
                            <span className="text-[var(--color-text-muted)]">
                              No notes for this day.
                            </span>
                          )}
                        </p>
                      )}
                    </article>
                  )
                })}
              </div>
            ) : null}
          </div>
        </section>
      </WorkspacePage>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trip?</AlertDialogTitle>
            <AlertDialogDescription>
              This action is irreversible. All days, activities, and related planning data for
              {' '}
              &quot;{trip.title}&quot; will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                handleDelete()
              }}
            >
              {deleteTrip.isPending ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : null}
              Delete trip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
