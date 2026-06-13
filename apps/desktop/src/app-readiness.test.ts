import { describe, expect, it } from 'vitest';
import type { ConnectionPhase, ConnectionSnapshot } from '@moxxy/desktop-ipc-contract';
import { resolveActiveSessionShell, type LastConnectedSession } from './app-readiness';

const connectedPhase = (sessionId: string): LastConnectedSession['phase'] => ({
  phase: 'connected',
  socket: `/tmp/${sessionId}.sock`,
  sessionId,
  activeProvider: 'openai-codex',
  activeMode: 'default',
});

const snapshot = (phase: ConnectionPhase): ConnectionSnapshot => ({
  phase,
  cliPath: null,
  attempts: 0,
  log: [],
});

describe('resolveActiveSessionShell', () => {
  it('does not reuse a previous session connected phase while a newly selected session has no snapshot yet', () => {
    const state = resolveActiveSessionShell({
      activeWorkspaceId: 'session-b',
      snapshot: null,
      lastConnected: {
        workspaceId: 'session-a',
        phase: connectedPhase('session-a'),
      },
    });

    expect(state.needsInitialSplash).toBe(false);
    expect(state.connected).toBe(false);
    expect(state.sessionLoading).toBe(true);
    expect(state.phase.phase).toBe('reconnecting');
  });

  it('allows the same session to reuse its last connected phase during a transient snapshot gap', () => {
    const phase = connectedPhase('session-a');
    const state = resolveActiveSessionShell({
      activeWorkspaceId: 'session-a',
      snapshot: null,
      lastConnected: {
        workspaceId: 'session-a',
        phase,
      },
    });

    expect(state.needsInitialSplash).toBe(false);
    expect(state.connected).toBe(true);
    expect(state.sessionLoading).toBe(false);
    expect(state.phase).toBe(phase);
  });

  it('marks an active session snapshot as loading until that session is connected', () => {
    const state = resolveActiveSessionShell({
      activeWorkspaceId: 'session-b',
      snapshot: snapshot({ phase: 'attaching', socket: '/tmp/session-b.sock' }),
      lastConnected: {
        workspaceId: 'session-a',
        phase: connectedPhase('session-a'),
      },
    });

    expect(state.connected).toBe(false);
    expect(state.sessionLoading).toBe(true);
    expect(state.phase.phase).toBe('attaching');
  });

  it('uses the active session snapshot once it is connected', () => {
    const phase = connectedPhase('session-b');
    const state = resolveActiveSessionShell({
      activeWorkspaceId: 'session-b',
      snapshot: snapshot(phase),
      lastConnected: {
        workspaceId: 'session-a',
        phase: connectedPhase('session-a'),
      },
    });

    expect(state.connected).toBe(true);
    expect(state.sessionLoading).toBe(false);
    expect(state.phase).toBe(phase);
  });

  it('does not hide terminal connection errors behind a loading state', () => {
    const state = resolveActiveSessionShell({
      activeWorkspaceId: 'session-b',
      snapshot: snapshot({ phase: 'failed', error: 'runner crashed' }),
      lastConnected: {
        workspaceId: 'session-a',
        phase: connectedPhase('session-a'),
      },
    });

    expect(state.connected).toBe(false);
    expect(state.sessionLoading).toBe(false);
    expect(state.phase.phase).toBe('failed');
  });
});
