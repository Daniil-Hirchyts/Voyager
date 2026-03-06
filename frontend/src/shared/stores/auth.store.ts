import { create } from 'zustand'

interface AuthStore {
  intendedPath: string | null
  setIntendedPath: (path: string | null) => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  intendedPath: null,
  setIntendedPath: (path) => set({ intendedPath: path }),
}))
