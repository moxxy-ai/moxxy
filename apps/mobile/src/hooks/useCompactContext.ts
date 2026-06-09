import { useCallback, useState } from 'react';

export function useCompactContext(input: {
  readonly readOnly?: boolean;
  /** The composer's command runner — `/compact` rides the same path so the
   *  compaction lock + error surfacing live in one place. */
  readonly runCommand: (name: string, args?: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { readOnly, runCommand } = input;

  const requestCompact = useCallback(() => {
    if (readOnly) return;
    setConfirmOpen(true);
  }, [readOnly]);

  const cancelCompact = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  const confirmCompact = useCallback(() => {
    if (readOnly) return;
    runCommand('compact', '');
    setConfirmOpen(false);
  }, [readOnly, runCommand]);

  return {
    confirmOpen,
    requestCompact,
    cancelCompact,
    confirmCompact,
  };
}
