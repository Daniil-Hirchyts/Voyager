import { create } from 'zustand'
import type { ExportFormat } from '@/shared/api/types'

export interface PendingExport {
  jobId: string
  format: ExportFormat
  submittedAt: string
}

interface ExportsStore {
  pendingExports: PendingExport[]
  addPendingExport: (entry: PendingExport) => void
  clearPendingExports: () => void

  selectedExportId: string | null
  setSelectedExportId: (id: string | null) => void

  auditDetailEntryId: string | null
  setAuditDetailEntryId: (id: string | null) => void
}

export const useExportsStore = create<ExportsStore>((set) => ({
  pendingExports: [],
  addPendingExport: (entry) =>
    set((s) => ({ pendingExports: [entry, ...s.pendingExports] })),
  clearPendingExports: () => set({ pendingExports: [] }),

  selectedExportId: null,
  setSelectedExportId: (selectedExportId) => set({ selectedExportId }),

  auditDetailEntryId: null,
  setAuditDetailEntryId: (auditDetailEntryId) => set({ auditDetailEntryId }),
}))
