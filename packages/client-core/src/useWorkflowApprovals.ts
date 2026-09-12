import { useCallback, useEffect, useRef, useState } from 'react';
import {
  workflowApprovalItemsSchema,
  type WorkflowApprovalChoice,
  type WorkflowApprovalItem,
} from '@moxxy/sdk/workflow-approval';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';

export function useWorkflowApprovals(workspaceId: string | null) {
  const current = useRef(workspaceId);
  current.current = workspaceId;
  const [snapshot, setSnapshot] = useState<{
    workspaceId: string | null;
    items: readonly WorkflowApprovalItem[];
  }>({ workspaceId: null, items: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const items = workflowApprovalItemsSchema.parse(
        await api().invoke('workflows.approvals', { workspaceId }),
      );
      if (current.current !== workspaceId) return;
      setSnapshot({ workspaceId, items });
      setError(null);
    } catch (e) {
      if (current.current === workspaceId) setError(toErrorMessage(e));
    }
  }, [workspaceId]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refresh();
      if (!stopped)
        timer = setTimeout(() => {
          void poll();
        }, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  const respond = useCallback(
    async (id: string, choice?: WorkflowApprovalChoice | 'cancel') => {
      if (!workspaceId) return;
      setBusy(id);
      try {
        if (choice === 'cancel')
          await api().invoke('workflows.cancelApprovalRun', { workspaceId, id });
        else if (choice)
          await api().invoke('workflows.decideApproval', { workspaceId, id, choice });
        else await api().invoke('workflows.revokeApproval', { workspaceId, id });
        await refresh();
      } catch (e) {
        if (current.current === workspaceId) setError(toErrorMessage(e));
      } finally {
        if (current.current === workspaceId) setBusy(null);
      }
    },
    [workspaceId, refresh],
  );
  const items = snapshot.workspaceId === workspaceId ? snapshot.items : [];
  return { items, error, busy, refresh, respond };
}
