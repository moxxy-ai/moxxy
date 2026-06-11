import { useSyncExternalStore } from 'react';

/**
 * Collapsed/expanded state of the left workspace rail — a tiny module
 * store (same shape as `useTheme`'s controller) so the sidebar itself,
 * the main-pane header (`ViewHeader`'s expand affordance) and the global
 * Cmd/Ctrl+B shortcut in App.tsx all share one source of truth without
 * prop-drilling through every view.
 *
 * Renderer-only UI state: persisted in localStorage so the choice
 * survives restarts, never round-tripped through prefs/IPC.
 */

const STORAGE_KEY = 'moxxy.sidebarCollapsed';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage unavailable (shouldn't happen in the renderer) — default open.
    return false;
  }
}

let collapsed = readStored();
const listeners = new Set<() => void>();

export function setSidebarCollapsed(next: boolean): void {
  if (next === collapsed) return;
  collapsed = next;
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Persistence is best-effort; in-memory state still drives the UI.
  }
  for (const l of listeners) l();
}

export function toggleSidebarCollapsed(): void {
  setSidebarCollapsed(!collapsed);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive read of the collapsed flag. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, () => collapsed, () => collapsed);
}

/**
 * Test-only: the module singleton survives across tests, so suites that
 * assert persistence re-read localStorage through this instead of
 * re-importing the module.
 */
export function reloadSidebarCollapsedFromStorage(): void {
  const next = readStored();
  if (next === collapsed) return;
  collapsed = next;
  for (const l of listeners) l();
}
