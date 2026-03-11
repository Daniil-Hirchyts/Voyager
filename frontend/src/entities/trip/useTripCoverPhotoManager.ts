import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useJob } from '@/entities/job/queries'
import {
  createPlace,
  type DestinationAutocompleteItem,
} from '@/entities/place/api'
import {
  buildPlaceCreateInputFromDestinationSuggestion,
  isBackendPlaceId,
} from '@/entities/place/destination'
import {
  useDestinationAutocomplete,
  usePlace,
} from '@/entities/place/queries'
import { usePlacePhotos } from '@/entities/photo/queries'
import { refreshPlacePhotos } from '@/entities/photo/api'
import {
  mergeTripCoverPhotoPreference,
  readTripCoverPhotoPreference,
  type TripCoverPhotoPreference,
} from './cover-photo'
import type { PlacePhotoSummary, Trip } from '@/shared/api/types'
import { getJobResultErrors, isJobRunning, isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs'
import { resolvePhotoUrl } from '@/shared/lib/media'

export type CoverPhotoCandidate = {
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

export function useTripCoverPhotoManager(tripId: string | undefined, trip: Trip | null | undefined) {
  const [coverPreference, setCoverPreference] = useState<TripCoverPhotoPreference | null>(() =>
    readTripCoverPhotoPreference(tripId),
  )
  const [coverRefreshJobId, setCoverRefreshJobId] = useState<string | null>(null)
  const [isRefreshingCoverPhotos, setIsRefreshingCoverPhotos] = useState(false)
  const [coverPhotoRefreshError, setCoverPhotoRefreshError] = useState<string | null>(null)
  const autoRefreshAttemptedRef = useRef(false)
  const placeProvisioningAttemptedRef = useRef(false)

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
      buildPlaceCreateInputFromDestinationSuggestion(
        inferredDestination as DestinationAutocompleteItem,
      ),
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

  function handlePhotoSelection(photoId: string) {
    if (!tripId) {
      return
    }

    mergeTripCoverPhotoPreference(tripId, { photoId })
    setCoverPreference((current) => ({ ...(current ?? {}), photoId }))
  }

  async function handleCoverPhotoRefresh() {
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

  return {
    coverPreference,
    resolvedPlaceId,
    coverPhotoCandidates,
    selectedCoverPhoto,
    photoAttributionLabel,
    photoAttributionText,
    coverPhotoUrl,
    isCoverPhotoBusy,
    coverPhotoEmptyMessage,
    coverPhotosLoading,
    coverPhotoRefreshError,
    handlePhotoSelection,
    handleCoverPhotoRefresh,
  }
}
