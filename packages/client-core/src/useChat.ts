import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, getTransportRevision, subscribeTransport } from './transport.js';
import type { MoxxyEvent, UserPromptAttachment } from '@moxxy/sdk';
import { chatStore, EMPTY_SNAPSHOT } from './chatStore.js';
import { createIpcPersistence } from './chatPersistence.js';
import { connectionStore } from './useConnection.js';
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
    inlineAttachments?: ReadonlyArray<UserPromptAttachment>,
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
  inlineAttachments?: ReadonlyArray<UserPromptAttachment>,
): Promise<void> {
  const model = chatStore.getModel(workspaceId);
  try {
    const { turnId } = await api().invoke('session.runTurn', {
      workspaceId,
      prompt,
      ...(model ? { model } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(inlineAttachments && inlineAttachments.length > 0 ? { inlineAttachments } : {}),
    });
    chatStore.dispatch(workspaceId, { type: 'send_started', turnId });
  } catch (e) {
    chatStore.dispatch(workspaceId, {
      type: 'send_failed',
      message: toErrorMessage(e),
    });
    // A failed send produces NO turn_complete, so the queue drainer would never
    // fire — keep the queue moving by sending the next item now. Otherwise every
    // remaining queued message strands behind the failure with no retry.
    drainNext(workspaceId);
  }
}

/** Pop the next queued turn for a workspace and fire it (no-op when empty). */
function drainNext(workspaceId: string): void {
  const next = chatStore.shiftQueue(workspaceId);
  if (next) void sendImmediate(workspaceId, next.prompt, next.attachments, next.inlineAttachments);
}

/** Sessions the desk registry auto-named — the ones whose sidebar title is
 *  derived from the first prompt (host-side, at desks.list time). */
const AUTO_SESSION_NAME = /^(?:Session \d+|New session)$/;
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
  const transportRevision = useSyncExternalStore(subscribeTransport, getTransportRevision);

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
    const offStarted = api().subscribe(
      'runner.turn.started',
      ({ workspaceId, turnId }: { workspaceId: string; turnId: string }) => {
        chatStore.dispatch(workspaceId, { type: 'send_started', turnId });
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
        // A background/hidden turn (e.g. AI skill drafting) runs as a real
        // runner turn and still emits turn_complete here — but draining the
        // user's pending queue on its completion would fire a queued prompt out
        // of band (possibly while a real foreground turn is still in flight).
        // dispatch() clears the hidden flag, so capture it BEFORE dispatching.
        const wasHidden = chatStore.isHidden(turnId);
        chatStore.dispatch(workspaceId, { type: 'turn_complete', turnId, error });
        if (wasHidden) return;
        drainNext(workspaceId);
      },
    );
    const offModel = api().subscribe(
      'session.model.changed',
      ({ workspaceId, model }: { workspaceId: string; model: string | null }) => {
        chatStore.setModel(workspaceId, model);
      },
    );
    const offAutoApprove = api().subscribe(
      'session.autoApprove.changed',
      ({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) => {
        chatStore.setAutoApprove(workspaceId, enabled);
      },
    );
    const offChatCleared = api().subscribe(
      'chat.cleared',
      ({ workspaceId }: { workspaceId: string }) => {
        chatStore.clearLocal(workspaceId);
      },
    );
    const offAsk = wireAskBridge();
    return () => {
      offEvent();
      offStarted();
      offComplete();
      offModel();
      offAutoApprove();
      offChatCleared();
      offAsk();
      // Cancel a pending title-refresh so it can't fire an IPC round-trip after
      // the bridge (and the view) has torn down.
      if (titleRefreshTimer) {
        clearTimeout(titleRefreshTimer);
        titleRefreshTimer = null;
      }
    };
  }, [transportRevision]);
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

  // Whether this workspace's runner has reached the `connected` phase. The
  // history pull (`chat.loadHistory`) only succeeds once a runner is attached —
  // before that the IPC returns null.
  const runnerConnected = useSyncExternalStore(connectionStore.subscribe, () =>
    workspaceId ? connectionStore.get(workspaceId)?.phase.phase === 'connected' : false,
  );

  // Load the most-recent window from the runner the first time this workspace is
  // observed AND again once its runner reaches `connected`. The first open
  // usually races the runner spawn: `chat.loadHistory` returns null (no attached
  // runner yet), so `loadInitial` leaves the slot unloaded for a retry. The
  // runner attaches with `replay:'none'`, so nothing pushes history in — without
  // this re-run on connect the transcript stays empty until the user re-opens
  // the workspace (the "first click shows empty, second click loads" bug).
  // Idempotent: `loadInitial` bails once a load has succeeded (`slot.loaded`),
  // so a later reconnect never re-pages.
  useEffect(() => {
    if (workspaceId) void chatStore.loadInitial(workspaceId);
  }, [workspaceId, runnerConnected]);

  const loadOlder = useCallback((): void => {
    if (workspaceId) void chatStore.loadOlder(workspaceId);
  }, [workspaceId]);

  const send = useCallback(
    async (
      prompt: string,
      attachments?: ReadonlyArray<{ path: string; name: string }>,
      inlineAttachments?: ReadonlyArray<UserPromptAttachment>,
    ): Promise<void> => {
      if (!workspaceId) return;
      const trimmed = prompt.trim();
      if (
        !trimmed &&
        (!attachments || attachments.length === 0) &&
        (!inlineAttachments || inlineAttachments.length === 0)
      ) {
        return;
      }
      const cur = chatStore.getChat(workspaceId);
      // Locked while the runner is compacting — don't send or even queue.
      if (cur.compacting) return;
      if (cur.activeTurnId !== null || cur.sending) {
        chatStore.enqueue(workspaceId, trimmed, attachments, inlineAttachments);
        return;
      }
      await sendImmediate(workspaceId, trimmed, attachments, inlineAttachments);
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
