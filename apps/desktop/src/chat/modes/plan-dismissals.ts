import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'moxxy.plan.dismissed.v1';
/** Enough to cover every plan still on screen; the oldest go first. */
const KEEP = 200;

const listeners = new Set<() => void>();
let dismissed: ReadonlyArray<string> | null = null;

function read(): ReadonlyArray<string> {
  if (dismissed !== null) return dismissed;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    dismissed = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    dismissed = [];
  }
  return dismissed;
}

function dismiss(planId: string): void {
  const next = [...read().filter((id) => id !== planId), planId].slice(-KEEP);
  dismissed = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Still dismissed in this window; it only comes back after a restart.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether the person dismissed this plan, and the way to. A dismissal only puts the plan's
 * answers away: the agent is not told, the plan stays readable. The plan card is drawn only
 * in the desktop, so this lives with it.
 */
export function usePlanDismissal(planId: string): { readonly dismissed: boolean; readonly dismiss: () => void } {
  const isDismissed = useSyncExternalStore(subscribe, () => read().includes(planId));
  return { dismissed: isDismissed, dismiss: useCallback(() => dismiss(planId), [planId]) };
}

/** Tests start from no dismissals. */
export function __resetPlanDismissals(): void {
  dismissed = null;
}
