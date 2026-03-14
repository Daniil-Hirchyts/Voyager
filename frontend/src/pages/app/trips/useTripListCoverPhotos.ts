import { useMemo } from 'react'
import { useTripCoverPreferenceMigration } from '@/entities/trip/useTripCoverPreferenceMigration'
import type { Trip } from '@/shared/api/types'
import { resolveMediaUrl } from '@/shared/lib/media'

export type TripCardCover = {
  url: string | null
  isFallback: boolean
}

export function useTripListCoverPhotos(trips: Trip[]): Map<string, TripCardCover> {
  useTripCoverPreferenceMigration(trips)

  return useMemo(
    () =>
      new Map(
        trips.map((trip) => [
          trip.id,
          {
            url: resolveMediaUrl(
              trip.coverPhoto?.thumbnailUrl ??
                trip.coverPhoto?.url ??
                trip.coverPreference?.fallbackImageUrl ??
                null,
            ),
            isFallback: trip.coverPhoto?.isFallback ?? true,
          } satisfies TripCardCover,
        ]),
      ),
    [trips],
  )
}
