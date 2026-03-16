import { create } from 'zustand';

interface AuthStore {
  intendedPath: string | null;
  setIntendedPath: (path: string | null) => void;
}

const INTENDED_PATH_STORAGE_KEY = 'voyager.auth.intended-path';

function readStoredIntendedPath() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage.getItem(INTENDED_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredIntendedPath(path: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (path) {
      window.sessionStorage.setItem(INTENDED_PATH_STORAGE_KEY, path);
      return;
    }

    window.sessionStorage.removeItem(INTENDED_PATH_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep the in-memory fallback.
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  intendedPath: readStoredIntendedPath(),
  setIntendedPath: (path) => {
    writeStoredIntendedPath(path);
    set({ intendedPath: path });
  },
}));
