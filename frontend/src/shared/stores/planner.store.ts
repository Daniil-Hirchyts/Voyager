import { create } from 'zustand'
import type { PlannerGenerationReport } from '@/shared/api/types'

interface PlannerStore {
  pendingJobIds: Record<string, string>
  setPendingJobId: (tripId: string, jobId: string) => void
  clearPendingJobId: (tripId: string) => void

  generationReports: Record<string, PlannerGenerationReport>
  setGenerationReport: (tripId: string, report: PlannerGenerationReport) => void
  clearGenerationReport: (tripId: string) => void

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

  generationReports: {},
  setGenerationReport: (tripId, report) =>
    set((s) => ({ generationReports: { ...s.generationReports, [tripId]: report } })),
  clearGenerationReport: (tripId) =>
    set((s) => {
      const next = { ...s.generationReports }
      delete next[tripId]
      return { generationReports: next }
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
