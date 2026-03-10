export type TripCoverPhotoPreference = {
  placeId?: string | null
  placeLabel?: string | null
  photoId?: string | null
}

const TRIP_COVER_PHOTO_PREFIX = 'voyager.trip-cover'

function getTripCoverPhotoKey(tripId: string) {
  return `${TRIP_COVER_PHOTO_PREFIX}:${tripId}`
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function readTripCoverPhotoPreference(tripId: string | null | undefined) {
  if (!tripId || !isBrowser()) {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(getTripCoverPhotoKey(tripId))
    if (!rawValue) {
      return null
    }

    return JSON.parse(rawValue) as TripCoverPhotoPreference
  } catch {
    return null
  }
}

export function writeTripCoverPhotoPreference(
  tripId: string,
  value: TripCoverPhotoPreference,
) {
  if (!isBrowser()) {
    return
  }

  window.localStorage.setItem(getTripCoverPhotoKey(tripId), JSON.stringify(value))
}

export function mergeTripCoverPhotoPreference(
  tripId: string,
  patch: TripCoverPhotoPreference,
) {
  const current = readTripCoverPhotoPreference(tripId) ?? {}
  writeTripCoverPhotoPreference(tripId, { ...current, ...patch })
}
