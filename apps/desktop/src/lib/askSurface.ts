/**
 * Ask-surface ownership. The runner BLOCKS on every `ask.request` until it's
 * answered, so an ask must never be invisible — but it also must not render
 * twice. ChatSurface owns asks in the chat view; modals that run hidden agent
 * turns (AgentTaskModal) claim the surface while mounted; App.tsx renders a
 * global fallback only when nobody else has claimed it.
 */

import { useEffect, useSyncExternalStore } from 'react';

let owners = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Claim the ask surface for the lifetime of the calling component. */
export function useClaimAskSurface(): void {
  useEffect(() => {
    owners += 1;
    emit();
    return () => {
      owners -= 1;
      emit();
    };
  }, []);
}

/** True while any mounted component has claimed the ask surface. */
export function useAskSurfaceClaimed(): boolean {
  return useSyncExternalStore(subscribe, () => owners > 0);
}
