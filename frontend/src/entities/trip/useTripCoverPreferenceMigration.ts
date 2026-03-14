import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { plannerKeys } from '@/entities/planner/queries'
import { isApiError } from '@/shared/api/client'
import {
  readTripCoverPhotoPreference,
  removeTripCoverPhotoPreference,
  toTripCoverPreferencePatch,
} from './cover-photo'
import { patchTripCoverPreference } from './api'
import { tripKeys } from './queries'
import type { Trip } from '@/shared/api/types'

const migratedTripIds = new Set<string>()
const pendingTripIds = new Set<string>()

export function useTripCoverPreferenceMigration(trips: Trip[]) {
  const qc = useQueryClient()

  useEffect(() => {
    trips.forEach((trip) => {
      if (!trip.id || trip.coverPreference || migratedTripIds.has(trip.id) || pendingTripIds.has(trip.id)) {
        return
      }

      const legacyPatch = toTripCoverPreferencePatch(readTripCoverPhotoPreference(trip.id))
      if (!legacyPatch) {
        return
      }

      pendingTripIds.add(trip.id)
      void patchTripCoverPreference(trip.id, legacyPatch)
        .then((nextTrip) => {
          migratedTripIds.add(trip.id)
          qc.setQueryData(tripKeys.detail(trip.id), nextTrip)
          qc.invalidateQueries({ queryKey: tripKeys.all })
          qc.invalidateQueries({ queryKey: plannerKeys.detail(trip.id) })
        })
        .catch((error) => {
          if (isApiError(error) && (error.status === 404 || error.status === 422)) {
            migratedTripIds.add(trip.id)
            removeTripCoverPhotoPreference(trip.id)
          }
        })
        .finally(() => {
          pendingTripIds.delete(trip.id)
        })
    })
  }, [qc, trips])
}
