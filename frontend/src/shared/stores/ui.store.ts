import { create } from 'zustand'

interface UIStore {
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebar: () => void

  navMenuOpen: boolean
  setNavMenuOpen: (v: boolean) => void

  commandPaletteOpen: boolean
  setCommandPaletteOpen: (v: boolean) => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  navMenuOpen: false,
  setNavMenuOpen: (v) => set({ navMenuOpen: v }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
}))
