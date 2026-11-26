import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, deskForWorkspace, useDesks } from '@moxxy/client-core';
import type { AgentBackgroundWork } from '@moxxy/sdk';

/** One work that runs now in a chat of the project. */
export interface ProjectWork {
  /** The chat running it, the one a Stop goes to. */
  readonly workspaceId: string;
  readonly chat: string;
  readonly work: AgentBackgroundWork;
}

export interface UseProjectWork {
  /** What runs now in the chats of the project read so far, in the project's chat order. */
  readonly items: ReadonlyArray<ProjectWork>;
  /** Some chat is still being asked (a chat with no runner up answers after a few seconds). */
  readonly loading: boolean;
  /** Keys ({@link projectWorkKey}) of work a Stop was asked for that still runs. */
  readonly stopping: ReadonlySet<string>;
  readonly stop: (item: ProjectWork) => Promise<boolean>;
}

export function projectWorkKey(item: ProjectWork): string {
  return `${item.workspaceId}\u0000${item.work.id}`;
}

/**
 * What runs in the background in every chat of the project `workspaceId`
 * belongs to, read while `enabled` from each chat's runner
 * (`session.info`, again on its `session.info.changed`). A chat whose runner
 * is not up runs nothing and is not started by asking.
 */
export function useProjectWork(workspaceId: string | null, enabled: boolean): UseProjectWork {
  const { desks } = useDesks();
  const chats = useMemo(() => {
    const desk = deskForWorkspace(desks, workspaceId);
    if (desk) return desk.sessions.map((session) => ({ id: session.id, name: session.name }));
    return workspaceId ? [{ id: workspaceId, name: 'This chat' }] : [];
  }, [desks, workspaceId]);
  const chatIds = chats.map((chat) => chat.id).join('\u0000');
  const [running, setRunning] = useState<ReadonlyMap<string, ReadonlyArray<AgentBackgroundWork>>>(new Map());
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setRunning(new Map());
    if (!enabled || !chatIds) return undefined;
    const ids = new Set(chatIds.split('\u0000'));
    let live = true;
    const read = (id: string): Promise<void> =>
      api()
        .invoke('session.info', { workspaceId: id })
        .then((info) => info?.backgroundWork ?? [])
        .catch(() => [])
        .then((work) => {
          if (live) setRunning((all) => new Map(all).set(id, work));
        });
    void Promise.all([...ids].map(read));
    const off = api().subscribe('session.info.changed', (payload: { workspaceId: string }) => {
      if (ids.has(payload.workspaceId)) void read(payload.workspaceId);
    });
    return () => {
      live = false;
      off();
    };
  }, [enabled, chatIds]);

  const items = useMemo(
    () => chats.flatMap((chat) => (running.get(chat.id) ?? []).map((work) => ({ workspaceId: chat.id, chat: chat.name, work }))),
    [running, chats],
  );
  const loading = enabled && chats.some((chat) => !running.has(chat.id));
  const stopping = useMemo(() => {
    const live = new Set(items.map(projectWorkKey));
    return new Set([...asked].filter((key) => live.has(key)));
  }, [asked, items]);

  const stop = useCallback(async (item: ProjectWork): Promise<boolean> => {
    const key = projectWorkKey(item);
    setAsked((all) => new Set(all).add(key));
    const stopped = await api()
      .invoke('session.stopBackgroundWork', { workspaceId: item.workspaceId, workId: item.work.id })
      .catch(() => false);
    if (!stopped) {
      setAsked((all) => {
        const rest = new Set(all);
        rest.delete(key);
        return rest;
      });
    }
    return stopped;
  }, []);

  return { items, loading, stopping, stop };
}
