import { create } from 'zustand'

interface EventsStore {
  selectedEventId: string | null
  setSelectedEventId: (id: string | null) => void

  searchJobId: string | null
  setSearchJobId: (jobId: string | null) => void

  attachModalOpen: boolean
  setAttachModalOpen: (open: boolean) => void

  lightboxPhotoIndex: number | null
  setLightboxPhotoIndex: (index: number | null) => void
}

export const useEventsStore = create<EventsStore>((set) => ({
  selectedEventId: null,
  setSelectedEventId: (selectedEventId) => set({ selectedEventId }),

  searchJobId: null,
  setSearchJobId: (searchJobId) => set({ searchJobId }),

  attachModalOpen: false,
  setAttachModalOpen: (attachModalOpen) => set({ attachModalOpen }),

  lightboxPhotoIndex: null,
  setLightboxPhotoIndex: (lightboxPhotoIndex) => set({ lightboxPhotoIndex }),
}))
