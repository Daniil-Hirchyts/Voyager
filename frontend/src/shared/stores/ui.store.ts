import { create } from 'zustand'

interface UIStore {
  navMenuOpen: boolean
  setNavMenuOpen: (v: boolean) => void

  commandPaletteOpen: boolean
  setCommandPaletteOpen: (v: boolean) => void
}

export const useUIStore = create<UIStore>((set) => ({
  navMenuOpen: false,
  setNavMenuOpen: (v) => set({ navMenuOpen: v }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
}))
