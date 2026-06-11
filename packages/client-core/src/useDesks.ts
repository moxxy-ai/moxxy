import { useSyncExternalStore } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import { connectionStore } from './useConnection.js';
import type { Desk, DeskSession, DesksOverview } from '@moxxy/desktop-ipc-contract';

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
  // ---- desk-scoped session ops (the sidebar tree spans EVERY desk, so
  // these take explicit desk/session ids — unlike useSessions, whose store
  // is pointed at one desk at a time) -------------------------------------
  /** Add a session under `deskId` (auto-named; does not foreground it). */
  readonly createSession: (deskId: string, name?: string) => Promise<DeskSession | null>;
  /** Foreground a session anywhere — its desk becomes active too. */
  readonly setActiveSession: (id: string) => Promise<void>;
  readonly renameSession: (id: string, name: string) => Promise<void>;
  readonly removeSession: (id: string) => Promise<void>;
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
    // all swap to the new workspace in the same render. The connection /
    // chat routing key is the desk's ACTIVE SESSION id (the runner-pool
    // key), not the desk id itself.
    const prev = this.state.activeId;
    const prevConn = connectionStore.active$();
    const desk = this.state.desks.find((d) => d.id === id);
    this.set({ activeId: id });
    connectionStore.setActive(desk?.activeSessionId ?? id);
    try {
      await api().invoke('desks.setActive', { id });
      await this.refresh();
      // Re-sync in case the host resolved a different active session than
      // the (possibly stale) one we predicted.
      const fresh = this.state.desks.find((d) => d.id === id);
      if (fresh?.activeSessionId) connectionStore.setActive(fresh.activeSessionId);
    } catch (e) {
      this.set({ activeId: prev, error: toErrorMessage(e) });
      if (prevConn) connectionStore.setActive(prevConn);
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

  // ---- desk-scoped session ops --------------------------------------------
  // The sidebar's workspace tree renders EVERY desk's sessions at once, so
  // these mirror the sessionsStore mutations but address any desk/session by
  // id instead of going through that store's single tracked desk.

  createSession = async (deskId: string, name?: string): Promise<DeskSession | null> => {
    try {
      const session = await api().invoke('sessions.create', {
        deskId,
        ...(name ? { name } : {}),
      });
      await this.refresh();
      return session;
    } catch (e) {
      this.set({ error: toErrorMessage(e) });
      return null;
    }
  };

  setActiveSession = async (id: string): Promise<void> => {
    // Optimistic, mirroring setActive + sessionsStore.setActive: flip the
    // owning desk active, point its activeSessionId at the session, and
    // re-bind the connection store so the chat surface swaps in the same
    // render. The host's sessions.setActive activates the owning desk too.
    const prevActive = this.state.activeId;
    const prevDesks = this.state.desks;
    const prevConn = connectionStore.active$();
    const desk = this.state.desks.find((d) => d.sessions.some((s) => s.id === id));
    if (desk) {
      this.set({
        activeId: desk.id,
        desks: this.state.desks.map((d) =>
          d.id === desk.id ? { ...d, activeSessionId: id } : d,
        ),
      });
    }
    connectionStore.setActive(id);
    try {
      await api().invoke('sessions.setActive', { id });
      await this.refresh();
    } catch (e) {
      this.set({ activeId: prevActive, desks: prevDesks, error: toErrorMessage(e) });
      if (prevConn) connectionStore.setActive(prevConn);
    }
  };

  renameSession = async (id: string, name: string): Promise<void> => {
    try {
      await api().invoke('sessions.rename', { id, name });
      await this.refresh();
    } catch (e) {
      this.set({ error: toErrorMessage(e) });
    }
  };

  removeSession = async (id: string): Promise<void> => {
    try {
      await api().invoke('sessions.remove', { id });
      await this.refresh();
      // Removing the foregrounded session leaves the connection store on a
      // dead id — follow the host's promoted (or freshly-seeded) session.
      if (connectionStore.active$() === id) {
        const active = this.state.desks.find((d) => d.id === this.state.activeId);
        if (active) connectionStore.setActive(active.activeSessionId);
      }
    } catch (e) {
      this.set({ error: toErrorMessage(e) });
    }
  };
}

/** Shared singleton. Exported so sibling stores (the sessions store) can
 *  refresh the desk list after a mutation that changes a desk's embedded
 *  `sessions` array — not for component use (components go through
 *  {@link useDesks}). */
export const desksStore = new DesksStore();

/**
 * The desk that owns `workspaceId`. Routing ids are SESSION ids (the
 * runner-pool key), so match a desk by owning the session — or by the desk
 * id itself, which equals its default first session's id.
 */
export function deskForWorkspace(
  desks: ReadonlyArray<Desk>,
  workspaceId: string | null,
): Desk | undefined {
  if (!workspaceId) return undefined;
  return desks.find(
    (d) => d.id === workspaceId || d.sessions.some((s) => s.id === workspaceId),
  );
}

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
    createSession: desksStore.createSession,
    setActiveSession: desksStore.setActiveSession,
    renameSession: desksStore.renameSession,
    removeSession: desksStore.removeSession,
  };
}
