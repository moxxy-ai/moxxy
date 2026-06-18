import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './transport.js';
import type { MoxxyEvent } from '@moxxy/sdk';
import { chatStore, EMPTY_SNAPSHOT } from './chatStore.js';
import { createIpcPersistence } from './chatPersistence.js';
import { wireAskBridge } from './askStore.js';
import { toErrorMessage } from './errors.js';
import { desksStore } from './useDesks.js';
import type { Extension } from './chatModel.js';

export type { Extension, RenderNode, FoldedBlock } from './chatModel.js';
export { buildRenderNodes, groupToolNodes } from './chatModel.js';

export interface UseChat {
  /** Committed runner events (reference-stable across streaming-only ticks). */
  readonly events: ReadonlyArray<MoxxyEvent>;
  /** Desktop-only timeline cards (slash-command results, notices). */
  readonly extensions: ReadonlyArray<Extension>;
  /** In-flight assistant text, rendered as a live preview at the tail. */
  readonly streamingText: string;
  /** In-flight reasoning/thinking text, rendered as a dim live preview. */
  readonly streamingReasoning: string;
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly error: string | null;
  readonly isEmpty: boolean;
  /** First on-open disk read is still loading; show a transcript spinner. */
  readonly loading: boolean;
  /** A manual compaction is in flight — composer is locked. */
  readonly compacting: boolean;
  readonly send: (
    prompt: string,
    attachments?: ReadonlyArray<{ path: string; name: string }>,
  ) => Promise<void>;
  readonly abort: () => Promise<void>;
  readonly clear: () => void;
  /** More history exists on disk; call {@link loadOlder} to page it in. */
  readonly hasOlder: boolean;
  /** Fetch the page of events preceding the in-memory window (scroll-up). */
  readonly loadOlder: () => void;
}

/** Fire a turn against the runner without queueing checks. Shared by the
 *  public `useChat().send` and the queue drainer. The runner echoes a
 *  `user_prompt` event back to every window, so we no longer add an
 *  optimistic transcript block here — the event log is the single
 *  source of truth. */
