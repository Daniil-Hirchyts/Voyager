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
  onOpenSettings: () => void
  onGenerate: () => void
  days: DayAnchor[]
  onScrollToDay: (dayId: string) => void
  onScrollToSection: (section: PlannerSectionAnchor) => void
}

type SideRailStore = {
  plannerInstruments: PlannerInstruments | null
  setPlannerInstruments: (instruments: PlannerInstruments | null) => void
}

export const useSideRailStore = create<SideRailStore>((set) => ({
  plannerInstruments: null,
  setPlannerInstruments: (instruments) => set({ plannerInstruments: instruments }),
}))
