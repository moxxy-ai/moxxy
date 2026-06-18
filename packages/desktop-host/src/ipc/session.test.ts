import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName, IpcEvents, SessionInfo } from '@moxxy/desktop-ipc-contract';
import { drivers, setActiveBus } from './shared';
import { registerSessionHandlers } from './session';
import type { RunnerPool } from '../runner-pool';
import type { RunnerSupervisor } from '../runner-supervisor';
import type { SessionDriver } from '../session-driver';
import { desktopEventBus } from '../event-bus';

type Handler = (...args: unknown[]) => Promise<unknown>;

function fakeBus(): { bus: CommandBus; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: IpcCommandName, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as unknown as CommandBus;
  return { bus, handlers };
}

function sessionInfo(sessionId: string): SessionInfo {
  return {
    sessionId,
    cwd: '/tmp/moxxy-test',
    activeProvider: 'openai-codex',
    providers: [{ name: 'openai-codex', models: [{ id: 'gpt-5' }] }],
    activeMode: 'default',
    activeModeBadge: null,
    modes: ['default'],
    tools: [],
    skills: [],
    commands: [],
    readyProviders: ['openai-codex'],
    hasTranscriber: false,
    activeTranscriber: null,
    hasSynthesizer: false,
    activeSynthesizer: null,
  };
}

describe('session.info handler', () => {
  it('waits for a cold-started supervisor to expose its remote session', async () => {
    const poolEmitter = new EventEmitter();
    let supervisor: { remote: () => { getInfo: () => SessionInfo } | null } | null = null;
    const pool = Object.assign(poolEmitter, {
      activeWorkspaceId: () => 'fresh-session',
      get: (id: string) => (id === 'fresh-session' ? supervisor : null),
    }) as unknown as RunnerPool;
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSessionHandlers(pool);

    const result = handlers.get('session.info')!({ workspaceId: 'fresh-session' });
    await Promise.resolve();
    supervisor = { remote: () => ({ getInfo: () => sessionInfo('fresh-session') }) };
    poolEmitter.emit('change', 'fresh-session');

    await expect(result).resolves.toMatchObject({
      sessionId: 'fresh-session',
      activeProvider: 'openai-codex',
      activeMode: 'default',
    });
  });
});

describe('session.setModel handler', () => {
  it('broadcasts the shared per-session model choice to every surface', async () => {
    const events: Array<{ channel: keyof IpcEvents; payload: unknown }> = [];
    const off = desktopEventBus.addSink({
      broadcast: (channel, payload) => events.push({ channel, payload }),
    });
    const pool = {
      activeWorkspaceId: () => 'ws-model',
      get: (id: string) => (id === 'ws-model' ? ({ remote: () => null } as RunnerSupervisor) : null),
    } as unknown as RunnerPool;
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSessionHandlers(pool);

    await handlers.get('session.setModel')!({ workspaceId: 'ws-model', model: 'gpt-5.4' });

    expect(events).toContainEqual({
      channel: 'session.model.changed',
      payload: { workspaceId: 'ws-model', model: 'gpt-5.4' },
    });
    off();
  });
});

describe('session.setAutoApprove handler', () => {
  it('updates the driver and broadcasts the shared auto-approve state to every surface', async () => {
    const events: Array<{ channel: keyof IpcEvents; payload: unknown }> = [];
    const off = desktopEventBus.addSink({
      broadcast: (channel, payload) => events.push({ channel, payload }),
    });
    const setAutoApprove = vi.fn();
    drivers.set('ws-auto', { setAutoApprove } as unknown as SessionDriver);
    const pool = {
      activeWorkspaceId: () => 'ws-auto',
      get: () => null,
    } as unknown as RunnerPool;
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSessionHandlers(pool);

    try {
      await handlers.get('session.setAutoApprove')!({
        workspaceId: 'ws-auto',
        enabled: true,
      });

      expect(setAutoApprove).toHaveBeenCalledWith(true);
      expect(events).toContainEqual({
        channel: 'session.autoApprove.changed',
        payload: { workspaceId: 'ws-auto', enabled: true },
      });
    } finally {
      drivers.delete('ws-auto');
      off();
    }
  });
});

describe('session.runTurn handler', () => {
  it('forwards remote inline attachments to the session driver', async () => {
    const inlineAttachments = [
      {
        kind: 'image' as const,
        content: 'AQID',
        mediaType: 'image/png',
        name: 'phone-screen.png',
      },
    ];
    const runTurn = vi.fn().mockResolvedValue({ turnId: 'turn-inline' });
    drivers.set('ws-inline', { runTurn } as unknown as SessionDriver);
    const pool = {
      activeWorkspaceId: () => 'ws-inline',
      get: (id: string) =>
        id === 'ws-inline'
          ? ({
              getCwd: () => '/tmp/moxxy-test',
              remote: () => null,
            } as unknown as RunnerSupervisor)
          : null,
    } as unknown as RunnerPool;
    const { bus, handlers } = fakeBus();
    setActiveBus(bus);
    registerSessionHandlers(pool);

    try {
      await handlers.get('session.runTurn')!({
        workspaceId: 'ws-inline',
        prompt: 'Przeanalizuj obraz',
        inlineAttachments,
      });

      expect(runTurn).toHaveBeenCalledWith(
        'Przeanalizuj obraz',
        undefined,
        undefined,
        inlineAttachments,
      );
    } finally {
      drivers.delete('ws-inline');
    }
  });
});