async function sendImmediate(
  workspaceId: string,
  prompt: string,
  attachments?: ReadonlyArray<{ path: string; name: string }>,
): Promise<void> {
  const model = chatStore.getModel(workspaceId);
  try {
    const { turnId } = await api().invoke('session.runTurn', {
      workspaceId,
      prompt,
      ...(model ? { model } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
    chatStore.dispatch(workspaceId, { type: 'send_started', turnId });
  } catch (e) {
    chatStore.dispatch(workspaceId, {
      type: 'send_failed',
      message: toErrorMessage(e),
    });
  }
}

/** Sessions the desk registry auto-named — the ones whose sidebar title is
 *  derived from the first prompt (host-side, at desks.list time). */
const AUTO_SESSION_NAME = /^Session \d+$/;
let titleRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A `user_prompt` landing on a still-auto-named session means its derived
 * title (the prompt itself) just came into existence — refresh the desk
 * list so the sidebar picks it up live. Delayed past the runner's 250ms
 * meta-sidecar debounce, and at most one refresh in flight. Once a session
 * carries a derived (or user-set) name the auto-pattern no longer matches,
 * so steady-state chatter never re-triggers this.
 */
function scheduleSessionTitleRefresh(workspaceId: string): void {
  const stillAutoNamed = desksStore
    .getSnapshot()
    .desks.some((d) =>
      d.sessions.some((s) => s.id === workspaceId && AUTO_SESSION_NAME.test(s.name)),
    );
  if (!stillAutoNamed || titleRefreshTimer) return;
  titleRefreshTimer = setTimeout(() => {
    titleRefreshTimer = null;
    void desksStore.refresh();
  }, 1000);
}

/**
 * Bridge component — forwards `runner.event` / `runner.turn.complete`
 * from the main process into the workspace-keyed {@link chatStore},
 * drains the per-workspace queue when a turn completes, and rehydrates
 * persisted transcripts on first mount.
 */
export function ChatStoreBridge(): null {
  useEffect(() => {
    // Wire the runner-history backend (the renderer pages transcript history
    // from the runner's authoritative log).
    chatStore.setPersistence(createIpcPersistence());
    const offEvent = api().subscribe(
      'runner.event',
      ({ workspaceId, event }: { workspaceId: string; event: MoxxyEvent }) => {
        chatStore.dispatch(workspaceId, { type: 'event', event });
        if (event.type === 'user_prompt') scheduleSessionTitleRefresh(workspaceId);
      },
    );
    const offComplete = api().subscribe(
      'runner.turn.complete',
      ({
        workspaceId,
        turnId,
        error,
      }: {
        workspaceId: string;
        turnId: string;
        error: string | null;
      }) => {
        chatStore.dispatch(workspaceId, { type: 'turn_complete', turnId, error });
        const next = chatStore.shiftQueue(workspaceId);
        if (next) void sendImmediate(workspaceId, next.prompt, next.attachments);
      },
    );
    const offAsk = wireAskBridge();
    return () => {
      offEvent();
      offComplete();
      offAsk();
    };
  }, []);
  return null;
}

const EMPTY_QUEUE_SNAPSHOT: ReadonlyArray<{ readonly id: string; readonly prompt: string }> =
  Object.freeze([]);

/** Read the queue snapshot for a workspace (composer pending-sends preview). */
export function useQueuedTurns(
  workspaceId: string | null,
): ReadonlyArray<{ readonly id: string; readonly prompt: string }> {
  return useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getQueue(workspaceId) : EMPTY_QUEUE_SNAPSHOT,
  );
}

/**
 * Per-workspace chat handle. Send/abort/clear are bound to the workspace
 * so the UI can target background workspaces too.
 */
export function useChat(workspaceId: string | null): UseChat {
  const snap = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getChat(workspaceId) : EMPTY_SNAPSHOT,
  );

  // Load the most-recent window from disk the first time this workspace
  // is observed (idempotent — the store guards re-entry).
  useEffect(() => {
    if (workspaceId) void chatStore.loadInitial(workspaceId);
  }, [workspaceId]);

  const loadOlder = useCallback((): void => {
    if (workspaceId) void chatStore.loadOlder(workspaceId);
  }, [workspaceId]);

  const send = useCallback(
    async (
      prompt: string,
      attachments?: ReadonlyArray<{ path: string; name: string }>,
    ): Promise<void> => {
      if (!workspaceId) return;
      const trimmed = prompt.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;
      const cur = chatStore.getChat(workspaceId);
      // Locked while the runner is compacting — don't send or even queue.
      if (cur.compacting) return;
      if (cur.activeTurnId !== null || cur.sending) {
        chatStore.enqueue(workspaceId, trimmed, attachments);
        return;
      }
      await sendImmediate(workspaceId, trimmed, attachments);
    },
    [workspaceId],
  );

  const abort = useCallback(async (): Promise<void> => {
    if (!workspaceId || !snap.activeTurnId) return;
    try {
      await api().invoke('session.abortTurn', { workspaceId, turnId: snap.activeTurnId });
    } catch {
      /* best-effort */
    }
  }, [workspaceId, snap.activeTurnId]);

  const clear = useCallback((): void => {
    if (!workspaceId) return;
    chatStore.clear(workspaceId);
  }, [workspaceId]);

  return {
    events: snap.events,
    extensions: snap.extensions,
    streamingText: snap.streamingText,
    streamingReasoning: snap.streamingReasoning,
    sending: snap.sending,
    activeTurnId: snap.activeTurnId,
    error: snap.error,
    isEmpty: snap.isEmpty,
    loading: snap.loading,
    compacting: snap.compacting,
    send,
    abort,
    clear,
    hasOlder: snap.hasOlder,
    loadOlder,
  };
}

/** Snapshot of workspace ids that currently carry unread activity. */
export function useUnreadWorkspaces(): ReadonlyArray<string> {
  return useSyncExternalStore(chatStore.subscribe, () => chatStore.unreadWorkspaces());
}
