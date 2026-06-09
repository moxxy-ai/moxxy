import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveAutoApproveState } from '../autoApproveState';
import { buildSetAutoApproveFrame } from '../clientFrames';

export function useAutoApprove(input: {
  readonly workspaceId: string | null;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly sendFrame: (frame: Record<string, unknown>) => void;
}) {
  const lastApplied = useRef<boolean | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const enabled = resolveAutoApproveState({ upstream: input.enabled, optimistic });

  const setAutoApprove = useCallback(
    (enabled: boolean) => {
      lastApplied.current = enabled;
      setOptimistic(enabled);
      input.sendFrame(buildSetAutoApproveFrame({ workspaceId: input.workspaceId, enabled }));
    },
    [input.sendFrame, input.workspaceId],
  );

  useEffect(() => {
    setOptimistic(null);
    lastApplied.current = null;
  }, [input.workspaceId]);

  useEffect(() => {
    if (optimistic !== null && input.enabled === optimistic) setOptimistic(null);
  }, [input.enabled, optimistic]);

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
