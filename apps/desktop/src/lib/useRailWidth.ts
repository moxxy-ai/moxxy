import { useSyncExternalStore } from 'react';

/**
 * Width (px) of the right context rail — a tiny module store (same shape as
 * {@link useSidebarCollapsed}) so the rail and its drag handle share one source
 * of truth. Renderer-only UI state: persisted in localStorage so the chosen
 * width survives restarts, never round-tripped through prefs/IPC.
 */

const STORAGE_KEY = 'moxxy.rightRailWidth';
export const RAIL_MIN_WIDTH = 280;
/** A sanity bound for the stored value only. How wide the workbench may really
 *  be depends on the window, so the drag asks {@link benchWidthLimit}. */
export const RAIL_MAX_WIDTH = 4096;
/** The room the chat keeps beside the workbench. Mirrors `.col-main`'s
 *  `min-width`, which holds it when the window shrinks. */
export const CHAT_MIN_WIDTH = 320;
/** The design's bench width (`--frame-bench`). Stated here as a number because
 *  this store clamps and persists it; the token is the same 372. */
export const RAIL_DEFAULT_WIDTH = 372;

function clamp(n: number): number {
  return Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, Math.round(n)));
}

function readStored(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? clamp(n) : RAIL_DEFAULT_WIDTH;
  } catch {
    return RAIL_DEFAULT_WIDTH;
  }
}

/**
 * The widest the workbench can be right now: its own width plus whatever the
 * chat beside it has beyond its minimum. Measured at drag start, so the panel
 * stops where the chat would start to be squeezed rather than running on into
 * a width the layout will not give it.
 */
export function benchWidthLimit(benchWidth: number, chatWidth: number): number {
  return Math.max(RAIL_MIN_WIDTH, Math.round(benchWidth + chatWidth - CHAT_MIN_WIDTH));
}

let width = readStored();
const listeners = new Set<() => void>();

export function setRailWidth(next: number): void {
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

/** Reactive read of the persisted rail width. */
export function useRailWidth(): number {
  return useSyncExternalStore(subscribe, () => width, () => width);
}
