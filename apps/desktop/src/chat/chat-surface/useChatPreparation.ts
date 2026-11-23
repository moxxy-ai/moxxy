import { useState } from 'react';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';

export function useChatPreparation(workspaceId: string, phase: ConnectionPhase, loading: boolean, creating: boolean) {
  const ready = !creating && phase.phase === 'connected' && !loading;
  const failed = phase.phase === 'failed' || phase.phase === 'protocol-incompatible';
  const [lastReady, setLastReady] = useState<string | null>(null);
  if (ready && lastReady !== workspaceId) setLastReady(workspaceId);
  return { ready, failed, awaitingFirstLoad: loading && !failed && workspaceId !== lastReady };
}
