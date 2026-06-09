import { useCallback, useEffect, useRef, useState } from 'react';
import { api, chatStore } from '@moxxy/client-core';
import { resolveAutoApproveState } from '../autoApproveState';
import { buildSetAutoApproveFrame, invokeFrame } from '../clientFrames';

/**
 * Auto-approve ("yolo") toggle. The optimistic value renders immediately; the
 * upstream value is client-core's per-workspace flag, confirmed only after the
 * host acknowledges the command. The flag lives on the host's session driver
 * and resets if the runner restarts, so — like the reference — an enabled
 * toggle is re-applied once per workspace on (re)connect.
 */
export function useAutoApprove(input: {
  readonly workspaceId: string | null;
  readonly enabled: boolean;
  readonly connected: boolean;
}) {
  const lastApplied = useRef<boolean | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const enabled = resolveAutoApproveState({ upstream: input.enabled, optimistic });
  const { workspaceId } = input;

  const setAutoApprove = useCallback(
    (next: boolean) => {
      lastApplied.current = next;
      setOptimistic(next);
      void invokeFrame(api(), buildSetAutoApproveFrame({ workspaceId, enabled: next }))
        .then(() => {
          if (workspaceId) chatStore.setAutoApprove(workspaceId, next);
        })
        .catch(() => {
          setOptimistic(null);
          lastApplied.current = null;
        });
    },
    [workspaceId],
  );

  useEffect(() => {
    setOptimistic(null);
    lastApplied.current = null;
  }, [workspaceId]);

  useEffect(() => {
    if (optimistic !== null && input.enabled === optimistic) setOptimistic(null);
  }, [input.enabled, optimistic]);

  useEffect(() => {
    if (!input.connected || !workspaceId || !enabled) return;
    if (lastApplied.current === true) return;
    lastApplied.current = true;
    void invokeFrame(api(), buildSetAutoApproveFrame({ workspaceId, enabled: true })).catch(() => {
      lastApplied.current = null;
    });
  }, [enabled, input.connected, workspaceId]);

  return {
    enabled,
    setAutoApprove,
  };
}
