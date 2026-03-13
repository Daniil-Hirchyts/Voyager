import '@testing-library/jest-dom/vitest'
import { Fragment, createElement, forwardRef, type ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './msw/server'
import { useMapStore } from '@/shared/stores/map.store'
import { usePlannerStore } from '@/shared/stores/planner.store'
import { useSideRailStore } from '@/shared/stores/side-rail.store'
import { buildPlace, buildTrip } from '@/test/fixtures/api'

vi.mock('react-oidc-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: {
      profile: {
        name: 'Voyager User',
        email: 'voyager_user@example.com',
        picture: null,
      },
    },
    signinRedirect: vi.fn(),
    signoutRedirect: vi.fn(),
  }),
}))

const googleMapStub = {
  panTo: vi.fn(),
  setZoom: vi.fn(),
  getZoom: vi.fn(() => 12),
  fitBounds: vi.fn(),
  setCenter: vi.fn(),
  getBounds: vi.fn(() => ({
    getNorthEast: () => ({ lat: () => 48.87, lng: () => 2.35 }),
    getSouthWest: () => ({ lat: () => 48.84, lng: () => 2.31 }),
  })),
  getFeatureLayer: vi.fn(() => ({ style: null })),
  getDatasetFeatureLayer: vi.fn(() => ({ style: null })),
  addListener: vi.fn(() => ({ remove: vi.fn() })),
}

class MarkerStub {
  map: unknown = null
  constructor(public options: Record<string, unknown> = {}) {}
  addListener() {
    return { remove: vi.fn() }
  }
  setMap(map: unknown) {
    this.map = map
  }
}

class AdvancedMarkerElementStub {
  map: unknown = null
  content: Node | null
  constructor(public options: Record<string, unknown> = {}) {
    this.content = (options.content as Node | undefined) ?? null
  }
  addListener() {
    return { remove: vi.fn() }
  }
}

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
  Map: forwardRef<HTMLDivElement, { children?: ReactNode }>(function MapStub(
    { children, className, style },
    ref,
  ) {
    return createElement('div', { ref, className, style, 'data-testid': 'google-map-stub' }, children)
  }),
  Marker: ({
    children,
    onClick,
    title,
    label,
  }: {
    children?: ReactNode
    onClick?: () => void
    title?: string
    label?: { text?: string }
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'google-marker-stub',
        'aria-label': title ?? label?.text ?? 'Map marker',
        onClick,
      },
      children ?? title ?? label?.text ?? null,
    ),
  AdvancedMarker: ({
    children,
    onClick,
    title,
  }: {
    children?: ReactNode
    onClick?: () => void
    title?: string
  }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'google-advanced-marker-stub',
        'aria-label': title ?? 'Map marker',
        onClick,
      },
      children ?? title ?? null,
    ),
  InfoWindow: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'google-info-window-stub' }, children),
  MapControl: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'google-map-control-stub' }, children),
  Pin: () => createElement('div', { 'data-testid': 'google-pin-stub' }),
  StaticMap: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'google-static-map-stub' }, children),
  ControlPosition: {
    TOP_LEFT: 1,
    TOP_RIGHT: 2,
    BOTTOM_LEFT: 3,
    BOTTOM_RIGHT: 4,
  },
  useMap: () => googleMapStub,
  useMapsLibrary: (name: string) => {
    if (name === 'marker') {
      return {
        AdvancedMarkerElement: AdvancedMarkerElementStub,
        PinElement: class {
          element = document.createElement('div')
        },
      }
    }

    if (name === 'geocoding') {
      return {
        Geocoder: class {
          geocode() {
            return Promise.resolve({ results: [] })
          }
        }
      }
    }

    if (name === 'geometry') {
      return {
        spherical: {
          computeLength: vi.fn(() => 0),
          computeArea: vi.fn(() => 0),
          computeHeading: vi.fn(() => 0),
          computeDistanceBetween: vi.fn(() => 0),
        },
        poly: {
          containsLocation: vi.fn(() => false),
          isLocationOnEdge: vi.fn(() => false),
        },
        encoding: {
          encodePath: vi.fn(() => ''),
          decodePath: vi.fn(() => []),
        },
      }
    }

    if (name === 'maps3d') {
      return {}
    }

    return {}
  },
}))

vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: class {
    clearMarkers() {}
  },
}))

vi.mock('@deck.gl/google-maps', () => ({
  GoogleMapsOverlay: class {
    setMap() {}
    setProps() {}
  },
}))

vi.mock('terra-draw', () => {
  class TerraDrawStub {
    start() {}
    stop() {}
    setMode() {}
    addFeatures() {}
    clear() {}
    getSnapshot() {
      return []
    }
    on() {}
  }

  class ModeStub {}

  return {
    TerraDraw: TerraDrawStub,
    TerraDrawCircleMode: ModeStub,
    TerraDrawFreehandLineStringMode: ModeStub,
    TerraDrawLineStringMode: ModeStub,
    TerraDrawPointMode: ModeStub,
    TerraDrawPolygonMode: ModeStub,
    TerraDrawRectangleMode: ModeStub,
    TerraDrawSelectMode: ModeStub,
  }
})

vi.mock('terra-draw-google-maps-adapter', () => ({
  TerraDrawGoogleMapsAdapter: class {},
}))

