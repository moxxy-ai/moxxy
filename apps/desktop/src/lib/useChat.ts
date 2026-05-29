import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import type { MoxxyEvent } from '@moxxy/sdk';
import { chatStore, EMPTY_SNAPSHOT } from './chatStore';
import type { Extension } from './chatModel';

export type { Extension, RenderNode, FoldedBlock } from './chatModel';
export { buildRenderNodes } from './chatModel';

export interface UseChat {
  /** Committed runner events (reference-stable across streaming-only ticks). */
  readonly events: ReadonlyArray<MoxxyEvent>;
  /** Desktop-only timeline cards (slash-command results, notices). */
  readonly extensions: ReadonlyArray<Extension>;
  /** In-flight assistant text, rendered as a live preview at the tail. */
  readonly streamingText: string;
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly error: string | null;
  readonly isEmpty: boolean;
  readonly send: (
    prompt: string,
    attachments?: ReadonlyArray<{ path: string; name: string }>,
  ) => Promise<void>;
  readonly abort: () => Promise<void>;
  readonly clear: () => void;
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
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Bridge component — forwards `runner.event` / `runner.turn.complete`
 * from the main process into the workspace-keyed {@link chatStore},
 * drains the per-workspace queue when a turn completes, and rehydrates
 * persisted transcripts on first mount.
 */
export function ChatStoreBridge(): null {
  useEffect(() => {
    chatStore.hydrate();
    const offEvent = api().subscribe(
      'runner.event',
      ({ workspaceId, event }: { workspaceId: string; event: MoxxyEvent }) => {
        chatStore.dispatch(workspaceId, { type: 'event', event });
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
    return () => {
      offEvent();
      offComplete();
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

  const send = useCallback(
    async (
      prompt: string,
      attachments?: ReadonlyArray<{ path: string; name: string }>,
    ): Promise<void> => {
      if (!workspaceId) return;
      const trimmed = prompt.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;
      const cur = chatStore.getChat(workspaceId);
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
    sending: snap.sending,
    activeTurnId: snap.activeTurnId,
    error: snap.error,
    isEmpty: snap.isEmpty,
    send,
    abort,
    clear,
  };
}

/** Snapshot of workspace ids that currently carry unread activity. */
export function useUnreadWorkspaces(): ReadonlyArray<string> {
  return useSyncExternalStore(chatStore.subscribe, () => chatStore.unreadWorkspaces());
}
