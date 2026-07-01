import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { ApprovalDecision, ApprovalRequest, MoxxyEvent } from '@moxxy/sdk';

/**
 * The Collaborate panel's data source — the DEDICATED collaboration coordinator,
 * NOT a chat session. It reads the coordinator's live event stream (`collab.event`,
 * seeded by `collab.snapshot`), its roster-approval checkpoint (`collab.approval`),
 * and its liveness (`collab.status`), and drives it through the `collab.*` IPC.
 *
 * Deliberately does NOT use `useChat`/`chatStore` — those are per-workspace and
 * would drag collab back into the chat machinery (persistence, desks, the chat
 * ask sheet). Keeping a private event array here is what makes collaborate a
 * self-contained feature that never touches a chat session's thread.
 */
export interface CollabApproval {
  readonly requestId: string;
  readonly request: ApprovalRequest;
}

export interface UseCollab {
  /** The coordinator's event log (fold with `pairToolEvents` → `latestCollab`). */
  readonly events: ReadonlyArray<MoxxyEvent>;
  /** A coordinator is live (started here or elsewhere, e.g. the TUI). */
  readonly running: boolean;
  readonly task: string | null;
  /** The pending roster-approval checkpoint, or null. */
  readonly approval: CollabApproval | null;
  start(goal: string, workspaceId?: string): Promise<void>;
  end(): Promise<void>;
  command(name: string, args: string): Promise<void>;
  respondApproval(requestId: string, decision: ApprovalDecision): void;
}

export function useCollab(workspaceId?: string): UseCollab {
  const [events, setEvents] = useState<ReadonlyArray<MoxxyEvent>>([]);
  const [running, setRunning] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [approval, setApproval] = useState<CollabApproval | null>(null);

  useEffect(() => {
    let alive = true;
    // Seed from the coordinator's current log (this also opportunistically
    // attaches to a coordinator started elsewhere so the desktop can view it).
    void api()
      .invoke('collab.snapshot')
      .then((evs) => {
        if (alive) setEvents(evs as MoxxyEvent[]);
      })
      .catch(() => undefined);

    const offEvent = api().subscribe('collab.event', ({ event }) => {
      setEvents((prev) => [...prev, event]);
    });
    const offApproval = api().subscribe('collab.approval', (p) => {
      setApproval(p);
    });
    const offResolved = api().subscribe('collab.approval.resolved', ({ requestId }) => {
      setApproval((cur) => (cur && cur.requestId === requestId ? null : cur));
    });
    const offStatus = api().subscribe('collab.status', ({ running: r, task: t }) => {
      setRunning(r);
      setTask(t ?? null);
      if (!r) setApproval(null);
    });
    return () => {
      alive = false;
      offEvent();
      offApproval();
      offResolved();
      offStatus();
    };
  }, []);

  const start = useCallback(
    async (goal: string, wid?: string) => {
      // Fresh run: the coordinator is a brand-new process/session, so drop the
      // previous run's events + any stale approval before its stream begins.
      setEvents([]);
      setApproval(null);
      const wsid = wid ?? workspaceId;
      await api().invoke('collab.start', wsid ? { goal, workspaceId: wsid } : { goal });
    },
    [workspaceId],
  );

  const end = useCallback(async () => {
    await api().invoke('collab.end');
  }, []);

  const command = useCallback(async (name: string, args: string) => {
    await api().invoke('collab.command', { name, args }).catch(() => undefined);
  }, []);

  const respondApproval = useCallback((requestId: string, decision: ApprovalDecision) => {
    // Drop the card optimistically; the host also broadcasts collab.approval.resolved.
    setApproval((cur) => (cur && cur.requestId === requestId ? null : cur));
    void api().invoke('collab.respondApproval', { requestId, decision }).catch(() => undefined);
  }, []);

  return { events, running, task, approval, start, end, command, respondApproval };
}
