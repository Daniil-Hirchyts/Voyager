import { useEffect, useMemo, useRef, useState } from 'react'
import MapView, { Marker, NavigationControl, type MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ExternalLink, Loader2, MapPin, Search, Sparkles, Target } from 'lucide-react'
import { config } from '@/app/config'
import { usePlaceSearch } from '@/entities/place/queries'
import { cn } from '@/shared/lib/cn'
import type { Place, PlannerActivity, PlannerPlaceSummary } from '@/shared/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type MarkerPlace = PlannerPlaceSummary | Place

interface Props {
  tripId: string
  activities: PlannerActivity[]
  selectedActivityId: string | null
  selectedPlaceId: string | null
  onSelectActivityId: (activityId: string | null) => void
  onSelectPlaceId: (placeId: string | null) => void
  onAssignPlace: (activityId: string, placeId: string) => Promise<void>
  isAssigning: boolean
}

function isPlannerPlace(value: MarkerPlace): value is PlannerPlaceSummary {
  return !('source' in value)
}

function markerPhoto(place: MarkerPlace) {
  return place.primary_photo?.thumbnail_url || place.primary_photo?.image_url || null
}

function markerAddress(place: MarkerPlace) {
  return place.address_text || place.category || 'place'
}

export function PlannerMapView({
  tripId,
  activities,
  selectedActivityId,
  selectedPlaceId,
  onSelectActivityId,
  onSelectPlaceId,
  onAssignPlace,
  isAssigning,
}: Props) {
  const mapRef = useRef<MapRef | null>(null)
  const [searchText, setSearchText] = useState('')

  const plannerPlaces = useMemo(() => {
    const items = new globalThis.Map<string, PlannerPlaceSummary>()
    for (const activity of activities) {
      if (activity.place) {
        items.set(activity.place.id, activity.place)
      }
    }
    return [...items.values()]
  }, [activities])

  const selectedActivity =
    activities.find((activity) => activity.id === selectedActivityId) ?? null

  const { data: searchData, isFetching: isSearching } = usePlaceSearch(
    { q: searchText.trim(), limit: 20, offset: 0 },
    searchText.trim().length >= 2,
  )

  const markerPlaces = useMemo<MarkerPlace[]>(() => {
    if (searchText.trim().length >= 2) {
      return searchData?.items ?? []
    }
    return plannerPlaces
  }, [plannerPlaces, searchData?.items, searchText])

  const selectedPlace =
    markerPlaces.find((place) => place.id === selectedPlaceId) ||
    plannerPlaces.find((place) => place.id === selectedPlaceId) ||
    null

  useEffect(() => {
    if (!selectedPlace && selectedActivity?.place_id) {
      onSelectPlaceId(selectedActivity.place_id)
    }
  }, [onSelectPlaceId, selectedActivity, selectedPlace])

  useEffect(() => {
    const focusPlace = selectedPlace || plannerPlaces[0] || null
    if (
      !focusPlace ||
      focusPlace.lat == null ||
      focusPlace.lon == null ||
      !mapRef.current ||
      !config.map.styleUrl
    ) {
      return
    }

    mapRef.current.flyTo({
      center: [focusPlace.lon, focusPlace.lat],
      zoom: 12.5,
      duration: 900,
    })
  }, [plannerPlaces, selectedPlace])

  const mapCenter = selectedPlace || plannerPlaces[0] || null
  const hasMap = Boolean(config.map.styleUrl)

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[0_20px_60px_rgba(14,25,35,0.08)]">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Planner Map
          </p>
          <p className="mt-2 text-lg font-semibold text-[var(--color-text)]">
            Match each activity to a real place
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Search across saved places, preview their media, and pin the selected place to a planner activity.
          </p>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={`Search ${tripId ? 'places for this trip' : 'places'}`}
              className="h-11 rounded-full border-[var(--color-border)] bg-white pl-10"
            />
          </div>

          {selectedActivity ? (
            <div className="mt-4 rounded-[22px] border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/8 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-primary)]">
                    Selected activity
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">
                    {selectedActivity.title}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelectActivityId(null)}
                >
                  Clear
                </Button>
              </div>

              {selectedPlaceId ? (
                <Button
                  type="button"
                  className="mt-3 w-full"
                  onClick={() => onAssignPlace(selectedActivity.id, selectedPlaceId)}
                  disabled={isAssigning}
                >
                  {isAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Use Selected Place
                </Button>
              ) : (
                <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                  Pick a place from the list or map to attach it to this activity.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-[22px] border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
              Select an activity from the itinerary list below to reassign its place.
            </div>
          )}
        </div>

        {selectedPlace ? (
          <div className="overflow-hidden rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_20px_60px_rgba(14,25,35,0.08)]">
            {markerPhoto(selectedPlace) ? (
              <div
                className="h-44 bg-cover bg-center"
                style={{ backgroundImage: `url(${markerPhoto(selectedPlace)})` }}
              />
            ) : (
              <div className="flex h-44 items-center justify-center bg-[linear-gradient(135deg,rgba(47,111,115,0.12),rgba(197,106,61,0.14))]">
                <MapPin className="h-8 w-8 text-[var(--color-primary)]" />
              </div>
            )}
            <div className="p-5">
              <p className="text-lg font-semibold text-[var(--color-text)]">{selectedPlace.name}</p>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{markerAddress(selectedPlace)}</p>
              {'source' in selectedPlace && selectedPlace.source ? (
                <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                  Source · {selectedPlace.source}
                </p>
              ) : null}
              {isPlannerPlace(selectedPlace) && selectedPlace.photo_count > 0 ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  {selectedPlace.photo_count} licensed photo{selectedPlace.photo_count === 1 ? '' : 's'}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[0_20px_60px_rgba(14,25,35,0.08)]">
          <div className="max-h-[420px] space-y-2 overflow-y-auto p-2">
            {searchText.trim().length >= 2 ? (
              <>
                {isSearching ? (
                  <div className="flex items-center gap-2 rounded-[18px] border border-[var(--color-border)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching places...
                  </div>
                ) : null}
                {(searchData?.items ?? []).map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => onSelectPlaceId(place.id)}
                    className={cn(
                      'w-full rounded-[20px] border px-4 py-3 text-left transition-all',
                      selectedPlaceId === place.id
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/8'
                        : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/35 hover:bg-white',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--color-text)]">{place.name}</p>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          {markerAddress(place)}
                        </p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-[var(--color-text-muted)]" />
                    </div>
                  </button>
                ))}
              </>
            ) : (
              activities.map((activity) => (
                <button
                  key={activity.id}
                  type="button"
                  onClick={() => {
                    onSelectActivityId(activity.id)
                    if (activity.place_id) {
                      onSelectPlaceId(activity.place_id)
                    }
                  }}
                  className={cn(
                    'w-full rounded-[20px] border px-4 py-3 text-left transition-all',
                    selectedActivityId === activity.id
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/8'
                      : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/35 hover:bg-white',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{activity.title}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {activity.place?.name || 'No place attached'}
                      </p>
                    </div>
                    <Target className="mt-0.5 h-4 w-4 text-[var(--color-primary)]" />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[32px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_24px_80px_rgba(14,25,35,0.1)]">
        {hasMap ? (
          <MapView
            ref={mapRef}
            initialViewState={{
              latitude: mapCenter?.lat ?? 41.9028,
              longitude: mapCenter?.lon ?? 12.4964,
              zoom: mapCenter?.lat != null && mapCenter?.lon != null ? 11.5 : 2.5,
            }}
            style={{ width: '100%', height: '760px' }}
            mapStyle={config.map.styleUrl}
          >
            <NavigationControl position="top-right" />
            {markerPlaces
              .filter((place) => place.lat != null && place.lon != null)
              .map((place) => (
                <Marker key={place.id} latitude={place.lat!} longitude={place.lon!}>
                  <button
                    type="button"
                    onClick={() => onSelectPlaceId(place.id)}
                    className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-full border shadow-lg transition-all',
                      selectedPlaceId === place.id
                        ? 'border-white bg-[var(--color-accent)] text-white'
                        : 'border-white/80 bg-[var(--color-primary)] text-white',
                    )}
                    aria-label={`View ${place.name}`}
                  >
                    <MapPin className="h-5 w-5" />
                  </button>
                </Marker>
              ))}
          </MapView>
        ) : (
          <div className="flex h-[760px] flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,rgba(47,111,115,0.1),rgba(197,106,61,0.08))] px-8 text-center">
            <MapPin className="h-8 w-8 text-[var(--color-primary)]" />
            <p className="text-lg font-semibold text-[var(--color-text)]">Map style is not configured</p>
            <p className="max-w-md text-sm text-[var(--color-text-muted)]">
              Add `VITE_MAP_STYLE_URL` to render the embedded Planner map. The place search and assignment flow still works without it.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
