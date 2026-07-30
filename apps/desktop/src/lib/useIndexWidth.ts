import { useSyncExternalStore } from 'react';

/**
 * Width (px) of the index column — the same tiny module store as
 * {@link ./useRailWidth}, so the column and its drag handle share one source of
 * truth. Renderer-only UI state: persisted in localStorage so the chosen width
 * survives restarts, never round-tripped through prefs/IPC.
 *
 * The floor is set by CONTENT, not taste: a session row is an LED, a name and a
 * time reading, and below roughly 200px the name has no room left to be a name.
 * The ceiling stops the column from eating the field it is an index for.
 */

const STORAGE_KEY = 'moxxy.indexWidth';
export const INDEX_MIN_WIDTH = 200;
export const INDEX_MAX_WIDTH = 460;
export const INDEX_DEFAULT_WIDTH = 244;

function clamp(n: number): number {
  return Math.max(INDEX_MIN_WIDTH, Math.min(INDEX_MAX_WIDTH, Math.round(n)));
}

function readStored(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? clamp(n) : INDEX_DEFAULT_WIDTH;
  } catch {
    return INDEX_DEFAULT_WIDTH;
  }
}

let width = readStored();
const listeners = new Set<() => void>();

export function setIndexWidth(next: number): void {
  const clamped = clamp(next);
  if (clamped === width) return;
  width = clamped;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clamped));
  } catch {
    // Persistence is best-effort; in-memory state still drives the UI.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive read of the persisted index-column width. */
export function useIndexWidth(): number {
  return useSyncExternalStore(subscribe, () => width, () => width);
}

/** Test seam: re-read localStorage after a test mutates it directly. */
export function reloadIndexWidthFromStorage(): void {
  width = readStored();
  for (const l of listeners) l();
}
