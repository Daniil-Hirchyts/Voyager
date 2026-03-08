import '@testing-library/jest-dom/vitest'
import { Fragment, createElement, forwardRef, type ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from './msw/server'
import { useMapStore } from '@/shared/stores/map.store'
import { useOffersStore } from '@/shared/stores/offers.store'
import { usePlannerStore } from '@/shared/stores/planner.store'
import { useExportsStore } from '@/shared/stores/exports.store'

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
    { children },
    ref,
  ) {
    return createElement('div', { ref, 'data-testid': 'google-map-stub' }, children)
  }),
  Marker: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'google-marker-stub' }, children),
  AdvancedMarker: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'google-advanced-marker-stub' }, children),
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
const initialOffersState = useOffersStore.getState()
const initialPlannerState = usePlannerStore.getState()
const initialExportsState = useExportsStore.getState()
const defaultServerHandlers = [
  http.get('http://localhost:8000/trips/:tripId/map-layers', () =>
    HttpResponse.json({
      items: [],
      total: 0,
      limit: 200,
      offset: 0,
    }),
  ),
]

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.use(...defaultServerHandlers)
  vi.stubGlobal('scrollTo', vi.fn())
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
  server.resetHandlers()
  server.use(...defaultServerHandlers)
  useMapStore.setState(initialMapState, true)
  useOffersStore.setState(initialOffersState, true)
  usePlannerStore.setState(initialPlannerState, true)
  useExportsStore.setState(initialExportsState, true)
})

afterAll(() => {
  server.close()
})
