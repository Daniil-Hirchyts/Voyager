import { useEffect, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  autocompleteDestinations,
  getGooglePlaceDetail,
  getPlace,
} from '@/entities/place/api'
import { isBackendPlaceId } from '@/entities/place/destination'
import { placeKeys } from '@/entities/place/queries'
import { listPlacePhotos } from '@/entities/photo/api'
import { getTripAsset } from '@/entities/trip-asset/api'
import { tripAssetKeys } from '@/entities/trip-asset/queries'
import {
  mergeTripCoverPhotoPreference,
  readTripCoverPhotoPreference,
} from '@/entities/trip/cover-photo'
import type { PlacePhoto, PlacePhotoSummary, Trip } from '@/shared/api/types'
import { resolveMediaUrl, resolvePhotoUrl } from '@/shared/lib/media'

type CoverPhotoCandidate = {
  id: string
  photo: PlacePhoto | PlacePhotoSummary
  isPrimary: boolean
}

export type TripCardCover = {
  url: string | null
  isFallback: boolean
}

export function useTripListCoverPhotos(trips: Trip[]): Map<string, TripCardCover> {
  const storedPrefs = useMemo(
    () => trips.map((trip) => readTripCoverPhotoPreference(trip.id)),
    [trips],
  )

  const storedPlaceIds = useMemo(
    () =>
      storedPrefs.map((pref) =>
        isBackendPlaceId(pref?.placeId) ? (pref?.placeId ?? null) : null,
      ),
    [storedPrefs],
  )

  const coverAssetQueries = useQueries({
    queries: trips.map((trip, index) => {
      const assetId = storedPrefs[index]?.assetId ?? null
      return {
        queryKey: tripAssetKeys.detail(assetId ?? `__skip_${trip.id}`),
        queryFn: () => getTripAsset(assetId!),
        enabled: Boolean(assetId),
        staleTime: 5 * 60 * 1000,
        retry: false,
      }
    }),
  })

  const autocompleteQueries = useQueries({
    queries: trips.map((trip) => {
      const q = trip.destination_text.trim()
      return {
        queryKey: placeKeys.autocomplete({ q, limit: 1, offset: 0 }),
        queryFn: () => autocompleteDestinations({ q, limit: 1, offset: 0 }),
        enabled: q.length >= 2,
        staleTime: 10 * 60 * 1000,
      }
    }),
  })

  const googleDetailQueries = useQueries({
    queries: trips.map((trip, index) => {
      const first = autocompleteQueries[index]?.data?.items?.[0]
      const googleId = first?.id && !isBackendPlaceId(first.id) ? first.id : null
      return {
        queryKey: placeKeys.googleRichDetail(googleId ?? `__none_${trip.id}`),
        queryFn: () => getGooglePlaceDetail(googleId!),
        enabled: Boolean(googleId),
        staleTime: 60 * 60 * 1000,
      }
    }),
  })

  const coverPlaceQueries = useQueries({
    queries: trips.map((trip, index) => {
      const placeId = storedPlaceIds[index]
      return {
        queryKey: placeKeys.detail(placeId ?? `__skip_${trip.id}`),
        queryFn: () => getPlace(placeId!),
        enabled: Boolean(placeId),
        staleTime: 5 * 60 * 1000,
      }
    }),
  })

  const coverPhotoQueries = useQueries({
    queries: trips.map((trip, index) => {
      const placeId = storedPlaceIds[index]
      return {
        queryKey: ['place-photos', placeId ?? `__skip_${trip.id}`],
        queryFn: () => listPlacePhotos(placeId!),
        enabled: Boolean(placeId),
        staleTime: 5 * 60 * 1000,
      }
    }),
  })

  useEffect(() => {
    trips.forEach((trip, index) => {
      if (storedPlaceIds[index]) {
        return
      }
      const rawUrl = googleDetailQueries[index]?.data?.photos?.[0]?.image_url
      if (!rawUrl) {
        return
      }
      const cached = storedPrefs[index]?.googlePhotoUrl
      if (cached === rawUrl) {
        return
      }
      mergeTripCoverPhotoPreference(trip.id, { googlePhotoUrl: rawUrl })
    })
  }, [googleDetailQueries, storedPlaceIds, storedPrefs, trips])

  return useMemo(() => {
    const coverPreferences = new Map(
      trips.map((trip) => [trip.id, readTripCoverPhotoPreference(trip.id)]),
    )

    return new Map(
      trips.map((trip, index) => {
        const coverPreference = coverPreferences.get(trip.id)
        const uploadedAsset = coverPreference?.assetId
          ? coverAssetQueries[index]?.data
          : null
        const uploadedCoverUrl = resolveMediaUrl(
          uploadedAsset?.download_url ?? uploadedAsset?.preview_url,
        )

        if (uploadedCoverUrl) {
          return [trip.id, { url: uploadedCoverUrl, isFallback: false } as TripCardCover] as [
            string,
            TripCardCover,
          ]
        }

        if (storedPlaceIds[index]) {
          const coverPlace = coverPlaceQueries[index]?.data
          const coverPhotos = coverPhotoQueries[index]?.data?.items ?? []
          const candidates: CoverPhotoCandidate[] = []

          if (coverPlace?.primary_photo) {
            candidates.push({
              id: coverPlace.primary_photo.id,
              photo: coverPlace.primary_photo,
              isPrimary: true,
            })
          }

          for (const photo of coverPhotos) {
            if (candidates.some((candidate) => candidate.id === photo.id)) {
              continue
            }
            candidates.push({ id: photo.id, photo, isPrimary: photo.is_primary })
          }

          const selectedPhoto =
            candidates.find((candidate) => candidate.id === coverPreference?.photoId) ??
            candidates.find((candidate) => candidate.isPrimary) ??
            candidates[0] ??
            null

          const selectedPhotoUrl =
            resolvePhotoUrl(selectedPhoto?.photo, 'full') ||
            resolvePhotoUrl(selectedPhoto?.photo, 'thumb')

          if (selectedPhotoUrl) {
            return [trip.id, { url: selectedPhotoUrl, isFallback: false } as TripCardCover] as [
              string,
              TripCardCover,
            ]
          }
        }

        const freshGoogleUrl = googleDetailQueries[index]?.data?.photos?.[0]?.image_url
        const cachedGoogleUrl = storedPrefs[index]?.googlePhotoUrl
        const googlePhotoUrl = resolveMediaUrl(freshGoogleUrl ?? cachedGoogleUrl)
        if (googlePhotoUrl) {
          return [trip.id, { url: googlePhotoUrl, isFallback: false } as TripCardCover] as [
            string,
            TripCardCover,
          ]
        }

        return [trip.id, { url: null, isFallback: true } as TripCardCover] as [
          string,
          TripCardCover,
        ]
      }),
    )
  }, [
    coverAssetQueries,
    coverPhotoQueries,
    coverPlaceQueries,
    googleDetailQueries,
    storedPlaceIds,
    storedPrefs,
    trips,
  ])
}
