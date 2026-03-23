import type { SavedConversation } from './assistant.types';

export const MAX_INPUT_LENGTH = 2000;
export const SUBMIT_COOLDOWN_MS = 1500;

const CONVERSATIONS_STORAGE_KEY = (tripId: string) => `assistant-conversations-${tripId}`;

export function loadSavedConversations(tripId: string): SavedConversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_STORAGE_KEY(tripId));
    if (!raw) return [];
    return JSON.parse(raw) as SavedConversation[];
  } catch {
    return [];
  }
}

export function persistSavedConversations(tripId: string, convs: SavedConversation[]) {
  try {
    localStorage.setItem(CONVERSATIONS_STORAGE_KEY(tripId), JSON.stringify(convs));
  } catch {}
}

const HIDDEN_IDS_KEY = (tripId: string) => `assistant-hidden-ids-${tripId}`;

export function loadHiddenIds(tripId: string): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_IDS_KEY(tripId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function persistHiddenIds(tripId: string, ids: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_IDS_KEY(tripId), JSON.stringify([...ids]));
  } catch {}
}
