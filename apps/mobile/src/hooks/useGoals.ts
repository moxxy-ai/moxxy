import { useCallback, useState } from 'react';
import { api, chatStore, toErrorMessage } from '@moxxy/client-core';
import { buildGoalFrames, invokeFrame } from '../clientFrames';

export function useGoals(input: {
  readonly workspaceId: string | null;
  readonly onError: (message: string) => void;
  readonly refreshInfo: () => void;
}) {
  const [objective, setObjective] = useState('');
  const [open, setOpen] = useState(false);
  const { workspaceId, onError, refreshInfo } = input;

  const startGoal = useCallback(() => {
    const trimmed = objective.trim();
    if (!trimmed) return;
    const [setMode, setYolo, runTurn] = buildGoalFrames({ workspaceId, objective: trimmed });
    void (async () => {
      try {
        // Strictly ordered: the turn must start under goal mode + auto-approve.
        await invokeFrame(api(), setMode);
        await invokeFrame(api(), setYolo);
        if (workspaceId) chatStore.setAutoApprove(workspaceId, true);
        const { turnId } = await invokeFrame(api(), runTurn);
        if (workspaceId) chatStore.dispatch(workspaceId, { type: 'send_started', turnId });
        refreshInfo();
      } catch (e) {
        onError(toErrorMessage(e));
      }
    })();
    setObjective('');
    setOpen(false);
  }, [objective, onError, refreshInfo, workspaceId]);

  return {
    objective,
    setObjective,
    open,
    setOpen,
    startGoal,
    canStart: objective.trim().length > 0,
  };
}
