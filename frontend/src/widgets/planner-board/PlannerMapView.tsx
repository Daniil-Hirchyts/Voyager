import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Loader2, Search, Sparkles, Target } from 'lucide-react'
import { config } from '@/app/config'
import { usePlaceSearch } from '@/entities/place/queries'
import { useTripMapLayers } from '@/entities/trip-map-layer/queries'
import { cn } from '@/shared/lib/cn'
import { resolvePhotoUrl } from '@/shared/lib/media'
import {
  GoogleMapCanvas,
  MapPanTo,
  TripMapLayerRenderer,
  VoyagerInfoWindow,
  VoyagerMarker,
} from '@/shared/layouts/google-maps'
import type { Place, PlannerActivity, PlannerPlaceSummary } from '@/shared/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlannerInbox } from './PlannerInbox'

type MarkerPlace = PlannerPlaceSummary | Place

interface Props {
  tripId: string
  activities: PlannerActivity[]
  inboxActivities: PlannerActivity[]
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
  return resolvePhotoUrl(place.primary_photo, 'thumb')
}

function markerAddress(place: MarkerPlace) {
  return place.address_text || place.category || 'place'
}

export function PlannerMapView({
  tripId,
  activities,
  inboxActivities,
  selectedActivityId,
  selectedPlaceId,
  onSelectActivityId,
  onSelectPlaceId,
  onAssignPlace,
  isAssigning,
}: Props) {
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
  const { data: tripLayersData } = useTripMapLayers(tripId)

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
  const tripLayers = tripLayersData?.items ?? []
  const mapPlaces = markerPlaces.filter((place) => place.lat != null && place.lon != null)

  useEffect(() => {
    if (!selectedPlace && selectedActivity?.place_id) {
      onSelectPlaceId(selectedActivity.place_id)
    }
  }, [onSelectPlaceId, selectedActivity, selectedPlace])

  const mapCenter = selectedPlace || plannerPlaces[0] || null
  const hasMap = Boolean(config.map.apiKey)

  return (
    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-4">
        <PlannerInbox
          activities={inboxActivities}
          selectedActivityId={selectedActivityId}
          className="min-h-[220px]"
          onSelectActivity={(activity) => {
            onSelectActivityId(activity.id)
            if (activity.place_id) {
              onSelectPlaceId(activity.place_id)
            }
          }}
        />

        <div className="rounded-[12px] border border-black/8 bg-white p-4">
          <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">
            Place matching
          </p>
          <p className="mt-2 text-[1.05rem] font-medium text-[var(--color-text)]">
            Match each activity to a real place
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Search saved places and attach the selected result to the current activity.
          </p>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={`Search ${tripId ? 'places for this trip' : 'places'}`}
              className="h-10 rounded-[8px] border-black/8 bg-white pl-10"
            />
          </div>

          {selectedActivity ? (
            <div className="mt-4 rounded-[10px] border border-black/8 bg-[var(--color-secondary-surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">
                    Selected activity
                  </p>
                  <p className="mt-1 text-sm font-medium text-[var(--color-text)]">
                    {selectedActivity.title}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelectActivityId(null)}
                  className="h-8 rounded-[8px] px-2.5 text-[0.84rem] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  Clear
                </Button>
              </div>

              {selectedPlaceId ? (
                <Button
                  type="button"
                  className="mt-3 h-9 w-full rounded-[8px] shadow-none hover:shadow-none"
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
            <div className="mt-4 rounded-[10px] border border-dashed border-black/8 p-4 text-sm text-[var(--color-text-muted)]">
              Select an activity from the itinerary list below to reassign its place.
            </div>
          )}
        </div>

        {selectedPlace ? (
          <div className="overflow-hidden rounded-[12px] border border-black/8 bg-white">
            {markerPhoto(selectedPlace) ? (
              <div
                className="h-44 bg-cover bg-center"
                style={{ backgroundImage: `url(${resolvePhotoUrl(selectedPlace.primary_photo, 'full')})` }}
              />
            ) : (
              <div className="flex h-44 items-center justify-center bg-[var(--color-secondary-surface)]">
                <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white text-[var(--color-text-muted)]">P</div>
              </div>
            )}
            <div className="p-4">
              <p className="text-[1.05rem] font-medium text-[var(--color-text)]">{selectedPlace.name}</p>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{markerAddress(selectedPlace)}</p>
              {'source' in selectedPlace && selectedPlace.source ? (
                <p className="mt-2 text-[0.72rem] text-[var(--color-text-muted)]">
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

        <div className="flex min-h-0 flex-1 flex-col rounded-[12px] border border-black/8 bg-white p-3">
          <div className="min-h-0 space-y-2 overflow-y-auto p-2">
            {searchText.trim().length >= 2 ? (
              <>
                {isSearching ? (
                  <div className="flex items-center gap-2 rounded-[8px] border border-black/8 px-3 py-3 text-sm text-[var(--color-text-muted)]">
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
                      'w-full rounded-[10px] border border-black/8 px-4 py-3 text-left transition-colors',
                      selectedPlaceId === place.id
                        ? 'bg-[var(--color-secondary-surface)]'
                        : 'hover:bg-[var(--color-secondary-surface)]',
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
                    'w-full rounded-[10px] border border-black/8 px-4 py-3 text-left transition-colors',
                    selectedActivityId === activity.id
                      ? 'bg-[var(--color-secondary-surface)]'
                      : 'hover:bg-[var(--color-secondary-surface)]',
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

      <div className="h-full min-h-[20rem] overflow-hidden rounded-[12px] border border-black/8 bg-white xl:min-h-0">
        {hasMap ? (
          <GoogleMapCanvas
            defaultCenter={{
              lat: mapCenter?.lat ?? 41.9028,
              lng: mapCenter?.lon ?? 12.4964,
            }}
            defaultZoom={mapCenter?.lat != null && mapCenter?.lon != null ? 11.5 : 2.5}
            style={{ width: '100%', height: '100%' }}
            disableDefaultUI={false}
            streetViewControl={false}
            mapTypeControl={false}
            fullscreenControl={false}
          >
            <MapPanTo
              point={
                mapCenter?.lat != null && mapCenter?.lon != null
                  ? { lat: mapCenter.lat, lng: mapCenter.lon }
                  : null
              }
              zoom={mapCenter?.lat != null && mapCenter?.lon != null ? 12 : 3}
            />
            <TripMapLayerRenderer layers={tripLayers} />
            {mapPlaces
              .filter((place) => place.id !== selectedPlaceId)
              .map((place) => (
                <VoyagerMarker
                  key={place.id}
                  position={{ lat: place.lat!, lng: place.lon! }}
                  title={place.name}
                  color="#17344C"
                  onClick={() => onSelectPlaceId(place.id)}
                  zIndex={1}
                />
              ))}
            {selectedPlace?.lat != null && selectedPlace?.lon != null ? (
              <>
                <VoyagerMarker
                  position={{ lat: selectedPlace.lat, lng: selectedPlace.lon }}
                  title={selectedPlace.name}
                  label={selectedPlace.name.length <= 20 ? selectedPlace.name : undefined}
                  selected
                  onClick={() => onSelectPlaceId(selectedPlace.id)}
                  zIndex={3}
                />
                <VoyagerInfoWindow
                  position={{ lat: selectedPlace.lat, lng: selectedPlace.lon }}
                  onCloseClick={() => onSelectPlaceId(null)}
                >
                  <div className="max-w-[220px]">
                    <p className="text-sm font-semibold text-[var(--color-text)]">{selectedPlace.name}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{markerAddress(selectedPlace)}</p>
                  </div>
                </VoyagerInfoWindow>
              </>
            ) : null}
          </GoogleMapCanvas>
        ) : (
          <div className="flex h-full min-h-[20rem] flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,rgba(114,174,230,0.1),rgba(182,214,242,0.08))] px-8 text-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">M</div>
            <p className="text-lg font-semibold text-[var(--color-text)]">Map style is not configured</p>
            <p className="max-w-md text-sm text-[var(--color-text-muted)]">
              Add `VITE_GOOGLE_MAPS_API_KEY` to render the embedded Planner map. The place search and assignment flow still works without it.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
