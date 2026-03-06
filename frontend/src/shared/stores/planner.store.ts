import { create } from 'zustand'

interface PlannerStore {
  pendingJobIds: Record<string, string>
  setPendingJobId: (tripId: string, jobId: string) => void
  clearPendingJobId: (tripId: string) => void

  expandedActivityId: string | null
  setExpandedActivityId: (id: string | null) => void

  activityDrafts: Record<string, Record<string, unknown>>
  setActivityDraft: (activityId: string, draft: Record<string, unknown>) => void
  clearActivityDraft: (activityId: string) => void
}

export const usePlannerStore = create<PlannerStore>((set) => ({
  pendingJobIds: {},
  setPendingJobId: (tripId, jobId) =>
    set((s) => ({ pendingJobIds: { ...s.pendingJobIds, [tripId]: jobId } })),
  clearPendingJobId: (tripId) =>
    set((s) => {
      const next = { ...s.pendingJobIds }
      delete next[tripId]
      return { pendingJobIds: next }
    }),

  expandedActivityId: null,
  setExpandedActivityId: (id) => set({ expandedActivityId: id }),

  activityDrafts: {},
  setActivityDraft: (activityId, draft) =>
    set((s) => ({ activityDrafts: { ...s.activityDrafts, [activityId]: draft } })),
  clearActivityDraft: (activityId) =>
    set((s) => {
      const next = { ...s.activityDrafts }
      delete next[activityId]
      return { activityDrafts: next }
    }),
}))
