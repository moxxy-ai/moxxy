import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { RunnerPool } from '../runner-pool';
import type { RunnerSupervisor } from '../runner-supervisor';
import { setActiveBus } from './shared';
import { registerVoiceHandlers } from './voice';

type Handler = (...args: unknown[]) => Promise<unknown>;

function register(options: {
  readonly installed: boolean;
  readonly install?: () => Promise<void>;
}) {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: IpcCommandName, handler: Handler) => handlers.set(channel, handler),
  } as unknown as CommandBus;
  const restart = vi.fn(async () => undefined);
  const pool = {
    list: () => [
      { id: 'workspace-a', supervisor: { restart } as unknown as RunnerSupervisor },
      { id: 'workspace-b', supervisor: { restart } as unknown as RunnerSupervisor },
    ],
  } as unknown as RunnerPool;
  const install = options.install ?? vi.fn(async () => undefined);
  setActiveBus(bus);
  registerVoiceHandlers(pool, {
    isInstalled: async () => options.installed,
    install,
  });
  return { handlers, install, restart };
}

describe('registerVoiceHandlers', () => {
  it('reports package presence and restarts every runner after installation', async () => {
    const { handlers, install, restart } = register({ installed: false });

    await expect(handlers.get('voice.isLocalPiperInstalled')?.()).resolves.toBe(false);
    await expect(handlers.get('voice.installLocalPiper')?.()).resolves.toBeUndefined();
    expect(install).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it('does not restart runners after a failed installation', async () => {
    const failure = new Error('package download failed');
    const { handlers, restart } = register({
      installed: false,
      install: vi.fn(async () => { throw failure; }),
    });

    await expect(handlers.get('voice.installLocalPiper')?.()).rejects.toBe(failure);
    expect(restart).not.toHaveBeenCalled();
  });
});
