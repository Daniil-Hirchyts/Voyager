import { create } from 'zustand'

export type OffersTab = 'all' | 'transport' | 'lodging' | 'rentals'

interface OffersStore {
  activeTab: OffersTab
  setActiveTab: (tab: OffersTab) => void

  filtersOpen: boolean
  setFiltersOpen: (open: boolean) => void

  selectedOfferId: string | null
  setSelectedOfferId: (offerId: string | null) => void

  lastTransportJobId: string | null
  setLastTransportJobId: (jobId: string | null) => void

  lastLodgingJobId: string | null
  setLastLodgingJobId: (jobId: string | null) => void
}

export const useOffersStore = create<OffersStore>((set) => ({
  activeTab: 'all',
  setActiveTab: (activeTab) => set({ activeTab }),

  filtersOpen: false,
  setFiltersOpen: (filtersOpen) => set({ filtersOpen }),

  selectedOfferId: null,
  setSelectedOfferId: (selectedOfferId) => set({ selectedOfferId }),

  lastTransportJobId: null,
  setLastTransportJobId: (lastTransportJobId) => set({ lastTransportJobId }),

  lastLodgingJobId: null,
  setLastLodgingJobId: (lastLodgingJobId) => set({ lastLodgingJobId }),
}))
