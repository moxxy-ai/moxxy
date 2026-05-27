import type { ViewDoc } from '@moxxy/sdk';

/**
 * Pure navigation state for the multi-view app — a view cache keyed by logical
 * name (falling back to viewId) plus a history stack. Kept DOM-free and pure so
 * it is unit-testable; the React hook in socket.ts is a thin wrapper.
 *
 * Model: each `view` frame caches its doc and pushes onto history (unless it
 * re-renders the screen already on top — then it updates in place). `navigateTo`
 * only succeeds client-side when the target is cached; otherwise the caller asks
 * the agent to build it (a `navigate:<name>` turn). `goBack` pops the stack.
 */
export interface ViewEntry {
  readonly key: string;
  readonly viewId: string;
  readonly doc: ViewDoc;
}

export interface NavState {
  readonly cache: Readonly<Record<string, ViewEntry>>;
  readonly history: ReadonlyArray<string>;
}

export const initialNav: NavState = { cache: {}, history: [] };

export interface ViewFrameLike {
  readonly viewId: string;
  readonly name?: string;
  readonly doc: ViewDoc;
}

/** Cache a freshly-arrived view and make it current. */
export function applyView(state: NavState, frame: ViewFrameLike): NavState {
  const key = frame.name ?? frame.viewId;
  const cache = { ...state.cache, [key]: { key, viewId: frame.viewId, doc: frame.doc } };
  const top = state.history[state.history.length - 1];
  const history = top === key ? state.history.slice() : [...state.history, key];
  return { cache, history };
}

/**
 * Client-side navigation to a cached view. Returns the new state, or null if the
 * target isn't cached (caller should request it from the agent instead).
 */
export function navigateTo(state: NavState, name: string): NavState | null {
  if (!state.cache[name]) return null;
  const top = state.history[state.history.length - 1];
  if (top === name) return state;
  return { ...state, history: [...state.history, name] };
}

export function goBack(state: NavState): NavState {
  if (state.history.length <= 1) return state;
  return { ...state, history: state.history.slice(0, -1) };
}

export function currentEntry(state: NavState): ViewEntry | null {
  const key = state.history[state.history.length - 1];
  return key ? state.cache[key] ?? null : null;
}

export function canGoBack(state: NavState): boolean {
  return state.history.length > 1;
}
