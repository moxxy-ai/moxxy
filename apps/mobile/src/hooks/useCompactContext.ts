import { useCallback, useState } from 'react';
import { buildRunCommandFrame } from '../clientFrames';

export function useCompactContext(input: {
  readonly workspaceId: string | null;
  readonly readOnly?: boolean;
  readonly sendFrame: (frame: Record<string, unknown>) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestCompact = useCallback(() => {
    if (input.readOnly) return;
    setConfirmOpen(true);
  }, [input.readOnly]);

  const cancelCompact = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  const confirmCompact = useCallback(() => {
    if (input.readOnly) return;
    input.sendFrame(buildRunCommandFrame({ workspaceId: input.workspaceId, name: 'compact', args: '' }));
    setConfirmOpen(false);
  }, [input.readOnly, input.sendFrame, input.workspaceId]);

  return {
    confirmOpen,
    requestCompact,
    cancelCompact,
    confirmCompact,
  };
}
