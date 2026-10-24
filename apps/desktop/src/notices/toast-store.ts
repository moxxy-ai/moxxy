/**
 * The toasts the main window shows: short notes about something that finished
 * while the person was elsewhere in the app. One module-level store, so any
 * hook can push one and the single stack renders them.
 */

export interface Toast {
  /** A newer toast with the same id replaces the older one. */
  readonly id: string;
  readonly tone: 'success' | 'error' | 'info';
  readonly title: string;
  readonly body?: string;
  /** Takes the person to what the toast is about. */
  readonly onOpen?: () => void;
}

/** More than this crowds the corner; the oldest goes first. */
export const TOAST_LIMIT = 3;
const VISIBLE_MS = 6_000;
/** An error stays longer: it asks the person to do something. */
const ERROR_VISIBLE_MS = 10_000;

let toasts: ReadonlyArray<Toast> = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
}

export function pushToast(toast: Toast): void {
  clearTimer(toast.id);
  const kept = toasts.filter((shown) => shown.id !== toast.id);
  const next = [...kept, toast];
  for (const dropped of next.slice(0, Math.max(0, next.length - TOAST_LIMIT))) clearTimer(dropped.id);
  toasts = next.slice(-TOAST_LIMIT);
  timers.set(
    toast.id,
    setTimeout(() => dismissToast(toast.id), toast.tone === 'error' ? ERROR_VISIBLE_MS : VISIBLE_MS),
  );
  emit();
}

export function dismissToast(id: string): void {
  clearTimer(id);
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function getToasts(): ReadonlyArray<Toast> {
  return toasts;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook: an empty stack and no timers between cases. */
export function __resetToastsForTests(): void {
  for (const id of [...timers.keys()]) clearTimer(id);
  toasts = [];
  listeners.clear();
}
