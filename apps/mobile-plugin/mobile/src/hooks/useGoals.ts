import { useCallback, useState } from 'react';
import { buildGoalFrames } from '../clientFrames';

export function useGoals(input: {
  readonly workspaceId: string | null;
  readonly sendFrame: (frame: Record<string, unknown>) => void;
}) {
  const [objective, setObjective] = useState('');
  const [open, setOpen] = useState(false);

  const startGoal = useCallback(() => {
    const trimmed = objective.trim();
    if (!trimmed) return;
    for (const frame of buildGoalFrames({ workspaceId: input.workspaceId, objective: trimmed })) {
      input.sendFrame(frame);
    }
    setObjective('');
    setOpen(false);
  }, [input, objective]);

  return {
    objective,
    setObjective,
    open,
    setOpen,
    startGoal,
    canStart: objective.trim().length > 0,
  };
}
