import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName, IpcEvents, SessionInfo } from '@moxxy/desktop-ipc-contract';
import { setActiveBus } from './shared';
import { registerSessionHandlers } from './session';
import type { RunnerPool } from '../runner-pool';
import type { RunnerSupervisor } from '../runner-supervisor';
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
