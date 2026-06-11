/**
 * Per-workspace folder collapse state for the sidebar tree.
 *
 * Same module-store shape as {@link ./useSidebarCollapsed}: a single
 * source of truth outside React (survives unmounts), localStorage-backed
 * (survives restarts), exposed via useSyncExternalStore. The persisted
 * value is a JSON array of collapsed desk ids — expanded is the default,
 * so an empty set stores nothing at all.
 */

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'moxxy.workspacesCollapsed';

function readFromStorage(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

let collapsed: ReadonlySet<string> = readFromStorage();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function toggleWorkspaceCollapsed(deskId: string): void {
  const next = new Set(collapsed);
  if (!next.delete(deskId)) next.add(deskId);
  collapsed = next;
  try {
    if (next.size === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Best-effort persistence — collapse still works for this run.
  }
  for (const l of listeners) l();
}

/** Test hook: re-read persisted state (simulates an app restart). */
export function reloadWorkspaceCollapsedFromStorage(): void {
  collapsed = readFromStorage();
  for (const l of listeners) l();
}

/** Set of collapsed desk ids (referentially stable between toggles). */
export function useWorkspaceCollapsed(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => collapsed,
    () => collapsed,
  );
}
