import { useSyncExternalStore } from 'react';
import { api } from './api';
import { toErrorMessage } from './errors';
import { connectionStore } from './useConnection';
import type { Desk, DesksOverview } from '@moxxy/desktop-ipc-contract';

export interface UseDesks {
  readonly desks: ReadonlyArray<Desk>;
  readonly activeId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  /** Create a desk with an already-picked folder. Callers that need a
   *  one-shot "pick a folder, prompt for name, create" UX should call
   *  {@link pickFolder} first. */
  readonly create: (name: string, cwd: string) => Promise<Desk | null>;
  readonly remove: (id: string) => Promise<void>;
  readonly setActive: (id: string) => Promise<void>;
  readonly pickFolder: () => Promise<string | null>;
  readonly rename: (id: string, name: string) => Promise<void>;
}

interface DesksState {
  readonly desks: ReadonlyArray<Desk>;
  readonly activeId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const INITIAL: DesksState = { desks: [], activeId: null, loading: true, error: null };

/**
 * Module-level desks store.
 *
 * `useDesks` used to hold its overview in component-local `useState`, so
 * each consumer (the left WorkspaceSidebar AND the right ContextRail)
 * kept an INDEPENDENT copy of the list. Creating a workspace in the
 * sidebar refreshed only the sidebar's copy — the rail's list stayed
 * stale, couldn't find the freshly-created active desk, and so rendered
 * "No workspace bound". A single shared store keeps every consumer in
 * sync off one refresh, mirroring {@link connectionStore} / chatStore.
 */
class DesksStore {
  private state: DesksState = INITIAL;
  private listeners = new Set<() => void>();
  private started = false;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    // Lazy-load on the first subscriber so the data arrives once and is
    // shared, instead of every mounting consumer firing its own fetch.
    if (!this.started) {
      this.started = true;
      void this.refresh();
    }
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Cached snapshot — referentially stable until {@link set} swaps it,
   *  as useSyncExternalStore requires. */
  getSnapshot = (): DesksState => this.state;

  private set(patch: Partial<DesksState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  refresh = async (): Promise<void> => {
    this.set({ loading: true });
    try {
      const next: DesksOverview = await api().invoke('desks.list');
      this.set({
        desks: next.desks,
        activeId: next.activeId,
        error: null,
        loading: false,
      });
    } catch (e) {
      this.set({ error: toErrorMessage(e), loading: false });
    }
  };

  pickFolder = async (): Promise<string | null> => api().invoke('desks.pickFolder');

  create = async (name: string, cwd: string): Promise<Desk | null> => {
    try {
      const desk = await api().invoke('desks.create', { name, cwd });
      await this.refresh();
      return desk;
    } catch (e) {
      this.set({ error: toErrorMessage(e) });
      return null;
    }
  };

  remove = async (id: string): Promise<void> => {
    try {
      await api().invoke('desks.remove', { id });
      await this.refresh();
    } catch (e) {
      this.set({ error: toErrorMessage(e) });
    }
  };

  setActive = async (id: string): Promise<void> => {
    // Optimistic: flip the active id immediately so the sidebar highlight
    // + active workspace follow the click without waiting for the IPC +
    // the supervisor's full re-resolve. Also pre-bind the connection
    // store's active id so the chat surface, context rail, and chat store
    // all swap to the new workspace in the same render.
    const prev = this.state.activeId;
    this.set({ activeId: id });
    connectionStore.setActive(id);
    try {
      await api().invoke('desks.setActive', { id });
      await this.refresh();
    } catch (e) {
      this.set({ activeId: prev, error: toErrorMessage(e) });
      if (prev) connectionStore.setActive(prev);
    }
  };

  rename = async (id: string, name: string): Promise<void> => {
    try {
      await api().invoke('desks.rename', { id, name });
      await this.refresh();
    } catch (e) {
      this.set({ error: toErrorMessage(e) });
    }
  };
}

const desksStore = new DesksStore();

export function useDesks(): UseDesks {
  const state = useSyncExternalStore(
    desksStore.subscribe,
    desksStore.getSnapshot,
    desksStore.getSnapshot,
  );
  return {
    desks: state.desks,
    activeId: state.activeId,
    loading: state.loading,
    error: state.error,
    refresh: desksStore.refresh,
    create: desksStore.create,
    remove: desksStore.remove,
    setActive: desksStore.setActive,
    pickFolder: desksStore.pickFolder,
    rename: desksStore.rename,
  };
}
