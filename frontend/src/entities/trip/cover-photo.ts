export type TripCoverPhotoPreference = {
  placeId?: string | null
  placeLabel?: string | null
  placeLat?: number | null
  placeLng?: number | null
  photoId?: string | null
  assetId?: string | null
  /** Raw relative URL from Google Place Detail (e.g. /places/google-photo-asset?name=...).
   *  Pass through resolveMediaUrl before using as <img src>. */
  googlePhotoUrl?: string | null
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

  const key = getTripCoverPhotoKey(tripId)
  window.localStorage.setItem(key, JSON.stringify(value))
  
  // Dispatch a storage event manually so other hook instances in the same tab can react
  window.dispatchEvent(new StorageEvent('storage', {
    key,
    newValue: JSON.stringify(value),
    storageArea: window.localStorage,
  }))
}

export function mergeTripCoverPhotoPreference(
  tripId: string,
  patch: TripCoverPhotoPreference,
) {
  const current = readTripCoverPhotoPreference(tripId) ?? {}
  writeTripCoverPhotoPreference(tripId, { ...current, ...patch })
}
