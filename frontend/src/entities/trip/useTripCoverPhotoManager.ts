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
import { refreshPlacePhotos } from '@/entities/photo/api'
import { usePlacePhotos } from '@/entities/photo/queries'
import { useTripAssets } from '@/entities/trip-asset/queries'
import {
  mergeTripCoverPhotoPreference,
  readTripCoverPhotoPreference,
  type TripCoverPhotoPreference,
} from './cover-photo'
import type { PlacePhotoSummary, Trip, TripAssetResponse } from '@/shared/api/types'
import { getJobResultErrors, isJobRunning, isJobSuccessful, isJobTerminal } from '@/shared/lib/jobs'
import { resolvePhotoUrl } from '@/shared/lib/media'

type CoverPhotoCandidateSource = 'destination' | 'uploaded'

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
  candidateSource: CoverPhotoCandidateSource
  originalFilename?: string | null
}

function mapPrimaryPhotoToCandidate(photo: PlacePhotoSummary): CoverPhotoCandidate {
  return {
    ...photo,
    candidateSource: 'destination',
    isPrimary: true,
    originalFilename: null,
  }
}

function mapUploadedAssetToCandidate(asset: TripAssetResponse): CoverPhotoCandidate | null {
  const imageUrl = asset.download_url || asset.preview_url
  const thumbnailUrl = asset.preview_url || asset.download_url
  if (!imageUrl || !thumbnailUrl) {
    return null
  }

  return {
    id: asset.id,
    source: 'uploaded',
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl,
    display_url: imageUrl,
    display_thumbnail_url: thumbnailUrl,
    license_code: null,
    license_url: null,
    attribution_text: 'Uploaded photo',
    isPrimary: false,
    candidateSource: 'uploaded',
    originalFilename: asset.original_filename,
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
  const uploadedAssetsQuery = useTripAssets(tripId ?? '', null)
  const { data: coverRefreshJob } = useJob(coverRefreshJobId)

  const coverPlace = coverPlaceQuery.data
  const coverPhotosData = coverPhotosQuery.data
  const coverPhotosLoading = coverPhotosQuery.isLoading
  const uploadedPhotoCandidates = useMemo(
    () =>
      (uploadedAssetsQuery.data?.items ?? [])
        .filter((item) => item.kind === 'photo')
        .map(mapUploadedAssetToCandidate)
        .filter((item): item is CoverPhotoCandidate => Boolean(item)),
    [uploadedAssetsQuery.data?.items],
  )
  const uploadedAssetIds = useMemo(
    () => new Set(uploadedPhotoCandidates.map((item) => item.id)),
    [uploadedPhotoCandidates],
  )
  const isCoverRefreshRunning = isJobRunning(coverRefreshJob?.status)
  const isCoverRefreshSuccessful = isJobSuccessful(coverRefreshJob?.status)

  useEffect(() => {
    setCoverPreference(readTripCoverPhotoPreference(tripId))

    const handleStorageChange = (event: StorageEvent) => {
      if (tripId && event.key === `voyager.trip-cover:${tripId}`) {
        setCoverPreference(readTripCoverPhotoPreference(tripId))
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
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

  const destinationPhotoCandidates = useMemo<CoverPhotoCandidate[]>(() => {
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
        candidateSource: 'destination',
        originalFilename: null,
      })
    }

    return candidates
  }, [coverPhotosData?.items, coverPlace?.primary_photo])

  const coverPhotoCandidates = useMemo<CoverPhotoCandidate[]>(
    () => [...uploadedPhotoCandidates, ...destinationPhotoCandidates],
    [destinationPhotoCandidates, uploadedPhotoCandidates],
  )

  const selectedCoverPhoto = useMemo(() => {
    if (coverPhotoCandidates.length === 0) {
      return null
    }

    if (coverPreference?.assetId) {
      const uploadedCandidate = coverPhotoCandidates.find(
        (photo) =>
          photo.id === coverPreference.assetId &&
          photo.candidateSource === 'uploaded',
      )
      if (uploadedCandidate) {
        return uploadedCandidate
      }
    }

    if (coverPreference?.photoId) {
      const destinationCandidate = coverPhotoCandidates.find(
        (photo) =>
          photo.id === coverPreference.photoId &&
          photo.candidateSource === 'destination',
      )
      if (destinationCandidate) {
        return destinationCandidate
      }
    }

    return (
      destinationPhotoCandidates.find((photo) => photo.isPrimary) ??
      destinationPhotoCandidates[0] ??
      uploadedPhotoCandidates[0] ??
      null
    )
  }, [
    coverPhotoCandidates,
    coverPreference?.assetId,
    coverPreference?.photoId,
    destinationPhotoCandidates,
    uploadedPhotoCandidates,
  ])

  useEffect(() => {
    if (
      !resolvedPlaceId ||
      destinationPhotoCandidates.length > 0 ||
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
    coverPhotosLoading,
    destinationPhotoCandidates.length,
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
    if (!tripId || !selectedCoverPhoto) {
      return
    }
    if (coverPreference?.assetId || coverPreference?.photoId) {
      return
    }

    if (selectedCoverPhoto.candidateSource === 'uploaded') {
      mergeTripCoverPhotoPreference(tripId, { assetId: selectedCoverPhoto.id, photoId: null })
      setCoverPreference((current) => ({
        ...(current ?? {}),
        assetId: selectedCoverPhoto.id,
        photoId: null,
      }))
      return
    }

    mergeTripCoverPhotoPreference(tripId, { photoId: selectedCoverPhoto.id, assetId: null })
    setCoverPreference((current) => ({
      ...(current ?? {}),
      photoId: selectedCoverPhoto.id,
      assetId: null,
    }))
  }, [coverPreference?.assetId, coverPreference?.photoId, selectedCoverPhoto, tripId])

  useEffect(() => {
    if (!tripId || !coverPreference?.assetId || uploadedAssetsQuery.isLoading) {
      return
    }
    if (uploadedAssetIds.has(coverPreference.assetId)) {
      return
    }

    mergeTripCoverPhotoPreference(tripId, { assetId: null })
    setCoverPreference((current) =>
      current ? { ...current, assetId: null } : current,
    )
  }, [coverPreference?.assetId, tripId, uploadedAssetIds, uploadedAssetsQuery.isLoading])

  const photoAttributionLabel =
    selectedCoverPhoto?.candidateSource === 'uploaded'
      ? selectedCoverPhoto.originalFilename ?? 'Uploaded cover photo'
      : coverPreference?.placeLabel ?? inferredDestination?.label ?? trip?.destination_text ?? null
  const photoAttributionText =
    selectedCoverPhoto?.candidateSource === 'uploaded'
      ? photoAttributionLabel
      : [photoAttributionLabel, selectedCoverPhoto?.attribution_text]
          .filter((part): part is string => Boolean(part))
          .filter((part, index, parts) =>
            parts.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) === index,
          )
          .join(' · ')
  const coverPhotoUrl = resolvePhotoUrl(selectedCoverPhoto, 'full')
  const isCoverPhotoBusy =
    coverPhotosLoading || isRefreshingCoverPhotos || isCoverRefreshRunning || uploadedAssetsQuery.isLoading
  const coverPhotoEmptyMessage = coverPhotoRefreshError ?? 'No city photo or uploaded cover photo is available yet.'

  function handlePhotoSelection(
    candidateId: string,
    candidateSource: CoverPhotoCandidateSource = 'destination',
  ) {
    if (!tripId) {
      return
    }

    const patch =
      candidateSource === 'uploaded'
        ? { assetId: candidateId, photoId: null }
        : { assetId: null, photoId: candidateId }

    setCoverPreference((current) => ({ ...(current ?? {}), ...patch }))
  }

  function commitPhotoSelection() {
    if (!tripId || !coverPreference) return
    mergeTripCoverPhotoPreference(tripId, {
      assetId: coverPreference.assetId,
      photoId: coverPreference.photoId,
    })
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
    commitPhotoSelection,
    handleCoverPhotoRefresh,
  }
}
