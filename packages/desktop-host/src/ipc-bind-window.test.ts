import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: { handle: () => undefined },
}));

const sendState = vi.hoisted(() => ({
  driverPublishedWhenConnectedSent: [] as boolean[],
}));

vi.mock('./send-event', () => ({
  sendEvent: vi.fn((_window, channel: string, payload: { phase?: { phase?: string } }) => {
    if (channel === 'connection.changed' && payload.phase?.phase === 'connected') {
      sendState.driverPublishedWhenConnectedSent.push(drivers.has('fresh-session'));
    }
  }),
}));

vi.mock('./session-driver', () => ({
  SessionDriver: vi.fn().mockImplementation((session: unknown) => ({
    wraps: (candidate: unknown) => candidate === session,
    dispose: vi.fn(),
    attachWindow: vi.fn(() => vi.fn()),
  })),
}));

import { bindWindow } from './ipc';
import { broadcastHostEvent } from './event-bus';
import { drivers } from './ipc/shared';
import { sendEvent } from './send-event';
import type { RunnerPool } from './runner-pool';
import type { RunnerSupervisor } from './runner-supervisor';

const connectedPhase = {
  phase: 'connected',
  socket: '/tmp/fresh-session.sock',
  sessionId: 'fresh-session',
  activeProvider: 'openai-codex',
  activeMode: 'default',
} as const;

class FakePool extends EventEmitter {
  readonly supervisor = {
    snapshot: () => ({
      phase: connectedPhase,
      cliPath: null,
      attempts: 0,
      log: [],
    }),
    remote: () => ({ tag: 'remote-session' }),
  } as unknown as RunnerSupervisor;

  get(id: string): RunnerSupervisor | null {
    return id === 'fresh-session' ? this.supervisor : null;
  }

  list(): ReadonlyArray<{ id: string; supervisor: RunnerSupervisor }> {
    return [];
  }
}

class PrimedFakePool extends FakePool {
  override list(): ReadonlyArray<{ id: string; supervisor: RunnerSupervisor }> {
    return [{ id: 'fresh-session', supervisor: this.supervisor }];
  }
}

const fakeWindow = {
  isDestroyed: () => false,
} as never;

afterEach(() => {
  drivers.clear();
  sendState.driverPublishedWhenConnectedSent = [];
  vi.clearAllMocks();
});

describe('bindWindow session readiness ordering', () => {
  it('publishes the session driver before announcing a connected session', () => {
    const pool = new FakePool();
    const cleanup = bindWindow(pool as unknown as RunnerPool, fakeWindow);

    pool.emit('change', 'fresh-session');

    expect(sendState.driverPublishedWhenConnectedSent).toEqual([true]);
    cleanup();
  });

  it('publishes the session driver before replaying an already connected session on bind', () => {
    const pool = new PrimedFakePool();
    const cleanup = bindWindow(pool as unknown as RunnerPool, fakeWindow);

    expect(sendState.driverPublishedWhenConnectedSent).toEqual([true]);
    cleanup();
  });

  it('forwards host-level events to the bound desktop window until cleanup', () => {
    const pool = new FakePool();
    const cleanup = bindWindow(pool as unknown as RunnerPool, fakeWindow);
    const payload = { desks: [], activeId: null };
    vi.mocked(sendEvent).mockClear();

    broadcastHostEvent('desks.changed', payload);

    expect(sendEvent).toHaveBeenCalledWith(fakeWindow, 'desks.changed', payload);

    vi.mocked(sendEvent).mockClear();
    cleanup();
    broadcastHostEvent('desks.changed', payload);

    expect(sendEvent).not.toHaveBeenCalled();
  });
});
