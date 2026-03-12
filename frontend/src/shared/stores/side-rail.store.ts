import { create } from 'zustand'

type PlannerInstruments = {
  onOpenSettings: () => void
}

type SideRailStore = {
  plannerInstruments: PlannerInstruments | null
  setPlannerInstruments: (instruments: PlannerInstruments | null) => void
}

export const useSideRailStore = create<SideRailStore>((set) => ({
  plannerInstruments: null,
  setPlannerInstruments: (instruments) => set({ plannerInstruments: instruments }),
}))
