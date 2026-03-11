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
  // Read all stored preferences once on mount (includes cached googlePhotoUrl)
  const storedPrefs = useMemo(
    () => trips.map((trip) => readTripCoverPhotoPreference(trip.id)),
    [trips],
  )

  // Trips that already have a resolved backend placeId stored in localStorage
  const storedPlaceIds = useMemo(
    () =>
      storedPrefs.map((pref) =>
        isBackendPlaceId(pref?.placeId) ? (pref!.placeId ?? null) : null,
      ),
    [storedPrefs],
  )

  // Run autocomplete for ALL trips to obtain Google Place IDs.
  // These are used both for Google Detail photos (primary path) and as a
  // fallback when backend stored photos are unavailable.
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

  // Fetch Google Place Detail for all trips using the autocomplete Google Place ID.
  // autocomplete always returns Google Place IDs (never backend UUIDs), so
  // we can use them directly with getGooglePlaceDetail.
  const googleDetailQueries = useQueries({
    queries: trips.map((trip, i) => {
      const first = autocompleteQueries[i]?.data?.items?.[0]
      // autocomplete items always have Google Place IDs (ChIJ... format)
      const googleId = first?.id && !isBackendPlaceId(first.id) ? first.id : null
      return {
        queryKey: placeKeys.googleRichDetail(googleId ?? `__none_${trip.id}`),
        queryFn: () => getGooglePlaceDetail(googleId!),
        enabled: Boolean(googleId),
        staleTime: 60 * 60 * 1000,
      }
    }),
  })

  // Fetch backend stored photos for trips that have a saved placeId in localStorage.
  // These respect the user's previously chosen photo preference from the detail page.
  const coverPlaceQueries = useQueries({
    queries: trips.map((trip, i) => {
      const placeId = storedPlaceIds[i]
      return {
        queryKey: placeKeys.detail(placeId ?? `__skip_${trip.id}`),
        queryFn: () => getPlace(placeId!),
        enabled: Boolean(placeId),
        staleTime: 5 * 60 * 1000,
      }
    }),
  })

  const coverPhotoQueries = useQueries({
    queries: trips.map((trip, i) => {
      const placeId = storedPlaceIds[i]
      return {
        queryKey: ['place-photos', placeId ?? `__skip_${trip.id}`],
        queryFn: () => listPlacePhotos(placeId!),
        enabled: Boolean(placeId),
        staleTime: 5 * 60 * 1000,
      }
    }),
  })

  // Persist the raw Google photo URL to localStorage so subsequent visits
  // can render the cached cover instantly without waiting for network requests.
  useEffect(() => {
    trips.forEach((trip, i) => {
      if (storedPlaceIds[i]) return // backend photos track — nothing to cache here
      const rawUrl = googleDetailQueries[i]?.data?.photos?.[0]?.image_url
      if (!rawUrl) return
      const cached = storedPrefs[i]?.googlePhotoUrl
      if (cached === rawUrl) return // already up to date
      mergeTripCoverPhotoPreference(trip.id, { googlePhotoUrl: rawUrl })
    })
  }, [trips, storedPlaceIds, storedPrefs, googleDetailQueries])

  return useMemo(() => {
    const coverPreferences = new Map(
      trips.map((trip) => [trip.id, readTripCoverPhotoPreference(trip.id)]),
    )

    return new Map(
      trips.map((trip, i) => {
        // Primary: backend stored photos when the user has previously opened this trip
        // (respects the user's chosen photo preference from the detail page)
        if (storedPlaceIds[i]) {
          const coverPreference = coverPreferences.get(trip.id)
          const coverPlace = coverPlaceQueries[i]?.data
          const coverPhotos = coverPhotoQueries[i]?.data?.items ?? []
          const candidates: CoverPhotoCandidate[] = []

          if (coverPlace?.primary_photo) {
            candidates.push({
              id: coverPlace.primary_photo.id,
              photo: coverPlace.primary_photo,
              isPrimary: true,
            })
          }

          for (const photo of coverPhotos) {
            if (candidates.some((c) => c.id === photo.id)) continue
            candidates.push({ id: photo.id, photo, isPrimary: photo.is_primary })
          }

          const selectedPhoto =
            candidates.find((c) => c.id === coverPreference?.photoId) ??
            candidates.find((c) => c.isPrimary) ??
            candidates[0] ??
            null

          const selectedPhotoUrl =
            resolvePhotoUrl(selectedPhoto?.photo, 'full') ||
            resolvePhotoUrl(selectedPhoto?.photo, 'thumb')

          if (selectedPhotoUrl) {
            return [trip.id, { url: selectedPhotoUrl, isFallback: false } as TripCardCover] as [string, TripCardCover]
          }
          // Fall through to Google photo if backend has no stored photos yet
        }

        // Google Place Detail photo via proxy.
        // Prefer the freshly-fetched URL; fall back to the localStorage-cached raw URL
        // so the photo is visible instantly on subsequent visits without any network wait.
        // resolveMediaUrl prepends the API base URL so the relative path
        // /places/google-photo-asset?name=... is correctly proxied to the backend.
        const freshGoogleUrl = googleDetailQueries[i]?.data?.photos?.[0]?.image_url
        const cachedGoogleUrl = storedPrefs[i]?.googlePhotoUrl
        const googlePhotoUrl = resolveMediaUrl(freshGoogleUrl ?? cachedGoogleUrl)
        if (googlePhotoUrl) {
          return [trip.id, { url: googlePhotoUrl, isFallback: false } as TripCardCover] as [string, TripCardCover]
        }

        return [trip.id, { url: null, isFallback: true } as TripCardCover] as [string, TripCardCover]
      }),
    )
  }, [trips, storedPrefs, storedPlaceIds, googleDetailQueries, coverPlaceQueries, coverPhotoQueries])
}
