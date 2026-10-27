import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AgentBackgroundWork, AgentScheduledWakeup } from '@moxxy/sdk';
import { agentWorkFromEvents, type AgentWorkItem } from '@moxxy/chat-model';
import { api } from './transport.js';
import { chatStore } from './chatStore.js';
import { createListenerSet } from './externalStore.js';

/**
 * The work picked in each conversation's Agents panel, shared by every part of
 * the window: the chat's "Agent continued" marker and the composer's
 * "In the background" marker pick one, the panel shows it.
 */
const picked = new Map<string, string | null>();
const pickedListeners = createListenerSet();
const focusListeners = new Set<(workspaceId: string) => void>();

function pick(workspaceId: string, workId: string | null): void {
  if ((picked.get(workspaceId) ?? null) === workId) return;
  picked.set(workspaceId, workId);
  pickedListeners.emit();
}

/** Show the Agents panel of a conversation, on one work of it when `workId` is given. */
export function focusAgentWork(workspaceId: string, workId: string | null = null): void {
  if (workId !== null) pick(workspaceId, workId);
  for (const listener of [...focusListeners]) listener(workspaceId);
}

/** Hear when a part of the window asks to show a conversation's Agents panel. */
export function onAgentWorkFocus(listener: (workspaceId: string) => void): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

const showListeners = new Set<(workspaceId: string, eventId: string) => void>();

/** Scroll a conversation's chat to one of its events (the turn a work opened). */
export function showInChat(workspaceId: string, eventId: string): void {
  for (const listener of [...showListeners]) listener(workspaceId, eventId);
}

/** Hear when a part of the window asks the chat to show one of its events. */
export function onShowInChat(listener: (workspaceId: string, eventId: string) => void): () => void {
  showListeners.add(listener);
  return () => {
    showListeners.delete(listener);
  };
}

export interface UseAgentWork {
  /** Every helper and background command of the conversation, newest first. */
  readonly items: ReadonlyArray<AgentWorkItem>;
  /** How many of them run now. */
  readonly running: number;
  /** When the agent set itself to come back by itself, soonest first. */
  readonly scheduled: ReadonlyArray<AgentScheduledWakeup>;
  readonly selected: AgentWorkItem | null;
  readonly select: (workId: string | null) => void;
  /** Work a Stop was asked for that has not ended yet. */
  readonly stopping: ReadonlySet<string>;
  /** Stop one work; false when the agent runs no such work. */
  readonly stop: (workId: string) => Promise<boolean>;
}

/**
 * A conversation's Agents panel: its helpers and background commands, read
 * from the chat's events, with what the runner says runs now
 * (`SessionInfo.backgroundWork`, read again on every `session.info.changed`).
 * Every surface reads the same log and the same runner, so they agree.
 */
export function useAgentWork(workspaceId: string | null): UseAgentWork {
  const events = useSyncExternalStore(chatStore.subscribe, () => (workspaceId ? chatStore.getChat(workspaceId).events : null));
  const pickedId = useSyncExternalStore(pickedListeners.subscribe, () => (workspaceId ? (picked.get(workspaceId) ?? null) : null));
  const [runningNow, setRunningNow] = useState<{
    readonly workspaceId: string | null;
    readonly work: ReadonlyArray<AgentBackgroundWork> | undefined;
    readonly wakeups: ReadonlyArray<AgentScheduledWakeup>;
  }>({ workspaceId: null, work: undefined, wakeups: [] });
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!workspaceId) return undefined;
    let live = true;
    const read = (): void => {
      void api()
        .invoke('session.info', { workspaceId })
        .then((info) => {
          if (live) setRunningNow({ workspaceId, work: info?.backgroundWork, wakeups: info?.scheduledWakeups ?? [] });
        })
        .catch(() => undefined);
    };
    read();
    const off = api().subscribe('session.info.changed', (payload: { workspaceId: string }) => {
      if (payload.workspaceId === workspaceId) read();
    });
    return () => {
      live = false;
      off();
    };
  }, [workspaceId]);

  const items = useMemo(
    () => agentWorkFromEvents(events ?? [], runningNow.workspaceId === workspaceId ? runningNow.work : undefined),
    [events, runningNow, workspaceId],
  );
  const scheduled = useMemo(
    () => (runningNow.workspaceId === workspaceId ? [...runningNow.wakeups].sort(soonestFirst) : []),
    [runningNow, workspaceId],
  );
  const stopping = useMemo(() => {
    const live = new Set(items.filter((item) => item.status === 'running').map((item) => item.id));
    return new Set([...asked].filter((id) => live.has(id)));
  }, [asked, items]);

  const select = useCallback(
    (workId: string | null): void => {
      if (workspaceId) pick(workspaceId, workId);
    },
    [workspaceId],
  );

  const stop = useCallback(
    async (workId: string): Promise<boolean> => {
      if (!workspaceId) return false;
      setAsked((all) => new Set(all).add(workId));
      const stopped = await api()
        .invoke('session.stopBackgroundWork', { workspaceId, workId })
        .catch(() => false);
      if (!stopped) {
        setAsked((all) => {
          const rest = new Set(all);
          rest.delete(workId);
          return rest;
        });
      }
      return stopped;
    },
    [workspaceId],
  );

  return {
    items,
    running: items.filter((item) => item.status === 'running').length,
    scheduled,
    selected: items.find((item) => item.id === pickedId) ?? null,
    select,
    stopping,
    stop,
  };
}

/** A wakeup with no known time goes last. */
function soonestFirst(a: AgentScheduledWakeup, b: AgentScheduledWakeup): number {
  return (a.dueAtMs ?? Number.POSITIVE_INFINITY) - (b.dueAtMs ?? Number.POSITIVE_INFINITY);
}
