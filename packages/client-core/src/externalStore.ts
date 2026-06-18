/**
 * Tiny generic primitives shared by the hand-rolled module-level stores in
 * this package (desks / sessions / connection) that back React's
 * `useSyncExternalStore`.
 *
 * Each store used to re-implement the same listener-`Set` + `subscribe` +
 * `emit` + `Partial`-patch `set` boilerplate, plus a copy-pasted optimistic
 * "snapshot prev → set optimistic → IPC → rollback on catch" switch gesture
 * (with subtly different rollback fields — a fertile ground for partial
 * rollback bugs). These helpers centralise that contract WITHOUT changing
 * the observable semantics:
 *
 *  - `getSnapshot` returns a referentially STABLE value until `set`/`replace`
 *    swaps it (so `useSyncExternalStore` doesn't tear or re-render spuriously);
 *  - `set`/`replace` emit to every current listener synchronously, in
 *    insertion order;
 *  - `runOptimistic` captures the connection store's active id, applies the
 *    optimistic mutation, runs the async commit, and on failure restores BOTH
 *    the caller-supplied store rollback AND the connection active id.
 */

/** A bare subscriber set: `subscribe` + synchronous `emit`. */
export interface ListenerSet {
  /** Register `fn`; returns an unsubscribe that removes exactly this `fn`. */
  readonly subscribe: (fn: () => void) => () => void;
  /** Notify every current listener synchronously, in insertion order. */
  readonly emit: () => void;
}

export function createListenerSet(): ListenerSet {
  const listeners = new Set<() => void>();
  return {
    subscribe: (fn: () => void): (() => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit: (): void => {
      for (const l of listeners) l();
    },
  };
}

/**
 * A flat-state external store: a referentially-stable snapshot plus
 * `Partial`-patch `set` and full `replace`, each emitting to subscribers.
 */
export interface PatchStore<T> {
  /** Referentially stable until {@link PatchStore.set}/{@link PatchStore.replace}. */
  readonly getSnapshot: () => T;
  readonly subscribe: (fn: () => void) => () => void;
  /** Notify subscribers without changing state (rare; mirrors a manual emit). */
  readonly emit: () => void;
  /** Shallow-merge `patch` into the current snapshot, then emit. */
  readonly set: (patch: Partial<T>) => void;
  /** Swap the whole snapshot, then emit. */
  readonly replace: (next: T) => void;
}

export function createPatchStore<T>(initial: T): PatchStore<T> {
  let state = initial;
  const { subscribe, emit } = createListenerSet();
  return {
    getSnapshot: (): T => state,
    subscribe,
    emit,
    set: (patch: Partial<T>): void => {
      state = { ...state, ...patch };
      emit();
    },
    replace: (next: T): void => {
      state = next;
      emit();
    },
  };
}

/** The connection-active surface `runOptimistic` captures and restores. */
export interface ActiveBinding {
  readonly active$: () => string | null;
  readonly setActive: (id: string | null) => void;
}

/**
 * The shared optimistic-switch gesture used by the desks/sessions
 * `setActive*` paths: snapshot the connection active id, run `apply`
 * (the optimistic local-first mutation), await `commit` (the IPC + any
 * refresh), and on failure restore BOTH the caller's store rollback and
 * the captured connection active id.
 *
 * The caller owns `apply`/`rollback` because the store-state fields differ
 * per call site (some patch a desks array, some only the active id); the
 * connection capture/restore contract lives here so it can never drift.
 * The error is passed to `rollback` (call sites fold it into their store
 * `error` field) and is NOT rethrown — matching the original swallow-and-
 * surface-via-state behaviour of every call site.
 */
export async function runOptimistic(
  conn: ActiveBinding,
  apply: () => void,
  commit: () => Promise<void>,
  rollback: (error: unknown) => void,
): Promise<void> {
  const prevConn = conn.active$();
  apply();
  try {
    await commit();
  } catch (e) {
    rollback(e);
    if (prevConn) conn.setActive(prevConn);
  }
}
