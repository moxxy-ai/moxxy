/**
 * Per-desk session list — multiple conversations per workspace.
 *
 * Module-level store cloned from the {@link DesksStore} pattern: one
 * shared snapshot for every consumer, optimistic active-id flips, and
 * the same "connectionStore.setActive first, IPC second" switch gesture
 * the desks store (and the mobile app's selectWorkspace) uses. The
 * store tracks ONE desk at a time (the sidebar shows the active desk's
 * sessions); switching desks re-points it via {@link useSessions}'s
 * effect.
 *
 * Switching sessions is local-first: `connectionStore.setActive(id)`
 * swaps the chat surface instantly (chatStore follows via App.tsx's
 * activeWorkspaceId mirror), then `sessions.setActive` makes the host
 * persist + foreground that session's runner.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import { createPatchStore, runOptimistic, type PatchStore } from './externalStore.js';
import { connectionStore } from './useConnection.js';
import { desksStore } from './useDesks.js';
import { composerDraftStore } from './composerDraftStore.js';
import type { DeskSession, SessionsOverview } from '@moxxy/desktop-ipc-contract';

export interface UseSessions {
  readonly sessions: ReadonlyArray<DeskSession>;
  readonly activeSessionId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  /** Create a session under the tracked desk (auto-named "Session N"
   *  unless `name` is given). Does not foreground it. */
  readonly create: (name?: string) => Promise<DeskSession | null>;
  readonly setActive: (id: string) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly rename: (id: string, name: string) => Promise<void>;
}

interface SessionsState {
  /** The desk whose sessions are loaded. */
  readonly deskId: string | null;
  readonly sessions: ReadonlyArray<DeskSession>;
  readonly activeSessionId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const INITIAL: SessionsState = {
  deskId: null,
  sessions: [],
  activeSessionId: null,
  loading: false,
  error: null,
};

class SessionsStore {
  private readonly store: PatchStore<SessionsState> = createPatchStore(INITIAL);
  private get state(): SessionsState {
    return this.store.getSnapshot();
  }

  subscribe = this.store.subscribe;

  /** Cached snapshot — referentially stable until {@link set} swaps it. */
  getSnapshot = this.store.getSnapshot;

  private set(patch: Partial<SessionsState>): void {
    this.store.set(patch);
  }

  /** Point the store at a desk (null clears it). Triggers a load. */
  setDesk(deskId: string | null): void {
    if (this.state.deskId === deskId) return;
    this.store.replace({ ...INITIAL, deskId, loading: deskId !== null });
    if (deskId) void this.refresh();
  }

  refresh = async (): Promise<void> => {
    const deskId = this.state.deskId;
    if (!deskId) return;
    try {
      const next: SessionsOverview = await api().invoke('sessions.list', { deskId });
      // A desk switch can race the round-trip — drop a stale response.
      if (this.state.deskId !== deskId) return;
      this.set({
        sessions: next.sessions,
        activeSessionId: next.activeSessionId,
        loading: false,
        error: null,
      });
    } catch (e) {
      if (this.state.deskId !== deskId) return;
      this.set({ error: toErrorMessage(e), loading: false });
    }
  };

  create = async (name?: string): Promise<DeskSession | null> => {
    const deskId = this.state.deskId;
    try {
      const session = await api().invoke('sessions.create', {
        ...(deskId ? { deskId } : {}),
        ...(name ? { name } : {}),
      });
      await this.refresh();
      // Desks embed their sessions array — keep the desk list in step so
      // session-aware desk lookups (chat header, context rail) stay fresh.
      void desksStore.refresh();
      return session;
    } catch (e) {
      this.set({ error: toErrorMessage(e) });
      return null;
    }
  };

  setActive = async (id: string): Promise<void> => {
    // Optimistic: re-point the connection store (and with it the chat
    // surface + chat store via the activeWorkspaceId mirror) immediately —
    // exactly the desks-store switch gesture / mobile's selectWorkspace.
    const prevActive = this.state.activeSessionId;
    await runOptimistic(
      connectionStore,
      () => {
        this.set({ activeSessionId: id });
        connectionStore.setActive(id);
      },
      async () => {
        await api().invoke('sessions.setActive', { id });
        await this.refresh();
        await desksStore.refresh();
      },
      (e) => this.set({ activeSessionId: prevActive, error: toErrorMessage(e) }),
    );
  };

  remove = async (id: string): Promise<void> => {
    try {
      await api().invoke('sessions.remove', { id });
      // Forget any composer draft staged for the now-deleted session so it
      // can't linger in the module-level store (or resurface on id reuse).
      composerDraftStore.dropWorkspace(id);
      await this.refresh();
      void desksStore.refresh();
      // Removing the foregrounded session leaves the connection store on a
      // dead id — follow the host's promoted (or freshly-seeded) session.
      const nextActive = this.state.activeSessionId;
      if (connectionStore.active$() === id && nextActive) {
        connectionStore.setActive(nextActive);
      }
    } catch (e) {
      this.set({ error: toErrorMessage(e) });
    }
  };

  rename = async (id: string, name: string): Promise<void> => {
    try {
      await api().invoke('sessions.rename', { id, name });
      await this.refresh();
      void desksStore.refresh();
    } catch (e) {
      this.set({ error: toErrorMessage(e) });
    }
  };
}

/** Shared singleton (exported for tests — components use {@link useSessions}). */
export const sessionsStore = new SessionsStore();

/**
 * Sessions of one desk (pass the ACTIVE desk id; the sidebar's session
 * list is scoped to it). Re-points the shared store when the desk
 * changes.
 */
export function useSessions(deskId: string | null): UseSessions {
  const state = useSyncExternalStore(
    sessionsStore.subscribe,
    sessionsStore.getSnapshot,
    sessionsStore.getSnapshot,
  );
  useEffect(() => {
    sessionsStore.setDesk(deskId);
  }, [deskId]);
  return {
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    loading: state.loading,
    error: state.error,
    refresh: sessionsStore.refresh,
    create: sessionsStore.create,
    setActive: sessionsStore.setActive,
    remove: sessionsStore.remove,
    rename: sessionsStore.rename,
  };
}
