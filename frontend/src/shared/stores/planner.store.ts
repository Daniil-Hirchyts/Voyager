import { create } from 'zustand'
import { persist, type PersistStorage, type StateStorage, type StorageValue } from 'zustand/middleware'
import type { PlannerGenerationReport } from '@/shared/api/types'

type AssistantLauncherPosition = {
  x: number
  y: number
}

interface PlannerStore {
  pendingJobIds: Record<string, string>
  setPendingJobId: (tripId: string, jobId: string) => void
  clearPendingJobId: (tripId: string) => void

  generationReports: Record<string, PlannerGenerationReport>
  setGenerationReport: (tripId: string, report: PlannerGenerationReport) => void
  clearGenerationReport: (tripId: string) => void

  assistantPanelOpenByTrip: Record<string, boolean>
  setAssistantPanelOpen: (tripId: string, isOpen: boolean) => void

  assistantLauncherPosition: AssistantLauncherPosition | null
  setAssistantLauncherPosition: (position: AssistantLauncherPosition) => void

  expandedActivityId: string | null
  setExpandedActivityId: (id: string | null) => void

  activityDrafts: Record<string, Record<string, unknown>>
  setActivityDraft: (activityId: string, draft: Record<string, unknown>) => void
  clearActivityDraft: (activityId: string) => void

  mapDayAccordionStateByTrip: Record<string, Record<string, boolean>>
  setMapDayAccordionState: (tripId: string, dayStates: Record<string, boolean>) => void
  clearMapDayAccordionState: (tripId: string) => void
}

const plannerStoreInitialState = {
  pendingJobIds: {},
  generationReports: {},
  assistantPanelOpenByTrip: {},
  assistantLauncherPosition: null,
  expandedActivityId: null,
  activityDrafts: {},
  mapDayAccordionStateByTrip: {},
} satisfies Pick<
  PlannerStore,
  | 'pendingJobIds'
  | 'generationReports'
  | 'assistantPanelOpenByTrip'
  | 'assistantLauncherPosition'
  | 'expandedActivityId'
  | 'activityDrafts'
  | 'mapDayAccordionStateByTrip'
>

type PlannerStorePersistedState = Pick<
  PlannerStore,
  'mapDayAccordionStateByTrip' | 'assistantLauncherPosition'
>

const plannerStoreMemoryStorage = new Map<string, string>()

function resolvePlannerStateStorage(): StateStorage {
  const storage = globalThis.localStorage
  if (
    storage &&
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function'
  ) {
    return storage
  }
  return {
    getItem: (name) => plannerStoreMemoryStorage.get(name) ?? null,
    setItem: (name, value) => {
      plannerStoreMemoryStorage.set(name, value)
    },
    removeItem: (name) => {
      plannerStoreMemoryStorage.delete(name)
    },
  }
}

const plannerStoreStorage: PersistStorage<PlannerStorePersistedState> = {
  getItem: (name) => {
    const value = resolvePlannerStateStorage().getItem(name)
    if (value instanceof Promise) {
      return value
        .then((resolved) => {
          if (!resolved) {
            return null
          }
          try {
            return JSON.parse(resolved) as StorageValue<PlannerStorePersistedState>
          } catch {
            return null
          }
        })
    }
    if (!value) {
      return null
    }
    try {
      return JSON.parse(value) as StorageValue<PlannerStorePersistedState>
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    resolvePlannerStateStorage().setItem(name, JSON.stringify(value))
  },
  removeItem: (name) => {
    resolvePlannerStateStorage().removeItem(name)
  },
}

export const usePlannerStore = create<PlannerStore>()(
  persist(
    (set) => ({
      ...plannerStoreInitialState,
      setPendingJobId: (tripId, jobId) =>
        set((s) => ({ pendingJobIds: { ...s.pendingJobIds, [tripId]: jobId } })),
      clearPendingJobId: (tripId) =>
        set((s) => {
          const next = { ...s.pendingJobIds }
          delete next[tripId]
          return { pendingJobIds: next }
        }),

      setGenerationReport: (tripId, report) =>
        set((s) => ({ generationReports: { ...s.generationReports, [tripId]: report } })),
      clearGenerationReport: (tripId) =>
        set((s) => {
          const next = { ...s.generationReports }
          delete next[tripId]
          return { generationReports: next }
        }),

      setAssistantPanelOpen: (tripId, isOpen) =>
        set((s) => ({
          assistantPanelOpenByTrip: { ...s.assistantPanelOpenByTrip, [tripId]: isOpen },
        })),
      setAssistantLauncherPosition: (position) => set({ assistantLauncherPosition: position }),

      setExpandedActivityId: (id) => set({ expandedActivityId: id }),

      setActivityDraft: (activityId, draft) =>
        set((s) => ({ activityDrafts: { ...s.activityDrafts, [activityId]: draft } })),
      clearActivityDraft: (activityId) =>
        set((s) => {
          const next = { ...s.activityDrafts }
          delete next[activityId]
          return { activityDrafts: next }
        }),

      setMapDayAccordionState: (tripId, dayStates) =>
        set((s) => ({
          mapDayAccordionStateByTrip: { ...s.mapDayAccordionStateByTrip, [tripId]: dayStates },
        })),
      clearMapDayAccordionState: (tripId) =>
        set((s) => {
          const next = { ...s.mapDayAccordionStateByTrip }
          delete next[tripId]
          return { mapDayAccordionStateByTrip: next }
        }),
    }),
    {
      name: 'voyager-planner-store',
      storage: plannerStoreStorage,
      partialize: (state) => ({
        mapDayAccordionStateByTrip: state.mapDayAccordionStateByTrip,
        assistantLauncherPosition: state.assistantLauncherPosition,
      }),
    },
  ),
)
