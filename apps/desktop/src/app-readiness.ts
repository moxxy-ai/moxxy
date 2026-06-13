import type { ConnectionPhase, ConnectionSnapshot } from '@moxxy/desktop-ipc-contract';

export interface LastConnectedSession {
  readonly workspaceId: string;
  readonly phase: Extract<ConnectionPhase, { phase: 'connected' }>;
}

export interface ActiveSessionShell {
  readonly needsInitialSplash: boolean;
  readonly phase: ConnectionPhase;
  readonly connected: boolean;
  readonly sessionLoading: boolean;
}

const SELECTED_SESSION_LOADING_PHASE: ConnectionPhase = {
  phase: 'reconnecting',
  reason: 'loading selected session',
  attempt: 0,
};

export function resolveActiveSessionShell({
  activeWorkspaceId,
  snapshot,
  lastConnected,
  sessionInfoReady,
}: {
  readonly activeWorkspaceId: string | null;
  readonly snapshot: ConnectionSnapshot | null;
  readonly lastConnected: LastConnectedSession | null;
  readonly sessionInfoReady?: boolean;
}): ActiveSessionShell {
  if (!activeWorkspaceId) {
    return {
      needsInitialSplash: true,
      phase: { phase: 'idle' },
      connected: false,
      sessionLoading: false,
    };
  }

  if (snapshot) {
    const connected = snapshot.phase.phase === 'connected';
    return {
      needsInitialSplash: false,
      phase: snapshot.phase,
      connected,
      sessionLoading:
        isRunnerLoadingPhase(snapshot.phase) ||
        (connected && sessionInfoReady === false),
    };
  }

  if (lastConnected?.workspaceId === activeWorkspaceId) {
    return {
      needsInitialSplash: false,
      phase: lastConnected.phase,
      connected: true,
      sessionLoading: false,
    };
  }

  if (lastConnected) {
    return {
      needsInitialSplash: false,
      phase: SELECTED_SESSION_LOADING_PHASE,
      connected: false,
      sessionLoading: true,
    };
  }

  return {
    needsInitialSplash: true,
    phase: { phase: 'idle' },
    connected: false,
    sessionLoading: false,
  };
}

export function shouldShowProviderRecovery(
  phase: ConnectionPhase,
  sessionLoading: boolean,
): boolean {
  return phase.phase === 'connected' && phase.activeProvider === null && !sessionLoading;
}

function isRunnerLoadingPhase(phase: ConnectionPhase): boolean {
  switch (phase.phase) {
    case 'idle':
    case 'resolving-cli':
    case 'spawning':
    case 'adopting':
    case 'attaching':
    case 'reconnecting':
      return true;
    case 'connected':
    case 'cli-missing':
    case 'failed':
    case 'protocol-incompatible':
      return false;
  }
}
