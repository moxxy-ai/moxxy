import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTO_APPROVE_OPTIMISTIC_TIMEOUT_MS,
  resolveAutoApproveState,
} from '../autoApproveState';
import { buildSetAutoApproveFrame } from '../clientFrames';

export function useAutoApprove(input: {
  readonly workspaceId: string | null;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly sendFrame: (frame: Record<string, unknown>) => void;
}) {
  const lastApplied = useRef<boolean | null>(null);
  const rollbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const enabled = resolveAutoApproveState({ upstream: input.enabled, optimistic });

  const clearRollbackTimer = useCallback(() => {
    if (!rollbackTimer.current) return;
    clearTimeout(rollbackTimer.current);
    rollbackTimer.current = null;
  }, []);

  const setAutoApprove = useCallback(
    (enabled: boolean) => {
      lastApplied.current = enabled;
      clearRollbackTimer();
      setOptimistic(enabled);
      rollbackTimer.current = setTimeout(() => {
        rollbackTimer.current = null;
        lastApplied.current = null;
        setOptimistic((current) => (current === enabled ? null : current));
      }, AUTO_APPROVE_OPTIMISTIC_TIMEOUT_MS);
      input.sendFrame(buildSetAutoApproveFrame({ workspaceId: input.workspaceId, enabled }));
    },
    [clearRollbackTimer, input.sendFrame, input.workspaceId],
  );

  useEffect(() => {
    clearRollbackTimer();
    setOptimistic(null);
    lastApplied.current = null;
  }, [clearRollbackTimer, input.workspaceId]);

  useEffect(() => {
    if (optimistic === null || input.enabled !== optimistic) return;
    clearRollbackTimer();
    lastApplied.current = null;
    setOptimistic(null);
  }, [clearRollbackTimer, input.enabled, optimistic]);

  useEffect(() => () => clearRollbackTimer(), [clearRollbackTimer]);

  useEffect(() => {
    if (!input.connected || !input.workspaceId || !enabled) return;
    if (lastApplied.current === true) return;
    lastApplied.current = true;
    input.sendFrame(buildSetAutoApproveFrame({ workspaceId: input.workspaceId, enabled: true }));
  }, [enabled, input.connected, input.sendFrame, input.workspaceId]);

  return {
    enabled,
    setAutoApprove,
  };
}
