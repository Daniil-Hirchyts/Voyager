import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useJob } from '@/entities/job/queries';
import { createPlace, type DestinationAutocompleteItem } from '@/entities/place/api';
import {
  buildPlaceCreateInputFromDestinationSuggestion,
  isBackendPlaceId,
} from '@/entities/place/destination';
import { useDestinationAutocomplete, usePlace } from '@/entities/place/queries';
import { refreshPlacePhotos } from '@/entities/photo/api';
import { usePlacePhotos } from '@/entities/photo/queries';
import { usePatchTripCoverPreference } from '@/entities/trip/queries';
import { useTripAssets } from '@/entities/trip-asset/queries';
import { useTripCoverPreferenceMigration } from './useTripCoverPreferenceMigration';
import type {
  PlacePhotoSummary,
  Trip,
  TripAssetResponse,
  TripCoverPreference,
} from '@/shared/api/types';
import {
  getJobResultErrors,
  isJobRunning,
  isJobSuccessful,
  isJobTerminal,
} from '@/shared/lib/jobs';
import { resolveMediaUrl, resolvePhotoUrl } from '@/shared/lib/media';

type CoverPhotoCandidateSource = 'destination' | 'uploaded';

export type CoverPhotoCandidate = {
  id: string;
  source: string;
  image_url: string;
  thumbnail_url: string | null;
  display_url?: string | null;
  display_thumbnail_url?: string | null;
  license_code: string | null;
  license_url: string | null;
  attribution_text: string | null;
  isPrimary?: boolean;
  candidateSource: CoverPhotoCandidateSource;
  originalFilename?: string | null;
};

function mapPrimaryPhotoToCandidate(photo: PlacePhotoSummary): CoverPhotoCandidate {
  return {
    ...photo,
    candidateSource: 'destination',
    isPrimary: true,
    originalFilename: null,
  };
}

function mapUploadedAssetToCandidate(asset: TripAssetResponse): CoverPhotoCandidate | null {
  const imageUrl = asset.download_url || asset.preview_url;
  const thumbnailUrl = asset.preview_url || asset.download_url;
  if (!imageUrl || !thumbnailUrl) {
    return null;
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
  };
}

function getCoverPhotoRefreshErrorMessage(
  job:
    | {
        result?: Record<string, unknown> | null;
        error?: unknown;
      }
    | null
    | undefined,
) {
  const firstError = getJobResultErrors(job as never)[0];
  const providerMessage =
    typeof firstError === 'string'
      ? firstError
      : firstError && typeof firstError === 'object' && 'message' in firstError
        ? String(firstError.message)
        : job?.error && typeof job.error === 'object' && job.error && 'message' in job.error
          ? String(job.error.message)
          : null;

  if (providerMessage?.toLowerCase().includes('no licensed place photos found')) {
    return 'No licensed city photos are available for this destination yet.';
  }

  return providerMessage || 'City photos could not be loaded right now.';
}

function areCoverPreferencesEqual(
  left: TripCoverPreference | null | undefined,
  right: TripCoverPreference | null | undefined,
) {
  return (
    (left?.placeId ?? null) === (right?.placeId ?? null) &&
    (left?.placeLabel ?? null) === (right?.placeLabel ?? null) &&
    (left?.placeLat ?? null) === (right?.placeLat ?? null) &&
    (left?.placeLng ?? null) === (right?.placeLng ?? null) &&
    (left?.photoId ?? null) === (right?.photoId ?? null) &&
    (left?.assetId ?? null) === (right?.assetId ?? null) &&
    (left?.fallbackImageUrl ?? null) === (right?.fallbackImageUrl ?? null)
  );
}

