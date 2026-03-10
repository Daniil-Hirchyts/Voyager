import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Layers3,
  Lock,
  Loader2,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Route,
  Search,
  SlidersHorizontal,
  Trash2,
  Unlock,
  Upload,
  Waypoints,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { config } from '@/app/config'
import { patchActivity } from '@/entities/activity/api'
import { searchPlaces } from '@/entities/place/api'
import {
  useCreatePlace,
  useNearbyPlaces,
  usePlace,
  usePlaceList,
  usePlaceSearch,
  useViewportPlaces,
} from '@/entities/place/queries'
import {
  useCreateTripMapLayer,
  useDeleteTripMapLayer,
  usePatchTripMapLayer,
  useTripMapLayers,
} from '@/entities/trip-map-layer/queries'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import { cn } from '@/shared/lib/cn'
import { resolvePhotoUrl } from '@/shared/lib/media'
import { useMapStore } from '@/shared/stores/map.store'
import {
  ControlPosition,
  GoogleDirectionsRoute,
  GoogleMap3DPreview,
  GoogleMapCanvas,
  GooglePlacesExperimentPanel,
  MapBoundsSync,
  MapPanTo,
  TerraDrawEditor,
  TripMapLayerRenderer,
  VoyagerMapControl,
  VoyagerMarker,
  VoyagerMarkerClusterLayer,
  emptyFeatureCollection,
  featureCollectionToPoints,
  summarizeFeatureCollection,
  useGoogleGeometryLibrary,
} from '@/shared/layouts/google-maps'
import type {
  GooglePlaceCandidate,
  MapLayerRenderer,
  MapLayerSource,
  Place,
  PlaceCreateInput,
  RoutePreviewRoute,
  TripMapFeatureCollection,
  TripMapLayer,
} from '@/shared/api/types'

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

interface RouteStop {
  id: string
  name: string
  point: { lat: number; lng: number }
}

interface DraftLayerState {
  layerId: string | null
  name: string
  source: MapLayerSource
  renderer: MapLayerRenderer
  featureCollection: TripMapFeatureCollection
  style: Record<string, unknown>
  metadata: Record<string, unknown>
  drawMode: 'select' | 'point' | 'linestring' | 'polygon' | 'rectangle' | 'circle' | 'freehand'
}

type DdsBoundaryFeatureType =
  | 'COUNTRY'
  | 'ADMINISTRATIVE_AREA_LEVEL_1'
  | 'ADMINISTRATIVE_AREA_LEVEL_2'
  | 'LOCALITY'
  | 'POSTAL_CODE'

const BOUNDARY_FEATURE_OPTIONS: Array<{ value: DdsBoundaryFeatureType; label: string }> = [
  { value: 'COUNTRY', label: 'Country' },
  { value: 'ADMINISTRATIVE_AREA_LEVEL_1', label: 'Admin Area 1' },
  { value: 'ADMINISTRATIVE_AREA_LEVEL_2', label: 'Admin Area 2' },
  { value: 'LOCALITY', label: 'Locality' },
  { value: 'POSTAL_CODE', label: 'Postal Code' },
]

function defaultLayerStyle(source: MapLayerSource, drawMode: DraftLayerState['drawMode']) {
  if (source === 'routes' || drawMode === 'linestring') {
    return {
      strokeColor: '#17344C',
      strokeWeight: 5,
      strokeOpacity: 0.92,
    }
  }

  return {
    strokeColor: '#17344C',
    strokeWeight: 3,
    strokeOpacity: 0.9,
    fillColor: '#72AEE6',
    fillOpacity: 0.16,
  }
}

function makeRouteStop(place: Place | null | undefined): RouteStop | null {
  if (!place || place.lat == null || place.lon == null) return null
  return {
    id: place.id,
    name: place.name,
    point: {
      lat: place.lat,
      lng: place.lon,
    },
  }
}

function createFeatureCollectionFromPlaces(places: Place[]): TripMapFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: places
      .filter((place) => place.lat != null && place.lon != null)
      .map((place) => ({
        type: 'Feature' as const,
        properties: {
          placeId: place.id,
          name: place.name,
          category: place.category,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [place.lon!, place.lat!],
        },
      })),
  }
}

function createViewportFeatureCollection(
  bounds: google.maps.LatLngBoundsLiteral | null,
): TripMapFeatureCollection {
  if (!bounds) {
    return emptyFeatureCollection()
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          kind: 'viewport',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [bounds.west, bounds.south],
            [bounds.east, bounds.south],
            [bounds.east, bounds.north],
            [bounds.west, bounds.north],
            [bounds.west, bounds.south],
          ]],
        },
      },
    ],
  }
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function inferDrawMode(featureCollection: TripMapFeatureCollection): DraftLayerState['drawMode'] {
  const geometryType = featureCollection.features[0]?.geometry?.type
  if (geometryType === 'Point' || geometryType === 'MultiPoint') return 'point'
  if (geometryType === 'LineString' || geometryType === 'MultiLineString') return 'linestring'
  if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') return 'polygon'
  return 'select'
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
        selected ? 'bg-[var(--color-cta)]/6 border-[var(--color-primary)]' : 'hover:bg-[rgba(114,174,230,0.08)]',
      )}
      style={{ borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)]">{place.name}</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {place.category || 'place'}
            {place.address_text ? ` · ${place.address_text}` : ''}
          </p>
        </div>
        {place.distance_m != null && (
          <span className="text-xs text-[var(--color-primary-foreground)] shrink-0">{Math.round(place.distance_m)}m</span>
        )}
      </div>
    </button>
  )
}

