import type { ConnectionPhase, ConnectionSnapshot } from '@moxxy/desktop-ipc-contract';
import { isSessionFeatureLoading } from '@moxxy/client-core';

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

// Both stand in for a runner snapshot that has not arrived yet. `attempt: 0`
// marks them as a first start: nothing was lost, so nothing is reconnecting.
const SELECTED_SESSION_LOADING_PHASE: ConnectionPhase = {
  phase: 'reconnecting',
  reason: 'loading selected session',
  attempt: 0,
};

// The first runner waits for the host's preparation. What that takes after an
// install or an update is shown by the installer screen (`update/`), over this.
const FIRST_RUNNER_STARTING_PHASE: ConnectionPhase = {
  phase: 'reconnecting',
  reason: 'starting the agent runtime',
  attempt: 0,
};

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One line for the banner shown while the active session is not connected. */
export function describeConnectionPhase(phase: ConnectionPhase | undefined): string {
  if (!phase) return 'Reconnecting…';
  switch (phase.phase) {
    case 'idle':
      return 'Starting…';
    case 'resolving-cli':
      return 'Resolving moxxy CLI…';
    case 'spawning':
      return 'Starting agent runtime…';
    case 'adopting':
      return 'Attaching to running runner…';
    case 'attaching':
      return 'Attaching session…';
    case 'reconnecting':
      if (!phase.reason) return 'Reconnecting…';
      if (phase.attempt === 0) return `${sentence(phase.reason)}${phase.reason.includes('—') ? '' : '…'}`;
      return `Reconnecting — ${phase.reason}`;
    case 'failed':
      return phase.error ? `Disconnected — ${phase.error}` : 'Disconnected';
    case 'protocol-incompatible':
      // Terminal — say so plainly rather than implying a reconnect is coming.
      return phase.hint;
    default:
      return 'Reconnecting…';
  }
}

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
      sessionLoading: isSessionFeatureLoading({
        workspaceId: activeWorkspaceId,
        phase: snapshot.phase,
        sessionInfoReady,
      }),
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
    // The host can already serve desk metadata + persisted chat history while
    // the selected runner is still being prepared. Keep the shell visible and
    // model the missing first snapshot as an ordinary loading phase.
    needsInitialSplash: false,
    phase: FIRST_RUNNER_STARTING_PHASE,
    connected: false,
    sessionLoading: true,
  };
}

export function shouldShowBlockingConnectionScreen(
  shell: ActiveSessionShell,
  hasEverConnected: boolean,
): boolean {
  return !shell.connected && !hasEverConnected && !shell.sessionLoading;
}

export function shouldShowProviderRecovery(
  phase: ConnectionPhase,
  sessionLoading: boolean,
  dismissed = false,
): boolean {
  return (
    !dismissed &&
    phase.phase === 'connected' &&
    phase.activeProvider === null &&
    !sessionLoading
  );
}