const initialMapState = useMapStore.getState()
const initialPlannerState = usePlannerStore.getState()
const initialSideRailState = useSideRailStore.getState()

const defaultServerHandlers = [
  http.get('http://localhost:8000/users/profile', () =>
    HttpResponse.json({
      id: 'user-profile-1',
      keycloak_sub: 'voyager-user',
      email: 'voyager_user@example.com',
      first_name: 'Voyager',
      last_name: 'User',
      display_name: 'Voyager User',
      avatar_url: null,
      avatar_thumbnail_url: null,
      preferences: {},
      created_at: '2026-03-06T09:00:00.000Z',
      updated_at: '2026-03-06T09:00:00.000Z',
    }),
  ),
  http.get('http://localhost:8000/trips/:tripId', ({ params }) =>
    HttpResponse.json(buildTrip({ id: String(params.tripId) })),
  ),
  http.get('http://localhost:8000/trips/:tripId/map-layers', () =>
    HttpResponse.json({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    }),
  ),
  http.get('http://localhost:8000/places/autocomplete', () =>
    HttpResponse.json({
      total: 0,
      limit: 4,
      offset: 0,
      items: [],
    }),
  ),
  http.get('http://localhost:8000/places/:placeId', ({ params }) =>
    HttpResponse.json(buildPlace({ id: String(params.placeId) })),
  ),
  http.get('http://localhost:8000/trips/:tripId/planner-map/places/:placeId/detail', ({ params }) =>
    HttpResponse.json({
      place: buildPlace({ id: String(params.placeId) }),
      summary: null,
      rating: null,
      review_count: null,
      status_text: null,
      price_label: null,
      photos: [],
      reviews: [],
      hours: [],
      booking_links: [],
      tags: [],
      mentions: [],
      related_activities: [],
    }),
  ),
  http.get('http://localhost:8000/trips/:tripId/activities/discover', ({ params }) =>
    HttpResponse.json({
      total: 0,
      limit: 6,
      offset: 0,
      page: 1,
      entity_type: 'attraction',
      items: [],
      tripId: params.tripId,
    }),
  ),
  http.get('http://localhost:8000/trips/:tripId/activities', () =>
    HttpResponse.json({
      total: 0,
      limit: 100,
      offset: 0,
      items: [],
    }),
  ),
  http.post('http://localhost:8000/trips/:tripId/activities/recommendations', () =>
    HttpResponse.json({
      total: 0,
      items: [],
    }),
  ),
  http.get('http://localhost:8000/trips/:tripId/assets', () =>
    HttpResponse.json({
      total: 0,
      items: [],
    }),
  ),
  http.post('http://localhost:8000/trips/:tripId/assets', () =>
    HttpResponse.json(
      {
        id: 'asset-uploaded',
        user_id: 'user-1',
        trip_id: 'trip-1',
        activity_id: null,
        kind: 'file',
        original_filename: 'uploaded.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        sha256: 'uploaded-sha',
        image_width: null,
        image_height: null,
        preview_url: 'http://localhost:9000/voyager-media/uploaded-preview?signature=test',
        download_url: 'http://localhost:9000/voyager-media/uploaded?signature=test',
        created_at: '2026-03-06T09:00:00.000Z',
        updated_at: '2026-03-06T09:00:00.000Z',
      },
      { status: 201 },
    ),
  ),
  http.delete('http://localhost:8000/assets/:assetId', () => new HttpResponse(null, { status: 204 })),
  http.post('http://localhost:8000/routes/legs', () =>
    HttpResponse.json({
      items: [],
      total_distance_km: 0,
      total_duration_min: 0,
    }),
  ),
]

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.use(...defaultServerHandlers)
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('__voyagerGoogleMapStub', googleMapStub)
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )

  if (!HTMLElement.prototype.hasPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    })
  }

  if (!HTMLElement.prototype.setPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
  }

  if (!HTMLElement.prototype.releasePointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
  }

  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  }

  vi.stubGlobal('google', {
    maps: {
      marker: {
        AdvancedMarkerElement: AdvancedMarkerElementStub,
      },
      SymbolPath: {
        CIRCLE: 0,
      },
      Marker: MarkerStub,
      Polyline: class {
        setMap() {}
        setPath() {}
      },
      Polygon: class {
        setMap() {}
      },
      Circle: class {
        setMap() {}
      },
      Rectangle: class {
        setMap() {}
      },
      Data: class {
        addGeoJson() {}
        setStyle() {}
        setMap() {}
        forEach() {}
        remove() {}
      },
      LatLngBounds: class {
        extend() {}
      },
      DirectionsService: class {
        route() {
          return Promise.resolve({ routes: [] })
        }
      },
      TravelMode: {
        WALKING: 'WALKING',
        DRIVING: 'DRIVING',
      },
    },
  })
})

afterEach(() => {
  cleanup()
  globalThis.localStorage?.clear?.()
  globalThis.sessionStorage?.clear?.()
  server.resetHandlers()
  server.use(...defaultServerHandlers)
  useMapStore.setState(initialMapState, true)
  usePlannerStore.setState(initialPlannerState, true)
  useSideRailStore.setState(initialSideRailState, true)
})

afterAll(() => {
  server.close()
})
