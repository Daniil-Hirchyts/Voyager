import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Map, { Marker, NavigationControl, type MapRef } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { config } from '@/app/config'
import { patchActivity } from '@/entities/activity/api'
import {
  useCreatePlace,
  useNearbyPlaces,
  usePlace,
  usePlaceList,
  usePlaceSearch,
  useViewportPlaces,
} from '@/entities/place/queries'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import { cn } from '@/shared/lib/cn'
import { useMapStore } from '@/shared/stores/map.store'
import type { Place, PlaceCreateInput } from '@/shared/api/types'

const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().min(1).max(50000),
})

const createPlaceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  category: z.string().optional(),
  address_text: z.string().optional(),
  lat: z
    .union([z.number().min(-90).max(90), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
  lon: z
    .union([z.number().min(-180).max(180), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
})

type NearbyFormValues = z.infer<typeof nearbySchema>
type CreatePlaceValues = z.infer<typeof createPlaceSchema>

interface Props {
  tripId: string
}

function PlaceResultRow({
  place,
  selected,
  onSelect,
}: {
  place: Place
  selected: boolean
  onSelect: (place: Place) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(place)}
      className={cn(
        'w-full text-left p-3 rounded-[14px] border transition-colors',
        selected ? 'bg-[#2F6F73]/6 border-[#2F6F73]' : 'hover:bg-[#F4EBDD]',
      )}
      style={{ borderColor: selected ? '#2F6F73' : 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#1D2430]">{place.name}</p>
          <p className="text-xs text-[#526072]">
            {place.category || 'place'}
            {place.address_text ? ` · ${place.address_text}` : ''}
          </p>
        </div>
        {place.distance_m != null && (
          <span className="text-xs text-[#2F6F73] shrink-0">{Math.round(place.distance_m)}m</span>
        )}
      </div>
    </button>
  )
}

export default function MapWorkspace({ tripId }: Props) {
  const navigate = useNavigate()
  const mapRef = useRef<MapRef | null>(null)
  const [searchParams] = useSearchParams()
  const activityId = searchParams.get('activityId')
  const returnTo = searchParams.get('returnTo') || `/app/trips/${tripId}/plan`
  const requestedPlaceId = searchParams.get('placeId')

  const {
    mode,
    setMode,
    selectedPlaceId,
    setSelectedPlaceId,
    viewport,
    setViewport,
    mobilePanel,
    setMobilePanel,
  } = useMapStore()

  const [searchText, setSearchText] = useState(searchParams.get('q') ?? '')
  const [mapError, setMapError] = useState<string | null>(null)
  const [showCreatePlace, setShowCreatePlace] = useState(false)
  const [viewportParams, setViewportParams] = useState<{
    min_lat: number
    min_lon: number
    max_lat: number
    max_lon: number
    limit: number
    offset: number
  } | null>(null)

  const nearbyForm = useForm<NearbyFormValues>({
    resolver: zodResolver(nearbySchema),
    defaultValues: {
      lat: viewport.latitude,
      lon: viewport.longitude,
      radius_m: 1200,
    },
  })
  const createPlaceForm = useForm<CreatePlaceValues>({
    resolver: zodResolver(createPlaceSchema),
    defaultValues: {
      category: 'poi',
      lat: viewport.latitude,
      lon: viewport.longitude,
    },
  })

  const debouncedViewportParams = useDebouncedValue(viewportParams, 450)
  const [nearbyParams, setNearbyParams] = useState<NearbyFormValues | null>(null)

  const { data: basePlaces, isLoading: isLoadingBasePlaces } = usePlaceList({ limit: 30, offset: 0 })
  const { data: searchPlacesData, isFetching: isSearching } = usePlaceSearch(
    { q: searchText.trim(), limit: 30, offset: 0 },
    mode === 'search' && searchText.trim().length > 0,
  )
  const { data: nearbyPlacesData, isFetching: isFetchingNearby } = useNearbyPlaces(
    nearbyParams,
    mode === 'nearby' && nearbyParams != null,
  )
  const { data: viewportPlacesData, isFetching: isFetchingViewport } = useViewportPlaces(
    debouncedViewportParams,
    mode === 'viewport' && debouncedViewportParams != null && !!config.map.styleUrl,
  )
  const { data: selectedPlace } = usePlace(selectedPlaceId)
  const createPlaceMutation = useCreatePlace()

  useEffect(() => {
    if (requestedPlaceId) {
      setSelectedPlaceId(requestedPlaceId)
    }
  }, [requestedPlaceId, setSelectedPlaceId])

  const results = useMemo(() => {
    if (mode === 'nearby') return nearbyPlacesData?.items ?? []
    if (mode === 'viewport') return viewportPlacesData?.items ?? []
    if (searchText.trim().length > 0) return searchPlacesData?.items ?? []
    return basePlaces?.items ?? []
  }, [
    basePlaces?.items,
    mode,
    nearbyPlacesData?.items,
    searchPlacesData?.items,
    searchText,
    viewportPlacesData?.items,
  ])

  const selectedResult = results.find((place) => place.id === selectedPlaceId) ?? selectedPlace
  const isMapUnavailable = !config.map.styleUrl || !!mapError
  const isLoadingResults =
    isLoadingBasePlaces ||
    isSearching ||
    isFetchingNearby ||
    isFetchingViewport

  const handleSelectPlace = (place: Place) => {
    setSelectedPlaceId(place.id)

    if (place.lat != null && place.lon != null && mapRef.current && config.map.styleUrl) {
      mapRef.current.flyTo({
        center: [place.lon, place.lat],
        zoom: Math.max(viewport.zoom, 13),
        duration: 800,
      })
    }
  }

  const handleAssignToActivity = async () => {
    if (!activityId || !selectedPlaceId) return

    try {
      await patchActivity(activityId, { place_id: selectedPlaceId })
      toast.success('Place assigned to activity')
      navigate(returnTo)
    } catch {
      toast.error('Failed to assign place to activity')
    }
  }

  const handleCreatePlace = async (values: CreatePlaceValues) => {
    const payload: PlaceCreateInput = {
      source: 'user_custom',
      name: values.name,
      category: values.category || null,
      address_text: values.address_text || null,
      lat: values.lat ?? null,
      lon: values.lon ?? null,
      metadata: {},
    }

    try {
      const created = await createPlaceMutation.mutateAsync({
        data: payload,
        idempotencyKey: crypto.randomUUID(),
      })
      setSelectedPlaceId(created.id)
      setShowCreatePlace(false)
      createPlaceForm.reset({
        category: 'poi',
        lat: viewport.latitude,
        lon: viewport.longitude,
      })
      toast.success('Custom place created')
    } catch {
      toast.error('Failed to create custom place')
    }
  }

  const onMapMoveEnd = () => {
    const bounds = mapRef.current?.getBounds()
    if (!bounds) return

    setViewportParams({
      min_lat: bounds.getSouth(),
      min_lon: bounds.getWest(),
      max_lat: bounds.getNorth(),
      max_lon: bounds.getEast(),
      limit: 50,
      offset: 0,
    })
  }

  const topButtonClass =
    'px-3 py-2 rounded-[10px] border text-sm transition-colors hover:bg-[#F4EBDD]'

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--color-bg)' }}>
      <div
        className="px-6 py-4 border-b flex flex-col gap-4 shrink-0"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-semibold text-[#1D2430]">Map Workspace</h1>
            <p className="text-sm text-[#526072]">
              Search the place catalog, inspect nearby points, and assign places back into the planner.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activityId && (
              <button
                type="button"
                onClick={() => navigate(returnTo)}
                className={topButtonClass}
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
              >
                Back to Planner
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCreatePlace((value) => !value)}
              className={topButtonClass}
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
            >
              <Plus className="w-4 h-4 inline mr-1 text-[#2F6F73]" />
              {showCreatePlace ? 'Hide Place Form' : 'Create Place'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['search', 'nearby', 'viewport'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                topButtonClass,
                mode === value && 'bg-[#2F6F73] text-white border-[#2F6F73] hover:bg-[#266063]',
              )}
              style={{
                borderColor: mode === value ? '#2F6F73' : 'var(--color-border)',
                color: mode === value ? '#FFFFFF' : 'var(--color-text-muted)',
              }}
            >
              {value === 'search' ? 'Search' : value === 'nearby' ? 'Nearby' : 'Viewport'}
            </button>
          ))}
          <div className="md:hidden ml-auto flex items-center gap-2">
            {(['list', 'map'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMobilePanel(value)}
                className={cn(
                  'px-3 py-2 rounded-[10px] border text-sm',
                  mobilePanel === value && 'bg-[#2F6F73] text-white border-[#2F6F73]',
                )}
                style={{
                  borderColor: mobilePanel === value ? '#2F6F73' : 'var(--color-border)',
                  color: mobilePanel === value ? '#FFFFFF' : 'var(--color-text-muted)',
                }}
              >
                {value === 'list' ? 'List' : 'Map'}
              </button>
            ))}
          </div>
        </div>

        {mode === 'search' && (
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#526072]" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search places, landmarks, neighborhoods..."
              className="w-full pl-9 pr-4 py-3 rounded-[14px] border text-sm outline-none focus:border-[#2F6F73] focus:ring-2 focus:ring-[#2F6F73]/10"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            />
          </div>
        )}

        {mode === 'nearby' && (
          <form
            onSubmit={nearbyForm.handleSubmit((values) => setNearbyParams(values))}
            className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Latitude
              </label>
              <input
                type="number"
                step="any"
                {...nearbyForm.register('lat', { valueAsNumber: true })}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Longitude
              </label>
              <input
                type="number"
                step="any"
                {...nearbyForm.register('lon', { valueAsNumber: true })}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Radius (m)
              </label>
              <input
                type="number"
                {...nearbyForm.register('radius_m', { valueAsNumber: true })}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
            >
              Search Nearby
            </button>
          </form>
        )}

        {mode === 'viewport' && (
          <div className="flex items-center gap-2 text-sm text-[#526072]">
            <SlidersHorizontal className="w-4 h-4 text-[#2F6F73]" />
            {isMapUnavailable
              ? 'Viewport search is unavailable until the map style loads.'
              : 'Pan or zoom the map to refresh the visible place list.'}
          </div>
        )}

        {showCreatePlace && (
          <div
            className="rounded-[18px] border p-4 grid grid-cols-1 md:grid-cols-2 gap-3"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
          >
            <div className="md:col-span-2 flex items-center justify-between">
              <div>
                <p className="font-medium text-[#1D2430]">Create Custom Place</p>
                <p className="text-sm text-[#526072]">Save a personal place directly into Voyager.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreatePlace(false)}
                className="p-1.5 rounded-[10px] hover:bg-[#F4EBDD] transition-colors"
              >
                <X className="w-4 h-4 text-[#526072]" />
              </button>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Name
              </label>
              <input
                {...createPlaceForm.register('name')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Category
              </label>
              <input
                {...createPlaceForm.register('category')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Address
              </label>
              <input
                {...createPlaceForm.register('address_text')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Latitude
              </label>
              <input
                type="number"
                step="any"
                {...createPlaceForm.register('lat', { valueAsNumber: true })}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider">
                Longitude
              </label>
              <input
                type="number"
                step="any"
                {...createPlaceForm.register('lon', { valueAsNumber: true })}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="button"
                onClick={createPlaceForm.handleSubmit(handleCreatePlace)}
                disabled={createPlaceMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors disabled:opacity-50"
              >
                {createPlaceMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Place
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 grid md:grid-cols-[22rem_1fr_22rem] gap-4 p-4">
        <section
          className={cn(
            'min-h-0 flex-col rounded-[24px] border overflow-hidden',
            mobilePanel === 'list' ? 'flex' : 'hidden md:flex',
          )}
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <p className="font-medium text-[#1D2430]">Results</p>
            <p className="text-xs text-[#526072]">
              {results.length} place{results.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {isLoadingResults ? (
              <div className="space-y-2">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-20 rounded-[14px] bg-[#CDBEA8]/30 animate-pulse" />
                ))}
              </div>
            ) : results.length > 0 ? (
              results.map((place) => (
                <PlaceResultRow
                  key={place.id}
                  place={place}
                  selected={place.id === selectedPlaceId}
                  onSelect={handleSelectPlace}
                />
              ))
            ) : (
              <div className="text-sm text-[#526072] p-3">
                {mode === 'nearby'
                  ? 'No nearby places found. Try increasing the radius.'
                  : mode === 'viewport'
                    ? 'No places in this map area yet. Pan or zoom out to broaden the search.'
                    : 'No places found. Try a broader query or create a custom place.'}
              </div>
            )}
          </div>
        </section>

        <section
          className={cn(
            'min-h-[320px] rounded-[24px] border overflow-hidden relative',
            mobilePanel === 'map' ? 'block' : 'hidden md:block',
          )}
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          {isMapUnavailable ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              <MapPin className="w-8 h-8 text-[#2F6F73] mb-3" />
              <p className="font-medium text-[#1D2430] mb-1">Map unavailable</p>
              <p className="text-sm text-[#526072] max-w-sm">
                {config.map.styleUrl
                  ? mapError || 'The map style could not be loaded.'
                  : 'Set `VITE_MAP_STYLE_URL` to enable the interactive atlas canvas.'}
              </p>
            </div>
          ) : (
            <Map
              ref={mapRef}
              initialViewState={viewport}
              mapStyle={config.map.styleUrl}
              onError={(event) => setMapError(String(event.error?.message || 'Map failed to load'))}
              onMove={(event) => {
                setViewport({
                  latitude: event.viewState.latitude,
                  longitude: event.viewState.longitude,
                  zoom: event.viewState.zoom,
                })
              }}
              onMoveEnd={onMapMoveEnd}
            >
              <NavigationControl position="top-right" />
              {results
                .filter((place) => place.lat != null && place.lon != null)
                .map((place) => (
                  <Marker
                    key={place.id}
                    latitude={place.lat!}
                    longitude={place.lon!}
                    anchor="bottom"
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectPlace(place)}
                      className={cn(
                        'w-4 h-4 rounded-full border-2 transition-transform',
                        place.id === selectedPlaceId
                          ? 'bg-[#C56A3D] border-white scale-125'
                          : 'bg-[#2F6F73] border-white',
                      )}
                      aria-label={`Select ${place.name}`}
                    />
                  </Marker>
                ))}
            </Map>
          )}
        </section>

        <section
          className="min-h-0 flex flex-col rounded-[24px] border overflow-hidden"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <p className="font-medium text-[#1D2430]">Selected Place</p>
            <p className="text-xs text-[#526072]">
              {activityId
                ? 'Use this panel to assign a place back into the planner.'
                : 'Inspect metadata and imagery for the selected place.'}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedResult ? (
              <div className="space-y-4">
                {selectedResult.primary_photo?.image_url || selectedResult.primary_photo?.thumbnail_url ? (
                  <img
                    src={selectedResult.primary_photo?.image_url || selectedResult.primary_photo?.thumbnail_url || ''}
                    alt={selectedResult.name}
                    className="w-full h-44 object-cover rounded-[18px]"
                  />
                ) : (
                  <div
                    className="h-44 rounded-[18px] flex items-center justify-center text-sm text-[#526072]"
                    style={{ background: 'var(--color-bg)' }}
                  >
                    No photo available
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-[#1D2430]">{selectedResult.name}</h2>
                  <p className="text-sm text-[#526072] mt-1">
                    {selectedResult.category || 'place'}
                    {selectedResult.address_text ? ` · ${selectedResult.address_text}` : ''}
                  </p>
                </div>
                {selectedResult.metadata && Object.keys(selectedResult.metadata).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-[#526072] uppercase tracking-wider mb-2">
                      Metadata
                    </p>
                    <div className="space-y-2">
                      {Object.entries(selectedResult.metadata).slice(0, 8).map(([key, value]) => (
                        <div key={key} className="text-sm text-[#526072]">
                          <span className="font-medium text-[#1D2430]">{key}:</span>{' '}
                          {typeof value === 'string' ? value : JSON.stringify(value)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {activityId && (
                  <button
                    type="button"
                    onClick={handleAssignToActivity}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Use For Planner Activity
                  </button>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-sm text-[#526072] gap-2">
                <MapPin className="w-6 h-6 text-[#2F6F73]" />
                Select a place from the list or map to inspect it here.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