export default function MapWorkspace({ tripId }: Props) {
  const navigate = useNavigate()
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

  const geometryLib = useGoogleGeometryLibrary()
  const debouncedViewportParams = useDebouncedValue(viewportParams, 450)
  const [nearbyParams, setNearbyParams] = useState<NearbyFormValues | null>(null)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null)
  const [draftLayer, setDraftLayer] = useState<DraftLayerState | null>(null)
  const [googlePlaceDraft, setGooglePlaceDraft] = useState<GooglePlaceCandidate | null>(null)
  const [boundaryFeatureType, setBoundaryFeatureType] =
    useState<DdsBoundaryFeatureType>('ADMINISTRATIVE_AREA_LEVEL_1')
  const [datasetIdInput, setDatasetIdInput] = useState('')
  const [routeOrigin, setRouteOrigin] = useState<RouteStop | null>(null)
  const [routeDestination, setRouteDestination] = useState<RouteStop | null>(null)
  const [routeWaypoints, setRouteWaypoints] = useState<RouteStop[]>([])
  const [routeAlternatives, setRouteAlternatives] = useState<RoutePreviewRoute[]>([])
  const [activeRouteIndex, setActiveRouteIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
    mode === 'viewport' && debouncedViewportParams != null && !!config.map.apiKey,
  )
  const { data: selectedPlace } = usePlace(selectedPlaceId)
  const { data: tripLayersData, isLoading: isLoadingTripLayers } = useTripMapLayers(tripId)
  const createPlaceMutation = useCreatePlace()
  const createTripLayerMutation = useCreateTripMapLayer(tripId)
  const patchTripLayerMutation = usePatchTripMapLayer(tripId)
  const deleteTripLayerMutation = useDeleteTripMapLayer(tripId)

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
  const tripLayers = tripLayersData?.items ?? []
  const selectedLayer = tripLayers.find((layer) => layer.id === selectedLayerId) ?? null
  const currentFeatureCollection = draftLayer?.featureCollection ?? selectedLayer?.feature_collection ?? null
  const geometrySummary = useMemo(
    () => summarizeFeatureCollection(currentFeatureCollection, geometryLib),
    [currentFeatureCollection, geometryLib],
  )
  const mappableResults = useMemo(
    () => results.filter((place) => place.lat != null && place.lon != null),
    [results],
  )
  const clusteredMarkers = useMemo(
    () =>
      mappableResults
        .filter((place) => place.id !== selectedPlaceId)
        .map((place) => ({
          id: place.id,
          position: { lat: place.lat!, lng: place.lon! },
          title: place.name,
          color: '#17344C',
        })),
    [mappableResults, selectedPlaceId],
  )
  const isMapUnavailable = !config.map.apiKey
  const isLoadingResults =
    isLoadingBasePlaces ||
    isSearching ||
    isFetchingNearby ||
    isFetchingViewport
  const isSavingLayer =
    createTripLayerMutation.isPending ||
    patchTripLayerMutation.isPending ||
    deleteTripLayerMutation.isPending

  const handleSelectPlace = (place: Place) => {
    setSelectedPlaceId(place.id)
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
    const matchedPlaces = googlePlaceDraft?.place_id
      ? await searchPlaces({ q: values.name.trim(), limit: 12, offset: 0 }).catch(() => null)
      : null
    const matchedPlace = matchedPlaces?.items.find((place) => {
      if (!values.name.trim()) return false
      const sameName = place.name.trim().toLowerCase() === values.name.trim().toLowerCase()
      const latClose =
        place.lat != null && values.lat != null ? Math.abs(place.lat - values.lat) <= 0.002 : true
      const lonClose =
        place.lon != null && values.lon != null ? Math.abs(place.lon - values.lon) <= 0.002 : true
      return sameName && latClose && lonClose
    })

    if (matchedPlace) {
      setSelectedPlaceId(matchedPlace.id)
      setShowCreatePlace(false)
      toast.success('Matched an existing Voyager place')
      return
    }

    const payload: PlaceCreateInput = {
      source: 'user_custom',
      name: values.name,
      category: values.category || null,
      address_text: values.address_text || null,
      lat: values.lat ?? null,
      lon: values.lon ?? null,
      metadata: {
        ...(googlePlaceDraft?.place_id ? { google_place_id: googlePlaceDraft.place_id } : {}),
        ...(googlePlaceDraft ? { google_place_candidate: googlePlaceDraft } : {}),
        ...(googlePlaceDraft?.timezone ? { time_zone_id: googlePlaceDraft.timezone } : {}),
      },
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
      setGooglePlaceDraft(null)
      toast.success('Custom place created')
    } catch {
      toast.error('Failed to create custom place')
    }
  }

  const handleStartLayerDraft = (
    source: MapLayerSource,
    drawMode: DraftLayerState['drawMode'],
    name: string,
    renderer: MapLayerRenderer = 'native',
  ) => {
    setSelectedLayerId(null)
    setDraftLayer({
      layerId: null,
      name,
      source,
      renderer,
      featureCollection: emptyFeatureCollection(),
      style: defaultLayerStyle(source, drawMode),
      metadata: {},
      drawMode,
    })
  }

  const handleEditLayer = (layer: TripMapLayer) => {
    setSelectedLayerId(layer.id)
    if (layer.renderer === 'native') {
      setDraftLayer({
        layerId: layer.id,
        name: layer.name,
        source: layer.source,
        renderer: layer.renderer,
        featureCollection: layer.feature_collection,
        style: layer.style,
        metadata: layer.metadata,
        drawMode: inferDrawMode(layer.feature_collection),
      })
    } else {
      setDraftLayer(null)
    }
  }

  const handlePersistDraftLayer = async () => {
    if (!draftLayer) return

    const summary = summarizeFeatureCollection(draftLayer.featureCollection, geometryLib)
    const payload = {
      name: draftLayer.name,
      source: draftLayer.source,
      renderer: draftLayer.renderer,
      feature_collection: draftLayer.featureCollection,
      style: draftLayer.style,
      metadata: {
        ...draftLayer.metadata,
        distance_m: Math.round(summary.distanceMeters),
        area_m2: Math.round(summary.areaSquareMeters),
      },
      is_visible: true,
      is_locked: false,
    }

    try {
      if (draftLayer.layerId) {
        const updated = await patchTripLayerMutation.mutateAsync({
          layerId: draftLayer.layerId,
          data: payload,
        })
        setSelectedLayerId(updated.id)
        toast.success('Trip layer updated')
      } else {
        const created = await createTripLayerMutation.mutateAsync({
          data: payload,
          idempotencyKey: crypto.randomUUID(),
        })
        setSelectedLayerId(created.id)
        toast.success('Trip layer saved')
      }
      setDraftLayer(null)
    } catch {
      toast.error('Failed to save trip layer')
    }
  }

  const handleDeleteLayer = async (layer: TripMapLayer) => {
    try {
      await deleteTripLayerMutation.mutateAsync(layer.id)
      if (selectedLayerId === layer.id) {
        setSelectedLayerId(null)
      }
      if (draftLayer?.layerId === layer.id) {
        setDraftLayer(null)
      }
      toast.success('Trip layer deleted')
    } catch {
      toast.error('Failed to delete trip layer')
    }
  }

  const handleToggleLayerVisibility = async (layer: TripMapLayer) => {
    try {
      await patchTripLayerMutation.mutateAsync({
        layerId: layer.id,
        data: { is_visible: !layer.is_visible },
      })
    } catch {
      toast.error('Failed to update layer visibility')
    }
  }

  const handleToggleLayerLock = async (layer: TripMapLayer) => {
    try {
      await patchTripLayerMutation.mutateAsync({
        layerId: layer.id,
        data: { is_locked: !layer.is_locked },
      })
    } catch {
      toast.error('Failed to update layer lock state')
    }
  }

  const handleExportLayer = (layer: TripMapLayer) => {
    downloadJson(
      `${layer.name.toLowerCase().replace(/\s+/g, '-') || 'trip-layer'}.geojson`,
      layer.feature_collection,
    )
  }

  const handleImportGeoJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const payload = JSON.parse(await file.text()) as TripMapFeatureCollection
      await createTripLayerMutation.mutateAsync({
        data: {
          name: file.name.replace(/\.geojson$/i, ''),
          source: 'manual_draw',
          renderer: 'native',
          feature_collection: payload,
          style: defaultLayerStyle('manual_draw', inferDrawMode(payload)),
          metadata: {
            imported_from: file.name,
          },
        },
        idempotencyKey: crypto.randomUUID(),
      })
      toast.success('GeoJSON layer imported')
      event.target.value = ''
    } catch {
      toast.error('Could not import GeoJSON')
    }
  }

  const handleSaveAnalyticsLayer = async (deckKind: 'heatmap' | 'hexagon' | 'scatter') => {
    const places = results.filter((place) => place.lat != null && place.lon != null)
    if (!places.length) {
      toast.error('No mapped results available for analytics')
      return
    }

    try {
      await createTripLayerMutation.mutateAsync({
        data: {
          name: `${deckKind} · ${mode}`,
          source: 'analytics',
          renderer: 'deckgl',
          feature_collection: createFeatureCollectionFromPlaces(places),
          metadata: {
            deckKind,
            resultCount: places.length,
          },
          style: {},
        },
        idempotencyKey: crypto.randomUUID(),
      })
      toast.success('Analytics layer saved')
    } catch {
      toast.error('Failed to save analytics layer')
    }
  }

  const handleSaveViewportLayer = async () => {
    try {
      await createTripLayerMutation.mutateAsync({
        data: {
          name: 'Viewport boundary',
          source: 'places',
          renderer: 'native',
          feature_collection: createViewportFeatureCollection(
            viewportParams
              ? {
                north: viewportParams.max_lat,
                south: viewportParams.min_lat,
                east: viewportParams.max_lon,
                west: viewportParams.min_lon,
              }
              : null,
          ),
          style: defaultLayerStyle('places', 'polygon'),
          metadata: {
            viewport_mode: mode,
          },
        },
        idempotencyKey: crypto.randomUUID(),
      })
      toast.success('Viewport layer saved')
    } catch {
      toast.error('Failed to save viewport layer')
    }
  }

  const handleSaveBoundaryLayer = async () => {
    try {
      await createTripLayerMutation.mutateAsync({
        data: {
          name: `Boundary · ${boundaryFeatureType}`,
          source: 'places',
          renderer: 'dds-boundary',
          feature_collection: emptyFeatureCollection(),
          style: defaultLayerStyle('places', 'polygon'),
          metadata: {
            featureType: boundaryFeatureType,
          },
        },
        idempotencyKey: crypto.randomUUID(),
      })
      toast.success('Boundary layer saved')
    } catch {
      toast.error('Failed to save boundary layer')
    }
  }

  const handleSaveDatasetLayer = async () => {
    if (!datasetIdInput.trim()) {
      toast.error('Dataset ID is required')
      return
    }

    try {
      await createTripLayerMutation.mutateAsync({
        data: {
          name: `Dataset · ${datasetIdInput.trim()}`,
          source: 'analytics',
          renderer: 'dds-dataset',
          feature_collection: emptyFeatureCollection(),
          style: defaultLayerStyle('analytics', 'polygon'),
          metadata: {
            datasetId: datasetIdInput.trim(),
          },
        },
        idempotencyKey: crypto.randomUUID(),
      })
      setDatasetIdInput('')
      toast.success('Dataset layer saved')
    } catch {
      toast.error('Failed to save dataset layer')
    }
  }

  const handleUsePlaceAsRouteRole = (role: 'origin' | 'destination' | 'waypoint') => {
    const stop = makeRouteStop(selectedResult)
    if (!stop) {
      toast.error('Selected place needs coordinates')
      return
    }

    if (role === 'origin') {
      setRouteOrigin(stop)
      return
    }
    if (role === 'destination') {
      setRouteDestination(stop)
      return
    }
    setRouteWaypoints((current) => {
      if (current.some((item) => item.id === stop.id)) return current
      return [...current, stop]
    })
  }

  const handleSaveComputedRoute = async () => {
    const route = routeAlternatives[activeRouteIndex]
    if (!route || !route.path?.length || !routeOrigin || !routeDestination) {
      toast.error('Route preview is not ready yet')
      return
    }

    try {
      await createTripLayerMutation.mutateAsync({
        data: {
          name: `${routeOrigin.name} → ${routeDestination.name}`,
          source: 'routes',
          renderer: 'native',
          feature_collection: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {
                  summary: route.summary,
                  originPlaceId: routeOrigin.id,
                  destinationPlaceId: routeDestination.id,
                  waypointPlaceIds: routeWaypoints.map((item) => item.id),
                  distanceMeters: route.distance_m,
                  durationMin: route.duration_min,
                },
                geometry: {
                  type: 'LineString',
                  coordinates: route.path.map((point) => [point.lng, point.lat]),
                },
              },
            ],
          },
          style: defaultLayerStyle('routes', 'linestring'),
          metadata: {
            routeSummary: route.summary,
            alternativeIndex: activeRouteIndex,
            waypointCount: routeWaypoints.length,
            distance_m: route.distance_m,
            duration_min: route.duration_min,
          },
        },
        idempotencyKey: crypto.randomUUID(),
      })
      toast.success('Route layer saved')
    } catch {
      toast.error('Failed to save route layer')
    }
  }

  const onBoundsChange = (bounds: google.maps.LatLngBoundsLiteral) => {
    setViewportParams({
      min_lat: bounds.south,
      min_lon: bounds.west,
      max_lat: bounds.north,
      max_lon: bounds.east,
      limit: 50,
      offset: 0,
    })
  }

  const topButtonClass =
    'px-3 py-2 rounded-[14px] border border-[var(--color-border-strong)] bg-white/70 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[rgba(114,174,230,0.08)]'

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--color-bg)' }}>
      <div
        className="px-6 py-4 border-b flex flex-col gap-4 shrink-0"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-semibold text-[var(--color-text)]">Map Workspace</h1>
            <p className="text-sm text-[var(--color-text-muted)]">
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
              <Plus className="w-4 h-4 inline mr-1 text-[var(--color-primary-foreground)]" />
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
                mode === value && 'bg-[var(--color-cta)] text-white border-[var(--color-primary)] hover:bg-[var(--color-cta)]',
              )}
              style={{
                borderColor: mode === value ? 'var(--color-primary)' : 'var(--color-border)',
                color: mode === value ? 'var(--color-cta-foreground)' : 'var(--color-text-muted)',
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
                  mobilePanel === value && 'bg-[var(--color-cta)] text-white border-[var(--color-primary)]',
                )}
                style={{
                  borderColor: mobilePanel === value ? 'var(--color-primary)' : 'var(--color-border)',
                  color: mobilePanel === value ? 'var(--color-cta-foreground)' : 'var(--color-text-muted)',
                }}
              >
                {value === 'list' ? 'List' : 'Map'}
              </button>
            ))}
          </div>
        </div>

        {mode === 'search' && (
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search places, landmarks, neighborhoods..."
              className="w-full pl-9 pr-4 py-3 rounded-[14px] border text-sm outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[rgba(114,174,230,0.16)]"
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
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
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
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
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
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
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
              className="px-4 py-2.5 bg-[var(--color-cta)] text-white text-sm font-medium rounded-[10px] hover:bg-[var(--color-cta)] transition-colors"
            >
              Search Nearby
            </button>
          </form>
        )}

        {mode === 'viewport' && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <SlidersHorizontal className="w-4 h-4 text-[var(--color-primary-foreground)]" />
            {isMapUnavailable
              ? 'Viewport search is unavailable until Google Maps is configured.'
              : 'Pan or zoom the map to refresh the visible place list.'}
          </div>
        )}

        <div
          className="flex flex-wrap items-center gap-2 rounded-[16px] border px-3 py-3"
          style={{ borderColor: 'var(--color-border)', background: 'rgba(255,255,255,0.42)' }}
        >
          <span className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Layer Actions
          </span>
          <button
            type="button"
            onClick={() => handleStartLayerDraft('routes', 'linestring', 'Manual route')}
            className={topButtonClass}
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            <Route className="mr-1 inline h-4 w-4 text-[var(--color-primary-foreground)]" />
            Draw Route
          </button>
          <button
            type="button"
            onClick={() => handleStartLayerDraft('manual_draw', 'polygon', 'Area sketch')}
            className={topButtonClass}
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            <Layers3 className="mr-1 inline h-4 w-4 text-[var(--color-primary-foreground)]" />
            Draw Area
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={topButtonClass}
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            <Upload className="mr-1 inline h-4 w-4 text-[var(--color-primary-foreground)]" />
            Import GeoJSON
          </button>
          <button
            type="button"
            onClick={handleSaveViewportLayer}
            className={topButtonClass}
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            <MapPin className="mr-1 inline h-4 w-4 text-[var(--color-primary-foreground)]" />
            Save Viewport
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,application/geo+json,application/json"
            onChange={handleImportGeoJson}
            className="hidden"
          />
        </div>

        {showCreatePlace && (
          <div
            className="rounded-[18px] border p-4 grid grid-cols-1 md:grid-cols-2 gap-3"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
          >
            <div className="md:col-span-2 flex items-center justify-between">
              <div>
                <p className="font-medium text-[var(--color-text)]">Create Custom Place</p>
                <p className="text-sm text-[var(--color-text-muted)]">Save a personal place directly into Voyager.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreatePlace(false)}
                className="p-1.5 rounded-[10px] hover:bg-[rgba(114,174,230,0.08)] transition-colors"
              >
                <X className="w-4 h-4 text-[var(--color-text-muted)]" />
              </button>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
                Name
              </label>
              <input
                {...createPlaceForm.register('name')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
                Category
              </label>
              <input
                {...createPlaceForm.register('category')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
                Address
              </label>
              <input
                {...createPlaceForm.register('address_text')}
                className="w-full px-3 py-2 rounded-[10px] border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
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
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1 uppercase tracking-wider">
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
            {config.features.mapExperiments && (
              <div className="md:col-span-2 rounded-[16px] border p-3" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Google Places Assist
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Search Google Places to hydrate the custom place form. Voyager still saves or matches the final place record.
                </p>
                <div className="mt-3">
                  <GooglePlacesExperimentPanel
                    selectedPlaceId={googlePlaceDraft?.place_id}
                    onPlacePicked={(candidate) => {
                      setGooglePlaceDraft(candidate)
                      createPlaceForm.setValue('name', candidate?.name ?? '')
                      createPlaceForm.setValue('address_text', candidate?.address_text ?? '')
                      if (candidate?.lat != null) createPlaceForm.setValue('lat', candidate.lat)
                      if (candidate?.lon != null) createPlaceForm.setValue('lon', candidate.lon)
                    }}
                  />
                </div>
              </div>
            )}
            <div className="md:col-span-2">
              <button
                type="button"
                onClick={createPlaceForm.handleSubmit(handleCreatePlace)}
                disabled={createPlaceMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--color-cta)] text-white text-sm font-medium rounded-[10px] hover:bg-[var(--color-cta)] transition-colors disabled:opacity-50"
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
            <p className="font-medium text-[var(--color-text)]">Results</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {results.length} place{results.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {isLoadingResults ? (
              <div className="space-y-2">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-20 rounded-[14px] bg-[rgba(114,174,230,0.16)] animate-pulse" />
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
              <div className="text-sm text-[var(--color-text-muted)] p-3">
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
              <MapPin className="w-8 h-8 text-[var(--color-primary-foreground)] mb-3" />
              <p className="font-medium text-[var(--color-text)] mb-1">Map unavailable</p>
              <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
                Set `VITE_GOOGLE_MAPS_API_KEY` to enable the interactive map canvas.
              </p>
            </div>
          ) : (
            <GoogleMapCanvas
              defaultCenter={{ lat: viewport.latitude, lng: viewport.longitude }}
              defaultZoom={viewport.zoom}
              style={{ width: '100%', height: '100%' }}
              disableDefaultUI={false}
              streetViewControl={false}
              mapTypeControl={false}
              fullscreenControl={false}
              onCameraChanged={(event) => {
                setViewport({
                  latitude: event.detail.center.lat,
                  longitude: event.detail.center.lng,
                  zoom: event.detail.zoom,
                })
              }}
            >
              <MapBoundsSync onBoundsChange={onBoundsChange} />
              <TripMapLayerRenderer layers={tripLayers} />
              {draftLayer ? (
                <TerraDrawEditor
                  enabled
                  mode={draftLayer.drawMode}
                  value={draftLayer.featureCollection}
                  onChange={(featureCollection) => {
                    setDraftLayer((current) =>
                      current
                        ? {
                          ...current,
                          featureCollection,
                        }
                        : current,
                    )
                  }}
                />
              ) : null}
              {routeOrigin && routeDestination ? (
                <GoogleDirectionsRoute
                  origin={routeOrigin.point}
                  destination={routeDestination.point}
                  waypoints={routeWaypoints.map((item) => item.point)}
                  activeRouteIndex={activeRouteIndex}
                  onRoutesChange={(routes) => {
                    setRouteAlternatives(routes)
                    setActiveRouteIndex((current) => Math.min(current, Math.max(routes.length - 1, 0)))
                  }}
                />
              ) : null}
              <MapPanTo
                point={
                  selectedResult?.lat != null && selectedResult?.lon != null
                    ? { lat: selectedResult.lat, lng: selectedResult.lon }
                    : null
                }
                zoom={selectedResult?.lat != null && selectedResult?.lon != null ? Math.max(viewport.zoom, 13) : undefined}
              />
              <VoyagerMarkerClusterLayer
                items={clusteredMarkers}
                onMarkerClick={(item) => {
                  const match = results.find((place) => place.id === item.id)
                  if (match) {
                    handleSelectPlace(match)
                  }
                }}
              />
              {selectedResult?.lat != null && selectedResult?.lon != null ? (
                <VoyagerMarker
                  position={{ lat: selectedResult.lat, lng: selectedResult.lon }}
                  title={selectedResult.name}
                  selected
                  label={selectedResult.name.length < 18 ? selectedResult.name : undefined}
                  onClick={() => handleSelectPlace(selectedResult)}
                  zIndex={4}
                />
              ) : null}
              <VoyagerMapControl position={ControlPosition.TOP_LEFT}>
                <div className="m-3 max-w-[280px] rounded-[18px] border border-white/70 bg-white/88 px-3 py-3 shadow-[0_16px_40px_rgba(23,62,67,0.16)] backdrop-blur">
                  <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                    Atlas Status
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--color-text)]">
                    <span className="rounded-full bg-[rgba(114,174,230,0.12)] px-2.5 py-1">
                      {tripLayers.length} saved layer{tripLayers.length === 1 ? '' : 's'}
                    </span>
                    <span className="rounded-full bg-[var(--color-bg-soft)] px-2.5 py-1">
                      {mappableResults.length} visible place{mappableResults.length === 1 ? '' : 's'}
                    </span>
                    {draftLayer ? (
                      <span className="rounded-full bg-[rgba(114,174,230,0.12)] px-2.5 py-1">
                        Editing {draftLayer.drawMode}
                      </span>
                    ) : null}
                  </div>
                </div>
              </VoyagerMapControl>
              {routeAlternatives.length > 1 ? (
                <VoyagerMapControl position={ControlPosition.TOP_RIGHT}>
                  <div className="m-3 flex gap-2 rounded-[18px] border border-white/70 bg-white/88 px-3 py-3 shadow-[0_16px_40px_rgba(23,62,67,0.16)] backdrop-blur">
                    {routeAlternatives.map((route, index) => (
                      <button
                        key={`${route.summary || 'route'}-${index}`}
                        type="button"
                        onClick={() => setActiveRouteIndex(index)}
                        className={cn(
                          'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                          activeRouteIndex === index
                            ? 'bg-[var(--color-cta)] text-white'
                            : 'bg-[var(--color-bg-soft)] text-[var(--color-text)]',
                        )}
                      >
                        Route {index + 1}
                      </button>
                    ))}
                  </div>
                </VoyagerMapControl>
              ) : null}
            </GoogleMapCanvas>
          )}
        </section>

        <section
          className="min-h-0 flex flex-col rounded-[24px] border overflow-hidden"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <p className="font-medium text-[var(--color-text)]">Selected Place</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {activityId
                ? 'Use this panel to assign a place back into the planner.'
                : 'Inspect metadata and imagery for the selected place.'}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedResult ? (
              <div className="space-y-4">
                {resolvePhotoUrl(selectedResult.primary_photo, 'full') ? (
                  <img
                    src={resolvePhotoUrl(selectedResult.primary_photo, 'full') || ''}
                    alt={selectedResult.name}
                    className="w-full h-44 object-cover rounded-[18px]"
                  />
                ) : (
                  <div
                    className="h-44 rounded-[18px] flex items-center justify-center text-sm text-[var(--color-text-muted)]"
                    style={{ background: 'var(--color-bg)' }}
                  >
                    No photo available
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-[var(--color-text)]">{selectedResult.name}</h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {selectedResult.category || 'place'}
                    {selectedResult.address_text ? ` · ${selectedResult.address_text}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleUsePlaceAsRouteRole('origin')}
                    className={topButtonClass}
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                  >
                    <Navigation className="mr-1 inline h-4 w-4 text-[var(--color-primary-foreground)]" />
                    Use as Origin
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUsePlaceAsRouteRole('waypoint')}
                    className={topButtonClass}
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                  >
                    <Waypoints className="mr-1 inline h-4 w-4 text-[var(--color-primary-foreground)]" />
                    Add Waypoint
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUsePlaceAsRouteRole('destination')}
                    className={topButtonClass}
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                  >
                    <Route className="mr-1 inline h-4 w-4 text-[var(--color-primary-foreground)]" />
                    Use as Destination
                  </button>
                </div>
                {selectedResult.metadata && Object.keys(selectedResult.metadata).length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                      Metadata
                    </p>
                    <div className="space-y-2">
                      {Object.entries(selectedResult.metadata).slice(0, 8).map(([key, value]) => (
                        <div key={key} className="text-sm text-[var(--color-text-muted)]">
                          <span className="font-medium text-[var(--color-text)]">{key}:</span>{' '}
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
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[var(--color-cta)] text-white text-sm font-medium rounded-[10px] hover:bg-[var(--color-cta)] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Use For Planner Activity
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-[18px] border p-4 text-center text-sm text-[var(--color-text-muted)]" style={{ borderColor: 'var(--color-border)' }}>
                <MapPin className="mx-auto mb-2 h-6 w-6 text-[var(--color-primary-foreground)]" />
                Select a place from the list or map to inspect it here.
              </div>
            )}

            <div className="rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-[var(--color-text)]">Route Composer</p>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Build a Google route from selected places, then persist it as a trip layer.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRouteOrigin(null)
                    setRouteDestination(null)
                    setRouteWaypoints([])
                    setRouteAlternatives([])
                    setActiveRouteIndex(0)
                  }}
                  className={topButtonClass}
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                  Clear
                </button>
              </div>
              <div className="mt-3 space-y-2 text-sm text-[var(--color-text-muted)]">
                <p><span className="font-medium text-[var(--color-text)]">Origin:</span> {routeOrigin?.name ?? 'Not set'}</p>
                <p><span className="font-medium text-[var(--color-text)]">Destination:</span> {routeDestination?.name ?? 'Not set'}</p>
                <p><span className="font-medium text-[var(--color-text)]">Waypoints:</span> {routeWaypoints.length ? routeWaypoints.map((item) => item.name).join(', ') : 'None'}</p>
              </div>
              {routeAlternatives.length > 0 ? (
                <div className="mt-3 rounded-[14px] bg-[var(--color-bg-soft)] p-3 text-sm text-[var(--color-text)]">
                  <p className="font-medium">Active Route</p>
                  <p className="mt-1">{routeAlternatives[activeRouteIndex]?.summary || `Route ${activeRouteIndex + 1}`}</p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleSaveComputedRoute}
                disabled={!routeOrigin || !routeDestination || routeAlternatives.length === 0 || isSavingLayer}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[var(--color-cta)] text-white text-sm font-medium rounded-[10px] hover:bg-[var(--color-cta)] transition-colors disabled:opacity-50"
              >
                <Route className="h-4 w-4" />
                Save Route Layer
              </button>
            </div>

            <div className="rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-[var(--color-text)]">Layer Draft</p>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Author freeform routes, polygons, circles, and imported geometries.
                  </p>
                </div>
                {draftLayer ? (
                  <button
                    type="button"
                    onClick={() => setDraftLayer(null)}
                    className={topButtonClass}
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
              {draftLayer ? (
                <div className="mt-3 space-y-3">
                  <input
                    value={draftLayer.name}
                    onChange={(event) =>
                      setDraftLayer((current) => current ? { ...current, name: event.target.value } : current)
                    }
                    className="w-full rounded-[12px] border px-3 py-2 text-sm"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                    placeholder="Layer name"
                  />
                  <div className="flex flex-wrap gap-2">
                    {(['select', 'linestring', 'polygon', 'rectangle', 'circle', 'point', 'freehand'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setDraftLayer((current) => current ? { ...current, drawMode: value } : current)
                        }
                        className={cn(
                          'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                          draftLayer.drawMode === value
                            ? 'bg-[var(--color-cta)] text-white'
                            : 'bg-[var(--color-bg-soft)] text-[var(--color-text)]',
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
                    <div className="rounded-[12px] bg-[var(--color-bg-soft)] px-3 py-2">
                      <p className="uppercase tracking-[0.16em]">Features</p>
                      <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{geometrySummary.featureCount}</p>
                    </div>
                    <div className="rounded-[12px] bg-[var(--color-bg-soft)] px-3 py-2">
                      <p className="uppercase tracking-[0.16em]">Area / Dist</p>
                      <p className="mt-1 text-sm font-medium text-[var(--color-text)]">
                        {geometrySummary.areaSquareMeters > 0
                          ? `${Math.round(geometrySummary.areaSquareMeters)} m²`
                          : `${Math.round(geometrySummary.distanceMeters)} m`}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handlePersistDraftLayer}
                    disabled={isSavingLayer}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-[var(--color-cta)] text-white text-sm font-medium rounded-[10px] hover:bg-[var(--color-cta)] transition-colors disabled:opacity-50"
                  >
                    {isSavingLayer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers3 className="h-4 w-4" />}
                    {draftLayer.layerId ? 'Update Layer' : 'Save Layer'}
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleStartLayerDraft('manual_draw', 'polygon', 'Area sketch')}
                    className={topButtonClass}
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                  >
                    New Area
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStartLayerDraft('routes', 'linestring', 'Manual route')}
                    className={topButtonClass}
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                  >
                    New Route
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-[var(--color-text)]">Trip Layers</p>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Persisted overlays shared across the planner, offers, and activities maps.
                  </p>
                </div>
                <span className="rounded-full bg-[rgba(114,174,230,0.12)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)]">
                  {tripLayers.length}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {isLoadingTripLayers ? (
                  <div className="text-sm text-[var(--color-text-muted)]">Loading map layers…</div>
                ) : tripLayers.length > 0 ? (
                  tripLayers.map((layer) => (
                    <div
                      key={layer.id}
                      className={cn(
                        'rounded-[14px] border p-3',
                        selectedLayerId === layer.id && 'border-[var(--color-primary)] bg-[var(--color-cta)]/6',
                      )}
                      style={{ borderColor: selectedLayerId === layer.id ? 'var(--color-primary)' : 'var(--color-border)' }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button type="button" onClick={() => setSelectedLayerId(layer.id)} className="min-w-0 text-left">
                          <p className="text-sm font-medium text-[var(--color-text)]">{layer.name}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {layer.source} · {layer.renderer} · {featureCollectionToPoints(layer.feature_collection).length} pts
                          </p>
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleToggleLayerVisibility(layer)}
                            className="rounded-[10px] p-2 hover:bg-[rgba(114,174,230,0.08)]"
                            title={layer.is_visible ? 'Hide layer' : 'Show layer'}
                          >
                            {layer.is_visible ? <Eye className="h-4 w-4 text-[var(--color-text-muted)]" /> : <EyeOff className="h-4 w-4 text-[var(--color-text-muted)]" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditLayer(layer)}
                            className="rounded-[10px] p-2 hover:bg-[rgba(114,174,230,0.08)]"
                            title="Edit layer"
                          >
                            <Pencil className="h-4 w-4 text-[var(--color-text-muted)]" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleLayerLock(layer)}
                            className="rounded-[10px] p-2 hover:bg-[rgba(114,174,230,0.08)]"
                            title={layer.is_locked ? 'Unlock layer' : 'Lock layer'}
                          >
                            {layer.is_locked ? (
                              <Unlock className="h-4 w-4 text-[var(--color-text-muted)]" />
                            ) : (
                              <Lock className="h-4 w-4 text-[var(--color-text-muted)]" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExportLayer(layer)}
                            className="rounded-[10px] p-2 hover:bg-[rgba(114,174,230,0.08)]"
                            title="Export GeoJSON"
                          >
                            <Download className="h-4 w-4 text-[var(--color-text-muted)]" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteLayer(layer)}
                            className="rounded-[10px] p-2 hover:bg-[rgba(196,95,79,0.08)]"
                            title="Delete layer"
                          >
                            <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-[var(--color-text-muted)]">
                    No layers saved yet. Draw a route or area, save viewport bounds, or import GeoJSON to start.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
              <p className="font-medium text-[var(--color-text)]">Analytics & DDS</p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Save deck.gl density overlays from the current result set or create DDS-backed experiment layers.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSaveAnalyticsLayer('heatmap')}
                  className={topButtonClass}
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                  Save Heatmap
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveAnalyticsLayer('hexagon')}
                  className={topButtonClass}
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                  Save Hex
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveAnalyticsLayer('scatter')}
                  className={topButtonClass}
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                  Save Scatter
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Boundary Feature Type
                </label>
                <select
                  value={boundaryFeatureType}
                  onChange={(event) => setBoundaryFeatureType(event.target.value as DdsBoundaryFeatureType)}
                  className="rounded-[12px] border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  {BOUNDARY_FEATURE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleSaveBoundaryLayer}
                  className={topButtonClass}
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                  Save Boundary Layer
                </button>
                <label className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Dataset ID
                </label>
                <input
                  value={datasetIdInput}
                  onChange={(event) => setDatasetIdInput(event.target.value)}
                  className="rounded-[12px] border px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                  placeholder="Google Maps dataset id"
                />
                <button
                  type="button"
                  onClick={handleSaveDatasetLayer}
                  className={topButtonClass}
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                  Save Dataset Layer
                </button>
              </div>
            </div>

            {config.features.map3D && (
              <div className="rounded-[18px] border p-4" style={{ borderColor: 'var(--color-border)' }}>
                <p className="font-medium text-[var(--color-text)]">3D Preview</p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Experimental 3D map view for the currently selected place or viewport center.
                </p>
                <div className="mt-3 overflow-hidden rounded-[18px]">
                  <GoogleMap3DPreview
                    center={{
                      lat: selectedResult?.lat ?? viewport.latitude,
                      lng: selectedResult?.lon ?? viewport.longitude,
                    }}
                    marker={
                      selectedResult?.lat != null && selectedResult?.lon != null
                        ? { lat: selectedResult.lat, lng: selectedResult.lon }
                        : null
                    }
                    height={240}
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