export function useTripCoverPhotoManager(
  tripId: string | undefined,
  trip: Trip | null | undefined,
) {
  useTripCoverPreferenceMigration(trip ? [trip] : []);

  const [coverPreference, setCoverPreference] = useState<TripCoverPreference | null>(
    () => trip?.coverPreference ?? null,
  );
  const [coverRefreshJobId, setCoverRefreshJobId] = useState<string | null>(null);
  const [isRefreshingCoverPhotos, setIsRefreshingCoverPhotos] = useState(false);
  const [coverPhotoRefreshError, setCoverPhotoRefreshError] = useState<string | null>(null);
  const autoRefreshAttemptedRef = useRef(false);
  const placeProvisioningAttemptedRef = useRef(false);
  const patchCoverPreference = usePatchTripCoverPreference(tripId ?? '');

  useEffect(() => {
    setCoverPreference(trip?.coverPreference ?? null);
  }, [trip?.coverPreference]);

  const destinationLookup = trip?.destination_text.trim() ?? '';
  const storedBackendPlaceId = isBackendPlaceId(coverPreference?.placeId)
    ? (coverPreference?.placeId ?? null)
    : null;
  const destinationSearch = useDestinationAutocomplete(
    { q: destinationLookup, limit: 4, offset: 0 },
    Boolean(trip && destinationLookup.length >= 2 && !storedBackendPlaceId),
  );
  const inferredDestination = destinationSearch.data?.items?.[0] ?? null;
  const resolvedPlaceId: string | null =
    storedBackendPlaceId ??
    (isBackendPlaceId(inferredDestination?.id) ? (inferredDestination?.id ?? null) : null);

  const coverPlaceQuery = usePlace(resolvedPlaceId);
  const coverPhotosQuery = usePlacePhotos(resolvedPlaceId);
  const uploadedAssetsQuery = useTripAssets(tripId ?? '', null);
  const { data: coverRefreshJob } = useJob(coverRefreshJobId);

  const coverPlace = coverPlaceQuery.data;
  const coverPhotosData = coverPhotosQuery.data;
  const coverPhotosLoading = coverPhotosQuery.isLoading;
  const buildCoverPreferenceDraft = (
    current: TripCoverPreference | null | undefined,
  ): TripCoverPreference => ({
    placeId: current?.placeId ?? trip?.coverPreference?.placeId ?? resolvedPlaceId ?? null,
    placeLabel:
      current?.placeLabel ??
      trip?.coverPreference?.placeLabel ??
      coverPlace?.address_text ??
      coverPlace?.name ??
      inferredDestination?.label ??
      trip?.destination_text ??
      null,
    placeLat:
      current?.placeLat ??
      trip?.coverPreference?.placeLat ??
      coverPlace?.lat ??
      inferredDestination?.lat ??
      null,
    placeLng:
      current?.placeLng ??
      trip?.coverPreference?.placeLng ??
      coverPlace?.lon ??
      inferredDestination?.lon ??
      null,
    photoId: current?.photoId ?? trip?.coverPreference?.photoId ?? null,
    assetId: current?.assetId ?? trip?.coverPreference?.assetId ?? null,
    fallbackImageUrl:
      current?.fallbackImageUrl ??
      trip?.coverPreference?.fallbackImageUrl ??
      (trip?.coverPhoto?.isFallback ? trip.coverPhoto.url : null) ??
      null,
  });
  const uploadedPhotoCandidates = useMemo(
    () =>
      (uploadedAssetsQuery.data?.items ?? [])
        .filter((item) => item.kind === 'photo')
        .map(mapUploadedAssetToCandidate)
        .filter((item): item is CoverPhotoCandidate => Boolean(item)),
    [uploadedAssetsQuery.data?.items],
  );
  const isCoverRefreshRunning = isJobRunning(coverRefreshJob?.status);
  const isCoverRefreshSuccessful = isJobSuccessful(coverRefreshJob?.status);

  useEffect(() => {
    autoRefreshAttemptedRef.current = false;
    setCoverRefreshJobId(null);
    setIsRefreshingCoverPhotos(false);
    setCoverPhotoRefreshError(null);
    placeProvisioningAttemptedRef.current = false;
  }, [resolvedPlaceId]);

  useEffect(() => {
    if (!tripId || !inferredDestination || !isBackendPlaceId(inferredDestination.id)) {
      return;
    }

    const nextPreference: TripCoverPreference = {
      placeId: inferredDestination.id,
      placeLabel: coverPreference?.placeLabel ?? inferredDestination.label,
      placeLat: coverPreference?.placeLat ?? inferredDestination.lat ?? null,
      placeLng: coverPreference?.placeLng ?? inferredDestination.lon ?? null,
      photoId: coverPreference?.photoId ?? null,
      assetId: coverPreference?.assetId ?? null,
      fallbackImageUrl: coverPreference?.fallbackImageUrl ?? null,
    };

    if (areCoverPreferencesEqual(coverPreference, nextPreference)) {
      return;
    }

    setCoverPreference(nextPreference);
    void patchCoverPreference.mutateAsync(nextPreference).catch(() => undefined);
  }, [coverPreference, inferredDestination, patchCoverPreference, tripId]);

  useEffect(() => {
    if (
      !tripId ||
      !inferredDestination ||
      storedBackendPlaceId ||
      isBackendPlaceId(inferredDestination.id) ||
      placeProvisioningAttemptedRef.current
    ) {
      return;
    }

    placeProvisioningAttemptedRef.current = true;

    void createPlace(
      buildPlaceCreateInputFromDestinationSuggestion(
        inferredDestination as DestinationAutocompleteItem,
      ),
      `trip-cover-place-${tripId}`,
    )
      .then(async (place) => {
        const nextPreference: TripCoverPreference = {
          placeId: place.id,
          placeLabel: inferredDestination.label,
          placeLat: place.lat ?? inferredDestination.lat ?? null,
          placeLng: place.lon ?? inferredDestination.lon ?? null,
          photoId: null,
          assetId: coverPreference?.assetId ?? null,
          fallbackImageUrl: coverPreference?.fallbackImageUrl ?? null,
        };

        setCoverPreference(nextPreference);
        await patchCoverPreference.mutateAsync(nextPreference);
      })
      .catch(() => {
        placeProvisioningAttemptedRef.current = false;
      });
  }, [
    coverPreference?.assetId,
    coverPreference?.fallbackImageUrl,
    inferredDestination,
    patchCoverPreference,
    storedBackendPlaceId,
    tripId,
  ]);

  const destinationPhotoCandidates = useMemo<CoverPhotoCandidate[]>(() => {
    const candidates: CoverPhotoCandidate[] = [];

    if (coverPlace?.primary_photo) {
      candidates.push(mapPrimaryPhotoToCandidate(coverPlace.primary_photo));
    }

    for (const photo of coverPhotosData?.items ?? []) {
      if (candidates.some((candidate) => candidate.id === photo.id)) {
        continue;
      }

      candidates.push({
        ...photo,
        display_url: undefined,
        display_thumbnail_url: undefined,
        isPrimary: photo.is_primary,
        candidateSource: 'destination',
        originalFilename: null,
      });
    }

    return candidates;
  }, [coverPhotosData?.items, coverPlace?.primary_photo]);

  const coverPhotoCandidates = useMemo<CoverPhotoCandidate[]>(
    () => [...uploadedPhotoCandidates, ...destinationPhotoCandidates],
    [destinationPhotoCandidates, uploadedPhotoCandidates],
  );
  const preferredAssetId = coverPreference?.assetId ?? trip?.coverPhoto?.assetId ?? null;
  const preferredPhotoId = coverPreference?.photoId ?? trip?.coverPhoto?.photoId ?? null;

  const selectedCoverPhoto = useMemo(() => {
    if (preferredAssetId) {
      const uploadedCandidate = coverPhotoCandidates.find(
        (photo) => photo.id === preferredAssetId && photo.candidateSource === 'uploaded',
      );
      if (uploadedCandidate) {
        return uploadedCandidate;
      }
    }

    if (preferredPhotoId) {
      const destinationCandidate = coverPhotoCandidates.find(
        (photo) => photo.id === preferredPhotoId && photo.candidateSource === 'destination',
      );
      if (destinationCandidate) {
        return destinationCandidate;
      }
    }

    return (
      destinationPhotoCandidates.find((photo) => photo.isPrimary) ??
      destinationPhotoCandidates[0] ??
      uploadedPhotoCandidates[0] ??
      null
    );
  }, [
    coverPhotoCandidates,
    destinationPhotoCandidates,
    preferredAssetId,
    preferredPhotoId,
    uploadedPhotoCandidates,
  ]);

  useEffect(() => {
    if (
      !resolvedPlaceId ||
      destinationPhotoCandidates.length > 0 ||
      coverPhotosLoading ||
      isRefreshingCoverPhotos ||
      isCoverRefreshRunning ||
      autoRefreshAttemptedRef.current
    ) {
      return;
    }

    autoRefreshAttemptedRef.current = true;

    setIsRefreshingCoverPhotos(true);
    setCoverPhotoRefreshError(null);
    void refreshPlacePhotos(resolvedPlaceId, `trip-cover-photo-${resolvedPlaceId}-${Date.now()}`)
      .then((accepted) => {
        setCoverRefreshJobId(accepted.job_id);
      })
      .catch(() => {
        setIsRefreshingCoverPhotos(false);
        setCoverPhotoRefreshError('City photos could not be loaded right now.');
        toast.error('Failed to load city photos');
      });
  }, [
    coverPhotosLoading,
    destinationPhotoCandidates.length,
    isCoverRefreshRunning,
    isRefreshingCoverPhotos,
    resolvedPlaceId,
  ]);

  useEffect(() => {
    if (!isCoverRefreshSuccessful) {
      return;
    }

    setCoverRefreshJobId(null);
    setIsRefreshingCoverPhotos(false);
    setCoverPhotoRefreshError(null);
    void coverPlaceQuery.refetch();
    void coverPhotosQuery.refetch();
  }, [coverPhotosQuery, coverPlaceQuery, isCoverRefreshSuccessful]);

  useEffect(() => {
    if (!coverRefreshJobId || !coverRefreshJob?.status || !isJobTerminal(coverRefreshJob.status)) {
      return;
    }

    if (isCoverRefreshSuccessful) {
      return;
    }

    const message = getCoverPhotoRefreshErrorMessage(coverRefreshJob);

    setCoverRefreshJobId(null);
    setIsRefreshingCoverPhotos(false);
    setCoverPhotoRefreshError(message);
    void coverPlaceQuery.refetch();
    void coverPhotosQuery.refetch();
  }, [
    coverPhotosQuery,
    coverPlaceQuery,
    coverRefreshJob,
    coverRefreshJobId,
    isCoverRefreshSuccessful,
  ]);

  const photoAttributionLabel =
    selectedCoverPhoto?.candidateSource === 'uploaded'
      ? (selectedCoverPhoto.originalFilename ?? 'Uploaded cover photo')
      : (coverPreference?.placeLabel ??
        trip?.coverPreference?.placeLabel ??
        trip?.destination_text ??
        null);
  const photoAttributionText =
    selectedCoverPhoto?.candidateSource === 'uploaded'
      ? photoAttributionLabel
      : [
          photoAttributionLabel,
          selectedCoverPhoto?.attribution_text ?? trip?.coverPhoto?.attributionText,
        ]
          .filter((part): part is string => Boolean(part))
          .filter(
            (part, index, parts) =>
              parts.findIndex((candidate) => candidate.toLowerCase() === part.toLowerCase()) ===
              index,
          )
          .join(' · ');
  const coverPhotoUrl =
    resolvePhotoUrl(selectedCoverPhoto, 'full') ||
    resolvePhotoUrl(selectedCoverPhoto, 'thumb') ||
    resolveMediaUrl(
      trip?.coverPhoto?.url ??
        trip?.coverPhoto?.thumbnailUrl ??
        trip?.coverPreference?.fallbackImageUrl ??
        null,
    );
  const isCoverPhotoBusy =
    coverPhotosLoading ||
    isRefreshingCoverPhotos ||
    isCoverRefreshRunning ||
    uploadedAssetsQuery.isLoading ||
    patchCoverPreference.isPending;
  const coverPhotoEmptyMessage =
    coverPhotoRefreshError ?? 'No city photo or uploaded cover photo is available yet.';

  function handlePhotoSelection(
    candidateId: string,
    candidateSource: CoverPhotoCandidateSource = 'destination',
  ) {
    setCoverPreference((current) => {
      const next = buildCoverPreferenceDraft(current);

      if (candidateSource === 'uploaded') {
        return { ...next, assetId: candidateId, photoId: null };
      }

      return { ...next, assetId: null, photoId: candidateId };
    });
  }

  async function commitPhotoSelection() {
    const nextCoverPreference = buildCoverPreferenceDraft(coverPreference);

    if (!tripId || areCoverPreferencesEqual(nextCoverPreference, trip?.coverPreference)) {
      return;
    }

    setCoverPreference(nextCoverPreference);
    await patchCoverPreference.mutateAsync(nextCoverPreference);
  }

  async function handleCoverPhotoRefresh() {
    if (!resolvedPlaceId) {
      return;
    }

    try {
      setIsRefreshingCoverPhotos(true);
      setCoverPhotoRefreshError(null);
      const accepted = await refreshPlacePhotos(
        resolvedPlaceId,
        `trip-cover-photo-${resolvedPlaceId}-${Date.now()}`,
      );
      setCoverRefreshJobId(accepted.job_id);
    } catch {
      setIsRefreshingCoverPhotos(false);
      setCoverPhotoRefreshError('City photos could not be loaded right now.');
      toast.error('Failed to load city photos');
    }
  }

  return {
    coverPreference,
    resolvedPlaceId,
    coverPlace,
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
  };
}
