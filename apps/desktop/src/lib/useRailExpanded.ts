import { useSyncExternalStore } from 'react';

/**
 * Whether the app rail shows labels beside its icons.
 *
 * The rail is icon-only by default because it is permanent chrome and 52px is
 * the whole point. But an icon-only rail is unreadable on first contact — a
 * hover tooltip only helps someone who already suspects there is something
 * there to hover. So the rail expands to a labelled column and REMEMBERS the
 * choice: a new user opens it once, reads the five destinations, and either
 * keeps it or folds it back for good.
 *
 * Renderer-only UI state: persisted in localStorage so the choice survives
 * restarts, never round-tripped through prefs/IPC. Same shape as
 * {@link ./useSidebarCollapsed}.
 */

const STORAGE_KEY = 'moxxy.railExpanded';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage unavailable (shouldn't happen in the renderer) — default compact.
    return false;
  }
}

let expanded = readStored();
const listeners = new Set<() => void>();

export function setRailExpanded(next: boolean): void {
  if (next === expanded) return;
  expanded = next;
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Persistence is best-effort; in-memory state still drives the UI.
  }
  for (const l of listeners) l();
}

export function toggleRailExpanded(): void {
  setRailExpanded(!expanded);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive read of the persisted rail-expanded flag. */
export function useRailExpanded(): boolean {
  return useSyncExternalStore(subscribe, () => expanded, () => expanded);
}

/** Test seam: re-read localStorage after a test mutates it directly. */
export function reloadRailExpandedFromStorage(): void {
  expanded = readStored();
  for (const l of listeners) l();
}
