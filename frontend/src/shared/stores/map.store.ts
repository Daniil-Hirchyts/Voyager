import { create } from 'zustand'

export type MapSearchMode = 'search' | 'nearby' | 'viewport'

export interface MapViewportState {
  latitude: number
  longitude: number
  zoom: number
}

interface MapStore {
  mode: MapSearchMode
  setMode: (mode: MapSearchMode) => void

  selectedPlaceId: string | null
  setSelectedPlaceId: (placeId: string | null) => void

  viewport: MapViewportState
  setViewport: (viewport: Partial<MapViewportState>) => void

  mobilePanel: 'list' | 'map'
  setMobilePanel: (panel: 'list' | 'map') => void
}

export const useMapStore = create<MapStore>((set) => ({
  mode: 'search',
  setMode: (mode) => set({ mode }),

  selectedPlaceId: null,
  setSelectedPlaceId: (selectedPlaceId) => set({ selectedPlaceId }),

  viewport: {
    latitude: 48.8566,
    longitude: 2.3522,
    zoom: 11,
  },
  setViewport: (viewport) =>
    set((state) => ({ viewport: { ...state.viewport, ...viewport } })),

  mobilePanel: 'list',
  setMobilePanel: (mobilePanel) => set({ mobilePanel }),
}))
