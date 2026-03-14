import { create } from 'zustand'

export type DayAnchor = {
  dayId: string
  label: string
  date: string
  color: string
  isInbox: boolean
}

export type PlannerSectionAnchor = 'itinerary' | 'hotel' | 'travel'

type PlannerInstruments = {
  onOpenAssistant: () => void
  onOpenSettings: () => void
  onShare: () => void
  days: DayAnchor[]
  onScrollToDay: (dayId: string) => void
  onScrollToSection: (section: PlannerSectionAnchor) => void
}

type SideRailStore = {
  plannerInstruments: PlannerInstruments | null
  setPlannerInstruments: (instruments: PlannerInstruments | null) => void
  mobilePlannerView: 'cards' | 'map'
  setMobilePlannerView: (view: 'cards' | 'map') => void
}

export const useSideRailStore = create<SideRailStore>((set) => ({
  plannerInstruments: null,
  setPlannerInstruments: (instruments) => set({ plannerInstruments: instruments }),
  mobilePlannerView: 'cards',
  setMobilePlannerView: (view) => set({ mobilePlannerView: view }),
}))
