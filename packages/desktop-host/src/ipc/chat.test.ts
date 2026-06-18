import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

const clearLogMock = vi.fn(async (_workspaceId: string) => {});
vi.mock('../chat-log', () => ({
  clearLog: (workspaceId: string) => clearLogMock(workspaceId),
}));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName, IpcEvents } from '@moxxy/desktop-ipc-contract';
import type { RunnerPool } from '../runner-pool';
import { desktopEventBus } from '../event-bus';
import { setActiveBus } from './shared';
import { registerChatHandlers, shouldMirrorToNdjson } from './chat';

type Handler = (...args: unknown[]) => Promise<unknown>;

function fakeBus(): { readonly bus: CommandBus; readonly handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: IpcCommandName, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as unknown as CommandBus;
  return { bus, handlers };
}

const fakePool = {
  activeWorkspaceId: () => null,
  get: () => null,
} as unknown as RunnerPool;

describe('shouldMirrorToNdjson (double-write gate)', () => {
  it('skips the NDJSON mirror for a v10+ runner (runner is authoritative)', () => {
    expect(shouldMirrorToNdjson(10)).toBe(false);
    expect(shouldMirrorToNdjson(11)).toBe(false);
  });

  it('keeps writing the mirror against a <v10 runner (renderer still falls back to NDJSON)', () => {
    expect(shouldMirrorToNdjson(9)).toBe(true);
    expect(shouldMirrorToNdjson(7)).toBe(true);
  });

  it('keeps writing the mirror when the runner version is unknown (no runner attached yet)', () => {
    // Safe default — never drop an event because we couldn't read the version.
    expect(shouldMirrorToNdjson(null)).toBe(true);
  });
});

describe('chat.* handlers', () => {
  it('broadcasts chat clears so every attached surface drops stale history', async () => {
    const received: Array<{ channel: keyof IpcEvents; payload: unknown }> = [];
    const off = desktopEventBus.addSink({
      broadcast: (channel, payload) => received.push({ channel, payload }),
    });
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerChatHandlers(fakePool);

    try {
      await handlers.get('chat.clearLog')!({ workspaceId: 'session-clear-sync' });

      expect(clearLogMock).toHaveBeenCalledWith('session-clear-sync');
      expect(received).toContainEqual({
        channel: 'chat.cleared',
        payload: { workspaceId: 'session-clear-sync' },
      });
    } finally {
      off();
    }
  });
});
