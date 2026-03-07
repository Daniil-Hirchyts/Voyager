import { create } from 'zustand'

interface ProposalsStore {
  selectedProposalId: string | null
  setSelectedProposalId: (id: string | null) => void

  optimizeJobId: string | null
  setOptimizeJobId: (jobId: string | null) => void

  comparisonPanelOpen: boolean
  setComparisonPanelOpen: (open: boolean) => void
}

export const useProposalsStore = create<ProposalsStore>((set) => ({
  selectedProposalId: null,
  setSelectedProposalId: (selectedProposalId) => set({ selectedProposalId }),

  optimizeJobId: null,
  setOptimizeJobId: (optimizeJobId) => set({ optimizeJobId }),

  comparisonPanelOpen: false,
  setComparisonPanelOpen: (comparisonPanelOpen) => set({ comparisonPanelOpen }),
}))
