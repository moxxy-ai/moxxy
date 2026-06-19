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
  /** Cache insertion order (oldest first), used to LRU-evict so the map stays bounded. */
  readonly order: ReadonlyArray<string>;
}

export const initialNav: NavState = { cache: {}, history: [], order: [] };

/**
 * Cap on the navigable history depth. Each UNNAMED view (keyed by its
 * ever-incrementing viewId, so never coalesced) pushes a fresh history frame,
 * which in turn PINS its cache entry — so without a history bound a long session
 * presenting many unnamed views would grow `history` AND `cache` (one full
 * ViewDoc per render) without limit. We trim the OLDEST history frames first
 * (a user can't realistically Back through hundreds of screens), then evict any
 * now-unreferenced cache entries. The current view and recent Back targets are
 * always retained.
 */
const MAX_HISTORY = 50;
/**
 * Cap on distinct cached view docs. Bounds the cache independently of history so
 * that even if history stays short, an LRU of off-stack screens can't grow
 * forever. Never evicts a view still referenced by the (already-bounded) stack.
 */
const MAX_CACHED_VIEWS = 64;

export interface ViewFrameLike {
  readonly viewId: string;
  readonly name?: string;
  readonly doc: ViewDoc;
}

/** Cache a freshly-arrived view and make it current. */
export function applyView(state: NavState, frame: ViewFrameLike): NavState {
  const key = frame.name ?? frame.viewId;
  const cache: Record<string, ViewEntry> = { ...state.cache, [key]: { key, viewId: frame.viewId, doc: frame.doc } };
  const top = state.history[state.history.length - 1];
  const history = top === key ? state.history.slice() : [...state.history, key];
  // Refresh recency: move (or add) key to the tail of the insertion order.
  const order = [...state.order.filter((k) => k !== key), key];
  return prune({ cache, history, order });
}

/**
 * Keep both `history` and `cache` bounded while preserving the invariant that
 * `cache` keys === `order` keys, and every `history` key is in `cache` (so Back
 * never dangles). First trim the oldest history frames past {@link MAX_HISTORY}
 * (FIFO — drop the deepest Back targets); then LRU-evict cache entries past
 * {@link MAX_CACHED_VIEWS}, oldest first, but NEVER one still on the (now
 * bounded) history stack.
 */
function prune(state: NavState): NavState {
  let history = state.history;
  if (history.length > MAX_HISTORY) {
    history = history.slice(history.length - MAX_HISTORY);
  }
  const live = new Set(history);
  const cache: Record<string, ViewEntry> = { ...state.cache };
  const order = [...state.order];
  // Walk oldest→newest, dropping evictable (non-history) keys until within cap.
  for (let i = 0; i < order.length && order.length > MAX_CACHED_VIEWS; ) {
    const key = order[i]!;
    if (live.has(key)) {
      i += 1; // pinned by history — skip, keep it
      continue;
    }
    order.splice(i, 1);
    delete cache[key];
  }
  return { cache, history, order };
}

/**
 * Client-side navigation to a cached view. Returns the new state, or null if the
 * target isn't cached (caller should request it from the agent instead).
 */
export function navigateTo(state: NavState, name: string): NavState | null {
  if (!state.cache[name]) return null;
  const top = state.history[state.history.length - 1];
  if (top === name) return state;
  // Cap history depth so repeated back-and-forth navigation can't grow it
  // without bound (drop the oldest Back targets first). `name` is already
  // cached, so trimming history never strands the entry referenced here.
  const pushed = [...state.history, name];
  const history = pushed.length > MAX_HISTORY ? pushed.slice(pushed.length - MAX_HISTORY) : pushed;
  return { ...state, history };
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
